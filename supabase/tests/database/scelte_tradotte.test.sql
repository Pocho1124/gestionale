-- Test delle scelte tradotte: colonne, limiti e menu pubblico con nomi di gruppi, voci e aggiunte nelle tre lingue. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);
insert into auth.users (id, email, raw_user_meta_data) values ('c1e10000-0000-0000-0000-000000000001', 'titolare@scelte-tradotte.local', '{}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c1e10000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'c1e10000-0000-0000-0000-000000000001', true);
select public.crea_organizzazione('Org Scelte Tradotte', 'Locale Scelte Tradotte', 'locale-scelte-tradotte');
reset role;

insert into public.categorie (id, locale_id, nome) select 'c1e10000-0000-0000-0000-0000000000c1', id, 'Taglieri' from public.locali where slug = 'locale-scelte-tradotte';
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent)
  select 'c1e10000-0000-0000-0000-0000000000a1', id, 'c1e10000-0000-0000-0000-0000000000c1', 'Tagliere', 1200 from public.locali where slug = 'locale-scelte-tradotte';
insert into public.gruppi_opzioni (id, locale_id, prodotto_id, nome, nome_en, nome_es, nome_de, min_scelte, max_scelte)
  select 'c1e10000-0000-0000-0000-0000000000b1', id, 'c1e10000-0000-0000-0000-0000000000a1', 'Formato', 'Size', 'Tamaño', 'Größe', 1, 1
    from public.locali where slug = 'locale-scelte-tradotte';
insert into public.opzioni (locale_id, gruppo_id, nome, nome_en, nome_es, nome_de)
  select id, 'c1e10000-0000-0000-0000-0000000000b1', 'Piccolo', 'Small', 'Pequeño', 'Klein' from public.locali where slug = 'locale-scelte-tradotte';
insert into public.aggiunte (locale_id, nome, gruppo, prezzo_cent, nome_en, gruppo_en, gruppo_de)
  select id, 'Miele', 'Dolci', 100, 'Honey', 'Sweets', 'Süßes' from public.locali where slug = 'locale-scelte-tradotte';

create temp table m as select public.menu_pubblico('locale-scelte-tradotte') -> 'categorie' -> 0 as c;
select is((select c -> 'prodotti' -> 0 -> 'opzioni' -> 0 ->> 'nome_es' from m), 'Tamaño', 'Nome del gruppo di scelte in spagnolo');
select is((select c -> 'prodotti' -> 0 -> 'opzioni' -> 0 -> 'scelte' -> 0 ->> 'nome_de' from m), 'Klein', 'Nome della voce in tedesco');
select is((select c -> 'aggiunte' -> 0 ->> 'nome_en' from m), 'Honey', 'Nome dell''aggiunta in inglese');
select is((select c -> 'aggiunte' -> 0 ->> 'gruppo_de' from m), 'Süßes', 'Gruppo dell''aggiunta in tedesco');
select is((select c -> 'aggiunte' -> 0 ->> 'nome_es' from m), '', 'Traduzione mancante: vuota (la pagina mostra l''italiano)');
select throws_ok($$ update public.aggiunte set gruppo_en = repeat('x', 41) $$, '23514', null, 'Gruppo tradotto entro 40 caratteri');

select * from finish();
rollback;
