-- F2 — Sala: sale, tavoli con posizione sulla piantina, apertura/chiusura del tavolo (sessioni), Wi-Fi ospiti.
-- La sessione aperta è la base della sicurezza degli ordini dal tavolo (F3): niente sessione, niente ordini.

create table public.sale (
  id         uuid primary key default gen_random_uuid(),
  locale_id  uuid not null references public.locali (id) on delete cascade,
  nome       text not null check (char_length(nome) between 1 and 60),
  posizione  int  not null default 0,
  created_at timestamptz not null default now(),
  unique (id, locale_id)
);

create table public.tavoli (
  id         uuid primary key default gen_random_uuid(),
  locale_id  uuid not null,
  sala_id    uuid not null,
  nome       text not null check (char_length(nome) between 1 and 20),   -- «5», «T12», «Bancone 1»
  posti      int  not null default 4 check (posti between 1 and 30),
  forma      text not null default 'quadrato' check (forma in ('tondo', 'quadrato', 'rettangolo')),
  x          int  not null default 100 check (x between 0 and 1000),      -- posizione sulla piantina (0-1000)
  y          int  not null default 100 check (y between 0 and 1000),
  -- Codice casuale nel QR del tavolo: non indovinabile, rigenerabile se un cartoncino viene copiato
  qr_token   text not null unique default translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/', '-_'),
  attivo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, locale_id),
  unique (locale_id, nome),
  foreign key (sala_id, locale_id) references public.sale (id, locale_id) on delete cascade
);
create index on public.tavoli (sala_id);

-- Una sessione per ogni apertura del tavolo; al massimo una aperta per tavolo
create table public.sessioni_tavolo (
  id          uuid primary key default gen_random_uuid(),
  locale_id   uuid not null,
  tavolo_id   uuid not null,
  coperti     int  not null default 2 check (coperti between 1 and 60),
  codice      text not null check (codice ~ '^[0-9]{4}$'),                 -- da comunicare al cliente (F3)
  aperta_at   timestamptz not null default now(),
  aperta_da   uuid default auth.uid(),
  chiusa_at   timestamptz,
  chiusa_da   uuid,
  check (chiusa_at is null or chiusa_at >= aperta_at),
  foreign key (tavolo_id, locale_id) references public.tavoli (id, locale_id) on delete cascade
);
create unique index sessioni_una_aperta on public.sessioni_tavolo (tavolo_id) where chiusa_at is null;
create index on public.sessioni_tavolo (locale_id, aperta_at desc);

-- Wi-Fi ospiti per il cartoncino: visibile solo a titolare e responsabile
create table public.wifi_ospiti (
  locale_id  uuid primary key references public.locali (id) on delete cascade,
  ssid       text not null check (char_length(ssid) between 1 and 32),
  sicurezza  text not null default 'WPA' check (sicurezza in ('WPA', 'WEP', 'nopass')),
  password   text not null default '' check (char_length(password) <= 63),
  nascosta   boolean not null default false,
  url_ordini text not null default '' check (url_ordini = '' or url_ordini ~ '^https://'),   -- base del QR del tavolo
  updated_at timestamptz not null default now()
);

create trigger tavoli_updated_at before update on public.tavoli for each row execute function public.set_updated_at();
create trigger wifi_updated_at   before update on public.wifi_ospiti for each row execute function public.set_updated_at();
create trigger sale_audit     after insert or update or delete on public.sale            for each row execute function public.scrivi_audit();
create trigger tavoli_audit   after insert or update or delete on public.tavoli          for each row execute function public.scrivi_audit();
create trigger sessioni_audit after insert or update or delete on public.sessioni_tavolo for each row execute function public.scrivi_audit();

-- ============================================================ RLS
alter table public.sale            enable row level security;
alter table public.tavoli          enable row level security;
alter table public.sessioni_tavolo enable row level security;
alter table public.wifi_ospiti     enable row level security;

create policy sale_select on public.sale for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
create policy sale_write  on public.sale for all to authenticated
  using (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]))
  with check (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]));
create policy tavoli_select on public.tavoli for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
create policy tavoli_write  on public.tavoli for all to authenticated
  using (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]))
  with check (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]));
-- Le sessioni si leggono da tutto il personale, si scrivono solo con apri_tavolo / chiudi_tavolo
create policy sessioni_select on public.sessioni_tavolo for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
create policy wifi_select on public.wifi_ospiti for select to authenticated
  using (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]));
create policy wifi_write on public.wifi_ospiti for all to authenticated
  using (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]))
  with check (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]));

revoke all on public.sale, public.tavoli, public.sessioni_tavolo, public.wifi_ospiti from anon;
revoke insert, update, delete on public.sessioni_tavolo from authenticated;

-- ============================================================ Azioni di sala
create or replace function public.apri_tavolo(p_tavolo uuid, p_coperti int default 2)
returns public.sessioni_tavolo language plpgsql security definer set search_path = '' as $$
declare
  v_locale uuid;
  v_sessione public.sessioni_tavolo;
begin
  select locale_id into v_locale from public.tavoli where id = p_tavolo and attivo;
  if v_locale is null or not public.ha_ruolo_locale(v_locale, array['owner','manager','cameriere']::public.ruolo[]) then
    raise exception 'Permesso negato' using errcode = '42501';
  end if;
  if exists (select 1 from public.sessioni_tavolo where tavolo_id = p_tavolo and chiusa_at is null) then
    raise exception 'Il tavolo è già aperto' using errcode = '23505';
  end if;
  insert into public.sessioni_tavolo (locale_id, tavolo_id, coperti, codice)
  values (v_locale, p_tavolo, greatest(1, least(coalesce(p_coperti, 2), 60)),
          lpad((('x' || encode(extensions.gen_random_bytes(2), 'hex'))::bit(16)::int % 10000)::text, 4, '0'))
  returning * into v_sessione;
  return v_sessione;
end $$;

create or replace function public.chiudi_tavolo(p_tavolo uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_locale uuid;
begin
  select locale_id into v_locale from public.tavoli where id = p_tavolo;
  if v_locale is null or not public.ha_ruolo_locale(v_locale, array['owner','manager','cameriere']::public.ruolo[]) then
    raise exception 'Permesso negato' using errcode = '42501';
  end if;
  update public.sessioni_tavolo set chiusa_at = now(), chiusa_da = (select auth.uid())
   where tavolo_id = p_tavolo and chiusa_at is null;
  if not found then raise exception 'Il tavolo non è aperto' using errcode = '22023'; end if;
end $$;

-- Nuovo codice nel QR (se un cartoncino viene fotografato o copiato): il vecchio QR smette di valere
create or replace function public.rigenera_qr_tavolo(p_tavolo uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_locale uuid; v_token text;
begin
  select locale_id into v_locale from public.tavoli where id = p_tavolo;
  if v_locale is null or not public.ha_ruolo_locale(v_locale, array['owner','manager']::public.ruolo[]) then
    raise exception 'Permesso negato' using errcode = '42501';
  end if;
  update public.tavoli set qr_token = translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/', '-_')
   where id = p_tavolo returning qr_token into v_token;
  return v_token;
end $$;

revoke execute on function public.apri_tavolo(uuid, int), public.chiudi_tavolo(uuid), public.rigenera_qr_tavolo(uuid) from public, anon;
grant  execute on function public.apri_tavolo(uuid, int), public.chiudi_tavolo(uuid), public.rigenera_qr_tavolo(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.tavoli, public.sessioni_tavolo;
  end if;
end $$;
