-- Gruppo delle aggiunte (es. «Salumi», «Formaggi»): nella scelta al tavolo e dal tablet le aggiunte compaiono divise
-- per gruppo. Vuoto = aggiunte generiche. Il prezzo resta calcolato da prezzo_riga() come prima (per id dell'aggiunta).

alter table public.aggiunte
  add column gruppo text not null default '' check (char_length(gruppo) <= 40 and gruppo = btrim(gruppo));

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
               'id', c.id, 'nome', c.nome, 'descrizione', c.descrizione, 'nome_en', c.nome_en, 'descrizione_en', c.descrizione_en,
               'nome_es', c.nome_es, 'descrizione_es', c.descrizione_es,
               'aggiunte', coalesce((
                 select jsonb_agg(jsonb_build_object('id', ag.id, 'nome', ag.nome, 'gruppo', ag.gruppo, 'sovrapprezzo_cent', ag.prezzo_cent)
                                  order by ag.gruppo, ag.posizione, ag.nome)
                 from public.aggiunte ag
                 where ag.locale_id = l.id and ag.disponibile and public.aggiunta_vale(ag.id, c.id)), '[]'::jsonb),
               'prodotti', (
                 select jsonb_agg(jsonb_build_object(
                          'id', p.id, 'nome', p.nome, 'descrizione', p.descrizione, 'nome_en', p.nome_en, 'descrizione_en', p.descrizione_en,
                          'nome_es', p.nome_es, 'descrizione_es', p.descrizione_es,
                          'prezzo_cent', p.prezzo_cent, 'disponibile', p.disponibile,
                          'allergeni', p.allergeni, 'etichette', p.etichette, 'immagine_url', p.immagine_url,
                          'foto', (select floor(extract(epoch from f.aggiornata_at))::bigint
                                   from public.foto_prodotti f where f.prodotto_id = p.id),
                          'foto_path', (select f.path from public.foto_prodotti f where f.prodotto_id = p.id),
                          'vino', (select jsonb_build_object('tipo', v.tipo, 'corpo', v.corpo, 'regione', v.regione,
                                          'vitigno', v.vitigno, 'cantina', v.cantina, 'annata', v.annata, 'note', v.note, 'note_en', v.note_en, 'note_es', v.note_es,
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
