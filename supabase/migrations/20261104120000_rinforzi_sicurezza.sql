-- Rinforzi dopo la revisione di sicurezza dell'aggiornamento su utenti, reparti, magazzino e cassa.

-- ============================================================ 1. Utenti condivisi tra organizzazioni
-- Password e blocco dell'accesso valgono per l'account intero: un responsabile non deve poterli toccare
-- se la persona appartiene anche a un'altra organizzazione (lì potrebbe avere un ruolo più alto).
create or replace function public.solo_questa_organizzazione(p_locale uuid, p_utente uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.membri m join public.locali l on l.id = p_locale
                     where m.user_id = p_utente and m.organizzazione_id <> l.organizzazione_id);
$$;

create or replace function public.reimposta_password_utente(p_locale uuid, p_utente uuid, p_password text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.controlla_gestione(p_locale, p_utente);
  if not public.solo_questa_organizzazione(p_locale, p_utente) then
    raise exception 'L''account appartiene anche a un''altra organizzazione: la password la cambia solo il suo titolare' using errcode = '42501';
  end if;
  if char_length(coalesce(p_password, '')) < 10 then raise exception 'La password deve avere almeno 10 caratteri' using errcode = '22023'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)), updated_at = now() where id = p_utente;
  perform public.chiudi_sessioni_utente(p_utente);
end $$;

create or replace function public.imposta_attivo_utente(p_locale uuid, p_utente uuid, p_attivo boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.controlla_gestione(p_locale, p_utente);
  if not public.solo_questa_organizzazione(p_locale, p_utente) then
    raise exception 'L''account appartiene anche a un''altra organizzazione: puoi solo toglierlo da questo locale' using errcode = '42501';
  end if;
  perform public.blocca_accesso(p_utente, not p_attivo);
  if not p_attivo then perform public.chiudi_sessioni_utente(p_utente); end if;
end $$;

create or replace function public.rimuovi_utente(p_locale uuid, p_utente uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_solo boolean;
begin
  perform public.controlla_gestione(p_locale, p_utente);
  v_solo := public.solo_questa_organizzazione(p_locale, p_utente);
  delete from public.membri m using public.locali l
   where l.id = p_locale and m.organizzazione_id = l.organizzazione_id and m.user_id = p_utente;
  -- Blocco dell'account e disconnessione solo se non lavora per altre organizzazioni
  if v_solo then perform public.blocca_accesso(p_utente, true); perform public.chiudi_sessioni_utente(p_utente); end if;
end $$;

-- ============================================================ 2. Stampanti: solo indirizzi della rete del locale, solo porte di stampa
-- Il servizio di stampa apre connessioni verso l'indirizzo configurato: niente loopback, niente reti interne
-- di Docker (172.16/12), niente indirizzi speciali; porte RAW 9100-9109.
alter table public.stampanti drop constraint stampanti_indirizzo_check;
alter table public.stampanti add constraint stampanti_indirizzo_check check (
  indirizzo ~ '^(192\.168|10\.(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9]))\.(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])$'
  and indirizzo !~ '\.(0|255)$');
alter table public.stampanti drop constraint stampanti_porta_check;
alter table public.stampanti add constraint stampanti_porta_check check (porta between 9100 and 9109);

-- ============================================================ 3. Servizio di stampa con un ruolo dedicato (non più la chiave di servizio)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'servizio_stampa') then create role servizio_stampa nologin noinherit; end if;
  -- PostgREST si collega come «authenticator» e assume il ruolo indicato nel token
  if exists (select 1 from pg_roles where rolname = 'authenticator') then grant servizio_stampa to authenticator; end if;
end $$;
grant usage on schema public to servizio_stampa;
grant select on public.comande_stampa, public.stampanti, public.reparti, public.ordini, public.tavoli, public.righe_ordine to servizio_stampa;
grant update (stato, stampata_at, errore, tentativi) on public.comande_stampa to servizio_stampa;
create policy stampa_servizio_leggi on public.comande_stampa for select to servizio_stampa using (true);
create policy stampa_servizio_aggiorna on public.comande_stampa for update to servizio_stampa using (true) with check (true);
create policy stampa_servizio_stampanti on public.stampanti for select to servizio_stampa using (true);
create policy stampa_servizio_reparti on public.reparti for select to servizio_stampa using (true);
create policy stampa_servizio_ordini on public.ordini for select to servizio_stampa using (true);
create policy stampa_servizio_tavoli on public.tavoli for select to servizio_stampa using (true);
create policy stampa_servizio_righe on public.righe_ordine for select to servizio_stampa using (true);

revoke execute on function public.solo_questa_organizzazione(uuid, uuid) from public, anon, authenticated;
