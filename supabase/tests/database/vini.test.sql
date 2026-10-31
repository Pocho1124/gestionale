-- Test sommelier: schede vino, abbinamenti, permessi, menu pubblico.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(10);
insert into auth.users (id, email, raw_user_meta_data) values
  ('f1111111-1111-1111-1111-111111111111', 'owner@vini.local', '{}'),
  ('f3333333-3333-3333-3333-333333333333', 'cameriere@vini.local', '{}');

set local role authenticated;
select pg_temp.come('f1111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Vini', 'Enoteca Test', 'enoteca-test');
insert into public.categorie (id, locale_id, nome)
  select v.id::uuid, l.id, v.nome from public.locali l,
    (values ('aa000000-0000-0000-0000-0000000000c1', 'Taglieri'), ('aa000000-0000-0000-0000-0000000000c2', 'Vini')) v(id, nome)
  where l.slug = 'enoteca-test';
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent, visibile)
  select v.id::uuid, l.id, v.cat::uuid, v.nome, v.prezzo, v.vis from public.locali l,
    (values ('aa000000-0000-0000-0000-0000000000a1', 'aa000000-0000-0000-0000-0000000000c1', 'Tagliere', 1800, true),
            ('aa000000-0000-0000-0000-0000000000b1', 'aa000000-0000-0000-0000-0000000000c2', 'Aglianico', 750, true),
            ('aa000000-0000-0000-0000-0000000000b2', 'aa000000-0000-0000-0000-0000000000c2', 'Riserva segreta', 2000, false)) v(id, cat, nome, prezzo, vis)
  where l.slug = 'enoteca-test';
insert into public.membri (organizzazione_id, user_id, ruolo)
  select organizzazione_id, 'f3333333-3333-3333-3333-333333333333', 'cameriere' from public.locali where slug = 'enoteca-test';

select lives_ok($$ insert into public.vini (prodotto_id, locale_id, tipo, corpo, regione, vitigno, prezzo_bottiglia_cent)
                   select id, locale_id, 'rosso', 'strutturato', 'Campania', 'Aglianico', 2800 from public.prodotti
                   where nome in ('Aglianico', 'Riserva segreta') $$, 'L''owner crea le schede dei vini');
select throws_ok($$ update public.vini set tipo = 'arancione' $$, '23514', null, 'Tipo di vino sconosciuto rifiutato');
select lives_ok($$ insert into public.abbinamenti (locale_id, piatto_id, vino_id, motivo)
                   select locale_id, 'aa000000-0000-0000-0000-0000000000a1', id, 'Tannino e salumi'
                   from public.prodotti where nome in ('Aglianico', 'Riserva segreta') $$, 'L''owner crea gli abbinamenti');
select throws_ok($$ insert into public.abbinamenti (locale_id, piatto_id, vino_id)
                    select locale_id, 'aa000000-0000-0000-0000-0000000000b1', 'aa000000-0000-0000-0000-0000000000a1'
                    from public.prodotti limit 1 $$, '23503', null, 'Un piatto senza scheda non può fare da vino');

select is((select jsonb_array_length(public.menu_pubblico('enoteca-test') -> 'categorie' -> 0 -> 'prodotti' -> 0 -> 'abbinamenti')),
          1, 'Il piatto mostra solo l''abbinamento con il vino visibile');
select is((select public.menu_pubblico('enoteca-test') -> 'categorie' -> 1 -> 'prodotti' -> 0 -> 'vino' ->> 'tipo'),
          'rosso', 'Il vino porta la sua scheda nel menu');
select is((select jsonb_array_length(public.menu_pubblico('enoteca-test') -> 'categorie' -> 1 -> 'prodotti' -> 0 -> 'abbinamenti')),
          1, 'Il vino mostra il piatto abbinato (direzione inversa)');

select pg_temp.come('f3333333-3333-3333-3333-333333333333');
select is_empty($$ update public.vini set corpo = 'leggero' returning prodotto_id $$, 'Il cameriere non modifica le schede');
select throws_ok($$ insert into public.abbinamenti (locale_id, piatto_id, vino_id)
                    select locale_id, 'aa000000-0000-0000-0000-0000000000a1', prodotto_id from public.vini limit 1
                    on conflict do nothing $$, '42501', null, 'Il cameriere non crea abbinamenti');

reset role;
delete from public.vini where prodotto_id = 'aa000000-0000-0000-0000-0000000000b1';
select is((select count(*) from public.abbinamenti where vino_id = 'aa000000-0000-0000-0000-0000000000b1'), 0::bigint,
          'Togliendo la scheda del vino spariscono i suoi abbinamenti');

select * from finish();
rollback;
