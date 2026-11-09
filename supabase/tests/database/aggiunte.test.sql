-- Test delle aggiunte: permessi, categorie, prezzo calcolato dal database, limiti, telefono del cliente. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;
create function pg_temp.anonimo() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('request.jwt.claim.sub', '', true); end $$;
-- Riga d'ordine del prodotto indicato con le voci indicate (il prezzo inviato dal client va ignorato)
create function pg_temp.riga(p_prodotto text, p_voci text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('prodotto_id', p_prodotto, 'quantita', 1, 'opzioni', p_voci::jsonb, 'prezzo_cent', 1));
$$;

select plan(16);
insert into auth.users (id, email, raw_user_meta_data) values
  ('e0111111-1111-1111-1111-111111111111', 'titolare@aggiunte.local', '{}'),
  ('e0222222-2222-2222-2222-222222222222', 'cameriere@aggiunte.local', '{}'),
  ('e0333333-3333-3333-3333-333333333333', 'altro@aggiunte.local', '{}');
set local role authenticated;
select pg_temp.come('e0333333-3333-3333-3333-333333333333');
select public.crea_organizzazione('Org Altra', 'Locale Altro', 'locale-altro-agg');
select pg_temp.come('e0111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Aggiunte', 'Locale Aggiunte', 'locale-aggiunte');
reset role;
create temp table ctx as select id as loc from public.locali where slug = 'locale-aggiunte';
grant select on ctx to anon, authenticated;
insert into public.membri (organizzazione_id, user_id, ruolo)
  select organizzazione_id, 'e0222222-2222-2222-2222-222222222222', 'cameriere' from public.locali where slug = 'locale-aggiunte';
insert into public.categorie (id, locale_id, nome, posizione) select x.id::uuid, loc, x.n, x.p from ctx,
  (values ('e1000000-0000-0000-0000-000000000001', 'Pizze', 0), ('e1000000-0000-0000-0000-000000000002', 'Vini', 1)) x(id, n, p);
insert into public.categorie (id, locale_id, nome) select 'e1000000-0000-0000-0000-000000000009', id, 'Altrove' from public.locali where slug = 'locale-altro-agg';
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent) select x.id::uuid, loc, x.c::uuid, x.n, x.p from ctx,
  (values ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'Margherita', 800),
          ('e2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'Calice rosso', 600)) x(id, c, n, p);
insert into public.sale (id, locale_id, nome) select 'e3000000-0000-0000-0000-000000000001', loc, 'Interno' from ctx;
insert into public.tavoli (id, locale_id, sala_id, nome, qr_token) select 'e4000000-0000-0000-0000-000000000001', loc,
  'e3000000-0000-0000-0000-000000000001', '5', 'token-tavolo-cinque-aggiunte' from ctx;

-- Solo chi gestisce il catalogo crea le aggiunte
set local role authenticated; select pg_temp.come('e0222222-2222-2222-2222-222222222222');
select throws_ok($$ insert into public.aggiunte (locale_id, nome, prezzo_cent) select loc, 'Abusiva', 1 from ctx $$, '42501', null,
                 'Il cameriere non crea aggiunte');
select pg_temp.come('e0111111-1111-1111-1111-111111111111');
select lives_ok($$ insert into public.aggiunte (id, locale_id, nome, prezzo_cent, disponibile, posizione) select x.id::uuid, loc, x.n, x.p, x.d, x.pos from ctx,
  (values ('e5000000-0000-0000-0000-000000000001', 'Mozzarella di bufala', 200, true, 0),
          ('e5000000-0000-0000-0000-000000000002', 'Acciughe', 150, true, 1),
          ('e5000000-0000-0000-0000-000000000003', 'Tartufo', 500, false, 2)) x(id, n, p, d, pos) $$, 'Il titolare crea le aggiunte');
select lives_ok($$ insert into public.aggiunte_categorie (aggiunta_id, categoria_id, locale_id)
  select a.id, 'e1000000-0000-0000-0000-000000000001', a.locale_id from public.aggiunte a $$, 'Il titolare le attiva sulle Pizze');
select throws_ok($$ insert into public.aggiunte (locale_id, nome) select loc, '  mozzarella DI bufala ' from ctx $$, '23505', null,
                 'Nome già presente (maiuscole e spazi non contano)');
select throws_ok($$ insert into public.aggiunte (locale_id, nome, prezzo_cent) select loc, 'Negativa', -100 from ctx $$, '23514', null,
                 'Prezzo negativo rifiutato');
reset role;
select throws_ok($$ insert into public.aggiunte_categorie (aggiunta_id, categoria_id, locale_id)
  values ('e5000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000009', (select loc from ctx)) $$, '23503', null,
  'Un''aggiunta non si collega alla categoria di un altro locale');

-- Menu: solo le aggiunte disponibili, solo dove sono attive
select is(public.menu_pubblico('locale-aggiunte') -> 'categorie' -> 0 -> 'aggiunte',
          '[{"id": "e5000000-0000-0000-0000-000000000001", "nome": "Mozzarella di bufala", "sovrapprezzo_cent": 200},
            {"id": "e5000000-0000-0000-0000-000000000002", "nome": "Acciughe", "sovrapprezzo_cent": 150}]'::jsonb,
          'Le Pizze mostrano le aggiunte disponibili, in ordine');
select is(public.menu_pubblico('locale-aggiunte') -> 'categorie' -> 1 -> 'aggiunte', '[]'::jsonb, 'I Vini non hanno aggiunte');

-- Dal tablet: prezzo dal database
set local role authenticated; select pg_temp.come('e0222222-2222-2222-2222-222222222222');
select public.apri_tavolo('e4000000-0000-0000-0000-000000000001', 2);
select public.ordine_sala('e4000000-0000-0000-0000-000000000001', pg_temp.riga('e2000000-0000-0000-0000-000000000001',
  '["e5000000-0000-0000-0000-000000000001","e5000000-0000-0000-0000-000000000002"]'));
select is((select prezzo_cent from public.righe_ordine where prodotto_id = 'e2000000-0000-0000-0000-000000000001'), 1150,
          'Margherita 8 € + bufala 2 € + acciughe 1,50 € = 11,50 € (il prezzo del client è ignorato)');
select is((select opzioni -> 0 ->> 'nome' || ' / ' || (opzioni -> 0 ->> 'gruppo') from public.righe_ordine where prodotto_id = 'e2000000-0000-0000-0000-000000000001'),
          '+ Mozzarella di bufala / Aggiunte', 'In comanda l''aggiunta si riconosce dal «+»');
select throws_ok($$ select public.ordine_sala('e4000000-0000-0000-0000-000000000001', pg_temp.riga('e2000000-0000-0000-0000-000000000002',
  '["e5000000-0000-0000-0000-000000000001"]')) $$, '22023', null, 'Aggiunta su una categoria dove non è attiva: rifiutata');
select throws_ok($$ select public.ordine_sala('e4000000-0000-0000-0000-000000000001', pg_temp.riga('e2000000-0000-0000-0000-000000000001',
  '["e5000000-0000-0000-0000-000000000003"]')) $$, '22023', null, 'Aggiunta non disponibile: rifiutata');
reset role;
insert into public.aggiunte (id, locale_id, nome) select ('e6000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, loc, 'Extra ' || n
  from ctx, generate_series(1, 11) n;
insert into public.aggiunte_categorie (aggiunta_id, categoria_id, locale_id)
  select id, 'e1000000-0000-0000-0000-000000000001', locale_id from public.aggiunte where nome like 'Extra %';
set local role authenticated; select pg_temp.come('e0222222-2222-2222-2222-222222222222');
select throws_ok($$ select public.ordine_sala('e4000000-0000-0000-0000-000000000001', pg_temp.riga('e2000000-0000-0000-0000-000000000001',
  (select jsonb_agg(id)::text from public.aggiunte where nome like 'Extra %'))) $$, '22023', 'Al massimo 10 aggiunte per piatto', 'Oltre 10 aggiunte rifiutate');

-- Dal telefono del cliente
reset role;
create temp table cod as select codice from public.sessioni_tavolo where chiusa_at is null and tavolo_id = 'e4000000-0000-0000-0000-000000000001';
grant select on cod to anon;
set local role anon; select pg_temp.anonimo();
select throws_ok($$ select count(*) from public.aggiunte $$, '42501', null, 'Il pubblico non legge la tabella delle aggiunte');
select is(public.invia_ordine('token-tavolo-cinque-aggiunte', (select codice from cod),
            pg_temp.riga('e2000000-0000-0000-0000-000000000001', '["e5000000-0000-0000-0000-000000000002"]')) ->> 'stato',
          'confermato', 'Il cliente aggiunge le acciughe dal telefono');
select ok(public.ordini_tavolo('token-tavolo-cinque-aggiunte', (select codice from cod))::text like '%"opzioni": ["+ Acciughe"]%',
          'Il cliente rivede l''aggiunta negli ordini inviati');

select * from finish();
rollback;
