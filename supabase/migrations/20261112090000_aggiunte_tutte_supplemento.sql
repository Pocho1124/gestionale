-- Aggiunte senza categorie scelte = valide su tutte le categorie (prima non comparivano da nessuna parte).
-- Supplemento in euro sulla nota di una riga (es. «doppia mozzarella» + 2 €), accettato solo dalle comande del personale.

-- ============================================================ Su quali piatti vale un'aggiunta
create or replace function public.aggiunta_vale(p_aggiunta uuid, p_categoria uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.aggiunte_categorie where aggiunta_id = p_aggiunta and categoria_id = p_categoria)
      or not exists (select 1 from public.aggiunte_categorie where aggiunta_id = p_aggiunta);
$$;
revoke execute on function public.aggiunta_vale(uuid, uuid) from public, anon, authenticated;

-- ============================================================ Prezzo della riga
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
  -- Aggiunte: disponibili e attive sulla categoria del piatto (o su tutte)
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

-- ============================================================ Menu pubblico
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
                 from public.aggiunte ag
                 where ag.locale_id = l.id and ag.disponibile and public.aggiunta_vale(ag.id, c.id)), '[]'::jsonb),
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

-- ============================================================ Ordini: supplemento della nota
create or replace function public.crea_ordine_interno(p_locale uuid, p_sessione uuid, p_tavolo uuid, p_righe jsonb,
                                                     p_nota text, p_origine text, p_stato text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ord uuid; r jsonb; v_prod public.prodotti; v_q int; v_rep uuid; v_prezzo jsonb; v_extra int; v_opz jsonb;
begin
  if jsonb_typeof(p_righe) is distinct from 'array' or jsonb_array_length(p_righe) not between 1 and 30 then
    raise exception 'Ordine vuoto o troppo lungo' using errcode = '22023';
  end if;
  insert into public.ordini (locale_id, sessione_id, tavolo_id, origine, nota, stato, confermato_at, confermato_da)
  values (p_locale, p_sessione, p_tavolo, p_origine, left(coalesce(p_nota, ''), 200), p_stato,
          case when p_stato = 'confermato' then now() end, case when p_stato = 'confermato' then (select auth.uid()) end)
  returning id into v_ord;
  for r in select * from jsonb_array_elements(p_righe) loop
    select * into v_prod from public.prodotti where id::text = r->>'prodotto_id' and locale_id = p_locale and visibile and disponibile;
    v_q := case when (r->>'quantita') ~ '^[0-9]{1,2}$' then (r->>'quantita')::int else 0 end;
    if v_prod.id is null or v_q not between 1 and 20 then
      raise exception 'Un piatto non è più disponibile o la quantità non è valida: aggiorna il menu' using errcode = '22023';
    end if;
    v_prezzo := public.prezzo_riga(p_locale, v_prod.id, r->'opzioni');
    -- Supplemento della nota (es. «doppia mozzarella» + 2 €): solo dal personale, mai dal telefono del cliente
    v_extra := 0; v_opz := v_prezzo->'opzioni';
    if p_origine = 'sala' and coalesce(r->>'supplemento_cent', '') <> '' then
      if (r->>'supplemento_cent') !~ '^[0-9]{1,5}$' or (r->>'supplemento_cent')::int > 10000 then
        raise exception 'Supplemento non valido (da 0 a 100 €)' using errcode = '22023';
      end if;
      v_extra := (r->>'supplemento_cent')::int;
      if v_extra > 0 then
        v_opz := v_opz || jsonb_build_array(jsonb_build_object('id', null, 'gruppo', 'Supplemento', 'nome', '+ Supplemento', 'sovrapprezzo_cent', v_extra));
      end if;
    end if;
    select coalesce(v_prod.reparto_id, c.reparto_id) into v_rep from public.categorie c where c.id = v_prod.categoria_id;
    insert into public.righe_ordine (ordine_id, locale_id, prodotto_id, nome, prezzo_cent, quantita, nota, reparto_id, opzioni)
    values (v_ord, p_locale, v_prod.id, v_prod.nome, (v_prezzo->>'prezzo_cent')::int + v_extra, v_q, left(coalesce(r->>'nota', ''), 120), v_rep, v_opz);
  end loop;
  if p_stato = 'confermato' then perform public.ordine_confermato(v_ord); end if;
  return v_ord;
end $$;
revoke execute on function public.crea_ordine_interno(uuid, uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
