-- Test dei rinforzi dei codici personali: blocco crescente sul codice di una persona da qualsiasi sessione, cambio del
-- proprio codice con tentativi contati, postazioni ed esenti senza codice, esenzione solo dal titolare, prenotazioni senza
-- codice, RLS attivo su ogni tabella. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text, p_sessione text default 'sessione-1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sessione)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(10);
insert into auth.users (id, email, raw_user_meta_data) values ('c0f10000-0000-0000-0000-000000000001', 'titolare@rinforzi-codici.local', '{}');
set local role authenticated;
select pg_temp.come('c0f10000-0000-0000-0000-000000000001');
select public.crea_organizzazione('Org Rinforzi Codici', 'Locale Rinforzi Codici', 'locale-rinforzi-codici');
reset role;
create temp table ctx (k text primary key, v uuid);
grant all on ctx to authenticated;
insert into ctx select 'locale', id from public.locali where slug = 'locale-rinforzi-codici';
set local role authenticated;
insert into ctx values ('marco', public.crea_utente((select v from ctx where k = 'locale'), 'Marco', 'marco.rc', 'PasswordLunga1', 'cameriere'));
insert into ctx values ('anna', public.crea_utente((select v from ctx where k = 'locale'), 'Anna', 'anna.rc', 'PasswordLunga2', 'manager'));
insert into ctx values ('tablet', public.crea_utente((select v from ctx where k = 'locale'), 'Tablet', 'tablet.rc', 'PasswordLunga3', 'cameriere'));
select public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'marco'), '1357');
select public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'anna'), '4682');
select public.imposta_chiede_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'tablet'), true);
select public.imposta_sicurezza_sala((select v from ctx where k = 'locale'), 120, false, true);

-- 10 codici sbagliati su Marco da sessioni diverse (il blocco del dispositivo non basta a fermarli): il codice di Marco si blocca
select pg_temp.come((select v::text from ctx where k = 'tablet'), 'sessione-a');
select public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'marco'), x) from (values ('1111'), ('2222'), ('3333'), ('4444')) t(x);
select pg_temp.come((select v::text from ctx where k = 'tablet'), 'sessione-b');
select public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'marco'), x) from (values ('1111'), ('2222'), ('3333'), ('4444')) t(x);
select pg_temp.come((select v::text from ctx where k = 'tablet'), 'sessione-c');
select public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'marco'), x) from (values ('1111'), ('2222')) t(x);
select pg_temp.come((select v::text from ctx where k = 'tablet'), 'sessione-d');
select ok(public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'marco'), '1357') ->> 'errore' like 'Codice bloccato%',
          'Dopo 10 errori il codice di Marco è bloccato da qualsiasi sessione');
reset role;
select is((select errori from public.codici_personali where user_id = (select v from ctx where k = 'marco')), 10, 'Il conteggio non si azzera al blocco');
select ok((select bloccato_fino between now() + interval '14 minutes' and now() + interval '16 minutes' from public.codici_personali
            where user_id = (select v from ctx where k = 'marco')), 'Primo blocco: 15 minuti');
update public.codici_personali set errori = 19, bloccato_fino = null where user_id = (select v from ctx where k = 'marco');
set local role authenticated;
select pg_temp.come((select v::text from ctx where k = 'tablet'), 'sessione-e');
select public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'marco'), '9999');
reset role;
select ok((select bloccato_fino > now() + interval '55 minutes' from public.codici_personali where user_id = (select v from ctx where k = 'marco')),
          'Secondo blocco: un''ora');
set local role authenticated;

-- Cambio del proprio codice: il codice attuale sbagliato conta come tentativo
select pg_temp.come((select v::text from ctx where k = 'anna'));
select is(public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'anna'), '9035', '0000') ->> 'errore',
          'Il codice attuale non è corretto', 'Codice attuale sbagliato: rifiutato');
select public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'anna'), '9035', x) from (values ('1111'), ('2222'), ('3333'), ('4444'), ('5555'), ('6666'), ('7777'), ('8888'), ('9999')) t(x);
select ok(public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'anna'), '9035', '4682') ->> 'errore' like 'Codice bloccato%',
          'Dopo 10 tentativi anche il cambio del codice è bloccato: dalla sessione aperta non si scopre il codice');

-- Postazioni ed esenti non sono persone; l'esenzione la decide solo il titolare
select ok(public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'tablet'), '1357') ? 'errore', 'La postazione non entra come persona');
select throws_ok($$ select public.imposta_esente_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'marco'), true) $$,
                 '42501', null, 'La responsabile non rende esente un cameriere');

-- Prenotazioni senza codice (aprire il tavolo all'arrivo lo chiede comunque)
select pg_temp.come((select v::text from ctx where k = 'marco'));
select lives_ok($$ insert into public.prenotazioni (locale_id, nome, persone, data_ora) select v, 'Cliente sintetico', 2, now() + interval '1 day' from ctx where k = 'locale' $$,
                'Il cameriere segna una prenotazione senza codice');

reset role;
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 0::bigint, 'Ogni tabella ha la sicurezza per riga (RLS) attiva');

select * from finish();
rollback;
