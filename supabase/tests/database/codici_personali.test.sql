-- Test dei codici personali di sala: postazione bloccata senza codice, ruolo di chi inserisce il codice,
-- responsabile del tavolo, tentativi sbagliati, codici troppo facili, account personali invariati. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text, p_sessione text default 'sessione-1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_sessione)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(32);
insert into auth.users (id, email, raw_user_meta_data) values ('c0d10000-0000-0000-0000-000000000001', 'titolare@codici.local', '{}');
set local role authenticated;
select pg_temp.come('c0d10000-0000-0000-0000-000000000001');
select public.crea_organizzazione('Org Codici', 'Locale Codici', 'locale-codici');
reset role;
create temp table ctx (k text primary key, v uuid);
grant all on ctx to authenticated;
insert into ctx select 'locale', id from public.locali where slug = 'locale-codici';
set local role authenticated;
insert into ctx values ('sara', public.crea_utente((select v from ctx where k = 'locale'), 'Sara', 'sara.codici', 'PasswordLunga1', 'cameriere'));
insert into ctx values ('marco', public.crea_utente((select v from ctx where k = 'locale'), 'Marco', 'marco.codici', 'PasswordLunga2', 'cameriere'));
insert into ctx values ('luca', public.crea_utente((select v from ctx where k = 'locale'), 'Luca', 'luca.codici', 'PasswordLunga3', 'caposala'));
insert into ctx values ('tablet', public.crea_utente((select v from ctx where k = 'locale'), 'Tablet sala', 'tablet.sala', 'PasswordLunga4', 'cameriere'));
insert into public.sale (id, locale_id, nome) select 'c0d20000-0000-0000-0000-000000000001', v, 'Interno' from ctx where k = 'locale';
insert into public.tavoli (id, locale_id, sala_id, nome, posti, x, y)
  select x.id::uuid, c.v, 'c0d20000-0000-0000-0000-000000000001', x.nome, 4, 100, 100 from ctx c,
  (values ('c0d30000-0000-0000-0000-000000000001', '1'), ('c0d30000-0000-0000-0000-000000000002', '2'), ('c0d30000-0000-0000-0000-000000000003', '3')) x(id, nome)
  where c.k = 'locale';

-- ---------------------------------------------------------------- codici: chi li imposta e come
select lives_ok($$ select public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'sara'), '2580') $$, 'Il titolare imposta il codice di Sara');
select lives_ok($$ select public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'marco'), '1357') $$, 'Il titolare imposta il codice di Marco');
select lives_ok($$ select public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'luca'), '864297') $$, 'Codice di 6 cifre');
select throws_ok($$ select public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'sara'), '1234') $$, '22023', null, 'Cifre in fila rifiutate');
select throws_ok($$ select public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'sara'), '7777') $$, '22023', null, 'Cifre tutte uguali rifiutate');
select throws_ok($$ select public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'sara'), '12a') $$, '22023', null, 'Solo da 4 a 6 cifre');
select lives_ok($$ select public.imposta_chiede_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'tablet'), true) $$, 'Il tablet diventa una postazione con codice');
select lives_ok($$ select public.imposta_sicurezza_sala((select v from ctx where k = 'locale'), 120, true) $$, 'Il titolare attiva «solo il responsabile modifica il tavolo»');
reset role;
select ok((select hash like '$2%' and hash <> '2580' from public.codici_personali where user_id = (select v from ctx where k = 'sara')), 'Il codice è salvato solo come hash bcrypt');
set local role authenticated;

select pg_temp.come((select v::text from ctx where k = 'sara'));
select throws_ok($$ select public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'marco'), '9035') $$, '42501', null, 'Un cameriere non cambia il codice di un collega');
select throws_ok($$ select public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'sara'), '9035') $$, '42501', null, 'Per cambiare il proprio codice serve quello attuale');
select lives_ok($$ select public.imposta_codice((select v from ctx where k = 'locale'), (select v from ctx where k = 'sara'), '9035', '2580') $$, 'Con il codice attuale si cambia');
-- Account personale senza codice richiesto: come prima
select lives_ok($$ select public.apri_tavolo('c0d30000-0000-0000-0000-000000000003', 2) $$, 'Sul proprio account il cameriere lavora come prima');
select is((select responsabile from public.sessioni_tavolo where tavolo_id = 'c0d30000-0000-0000-0000-000000000003' and chiusa_at is null),
          (select v from ctx where k = 'sara'), 'Chi apre il tavolo ne diventa responsabile');

-- ---------------------------------------------------------------- postazione condivisa
select pg_temp.come((select v::text from ctx where k = 'tablet'));
select ok((public.stato_operatore((select v from ctx where k = 'locale')) ->> 'chiede_codice')::boolean, 'Il tablet chiede il codice');
select is(jsonb_array_length(public.stato_operatore((select v from ctx where k = 'locale')) -> 'personale'), 5, 'Il tastierino elenca il personale');
select throws_ok($$ select public.apri_tavolo('c0d30000-0000-0000-0000-000000000001', 2) $$, '42501', null, 'Postazione bloccata: senza codice non si apre nulla');
select ok(public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'sara'), '2580') ? 'errore', 'Il vecchio codice non vale più');
select is(public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'sara'), '9035') ->> 'nome', 'Sara', 'Con il suo codice entra Sara');
select lives_ok($$ select public.apri_tavolo('c0d30000-0000-0000-0000-000000000001', 2) $$, 'Sara apre il tavolo dal tablet');
select is((select responsabile from public.sessioni_tavolo where tavolo_id = 'c0d30000-0000-0000-0000-000000000001' and chiusa_at is null),
          (select v from ctx where k = 'sara'), 'Il tavolo è di Sara, non del tablet');
select is((select aperta_da from public.sessioni_tavolo where tavolo_id = 'c0d30000-0000-0000-0000-000000000001' and chiusa_at is null),
          (select v from ctx where k = 'sara'), 'Aperto da Sara');

select is(public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'marco'), '1357') ->> 'nome', 'Marco', 'Sullo stesso tablet entra Marco');
select throws_ok($$ select public.imposta_coperti((select id from public.sessioni_tavolo where tavolo_id = 'c0d30000-0000-0000-0000-000000000001' and chiusa_at is null), 4) $$,
                 '42501', null, 'Marco non modifica il tavolo di Sara');
select throws_ok($$ select public.prendi_tavolo((select id from public.sessioni_tavolo where tavolo_id = 'c0d30000-0000-0000-0000-000000000001' and chiusa_at is null)) $$,
                 '42501', null, 'Marco non si prende il tavolo di Sara');
select is(public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'luca'), '864297') ->> 'ruolo', 'caposala', 'Entra il caposala');
select lives_ok($$ select public.imposta_coperti((select id from public.sessioni_tavolo where tavolo_id = 'c0d30000-0000-0000-0000-000000000001' and chiusa_at is null), 4) $$,
                'Il caposala modifica qualsiasi tavolo, anche da una postazione con account da cameriere');
select lives_ok($$ select public.esci_operatore((select v from ctx where k = 'locale')) $$, 'Il caposala blocca la postazione');
select throws_ok($$ select public.apri_tavolo('c0d30000-0000-0000-0000-000000000002', 2) $$, '42501', null, 'Dopo il blocco serve di nuovo il codice');

-- ---------------------------------------------------------------- tentativi sbagliati
select is((select count(*) from (values ('1111'), ('2222'), ('3333'), ('4444'), ('5555')) t(x)
            where public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'marco'), x) ? 'errore'), 5::bigint,
          'Codici sbagliati rifiutati senza dire perché');
select ok(public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'marco'), '1357') ->> 'errore' like 'Troppi codici sbagliati%',
          'Dopo 5 codici sbagliati la postazione si blocca, anche con il codice giusto');
select pg_temp.come((select v::text from ctx where k = 'tablet'), 'sessione-2');
select is(public.entra_operatore((select v from ctx where k = 'locale'), (select v from ctx where k = 'marco'), '1357') ->> 'nome', 'Marco', 'Un altro dispositivo non è bloccato');

select * from finish();
rollback;
