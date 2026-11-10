-- Report degli incassi per un periodo (solo capacità «cassa»): totali, scontrino medio, media a coperto, andamento per
-- giorno e per fascia oraria di arrivo, categorie e piatti più venduti, metodi di pagamento, confronto con il periodo
-- precedente di uguale durata. Conti chiusi, date e ore secondo il fuso del locale (Europe/Rome).

create or replace function public.report_incassi(p_locale uuid, p_dal date, p_al date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_giorni int := p_al - p_dal + 1; v_da timestamptz; v_a timestamptz; v_prec_da timestamptz;
begin
  if not public.puo(p_locale, 'cassa') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if p_dal is null or p_al is null or v_giorni not between 1 and 366 then
    raise exception 'Periodo non valido: da 1 a 366 giorni' using errcode = '22023';
  end if;
  v_da := p_dal::timestamp at time zone 'Europe/Rome';
  v_a := (p_al + 1)::timestamp at time zone 'Europe/Rome';
  v_prec_da := (p_dal - v_giorni)::timestamp at time zone 'Europe/Rome';
  return (
    with conti as (
      select s.* from public.sessioni_tavolo s where s.locale_id = p_locale and s.chiusa_at >= v_da and s.chiusa_at < v_a),
    precedenti as (
      select s.* from public.sessioni_tavolo s where s.locale_id = p_locale and s.chiusa_at >= v_prec_da and s.chiusa_at < v_da),
    righe as (
      select r.*, coalesce(c.nome, 'Senza categoria') as categoria
        from public.ordini o join public.righe_ordine r on r.ordine_id = o.id
        left join public.prodotti p on p.id = r.prodotto_id left join public.categorie c on c.id = p.categoria_id
       where o.sessione_id in (select id from conti) and o.stato not in ('rifiutato', 'annullato'))
    select jsonb_build_object(
      'dal', p_dal, 'al', p_al,
      'conti', (select count(*) from conti),
      'coperti', (select coalesce(sum(coperti), 0) from conti),
      'totale_cent', (select coalesce(sum(totale_cent), 0) from conti),
      'sconti_cent', (select coalesce(sum(sconto_cent), 0) from conti),
      'scontrino_medio_cent', (select coalesce(round(avg(totale_cent)), 0)::int from conti),
      'medio_coperto_cent', (select case when sum(coperti) > 0 then round(sum(totale_cent)::numeric / sum(coperti))::int else 0 end from conti),
      'precedente', (select jsonb_build_object('conti', count(*), 'coperti', coalesce(sum(coperti), 0), 'totale_cent', coalesce(sum(totale_cent), 0))
                       from precedenti),
      'per_giorno', (select coalesce(jsonb_agg(jsonb_build_object('giorno', g, 'conti', n, 'coperti', cop, 'totale_cent', t) order by g), '[]'::jsonb) from
                       (select (chiusa_at at time zone 'Europe/Rome')::date as g, count(*) n, sum(coperti) cop, sum(totale_cent) t from conti group by 1) x),
      'per_ora', (select coalesce(jsonb_agg(jsonb_build_object('ora', h, 'conti', n, 'totale_cent', t) order by h), '[]'::jsonb) from
                    (select extract(hour from aperta_at at time zone 'Europe/Rome')::int as h, count(*) n, sum(totale_cent) t from conti group by 1) x),
      'per_categoria', (select coalesce(jsonb_agg(jsonb_build_object('categoria', categoria, 'quantita', q, 'totale_cent', t) order by t desc), '[]'::jsonb) from
                          (select categoria, sum(quantita) q, sum(quantita * prezzo_cent) t from righe group by categoria) x),
      'piu_venduti', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'quantita', q, 'totale_cent', t) order by q desc, t desc), '[]'::jsonb) from
                        (select nome, sum(quantita) q, sum(quantita * prezzo_cent) t from righe group by nome order by sum(quantita) desc, sum(quantita * prezzo_cent) desc limit 15) x),
      'per_pagamento', (select coalesce(jsonb_object_agg(metodo, t), '{}'::jsonb) from
                          (select p.metodo, sum(p.importo_cent) t from public.pagamenti p
                            where p.stato = 'approvato' and p.sessione_id in (select id from conti) group by p.metodo) x)
    )
  );
end $$;

revoke execute on function public.report_incassi(uuid, date, date) from public, anon, authenticated;
grant execute on function public.report_incassi(uuid, date, date) to authenticated;
