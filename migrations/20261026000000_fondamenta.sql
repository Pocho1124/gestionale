-- F0 — Fondamenta: organizzazioni, locali, membri e ruoli, profili, audit.
-- Ogni tabella di dominio futura avrà locale_id e policy basate su public.ha_ruolo_locale().

-- ============================================================
-- Tipi
-- ============================================================
create type public.ruolo as enum ('owner', 'manager', 'cameriere', 'cucina');

-- ============================================================
-- Tabelle
-- ============================================================
create table public.profili (
  id         uuid primary key references auth.users (id) on delete cascade,
  nome       text not null default '' check (char_length(nome) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizzazioni (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (char_length(nome) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.locali (
  id                uuid primary key default gen_random_uuid(),
  organizzazione_id uuid not null references public.organizzazioni (id) on delete cascade,
  nome              text not null check (char_length(nome) between 1 and 120),
  slug              text not null unique
                    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60),
  indirizzo         text not null default '' check (char_length(indirizzo) <= 200),
  fuso_orario       text not null default 'Europe/Rome',
  attivo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, organizzazione_id)
);

-- Ruolo a livello di organizzazione; locale_id valorizzato = personale limitato a un solo locale.
create table public.membri (
  organizzazione_id uuid not null references public.organizzazioni (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  ruolo             public.ruolo not null,
  locale_id         uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (organizzazione_id, user_id),
  foreign key (locale_id, organizzazione_id) references public.locali (id, organizzazione_id) on delete cascade,
  check (ruolo not in ('owner') or locale_id is null)
);
create index on public.membri (user_id);

create table public.audit_log (
  id                bigint generated always as identity primary key,
  organizzazione_id uuid not null references public.organizzazioni (id) on delete cascade,
  user_id           uuid,
  tabella           text not null,
  record_id         text,
  azione            text not null check (azione in ('INSERT', 'UPDATE', 'DELETE')),
  prima             jsonb,
  dopo              jsonb,
  created_at        timestamptz not null default now()
);
create index on public.audit_log (organizzazione_id, created_at desc);

-- ============================================================
-- Funzioni di autorizzazione (security definer: leggono membri senza ricorsione RLS)
-- ============================================================
create or replace function public.ruolo_in_org(p_org uuid)
returns public.ruolo language sql stable security definer set search_path = '' as $$
  select m.ruolo from public.membri m
  where m.organizzazione_id = p_org and m.user_id = (select auth.uid());
$$;

create or replace function public.ruolo_in_locale(p_locale uuid)
returns public.ruolo language sql stable security definer set search_path = '' as $$
  select m.ruolo
  from public.membri m
  join public.locali l on l.organizzazione_id = m.organizzazione_id
  where l.id = p_locale
    and m.user_id = (select auth.uid())
    and (m.locale_id is null or m.locale_id = p_locale);
$$;

create or replace function public.ha_ruolo_locale(p_locale uuid, p_ruoli public.ruolo[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.ruolo_in_locale(p_locale) = any (p_ruoli), false);
$$;

create or replace function public.condivide_org(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.membri a
    join public.membri b on b.organizzazione_id = a.organizzazione_id
    where a.user_id = (select auth.uid()) and b.user_id = p_user
  );
$$;

-- ============================================================
-- Trigger generici
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profili_updated_at        before update on public.profili        for each row execute function public.set_updated_at();
create trigger organizzazioni_updated_at before update on public.organizzazioni for each row execute function public.set_updated_at();
create trigger locali_updated_at         before update on public.locali         for each row execute function public.set_updated_at();
create trigger membri_updated_at         before update on public.membri         for each row execute function public.set_updated_at();

-- Audit: registra chi ha cambiato cosa. Riutilizzabile su ogni tabella con organizzazione_id (o su organizzazioni stessa).
create or replace function public.scrivi_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_org uuid  := coalesce((v_row ->> 'organizzazione_id')::uuid,
                          case when tg_table_name = 'organizzazioni' then (v_row ->> 'id')::uuid end);
begin
  -- Durante la cancellazione a cascata dell'organizzazione non c'è più nulla da tracciare
  if not exists (select 1 from public.organizzazioni where id = v_org) then
    return null;
  end if;
  insert into public.audit_log (organizzazione_id, user_id, tabella, record_id, azione, prima, dopo)
  values (
    v_org,
    (select auth.uid()),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id'),
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return null;
end $$;

create trigger organizzazioni_audit after update on public.organizzazioni
  for each row execute function public.scrivi_audit();
create trigger locali_audit after insert or update or delete on public.locali
  for each row execute function public.scrivi_audit();
create trigger membri_audit after insert or update or delete on public.membri
  for each row execute function public.scrivi_audit();

-- Un'organizzazione non può restare senza owner
create or replace function public.proteggi_ultimo_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.ruolo = 'owner'
     and (tg_op = 'DELETE' or new.ruolo <> 'owner')
     and exists (select 1 from public.organizzazioni where id = old.organizzazione_id)
     and not exists (
       select 1 from public.membri
       where organizzazione_id = old.organizzazione_id and ruolo = 'owner' and user_id <> old.user_id
     ) then
    raise exception 'L''organizzazione deve avere almeno un owner';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger membri_ultimo_owner before update or delete on public.membri
  for each row execute function public.proteggi_ultimo_owner();

-- Profilo creato automaticamente alla registrazione
create or replace function public.crea_profilo()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profili (id, nome)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'nome', ''), 120));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.crea_profilo();

-- ============================================================
-- Onboarding atomico: organizzazione + owner + primo locale
-- ============================================================
create or replace function public.crea_organizzazione(p_nome_org text, p_nome_locale text, p_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org    uuid;
  v_locale uuid;
begin
  if v_uid is null then
    raise exception 'Autenticazione richiesta' using errcode = '42501';
  end if;
  if (select count(*) from public.membri where user_id = v_uid and ruolo = 'owner') >= 5 then
    raise exception 'Limite di organizzazioni raggiunto';
  end if;

  insert into public.organizzazioni (nome) values (trim(p_nome_org)) returning id into v_org;
  insert into public.membri (organizzazione_id, user_id, ruolo) values (v_org, v_uid, 'owner');
  insert into public.locali (organizzazione_id, nome, slug)
  values (v_org, trim(p_nome_locale), lower(trim(p_slug)))
  returning id into v_locale;

  return v_locale;
end $$;

-- ============================================================
-- RLS
-- ============================================================
alter table public.profili        enable row level security;
alter table public.organizzazioni enable row level security;
alter table public.locali         enable row level security;
alter table public.membri         enable row level security;
alter table public.audit_log      enable row level security;

-- profili: vedo il mio e quelli dei colleghi; modifico solo il mio
create policy profili_select on public.profili for select to authenticated
  using (id = (select auth.uid()) or public.condivide_org(id));
create policy profili_update on public.profili for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- organizzazioni: creazione solo tramite crea_organizzazione()
create policy org_select on public.organizzazioni for select to authenticated
  using (public.ruolo_in_org(id) is not null);
create policy org_update on public.organizzazioni for update to authenticated
  using (public.ruolo_in_org(id) = 'owner') with check (public.ruolo_in_org(id) = 'owner');
create policy org_delete on public.organizzazioni for delete to authenticated
  using (public.ruolo_in_org(id) = 'owner');

-- locali
create policy locali_select on public.locali for select to authenticated
  using (public.ruolo_in_locale(id) is not null);
create policy locali_insert on public.locali for insert to authenticated
  with check (public.ruolo_in_org(organizzazione_id) in ('owner', 'manager'));
create policy locali_update on public.locali for update to authenticated
  using (public.ha_ruolo_locale(id, array['owner', 'manager']::public.ruolo[]))
  with check (public.ha_ruolo_locale(id, array['owner', 'manager']::public.ruolo[]));
create policy locali_delete on public.locali for delete to authenticated
  using (public.ruolo_in_org(organizzazione_id) = 'owner');

-- membri: tutti i membri vedono i colleghi; solo l'owner gestisce il personale
create policy membri_select on public.membri for select to authenticated
  using (public.ruolo_in_org(organizzazione_id) is not null);
create policy membri_insert on public.membri for insert to authenticated
  with check (public.ruolo_in_org(organizzazione_id) = 'owner');
create policy membri_update on public.membri for update to authenticated
  using (public.ruolo_in_org(organizzazione_id) = 'owner')
  with check (public.ruolo_in_org(organizzazione_id) = 'owner');
create policy membri_delete on public.membri for delete to authenticated
  using (public.ruolo_in_org(organizzazione_id) = 'owner');

-- audit_log: sola lettura per owner e manager; scritto solo dai trigger
create policy audit_select on public.audit_log for select to authenticated
  using (public.ruolo_in_org(organizzazione_id) in ('owner', 'manager'));

-- ============================================================
-- Privilegi (difesa in profondità oltre alle RLS)
-- ============================================================
revoke all on public.profili, public.organizzazioni, public.locali, public.membri, public.audit_log from anon;
revoke insert, update, delete on public.audit_log from authenticated;
revoke insert on public.organizzazioni from authenticated;

revoke execute on function public.crea_organizzazione(text, text, text) from public, anon;
grant  execute on function public.crea_organizzazione(text, text, text) to authenticated;

revoke execute on function public.scrivi_audit(), public.proteggi_ultimo_owner(), public.crea_profilo(), public.set_updated_at()
  from public, anon, authenticated;
