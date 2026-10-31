-- Sommelier digitale: scheda dei vini e abbinamenti piatto-vino (usati anche dal quiz «Trova il tuo vino»).

-- Un prodotto è un vino se ha la sua scheda: il prezzo del prodotto è quello al calice
create table public.vini (
  prodotto_id           uuid primary key,
  locale_id             uuid not null,
  tipo                  text not null check (tipo in ('rosso', 'bianco', 'rosato', 'bollicine', 'dolce')),
  corpo                 text not null default 'medio' check (corpo in ('leggero', 'medio', 'strutturato')),
  regione               text not null default '' check (char_length(regione) <= 60),
  vitigno               text not null default '' check (char_length(vitigno) <= 80),
  cantina               text not null default '' check (char_length(cantina) <= 80),
  annata                int  check (annata between 1900 and 2100),
  note                  text not null default '' check (char_length(note) <= 300),
  prezzo_bottiglia_cent int  check (prezzo_bottiglia_cent between 0 and 10000000),
  updated_at            timestamptz not null default now(),
  unique (prodotto_id, locale_id),
  foreign key (prodotto_id, locale_id) references public.prodotti (id, locale_id) on delete cascade
);

-- Abbinamento: il vino deve avere la scheda (togliendola spariscono anche i suoi abbinamenti)
create table public.abbinamenti (
  locale_id uuid not null,
  piatto_id uuid not null,
  vino_id   uuid not null,
  motivo    text not null default '' check (char_length(motivo) <= 200),
  created_at timestamptz not null default now(),
  primary key (piatto_id, vino_id),
  check (piatto_id <> vino_id),
  foreign key (piatto_id, locale_id) references public.prodotti (id, locale_id) on delete cascade,
  foreign key (vino_id, locale_id) references public.vini (prodotto_id, locale_id) on delete cascade
);
create index on public.abbinamenti (vino_id);
create index on public.abbinamenti (locale_id);

create trigger vini_updated_at before update on public.vini for each row execute function public.set_updated_at();
create trigger vini_audit after insert or update or delete on public.vini for each row execute function public.scrivi_audit();
create trigger abbinamenti_audit after insert or update or delete on public.abbinamenti for each row execute function public.scrivi_audit();

alter table public.vini        enable row level security;
alter table public.abbinamenti enable row level security;
create policy vini_select on public.vini for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
create policy vini_write on public.vini for all to authenticated
  using (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]))
  with check (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]));
create policy abbinamenti_select on public.abbinamenti for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
create policy abbinamenti_write on public.abbinamenti for all to authenticated
  using (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]))
  with check (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]));
revoke all on public.vini, public.abbinamenti from anon;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.vini, public.abbinamenti;
  end if;
end $$;

-- Menu pubblico: aggiunge scheda del vino e abbinamenti
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
                          -- Versione della foto (null se assente): la foto si scarica a parte, solo quando serve
                          'foto', (select floor(extract(epoch from f.aggiornata_at))::bigint
                                   from public.foto_prodotti f where f.prodotto_id = p.id),
                          -- Scheda del vino (null se il prodotto non è un vino)
                          'vino', (select jsonb_build_object('tipo', v.tipo, 'corpo', v.corpo, 'regione', v.regione,
                                          'vitigno', v.vitigno, 'cantina', v.cantina, 'annata', v.annata, 'note', v.note,
                                          'prezzo_bottiglia_cent', v.prezzo_bottiglia_cent)
                                   from public.vini v where v.prodotto_id = p.id),
                          -- Abbinamenti in entrambe le direzioni, solo verso prodotti visibili
                          'abbinamenti', coalesce((
                            select jsonb_agg(jsonb_build_object('id', x.altro, 'motivo', x.motivo))
                            from (select a.vino_id as altro, a.motivo from public.abbinamenti a
                                    join public.prodotti q on q.id = a.vino_id where a.piatto_id = p.id and q.visibile
                                  union all
                                  select a.piatto_id, a.motivo from public.abbinamenti a
                                    join public.prodotti q on q.id = a.piatto_id where a.vino_id = p.id and q.visibile) x), '[]'::jsonb),
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
