-- Test foto dei piatti: permessi, visibilità pubblica, collegamento al menu.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(9);
insert into auth.users (id, email, raw_user_meta_data) values
  ('d1111111-1111-1111-1111-111111111111', 'owner@foto.local', '{}'),
  ('d3333333-3333-3333-3333-333333333333', 'cameriere@foto.local', '{}');

set local role authenticated;
select pg_temp.come('d1111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Foto', 'Locale Foto', 'locale-foto');
insert into public.categorie (id, locale_id, nome) select 'e0000000-0000-0000-0000-0000000000c1', id, 'Pizze' from public.locali where slug = 'locale-foto';
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent, visibile)
  select v.id::uuid, l.id, 'e0000000-0000-0000-0000-0000000000c1', v.nome, 800, v.vis
  from public.locali l, (values ('e0000000-0000-0000-0000-0000000000a1', 'Margherita', true),
                                ('e0000000-0000-0000-0000-0000000000a2', 'Segreta', false)) v(id, nome, vis)
  where l.slug = 'locale-foto';
insert into public.membri (organizzazione_id, user_id, ruolo)
  select organizzazione_id, 'd3333333-3333-3333-3333-333333333333', 'cameriere' from public.locali where slug = 'locale-foto';

select lives_ok($$ insert into public.foto_prodotti (prodotto_id, locale_id, dati)
                   select id, locale_id, 'data:image/jpeg;base64,/9j/4AAQ' from public.prodotti where nome in ('Margherita', 'Segreta') $$,
                'L''owner carica le foto');
select throws_ok($$ update public.foto_prodotti set dati = 'https://esempio.it/x.jpg' $$, '23514', null, 'Foto non incorporata rifiutata');
select ok((public.menu_pubblico('locale-foto') -> 'categorie' -> 0 -> 'prodotti' -> 0 ->> 'foto') is not null,
          'Il menu pubblico indica che il piatto ha una foto');

select pg_temp.come('d3333333-3333-3333-3333-333333333333');
select is((select count(*) from public.foto_prodotti), 2::bigint, 'Il cameriere vede le foto');
select is_empty($$ update public.foto_prodotti set dati = 'data:image/jpeg;base64,AAAA' returning prodotto_id $$,
                'Il cameriere non cambia le foto');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$ select count(*) from public.foto_prodotti $$, '42501', null, 'Anon non legge la tabella delle foto');
select is(public.foto_prodotto('e0000000-0000-0000-0000-0000000000a1'), 'data:image/jpeg;base64,/9j/4AAQ', 'Anon riceve la foto di un piatto visibile');
select is(public.foto_prodotto('e0000000-0000-0000-0000-0000000000a2'), null, 'Anon non riceve la foto di un piatto nascosto');

reset role;
delete from public.prodotti where id = 'e0000000-0000-0000-0000-0000000000a1';
select is((select count(*) from public.foto_prodotti where prodotto_id = 'e0000000-0000-0000-0000-0000000000a1'), 0::bigint,
          'Eliminando il piatto si elimina anche la foto');

select * from finish();
rollback;
