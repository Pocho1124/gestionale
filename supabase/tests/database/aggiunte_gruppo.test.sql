-- Test del gruppo delle aggiunte: salvato, esposto dal menu pubblico e ordinato per gruppo. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(4);
insert into auth.users (id, email, raw_user_meta_data) values ('fc111111-1111-1111-1111-111111111111', 'titolare@aggiunte-gruppo.local', '{}');
set local role authenticated; select pg_temp.come('fc111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Gruppi', 'Locale Gruppi', 'locale-aggiunte-gruppo');
insert into public.categorie (id, locale_id, nome) select 'fc200000-0000-0000-0000-000000000001', id, 'Taglieri' from public.locali where slug = 'locale-aggiunte-gruppo';
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent)
  select 'fc300000-0000-0000-0000-000000000001', id, 'fc200000-0000-0000-0000-000000000001', 'Tagliere personalizzato', 1800 from public.locali where slug = 'locale-aggiunte-gruppo';
insert into public.aggiunte (locale_id, nome, prezzo_cent, gruppo)
  select id, 'Speck', 200, 'Salumi' from public.locali where slug = 'locale-aggiunte-gruppo'
  union all select id, 'Pecorino', 250, 'Formaggi' from public.locali where slug = 'locale-aggiunte-gruppo'
  union all select id, 'Miele', 100, '' from public.locali where slug = 'locale-aggiunte-gruppo';
reset role;

select is(jsonb_array_length(public.menu_pubblico('locale-aggiunte-gruppo') -> 'categorie' -> 0 -> 'aggiunte'), 3, 'Tre aggiunte valide su tutte le categorie');
select is((select array_agg(x ->> 'gruppo') from jsonb_array_elements(public.menu_pubblico('locale-aggiunte-gruppo') -> 'categorie' -> 0 -> 'aggiunte') x),
  array['', 'Formaggi', 'Salumi'], 'Gruppo esposto e aggiunte ordinate per gruppo');
select throws_ok($$ update public.aggiunte set gruppo = repeat('x', 41) $$, '23514', null, 'Gruppo di lunghezza limitata');
select throws_ok($$ update public.aggiunte set gruppo = ' Salumi' $$, '23514', null, 'Gruppo senza spazi ai bordi');

select * from finish();
rollback;
