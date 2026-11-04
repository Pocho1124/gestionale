-- Piatti componibili (es. tagliere personalizzato): il cliente sceglie le voci di ogni gruppo
-- (es. 3 salumi e 3 formaggi), ognuna con il suo prezzo. Il prezzo lo calcola sempre il database.

-- Scelte salvate nella riga dell'ordine (copia: i cambi di listino non toccano gli ordini)
alter table public.righe_ordine add column opzioni jsonb not null default '[]'::jsonb
  check (jsonb_typeof(opzioni) = 'array' and jsonb_array_length(opzioni) <= 40);

-- Ogni voce può scaricare il magazzino (es. Prosciutto crudo → 0,05 kg)
create table public.componenti_opzioni (
  opzione_id  uuid not null references public.opzioni (id) on delete cascade,
  articolo_id uuid not null,
  locale_id   uuid not null,
  quantita    numeric(12,3) not null check (quantita > 0),
  primary key (opzione_id, articolo_id),
  foreign key (articolo_id, locale_id) references public.articoli (id, locale_id) on delete cascade
);
alter table public.componenti_opzioni enable row level security;
create policy comp_opz_select on public.componenti_opzioni for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
create policy comp_opz_write on public.componenti_opzioni for all to authenticated using (public.puo(locale_id, 'magazzino')) with check (public.puo(locale_id, 'magazzino'));
revoke all on public.componenti_opzioni from anon;

-- Valida le scelte di una riga e calcola il prezzo unitario: base del prodotto + somma delle voci scelte
create or replace function public.prezzo_riga(p_locale uuid, p_prodotto uuid, p_scelte jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_base int; v_tot int; v_snap jsonb; g record; v_n int; v_ids uuid[];
begin
  select prezzo_cent into v_base from public.prodotti where id = p_prodotto and locale_id = p_locale and visibile and disponibile;
  if v_base is null then raise exception 'Un piatto non è più disponibile: aggiorna il menu' using errcode = '22023'; end if;
  if p_scelte is not null and jsonb_typeof(p_scelte) <> 'array' then raise exception 'Scelte non valide' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct v::uuid), '{}') into v_ids
    from jsonb_array_elements_text(coalesce(p_scelte, '[]'::jsonb)) v where v ~ '^[0-9a-f-]{36}$';
  if cardinality(v_ids) <> jsonb_array_length(coalesce(p_scelte, '[]'::jsonb)) then raise exception 'Scelte non valide o ripetute' using errcode = '22023'; end if;
  -- Ogni voce deve appartenere a un gruppo di questo prodotto ed essere disponibile
  if exists (select 1 from unnest(v_ids) i where not exists (
       select 1 from public.opzioni o join public.gruppi_opzioni gr on gr.id = o.gruppo_id
       where o.id = i and gr.prodotto_id = p_prodotto and o.disponibile)) then
    raise exception 'Una scelta non è più disponibile: aggiorna il menu' using errcode = '22023';
  end if;
  -- Numero di scelte per gruppo entro minimo e massimo
  for g in select * from public.gruppi_opzioni where prodotto_id = p_prodotto loop
    select count(*) into v_n from public.opzioni o where o.gruppo_id = g.id and o.id = any (v_ids);
    if v_n < g.min_scelte or v_n > g.max_scelte then
      raise exception '«%»: scegli da % a % voci', g.nome, g.min_scelte, g.max_scelte using errcode = '22023';
    end if;
  end loop;
  select coalesce(sum(o.sovrapprezzo_cent), 0), coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'gruppo', gr.nome, 'nome', o.nome, 'sovrapprezzo_cent', o.sovrapprezzo_cent)
                                                                   order by gr.posizione, o.posizione, o.nome), '[]'::jsonb)
    into v_tot, v_snap
    from public.opzioni o join public.gruppi_opzioni gr on gr.id = o.gruppo_id where o.id = any (v_ids);
  return jsonb_build_object('prezzo_cent', v_base + v_tot, 'opzioni', v_snap);
end $$;

create or replace function public.crea_ordine_interno(p_locale uuid, p_sessione uuid, p_tavolo uuid, p_righe jsonb,
                                                     p_nota text, p_origine text, p_stato text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ord uuid; r jsonb; v_prod public.prodotti; v_q int; v_rep uuid; v_prezzo jsonb;
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
    select coalesce(v_prod.reparto_id, c.reparto_id) into v_rep from public.categorie c where c.id = v_prod.categoria_id;
    insert into public.righe_ordine (ordine_id, locale_id, prodotto_id, nome, prezzo_cent, quantita, nota, reparto_id, opzioni)
    values (v_ord, p_locale, v_prod.id, v_prod.nome, (v_prezzo->>'prezzo_cent')::int, v_q, left(coalesce(r->>'nota', ''), 120), v_rep, v_prezzo->'opzioni');
  end loop;
  if p_stato = 'confermato' then perform public.ordine_confermato(v_ord); end if;
  return v_ord;
end $$;

-- Richiesta dal telefono a tavolo chiuso: stesse verifiche, con risposta leggibile invece di un errore
create or replace function public.richiedi_tavolo(p_token text, p_segreto text, p_righe jsonb, p_nota text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tav public.tavoli; v_id uuid; r jsonb;
begin
  select * into v_tav from public.tavoli where qr_token = p_token and attivo;
  if v_tav.id is null then return jsonb_build_object('errore', 'Tavolo non valido: inquadra di nuovo il QR'); end if;
  if coalesce(length(p_segreto), 0) < 16 then return jsonb_build_object('errore', 'Richiesta non valida'); end if;
  if jsonb_typeof(p_righe) is distinct from 'array' or jsonb_array_length(p_righe) not between 1 and 30 then
    return jsonb_build_object('errore', 'Ordine vuoto o troppo lungo');
  end if;
  begin
    for r in select * from jsonb_array_elements(p_righe) loop
      if coalesce(r->>'quantita', '') !~ '^([1-9]|1[0-9]|20)$' or coalesce(r->>'prodotto_id', '') !~ '^[0-9a-f-]{36}$' then
        return jsonb_build_object('errore', 'Quantità non valida');
      end if;
      perform public.prezzo_riga(v_tav.locale_id, (r->>'prodotto_id')::uuid, r->'opzioni');
    end loop;
  exception when sqlstate '22023' then return jsonb_build_object('errore', sqlerrm);
  end;
  if (select count(*) from public.richieste_tavolo where tavolo_id = v_tav.id and stato = 'in_attesa' and creato_at > now() - interval '15 minutes') >= 3 then
    return jsonb_build_object('errore', 'Ci sono già richieste in attesa per questo tavolo: il personale arriva subito');
  end if;
  insert into public.richieste_tavolo (locale_id, tavolo_id, segreto_hash, righe, nota)
  values (v_tav.locale_id, v_tav.id, encode(extensions.digest(p_segreto, 'sha256'), 'hex'), p_righe, left(coalesce(p_nota, ''), 200))
  returning id into v_id;
  return jsonb_build_object('richiesta', v_id, 'stato', 'in_attesa');
end $$;

-- Scarico del magazzino: anche le voci scelte
create or replace function public.ordine_confermato(p_ordine uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.movimenti where ordine_id = p_ordine and tipo = 'vendita') then return; end if;   -- una sola volta
  insert into public.movimenti (locale_id, articolo_id, tipo, quantita, ordine_id, nota)
  select r.locale_id, c.articolo_id, 'vendita', -sum(c.quantita * r.quantita), p_ordine, 'Vendita'
  from public.righe_ordine r join public.componenti c on c.prodotto_id = r.prodotto_id
  where r.ordine_id = p_ordine group by r.locale_id, c.articolo_id
  union all
  select r.locale_id, co.articolo_id, 'vendita', -sum(co.quantita * r.quantita), p_ordine, 'Vendita (scelte)'
  from public.righe_ordine r cross join lateral jsonb_array_elements(r.opzioni) x
  join public.componenti_opzioni co on co.opzione_id::text = x ->> 'id'
  where r.ordine_id = p_ordine group by r.locale_id, co.articolo_id;
  perform public.accoda_stampa(p_ordine, 'comanda');
end $$;

create or replace function public.ordini_tavolo(p_token text, p_codice text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb := public.verifica_tavolo(p_token, p_codice);
begin
  if v ? 'errore' then return v; end if;
  return jsonb_build_object(
    'conto', (select stato from public.richieste_conto where sessione_id = (v->>'sessione_id')::uuid order by creato_at desc limit 1),
    'ordini', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'stato', o.stato, 'motivo', o.motivo, 'creato_at', o.creato_at,
               'righe', (select jsonb_agg(jsonb_build_object('nome', r.nome, 'quantita', r.quantita, 'prezzo_cent', r.prezzo_cent, 'nota', r.nota,
                                                         'opzioni', (select coalesce(jsonb_agg(x ->> 'nome'), '[]'::jsonb) from jsonb_array_elements(r.opzioni) x)))
                         from public.righe_ordine r where r.ordine_id = o.id)) order by o.creato_at desc)
      from public.ordini o where o.sessione_id = (v->>'sessione_id')::uuid), '[]'::jsonb));
end $$;

revoke execute on function public.prezzo_riga(uuid, uuid, jsonb) from public, anon, authenticated;

-- Menu pubblico: identificativi di gruppi e voci, per poter scegliere dal telefono
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
               'prodotti', (
                 select jsonb_agg(jsonb_build_object(
                          'id', p.id, 'nome', p.nome, 'descrizione', p.descrizione,
                          'prezzo_cent', p.prezzo_cent, 'disponibile', p.disponibile,
                          'allergeni', p.allergeni, 'etichette', p.etichette, 'immagine_url', p.immagine_url,
                          -- Versione della foto (null se assente): la foto si scarica a parte, solo quando serve
                          'foto', (select floor(extract(epoch from f.aggiornata_at))::bigint
                                   from public.foto_prodotti f where f.prodotto_id = p.id),
                          'foto_path', (select f.path from public.foto_prodotti f where f.prodotto_id = p.id),
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
