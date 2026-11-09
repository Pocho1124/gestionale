-- Test: aggiunte senza categorie valide ovunque; supplemento della nota solo dalle comande del personale. Dati sintetici.
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
create function pg_temp.prezzo(p_prodotto text) returns int language sql as $$
  select prezzo_cent from public.righe_ordine where prodotto_id = p_prodotto::uuid order by ctid desc limit 1 $$;

select plan(8);
insert into auth.users (id, email, raw_user_meta_data) values ('ea111111-1111-1111-1111-111111111111', 'titolare@supplemento.local', '{}');
set local role authenticated; select pg_temp.come('ea111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Supplemento', 'Locale Supplemento', 'locale-supplemento');
reset role;
create temp table ctx as select id as loc from public.locali where slug = 'locale-supplemento';
grant select on ctx to anon, authenticated;
insert into public.categorie (id, locale_id, nome, posizione) select x.id::uuid, loc, x.n, x.p from ctx,
  (values ('ea200000-0000-0000-0000-000000000001', 'Pinse', 0), ('ea200000-0000-0000-0000-000000000002', 'Taglieri', 1)) x(id, n, p);
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent) select x.id::uuid, loc, x.c::uuid, x.n, x.p from ctx,
  (values ('ea300000-0000-0000-0000-000000000001', 'ea200000-0000-0000-0000-000000000001', 'Pinsa bianca', 1500),
          ('ea300000-0000-0000-0000-000000000002', 'ea200000-0000-0000-0000-000000000002', 'Tagliere misto', 2000)) x(id, c, n, p);
insert into public.aggiunte (id, locale_id, nome, prezzo_cent) select 'ea400000-0000-0000-0000-000000000001', loc, 'Burrata', 300 from ctx;
insert into public.sale (id, locale_id, nome) select 'ea500000-0000-0000-0000-000000000001', loc, 'Interno' from ctx;
insert into public.tavoli (id, locale_id, sala_id, nome, qr_token) select 'ea600000-0000-0000-0000-000000000001', loc,
  'ea500000-0000-0000-0000-000000000001', '3', 'token-tavolo-tre-supplemento' from ctx;

-- Aggiunta senza categorie: vale per tutte
select is(jsonb_array_length(public.menu_pubblico('locale-supplemento') -> 'categorie' -> 1 -> 'aggiunte'), 1,
          'Senza categorie scelte l''aggiunta compare su tutte le categorie');
set local role authenticated; select pg_temp.come('ea111111-1111-1111-1111-111111111111');
select public.apri_tavolo('ea600000-0000-0000-0000-000000000001', 2);
select public.ordine_sala('ea600000-0000-0000-0000-000000000001',
  '[{"prodotto_id":"ea300000-0000-0000-0000-000000000002","quantita":1,"opzioni":["ea400000-0000-0000-0000-000000000001"]}]');
select is(pg_temp.prezzo('ea300000-0000-0000-0000-000000000002'), 2300, 'Tagliere 20 € + burrata 3 €');
reset role;
insert into public.aggiunte_categorie (aggiunta_id, categoria_id, locale_id) select 'ea400000-0000-0000-0000-000000000001', 'ea200000-0000-0000-0000-000000000001', loc from ctx;
set local role authenticated; select pg_temp.come('ea111111-1111-1111-1111-111111111111');
select throws_ok($$ select public.ordine_sala('ea600000-0000-0000-0000-000000000001',
  '[{"prodotto_id":"ea300000-0000-0000-0000-000000000002","quantita":1,"opzioni":["ea400000-0000-0000-0000-000000000001"]}]') $$, '22023', null,
  'Scelte le categorie, l''aggiunta vale solo lì');

-- Supplemento della nota dal tablet
select public.ordine_sala('ea600000-0000-0000-0000-000000000001',
  '[{"prodotto_id":"ea300000-0000-0000-0000-000000000001","quantita":1,"nota":"doppia mozzarella","supplemento_cent":250,"prezzo_cent":1}]');
select is(pg_temp.prezzo('ea300000-0000-0000-0000-000000000001'), 1750, 'Pinsa 15 € + supplemento della nota 2,50 €');
select is((select opzioni -> -1 ->> 'nome' || ' ' || (opzioni -> -1 ->> 'sovrapprezzo_cent') || ' · ' || nota
           from public.righe_ordine where prodotto_id = 'ea300000-0000-0000-0000-000000000001'), '+ Supplemento 250 · doppia mozzarella',
          'Il supplemento resta nelle scelte della riga, la nota resta per la cucina');
select throws_ok($$ select public.ordine_sala('ea600000-0000-0000-0000-000000000001',
  '[{"prodotto_id":"ea300000-0000-0000-0000-000000000001","quantita":1,"supplemento_cent":10001}]') $$, '22023', null, 'Supplemento oltre 100 € rifiutato');
select throws_ok($$ select public.ordine_sala('ea600000-0000-0000-0000-000000000001',
  '[{"prodotto_id":"ea300000-0000-0000-0000-000000000001","quantita":1,"supplemento_cent":-200}]') $$, '22023', null, 'Supplemento negativo rifiutato');

-- Dal telefono il supplemento è ignorato
reset role;
create temp table cod as select codice from public.sessioni_tavolo where chiusa_at is null and tavolo_id = 'ea600000-0000-0000-0000-000000000001';
grant select on cod to anon;
set local role anon; select pg_temp.anonimo();
select public.invia_ordine('token-tavolo-tre-supplemento', (select codice from cod),
  '[{"prodotto_id":"ea300000-0000-0000-0000-000000000001","quantita":1,"supplemento_cent":5000}]');
reset role;
select is((select prezzo_cent from public.righe_ordine r join public.ordini o on o.id = r.ordine_id
           where o.origine <> 'sala' and r.prodotto_id = 'ea300000-0000-0000-0000-000000000001'), 1500,
          'Dal telefono del cliente il supplemento non passa');

select * from finish();
rollback;
