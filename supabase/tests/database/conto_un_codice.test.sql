-- Test del conto con un solo codice: il codice si rinnova solo se è ancora valido, al massimo 10 minuti dall'inserimento. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text, p_sessione text default 'sessione-1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sessione)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(6);
insert into auth.users (id, email, raw_user_meta_data) values ('c1b10000-0000-0000-0000-000000000001', 'titolare@conto-codice.local', '{}');
set local role authenticated;
select pg_temp.come('c1b10000-0000-0000-0000-000000000001');
select public.crea_organizzazione('Org Conto Codice', 'Locale Conto Codice', 'locale-conto-codice');
reset role;
create temp table ctx (k text primary key, v uuid);
grant all on ctx to authenticated;
insert into ctx select 'locale', id from public.locali where slug = 'locale-conto-codice';
set local role authenticated;
insert into ctx values ('sara', public.crea_utente((select v from ctx where k = 'locale'), 'Sara', 'sara.cc', 'PasswordLunga1', 'caposala'));
select public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'sara'), '2580');

select is(public.trattieni_operatore((select v from ctx where k = 'locale')), null, 'Senza codice inserito non si trattiene nulla');
select public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'sara'), '2580');
select ok(public.trattieni_operatore((select v from ctx where k = 'locale')) between now() + interval '55 seconds' and now() + interval '65 seconds',
          'Con il conto aperto il codice si rinnova di 60 secondi');
reset role;
update public.operatori_attivi set entrato_at = now() - interval '9 minutes 50 seconds', scade_at = now() + interval '5 seconds';
set local role authenticated;
select ok(public.trattieni_operatore((select v from ctx where k = 'locale')) between now() + interval '5 seconds' and now() + interval '15 seconds', 'Mai oltre 10 minuti dall''inserimento');
reset role;
update public.operatori_attivi set scade_at = now() - interval '1 second';
set local role authenticated;
select is(public.trattieni_operatore((select v from ctx where k = 'locale')), null, 'Un codice scaduto non si rinnova');
select pg_temp.come((select v::text from ctx where k = 'sara'), 'altra-sessione');
select is(public.trattieni_operatore((select v from ctx where k = 'locale')), null, 'Solo la sessione dove è stato inserito');
reset role;
select ok(not has_function_privilege('anon', 'public.trattieni_operatore(uuid)', 'execute'), 'Il pubblico non la esegue');

select * from finish();
rollback;
