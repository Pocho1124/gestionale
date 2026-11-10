-- Coperto a persona (fissato all'apertura del tavolo e modificabile dal personale), coperti modificabili,
-- tavolo spostato su un altro libero, due tavoli uniti in un solo conto. Totali sempre dal database.

-- ============================================================ Coperto
alter table public.impostazioni_tavolo add column coperto_cent int not null default 0 check (coperto_cent between 0 and 2000);
alter table public.sessioni_tavolo add column coperto_cent int not null default 0 check (coperto_cent between 0 and 2000);

create or replace function public.sessione_aperta_o_nuova(p_tavolo uuid, p_coperti int)
returns public.sessioni_tavolo language plpgsql security definer set search_path = '' as $$
declare v public.sessioni_tavolo; v_locale uuid;
begin
  select * into v from public.sessioni_tavolo where tavolo_id = p_tavolo and chiusa_at is null;
  if v.id is not null then return v; end if;
  select locale_id into v_locale from public.tavoli where id = p_tavolo and attivo;
  -- Il prezzo del coperto si fissa all'apertura: un cambio di listino non tocca i tavoli già aperti
  insert into public.sessioni_tavolo (locale_id, tavolo_id, coperti, coperto_cent, codice)
  values (v_locale, p_tavolo, greatest(1, least(coalesce(p_coperti, 2), 60)),
          coalesce((select coperto_cent from public.impostazioni_tavolo where locale_id = v_locale), 0),
          lpad((('x' || encode(extensions.gen_random_bytes(2), 'hex'))::bit(16)::int % 10000)::text, 4, '0'))
  returning * into v;
  return v;
end $$;

-- Totale del conto: ordini validi più il coperto
create or replace function public.totale_sessione(p_sessione uuid)
returns int language sql stable security definer set search_path = '' as $$
  select (coalesce((select sum(r.quantita * r.prezzo_cent)
                      from public.ordini o join public.righe_ordine r on r.ordine_id = o.id
                     where o.sessione_id = p_sessione and o.stato not in ('rifiutato', 'annullato')), 0)
          + (select s.coperti * s.coperto_cent from public.sessioni_tavolo s where s.id = p_sessione))::int;
$$;

-- Coperti del tavolo (es. arriva un altro amico)
create or replace function public.imposta_coperti(p_sessione uuid, p_coperti int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ses public.sessioni_tavolo;
begin
  select * into v_ses from public.sessioni_tavolo where id = p_sessione and chiusa_at is null for update;
  if v_ses.id is null or not public.puo(v_ses.locale_id, 'sala.apri') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if p_coperti is null or p_coperti not between 1 and 60 then raise exception 'Coperti da 1 a 60' using errcode = '22023'; end if;
  update public.sessioni_tavolo set coperti = p_coperti where id = p_sessione;
end $$;

-- Prezzo del coperto per questo tavolo (es. 0 per un ospite del locale): solo chi incassa
create or replace function public.imposta_coperto(p_sessione uuid, p_cent int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ses public.sessioni_tavolo := public.sessione_da_incassare(p_sessione);
begin
  if p_cent is null or p_cent not between 0 and 2000 then raise exception 'Coperto da 0 a 20 €' using errcode = '22023'; end if;
  if public.totale_sessione(p_sessione) - v_ses.coperti * v_ses.coperto_cent + v_ses.coperti * p_cent - v_ses.sconto_cent
     < (select coalesce(sum(importo_cent), 0) from public.pagamenti where sessione_id = p_sessione and stato in ('approvato', 'in_attesa')) then
    raise exception 'Il conto scenderebbe sotto quanto già pagato: annulla prima un pagamento' using errcode = '22023';
  end if;
  update public.sessioni_tavolo set coperto_cent = p_cent where id = p_sessione;
end $$;

-- Fattura: il coperto è una riga (IVA 10%)
create or replace function public.emetti_fattura(p_locale uuid, p_cliente jsonb, p_sessione uuid default null, p_righe jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_df public.dati_fiscali; v_ses public.sessioni_tavolo; v_righe jsonb := '[]'::jsonb; v_r jsonb; v_cli jsonb;
  v_den text; v_nome text; v_cogn text; v_piva text; v_cf text; v_ind text; v_cap text; v_com text; v_prov text; v_naz text; v_cod text; v_pec text;
  v_anno int := extract(year from current_date)::int; v_num int; v_mod text; v_riep jsonb; v_imp int; v_iva int; v_id uuid;
  a record; v_lordo int; v_resto int; v_quota int; v_n int; v_i int := 0;
begin
  if not public.puo(p_locale, 'cassa') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  select * into v_df from public.dati_fiscali where locale_id = p_locale;
  if v_df.locale_id is null then raise exception 'Compila prima i dati fiscali del locale' using errcode = '22023'; end if;
  if jsonb_typeof(p_cliente) is distinct from 'object' then raise exception 'Dati del cliente mancanti' using errcode = '22023'; end if;

  -- Cliente (cessionario/committente): testi ripuliti, codici in maiuscolo
  v_den  := btrim(coalesce(p_cliente->>'denominazione', ''));
  v_nome := btrim(coalesce(p_cliente->>'nome', ''));
  v_cogn := btrim(coalesce(p_cliente->>'cognome', ''));
  v_piva := upper(regexp_replace(coalesce(p_cliente->>'partita_iva', ''), '\s', '', 'g'));
  v_cf   := upper(regexp_replace(coalesce(p_cliente->>'codice_fiscale', ''), '\s', '', 'g'));
  v_ind  := btrim(coalesce(p_cliente->>'indirizzo', ''));
  v_cap  := btrim(coalesce(p_cliente->>'cap', ''));
  v_com  := btrim(coalesce(p_cliente->>'comune', ''));
  v_prov := upper(btrim(coalesce(p_cliente->>'provincia', '')));
  v_naz  := upper(coalesce(nullif(btrim(p_cliente->>'nazione'), ''), 'IT'));
  v_cod  := upper(coalesce(nullif(btrim(p_cliente->>'codice_destinatario'), ''), '0000000'));
  v_pec  := lower(btrim(coalesce(p_cliente->>'pec', '')));
  if v_den = '' and (v_nome = '' or v_cogn = '') then
    raise exception 'Indica la ragione sociale oppure nome e cognome del cliente' using errcode = '22023';
  end if;
  if greatest(char_length(v_den), char_length(v_nome), char_length(v_cogn), char_length(v_ind), char_length(v_com)) > 80 then
    raise exception 'Testo del cliente troppo lungo (massimo 80 caratteri)' using errcode = '22023';
  end if;
  if v_naz <> 'IT' then raise exception 'Per ora si emettono fatture solo a clienti con sede in Italia' using errcode = '22023'; end if;
  if v_piva = '' and v_cf = '' then raise exception 'Serve la partita IVA o il codice fiscale del cliente' using errcode = '22023'; end if;
  if v_piva <> '' and not public.partita_iva_valida(v_piva) then raise exception 'Partita IVA del cliente non valida' using errcode = '22023'; end if;
  if v_cf <> '' and v_cf !~ '^([0-9]{11}|[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z])$' then
    raise exception 'Codice fiscale del cliente non valido' using errcode = '22023';
  end if;
  if v_ind = '' or v_com = '' or v_cap !~ '^[0-9]{5}$' then
    raise exception 'Indirizzo, CAP (5 cifre) e comune del cliente sono obbligatori' using errcode = '22023';
  end if;
  if v_prov !~ '^([A-Z]{2})?$' then raise exception 'Provincia: sigla di due lettere' using errcode = '22023'; end if;
  if v_cod !~ '^[A-Z0-9]{7}$' then raise exception 'Codice destinatario: 7 lettere o cifre (0000000 se non c''è)' using errcode = '22023'; end if;
  if v_pec <> '' and (char_length(v_pec) > 100 or v_pec !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$') then
    raise exception 'Indirizzo PEC non valido' using errcode = '22023';
  end if;
  if v_den <> '' then v_nome := ''; v_cogn := ''; end if;
  v_cli := jsonb_build_object('denominazione', v_den, 'nome', v_nome, 'cognome', v_cogn, 'partita_iva', v_piva, 'codice_fiscale', v_cf,
                              'indirizzo', v_ind, 'cap', v_cap, 'comune', v_com, 'provincia', v_prov, 'nazione', v_naz,
                              'codice_destinatario', v_cod, 'pec', v_pec);

  if p_sessione is not null then
    -- Dal conto di un tavolo chiuso: righe uguali raggruppate, aliquota del prodotto, sconto ripartito per aliquota
    select * into v_ses from public.sessioni_tavolo where id = p_sessione and locale_id = p_locale;
    if v_ses.id is null then raise exception 'Conto non trovato' using errcode = '22023'; end if;
    if v_ses.chiusa_at is null then raise exception 'Chiudi il tavolo prima di emettere la fattura' using errcode = '22023'; end if;
    if exists (select 1 from public.fatture where sessione_id = p_sessione) then
      raise exception 'Per questo conto è già stata emessa una fattura' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('descrizione', d, 'quantita', q, 'prezzo_cent', p, 'aliquota', al) order by d, p), '[]'::jsonb) into v_righe
    from (select left(r.nome || coalesce(' (' || (select string_agg(x->>'nome', ', ') from jsonb_array_elements(r.opzioni) x) || ')', ''), 200) as d,
                 sum(r.quantita)::int as q, r.prezzo_cent as p, coalesce(pr.aliquota_iva, 10)::numeric as al
            from public.ordini o join public.righe_ordine r on r.ordine_id = o.id left join public.prodotti pr on pr.id = r.prodotto_id
           where o.sessione_id = p_sessione and o.stato not in ('rifiutato', 'annullato') and r.prezzo_cent > 0
           group by 1, 3, 4) x;
    if v_ses.coperto_cent > 0 then
      v_righe := v_righe || jsonb_build_object('descrizione', 'Coperto', 'quantita', v_ses.coperti, 'prezzo_cent', v_ses.coperto_cent, 'aliquota', 10);
    end if;
    if v_ses.sconto_cent > 0 and jsonb_array_length(v_righe) > 0 then
      select sum(t.quantita * t.prezzo_cent)::int, count(distinct t.aliquota) into v_lordo, v_n
        from jsonb_to_recordset(v_righe) as t(quantita int, prezzo_cent int, aliquota numeric);
      v_resto := least(v_ses.sconto_cent, v_lordo);
      for a in select t.aliquota, sum(t.quantita * t.prezzo_cent)::int as lordo
                 from jsonb_to_recordset(v_righe) as t(quantita int, prezzo_cent int, aliquota numeric) group by t.aliquota order by t.aliquota loop
        v_i := v_i + 1;
        v_quota := case when v_i = v_n then v_resto else least(v_resto, round(v_ses.sconto_cent::numeric * a.lordo / v_lordo)::int) end;
        v_resto := v_resto - v_quota;
        if v_quota > 0 then
          v_righe := v_righe || jsonb_build_object('descrizione', 'Sconto', 'quantita', 1, 'prezzo_cent', -v_quota, 'aliquota', a.aliquota);
        end if;
      end loop;
    end if;
    select case min(metodo) when 'contanti' then 'MP01' when 'carta' then 'MP08' end into v_mod
      from public.pagamenti where sessione_id = p_sessione and stato = 'approvato' having count(distinct metodo) = 1;
  else
    -- Righe scritte a mano
    if jsonb_typeof(p_righe) is distinct from 'array' or jsonb_array_length(p_righe) not between 1 and 100 then
      raise exception 'La fattura deve avere da 1 a 100 righe' using errcode = '22023';
    end if;
    for v_r in select * from jsonb_array_elements(p_righe) loop
      if btrim(coalesce(v_r->>'descrizione', '')) = '' or char_length(v_r->>'descrizione') > 200
         or coalesce(v_r->>'quantita', '') !~ '^[1-9][0-9]{0,2}$'
         or coalesce(v_r->>'prezzo_cent', '') !~ '^[0-9]{1,8}$' or (v_r->>'prezzo_cent')::int = 0
         or coalesce(v_r->>'aliquota', '') not in ('4', '5', '10', '22') then
        raise exception 'Riga non valida: descrizione, quantità (1-999), prezzo IVA inclusa e aliquota (4, 5, 10 o 22)' using errcode = '22023';
      end if;
      v_righe := v_righe || jsonb_build_object('descrizione', btrim(v_r->>'descrizione'), 'quantita', (v_r->>'quantita')::int,
                                               'prezzo_cent', (v_r->>'prezzo_cent')::int, 'aliquota', (v_r->>'aliquota')::numeric);
    end loop;
  end if;
  if jsonb_array_length(v_righe) = 0 then raise exception 'Il conto non ha importi da fatturare' using errcode = '22023'; end if;

  -- Scorporo IVA riga per riga (prezzo unitario netto con 8 decimali), poi riepilogo per aliquota
  select jsonb_agg(r || jsonb_build_object(
           'prezzo_unitario', round((r->>'prezzo_cent')::numeric / 100 / (1 + (r->>'aliquota')::numeric / 100), 8)::text,
           'totale_netto_cent', round((r->>'quantita')::numeric * (r->>'prezzo_cent')::numeric / (1 + (r->>'aliquota')::numeric / 100))::int)
         order by n)
    into v_righe from jsonb_array_elements(v_righe) with ordinality as e(r, n);
  select jsonb_agg(jsonb_build_object('aliquota', al, 'imponibile_cent', imp, 'imposta_cent', round(imp * al / 100)::int) order by al),
         sum(imp)::int, sum(round(imp * al / 100))::int
    into v_riep, v_imp, v_iva
    from (select (r->>'aliquota')::numeric as al, sum((r->>'totale_netto_cent')::int) as imp from jsonb_array_elements(v_righe) r group by 1) x;
  if v_imp + v_iva <= 0 then raise exception 'Il totale della fattura deve essere maggiore di zero' using errcode = '22023'; end if;

  -- Numerazione progressiva per anno, senza buchi né doppioni
  perform pg_advisory_xact_lock(hashtext('fatture:' || p_locale::text || ':' || v_anno));
  select coalesce(max(numero), 0) + 1 into v_num from public.fatture where locale_id = p_locale and anno = v_anno;
  insert into public.fatture (locale_id, anno, numero, sessione_id, cedente, cliente, righe, riepilogo, imponibile_cent, imposta_cent, totale_cent, modalita)
  values (p_locale, v_anno, v_num, p_sessione, to_jsonb(v_df) - 'locale_id' - 'updated_at', v_cli, v_righe, v_riep, v_imp, v_iva, v_imp + v_iva, v_mod)
  returning id into v_id;
  return (select to_jsonb(f) from public.fatture f where f.id = v_id);
end $$;

-- Pagina del tavolo: il cliente vede anche il coperto nel conto
create or replace function public.ordini_tavolo(p_token text, p_codice text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb := public.verifica_tavolo(p_token, p_codice);
begin
  if v ? 'errore' then return v; end if;
  return jsonb_build_object(
    'conto', (select stato from public.richieste_conto where sessione_id = (v->>'sessione_id')::uuid order by creato_at desc limit 1),
    'coperto', (select jsonb_build_object('coperti', s.coperti, 'prezzo_cent', s.coperto_cent) from public.sessioni_tavolo s
                where s.id = (v->>'sessione_id')::uuid and s.coperto_cent > 0),
    'ordini', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'stato', o.stato, 'motivo', o.motivo, 'creato_at', o.creato_at,
               'righe', (select jsonb_agg(jsonb_build_object('nome', r.nome, 'quantita', r.quantita, 'prezzo_cent', r.prezzo_cent, 'nota', r.nota,
                                                         'opzioni', (select coalesce(jsonb_agg(x ->> 'nome'), '[]'::jsonb) from jsonb_array_elements(r.opzioni) x)))
                         from public.righe_ordine r where r.ordine_id = o.id)) order by o.creato_at desc)
      from public.ordini o where o.sessione_id = (v->>'sessione_id')::uuid), '[]'::jsonb));
end $$;

-- ============================================================ Sposta e unisci tavoli
-- Il conto passa su un tavolo libero (stesso locale): ordini, codice e pagamenti restano gli stessi
create or replace function public.sposta_tavolo(p_da uuid, p_a uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_da public.tavoli; v_a public.tavoli; v_ses public.sessioni_tavolo;
begin
  select * into v_da from public.tavoli where id = p_da;
  select * into v_a from public.tavoli where id = p_a and attivo;
  if v_da.id is null or not public.puo(v_da.locale_id, 'sala.apri') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if v_a.id is null or v_a.locale_id <> v_da.locale_id or v_a.id = v_da.id then raise exception 'Tavolo di destinazione non valido' using errcode = '22023'; end if;
  select * into v_ses from public.sessioni_tavolo where tavolo_id = p_da and chiusa_at is null for update;
  if v_ses.id is null then raise exception 'Il tavolo non è aperto' using errcode = '22023'; end if;
  if exists (select 1 from public.sessioni_tavolo where tavolo_id = p_a and chiusa_at is null) then
    raise exception 'Il tavolo % è occupato: per metterli insieme usa «Unisci»', v_a.nome using errcode = '22023';
  end if;
  update public.sessioni_tavolo set tavolo_id = p_a where id = v_ses.id;
  update public.ordini set tavolo_id = p_a where sessione_id = v_ses.id;
end $$;

-- Due tavoli aperti diventano un solo conto (quello del primo): tutto passa al primo, il secondo si libera
create or replace function public.unisci_tavoli(p_principale uuid, p_altro uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t public.tavoli; v_p public.sessioni_tavolo; v_a public.sessioni_tavolo;
begin
  select * into v_t from public.tavoli where id = p_principale;
  if v_t.id is null or not public.puo(v_t.locale_id, 'sala.apri') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if p_principale = p_altro then raise exception 'Scegli due tavoli diversi' using errcode = '22023'; end if;
  -- Blocco dei due conti sempre nello stesso ordine: due unioni contemporanee non si bloccano a vicenda
  perform 1 from public.sessioni_tavolo where tavolo_id in (p_principale, p_altro) and chiusa_at is null order by id for update;
  select * into v_p from public.sessioni_tavolo where tavolo_id = p_principale and chiusa_at is null;
  select * into v_a from public.sessioni_tavolo where tavolo_id = p_altro and chiusa_at is null and locale_id = v_t.locale_id;
  if v_p.id is null or v_a.id is null then raise exception 'Entrambi i tavoli devono essere aperti' using errcode = '22023'; end if;
  if exists (select 1 from public.pagamenti where sessione_id in (v_p.id, v_a.id) and stato = 'in_attesa') then
    raise exception 'C''è un pagamento POS in attesa di esito' using errcode = '22023';
  end if;
  update public.ordini set sessione_id = v_p.id, tavolo_id = p_principale where sessione_id = v_a.id;
  update public.pagamenti set sessione_id = v_p.id where sessione_id = v_a.id;
  update public.richieste_conto set sessione_id = v_p.id where sessione_id = v_a.id;
  update public.richieste_tavolo set sessione_id = v_p.id where sessione_id = v_a.id;
  update public.nomi_clienti set sessione_id = v_p.id where sessione_id = v_a.id;
  update public.sessioni_tavolo set coperti = least(60, v_p.coperti + v_a.coperti), sconto_cent = v_p.sconto_cent + v_a.sconto_cent
   where id = v_p.id;
  -- Il secondo conto è vuoto: si elimina (niente conti fantasma nel resoconto di cassa)
  delete from public.sessioni_tavolo where id = v_a.id;
end $$;

revoke execute on function public.sessione_aperta_o_nuova(uuid, int), public.totale_sessione(uuid), public.imposta_coperti(uuid, int),
  public.imposta_coperto(uuid, int), public.emetti_fattura(uuid, jsonb, uuid, jsonb), public.sposta_tavolo(uuid, uuid),
  public.unisci_tavoli(uuid, uuid) from public, anon, authenticated;
grant execute on function public.imposta_coperti(uuid, int), public.imposta_coperto(uuid, int), public.emetti_fattura(uuid, jsonb, uuid, jsonb),
  public.sposta_tavolo(uuid, uuid), public.unisci_tavoli(uuid, uuid) to authenticated;
