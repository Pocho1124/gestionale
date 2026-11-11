-- Test del codice sempre obbligatorio: anche il titolare e gli account personali aprono i tavoli solo con il codice,
-- il bot esente no; la postazione lavora solo in sala e cucina; solo il titolare spegne l'obbligo. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text, p_sessione text default 'sessione-1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sessione)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(16);
insert into auth.users (id, email, raw_user_meta_data) values ('c0e10000-0000-0000-0000-000000000001', 'titolare@sempre.local', '{}');
set local role authenticated;
select pg_temp.come('c0e10000-0000-0000-0000-000000000001');
select public.crea_organizzazione('Org Sempre', 'Locale Sempre', 'locale-sempre');
reset role;
create temp table ctx (k text primary key, v uuid);
grant all on ctx to authenticated;
insert into ctx select 'locale', id from public.locali where slug = 'locale-sempre';
set local role authenticated;
insert into ctx values ('sara', public.crea_utente((select v from ctx where k = 'locale'), 'Sara', 'sara.sempre', 'PasswordLunga1', 'cameriere'));
insert into ctx values ('anna', public.crea_utente((select v from ctx where k = 'locale'), 'Anna', 'anna.sempre', 'PasswordLunga2', 'manager'));
insert into ctx values ('bot', public.crea_utente((select v from ctx where k = 'locale'), 'Bot di prova', 'bot.sempre', 'PasswordLunga3', 'manager'));
insert into ctx values ('tablet', public.crea_utente((select v from ctx where k = 'locale'), 'Tablet sala', 'tablet.sempre', 'PasswordLunga4', 'cameriere'));
insert into public.sale (id, locale_id, nome) select 'c0e20000-0000-0000-0000-000000000001', v, 'Interno' from ctx where k = 'locale';
insert into public.tavoli (id, locale_id, sala_id, nome, posti, x, y)
  select x.id::uuid, c.v, 'c0e20000-0000-0000-0000-000000000001', x.nome, 4, 100, 100 from ctx c,
  (values ('c0e30000-0000-0000-0000-000000000001', '1'), ('c0e30000-0000-0000-0000-000000000002', '2'), ('c0e30000-0000-0000-0000-000000000003', '3')) x(id, nome)
  where c.k = 'locale';
select public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'sara'), '2580');
select public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'anna'), '4682');

select lives_ok($$ select public.imposta_sicurezza_sala((select v from ctx where k = 'locale'), 120, false, true) $$, 'Il titolare rende obbligatorio il codice');
select lives_ok($$ select public.imposta_esente_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'bot'), true) $$, 'Il bot è esente');
select throws_ok($$ select public.imposta_chiede_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'anna'), true) $$,
                 '22023', null, 'Un account da responsabile non diventa una postazione');
select lives_ok($$ select public.imposta_chiede_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'tablet'), true) $$, 'Il tablet è una postazione');
select throws_ok($$ select public.apri_tavolo('c0e30000-0000-0000-0000-000000000003', 2) $$, '42501', null, 'Anche il titolare, senza codice, non apre i tavoli');

select pg_temp.come((select v::text from ctx where k = 'sara'));
select ok((public.stato_operatore((select v from ctx where k = 'locale')) ->> 'chiede_codice')::boolean, 'L''account personale chiede il codice');
select throws_ok($$ select public.apri_tavolo('c0e30000-0000-0000-0000-000000000001', 2) $$, '42501', null, 'Sul proprio account, senza codice, non si apre il tavolo');
select is(public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'sara'), '2580') ->> 'nome', 'Sara', 'Sara inserisce il suo codice');
select lives_ok($$ select public.apri_tavolo('c0e30000-0000-0000-0000-000000000001', 2) $$, 'Con il codice il tavolo si apre');

select pg_temp.come((select v::text from ctx where k = 'bot'));
select lives_ok($$ select public.apri_tavolo('c0e30000-0000-0000-0000-000000000002', 2) $$, 'Il bot esente lavora senza codice');

-- Postazione: solo sala e cucina, anche con il codice di un responsabile
select pg_temp.come((select v::text from ctx where k = 'tablet'));
select is(public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'anna'), '4682') ->> 'ruolo', 'manager', 'Sul tablet entra la responsabile');
select ok(not public.puo((select v from ctx where k = 'locale'), 'catalogo'), 'Dalla postazione niente catalogo, nemmeno con il codice della responsabile');
select ok(not public.puo((select v from ctx where k = 'locale'), 'impostazioni'), 'Dalla postazione niente impostazioni');
select ok(public.puo((select v from ctx where k = 'locale'), 'ordini.annulla'), 'Ma in sala vale il ruolo della responsabile (storno)');

-- Solo il titolare spegne l'obbligo
select pg_temp.come((select v::text from ctx where k = 'anna'));
select throws_ok($$ select public.imposta_sicurezza_sala((select v from ctx where k = 'locale'), 120, false, false) $$, '42501', null, 'La responsabile non spegne l''obbligo');
select pg_temp.come('c0e10000-0000-0000-0000-000000000001');
select lives_ok($$ select public.imposta_sicurezza_sala((select v from ctx where k = 'locale'), 120, false, false) $$, 'Il titolare sì');

select * from finish();
rollback;
