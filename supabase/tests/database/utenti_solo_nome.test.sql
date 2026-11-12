-- Test del personale solo con nome utente: email rifiutata, nome utente accettato. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', 's1')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(4);
insert into auth.users (id, email, raw_user_meta_data) values ('c1d10000-0000-0000-0000-000000000001', 'titolare@utenti-nome.local', '{}');
set local role authenticated;
select pg_temp.come('c1d10000-0000-0000-0000-000000000001');
select public.crea_organizzazione('Org Utenti Nome', 'Locale Utenti Nome', 'locale-utenti-nome');
reset role;
create temp table ctx (k text primary key, v uuid);
grant all on ctx to authenticated;
insert into ctx select 'locale', id from public.locali where slug = 'locale-utenti-nome';
set local role authenticated;

select throws_ok($$ select public.crea_utente((select v from ctx where k = 'locale'), 'Finta', 'persona@esempio.invalid', 'PasswordLunga1', 'cameriere') $$,
                 '22023', null, 'Email rifiutata: niente account già confermati a nome di altri');
select throws_ok($$ select public.crea_utente((select v from ctx where k = 'locale'), 'Finta', 'nome con spazi', 'PasswordLunga1', 'cameriere') $$,
                 '22023', null, 'Nome utente con spazi rifiutato');
select lives_ok($$ select public.crea_utente((select v from ctx where k = 'locale'), 'Luca', 'luca.un', 'PasswordLunga1', 'cameriere') $$, 'Nome utente accettato');
reset role;
select ok(exists (select 1 from auth.users where email = 'luca.un@staff.locale'), 'Accesso interno «nome@staff.locale»');

select * from finish();
rollback;
