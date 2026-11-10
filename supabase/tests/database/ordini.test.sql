-- Test ordini dal tavolo: QR + codice, tavolo aperto, conferma dello staff, permessi, blocco dei tentativi.
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
  ('b0111111-1111-1111-1111-111111111111', 'owner@ordini.local', '{}'),
  ('b0333333-3333-3333-3333-333333333333', 'cameriere@ordini.local', '{}'),
  ('b0444444-4444-4444-4444-444444444444', 'cucina@ordini.local', '{}');

set local role authenticated;
select pg_temp.come('b0111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Ordini', 'Locale Ordini', 'locale-ordini');
insert into public.sale (id, locale_id, nome) select 'b1000000-0000-0000-0000-000000000001', id, 'Interno' from public.locali where slug = 'locale-ordini';
insert into public.tavoli (id, locale_id, sala_id, nome, qr_token) select 'b2000000-0000-0000-0000-000000000001', id,
  'b1000000-0000-0000-0000-000000000001', '7', 'token-di-prova-tavolo-7' from public.locali where slug = 'locale-ordini';
insert into public.categorie (id, locale_id, nome) select 'b3000000-0000-0000-0000-000000000001', id, 'Pinse' from public.locali where slug = 'locale-ordini';
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent, disponibile)
  select v.id::uuid, l.id, 'b3000000-0000-0000-0000-000000000001', v.nome, v.p, v.d from public.locali l,
  (values ('b4000000-0000-0000-0000-000000000001', 'Pinsa crudo', 1200, true), ('b4000000-0000-0000-0000-000000000002', 'Pinsa finita', 1000, false)) v(id, nome, p, d)
  where l.slug = 'locale-ordini';
insert into public.membri (organizzazione_id, user_id, ruolo) select organizzazione_id, v.id::uuid, v.r::public.ruolo from public.locali,
  (values ('b0333333-3333-3333-3333-333333333333', 'cameriere'), ('b0444444-4444-4444-4444-444444444444', 'cucina')) v(id, r) where slug = 'locale-ordini';

-- Tavolo chiuso: niente ordini
set local role anon; select pg_temp.anonimo();
select is(public.tavolo_cliente('token-di-prova-tavolo-7') ->> 'aperto', 'false', 'Il cliente vede il tavolo come chiuso');
select ok(public.invia_ordine('token-di-prova-tavolo-7', '0000', '[{"prodotto_id":"b4000000-0000-0000-0000-000000000001","quantita":1}]') ? 'errore',
          'Con il tavolo chiuso l''ordine è rifiutato');
select is(public.tavolo_cliente('token-falso'), null, 'Un QR inventato non porta a nessun tavolo');

-- Il cameriere apre il tavolo
set local role authenticated; select pg_temp.come('b0333333-3333-3333-3333-333333333333');
select ok((select codice ~ '^[0-9]{4}$' from public.apri_tavolo('b2000000-0000-0000-0000-000000000001', 2)), 'Il cameriere apre il tavolo 7');
reset role;
create temp table ctx as select codice from public.sessioni_tavolo where tavolo_id = 'b2000000-0000-0000-0000-000000000001' and chiusa_at is null;
grant select on ctx to anon, authenticated;

set local role anon; select pg_temp.anonimo();
select is(public.invia_ordine('token-di-prova-tavolo-7', 'xxxx', '[{"prodotto_id":"b4000000-0000-0000-0000-000000000001","quantita":1}]') ->> 'errore',
          'Codice del tavolo non corretto', 'Un codice sbagliato è rifiutato');
select throws_ok($$ select public.invia_ordine('token-di-prova-tavolo-7', (select codice from ctx),
                    '[{"prodotto_id":"b4000000-0000-0000-0000-000000000002","quantita":1}]') $$, '22023', null, 'Un piatto esaurito non si ordina');
select is(public.invia_ordine('token-di-prova-tavolo-7', (select codice from ctx),
          '[{"prodotto_id":"b4000000-0000-0000-0000-000000000001","quantita":2,"nota":"senza rucola"}]', 'Siamo di fretta') ->> 'stato',
          'confermato', 'Con QR e codice giusti l''ordine va diretto in cucina');
select is(jsonb_array_length(public.ordini_tavolo('token-di-prova-tavolo-7', (select codice from ctx)) -> 'ordini'), 1, 'Il cliente vede il suo ordine');
select throws_ok($$ select count(*) from public.ordini $$, '42501', null, 'Il cliente non legge la tabella degli ordini');
select throws_ok($$ select public.verifica_tavolo('token-di-prova-tavolo-7', '0000') $$, '42501', null, 'La verifica interna non è richiamabile dal cliente');

-- Lo staff decide (ordine da confermare creato a mano per provare i permessi)
reset role;
insert into public.ordini (id, locale_id, sessione_id, tavolo_id, stato)
  select 'b5000000-0000-0000-0000-000000000001', locale_id, id, tavolo_id, 'da_confermare' from public.sessioni_tavolo where chiusa_at is null;
set local role authenticated; select pg_temp.come('b0444444-4444-4444-4444-444444444444');
select throws_ok($$ select public.decidi_ordine('b5000000-0000-0000-0000-000000000001', true) $$, '42501', null, 'La cucina non conferma gli ordini');
select pg_temp.come('b0333333-3333-3333-3333-333333333333');
select lives_ok($$ select public.decidi_ordine('b5000000-0000-0000-0000-000000000001', true) $$, 'Il cameriere conferma l''ordine');
select is((select sum(prezzo_cent * quantita)::int from public.righe_ordine), 2400, 'Il prezzo è copiato nell''ordine');
select pg_temp.come('b0444444-4444-4444-4444-444444444444');
select lives_ok($$ select public.avanza_ordine('b5000000-0000-0000-0000-000000000001', 'in_preparazione') $$, 'La cucina mette in preparazione');
select throws_ok($$ select public.avanza_ordine('b5000000-0000-0000-0000-000000000001', 'servito') $$, '22023', null, 'Non si saltano i passaggi');

-- Dieci codici sbagliati bloccano il tavolo
set local role anon; select pg_temp.anonimo();
select public.invia_ordine('token-di-prova-tavolo-7', 'zzzz', '[]') from generate_series(1, 10);
select is(public.invia_ordine('token-di-prova-tavolo-7', (select codice from ctx), '[{"prodotto_id":"b4000000-0000-0000-0000-000000000001","quantita":1}]') ->> 'errore',
          'Troppi tentativi: riprova tra qualche minuto o chiedi al personale', 'Dopo 10 codici sbagliati il codice si blocca per qualche minuto, anche quello giusto');

select * from finish();
rollback;
