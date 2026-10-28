-- Test F1: catalogo, permessi per ruolo, azioni del backoffice, menu pubblico.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

-- Imposta l'identità dell'utente di test (claims recenti + claim legacy)
create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(24);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111111', 'owner@catalogo.local',     '{}'),
  ('a2222222-2222-2222-2222-222222222222', 'estraneo@catalogo.local',  '{}'),
  ('a3333333-3333-3333-3333-333333333333', 'cameriere@catalogo.local', '{}');

-- ---------- Owner: struttura del catalogo ----------
set local role authenticated;
select pg_temp.come('a1111111-1111-1111-1111-111111111111');

select lives_ok($$ select public.crea_organizzazione('Org Catalogo', 'Pizzeria Test', 'pizzeria-test') $$,
                'L''owner crea il locale');
select is((select count(*) from public.aspetto), 1::bigint, 'Il locale nasce con l''aspetto predefinito');

reset role;
create temp table ctx as select o.id as org, l.id as loc
  from public.organizzazioni o join public.locali l on l.organizzazione_id = o.id where l.slug = 'pizzeria-test';
grant select on ctx to authenticated, anon;
set local role authenticated;

select lives_ok($$ insert into public.categorie (id, locale_id, nome)
                   select 'c0000000-0000-0000-0000-000000000001', loc, 'Pizze' from ctx $$,
                'L''owner crea una categoria');
select lives_ok($$ insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent, allergeni, visibile)
                   select v.id::uuid, loc, 'c0000000-0000-0000-0000-000000000001', v.nome, v.prezzo, v.alg::text[], v.vis
                   from ctx, (values
                     ('d0000000-0000-0000-0000-000000000001', 'Margherita', 650, '{Glutine,Latte}', true),
                     ('d0000000-0000-0000-0000-000000000002', 'Segreta',    900, '{}',              false)
                   ) as v(id, nome, prezzo, alg, vis) $$,
                'L''owner crea i prodotti');
select throws_ok($$ insert into public.prodotti (locale_id, categoria_id, nome, prezzo_cent)
                    select loc, 'c0000000-0000-0000-0000-000000000001', 'Errata', -100 from ctx $$,
                 '23514', null, 'Un prezzo negativo viene rifiutato');
select throws_ok($$ insert into public.prodotti (locale_id, categoria_id, nome, allergeni)
                    select loc, 'c0000000-0000-0000-0000-000000000001', 'Errata', '{Cioccolato}' from ctx $$,
                 '23514', null, 'Un allergene fuori elenco viene rifiutato');
select throws_ok($$ update public.aspetto set colore_primario = 'blu' $$,
                 '23514', null, 'Un colore non valido viene rifiutato');
select lives_ok($$ update public.aspetto set colore_primario = '#0B2545', layout = 'griglia' $$,
                'L''owner cambia l''aspetto');

-- Un prodotto non può puntare alla categoria di un altro locale
select lives_ok($$ insert into public.locali (id, organizzazione_id, nome, slug)
                   select 'e0000000-0000-0000-0000-000000000002', org, 'Secondo locale', 'secondo-test' from ctx $$,
                'L''owner apre un secondo locale');
select throws_ok($$ insert into public.prodotti (locale_id, categoria_id, nome)
                    values ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'Incrociato') $$,
                 '23503', null, 'Il prodotto non può usare la categoria di un altro locale');

select is((select public.varia_prezzi(loc, 5) from ctx), 2, 'Variazione +5% su tutto il locale');
select is((select prezzo_cent from public.prodotti where id = 'd0000000-0000-0000-0000-000000000001'),
          680, 'La Margherita passa da 6,50 a 6,80 €');
select ok((select count(*) from public.audit_log where tabella = 'prodotti' and azione = 'UPDATE') >= 2,
          'L''audit registra le modifiche di prezzo');

select lives_ok($$ insert into public.membri (organizzazione_id, user_id, ruolo)
                   select org, 'a3333333-3333-3333-3333-333333333333', 'cameriere' from ctx $$,
                'L''owner aggiunge un cameriere');

-- ---------- Estraneo ----------
select pg_temp.come('a2222222-2222-2222-2222-222222222222');
select is((select count(*) from public.prodotti), 0::bigint, 'Un estraneo non vede il catalogo altrui');
select throws_ok($$ select public.imposta_disponibilita('d0000000-0000-0000-0000-000000000001', false) $$,
                 '42501', null, 'Un estraneo non può segnare esaurito un piatto');
select throws_ok($$ insert into public.prodotti (locale_id, categoria_id, nome)
                    select loc, 'c0000000-0000-0000-0000-000000000001', 'Intruso' from ctx $$,
                 '42501', null, 'Un estraneo non può aggiungere prodotti');

-- ---------- Cameriere ----------
select pg_temp.come('a3333333-3333-3333-3333-333333333333');
select is((select count(*) from public.prodotti), 2::bigint, 'Il cameriere vede il catalogo');
select is_empty($$ update public.prodotti set prezzo_cent = 1 returning id $$,
                'Il cameriere non può cambiare i prezzi');
select lives_ok($$ select public.imposta_disponibilita('d0000000-0000-0000-0000-000000000001', false) $$,
                'Il cameriere segna esaurita la Margherita');
select is((select disponibile from public.prodotti where id = 'd0000000-0000-0000-0000-000000000001'),
          false, 'La Margherita risulta esaurita');

-- ---------- Anonimo: solo menu pubblico ----------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$ select count(*) from public.prodotti $$, '42501', null,
                 'Anon non legge le tabelle del catalogo');
select is((select jsonb_array_length(public.menu_pubblico('pizzeria-test') -> 'categorie' -> 0 -> 'prodotti')),
          1, 'Il menu pubblico mostra solo i prodotti visibili');
select is((select public.menu_pubblico('pizzeria-test') -> 'aspetto' ->> 'colore_primario'),
          '#0B2545', 'Il menu pubblico usa l''aspetto del locale');

select * from finish();
rollback;
