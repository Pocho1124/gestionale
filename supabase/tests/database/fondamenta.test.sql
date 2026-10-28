-- Test delle fondamenta: isolamento tra tenant, ruoli, audit. Eseguire con: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
-- Le identità di test impostano sia request.jwt.claims (versioni recenti di auth.uid())
-- sia request.jwt.claim.sub (versione legacy presente nell'immagine Postgres senza GoTrue).

select plan(17);

-- Utenti sintetici
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local',     '{"nome":"Owner Test"}'),
  ('22222222-2222-2222-2222-222222222222', 'estraneo@test.local',  '{}'),
  ('33333333-3333-3333-3333-333333333333', 'cameriere@test.local', '{}');

select is((select nome from public.profili where id = '11111111-1111-1111-1111-111111111111'),
          'Owner Test', 'Il profilo viene creato alla registrazione');

-- ---------- Owner ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

select lives_ok($$ select public.crea_organizzazione('Org Test', 'Trattoria Test', 'trattoria-test') $$,
                'L''owner crea organizzazione e primo locale');
select is((select count(*) from public.locali), 1::bigint, 'L''owner vede il suo locale');
select is((select ruolo::text from public.membri where user_id = auth.uid()), 'owner', 'Il creatore è owner');
select throws_ok($$ insert into public.organizzazioni (nome) values ('Diretta') $$, '42501',
                 null, 'Le organizzazioni si creano solo tramite RPC');

reset role;
create temp table ctx as
  select o.id as org, l.id as loc from public.organizzazioni o join public.locali l on l.organizzazione_id = o.id;
grant select on ctx to authenticated, anon;

-- ---------- Estraneo ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

select is((select count(*) from public.locali), 0::bigint, 'Un estraneo non vede locali altrui');
select is_empty($$ update public.locali set nome = 'Hack' where id = (select loc from ctx) returning id $$,
                'Un estraneo non modifica locali altrui');
select throws_ok($$ insert into public.membri (organizzazione_id, user_id, ruolo)
                    select org, auth.uid(), 'owner' from ctx $$, '42501', null,
                 'Un estraneo non si aggiunge come owner');

-- ---------- Owner aggiunge un cameriere ----------
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select lives_ok($$ insert into public.membri (organizzazione_id, user_id, ruolo)
                   select org, '33333333-3333-3333-3333-333333333333', 'cameriere' from ctx $$,
                'L''owner aggiunge un cameriere');
select ok((select count(*) from public.audit_log) >= 3, 'L''audit registra le operazioni');
select throws_ok($$ delete from public.membri where user_id = auth.uid() $$, 'P0001', null,
                 'L''ultimo owner non può rimuoversi');

-- ---------- Cameriere ----------
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
select is((select count(*) from public.locali), 1::bigint, 'Il cameriere vede il suo locale');
select is_empty($$ update public.locali set nome = 'Hack' where id = (select loc from ctx) returning id $$,
                'Il cameriere non modifica il locale');
select is((select count(*) from public.audit_log), 0::bigint, 'Il cameriere non legge l''audit');
select is((select nome from public.profili where id = '11111111-1111-1111-1111-111111111111'),
          'Owner Test', 'Il cameriere vede il profilo dei colleghi');

-- ---------- Anonimo ----------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$ select count(*) from public.locali $$, '42501', null, 'Anon non accede alle tabelle interne');
select throws_ok($$ select public.crea_organizzazione('X', 'Y', 'slug-anon') $$, '42501', null,
                 'Anon non può creare organizzazioni');

select * from finish();
rollback;
