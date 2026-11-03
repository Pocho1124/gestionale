-- Permessi per capacità, gestione utenti dal backoffice con controllo dell'escalation dei diritti,
-- annullamento ordini, chiusura del tavolo con pagamento.

-- ============================================================ Capacità per ruolo (unica fonte di verità)
create or replace function public.livello_ruolo(r public.ruolo)
returns int language sql immutable set search_path = '' as $$
  select case r when 'owner' then 4 when 'manager' then 3 when 'caposala' then 2 else 1 end;
$$;

create or replace function public.puo(p_locale uuid, p_capacita text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.ruolo_in_locale(p_locale)::text = any (case p_capacita
    when 'sala.apri'       then array['owner','manager','caposala','cameriere']
    when 'sala.comanda'    then array['owner','manager','caposala','cameriere']
    when 'ordini.conferma' then array['owner','manager','caposala','cameriere']
    when 'sala.chiudi'     then array['owner','manager','caposala']
    when 'ordini.annulla'  then array['owner','manager','caposala']
    when 'cucina.avanza'   then array['owner','manager','caposala','cameriere','cucina']
    when 'esauriti'        then array['owner','manager','caposala','cameriere','cucina']
    when 'magazzino'       then array['owner','manager']
    when 'reparti'         then array['owner','manager']
    when 'utenti'          then array['owner','manager']
    when 'cassa'           then array['owner']
    else array[]::text[] end), false);
$$;

-- ============================================================ Stato «annullato» e pagamento alla chiusura
alter table public.ordini drop constraint ordini_stato_check;
alter table public.ordini add constraint ordini_stato_check
  check (stato in ('da_confermare', 'confermato', 'in_preparazione', 'pronto', 'servito', 'rifiutato', 'annullato'));
alter table public.ordini add column annullato_da uuid, add column annullato_at timestamptz;

alter table public.sessioni_tavolo
  add column pagamento text check (pagamento in ('contanti', 'carta', 'misto', 'altro')),
  add column totale_cent int check (totale_cent >= 0);

-- Totale di una sessione: ordini validi (non rifiutati né annullati)
create or replace function public.totale_sessione(p_sessione uuid)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(sum(r.quantita * r.prezzo_cent), 0)::int
  from public.ordini o join public.righe_ordine r on r.ordine_id = o.id
  where o.sessione_id = p_sessione and o.stato not in ('rifiutato', 'annullato');
$$;

-- ============================================================ Funzioni di sala con le capacità
create or replace function public.apri_tavolo(p_tavolo uuid, p_coperti int default 2)
returns public.sessioni_tavolo language plpgsql security definer set search_path = '' as $$
declare v_locale uuid; v_sessione public.sessioni_tavolo;
begin
  select locale_id into v_locale from public.tavoli where id = p_tavolo and attivo;
  if v_locale is null or not public.puo(v_locale, 'sala.apri') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if exists (select 1 from public.sessioni_tavolo where tavolo_id = p_tavolo and chiusa_at is null) then
    raise exception 'Il tavolo è già aperto' using errcode = '23505';
  end if;
  v_sessione := public.sessione_aperta_o_nuova(p_tavolo, p_coperti);
  return v_sessione;
end $$;

drop function public.chiudi_tavolo(uuid);
create or replace function public.chiudi_tavolo(p_tavolo uuid, p_pagamento text default 'contanti')
returns int language plpgsql security definer set search_path = '' as $$
declare v_locale uuid; v_ses uuid; v_totale int;
begin
  select locale_id into v_locale from public.tavoli where id = p_tavolo;
  if v_locale is null or not public.puo(v_locale, 'sala.chiudi') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if p_pagamento not in ('contanti', 'carta', 'misto', 'altro') then raise exception 'Metodo di pagamento non valido' using errcode = '22023'; end if;
  select id into v_ses from public.sessioni_tavolo where tavolo_id = p_tavolo and chiusa_at is null;
  if v_ses is null then raise exception 'Il tavolo non è aperto' using errcode = '22023'; end if;
  v_totale := public.totale_sessione(v_ses);
  update public.sessioni_tavolo set chiusa_at = now(), chiusa_da = (select auth.uid()), pagamento = p_pagamento, totale_cent = v_totale
   where id = v_ses;
  return v_totale;
end $$;

create or replace function public.decidi_ordine(p_ordine uuid, p_conferma boolean, p_motivo text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v_locale uuid;
begin
  select locale_id into v_locale from public.ordini where id = p_ordine and stato = 'da_confermare';
  if v_locale is null then raise exception 'Ordine già gestito o inesistente' using errcode = '22023'; end if;
  if not public.puo(v_locale, 'ordini.conferma') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  update public.ordini
     set stato = case when p_conferma then 'confermato' else 'rifiutato' end,
         motivo = case when p_conferma then '' else left(coalesce(p_motivo, ''), 200) end,
         confermato_at = now(), confermato_da = (select auth.uid())
   where id = p_ordine;
  if p_conferma then perform public.ordine_confermato(p_ordine); end if;
end $$;

create or replace function public.avanza_ordine(p_ordine uuid, p_stato text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.ordini;
begin
  select * into v from public.ordini where id = p_ordine;
  if v.id is null or not public.puo(v.locale_id, 'cucina.avanza') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if not ((v.stato = 'confermato' and p_stato = 'in_preparazione') or (v.stato = 'in_preparazione' and p_stato = 'pronto')
          or (v.stato = 'pronto' and p_stato = 'servito')) then
    raise exception 'Passaggio di stato non valido' using errcode = '22023';
  end if;
  update public.ordini set stato = p_stato where id = p_ordine;
end $$;

-- Annullamento: amministratore, responsabile e caposala; il cameriere no
create or replace function public.annulla_ordine(p_ordine uuid, p_motivo text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v public.ordini;
begin
  select * into v from public.ordini where id = p_ordine for update;
  if v.id is null or not public.puo(v.locale_id, 'ordini.annulla') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if v.stato in ('rifiutato', 'annullato') then raise exception 'Ordine già annullato o rifiutato' using errcode = '22023'; end if;
  if exists (select 1 from public.sessioni_tavolo where id = v.sessione_id and chiusa_at is not null) then
    raise exception 'Il tavolo è già chiuso: l''ordine fa parte del conto incassato' using errcode = '22023';
  end if;
  update public.ordini set stato = 'annullato', motivo = left(coalesce(p_motivo, ''), 200), annullato_da = (select auth.uid()), annullato_at = now()
   where id = p_ordine;
  perform public.ordine_annullato(p_ordine);
end $$;

create or replace function public.accetta_richiesta(p_richiesta uuid, p_coperti int default 2)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.richieste_tavolo; v_ses public.sessioni_tavolo; v_ord uuid;
begin
  select * into v from public.richieste_tavolo where id = p_richiesta for update;
  if v.id is null or not public.puo(v.locale_id, 'ordini.conferma') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if v.stato <> 'in_attesa' or v.creato_at < now() - interval '15 minutes' then raise exception 'Richiesta già gestita o scaduta' using errcode = '22023'; end if;
  v_ses := public.sessione_aperta_o_nuova(v.tavolo_id, p_coperti);
  v_ord := public.crea_ordine_interno(v.locale_id, v_ses.id, v.tavolo_id, v.righe, v.nota, 'cliente', 'confermato');
  update public.richieste_tavolo set stato = 'accettata', sessione_id = v_ses.id, ordine_id = v_ord, deciso_at = now(), deciso_da = (select auth.uid())
   where id = v.id;
  return jsonb_build_object('codice', v_ses.codice, 'sessione_id', v_ses.id, 'ordine_id', v_ord);
end $$;

create or replace function public.rifiuta_richiesta(p_richiesta uuid, p_motivo text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v public.richieste_tavolo;
begin
  select * into v from public.richieste_tavolo where id = p_richiesta;
  if v.id is null or not public.puo(v.locale_id, 'ordini.conferma') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if v.stato <> 'in_attesa' then raise exception 'Richiesta già gestita' using errcode = '22023'; end if;
  update public.richieste_tavolo set stato = 'rifiutata', motivo = left(coalesce(p_motivo, ''), 200), deciso_at = now(), deciso_da = (select auth.uid())
   where id = v.id;
end $$;

create or replace function public.ordine_sala(p_tavolo uuid, p_righe jsonb, p_nota text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ses public.sessioni_tavolo; v_locale uuid;
begin
  select locale_id into v_locale from public.tavoli where id = p_tavolo;
  if v_locale is null or not public.puo(v_locale, 'sala.comanda') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  select * into v_ses from public.sessioni_tavolo where tavolo_id = p_tavolo and chiusa_at is null;
  if v_ses.id is null then raise exception 'Apri prima il tavolo' using errcode = '22023'; end if;
  return public.crea_ordine_interno(v_ses.locale_id, v_ses.id, p_tavolo, p_righe, p_nota, 'sala', 'confermato');
end $$;

create or replace function public.gestisci_conto(p_richiesta uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_locale uuid;
begin
  select locale_id into v_locale from public.richieste_conto where id = p_richiesta;
  if v_locale is null or not public.puo(v_locale, 'sala.chiudi') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  update public.richieste_conto set stato = 'gestita', gestita_at = now(), gestita_da = (select auth.uid())
   where id = p_richiesta and stato = 'in_attesa';
end $$;

create or replace function public.imposta_disponibilita(p_prodotto uuid, p_disponibile boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_locale uuid;
begin
  select locale_id into v_locale from public.prodotti where id = p_prodotto;
  if v_locale is null or not public.puo(v_locale, 'esauriti') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  update public.prodotti set disponibile = p_disponibile, esaurito_magazzino = false where id = p_prodotto;
end $$;

-- ============================================================ Gestione utenti (dal backoffice, senza pannello di Supabase)
-- Regola anti-escalation: si gestisce solo chi ha un ruolo INFERIORE al proprio e si assegnano solo ruoli
-- inferiori al proprio; nessuno modifica se stesso; il ruolo di titolare non si assegna da qui.

create or replace function public.email_accesso(p_login text)
returns text language sql immutable set search_path = '' as $$
  -- «mario.rossi» diventa un indirizzo interno, per il personale senza email
  select lower(case when position('@' in p_login) > 0 then trim(p_login) else trim(p_login) || '@staff.locale' end);
$$;

create or replace function public.controlla_gestione(p_locale uuid, p_utente uuid, p_nuovo public.ruolo default null)
returns public.ruolo language plpgsql stable security definer set search_path = '' as $$
declare v_mio public.ruolo := public.ruolo_in_locale(p_locale); v_suo public.ruolo;
begin
  if not public.puo(p_locale, 'utenti') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if p_utente = (select auth.uid()) then raise exception 'Non puoi modificare il tuo stesso account da qui' using errcode = '42501'; end if;
  select m.ruolo into v_suo from public.membri m join public.locali l on l.organizzazione_id = m.organizzazione_id
   where l.id = p_locale and m.user_id = p_utente and (m.locale_id is null or m.locale_id = p_locale);
  if v_suo is null then raise exception 'Utente non trovato in questo locale' using errcode = '22023'; end if;
  if public.livello_ruolo(v_suo) >= public.livello_ruolo(v_mio) then
    raise exception 'Non puoi gestire un utente con ruolo pari o superiore al tuo' using errcode = '42501';
  end if;
  if p_nuovo is not null and (p_nuovo = 'owner' or public.livello_ruolo(p_nuovo) >= public.livello_ruolo(v_mio)) then
    raise exception 'Non puoi assegnare un ruolo pari o superiore al tuo' using errcode = '42501';
  end if;
  return v_suo;
end $$;

create or replace function public.inserisci_utente_auth(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_col text;
begin
  select string_agg(quote_ident(column_name), ', ') into v_col from information_schema.columns
   where table_schema = 'auth' and table_name = 'users' and is_generated = 'NEVER' and p ? column_name;
  execute format('insert into auth.users (%s) select %s from jsonb_populate_record(null::auth.users, $1)', v_col, v_col) using p;
end $$;

-- Blocco dell'accesso (colonna banned_until del servizio di accesso, se presente)
create or replace function public.blocca_accesso(p_utente uuid, p_bloccato boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until') then
    execute 'update auth.users set banned_until = $2, updated_at = now() where id = $1'
      using p_utente, case when p_bloccato then 'infinity'::timestamptz end;
  end if;
end $$;

create or replace function public.crea_utente(p_locale uuid, p_nome text, p_login text, p_password text, p_ruolo public.ruolo)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_mio public.ruolo := public.ruolo_in_locale(p_locale); v_id uuid := gen_random_uuid(); v_email text := public.email_accesso(p_login); v_org uuid;
begin
  if not public.puo(p_locale, 'utenti') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if p_ruolo = 'owner' or public.livello_ruolo(p_ruolo) >= public.livello_ruolo(v_mio) then
    raise exception 'Non puoi assegnare un ruolo pari o superiore al tuo' using errcode = '42501';
  end if;
  if v_email !~ '^[a-z0-9._%+-]{2,64}@[a-z0-9.-]+\.[a-z]{2,}$' then raise exception 'Nome utente o email non validi' using errcode = '22023'; end if;
  if char_length(coalesce(p_password, '')) < 10 then raise exception 'La password deve avere almeno 10 caratteri' using errcode = '22023'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then raise exception 'Nome utente o email già in uso' using errcode = '23505'; end if;
  select organizzazione_id into v_org from public.locali where id = p_locale;

  -- Le colonne di auth.users cambiano tra versioni del servizio di accesso: si scrivono solo quelle presenti
  perform public.inserisci_utente_auth(jsonb_build_object(
    'instance_id', '00000000-0000-0000-0000-000000000000', 'id', v_id, 'aud', 'authenticated', 'role', 'authenticated',
    'email', v_email, 'encrypted_password', extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    'email_confirmed_at', now(), 'confirmed_at', now(),
    'raw_app_meta_data', '{"provider":"email","providers":["email"]}'::jsonb, 'raw_user_meta_data', jsonb_build_object('nome', left(coalesce(p_nome, ''), 120)),
    'created_at', now(), 'updated_at', now(),
    'confirmation_token', '', 'recovery_token', '', 'email_change_token_new', '', 'email_change_token_current', '', 'email_change_token', '', 'email_change', ''));
  -- Identità email (colonne diverse tra versioni del servizio di accesso: si inserisce solo se presente)
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id') then
    execute 'insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
             values ($1::text, $1, $2, ''email'', now(), now(), now())'
      using v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true);
  end if;
  insert into public.membri (organizzazione_id, user_id, ruolo, locale_id) values (v_org, v_id, p_ruolo, p_locale);
  return v_id;
end $$;

create or replace function public.elenco_utenti(p_locale uuid)
returns table (user_id uuid, nome text, accesso text, ruolo public.ruolo, attivo boolean, ultimo_accesso timestamptz, gestibile boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_mio public.ruolo := public.ruolo_in_locale(p_locale);
begin
  if not public.puo(p_locale, 'utenti') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  return query
    select m.user_id, p.nome, replace(u.email, '@staff.locale', ''), m.ruolo,
           coalesce((to_jsonb(u) ->> 'banned_until')::timestamptz < now(), true), (to_jsonb(u) ->> 'last_sign_in_at')::timestamptz,
           m.user_id <> (select auth.uid()) and public.livello_ruolo(m.ruolo) < public.livello_ruolo(v_mio)
    from public.membri m join public.locali l on l.organizzazione_id = m.organizzazione_id
    join auth.users u on u.id = m.user_id left join public.profili p on p.id = m.user_id
    where l.id = p_locale and (m.locale_id is null or m.locale_id = p_locale)
    order by public.livello_ruolo(m.ruolo) desc, p.nome;
end $$;

create or replace function public.modifica_ruolo_utente(p_locale uuid, p_utente uuid, p_ruolo public.ruolo)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.controlla_gestione(p_locale, p_utente, p_ruolo);
  update public.membri m set ruolo = p_ruolo from public.locali l
   where l.id = p_locale and m.organizzazione_id = l.organizzazione_id and m.user_id = p_utente;
end $$;

create or replace function public.reimposta_password_utente(p_locale uuid, p_utente uuid, p_password text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.controlla_gestione(p_locale, p_utente);
  if char_length(coalesce(p_password, '')) < 10 then raise exception 'La password deve avere almeno 10 caratteri' using errcode = '22023'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)), updated_at = now() where id = p_utente;
  perform public.chiudi_sessioni_utente(p_utente);
end $$;

create or replace function public.imposta_attivo_utente(p_locale uuid, p_utente uuid, p_attivo boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.controlla_gestione(p_locale, p_utente);
  perform public.blocca_accesso(p_utente, not p_attivo);
  if not p_attivo then perform public.chiudi_sessioni_utente(p_utente); end if;
end $$;

create or replace function public.rimuovi_utente(p_locale uuid, p_utente uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.controlla_gestione(p_locale, p_utente);
  -- Account disattivato e tolto dal locale; resta per lo storico (audit, ordini)
  perform public.blocca_accesso(p_utente, true);
  delete from public.membri m using public.locali l
   where l.id = p_locale and m.organizzazione_id = l.organizzazione_id and m.user_id = p_utente;
  perform public.chiudi_sessioni_utente(p_utente);
end $$;

-- Disconnette subito l'utente (tabelle del servizio di accesso, se presenti)
create or replace function public.chiudi_sessioni_utente(p_utente uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if to_regclass('auth.refresh_tokens') is not null then execute 'delete from auth.refresh_tokens where user_id::text = $1::text' using p_utente; end if;
  if to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id = $1' using p_utente; end if;
end $$;
