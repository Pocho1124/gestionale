-- Test dell'account del bot con permessi dedicati: catalogo e sala sì; utenti, impostazioni, magazzino, struttura del
-- locale, chiusura e storno no. Il responsabile in carne e ossa non cambia. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text, p_sessione text default 'sessione-1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sessione)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(12);
insert into auth.users (id, email, raw_user_meta_data) values
  ('c1c10000-0000-0000-0000-000000000001', 'titolare@bot-dedicato.local', '{}'),
  ('c1c10000-0000-0000-0000-000000000002', 'bot-telegram-prova@gestionale.local', '{}');
set local role authenticated;
select pg_temp.come('c1c10000-0000-0000-0000-000000000001');
select public.crea_organizzazione('Org Bot Dedicato', 'Locale Bot Dedicato', 'locale-bot-dedicato');
reset role;
create temp table ctx (k text primary key, v uuid);
grant all on ctx to authenticated;
insert into ctx select 'locale', id from public.locali where slug = 'locale-bot-dedicato';
insert into ctx values ('bot', 'c1c10000-0000-0000-0000-000000000002');
insert into public.membri (organizzazione_id, user_id, ruolo, locale_id, esente_codice, account_bot)
  select l.organizzazione_id, 'c1c10000-0000-0000-0000-000000000002', 'manager', l.id, true, true from public.locali l where l.slug = 'locale-bot-dedicato';
set local role authenticated;
insert into ctx values ('anna', public.crea_utente((select v from ctx where k = 'locale'), 'Anna', 'anna.bd', 'PasswordLunga1', 'manager'));

select pg_temp.come((select v::text from ctx where k = 'bot'));
select lives_ok($$ insert into public.categorie (locale_id, nome) select v, 'Birre sintetiche' from ctx where k = 'locale' $$, 'Il bot aggiunge al catalogo');
select ok(public.puo((select v from ctx where k = 'locale'), 'ordini.conferma'), 'Il bot conferma gli ordini');
select ok(not public.puo((select v from ctx where k = 'locale'), 'sala.chiudi'), 'Il bot non chiude i tavoli');
select ok(not public.puo((select v from ctx where k = 'locale'), 'ordini.annulla'), 'Il bot non storna');
select ok(not public.puo((select v from ctx where k = 'locale'), 'impostazioni') and not public.puo((select v from ctx where k = 'locale'), 'magazzino'),
          'Il bot non tocca impostazioni e magazzino');
select throws_ok($$ select public.crea_utente((select v from ctx where k = 'locale'), 'Finto', 'finto.bd', 'PasswordLunga2', 'cameriere') $$,
                 '42501', null, 'Il bot non crea utenti');
select throws_ok($$ insert into public.sale (locale_id, nome) select v, 'Sala finta' from ctx where k = 'locale' $$, '42501', null, 'Il bot non crea sale');
select throws_ok($$ insert into public.locali (organizzazione_id, nome, slug) select organizzazione_id, 'Finto', 'locale-finto-bd' from public.locali where id = (select v from ctx where k = 'locale') $$,
                 '42501', null, 'Il bot non crea locali');
update public.locali set nome = 'Rinominato dal bot' where id = (select v from ctx where k = 'locale');
update public.aspetto set colore_primario = '#000000' where locale_id = (select v from ctx where k = 'locale');
reset role;
select is((select nome from public.locali where id = (select v from ctx where k = 'locale')), 'Locale Bot Dedicato', 'Il bot non rinomina il locale');
select isnt((select colore_primario from public.aspetto where locale_id = (select v from ctx where k = 'locale')), '#000000', 'Il bot non cambia l''aspetto');

set local role authenticated;
select pg_temp.come((select v::text from ctx where k = 'anna'));
select lives_ok($$ insert into public.sale (locale_id, nome) select v, 'Sala vera' from ctx where k = 'locale' $$, 'La responsabile crea ancora le sale');
select ok(public.puo((select v from ctx where k = 'locale'), 'impostazioni'), 'La responsabile gestisce ancora le impostazioni');

select * from finish();
rollback;
