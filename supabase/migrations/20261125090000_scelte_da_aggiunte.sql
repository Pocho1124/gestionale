-- Gruppi del piatto collegati a un gruppo di aggiunte (es. tagliere: «Salumi» = le aggiunte del gruppo «Salumi»).
-- Le voci si leggono sempre dalle aggiunte (nessuna copia da tenere allineata): nel gruppo collegato sono comprese nel
-- prezzo; le stesse aggiunte restano ordinabili a pagamento come «Aggiunte · Salumi».
-- Le scelte di una riga ora sono: «id» (voce del gruppo o aggiunta a pagamento) oppure «gruppo:aggiunta» (aggiunta compresa).
-- Prezzo, disponibilità e numero di scelte li controlla sempre prezzo_riga().

alter table public.gruppi_opzioni
  add column da_aggiunte text check (da_aggiunte is null or char_length(btrim(da_aggiunte)) between 1 and 40);

create or replace function public.prezzo_riga(p_locale uuid, p_prodotto uuid, p_scelte jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_base int; v_cat uuid; v_tot int; v_snap jsonb; g record; v_n int; v_ids uuid[]; v_agg uuid[];
        v_tutte text[]; v_inc_g uuid[]; v_inc_a uuid[];
begin
  select prezzo_cent, categoria_id into v_base, v_cat from public.prodotti
   where id = p_prodotto and locale_id = p_locale and visibile and disponibile;
  if v_base is null then raise exception 'Un piatto non è più disponibile: aggiorna il menu' using errcode = '22023'; end if;
  if p_scelte is not null and jsonb_typeof(p_scelte) <> 'array' then raise exception 'Scelte non valide' using errcode = '22023'; end if;
  -- Elementi ammessi: «uuid» oppure «uuid:uuid»; niente ripetizioni
  select coalesce(array_agg(e #>> '{}'), '{}') into v_tutte from jsonb_array_elements(coalesce(p_scelte, '[]'::jsonb)) e
   where jsonb_typeof(e) = 'string' and (e #>> '{}') ~ '^[0-9a-f-]{36}(:[0-9a-f-]{36})?$';
  if cardinality(v_tutte) <> jsonb_array_length(coalesce(p_scelte, '[]'::jsonb))
     or cardinality(v_tutte) <> (select count(distinct x) from unnest(v_tutte) x) then
    raise exception 'Scelte non valide o ripetute' using errcode = '22023';
  end if;
  select coalesce(array_agg(x::uuid), '{}') into v_ids from unnest(v_tutte) x where position(':' in x) = 0;
  select coalesce(array_agg(split_part(x, ':', 1)::uuid order by x), '{}'), coalesce(array_agg(split_part(x, ':', 2)::uuid order by x), '{}')
    into v_inc_g, v_inc_a from unnest(v_tutte) x where position(':' in x) > 0;
  -- Aggiunte a pagamento: disponibili e attive sulla categoria del piatto (o su tutte)
  select coalesce(array_agg(a.id), '{}') into v_agg
    from public.aggiunte a
   where a.id = any (v_ids) and a.locale_id = p_locale and a.disponibile and public.aggiunta_vale(a.id, v_cat);
  if cardinality(v_agg) > 10 then raise exception 'Al massimo 10 aggiunte per piatto' using errcode = '22023'; end if;
  -- Le altre voci devono appartenere a un gruppo di questo prodotto ed essere disponibili
  if exists (select 1 from unnest(v_ids) i where i <> all (v_agg) and not exists (
       select 1 from public.opzioni o join public.gruppi_opzioni gr on gr.id = o.gruppo_id
       where o.id = i and gr.prodotto_id = p_prodotto and o.disponibile)) then
    raise exception 'Una scelta non è più disponibile: aggiorna il menu' using errcode = '22023';
  end if;
  -- Aggiunte comprese: il gruppo è di questo prodotto ed è collegato al gruppo dell'aggiunta, disponibile e attiva qui
  if exists (select 1 from unnest(v_inc_g, v_inc_a) as t(gid, aid) where not exists (
       select 1 from public.gruppi_opzioni gr join public.aggiunte a on a.locale_id = p_locale
        where gr.id = t.gid and gr.prodotto_id = p_prodotto and gr.da_aggiunte is not null and a.id = t.aid
          and a.disponibile and lower(a.gruppo) = lower(btrim(gr.da_aggiunte)) and public.aggiunta_vale(a.id, v_cat))) then
    raise exception 'Una scelta non è più disponibile: aggiorna il menu' using errcode = '22023';
  end if;
  -- Numero di scelte per gruppo entro minimo e massimo (voci del gruppo + aggiunte comprese; le aggiunte a pagamento sono facoltative)
  for g in select * from public.gruppi_opzioni where prodotto_id = p_prodotto loop
    select count(*) into v_n from public.opzioni o where o.gruppo_id = g.id and o.id = any (v_ids);
    v_n := v_n + (select count(*) from unnest(v_inc_g) x where x = g.id);
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
          select 0, 0, gr.posizione, 1000 + a.posizione, a.nome,
                 jsonb_build_object('id', a.id, 'gruppo', gr.nome, 'nome', a.nome, 'sovrapprezzo_cent', 0)
            from unnest(v_inc_g, v_inc_a) as t(gid, aid)
            join public.gruppi_opzioni gr on gr.id = t.gid join public.aggiunte a on a.id = t.aid
          union all
          select a.prezzo_cent, 1, a.posizione, 0, a.nome,
                 jsonb_build_object('id', a.id, 'gruppo', 'Aggiunte', 'nome', '+ ' || a.nome, 'sovrapprezzo_cent', a.prezzo_cent)
            from public.aggiunte a where a.id = any (v_agg)) x;
  return jsonb_build_object('prezzo_cent', v_base + v_tot, 'opzioni', v_snap);
end $$;
revoke execute on function public.prezzo_riga(uuid, uuid, jsonb) from public, anon, authenticated;

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
                                     -- Voci del gruppo, poi (gruppo collegato) le aggiunte dello stesso gruppo, comprese nel prezzo:
                                     -- id «gruppo:aggiunta», così la stessa aggiunta resta ordinabile anche a pagamento
                                     'scelte', coalesce((
                                       select jsonb_agg(s.voce order by s.k, s.pos, s.nome)
                                       from (select 0 as k, o.posizione as pos, o.nome,
                                                    jsonb_build_object('id', o.id, 'nome', o.nome, 'sovrapprezzo_cent', o.sovrapprezzo_cent) as voce
                                               from public.opzioni o where o.gruppo_id = g.id and o.disponibile
                                             union all
                                             select 1, ag.posizione, ag.nome,
                                                    jsonb_build_object('id', g.id::text || ':' || ag.id::text, 'nome', ag.nome, 'sovrapprezzo_cent', 0)
                                               from public.aggiunte ag
                                              where g.da_aggiunte is not null and ag.locale_id = l.id and ag.disponibile
                                                and lower(ag.gruppo) = lower(btrim(g.da_aggiunte)) and public.aggiunta_vale(ag.id, c.id)) s), '[]'::jsonb))
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
