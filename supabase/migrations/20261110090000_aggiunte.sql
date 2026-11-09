-- Aggiunte (es. «Mozzarella di bufala» + 2 €, «Doppio formaggio» + 1,50 €): elenco unico del locale,
-- ognuna attiva sulle categorie scelte (es. Pizze e Panini). Dal tablet e dal telefono si aggiungono al piatto;
-- il prezzo lo calcola sempre il database e le aggiunte finiscono nella copia delle scelte della riga
-- (comanda, conto, cassa e pagina del tavolo le mostrano senza altre modifiche).

-- ============================================================ Tabelle
create table public.aggiunte (
  id          uuid primary key default gen_random_uuid(),
  locale_id   uuid not null references public.locali (id) on delete cascade,
  nome        text not null check (char_length(btrim(nome)) between 1 and 60),
  prezzo_cent int  not null default 0 check (prezzo_cent between 0 and 100000),
  disponibile boolean not null default true,
  posizione   int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, locale_id)
);
create index on public.aggiunte (locale_id, posizione);
create unique index aggiunte_nome_unico on public.aggiunte (locale_id, lower(btrim(nome)));

-- Su quali categorie vale ogni aggiunta (stesso locale garantito dalle chiavi composte)
create table public.aggiunte_categorie (
  aggiunta_id  uuid not null,
  categoria_id uuid not null,
  locale_id    uuid not null,
  primary key (aggiunta_id, categoria_id),
  foreign key (aggiunta_id, locale_id)  references public.aggiunte (id, locale_id) on delete cascade,
  foreign key (categoria_id, locale_id) references public.categorie (id, locale_id) on delete cascade
);
create index on public.aggiunte_categorie (categoria_id);

create trigger aggiunte_updated_at before update on public.aggiunte for each row execute function public.set_updated_at();
create trigger aggiunte_audit after insert or update or delete on public.aggiunte for each row execute function public.scrivi_audit();

-- ============================================================ RLS: lettura al personale, scrittura con «catalogo»
alter table public.aggiunte enable row level security;
alter table public.aggiunte_categorie enable row level security;
create policy aggiunte_select on public.aggiunte for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
create policy aggiunte_write on public.aggiunte for all to authenticated
  using (public.puo(locale_id, 'catalogo')) with check (public.puo(locale_id, 'catalogo'));
create policy aggiunte_cat_select on public.aggiunte_categorie for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
create policy aggiunte_cat_write on public.aggiunte_categorie for all to authenticated
  using (public.puo(locale_id, 'catalogo')) with check (public.puo(locale_id, 'catalogo'));
revoke all on public.aggiunte, public.aggiunte_categorie from anon;
revoke truncate on public.aggiunte, public.aggiunte_categorie from authenticated;

-- ============================================================ Prezzo della riga: scelte del piatto + aggiunte
create or replace function public.prezzo_riga(p_locale uuid, p_prodotto uuid, p_scelte jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_base int; v_cat uuid; v_tot int; v_snap jsonb; g record; v_n int; v_ids uuid[]; v_agg uuid[];
begin
  select prezzo_cent, categoria_id into v_base, v_cat from public.prodotti
   where id = p_prodotto and locale_id = p_locale and visibile and disponibile;
  if v_base is null then raise exception 'Un piatto non è più disponibile: aggiorna il menu' using errcode = '22023'; end if;
  if p_scelte is not null and jsonb_typeof(p_scelte) <> 'array' then raise exception 'Scelte non valide' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct v::uuid), '{}') into v_ids
    from jsonb_array_elements_text(coalesce(p_scelte, '[]'::jsonb)) v where v ~ '^[0-9a-f-]{36}$';
  if cardinality(v_ids) <> jsonb_array_length(coalesce(p_scelte, '[]'::jsonb)) then raise exception 'Scelte non valide o ripetute' using errcode = '22023'; end if;
  -- Aggiunte: disponibili e attive sulla categoria del piatto
  select coalesce(array_agg(a.id), '{}') into v_agg
    from public.aggiunte a join public.aggiunte_categorie ac on ac.aggiunta_id = a.id
   where a.id = any (v_ids) and a.locale_id = p_locale and a.disponibile and ac.categoria_id = v_cat;
  if cardinality(v_agg) > 10 then raise exception 'Al massimo 10 aggiunte per piatto' using errcode = '22023'; end if;
  -- Le altre voci devono appartenere a un gruppo di questo prodotto ed essere disponibili
  if exists (select 1 from unnest(v_ids) i where i <> all (v_agg) and not exists (
       select 1 from public.opzioni o join public.gruppi_opzioni gr on gr.id = o.gruppo_id
       where o.id = i and gr.prodotto_id = p_prodotto and o.disponibile)) then
    raise exception 'Una scelta non è più disponibile: aggiorna il menu' using errcode = '22023';
  end if;
  -- Numero di scelte per gruppo entro minimo e massimo (le aggiunte sono sempre facoltative)
  for g in select * from public.gruppi_opzioni where prodotto_id = p_prodotto loop
    select count(*) into v_n from public.opzioni o where o.gruppo_id = g.id and o.id = any (v_ids);
    if v_n < g.min_scelte or v_n > g.max_scelte then
      raise exception '«%»: scegli da % a % voci', g.nome, g.min_scelte, g.max_scelte using errcode = '22023';
    end if;
  end loop;
  select coalesce(sum(x.prezzo), 0), coalesce(jsonb_agg(x.voce order by x.k, x.p1, x.p2, x.nome), '[]'::jsonb)
    into v_tot, v_snap
    from (select o.sovrapprezzo_cent as prezzo, 0 as k, gr.posizione as p1, o.posizione as p2, o.nome,
                 jsonb_build_object('id', o.id, 'gruppo', gr.nome, 'nome', o.nome, 'sovrapprezzo_cent', o.sovrapprezzo_cent) as voce
            from public.opzioni o join public.gruppi_opzioni gr on gr.id = o.gruppo_id where o.id = any (v_ids) and o.id <> all (v_agg)
          union all
          select a.prezzo_cent, 1, a.posizione, 0, a.nome,
                 jsonb_build_object('id', a.id, 'gruppo', 'Aggiunte', 'nome', '+ ' || a.nome, 'sovrapprezzo_cent', a.prezzo_cent)
            from public.aggiunte a where a.id = any (v_agg)) x;
  return jsonb_build_object('prezzo_cent', v_base + v_tot, 'opzioni', v_snap);
end $$;
revoke execute on function public.prezzo_riga(uuid, uuid, jsonb) from public, anon, authenticated;

-- ============================================================ Menu pubblico: aggiunte disponibili per categoria
create or replace function public.menu_pubblico(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'locale',  jsonb_build_object('nome', l.nome, 'indirizzo', l.indirizzo),
    -- Immagini: indirizzo nell'archivio; il base64 solo per le immagini non ancora migrate
    'aspetto', (to_jsonb(a) - 'locale_id' - 'logo_dati' - 'sfondo_dati')
               || jsonb_build_object('logo_dati', case when a.logo_path is null then a.logo_dati end,
                                     'sfondo_dati', case when a.sfondo_path is null then a.sfondo_dati end),
    'categorie', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'nome', c.nome, 'descrizione', c.descrizione,
               'aggiunte', coalesce((
                 select jsonb_agg(jsonb_build_object('id', ag.id, 'nome', ag.nome, 'sovrapprezzo_cent', ag.prezzo_cent)
                                  order by ag.posizione, ag.nome)
                 from public.aggiunte ag join public.aggiunte_categorie ac on ac.aggiunta_id = ag.id
                 where ac.categoria_id = c.id and ag.disponibile), '[]'::jsonb),
               'prodotti', (
                 select jsonb_agg(jsonb_build_object(
                          'id', p.id, 'nome', p.nome, 'descrizione', p.descrizione,
                          'prezzo_cent', p.prezzo_cent, 'disponibile', p.disponibile,
                          'allergeni', p.allergeni, 'etichette', p.etichette, 'immagine_url', p.immagine_url,
                          'foto', (select floor(extract(epoch from f.aggiornata_at))::bigint
                                   from public.foto_prodotti f where f.prodotto_id = p.id),
                          'foto_path', (select f.path from public.foto_prodotti f where f.prodotto_id = p.id),
                          'vino', (select jsonb_build_object('tipo', v.tipo, 'corpo', v.corpo, 'regione', v.regione,
                                          'vitigno', v.vitigno, 'cantina', v.cantina, 'annata', v.annata, 'note', v.note,
                                          'prezzo_bottiglia_cent', v.prezzo_bottiglia_cent)
                                   from public.vini v where v.prodotto_id = p.id),
                          'abbinamenti', coalesce((
                            select jsonb_agg(jsonb_build_object('id', x.altro, 'motivo', x.motivo))
                            from (select a.vino_id as altro, a.motivo from public.abbinamenti a
                                    join public.prodotti q on q.id = a.vino_id where a.piatto_id = p.id and q.visibile
                                  union all
                                  select a.piatto_id, a.motivo from public.abbinamenti a
                                    join public.prodotti q on q.id = a.piatto_id where a.vino_id = p.id and q.visibile) x), '[]'::jsonb),
                          'opzioni', coalesce((
                            select jsonb_agg(jsonb_build_object(
                                     'id', g.id, 'nome', g.nome, 'min', g.min_scelte, 'max', g.max_scelte,
                                     'scelte', coalesce((
                                       select jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome, 'sovrapprezzo_cent', o.sovrapprezzo_cent)
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
