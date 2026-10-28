-- Test foto di sfondo del menu.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(5);
insert into auth.users (id, email, raw_user_meta_data) values ('c1111111-1111-1111-1111-111111111111', 'owner@sfondo.local', '{}');

set local role authenticated;
select pg_temp.come('c1111111-1111-1111-1111-111111111111');
select lives_ok($$ select public.crea_organizzazione('Org Sfondo', 'Locale Sfondo', 'locale-sfondo') $$, 'Locale creato');
select lives_ok($$ update public.aspetto set sfondo_dati = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', sfondo_opacita = 30,
                   sfondo_sfocatura = 4, sfondo_bn = true $$, 'Foto di sfondo impostata');
select throws_ok($$ update public.aspetto set sfondo_opacita = 150 $$, '23514', null, 'Visibilità oltre il 100% rifiutata');
select throws_ok($$ update public.aspetto set sfondo_dati = 'https://esempio.it/foto.jpg' $$, '23514', null,
                 'Sfondo non incorporato rifiutato');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
select is((public.menu_pubblico('locale-sfondo') -> 'aspetto' ->> 'sfondo_opacita'), '30', 'Il menu pubblico riceve le impostazioni dello sfondo');

select * from finish();
rollback;
