-- Test sala: tavoli, apertura/chiusura, codice, permessi per ruolo, Wi-Fi riservato.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(14);
insert into auth.users (id, email, raw_user_meta_data) values
  ('ab111111-1111-1111-1111-111111111111', 'owner@sala.local', '{}'),
  ('ab222222-2222-2222-2222-222222222222', 'estraneo@sala.local', '{}'),
  ('ab333333-3333-3333-3333-333333333333', 'cameriere@sala.local', '{}'),
  ('ab444444-4444-4444-4444-444444444444', 'cucina@sala.local', '{}');

set local role authenticated;
select pg_temp.come('ab111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Sala', 'Locale Sala', 'locale-sala');
reset role;
create temp table ctx as select l.id as loc, l.organizzazione_id as org from public.locali l where slug = 'locale-sala';
grant select on ctx to authenticated;
set local role authenticated;

select lives_ok($$ insert into public.sale (id, locale_id, nome) select 'ac000000-0000-0000-0000-000000000001', loc, 'Interno' from ctx $$, 'L''owner crea una sala');
select lives_ok($$ insert into public.tavoli (id, locale_id, sala_id, nome, posti, x, y)
                   select 'ad000000-0000-0000-0000-000000000005', loc, 'ac000000-0000-0000-0000-000000000001', '5', 4, 300, 200 from ctx $$, 'L''owner crea il tavolo 5');
select throws_ok($$ insert into public.tavoli (locale_id, sala_id, nome) select loc, 'ac000000-0000-0000-0000-000000000001', '5' from ctx $$,
                 '23505', null, 'Due tavoli con lo stesso nome rifiutati');
select ok((select length(qr_token) >= 16 from public.tavoli where nome = '5'), 'Il tavolo ha un codice QR casuale');
select lives_ok($$ insert into public.wifi_ospiti (locale_id, ssid, password) select loc, 'Locale Ospiti', 'segretissima' from ctx $$, 'L''owner imposta il Wi-Fi ospiti');
insert into public.membri (organizzazione_id, user_id, ruolo) select org, v.id::uuid, v.r::public.ruolo from ctx,
  (values ('ab333333-3333-3333-3333-333333333333', 'cameriere'), ('ab444444-4444-4444-4444-444444444444', 'cucina')) v(id, r);

-- Cameriere: apre e chiude, non modifica la piantina, non vede la password del Wi-Fi
select pg_temp.come('ab333333-3333-3333-3333-333333333333');
select ok((select codice ~ '^[0-9]{4}$' from public.apri_tavolo('ad000000-0000-0000-0000-000000000005', 3)), 'Il cameriere apre il tavolo e ottiene un codice di 4 cifre');
select throws_ok($$ select public.apri_tavolo('ad000000-0000-0000-0000-000000000005', 2) $$, '23505', null, 'Un tavolo già aperto non si riapre');
select throws_ok($$ insert into public.sessioni_tavolo (locale_id, tavolo_id, codice) select loc, 'ad000000-0000-0000-0000-000000000005', '1234' from ctx $$,
                 '42501', null, 'Le sessioni non si creano a mano');
select is_empty($$ update public.tavoli set x = 900 returning id $$, 'Il cameriere non sposta i tavoli');
select is((select count(*) from public.wifi_ospiti), 0::bigint, 'Il cameriere non vede la password del Wi-Fi');
select throws_ok($$ select public.chiudi_tavolo('ad000000-0000-0000-0000-000000000005') $$, '42501', null, 'Il cameriere non chiude il tavolo (serve il caposala)');

-- Cucina ed estraneo: niente apertura
select pg_temp.come('ab444444-4444-4444-4444-444444444444');
select throws_ok($$ select public.apri_tavolo('ad000000-0000-0000-0000-000000000005', 2) $$, '42501', null, 'La cucina non apre i tavoli');
select pg_temp.come('ab222222-2222-2222-2222-222222222222');
select throws_ok($$ select public.apri_tavolo('ad000000-0000-0000-0000-000000000005', 2) $$, '42501', null, 'Un estraneo non apre i tavoli');
select is((select count(*) from public.tavoli), 0::bigint, 'Un estraneo non vede i tavoli altrui');

select * from finish();
rollback;
