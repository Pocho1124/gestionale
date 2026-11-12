-- Personale solo con nome utente: crea_utente non accetta più un indirizzo email (nasceva già confermato, quindi
-- chi gestisce il personale poteva intestare un account all'email di un'altra persona). Gli account esistenti restano.

create or replace function public.crea_utente(p_locale uuid, p_nome text, p_login text, p_password text, p_ruolo public.ruolo)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_mio public.ruolo := public.ruolo_in_locale(p_locale); v_id uuid := gen_random_uuid(); v_email text := public.email_accesso(p_login); v_org uuid;
begin
  if not public.puo(p_locale, 'utenti') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if p_ruolo = 'owner' or public.livello_ruolo(p_ruolo) >= public.livello_ruolo(v_mio) then
    raise exception 'Non puoi assegnare un ruolo pari o superiore al tuo' using errcode = '42501';
  end if;
  -- Solo nomi utente: un'email arbitraria nascerebbe già confermata a nome di qualcun altro
  if coalesce(p_login, '') !~ '^[A-Za-z0-9._-]{2,40}$' then
    raise exception 'Nome utente non valido: da 2 a 40 tra lettere, numeri, punto, trattino (niente email)' using errcode = '22023';
  end if;
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
