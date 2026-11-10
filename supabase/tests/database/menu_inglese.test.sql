-- Test del menu in inglese: campi facoltativi, limiti di lunghezza, esposti dal menu pubblico. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(4);
insert into auth.users (id, email, raw_user_meta_data) values ('f7111111-1111-1111-1111-111111111111', 'titolare@inglese.local', '{}');
set local role authenticated; select pg_temp.come('f7111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Inglese', 'Locale Inglese', 'locale-inglese');
insert into public.categorie (id, locale_id, nome, nome_en) select 'f7200000-0000-0000-0000-000000000001', id, 'Taglieri', 'Boards'
  from public.locali where slug = 'locale-inglese';
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent, nome_en, descrizione_en)
  select 'f7300000-0000-0000-0000-000000000001', id, 'f7200000-0000-0000-0000-000000000001', 'Tagliere misto', 1800, 'Mixed board', 'Cured meats and cheeses'
  from public.locali where slug = 'locale-inglese';
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent)
  select 'f7300000-0000-0000-0000-000000000002', id, 'f7200000-0000-0000-0000-000000000001', 'Bruschetta', 500 from public.locali where slug = 'locale-inglese';
reset role;

select is(public.menu_pubblico('locale-inglese') -> 'categorie' -> 0 ->> 'nome_en', 'Boards', 'Il menu pubblico porta il nome inglese della categoria');
select is(public.menu_pubblico('locale-inglese') -> 'categorie' -> 0 -> 'prodotti' -> 1 ->> 'descrizione_en', 'Cured meats and cheeses',
          'E la descrizione inglese del piatto');
select is(public.menu_pubblico('locale-inglese') -> 'categorie' -> 0 -> 'prodotti' -> 0 ->> 'nome_en', '', 'Senza traduzione il campo è vuoto');
select throws_ok($$ update public.prodotti set nome_en = repeat('x', 121) where id = 'f7300000-0000-0000-0000-000000000002' $$, '23514', null,
                 'Nome inglese troppo lungo rifiutato');

select * from finish();
rollback;
