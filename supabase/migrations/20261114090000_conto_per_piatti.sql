-- Conto diviso per piatti: ogni pagamento può indicare i pezzi pagati (es. «la pinsa e un calice»).
-- Il database controlla che i pezzi siano del conto e non già pagati, somma i prezzi e applica lo sconto in proporzione.
-- Un pagamento annullato o rifiutato dal POS libera di nuovo i suoi pezzi.

create table public.pagamenti_righe (
  pagamento_id uuid not null references public.pagamenti (id) on delete cascade,
  riga_id      uuid not null references public.righe_ordine (id) on delete cascade,
  locale_id    uuid not null references public.locali (id) on delete cascade,
  quantita     int  not null check (quantita between 1 and 20),
  primary key (pagamento_id, riga_id)
);
create index on public.pagamenti_righe (riga_id);
alter table public.pagamenti_righe enable row level security;
create policy pagamenti_righe_select on public.pagamenti_righe for select to authenticated using (public.puo(locale_id, 'sala.chiudi'));
revoke all on public.pagamenti_righe from anon;
revoke insert, update, delete, truncate on public.pagamenti_righe from authenticated;

-- Pezzi di una riga già coperti da pagamenti validi (incassati o in attesa del POS)
create or replace function public.quantita_pagata(p_riga uuid)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(sum(pr.quantita), 0)::int from public.pagamenti_righe pr join public.pagamenti p on p.id = pr.pagamento_id
   where pr.riga_id = p_riga and p.stato in ('approvato', 'in_attesa');
$$;

create or replace function public.stato_conto(p_sessione uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ses public.sessioni_tavolo; v_lordo int; v_totale int; v_pagato int; v_attesa int;
begin
  select * into v_ses from public.sessioni_tavolo where id = p_sessione;
  if v_ses.id is null or not public.puo(v_ses.locale_id, 'sala.chiudi') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  v_lordo := case when v_ses.chiusa_at is null then public.totale_sessione(v_ses.id) else coalesce(v_ses.totale_cent, 0) + v_ses.sconto_cent end;
  v_totale := greatest(v_lordo - v_ses.sconto_cent, 0);
  select coalesce(sum(importo_cent) filter (where stato = 'approvato'), 0), coalesce(sum(importo_cent) filter (where stato = 'in_attesa'), 0)
    into v_pagato, v_attesa from public.pagamenti where sessione_id = v_ses.id;
  return jsonb_build_object(
    'sessione', v_ses.id, 'chiuso', v_ses.chiusa_at is not null, 'coperti', v_ses.coperti,
    'lordo_cent', v_lordo, 'sconto_cent', v_ses.sconto_cent, 'totale_cent', v_totale,
    'pagato_cent', v_pagato, 'in_attesa_cent', v_attesa, 'residuo_cent', v_totale - v_pagato - v_attesa,
    'pagamenti', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'metodo', p.metodo, 'importo_cent', p.importo_cent, 'ricevuto_cent', p.ricevuto_cent,
               'quota', p.quota, 'stato', p.stato, 'riferimento', p.riferimento, 'terminale', t.nome, 'creato_at', p.creato_at) order by p.creato_at)
      from public.pagamenti p left join public.terminali_pos t on t.id = p.terminale_id where p.sessione_id = v_ses.id), '[]'::jsonb),
    'righe', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'nome', r.nome, 'quantita', r.quantita, 'prezzo_cent', r.prezzo_cent, 'nota', r.nota,
               'opzioni', (select coalesce(jsonb_agg(x ->> 'nome'), '[]'::jsonb) from jsonb_array_elements(r.opzioni) x),
               'pagate', public.quantita_pagata(r.id)) order by o.creato_at, r.nome)
      from public.ordini o join public.righe_ordine r on r.ordine_id = o.id
      where o.sessione_id = v_ses.id and o.stato not in ('rifiutato', 'annullato') and r.prezzo_cent > 0), '[]'::jsonb));
end $$;

drop function public.registra_pagamento(uuid, text, int, numeric, int, text, uuid);
create function public.registra_pagamento(p_sessione uuid, p_metodo text, p_importo_cent int default null, p_percentuale numeric default null,
                                                     p_ricevuto_cent int default null, p_quota text default '', p_terminale uuid default null,
                                                     p_righe jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ses public.sessioni_tavolo := public.sessione_da_incassare(p_sessione); v_conto jsonb; v_importo int; v_id uuid;
        v_scelte jsonb; v_lordo_scelto int; v_lordo int;
begin
  if p_metodo not in ('contanti', 'carta', 'altro') then raise exception 'Metodo di pagamento non valido' using errcode = '22023'; end if;
  v_conto := public.stato_conto(p_sessione);
  if (v_conto->>'residuo_cent')::int <= 0 then raise exception 'Il conto è già saldato' using errcode = '22023'; end if;
  if p_righe is not null then
    -- Per piatti: il database somma i pezzi scelti (non ancora pagati) e applica lo sconto in proporzione
    if p_importo_cent is not null or p_percentuale is not null then
      raise exception 'Indica i piatti oppure un importo, non entrambi' using errcode = '22023';
    end if;
    if jsonb_typeof(p_righe) <> 'array' or jsonb_array_length(p_righe) not between 1 and 100 then
      raise exception 'Scegli da 1 a 100 piatti' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(p_righe) e
               where coalesce(e->>'riga_id', '') !~ '^[0-9a-f-]{36}$' or coalesce(e->>'quantita', '') !~ '^([1-9]|1[0-9]|20)$') then
      raise exception 'Piatti non validi' using errcode = '22023';
    end if;
    select jsonb_agg(jsonb_build_object('riga_id', riga, 'quantita', q)) into v_scelte
      from (select (e->>'riga_id')::uuid as riga, sum((e->>'quantita')::int)::int as q from jsonb_array_elements(p_righe) e group by 1) x;
    if exists (select 1 from jsonb_to_recordset(v_scelte) as s(riga_id uuid, quantita int)
               left join public.righe_ordine r on r.id = s.riga_id
               left join public.ordini o on o.id = r.ordine_id
               where r.id is null or o.sessione_id <> v_ses.id or o.stato in ('rifiutato', 'annullato')
                  or s.quantita > r.quantita - public.quantita_pagata(r.id)) then
      raise exception 'Un piatto non è di questo conto o è già stato pagato: aggiorna il conto' using errcode = '22023';
    end if;
    select coalesce(sum(s.quantita * r.prezzo_cent), 0)::int into v_lordo_scelto
      from jsonb_to_recordset(v_scelte) as s(riga_id uuid, quantita int) join public.righe_ordine r on r.id = s.riga_id;
    v_lordo := (v_conto->>'lordo_cent')::int;
    v_importo := least(case when v_lordo > 0 then round(v_lordo_scelto::numeric * (v_conto->>'totale_cent')::int / v_lordo)::int else 0 end,
                       (v_conto->>'residuo_cent')::int);
    -- Se con questi pezzi il conto è tutto pagato, si salda al centesimo (niente resti da arrotondamento)
    if not exists (select 1 from public.ordini o join public.righe_ordine r on r.ordine_id = o.id
                   where o.sessione_id = v_ses.id and o.stato not in ('rifiutato', 'annullato') and r.prezzo_cent > 0
                     and r.quantita - public.quantita_pagata(r.id)
                         - coalesce((select s.quantita from jsonb_to_recordset(v_scelte) as s(riga_id uuid, quantita int) where s.riga_id = r.id), 0) > 0) then
      v_importo := (v_conto->>'residuo_cent')::int;
    end if;
  elsif p_percentuale is not null then
    if p_percentuale <= 0 or p_percentuale > 100 then raise exception 'Percentuale tra 0 e 100' using errcode = '22023'; end if;
    v_importo := least(round((v_conto->>'totale_cent')::int * p_percentuale / 100)::int, (v_conto->>'residuo_cent')::int);
  else
    v_importo := p_importo_cent;
  end if;
  if v_importo is null or v_importo < 1 then raise exception 'Importo non valido' using errcode = '22023'; end if;
  if v_importo > (v_conto->>'residuo_cent')::int then
    raise exception 'L''importo supera quanto resta da pagare (% €)', replace(to_char((v_conto->>'residuo_cent')::int / 100.0, 'FM999990.00'), '.', ',') using errcode = '22023';
  end if;
  if p_metodo <> 'contanti' and p_ricevuto_cent is not null then raise exception 'Il contante ricevuto vale solo per i contanti' using errcode = '22023'; end if;
  if p_ricevuto_cent is not null and p_ricevuto_cent < v_importo then raise exception 'Il contante ricevuto è inferiore all''importo' using errcode = '22023'; end if;
  if p_terminale is not null and (p_metodo <> 'carta' or not exists (
       select 1 from public.terminali_pos where id = p_terminale and locale_id = v_ses.locale_id and attivo)) then
    raise exception 'Terminale POS non valido' using errcode = '22023';
  end if;
  insert into public.pagamenti (locale_id, sessione_id, metodo, importo_cent, ricevuto_cent, quota, terminale_id, stato, esito_at)
  values (v_ses.locale_id, v_ses.id, p_metodo, v_importo, p_ricevuto_cent, left(btrim(coalesce(p_quota, '')), 40), p_terminale,
          case when p_metodo = 'carta' then 'in_attesa' else 'approvato' end, case when p_metodo = 'carta' then null else now() end)
  returning id into v_id;
  if v_scelte is not null then
    insert into public.pagamenti_righe (pagamento_id, riga_id, locale_id, quantita)
    select v_id, s.riga_id, v_ses.locale_id, s.quantita from jsonb_to_recordset(v_scelte) as s(riga_id uuid, quantita int);
  end if;
  return public.stato_conto(p_sessione) || jsonb_build_object('pagamento', v_id, 'resto_cent', coalesce(p_ricevuto_cent - v_importo, 0));
end $$;

revoke execute on function public.quantita_pagata(uuid), public.stato_conto(uuid),
  public.registra_pagamento(uuid, text, int, numeric, int, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.stato_conto(uuid), public.registra_pagamento(uuid, text, int, numeric, int, text, uuid, jsonb) to authenticated;
