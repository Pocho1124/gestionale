-- Rinforzi dei codici personali (analisi di sicurezza del 11/11/2026).
-- 1. Tentativi sul codice di una persona: il conteggio non si azzera al blocco e ogni 10 errori il blocco cresce
--    (15 min, 1 h, 2 h 15 …, fino a 24 h): da qualsiasi dispositivo o sessione non si indovina un codice in pochi giorni.
-- 2. Cambio del proprio codice: il «codice attuale» sbagliato conta come tentativo (prima si poteva provare all'infinito
--    dalla sessione lasciata aperta di un collega e scoprirne il codice). La funzione restituisce l'errore invece di
--    sollevarlo, così il conteggio resta salvato.
-- 3. Postazioni condivise e account esenti non hanno un codice e non entrano come persone.
-- 4. Solo il titolare segna un account come esente dal codice (lavora senza codice in sala).
-- 5. Prenotazioni: si scrivono con il ruolo dell'account, senza codice (aprire il tavolo all'arrivo lo chiede comunque).

/** Un codice sbagliato per quella persona: ogni 10 errori di fila un blocco più lungo. */
create function public.errore_codice(p_locale uuid, p_utente uuid) returns void
language sql security definer set search_path = '' as $$
  update public.codici_personali
     set errori = errori + 1,
         bloccato_fino = case when (errori + 1) % 10 = 0
                              then now() + make_interval(mins => least(1440, 15 * ((errori + 1) / 10) * ((errori + 1) / 10)))
                              else bloccato_fino end
   where locale_id = p_locale and user_id = p_utente;
$$;

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
  v_scade := now() + make_interval(secs => coalesce((select s.durata_secondi from public.sicurezza_sala s where s.locale_id = p_locale), 120));
  insert into public.operatori_attivi (locale_id, account, sessione, operatore, scade_at)
    values (p_locale, (select auth.uid()), v_s, p_utente, v_scade)
    on conflict (locale_id, account, sessione) do update set operatore = excluded.operatore, scade_at = excluded.scade_at;
  return jsonb_build_object('id', p_utente, 'nome', public.nome_responsabile(p_utente), 'ruolo', v_ruolo, 'scade_at', v_scade);
end $$;

drop function public.imposta_codice(uuid, uuid, text, text);
/**
 * Codice personale: il proprio (con il codice attuale, se c'è) oppure, per chi gestisce il personale, quello dei ruoli inferiori.
 * p_codice null = codice tolto. Restituisce {errore} per il codice attuale sbagliato o bloccato (il tentativo resta contato).
 */
create function public.imposta_codice(p_locale uuid, p_utente uuid, p_codice text, p_attuale text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_c public.codici_personali;
begin
  if exists (select 1 from public.membri m join public.locali l on l.organizzazione_id = m.organizzazione_id
              where l.id = p_locale and m.user_id = p_utente and (m.chiede_codice or m.esente_codice)) then
    raise exception 'Le postazioni condivise e gli account esenti non hanno un codice personale' using errcode = '22023';
  end if;
  if p_utente = (select auth.uid()) then
    if public.ruolo_in_locale(p_locale) is null then raise exception 'Permesso negato' using errcode = '42501'; end if;
    select * into v_c from public.codici_personali c where c.locale_id = p_locale and c.user_id = p_utente;
    if v_c.hash is not null then
      if v_c.bloccato_fino > now() then
        return jsonb_build_object('errore', 'Codice bloccato per troppi tentativi: riprova più tardi o chiedi al responsabile');
      end if;
      if p_attuale is null or extensions.crypt(p_attuale, v_c.hash) <> v_c.hash then
        perform public.errore_codice(p_locale, p_utente);
        return jsonb_build_object('errore', 'Il codice attuale non è corretto');
      end if;
    end if;
  else
    perform public.controlla_gestione(p_locale, p_utente);
  end if;
  if p_codice is null then
    delete from public.codici_personali where locale_id = p_locale and user_id = p_utente;
    return jsonb_build_object('ok', true);
  end if;
  if p_codice !~ '^[0-9]{4,6}$' then raise exception 'Il codice deve avere da 4 a 6 cifre' using errcode = '22023'; end if;
  if p_codice ~ '^(.)\1+$' or position(p_codice in '0123456789') > 0 or position(p_codice in '9876543210') > 0 then
    raise exception 'Codice troppo facile: niente cifre tutte uguali o in fila' using errcode = '22023';
  end if;
  insert into public.codici_personali (locale_id, user_id, hash)
    values (p_locale, p_utente, extensions.crypt(p_codice, extensions.gen_salt('bf', 8)))
    on conflict (locale_id, user_id) do update set hash = excluded.hash, errori = 0, bloccato_fino = null, aggiornato_at = now();
  return jsonb_build_object('ok', true);
end $$;

/** Account esente dal codice (bot Telegram): solo il titolare; mai una postazione. */
create or replace function public.imposta_esente_codice(p_locale uuid, p_utente uuid, p_valore boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.puo(p_locale, 'cassa') then raise exception 'Solo il titolare decide chi lavora senza codice' using errcode = '42501'; end if;
  perform public.controlla_gestione(p_locale, p_utente);
  update public.membri m set esente_codice = p_valore
    from public.locali l where l.id = p_locale and m.organizzazione_id = l.organizzazione_id and m.user_id = p_utente and not m.chiede_codice;
  if p_valore then delete from public.codici_personali where locale_id = p_locale and user_id = p_utente; end if;
end $$;

drop policy prenotazioni_insert on public.prenotazioni;
drop policy prenotazioni_update on public.prenotazioni;
drop policy prenotazioni_delete on public.prenotazioni;
create policy prenotazioni_insert on public.prenotazioni for insert to authenticated with check (public.puo_account(locale_id, 'sala.apri'));
create policy prenotazioni_update on public.prenotazioni for update to authenticated
  using (public.puo_account(locale_id, 'sala.apri')) with check (public.puo_account(locale_id, 'sala.apri'));
create policy prenotazioni_delete on public.prenotazioni for delete to authenticated using (public.puo_account(locale_id, 'sala.apri'));

revoke execute on function public.errore_codice(uuid, uuid), public.imposta_codice(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.imposta_codice(uuid, uuid, text, text) to authenticated;
