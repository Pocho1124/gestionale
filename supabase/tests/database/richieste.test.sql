-- Test richieste dal tavolo: notifica allo staff, apertura automatica, codice al telefono, comande di sala.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;
create function pg_temp.anonimo() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

select plan(16);
insert into auth.users (id, email, raw_user_meta_data) values
  ('c0111111-1111-1111-1111-111111111111', 'owner@rich.local', '{}'),
  ('c0333333-3333-3333-3333-333333333333', 'cameriere@rich.local', '{}'),
  ('c0444444-4444-4444-4444-444444444444', 'cucina@rich.local', '{}');
set local role authenticated;
select pg_temp.come('c0111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Rich', 'Locale Rich', 'locale-rich');
insert into public.sale (id, locale_id, nome) select 'c1000000-0000-0000-0000-000000000001', id, 'Interno' from public.locali where slug = 'locale-rich';
insert into public.tavoli (id, locale_id, sala_id, nome, qr_token) select 'c2000000-0000-0000-0000-000000000001', id,
  'c1000000-0000-0000-0000-000000000001', '9', 'token-tavolo-nove-prova' from public.locali where slug = 'locale-rich';
insert into public.categorie (id, locale_id, nome) select 'c3000000-0000-0000-0000-000000000001', id, 'Vini' from public.locali where slug = 'locale-rich';
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent)
  select 'c4000000-0000-0000-0000-000000000001', id, 'c3000000-0000-0000-0000-000000000001', 'Calice rosso', 700 from public.locali where slug = 'locale-rich';
insert into public.membri (organizzazione_id, user_id, ruolo) select organizzazione_id, v.id::uuid, v.r::public.ruolo from public.locali,
  (values ('c0333333-3333-3333-3333-333333333333', 'cameriere'), ('c0444444-4444-4444-4444-444444444444', 'cucina')) v(id, r) where slug = 'locale-rich';
reset role;
create temp table ctx (richiesta uuid, codice text);
grant all on ctx to anon, authenticated;

-- Il cliente ordina a tavolo chiuso: nasce una richiesta
set local role anon; select pg_temp.anonimo();
insert into ctx (richiesta) select (public.richiedi_tavolo('token-tavolo-nove-prova', 'segreto-del-telefono-123',
  '[{"prodotto_id":"c4000000-0000-0000-0000-000000000001","quantita":2}]', 'Siamo in due') ->> 'richiesta')::uuid;
select ok((select richiesta is not null from ctx), 'A tavolo chiuso il cliente invia una richiesta');
select is(public.stato_richiesta('token-tavolo-nove-prova', (select richiesta from ctx), 'segreto-del-telefono-123') ->> 'stato', 'in_attesa', 'La richiesta è in attesa');
select is(public.stato_richiesta('token-tavolo-nove-prova', (select richiesta from ctx), 'segreto-sbagliato-0000000') ->> 'errore', 'Richiesta non trovata',
          'Un altro telefono non vede la richiesta');
select is(public.richiedi_tavolo('token-tavolo-nove-prova', 'corto', '[{"prodotto_id":"c4000000-0000-0000-0000-000000000001","quantita":1}]') ->> 'errore',
          'Richiesta non valida', 'Segreto troppo corto rifiutato');
select throws_ok($$ select count(*) from public.richieste_tavolo $$, '42501', null, 'Il cliente non legge le richieste');

-- Cucina no, cameriere sì
set local role authenticated; select pg_temp.come('c0444444-4444-4444-4444-444444444444');
select throws_ok($$ select public.accetta_richiesta((select richiesta from ctx), 2) $$, '42501', null, 'La cucina non accetta richieste');
select pg_temp.come('c0333333-3333-3333-3333-333333333333');
update ctx set codice = (public.accetta_richiesta((select richiesta from ctx), 2) ->> 'codice');
select ok((select codice ~ '^[0-9]{4}$' from ctx), 'Il cameriere accetta: il tavolo si apre e nasce il codice');
select is((select stato from public.ordini limit 1), 'confermato', 'L''ordine della richiesta è già confermato');
select throws_ok($$ select public.accetta_richiesta((select richiesta from ctx), 2) $$, '22023', null, 'Una richiesta non si accetta due volte');

-- Il telefono riceve il codice e da lì ordina normalmente
set local role anon; select pg_temp.anonimo();
select is(public.stato_richiesta('token-tavolo-nove-prova', (select richiesta from ctx), 'segreto-del-telefono-123') ->> 'codice',
          (select codice from ctx), 'Il codice arriva da solo sul telefono');
select is(public.invia_ordine('token-tavolo-nove-prova', (select codice from ctx), '[{"prodotto_id":"c4000000-0000-0000-0000-000000000001","quantita":1}]') ->> 'stato',
          'confermato', 'Con il codice ricevuto il cliente ordina e va diretto in cucina');

-- Un amico al tavolo già aperto: nuova richiesta, accettata senza riaprire
insert into ctx (richiesta) select (public.richiedi_tavolo('token-tavolo-nove-prova', 'telefono-amico-abcdef-99',
  '[{"prodotto_id":"c4000000-0000-0000-0000-000000000001","quantita":1}]') ->> 'richiesta')::uuid;
set local role authenticated; select pg_temp.come('c0333333-3333-3333-3333-333333333333');
select is((public.accetta_richiesta((select richiesta from ctx where codice is null), 4) ->> 'codice'), (select codice from ctx where codice is not null),
          'A tavolo aperto la richiesta usa la stessa sessione e lo stesso codice');
select is((select count(*) from public.sessioni_tavolo where chiusa_at is null), 1::bigint, 'Resta una sola sessione aperta');

-- Comanda dalla sala
select lives_ok($$ select public.ordine_sala('c2000000-0000-0000-0000-000000000001', '[{"prodotto_id":"c4000000-0000-0000-0000-000000000001","quantita":3}]', 'Al banco') $$,
                'Il cameriere aggiunge una comanda');
select pg_temp.come('c0111111-1111-1111-1111-111111111111');
select lives_ok($$ select public.chiudi_tavolo('c2000000-0000-0000-0000-000000000001', 'carta') $$, 'L''amministratore chiude il tavolo con il pagamento');
select pg_temp.come('c0333333-3333-3333-3333-333333333333');
select throws_ok($$ select public.ordine_sala('c2000000-0000-0000-0000-000000000001', '[{"prodotto_id":"c4000000-0000-0000-0000-000000000001","quantita":1}]') $$,
                 '22023', null, 'A tavolo chiuso la comanda chiede di aprirlo');

select * from finish();
rollback;
