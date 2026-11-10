-- Test del conto diviso per piatti: pezzi del conto, già pagati, sconto in proporzione, POS, annullo, saldo finale. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;
create temp table ctx (chiave text primary key, valore text);
grant all on ctx to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select valore::uuid from ctx where chiave = p $$;
-- Identificativo della riga del conto con quel nome e pezzi già pagati
create function pg_temp.riga(p_nome text) returns uuid language sql as $$ select id from public.righe_ordine where nome = p_nome $$;
create function pg_temp.pagate(p_nome text) returns int language sql as $$
  select (x ->> 'pagate')::int from jsonb_array_elements(public.stato_conto(pg_temp.v('s')) -> 'righe') x where x ->> 'nome' = p_nome $$;
create function pg_temp.scelta(p_pinse int, p_calici int) returns jsonb language sql as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object('riga_id', pg_temp.riga('Pinsa'), 'quantita', p_pinse) x where p_pinse > 0
    union all select jsonb_build_object('riga_id', pg_temp.riga('Calice'), 'quantita', p_calici) where p_calici > 0) y $$;

select plan(11);
insert into auth.users (id, email, raw_user_meta_data) values ('ec111111-1111-1111-1111-111111111111', 'titolare@piatti.local', '{}');
set local role authenticated; select pg_temp.come('ec111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Piatti', 'Locale Piatti', 'locale-piatti');
reset role;
insert into ctx select 'loc', id from public.locali where slug = 'locale-piatti';
insert into public.categorie (id, locale_id, nome) values ('ec200000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'Menu');
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent) values
  ('ec300000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'ec200000-0000-0000-0000-000000000001', 'Pinsa', 1000),
  ('ec300000-0000-0000-0000-000000000002', pg_temp.v('loc'), 'ec200000-0000-0000-0000-000000000001', 'Calice', 600);
insert into public.sale (id, locale_id, nome) values ('ec400000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'Interno');
insert into public.tavoli (id, locale_id, sala_id, nome, qr_token) values
  ('ec500000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'ec400000-0000-0000-0000-000000000001', '8', 'token-tavolo-otto-piatti');
set local role authenticated; select pg_temp.come('ec111111-1111-1111-1111-111111111111');
select public.apri_tavolo('ec500000-0000-0000-0000-000000000001', 3);
select public.ordine_sala('ec500000-0000-0000-0000-000000000001',
  '[{"prodotto_id":"ec300000-0000-0000-0000-000000000001","quantita":2},{"prodotto_id":"ec300000-0000-0000-0000-000000000002","quantita":3}]');
insert into ctx select 's', id from public.sessioni_tavolo where tavolo_id = 'ec500000-0000-0000-0000-000000000001' and chiusa_at is null;
select public.imposta_sconto(pg_temp.v('s'), null, 10);   -- 38 € − 10% = 34,20 €

select is(jsonb_array_length(public.stato_conto(pg_temp.v('s')) -> 'righe'), 2, 'Il conto elenca i piatti da pagare');
select is((public.registra_pagamento(pg_temp.v('s'), 'contanti', null, null, null, 'Anna', null, pg_temp.scelta(1, 1)) ->> 'pagato_cent')::int, 1440,
          'Una pinsa e un calice: 16 € meno lo sconto del 10% = 14,40 € (calcolato dal database)');
insert into ctx select 'p1', id from public.pagamenti where quota = 'Anna';
select is(pg_temp.pagate('Pinsa'), 1, 'La pinsa pagata risulta pagata');
select throws_ok($$ select public.registra_pagamento(pg_temp.v('s'), 'contanti', null, null, null, '', null, pg_temp.scelta(2, 0)) $$, '22023', null,
                 'Non si paga due volte lo stesso pezzo');
select throws_ok($$ select public.registra_pagamento(pg_temp.v('s'), 'contanti', 500, null, null, '', null, pg_temp.scelta(1, 0)) $$, '22023', null,
                 'Piatti e importo insieme: rifiutato');
select throws_ok($$ select public.registra_pagamento(pg_temp.v('s'), 'contanti', null, null, null, '', null,
                    jsonb_build_array(jsonb_build_object('riga_id', gen_random_uuid(), 'quantita', 1))) $$, '22023', null, 'Un piatto di un altro conto: rifiutato');
select public.registra_pagamento(pg_temp.v('s'), 'carta', null, null, null, 'Bruno', null, pg_temp.scelta(0, 1));
select is(pg_temp.pagate('Calice'), 2, 'Il calice mandato al POS è già riservato');
insert into ctx select 'pos', id from public.pagamenti where quota = 'Bruno';
select public.esito_pos(pg_temp.v('pos'), false);
select is(pg_temp.pagate('Calice'), 1, 'POS rifiutato: il calice torna da pagare');
select public.annulla_pagamento(pg_temp.v('p1'));
select is(pg_temp.pagate('Pinsa'), 0, 'Pagamento annullato: la pinsa torna da pagare');
select is((public.registra_pagamento(pg_temp.v('s'), 'carta', null, null, null, 'Tutti', null, pg_temp.scelta(2, 3)) ->> 'residuo_cent')::int, 0,
          'Con l''ultimo pezzo il conto si salda al centesimo');
select public.esito_pos((select id from public.pagamenti where quota = 'Tutti'), true);
select is(public.chiudi_tavolo('ec500000-0000-0000-0000-000000000001'), 3420, 'Tavolo chiuso con il conto pagato per piatti');

select * from finish();
rollback;
