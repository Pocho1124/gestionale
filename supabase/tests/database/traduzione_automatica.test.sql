-- Test della traduzione automatica: colonna dello stato, scrivibile da chi gestisce il catalogo, non dagli altri. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(4);
insert into auth.users (id, email, raw_user_meta_data) values
  ('f9111111-1111-1111-1111-111111111111', 'responsabile@traduce.local', '{}'),
  ('f9333333-3333-3333-3333-333333333333', 'cameriere@traduce.local', '{}');
set local role authenticated; select pg_temp.come('f9111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Traduce', 'Locale Traduce', 'locale-traduce');
insert into public.categorie (id, locale_id, nome) select 'f9200000-0000-0000-0000-000000000001', id, 'Taglieri' from public.locali where slug = 'locale-traduce';
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent)
  select 'f9300000-0000-0000-0000-000000000001', id, 'f9200000-0000-0000-0000-000000000001', 'Tagliere misto', 1800 from public.locali where slug = 'locale-traduce';
reset role;
insert into public.membri (organizzazione_id, user_id, ruolo)
  select organizzazione_id, 'f9333333-3333-3333-3333-333333333333', 'cameriere' from public.locali where slug = 'locale-traduce';

select is((select traduzione_da from public.prodotti where id = 'f9300000-0000-0000-0000-000000000001'), '', 'Un piatto nuovo è da tradurre');
set local role authenticated; select pg_temp.come('f9111111-1111-1111-1111-111111111111');
select lives_ok($$ update public.prodotti set nome_en = 'Mixed board', traduzione_da = 'a1b2c3d4e5f60718' where id = 'f9300000-0000-0000-0000-000000000001' $$,
                'Chi gestisce il catalogo (anche il bot) salva la traduzione');
select pg_temp.come('f9333333-3333-3333-3333-333333333333');
select is_empty($$ update public.prodotti set traduzione_da = 'manuale' returning id $$, 'Il cameriere non tocca le traduzioni');
reset role;
select throws_ok($$ update public.prodotti set traduzione_da = repeat('x', 81) $$, '23514', null, 'Stato della traduzione di lunghezza limitata');

select * from finish();
rollback;
