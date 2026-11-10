-- Test del report degli incassi: permessi, totali, medie, giorni, categorie, confronto con il periodo precedente. Dati sintetici.
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
create function pg_temp.r() returns jsonb language sql as $$ select public.report_incassi(pg_temp.v('loc'), current_date - 6, current_date + 1) $$;  -- +1: fuso orario del locale

select plan(8);
insert into auth.users (id, email, raw_user_meta_data) values
  ('f6111111-1111-1111-1111-111111111111', 'titolare@report.local', '{}'),
  ('f6222222-2222-2222-2222-222222222222', 'responsabile@report.local', '{}');
set local role authenticated; select pg_temp.come('f6111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Report', 'Locale Report', 'locale-report');
reset role;
insert into ctx select 'loc', id from public.locali where slug = 'locale-report';
insert into public.membri (organizzazione_id, user_id, ruolo)
  select organizzazione_id, 'f6222222-2222-2222-2222-222222222222', 'manager' from public.locali where slug = 'locale-report';
insert into public.categorie (id, locale_id, nome) values
  ('f6200000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'Pinse'), ('f6200000-0000-0000-0000-000000000002', pg_temp.v('loc'), 'Vini');
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent) values
  ('f6300000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'f6200000-0000-0000-0000-000000000001', 'Pinsa', 1000),
  ('f6300000-0000-0000-0000-000000000002', pg_temp.v('loc'), 'f6200000-0000-0000-0000-000000000002', 'Calice', 600);
insert into public.sale (id, locale_id, nome) values ('f6400000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'Interno');
insert into public.tavoli (id, locale_id, sala_id, nome, qr_token) values
  ('f6500000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'f6400000-0000-0000-0000-000000000001', '1', 'token-tavolo-uno-report');

-- Due conti questa settimana (2 pinse + 1 calice con 2 coperti; 1 calice con 1 coperto), uno la settimana scorsa
set local role authenticated; select pg_temp.come('f6111111-1111-1111-1111-111111111111');
select public.apri_tavolo('f6500000-0000-0000-0000-000000000001', 2);
select public.ordine_sala('f6500000-0000-0000-0000-000000000001',
  '[{"prodotto_id":"f6300000-0000-0000-0000-000000000001","quantita":2},{"prodotto_id":"f6300000-0000-0000-0000-000000000002","quantita":1}]');
select public.chiudi_tavolo('f6500000-0000-0000-0000-000000000001', 'carta');
select public.apri_tavolo('f6500000-0000-0000-0000-000000000001', 1);
select public.ordine_sala('f6500000-0000-0000-0000-000000000001', '[{"prodotto_id":"f6300000-0000-0000-0000-000000000002","quantita":1}]');
select public.chiudi_tavolo('f6500000-0000-0000-0000-000000000001', 'contanti');
select public.apri_tavolo('f6500000-0000-0000-0000-000000000001', 4);
select public.ordine_sala('f6500000-0000-0000-0000-000000000001', '[{"prodotto_id":"f6300000-0000-0000-0000-000000000001","quantita":1}]');
select public.chiudi_tavolo('f6500000-0000-0000-0000-000000000001', 'carta');
reset role;
update public.sessioni_tavolo set aperta_at = now() - interval '9 days', chiusa_at = now() - interval '9 days' + interval '1 hour'
 where id = (select id from public.sessioni_tavolo where coperti = 4);

select pg_temp.come('f6222222-2222-2222-2222-222222222222');
set local role authenticated;
select throws_ok($$ select pg_temp.r() $$, '42501', null, 'Il responsabile non vede gli incassi');
select pg_temp.come('f6111111-1111-1111-1111-111111111111');
select is((pg_temp.r() ->> 'totale_cent')::int, 3200, 'Incasso della settimana: 26 € + 6 €');
select is((pg_temp.r() ->> 'scontrino_medio_cent')::int, 1600, 'Scontrino medio: 16 €');
select is((pg_temp.r() ->> 'medio_coperto_cent')::int, 1067, 'Media a coperto: 32 € / 3 coperti');
select is(pg_temp.r() -> 'per_categoria' -> 0 ->> 'categoria', 'Pinse', 'La categoria che incassa di più è in cima');
select is(pg_temp.r() -> 'precedente' ->> 'totale_cent', '1000', 'Confronto con la settimana precedente');
select is(pg_temp.r() -> 'per_pagamento', '{"carta": 2600, "contanti": 600}'::jsonb, 'Incassi per metodo di pagamento');
select throws_ok($$ select public.report_incassi(pg_temp.v('loc'), current_date, current_date - 1) $$, '22023', null, 'Periodo al contrario rifiutato');

select * from finish();
rollback;
