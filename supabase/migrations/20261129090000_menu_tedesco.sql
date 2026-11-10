-- Menu in tedesco, sulla stessa logica dell'inglese e dello spagnolo: colonne tedesche su categorie, prodotti e schede
-- dei vini, stato della traduzione automatica a parte (traduzione_de_da: impronta dell'italiano, «manuale», «…:scartata»)
-- e menu pubblico che le espone (pagina <slug>/de/). Dove manca la traduzione la pagina mostra l'italiano.

alter table public.categorie
  add column nome_de text not null default '' check (char_length(nome_de) <= 80),
  add column descrizione_de text not null default '' check (char_length(descrizione_de) <= 500),
  add column traduzione_de_da text not null default '' check (char_length(traduzione_de_da) <= 80);
alter table public.prodotti
  add column nome_de text not null default '' check (char_length(nome_de) <= 120),
  add column descrizione_de text not null default '' check (char_length(descrizione_de) <= 1000),
  add column traduzione_de_da text not null default '' check (char_length(traduzione_de_da) <= 80);
alter table public.vini
  add column note_de text not null default '' check (char_length(note_de) <= 600),
  add column traduzione_de_da text not null default '' check (char_length(traduzione_de_da) <= 80);

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
               'nome_es', c.nome_es, 'descrizione_es', c.descrizione_es, 'nome_de', c.nome_de, 'descrizione_de', c.descrizione_de,
               'aggiunte', coalesce((
                 select jsonb_agg(jsonb_build_object('id', ag.id, 'nome', ag.nome, 'gruppo', ag.gruppo, 'sovrapprezzo_cent', ag.prezzo_cent)
                                  order by ag.gruppo, ag.posizione, ag.nome)
                 from public.aggiunte ag
                 where ag.locale_id = l.id and ag.disponibile and public.aggiunta_vale(ag.id, c.id)), '[]'::jsonb),
               'prodotti', (
                 select jsonb_agg(jsonb_build_object(
                          'id', p.id, 'nome', p.nome, 'descrizione', p.descrizione, 'nome_en', p.nome_en, 'descrizione_en', p.descrizione_en,
                          'nome_es', p.nome_es, 'descrizione_es', p.descrizione_es, 'nome_de', p.nome_de, 'descrizione_de', p.descrizione_de,
                          'prezzo_cent', p.prezzo_cent, 'disponibile', p.disponibile,
                          'allergeni', p.allergeni, 'etichette', p.etichette, 'immagine_url', p.immagine_url,
                          'foto', (select floor(extract(epoch from f.aggiornata_at))::bigint
                                   from public.foto_prodotti f where f.prodotto_id = p.id),
                          'foto_path', (select f.path from public.foto_prodotti f where f.prodotto_id = p.id),
                          'vino', (select jsonb_build_object('tipo', v.tipo, 'corpo', v.corpo, 'regione', v.regione,
                                          'vitigno', v.vitigno, 'cantina', v.cantina, 'annata', v.annata, 'note', v.note, 'note_en', v.note_en, 'note_es', v.note_es, 'note_de', v.note_de,
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
                                     -- Voci del gruppo, poi (gruppo collegato) le aggiunte dello stesso gruppo, comprese nel prezzo:
                                     -- id «gruppo:aggiunta», così la stessa aggiunta resta ordinabile anche a pagamento
                                     'scelte', coalesce((
                                       select jsonb_agg(s.voce order by s.k, s.pos, s.nome)
                                       from (select 0 as k, o.posizione as pos, o.nome,
                                                    jsonb_build_object('id', o.id, 'nome', o.nome, 'sovrapprezzo_cent', o.sovrapprezzo_cent) as voce
                                               from public.opzioni o where o.gruppo_id = g.id and o.disponibile
                                             union all
                                             select 1, ag.posizione, ag.nome,
                                                    jsonb_build_object('id', g.id::text || ':' || ag.id::text, 'nome', ag.nome, 'sovrapprezzo_cent', ag.prezzo_cent)
                                               from public.aggiunte ag
                                              where ag.locale_id = l.id and ag.disponibile
                                                and lower(ag.gruppo) = lower(public.gruppo_aggiunte_collegato(g.id)) and public.aggiunta_vale(ag.id, c.id)) s), '[]'::jsonb))
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
