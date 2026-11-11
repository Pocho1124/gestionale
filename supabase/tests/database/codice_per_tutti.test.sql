-- Test del codice su tutti gli account: anche il proprio account chiede il codice, il bot esente no, il titolare
-- può sempre spegnere l'opzione. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text, p_sessione text default 'sessione-1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sessione)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(10);
insert into auth.users (id, email, raw_user_meta_data) values ('c0e10000-0000-0000-0000-000000000001', 'titolare@tutti.local', '{}');
set local role authenticated;
select pg_temp.come('c0e10000-0000-0000-0000-000000000001');
select public.crea_organizzazione('Org Tutti', 'Locale Tutti', 'locale-tutti');
reset role;
create temp table ctx (k text primary key, v uuid);
grant all on ctx to authenticated;
insert into ctx select 'locale', id from public.locali where slug = 'locale-tutti';
set local role authenticated;
insert into ctx values ('sara', public.crea_utente((select v from ctx where k = 'locale'), 'Sara', 'sara.tutti', 'PasswordLunga1', 'cameriere'));
insert into ctx values ('bot', public.crea_utente((select v from ctx where k = 'locale'), 'Bot di prova', 'bot.tutti', 'PasswordLunga2', 'manager'));
insert into public.sale (id, locale_id, nome) select 'c0e20000-0000-0000-0000-000000000001', v, 'Interno' from ctx where k = 'locale';
insert into public.tavoli (id, locale_id, sala_id, nome, posti, x, y)
  select x.id::uuid, c.v, 'c0e20000-0000-0000-0000-000000000001', x.nome, 4, 100, 100 from ctx c,
  (values ('c0e30000-0000-0000-0000-000000000001', '1'), ('c0e30000-0000-0000-0000-000000000002', '2'), ('c0e30000-0000-0000-0000-000000000003', '3')) x(id, nome)
  where c.k = 'locale';
select public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'sara'), '2580');

select lives_ok($$ select public.imposta_sicurezza_sala((select v from ctx where k = 'locale'), 120, false, true) $$, 'Il titolare chiede il codice su tutti gli account');
select lives_ok($$ select public.imposta_esente_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'bot'), true) $$, 'Il bot è esente');
select ok((public.stato_operatore((select v from ctx where k = 'locale')) ->> 'codice_per_tutti')::boolean, 'L''opzione risulta attiva');

select pg_temp.come((select v::text from ctx where k = 'sara'));
select ok((public.stato_operatore((select v from ctx where k = 'locale')) ->> 'chiede_codice')::boolean, 'Anche l''account personale chiede il codice');
select ok(not (public.stato_operatore((select v from ctx where k = 'locale')) ->> 'postazione')::boolean, 'Ma non è una postazione condivisa');
select throws_ok($$ select public.apri_tavolo('c0e30000-0000-0000-0000-000000000001', 2) $$, '42501', null, 'Sul proprio account, senza codice, non si apre il tavolo');
select is(public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'sara'), '2580') ->> 'nome', 'Sara', 'Sara inserisce il suo codice');
select lives_ok($$ select public.apri_tavolo('c0e30000-0000-0000-0000-000000000001', 2) $$, 'Con il codice il tavolo si apre');

select pg_temp.come((select v::text from ctx where k = 'bot'));
select lives_ok($$ select public.apri_tavolo('c0e30000-0000-0000-0000-000000000002', 2) $$, 'Il bot esente lavora senza codice');

-- Il titolare senza codice non apre tavoli, ma può sempre spegnere l'opzione (le impostazioni non chiedono il codice)
select pg_temp.come('c0e10000-0000-0000-0000-000000000001');
select lives_ok($$ select public.imposta_sicurezza_sala((select v from ctx where k = 'locale'), 120, false, false) $$, 'Il titolare può sempre spegnere l''opzione');

select * from finish();
rollback;
