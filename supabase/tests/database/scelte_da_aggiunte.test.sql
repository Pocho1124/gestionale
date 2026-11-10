-- Test dei gruppi collegati alle aggiunte (tagliere: «Salumi» = aggiunte del gruppo «Salumi», comprese nel prezzo).
-- Prezzo e controlli da prezzo_riga(); voci esposte dal menu pubblico con id «gruppo:aggiunta». Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(9);
insert into auth.users (id, email, raw_user_meta_data) values ('fd111111-1111-1111-1111-111111111111', 'titolare@tagliere.local', '{}');
set local role authenticated; select pg_temp.come('fd111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Tagliere', 'Locale Tagliere', 'locale-tagliere');
insert into public.categorie (id, locale_id, nome) select 'fd200000-0000-0000-0000-000000000001', id, 'Taglieri' from public.locali where slug = 'locale-tagliere';
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent)
  select 'fd300000-0000-0000-0000-000000000001', id, 'fd200000-0000-0000-0000-000000000001', 'Tagliere personalizzato', 1800 from public.locali where slug = 'locale-tagliere';
insert into public.gruppi_opzioni (id, locale_id, prodotto_id, nome, min_scelte, max_scelte, da_aggiunte)
  select 'fd400000-0000-0000-0000-000000000001', id, 'fd300000-0000-0000-0000-000000000001', 'Salumi', 2, 2, 'salumi' from public.locali where slug = 'locale-tagliere';
insert into public.aggiunte (id, locale_id, nome, prezzo_cent, gruppo, posizione)
  select x.id::uuid, l.id, x.nome, x.prezzo, x.gruppo, x.pos from public.locali l,
    (values ('fd500000-0000-0000-0000-000000000001', 'Speck', 200, 'Salumi', 0), ('fd500000-0000-0000-0000-000000000002', 'Coppa', 300, 'Salumi', 1),
            ('fd500000-0000-0000-0000-000000000003', 'Pecorino', 250, 'Formaggi', 0)) as x(id, nome, prezzo, gruppo, pos)
   where l.slug = 'locale-tagliere';
reset role;

create temp table ctx as select id as loc from public.locali where slug = 'locale-tagliere';
-- Scelte: «gruppo:aggiunta» comprese, «aggiunta» a pagamento
create function pg_temp.prezzo(p jsonb) returns jsonb language sql as $$
  select public.prezzo_riga((select loc from ctx), 'fd300000-0000-0000-0000-000000000001', p) $$;

select is((select jsonb_agg(s -> 'id' order by s ->> 'nome')
             from jsonb_array_elements(public.menu_pubblico('locale-tagliere') -> 'categorie' -> 0 -> 'prodotti' -> 0 -> 'opzioni' -> 0 -> 'scelte') s),
          '["fd400000-0000-0000-0000-000000000001:fd500000-0000-0000-0000-000000000002", "fd400000-0000-0000-0000-000000000001:fd500000-0000-0000-0000-000000000001"]'::jsonb,
          'Il gruppo collegato mostra solo le aggiunte del suo gruppo (maiuscole indifferenti), con id gruppo:aggiunta');
select is(public.menu_pubblico('locale-tagliere') -> 'categorie' -> 0 -> 'prodotti' -> 0 -> 'opzioni' -> 0 -> 'scelte' -> 0 ->> 'sovrapprezzo_cent', '0',
          'Nel gruppo collegato le aggiunte sono comprese nel prezzo');
select is(pg_temp.prezzo('["fd400000-0000-0000-0000-000000000001:fd500000-0000-0000-0000-000000000001", "fd400000-0000-0000-0000-000000000001:fd500000-0000-0000-0000-000000000002"]') ->> 'prezzo_cent',
          '1800', 'Due salumi compresi: prezzo del piatto');
select is((select count(*)::int from jsonb_array_elements(pg_temp.prezzo('["fd400000-0000-0000-0000-000000000001:fd500000-0000-0000-0000-000000000001", "fd400000-0000-0000-0000-000000000001:fd500000-0000-0000-0000-000000000002", "fd500000-0000-0000-0000-000000000001"]') -> 'opzioni') o
            where o ->> 'nome' in ('Speck', '+ Speck')), 2, 'La stessa aggiunta compresa e in più: nella comanda «Speck» e «+ Speck»');
select is(pg_temp.prezzo('["fd400000-0000-0000-0000-000000000001:fd500000-0000-0000-0000-000000000001", "fd400000-0000-0000-0000-000000000001:fd500000-0000-0000-0000-000000000002", "fd500000-0000-0000-0000-000000000003"]') ->> 'prezzo_cent',
          '2050', 'Aggiunta a pagamento in più: prezzo del piatto + aggiunta');
select throws_ok($$ select pg_temp.prezzo('["fd400000-0000-0000-0000-000000000001:fd500000-0000-0000-0000-000000000001"]') $$, '22023', null,
          'Un solo salume su due: rifiutato');
select throws_ok($$ select pg_temp.prezzo('["fd400000-0000-0000-0000-000000000001:fd500000-0000-0000-0000-000000000001", "fd400000-0000-0000-0000-000000000001:fd500000-0000-0000-0000-000000000003"]') $$, '22023', null,
          'Un formaggio non entra tra i salumi compresi');
update public.aggiunte set disponibile = false where id = 'fd500000-0000-0000-0000-000000000002';
select throws_ok($$ select pg_temp.prezzo('["fd400000-0000-0000-0000-000000000001:fd500000-0000-0000-0000-000000000001", "fd400000-0000-0000-0000-000000000001:fd500000-0000-0000-0000-000000000002"]') $$, '22023', null,
          'Aggiunta esaurita: non si sceglie più neanche compresa');
select throws_ok($$ select pg_temp.prezzo('["fd400000-0000-0000-0000-000000000001:non-valido"]') $$, '22023', null, 'Formato delle scelte controllato');

select * from finish();
rollback;
