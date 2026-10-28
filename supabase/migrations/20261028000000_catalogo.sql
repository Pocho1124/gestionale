-- F1 — Catalogo e aspetto: categorie, prodotti, opzioni, impostazioni grafiche, menu pubblico.
-- Importi sempre in centesimi interi. Scrittura riservata a owner/manager; disponibilità anche a sala e cucina.

-- ============================================================
-- Audit esteso: le tabelle con locale_id risalgono all'organizzazione
-- ============================================================
alter table public.audit_log add column locale_id uuid; -- nessuna FK: il log sopravvive alla cancellazione del locale
create index on public.audit_log (locale_id, created_at desc);

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
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return null;
end $$;

-- ============================================================
-- Tabelle
-- ============================================================
create table public.categorie (
  id          uuid primary key default gen_random_uuid(),
  locale_id   uuid not null references public.locali (id) on delete cascade,
  nome        text not null check (char_length(nome) between 1 and 80),
  descrizione text not null default '' check (char_length(descrizione) <= 300),
  posizione   int  not null default 0,
  visibile    boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, locale_id)
);
create index on public.categorie (locale_id, posizione);

create table public.prodotti (
  id           uuid primary key default gen_random_uuid(),
  locale_id    uuid not null,
  categoria_id uuid not null,
  nome         text not null check (char_length(nome) between 1 and 120),
  descrizione  text not null default '' check (char_length(descrizione) <= 500),
  prezzo_cent  int  not null default 0 check (prezzo_cent between 0 and 10000000),
  aliquota_iva numeric(4,2) not null default 10 check (aliquota_iva in (4, 5, 10, 22)),
  disponibile  boolean not null default true,  -- esaurito temporaneamente
  visibile     boolean not null default true,  -- nascosto dal menu
  allergeni    text[] not null default '{}'
               check (allergeni <@ array['Glutine','Crostacei','Uova','Pesce','Arachidi','Soia','Latte',
                      'Frutta a guscio','Sedano','Senape','Sesamo','Solfiti','Lupini','Molluschi']::text[]),
  etichette    text[] not null default '{}'
               check (etichette <@ array['Vegetariano','Vegano','Piccante','Senza glutine',
                      'Novità','Consigliato','Surgelato']::text[]),
  immagine_url text check (immagine_url is null or immagine_url ~ '^(https?://|/)'),
  posizione    int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, locale_id),
  -- La categoria deve appartenere allo stesso locale del prodotto
  foreign key (categoria_id, locale_id) references public.categorie (id, locale_id) on delete cascade
);
create index on public.prodotti (locale_id);
create index on public.prodotti (categoria_id, posizione);

-- Varianti e aggiunte: es. "Impasto" (1 scelta obbligatoria), "Aggiunte" (0..5)
create table public.gruppi_opzioni (
  id          uuid primary key default gen_random_uuid(),
  locale_id   uuid not null,
  prodotto_id uuid not null,
  nome        text not null check (char_length(nome) between 1 and 80),
  min_scelte  int  not null default 0 check (min_scelte >= 0),
  max_scelte  int  not null default 1 check (max_scelte >= 1),
  posizione   int  not null default 0,
  unique (id, locale_id),
  check (min_scelte <= max_scelte),
  foreign key (prodotto_id, locale_id) references public.prodotti (id, locale_id) on delete cascade
);
create index on public.gruppi_opzioni (prodotto_id, posizione);

create table public.opzioni (
  id                uuid primary key default gen_random_uuid(),
  locale_id         uuid not null,
  gruppo_id         uuid not null,
  nome              text not null check (char_length(nome) between 1 and 80),
  sovrapprezzo_cent int  not null default 0 check (sovrapprezzo_cent between 0 and 1000000),
  disponibile       boolean not null default true,
  posizione         int  not null default 0,
  foreign key (gruppo_id, locale_id) references public.gruppi_opzioni (id, locale_id) on delete cascade
);
create index on public.opzioni (gruppo_id, posizione);

-- Aspetto grafico del menu: una riga per locale, modificabile dal backoffice
create table public.aspetto (
  locale_id          uuid primary key references public.locali (id) on delete cascade,
  colore_primario    text not null default '#1F4FA8' check (colore_primario ~ '^#[0-9A-Fa-f]{6}$'),
  colore_accento     text not null default '#F2C230' check (colore_accento  ~ '^#[0-9A-Fa-f]{6}$'),
  colore_sfondo      text not null default '#F2F5F8' check (colore_sfondo   ~ '^#[0-9A-Fa-f]{6}$'),
  colore_testo       text not null default '#13233A' check (colore_testo    ~ '^#[0-9A-Fa-f]{6}$'),
  font_titoli        text not null default 'Young Serif'
                     check (font_titoli in ('Young Serif','Playfair Display','Lora','Merriweather',
                                            'Oswald','Montserrat','Poppins','Figtree','Inter','Nunito')),
  font_testo         text not null default 'Figtree'
                     check (font_testo in ('Figtree','Inter','Nunito','Poppins','Montserrat','Lora','Merriweather')),
  logo_url           text check (logo_url is null or logo_url ~ '^(https?://|/)'),
  layout             text not null default 'lista' check (layout in ('lista', 'griglia', 'compatto')),
  mostra_allergeni   boolean not null default true,
  mostra_descrizioni boolean not null default true,
  testo_piede        text not null default '' check (char_length(testo_piede) <= 300),
  updated_at         timestamptz not null default now()
);

-- Ogni locale nasce con l'aspetto predefinito
create or replace function public.crea_aspetto_locale()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.aspetto (locale_id) values (new.id) on conflict do nothing;
  return null;
end $$;

create trigger locali_crea_aspetto after insert on public.locali
  for each row execute function public.crea_aspetto_locale();

insert into public.aspetto (locale_id) select id from public.locali on conflict do nothing;

-- ============================================================
-- Trigger: updated_at e audit
-- ============================================================
create trigger categorie_updated_at before update on public.categorie for each row execute function public.set_updated_at();
create trigger prodotti_updated_at  before update on public.prodotti  for each row execute function public.set_updated_at();
create trigger aspetto_updated_at   before update on public.aspetto   for each row execute function public.set_updated_at();

create trigger categorie_audit      after insert or update or delete on public.categorie      for each row execute function public.scrivi_audit();
create trigger prodotti_audit       after insert or update or delete on public.prodotti       for each row execute function public.scrivi_audit();
create trigger gruppi_opzioni_audit after insert or update or delete on public.gruppi_opzioni for each row execute function public.scrivi_audit();
create trigger opzioni_audit        after insert or update or delete on public.opzioni        for each row execute function public.scrivi_audit();
create trigger aspetto_audit        after update on public.aspetto                            for each row execute function public.scrivi_audit();

-- ============================================================
-- RLS: lettura per tutto il personale del locale, scrittura per owner/manager
-- ============================================================
alter table public.categorie      enable row level security;
alter table public.prodotti       enable row level security;
alter table public.gruppi_opzioni enable row level security;
alter table public.opzioni        enable row level security;
alter table public.aspetto        enable row level security;

create policy categorie_select on public.categorie for select to authenticated
  using (public.ruolo_in_locale(locale_id) is not null);
create policy categorie_write on public.categorie for all to authenticated
  using (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]))
  with check (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]));

create policy prodotti_select on public.prodotti for select to authenticated
  using (public.ruolo_in_locale(locale_id) is not null);
create policy prodotti_write on public.prodotti for all to authenticated
  using (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]))
  with check (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]));

create policy gruppi_select on public.gruppi_opzioni for select to authenticated
  using (public.ruolo_in_locale(locale_id) is not null);
create policy gruppi_write on public.gruppi_opzioni for all to authenticated
  using (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]))
  with check (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]));

create policy opzioni_select on public.opzioni for select to authenticated
  using (public.ruolo_in_locale(locale_id) is not null);
create policy opzioni_write on public.opzioni for all to authenticated
  using (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]))
  with check (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]));

create policy aspetto_select on public.aspetto for select to authenticated
  using (public.ruolo_in_locale(locale_id) is not null);
create policy aspetto_update on public.aspetto for update to authenticated
  using (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]))
  with check (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]));

-- ============================================================
-- Azioni del backoffice (riusate anche dall'assistente)
-- ============================================================

-- Esaurito / disponibile: consentito anche a sala e cucina
create or replace function public.imposta_disponibilita(p_prodotto uuid, p_disponibile boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_locale uuid;
begin
  select locale_id into v_locale from public.prodotti where id = p_prodotto;
  if v_locale is null
     or not public.ha_ruolo_locale(v_locale, array['owner','manager','cameriere','cucina']::public.ruolo[]) then
    raise exception 'Permesso negato' using errcode = '42501';
  end if;
  update public.prodotti set disponibile = p_disponibile where id = p_prodotto;
end $$;

-- Variazione percentuale dei prezzi (tutto il locale o una categoria). Security invoker: valgono le RLS.
create or replace function public.varia_prezzi(p_locale uuid, p_percento numeric,
                                               p_categoria uuid default null, p_arrotonda_cent int default 10)
returns integer language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if p_percento is null or p_percento <= -100 or p_percento > 500 then
    raise exception 'Percentuale non valida' using errcode = '22023';
  end if;
  if p_arrotonda_cent is null or p_arrotonda_cent not in (1, 5, 10, 50, 100) then
    raise exception 'Arrotondamento non valido' using errcode = '22023';
  end if;
  update public.prodotti
     set prezzo_cent = greatest(0, (round(prezzo_cent * (1 + p_percento / 100) / p_arrotonda_cent) * p_arrotonda_cent)::int)
   where locale_id = p_locale
     and (p_categoria is null or categoria_id = p_categoria);
  get diagnostics n = row_count;
  return n;
end $$;

-- Menu pubblico per QR/link: unico punto di accesso anonimo, solo dati visibili
create or replace function public.menu_pubblico(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'locale',  jsonb_build_object('nome', l.nome, 'indirizzo', l.indirizzo),
    'aspetto', to_jsonb(a) - 'locale_id',
    'categorie', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'nome', c.nome, 'descrizione', c.descrizione,
               'prodotti', (
                 select jsonb_agg(jsonb_build_object(
                          'id', p.id, 'nome', p.nome, 'descrizione', p.descrizione,
                          'prezzo_cent', p.prezzo_cent, 'disponibile', p.disponibile,
                          'allergeni', p.allergeni, 'etichette', p.etichette, 'immagine_url', p.immagine_url,
                          'opzioni', coalesce((
                            select jsonb_agg(jsonb_build_object(
                                     'nome', g.nome, 'min', g.min_scelte, 'max', g.max_scelte,
                                     'scelte', coalesce((
                                       select jsonb_agg(jsonb_build_object('nome', o.nome, 'sovrapprezzo_cent', o.sovrapprezzo_cent)
                                                        order by o.posizione, o.nome)
                                       from public.opzioni o where o.gruppo_id = g.id and o.disponibile), '[]'::jsonb))
                                   order by g.posizione, g.nome)
                            from public.gruppi_opzioni g where g.prodotto_id = p.id), '[]'::jsonb))
                        order by p.posizione, p.nome)
                 from public.prodotti p where p.categoria_id = c.id and p.visibile))
             order by c.posizione, c.nome)
      from public.categorie c
      where c.locale_id = l.id and c.visibile
        and exists (select 1 from public.prodotti p where p.categoria_id = c.id and p.visibile)), '[]'::jsonb)
  )
  from public.locali l
  left join public.aspetto a on a.locale_id = l.id
  where l.slug = lower(p_slug) and l.attivo;
$$;

-- ============================================================
-- Privilegi
-- ============================================================
revoke all on public.categorie, public.prodotti, public.gruppi_opzioni, public.opzioni, public.aspetto from anon;
revoke insert, delete on public.aspetto from authenticated;

revoke execute on function public.imposta_disponibilita(uuid, boolean) from public, anon;
grant  execute on function public.imposta_disponibilita(uuid, boolean) to authenticated;
revoke execute on function public.varia_prezzi(uuid, numeric, uuid, int) from public, anon;
grant  execute on function public.varia_prezzi(uuid, numeric, uuid, int) to authenticated;
revoke execute on function public.menu_pubblico(text) from public;
grant  execute on function public.menu_pubblico(text) to anon, authenticated;
revoke execute on function public.crea_aspetto_locale() from public, anon, authenticated;

-- ============================================================
-- Realtime per backoffice e tablet (se la pubblicazione esiste)
-- ============================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.categorie, public.prodotti, public.aspetto;
  end if;
end $$;
