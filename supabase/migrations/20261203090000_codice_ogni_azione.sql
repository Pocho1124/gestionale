-- Codice a ogni azione: con durata 0 (ora predefinita, e impostata sui locali esistenti) il backoffice chiede nome + codice
-- per ogni apertura, comanda, conferma, incasso o storno e blocca la postazione subito dopo; il server tiene il codice
-- valido solo 30 secondi, il tempo di completare l'operazione. Una validità di qualche minuto resta sceglibile.

alter table public.sicurezza_sala drop constraint sicurezza_sala_durata_secondi_check;
alter table public.sicurezza_sala add constraint sicurezza_sala_durata_secondi_check check (durata_secondi = 0 or durata_secondi between 30 and 900);
alter table public.sicurezza_sala alter column durata_secondi set default 0;
update public.sicurezza_sala set durata_secondi = 0;

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
  insert into public.operatori_attivi (locale_id, account, sessione, operatore, scade_at)
    values (p_locale, (select auth.uid()), v_s, p_utente, v_scade)
    on conflict (locale_id, account, sessione) do update set operatore = excluded.operatore, scade_at = excluded.scade_at;
  return jsonb_build_object('id', p_utente, 'nome', public.nome_responsabile(p_utente), 'ruolo', v_ruolo, 'scade_at', v_scade);
end $$;

create or replace function public.stato_operatore(p_locale uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_op uuid;
begin
  if public.ruolo_in_locale(p_locale) is null then raise exception 'Permesso negato' using errcode = '42501'; end if;
  v_op := public.operatore_corrente(p_locale);
  return jsonb_build_object(
    'chiede_codice', public.chiede_codice(p_locale),
    'postazione', public.e_postazione(p_locale),
    'durata_secondi', coalesce((select s.durata_secondi from public.sicurezza_sala s where s.locale_id = p_locale), 0),
    'solo_responsabile', coalesce((select s.solo_responsabile from public.sicurezza_sala s where s.locale_id = p_locale), false),
    'codice_obbligatorio', coalesce((select s.codice_obbligatorio from public.sicurezza_sala s where s.locale_id = p_locale), false),
    'operatore', case when v_op is null then null else jsonb_build_object(
        'id', v_op, 'nome', public.nome_responsabile(v_op), 'ruolo', public.ruolo_di(p_locale, v_op),
        'scade_at', (select o.scade_at from public.operatori_attivi o where o.locale_id = p_locale and o.account = (select auth.uid())
                       and o.sessione = public.sessione_accesso())) end,
    'personale', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.user_id, 'nome', coalesce(nullif(p.nome, ''), 'Senza nome'), 'ruolo', m.ruolo,
                                          'ha_codice', c.user_id is not null, 'postazione', m.chiede_codice, 'esente', m.esente_codice)
                       order by public.livello_ruolo(m.ruolo) desc, p.nome)
        from public.membri m join public.locali l on l.organizzazione_id = m.organizzazione_id
        left join public.profili p on p.id = m.user_id
        left join public.codici_personali c on c.locale_id = p_locale and c.user_id = m.user_id
       where l.id = p_locale and (m.locale_id is null or m.locale_id = p_locale)
         and public.ruolo_di(p_locale, m.user_id) is not null), '[]'::jsonb));
end $$;
