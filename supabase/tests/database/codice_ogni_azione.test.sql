-- Test del codice a ogni azione: durata 0 predefinita, codice valido solo 30 secondi, validità a minuti ancora possibile. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text, p_sessione text default 'sessione-1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sessione)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(5);
insert into auth.users (id, email, raw_user_meta_data) values ('c1a10000-0000-0000-0000-000000000001', 'titolare@ogni-azione.local', '{}');
set local role authenticated;
select pg_temp.come('c1a10000-0000-0000-0000-000000000001');
select public.crea_organizzazione('Org Ogni Azione', 'Locale Ogni Azione', 'locale-ogni-azione');
reset role;
create temp table ctx (k text primary key, v uuid);
grant all on ctx to authenticated;
insert into ctx select 'locale', id from public.locali where slug = 'locale-ogni-azione';
set local role authenticated;
insert into ctx values ('sara', public.crea_utente((select v from ctx where k = 'locale'), 'Sara', 'sara.oa', 'PasswordLunga1', 'cameriere'));
select public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'sara'), '2580');

select is((public.stato_operatore((select v from ctx where k = 'locale')) ->> 'durata_secondi')::int, 0, 'Senza impostazioni: codice a ogni azione');
select lives_ok($$ select public.imposta_sicurezza_sala((select v from ctx where k = 'locale'), 0, false, true) $$, 'Durata 0 accettata');
select ok((public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'sara'), '2580') ->> 'scade_at')::timestamptz
          between now() + interval '25 seconds' and now() + interval '35 seconds', 'A ogni azione il codice vale solo 30 secondi');
select lives_ok($$ select public.imposta_sicurezza_sala((select v from ctx where k = 'locale'), 300, false, true) $$, 'Si può ancora scegliere una validità di 5 minuti');
select throws_ok($$ select public.imposta_sicurezza_sala((select v from ctx where k = 'locale'), 10, false, true) $$, '23514', null, 'Durate tra 1 e 29 secondi rifiutate');

select * from finish();
rollback;
