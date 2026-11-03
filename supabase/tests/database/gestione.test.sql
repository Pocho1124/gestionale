-- Test della gestione: utenti con controllo dell'escalation, capacità per ruolo, reparti e stampa,
-- magazzino legato alle vendite, cassa riservata all'amministratore.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

-- Lettura dello schema auth per le verifiche (lo staff non ci accede)
create function pg_temp.auth_utente(p uuid) returns auth.users language sql security definer as $f$ select * from auth.users where id = p $f$;

select plan(31);
insert into auth.users (id, email, raw_user_meta_data) values ('f1000000-0000-0000-0000-000000000001', 'titolare@gest.local', '{}');
set local role authenticated;
select pg_temp.come('f1000000-0000-0000-0000-000000000001');
select public.crea_organizzazione('Org Gest', 'Locale Gest', 'locale-gest');
reset role;
create temp table ctx (k text primary key, v uuid);
grant all on ctx to authenticated;
insert into ctx select 'locale', id from public.locali where slug = 'locale-gest';
set local role authenticated;

-- ---------------------------------------------------------------- Utenti ed escalation
insert into ctx values ('manager', public.crea_utente((select v from ctx where k = 'locale'), 'Anna', 'anna.resp', 'PasswordLunga1', 'manager'));
select ok((pg_temp.auth_utente((select v from ctx where k = 'manager'))).encrypted_password like '$2%', 'La password è salvata solo come hash bcrypt');
select is((pg_temp.auth_utente((select v from ctx where k = 'manager'))).email, 'anna.resp@staff.locale', 'Il nome utente diventa un accesso interno');
select throws_ok($$ select public.crea_utente((select v from ctx where k = 'locale'), 'X', 'secondo.titolare', 'PasswordLunga1', 'owner') $$,
                 '42501', null, 'Il ruolo di titolare non si assegna da qui');
select throws_ok($$ select public.crea_utente((select v from ctx where k = 'locale'), 'X', 'corta', 'breve', 'cameriere') $$,
                 '22023', null, 'Password troppo corta rifiutata');

select pg_temp.come((select v::text from ctx where k = 'manager'));
insert into ctx values ('caposala', public.crea_utente((select v from ctx where k = 'locale'), 'Luca', 'luca.sala', 'PasswordLunga2', 'caposala'));
insert into ctx values ('cameriere', public.crea_utente((select v from ctx where k = 'locale'), 'Sara', 'sara', 'PasswordLunga3', 'cameriere'));
insert into ctx values ('cucina', public.crea_utente((select v from ctx where k = 'locale'), 'Gino', 'gino.cucina', 'PasswordLunga4', 'cucina'));
select is((select count(*) from public.elenco_utenti((select v from ctx where k = 'locale'))), 5::bigint, 'Il responsabile vede tutto il personale');
select throws_ok($$ select public.crea_utente((select v from ctx where k = 'locale'), 'X', 'altro.resp', 'PasswordLunga1', 'manager') $$,
                 '42501', null, 'Il responsabile non crea altri responsabili');
select throws_ok($$ select public.modifica_ruolo_utente((select v from ctx where k = 'locale'), (select v from ctx where k = 'cameriere'), 'manager') $$,
                 '42501', null, 'Il responsabile non promuove nessuno al suo livello');
select throws_ok($$ select public.modifica_ruolo_utente((select v from ctx where k = 'locale'), (select v from ctx where k = 'manager'), 'caposala') $$,
                 '42501', null, 'Nessuno modifica se stesso');
select throws_ok($$ select public.reimposta_password_utente((select v from ctx where k = 'locale'), 'f1000000-0000-0000-0000-000000000001', 'PasswordNuova99') $$,
                 '42501', null, 'Il responsabile non tocca il titolare');
select lives_ok($$ select public.modifica_ruolo_utente((select v from ctx where k = 'locale'), (select v from ctx where k = 'cameriere'), 'caposala') $$,
                'Il responsabile promuove un cameriere a caposala');
select lives_ok($$ select public.modifica_ruolo_utente((select v from ctx where k = 'locale'), (select v from ctx where k = 'cameriere'), 'cameriere') $$,
                'e lo riporta a cameriere');
select lives_ok($$ select public.imposta_attivo_utente((select v from ctx where k = 'locale'), (select v from ctx where k = 'cucina'), false) $$,
                'Il responsabile disattiva un account');
select is((select attivo from public.elenco_utenti((select v from ctx where k = 'locale')) where user_id = (select v from ctx where k = 'cucina')),
          not (to_jsonb(pg_temp.auth_utente((select v from ctx where k = 'cucina'))) ? 'banned_until'),
          'L''account disattivato risulta non attivo');
select throws_ok($$ insert into public.membri (organizzazione_id, user_id, ruolo)
                    select organizzazione_id, 'f1000000-0000-0000-0000-0000000000ff', 'owner' from public.locali where id = (select v from ctx where k = 'locale') $$,
                 '42501', null, 'Nessuna scorciatoia: il responsabile non scrive direttamente i ruoli');

select pg_temp.come((select v::text from ctx where k = 'caposala'));
select throws_ok($$ select public.elenco_utenti((select v from ctx where k = 'locale')) $$, '42501', null, 'Il caposala non gestisce utenti');

-- ---------------------------------------------------------------- Reparti, prodotti, magazzino
select pg_temp.come('f1000000-0000-0000-0000-000000000001');
insert into public.stampanti (id, locale_id, nome, indirizzo) select 'f2000000-0000-0000-0000-000000000001', v, 'Cucina', '192.168.111.50' from ctx where k = 'locale';
select throws_ok($$ insert into public.stampanti (locale_id, nome, indirizzo) select v, 'X', 'stampante; rm -rf' from ctx where k = 'locale' $$,
                 '23514', null, 'L''indirizzo della stampante deve essere un IP');
insert into public.reparti (id, locale_id, nome, stampante_id) select 'f3000000-0000-0000-0000-000000000001', v, 'Cucina', 'f2000000-0000-0000-0000-000000000001' from ctx where k = 'locale';
insert into public.categorie (id, locale_id, nome, reparto_id) select 'f4000000-0000-0000-0000-000000000001', v, 'Pinse', 'f3000000-0000-0000-0000-000000000001' from ctx where k = 'locale';
insert into public.categorie (id, locale_id, nome) select 'f4000000-0000-0000-0000-000000000002', v, 'Vini' from ctx where k = 'locale';
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent) select x.id::uuid, c.v, x.cat::uuid, x.nome, x.p from ctx c,
  (values ('f5000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', 'Pinsa crudo', 1200),
          ('f5000000-0000-0000-0000-000000000002', 'f4000000-0000-0000-0000-000000000002', 'Calice rosso', 700)) x(id, cat, nome, p) where c.k = 'locale';
insert into public.articoli (id, locale_id, nome, unita, blocca_esauriti) select 'f6000000-0000-0000-0000-000000000001', v, 'Aglianico', 'l', true from ctx where k = 'locale';
select throws_ok($$ update public.articoli set giacenza = 999 $$, '42501', null, 'La giacenza non si modifica a mano');
insert into public.componenti (prodotto_id, articolo_id, locale_id, quantita)
  select 'f5000000-0000-0000-0000-000000000002', 'f6000000-0000-0000-0000-000000000001', v, 0.15 from ctx where k = 'locale';
select lives_ok($$ select public.carico_magazzino('f6000000-0000-0000-0000-000000000001', 0.45, 'Una bottiglia e mezza') $$, 'L''amministratore carica il magazzino');

-- ---------------------------------------------------------------- Vendita, stampa, annullo
insert into public.sale (id, locale_id, nome) select 'f7000000-0000-0000-0000-000000000001', v, 'Interno' from ctx where k = 'locale';
insert into public.tavoli (id, locale_id, sala_id, nome) select 'f8000000-0000-0000-0000-000000000001', v, 'f7000000-0000-0000-0000-000000000001', '1' from ctx where k = 'locale';
select pg_temp.come((select v::text from ctx where k = 'cameriere'));
select public.apri_tavolo('f8000000-0000-0000-0000-000000000001', 2);
insert into ctx values ('ordine', public.ordine_sala('f8000000-0000-0000-0000-000000000001',
  '[{"prodotto_id":"f5000000-0000-0000-0000-000000000001","quantita":2},{"prodotto_id":"f5000000-0000-0000-0000-000000000002","quantita":3}]'));
select is((select count(*) from public.comande_stampa where ordine_id = (select v from ctx where k = 'ordine') and tipo = 'comanda'), 1::bigint,
          'La comanda va in stampa al solo reparto con stampante (cucina)');
select is((select giacenza from public.articoli), 0.000, 'La vendita di 3 calici scarica 0,45 l dal magazzino');
select is((select disponibile from public.prodotti where nome = 'Calice rosso'), false, 'Finito il vino, il calice diventa esaurito da solo');
select throws_ok($$ select public.annulla_ordine((select v from ctx where k = 'ordine'), 'Errore') $$, '42501', null, 'Il cameriere non annulla gli ordini');
select throws_ok($$ select public.chiudi_cassa((select v from ctx where k = 'locale')) $$, '42501', null, 'Il cameriere non chiude la cassa');

select pg_temp.come((select v::text from ctx where k = 'caposala'));
select lives_ok($$ select public.annulla_ordine((select v from ctx where k = 'ordine'), 'Tavolo sbagliato') $$, 'Il caposala annulla l''ordine');
select is((select giacenza from public.articoli), 0.450, 'L''annullo restituisce il vino al magazzino');
select is((select disponibile from public.prodotti where nome = 'Calice rosso'), true, 'e il calice torna disponibile');
select is((select count(*) from public.comande_stampa where ordine_id = (select v from ctx where k = 'ordine') and tipo = 'annullo'), 1::bigint,
          'In cucina arriva il biglietto di annullo');

-- ---------------------------------------------------------------- Cassa
select public.ordine_sala('f8000000-0000-0000-0000-000000000001', '[{"prodotto_id":"f5000000-0000-0000-0000-000000000001","quantita":1}]');
select pg_temp.come((select v::text from ctx where k = 'manager'));
select throws_ok($$ select public.resoconto_cassa((select v from ctx where k = 'locale')) $$, '42501', null, 'Il responsabile non vede la cassa');
select pg_temp.come('f1000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.chiudi_cassa((select v from ctx where k = 'locale')) $$, '22023', null, 'Con tavoli aperti la cassa non si chiude');
select is(public.chiudi_tavolo('f8000000-0000-0000-0000-000000000001', 'carta'), 1200, 'Il conto esclude l''ordine annullato');
select is((public.chiudi_cassa((select v from ctx where k = 'locale')) ->> 'totale_cent')::int, 1200, 'La chiusura di cassa riporta l''incasso del periodo');

select * from finish();
rollback;
