-- Test dello sfondo a carosello: percorsi solo nell'archivio del locale, al massimo 5, intervallo limitato,
-- esposti dal menu pubblico. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(6);
insert into auth.users (id, email, raw_user_meta_data) values ('fa911111-1111-1111-1111-111111111111', 'titolare@carosello.local', '{}');
set local role authenticated; select pg_temp.come('fa911111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Carosello', 'Locale Carosello', 'locale-carosello');
insert into public.categorie (id, locale_id, nome) select 'fa920000-0000-0000-0000-000000000001', id, 'Vini' from public.locali where slug = 'locale-carosello';
insert into public.prodotti (locale_id, categoria_id, nome, prezzo_cent)
  select id, 'fa920000-0000-0000-0000-000000000001', 'Aglianico', 600 from public.locali where slug = 'locale-carosello';
reset role;
create temp table ctx as select id as loc from public.locali where slug = 'locale-carosello';
grant select on ctx to authenticated;
set local role authenticated; select pg_temp.come('fa911111-1111-1111-1111-111111111111');

select lives_ok($$ update public.aspetto set sfondo_intervallo = 10, sfondo_carosello = array[
    (select loc from ctx)::text || '/sfondo/11111111-1111-4111-8111-111111111111.webp',
    (select loc from ctx)::text || '/sfondo/22222222-2222-4222-8222-222222222222.jpg'] where locale_id = (select loc from ctx) $$,
  'Il titolare salva due foto del carosello');
select throws_ok($$ update public.aspetto set sfondo_carosello = array['00000000-0000-4000-8000-000000000999/sfondo/11111111-1111-4111-8111-111111111111.webp']
    where locale_id = (select loc from ctx) $$, '23514', null, 'Foto di un altro locale rifiutata');
select throws_ok($$ update public.aspetto set sfondo_carosello = (select array_agg((select loc from ctx)::text || '/sfondo/' || gen_random_uuid() || '.webp') from generate_series(1, 6))
    where locale_id = (select loc from ctx) $$, '23514', null, 'Al massimo 5 foto oltre alla principale');
select throws_ok($$ update public.aspetto set sfondo_intervallo = 2 where locale_id = (select loc from ctx) $$, '23514', null, 'Intervallo troppo breve rifiutato');
reset role;
select is(jsonb_array_length(public.menu_pubblico('locale-carosello') -> 'aspetto' -> 'sfondo_carosello'), 2, 'Il menu pubblico espone le foto del carosello');
select is((public.menu_pubblico('locale-carosello') -> 'aspetto' ->> 'sfondo_intervallo')::int, 10, 'E l''intervallo');

select * from finish();
rollback;
