-- Account del bot con permessi dedicati: resta «responsabile» per le regole del catalogo (prodotti, categorie, vini,
-- abbinamenti, foto) ma non gestisce utenti, impostazioni, magazzino, reparti, cassa, né la struttura del locale
-- (dati del locale, aspetto, sale, tavoli, piantina, Wi-Fi, QR); in sala conferma e comanda, non chiude né storna.

alter table public.membri add column account_bot boolean not null default false;
update public.membri m set account_bot = true, esente_codice = true
  from auth.users u where u.id = m.user_id and u.email like 'bot-telegram-%@gestionale.local';

/** L'account collegato è quello del bot Telegram. */
create function public.e_account_bot(p_locale uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select m.account_bot from public.membri m join public.locali l on l.organizzazione_id = m.organizzazione_id
     where l.id = p_locale and m.user_id = (select auth.uid()) and (m.locale_id is null or m.locale_id = p_locale)), false);
$$;

/** L'account collegato è quello del bot in questa organizzazione (per i locali nuovi). */
create function public.e_account_bot_org(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membri m where m.organizzazione_id = p_org and m.user_id = (select auth.uid()) and m.account_bot);
$$;

create or replace function public.puo_account(p_locale uuid, p_capacita text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when public.e_postazione(p_locale)
         and not (p_capacita = any (array['sala.apri','sala.comanda','ordini.conferma','sala.chiudi','ordini.annulla','cucina.avanza','esauriti']))
      then false
    when public.e_account_bot(p_locale)
         and not (p_capacita = any (array['catalogo','esauriti','cucina.avanza','sala.apri','sala.comanda','ordini.conferma']))
      then false
    else coalesce(public.ruolo_in_locale(p_locale)::text = any (public.ruoli_capacita(p_capacita)), false)
      or (p_capacita = any (array['sala.apri','sala.comanda','ordini.conferma','sala.chiudi','ordini.annulla'])
          and coalesce(public.ruolo_effettivo(p_locale)::text = any (public.ruoli_capacita(p_capacita)), false))
  end;
$$;

create or replace function public.puo(p_locale uuid, p_capacita text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_capacita = any (array['sala.chiudi','ordini.annulla']) and public.e_account_bot(p_locale) then false
              when p_capacita = any (array['sala.apri','sala.comanda','ordini.conferma','sala.chiudi','ordini.annulla'])
              then coalesce(public.ruolo_effettivo(p_locale)::text = any (public.ruoli_capacita(p_capacita)), false)
              else public.puo_account(p_locale, p_capacita) end;
$$;

-- Struttura del locale: le regole «titolare o responsabile» non valgono per il bot (regole restrittive in scrittura)
do $$
declare t text; c text;
begin
  foreach t in array array['aspetto', 'sale', 'tavoli', 'elementi_sala', 'wifi_ospiti'] loop
    foreach c in array array['insert', 'update', 'delete'] loop
      execute format('create policy %I on public.%I as restrictive for %s to authenticated %s (not public.e_account_bot(locale_id))',
                     t || '_no_bot_' || c, t, c, case c when 'insert' then 'with check' else 'using' end);
    end loop;
  end loop;
end $$;
create policy wifi_no_bot_select on public.wifi_ospiti as restrictive for select to authenticated using (not public.e_account_bot(locale_id));
create policy locali_no_bot_update on public.locali as restrictive for update to authenticated using (not public.e_account_bot(id));
create policy locali_no_bot_insert on public.locali as restrictive for insert to authenticated
  with check (not public.e_account_bot_org(organizzazione_id));

create or replace function public.rigenera_qr_tavolo(p_tavolo uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_locale uuid; v_token text;
begin
  select locale_id into v_locale from public.tavoli where id = p_tavolo;
  if v_locale is null or not public.ha_ruolo_locale(v_locale, array['owner','manager']::public.ruolo[]) or public.e_account_bot(v_locale) then
    raise exception 'Permesso negato' using errcode = '42501';
  end if;
  update public.tavoli set qr_token = translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/', '-_')
   where id = p_tavolo returning qr_token into v_token;
  return v_token;
end $$;

-- Usata nelle regole: le regole girano con i permessi di chi legge
revoke all on function public.e_account_bot(uuid), public.e_account_bot_org(uuid) from public, anon, authenticated;
grant execute on function public.e_account_bot(uuid), public.e_account_bot_org(uuid) to authenticated;
