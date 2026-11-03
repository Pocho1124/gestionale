-- Test dei rinforzi: account condivisi tra organizzazioni, indirizzi delle stampanti, ruolo del servizio di stampa.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(10);
insert into auth.users (id, email, raw_user_meta_data) values
  ('a7000000-0000-0000-0000-000000000001', 'titolare.a@r.local', '{}'), ('a7000000-0000-0000-0000-000000000002', 'titolare.b@r.local', '{}'),
  ('a7000000-0000-0000-0000-000000000003', 'resp.a@r.local', '{}');
set local role authenticated;
select pg_temp.come('a7000000-0000-0000-0000-000000000002'); select public.crea_organizzazione('Org B', 'Locale B', 'locale-b-r');
select pg_temp.come('a7000000-0000-0000-0000-000000000001'); select public.crea_organizzazione('Org A', 'Locale A', 'locale-a-r');
reset role;
-- Il titolare di B lavora anche come cameriere in A; il responsabile di A prova a prendersi il suo account
insert into public.membri (organizzazione_id, user_id, ruolo, locale_id) select organizzazione_id, v.u::uuid, v.r::public.ruolo, id from public.locali,
  (values ('a7000000-0000-0000-0000-000000000002', 'cameriere'), ('a7000000-0000-0000-0000-000000000003', 'manager')) v(u, r) where slug = 'locale-a-r';
create temp table ctx as select id as la from public.locali where slug = 'locale-a-r';
grant select on ctx to authenticated;
set local role authenticated;
select pg_temp.come('a7000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.reimposta_password_utente((select la from ctx), 'a7000000-0000-0000-0000-000000000002', 'PasswordRubata1') $$,
                 '42501', null, 'Il responsabile di A non cambia la password di chi è titolare in B');
select throws_ok($$ select public.imposta_attivo_utente((select la from ctx), 'a7000000-0000-0000-0000-000000000002', false) $$,
                 '42501', null, 'né gli blocca l''accesso');
select lives_ok($$ select public.rimuovi_utente((select la from ctx), 'a7000000-0000-0000-0000-000000000002') $$, 'Può solo toglierlo dal proprio locale');
select pg_temp.come('a7000000-0000-0000-0000-000000000002');
select is((select count(*) from public.locali where slug = 'locale-b-r'), 1::bigint, 'Il titolare di B continua a usare la sua organizzazione');

-- Stampanti
select pg_temp.come('a7000000-0000-0000-0000-000000000001');
select lives_ok($$ insert into public.stampanti (locale_id, nome, indirizzo) select la, 'Cucina', '192.168.111.50' from ctx $$, 'Stampante nella rete del locale accettata');
select throws_ok($$ insert into public.stampanti (locale_id, nome, indirizzo) select la, 'X', '127.0.0.1' from ctx $$, '23514', null, 'Loopback rifiutato');
select throws_ok($$ insert into public.stampanti (locale_id, nome, indirizzo) select la, 'X', '172.18.0.5' from ctx $$, '23514', null, 'Rete interna di Docker rifiutata');
select throws_ok($$ insert into public.stampanti (locale_id, nome, indirizzo, porta) select la, 'X', '192.168.111.51', 5432 from ctx $$, '23514', null, 'Porte diverse da quelle di stampa rifiutate');

-- Ruolo del servizio di stampa: legge la coda, non vede il resto
reset role;
select ok(has_table_privilege('servizio_stampa', 'public.comande_stampa', 'select')
          and has_column_privilege('servizio_stampa', 'public.comande_stampa', 'stato', 'update'), 'Il servizio di stampa legge la coda e ne aggiorna lo stato');
select ok(not has_table_privilege('servizio_stampa', 'public.membri', 'select') and not has_table_privilege('servizio_stampa', 'public.prodotti', 'update')
          and not has_column_privilege('servizio_stampa', 'public.comande_stampa', 'stampante_id', 'update'), 'e non vede utenti né modifica altro');

select * from finish();
rollback;
