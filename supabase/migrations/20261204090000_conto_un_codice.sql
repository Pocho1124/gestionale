-- Conto con un solo codice: mentre la finestra del conto è aperta (pagamenti, esito del POS, sconto, chiusura) il codice
-- inserito resta valido. Il backoffice lo «trattiene» ogni 15 secondi finché la finestra è aperta; chiusa la finestra
-- la postazione si blocca. Il server non lo tiene oltre 60 secondi dall'ultimo rinnovo, né oltre 10 minuti dall'inserimento.

alter table public.operatori_attivi add column entrato_at timestamptz not null default now();

create or replace function public.entra_operatore(p_locale uuid, p_utente uuid, p_codice text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s text := public.sessione_accesso(); v_t public.tentativi_codice; v_c public.codici_personali; v_ruolo public.ruolo; v_scade timestamptz;
begin
  if public.ruolo_in_locale(p_locale) is null then raise exception 'Permesso negato' using errcode = '42501'; end if;
  -- Gli errori si restituiscono senza eccezione: così il conteggio dei tentativi resta salvato
  select * into v_t from public.tentativi_codice where account = (select auth.uid()) and sessione = v_s;
  if v_t.bloccato_fino > now() then
    return jsonb_build_object('errore', format('Troppi codici sbagliati: riprova tra %s minuti', ceil(extract(epoch from v_t.bloccato_fino - now()) / 60)));
  end if;
  select * into v_c from public.codici_personali where locale_id = p_locale and user_id = p_utente;
  if v_c.bloccato_fino > now() then
    return jsonb_build_object('errore', 'Codice bloccato per troppi tentativi: riprova più tardi o chiedi al responsabile');
  end if;
  v_ruolo := public.ruolo_di(p_locale, p_utente);
  -- Le postazioni condivise e gli account esenti (bot) non sono persone: non entrano con un codice
  if exists (select 1 from public.membri m join public.locali l on l.organizzazione_id = m.organizzazione_id
              where l.id = p_locale and m.user_id = p_utente and (m.chiede_codice or m.esente_codice)) then v_ruolo := null; end if;
  if v_ruolo is null or v_c.hash is null or coalesce(p_codice, '') !~ '^[0-9]{4,6}$'
     or extensions.crypt(p_codice, v_c.hash) <> v_c.hash then
    insert into public.tentativi_codice as t (account, sessione, errori) values ((select auth.uid()), v_s, 1)
      on conflict (account, sessione) do update
        set errori = case when t.errori + 1 >= 5 then 0 else t.errori + 1 end,
            bloccato_fino = case when t.errori + 1 >= 5 then now() + interval '5 minutes' else t.bloccato_fino end;
    perform public.errore_codice(p_locale, p_utente);
    return jsonb_build_object('errore', 'Codice non valido');
  end if;
  delete from public.tentativi_codice where account = (select auth.uid()) and sessione = v_s;
  update public.codici_personali set errori = 0 where locale_id = p_locale and user_id = p_utente;
  delete from public.operatori_attivi where account = (select auth.uid()) and scade_at < now();
  -- 0 = codice a ogni azione: vale solo il tempo di completare l'operazione (il backoffice blocca subito dopo)
  v_scade := now() + make_interval(secs => coalesce(nullif((select s.durata_secondi from public.sicurezza_sala s where s.locale_id = p_locale), 0), 30));
  insert into public.operatori_attivi (locale_id, account, sessione, operatore, scade_at, entrato_at)
    values (p_locale, (select auth.uid()), v_s, p_utente, v_scade, now())
    on conflict (locale_id, account, sessione) do update set operatore = excluded.operatore, scade_at = excluded.scade_at, entrato_at = now();
  return jsonb_build_object('id', p_utente, 'nome', public.nome_responsabile(p_utente), 'ruolo', v_ruolo, 'scade_at', v_scade);
end $$;

/** Rinnova il codice di chi è di turno su questa sessione (finestra del conto aperta): 60 s, al massimo 10 minuti dall'inserimento. */
create function public.trattieni_operatore(p_locale uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_scade timestamptz;
begin
  if public.ruolo_in_locale(p_locale) is null then raise exception 'Permesso negato' using errcode = '42501'; end if;
  update public.operatori_attivi o
     set scade_at = greatest(o.scade_at, least(now() + interval '60 seconds', o.entrato_at + interval '10 minutes'))
   where o.locale_id = p_locale and o.account = (select auth.uid()) and o.sessione = public.sessione_accesso() and o.scade_at > now()
  returning o.scade_at into v_scade;
  return v_scade;
end $$;
revoke all on function public.trattieni_operatore(uuid) from public, anon, authenticated;
grant execute on function public.trattieni_operatore(uuid) to authenticated;
