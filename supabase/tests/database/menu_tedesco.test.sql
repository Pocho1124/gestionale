-- Test del menu in tedesco: il menu pubblico espone nomi, descrizioni e note dei vini in tedesco. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(5);
insert into auth.users (id, email, raw_user_meta_data) values ('fd111111-1111-1111-1111-111111111111', 'titolare@tedesco.local', '{}');
set local role authenticated; select pg_temp.come('fd111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Tedesco', 'Locale Tedesco', 'locale-menu-de');
insert into public.categorie (id, locale_id, nome, nome_de) select 'fd200000-0000-0000-0000-000000000001', id, 'Rossi', 'Rotweine' from public.locali where slug = 'locale-menu-de';
insert into public.prodotti (id, locale_id, categoria_id, nome, descrizione, descrizione_de, prezzo_cent)
  select 'fd300000-0000-0000-0000-000000000001', id, 'fd200000-0000-0000-0000-000000000001', 'Taurasi', 'Rosso strutturato', 'Kräftiger Rotwein', 900 from public.locali where slug = 'locale-menu-de';
insert into public.vini (prodotto_id, locale_id, tipo, corpo, note, note_de)
  select 'fd300000-0000-0000-0000-000000000001', id, 'rosso', 'strutturato', 'Affinato in botte', 'Im Holzfass gereift' from public.locali where slug = 'locale-menu-de';
reset role;

select is(public.menu_pubblico('locale-menu-de') -> 'categorie' -> 0 ->> 'nome_de', 'Rotweine', 'Nome della categoria in tedesco');
select is(public.menu_pubblico('locale-menu-de') -> 'categorie' -> 0 -> 'prodotti' -> 0 ->> 'descrizione_de', 'Kräftiger Rotwein', 'Descrizione in tedesco');
select is(public.menu_pubblico('locale-menu-de') -> 'categorie' -> 0 -> 'prodotti' -> 0 -> 'vino' ->> 'note_de', 'Im Holzfass gereift', 'Note del vino in tedesco');
select is(public.menu_pubblico('locale-menu-de') -> 'categorie' -> 0 -> 'prodotti' -> 0 ->> 'descrizione', 'Rosso strutturato', 'L''italiano resta');
select throws_ok($$ update public.prodotti set descrizione_de = repeat('x', 1001) $$, '23514', null, 'Descrizione tedesca di lunghezza limitata');

select * from finish();
rollback;
