-- Test del menu in spagnolo: il menu pubblico espone nomi, descrizioni e note dei vini in spagnolo. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(5);
insert into auth.users (id, email, raw_user_meta_data) values ('fb111111-1111-1111-1111-111111111111', 'titolare@spagnolo.local', '{}');
set local role authenticated; select pg_temp.come('fb111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Spagnolo', 'Locale Spagnolo', 'locale-menu-es');
insert into public.categorie (id, locale_id, nome, nome_es) select 'fb200000-0000-0000-0000-000000000001', id, 'Rossi', 'Tintos' from public.locali where slug = 'locale-menu-es';
insert into public.prodotti (id, locale_id, categoria_id, nome, descrizione, descrizione_es, prezzo_cent)
  select 'fb300000-0000-0000-0000-000000000001', id, 'fb200000-0000-0000-0000-000000000001', 'Taurasi', 'Rosso strutturato', 'Tinto con cuerpo', 900 from public.locali where slug = 'locale-menu-es';
insert into public.vini (prodotto_id, locale_id, tipo, corpo, note, note_es)
  select 'fb300000-0000-0000-0000-000000000001', id, 'rosso', 'strutturato', 'Affinato in botte', 'Criado en barrica' from public.locali where slug = 'locale-menu-es';
reset role;

select is(public.menu_pubblico('locale-menu-es') -> 'categorie' -> 0 ->> 'nome_es', 'Tintos', 'Nome della categoria in spagnolo');
select is(public.menu_pubblico('locale-menu-es') -> 'categorie' -> 0 -> 'prodotti' -> 0 ->> 'descrizione_es', 'Tinto con cuerpo', 'Descrizione in spagnolo');
select is(public.menu_pubblico('locale-menu-es') -> 'categorie' -> 0 -> 'prodotti' -> 0 -> 'vino' ->> 'note_es', 'Criado en barrica', 'Note del vino in spagnolo');
select is(public.menu_pubblico('locale-menu-es') -> 'categorie' -> 0 -> 'prodotti' -> 0 ->> 'descrizione', 'Rosso strutturato', 'L''italiano resta');
select throws_ok($$ update public.prodotti set descrizione_es = repeat('x', 1001) $$, '23514', null, 'Descrizione spagnola di lunghezza limitata');

select * from finish();
rollback;
