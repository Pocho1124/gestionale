-- Rinforzi di sicurezza dopo l'analisi del 10/11/2026:
-- 1. un locale non può cambiare organizzazione (un responsabile poteva «portarselo via» in una sua organizzazione);
-- 2. chi gestisce un solo locale non gestisce account validi per tutta l'organizzazione;
-- 3. codice del tavolo: blocco a tempo invece che permanente (chi ha il QR non blocca più il tavolo per sempre),
--    tetto ai tentativi per conto, sblocco dal personale;
-- 4. ordini: niente ordini agganciati a un tavolo mentre si chiude;
-- 5. storico (audit): niente testi liberi dei clienti (note, righe) né etichette dei pagamenti; anche quelli già salvati;
--    pagamenti, dati fiscali e terminali POS ora tracciati, con chi ha deciso l'esito;
-- 6. fatture non cancellabili insieme al locale (conservazione per legge); limiti di dimensione sulle richieste dal telefono;
-- 7. TRUNCATE, REFERENCES e TRIGGER tolti ai ruoli dell'API su tutte le tabelle.

-- ============================================================ 1. Il locale resta nella sua organizzazione
create or replace function public.locale_resta_nell_organizzazione()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.organizzazione_id is distinct from old.organizzazione_id then
    raise exception 'Un locale non può cambiare organizzazione' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger locali_stessa_organizzazione before update of organizzazione_id on public.locali
  for each row execute function public.locale_resta_nell_organizzazione();

-- ============================================================ 2. Gestione degli utenti
create or replace function public.controlla_gestione(p_locale uuid, p_utente uuid, p_nuovo public.ruolo default null)
returns public.ruolo language plpgsql stable security definer set search_path = '' as $$
declare v_mio public.ruolo := public.ruolo_in_locale(p_locale); v_suo public.ruolo;
begin
  if not public.puo(p_locale, 'utenti') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if p_utente = (select auth.uid()) then raise exception 'Non puoi modificare il tuo stesso account da qui' using errcode = '42501'; end if;
  select m.ruolo into v_suo from public.membri m join public.locali l on l.organizzazione_id = m.organizzazione_id
   where l.id = p_locale and m.user_id = p_utente and (m.locale_id is null or m.locale_id = p_locale);
  if v_suo is null then raise exception 'Utente non trovato in questo locale' using errcode = '22023'; end if;
  -- Chi lavora su un solo locale non gestisce account validi per tutta l'organizzazione (agirebbe anche sugli altri locali)
  if exists (select 1 from public.membri m join public.locali l on l.organizzazione_id = m.organizzazione_id
             where l.id = p_locale and m.user_id = (select auth.uid()) and m.locale_id is not null)
     and exists (select 1 from public.membri m join public.locali l on l.organizzazione_id = m.organizzazione_id
                 where l.id = p_locale and m.user_id = p_utente and m.locale_id is null) then
    raise exception 'Questo account vale per tutta l''organizzazione: lo gestisce solo chi ha accesso a tutti i locali' using errcode = '42501';
  end if;
  if public.livello_ruolo(v_suo) >= public.livello_ruolo(v_mio) then
    raise exception 'Non puoi gestire un utente con ruolo pari o superiore al tuo' using errcode = '42501';
  end if;
  if p_nuovo is not null and (p_nuovo = 'owner' or public.livello_ruolo(p_nuovo) >= public.livello_ruolo(v_mio)) then
    raise exception 'Non puoi assegnare un ruolo pari o superiore al tuo' using errcode = '42501';
  end if;
  return v_suo;
end $$;

-- ============================================================ 3. Codice del tavolo
alter table public.sessioni_tavolo add column codice_bloccato_fino timestamptz;

create or replace function public.verifica_tavolo(p_token text, p_codice text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tav public.tavoli; v_ses public.sessioni_tavolo;
begin
  select * into v_tav from public.tavoli where qr_token = p_token and attivo;
  if v_tav.id is null then return jsonb_build_object('errore', 'Tavolo non valido: inquadra di nuovo il QR'); end if;
  select * into v_ses from public.sessioni_tavolo where tavolo_id = v_tav.id and chiusa_at is null;
  if v_ses.id is null then return jsonb_build_object('errore', 'Il tavolo non è ancora aperto: chiedi al personale'); end if;
  -- 30 errori in tutto il conto: serve il personale (al massimo 30 tentativi su 10.000 codici)
  if v_ses.codice_errati >= 30 then return jsonb_build_object('errore', 'Troppi codici errati: chiedi al personale'); end if;
  if v_ses.codice_bloccato_fino > now() then
    return jsonb_build_object('errore', 'Troppi tentativi: riprova tra qualche minuto o chiedi al personale');
  end if;
  if p_codice is distinct from v_ses.codice then
    -- Ogni 10 errori il codice si blocca per 15 minuti
    update public.sessioni_tavolo set codice_errati = codice_errati + 1,
           codice_bloccato_fino = case when (codice_errati + 1) % 10 = 0 then now() + interval '15 minutes' else codice_bloccato_fino end
     where id = v_ses.id;
    return jsonb_build_object('errore', 'Codice del tavolo non corretto', 'codice_errato', true);
  end if;
  return jsonb_build_object('tavolo_id', v_tav.id, 'sessione_id', v_ses.id, 'locale_id', v_tav.locale_id);
end $$;

-- Il personale sblocca il codice (es. un cliente che ha sbagliato a scriverlo)
create or replace function public.sblocca_codice_tavolo(p_tavolo uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_locale uuid;
begin
  select locale_id into v_locale from public.tavoli where id = p_tavolo;
  if v_locale is null or not public.puo(v_locale, 'sala.apri') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  update public.sessioni_tavolo set codice_errati = 0, codice_bloccato_fino = null where tavolo_id = p_tavolo and chiusa_at is null;
  if not found then raise exception 'Il tavolo non è aperto' using errcode = '22023'; end if;
end $$;

-- ============================================================ 4. Ordini solo su un tavolo aperto
create or replace function public.crea_ordine_interno(p_locale uuid, p_sessione uuid, p_tavolo uuid, p_righe jsonb,
                                                     p_nota text, p_origine text, p_stato text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ord uuid; r jsonb; v_prod public.prodotti; v_q int; v_rep uuid; v_prezzo jsonb; v_extra int; v_opz jsonb;
begin
  -- Il conto resta bloccato fino a fine transazione: un ordine non può agganciarsi a un tavolo che si sta chiudendo
  perform 1 from public.sessioni_tavolo where id = p_sessione and chiusa_at is null for update;
  if not found then raise exception 'Il tavolo è stato appena chiuso: chiedi al personale' using errcode = '22023'; end if;
  if jsonb_typeof(p_righe) is distinct from 'array' or jsonb_array_length(p_righe) not between 1 and 30 then
    raise exception 'Ordine vuoto o troppo lungo' using errcode = '22023';
  end if;
  insert into public.ordini (locale_id, sessione_id, tavolo_id, origine, nota, stato, confermato_at, confermato_da)
  values (p_locale, p_sessione, p_tavolo, p_origine, left(coalesce(p_nota, ''), 200), p_stato,
          case when p_stato = 'confermato' then now() end, case when p_stato = 'confermato' then (select auth.uid()) end)
  returning id into v_ord;
  for r in select * from jsonb_array_elements(p_righe) loop
    select * into v_prod from public.prodotti where id::text = r->>'prodotto_id' and locale_id = p_locale and visibile and disponibile;
    v_q := case when (r->>'quantita') ~ '^[0-9]{1,2}$' then (r->>'quantita')::int else 0 end;
    if v_prod.id is null or v_q not between 1 and 20 then
      raise exception 'Un piatto non è più disponibile o la quantità non è valida: aggiorna il menu' using errcode = '22023';
    end if;
    v_prezzo := public.prezzo_riga(p_locale, v_prod.id, r->'opzioni');
    -- Supplemento della nota (es. «doppia mozzarella» + 2 €): solo dal personale, mai dal telefono del cliente
    v_extra := 0; v_opz := v_prezzo->'opzioni';
    if p_origine = 'sala' and coalesce(r->>'supplemento_cent', '') <> '' then
      if (r->>'supplemento_cent') !~ '^[0-9]{1,5}$' or (r->>'supplemento_cent')::int > 10000 then
        raise exception 'Supplemento non valido (da 0 a 100 €)' using errcode = '22023';
      end if;
      v_extra := (r->>'supplemento_cent')::int;
      if v_extra > 0 then
        v_opz := v_opz || jsonb_build_array(jsonb_build_object('id', null, 'gruppo', 'Supplemento', 'nome', '+ Supplemento', 'sovrapprezzo_cent', v_extra));
      end if;
    end if;
    select coalesce(v_prod.reparto_id, c.reparto_id) into v_rep from public.categorie c where c.id = v_prod.categoria_id;
    insert into public.righe_ordine (ordine_id, locale_id, prodotto_id, nome, prezzo_cent, quantita, nota, reparto_id, opzioni)
    values (v_ord, p_locale, v_prod.id, v_prod.nome, (v_prezzo->>'prezzo_cent')::int + v_extra, v_q, left(coalesce(r->>'nota', ''), 120), v_rep, v_opz);
  end loop;
  if p_stato = 'confermato' then perform public.ordine_confermato(v_ord); end if;
  return v_ord;
end $$;

-- ============================================================ 5. Storico senza testi dei clienti
-- Testi liberi che possono contenere dati personali (nomi, allergie): restano nell'ordine, non nello storico
create or replace function public.audit_senza_testi(p_tabella text, p_riga jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case p_tabella
    when 'ordini'           then p_riga - 'nota' - 'motivo'
    when 'richieste_tavolo' then p_riga - 'nota' - 'righe' - 'segreto_hash' - 'motivo'
    when 'richieste_conto'  then p_riga - 'nota'
    when 'pagamenti'        then p_riga - 'quota'
    else p_riga end;
$$;
create or replace function public.scrivi_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row    jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_locale uuid  := coalesce((v_row ->> 'locale_id')::uuid,
                             case when tg_table_name = 'locali' then (v_row ->> 'id')::uuid end);
  v_org    uuid  := coalesce((v_row ->> 'organizzazione_id')::uuid,
                             (select organizzazione_id from public.locali where id = v_locale),
                             case when tg_table_name = 'organizzazioni' then (v_row ->> 'id')::uuid end);
begin
  -- Durante le cancellazioni a cascata non c'è più nulla da tracciare
  if v_org is null or not exists (select 1 from public.organizzazioni where id = v_org) then
    return null;
  end if;
  insert into public.audit_log (organizzazione_id, locale_id, user_id, tabella, record_id, azione, prima, dopo)
  values (
    v_org, v_locale, (select auth.uid()), tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'locale_id'),
    tg_op,
    case when tg_op <> 'INSERT' then public.audit_senza_testi(tg_table_name, to_jsonb(old)) end,
    case when tg_op <> 'DELETE' then public.audit_senza_testi(tg_table_name, to_jsonb(new)) end
  );
  return null;
end $$;

update public.audit_log set prima = public.audit_senza_testi(tabella, prima), dopo = public.audit_senza_testi(tabella, dopo)
 where tabella in ('ordini', 'richieste_tavolo', 'richieste_conto');

-- Chi ha deciso l'esito del POS o annullato un pagamento
alter table public.pagamenti add column deciso_da uuid;
create or replace function public.pagamento_deciso()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stato is distinct from old.stato then new.deciso_da := (select auth.uid()); end if;
  return new;
end $$;
create trigger pagamenti_deciso before update of stato on public.pagamenti for each row execute function public.pagamento_deciso();
create trigger pagamenti_audit after insert or update on public.pagamenti for each row execute function public.scrivi_audit();
create trigger dati_fiscali_audit after insert or update on public.dati_fiscali for each row execute function public.scrivi_audit();
create trigger terminali_pos_audit after insert or update or delete on public.terminali_pos for each row execute function public.scrivi_audit();

-- ============================================================ 6. Fatture conservate; limiti sulle richieste dal telefono
alter table public.fatture drop constraint fatture_locale_id_fkey;
alter table public.fatture add constraint fatture_locale_id_fkey foreign key (locale_id) references public.locali (id) on delete restrict;
alter table public.richieste_tavolo add constraint richieste_righe_dimensione check (octet_length(righe::text) <= 20000) not valid;

-- ============================================================ 7. Permessi
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke execute on function public.locale_resta_nell_organizzazione(), public.controlla_gestione(uuid, uuid, public.ruolo),
  public.verifica_tavolo(text, text), public.sblocca_codice_tavolo(uuid), public.crea_ordine_interno(uuid, uuid, uuid, jsonb, text, text, text),
  public.audit_senza_testi(text, jsonb), public.scrivi_audit(), public.pagamento_deciso() from public, anon, authenticated;
grant execute on function public.sblocca_codice_tavolo(uuid) to authenticated;
