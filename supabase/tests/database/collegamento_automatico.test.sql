-- Test del collegamento automatico: gruppo senza voci proprie = aggiunte del gruppo con lo stesso nome. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(5);
insert into auth.users (id, email, raw_user_meta_data) values ('fe111111-1111-1111-1111-111111111111', 'titolare@collegamento.local', '{}');
set local role authenticated; select pg_temp.come('fe111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Tagliere', 'Locale Tagliere', 'locale-tagliere');
insert into public.categorie (id, locale_id, nome) select 'fd200000-0000-0000-0000-000000000001', id, 'Taglieri' from public.locali where slug = 'locale-tagliere';
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent)
  select 'fd300000-0000-0000-0000-000000000001', id, 'fd200000-0000-0000-0000-000000000001', 'Tagliere personalizzato', 1800 from public.locali where slug = 'locale-tagliere';
insert into public.gruppi_opzioni (id, locale_id, prodotto_id, nome, min_scelte, max_scelte, posizione)
  select x.id::uuid, l.id, 'fd300000-0000-0000-0000-000000000001', x.nome, 0, 2, x.pos from public.locali l,
    (values ('fd400000-0000-0000-0000-000000000001', 'Salumi', 0), ('fd400000-0000-0000-0000-000000000002', 'formaggi ', 1), ('fd400000-0000-0000-0000-000000000003', 'Pane', 2)) as x(id, nome, pos)
   where l.slug = 'locale-tagliere';
insert into public.opzioni (locale_id, gruppo_id, nome) select id, 'fd400000-0000-0000-0000-000000000003', 'Pane casereccio' from public.locali where slug = 'locale-tagliere';
insert into public.aggiunte (id, locale_id, nome, prezzo_cent, gruppo, posizione)
  select x.id::uuid, l.id, x.nome, x.prezzo, x.gruppo, x.pos from public.locali l,
    (values ('fd500000-0000-0000-0000-000000000001', 'Speck', 200, 'Salumi', 0), ('fd500000-0000-0000-0000-000000000002', 'Coppa', 300, 'Salumi', 1),
            ('fd500000-0000-0000-0000-000000000003', 'Pecorino', 250, 'Formaggi', 0),
            ('fd500000-0000-0000-0000-000000000004', 'Pane', 100, 'Pane', 0)) as x(id, nome, prezzo, gruppo, pos)
   where l.slug = 'locale-tagliere';
reset role;

create temp table ctx as select id as loc from public.locali where slug = 'locale-tagliere';
-- Scelte: «gruppo:aggiunta» comprese, «aggiunta» a pagamento
create function pg_temp.prezzo(p jsonb) returns jsonb language sql as $$
  select public.prezzo_riga((select loc from ctx), 'fd300000-0000-0000-0000-000000000001', p) $$;

select is(public.gruppo_aggiunte_collegato('fd400000-0000-0000-0000-000000000001'), 'Salumi', 'Gruppo vuoto: collegato alle aggiunte con lo stesso nome');
select is((select jsonb_array_length(o -> 'scelte') from jsonb_array_elements(public.menu_pubblico('locale-tagliere') -> 'categorie' -> 0 -> 'prodotti' -> 0 -> 'opzioni') o
            where o ->> 'nome' = 'formaggi '), 1, 'Anche con maiuscole e spazi diversi (formaggi → Pecorino)');
select is((select o -> 'scelte' from jsonb_array_elements(public.menu_pubblico('locale-tagliere') -> 'categorie' -> 0 -> 'prodotti' -> 0 -> 'opzioni') o
            where o ->> 'nome' = 'Pane') -> 0 ->> 'nome', 'Pane casereccio', 'Gruppo con voci scritte a mano: nessun collegamento automatico');
select is(pg_temp.prezzo('["fd400000-0000-0000-0000-000000000001:fd500000-0000-0000-0000-000000000001", "fd400000-0000-0000-0000-000000000002:fd500000-0000-0000-0000-000000000003"]') ->> 'prezzo_cent',
          '2250', 'Salume e formaggio dai gruppi collegati in automatico, al loro prezzo (18 + 2 + 2,50)');
select throws_ok($$ select pg_temp.prezzo('["fd400000-0000-0000-0000-000000000003:fd500000-0000-0000-0000-000000000004"]') $$, '22023', null,
          'Nel gruppo con voci proprie un''aggiunta non entra');

select * from finish();
rollback;
