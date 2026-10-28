-- Test aspetto: logo incorporato, impaginazione elegante, permessi.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('b1111111-1111-1111-1111-111111111111', 'owner@aspetto.local', '{}'),
  ('b2222222-2222-2222-2222-222222222222', 'estraneo@aspetto.local', '{}');

set local role authenticated;
select pg_temp.come('b1111111-1111-1111-1111-111111111111');
select lives_ok($$ select public.crea_organizzazione('Org Aspetto', 'Vineria Test', 'vineria-test') $$, 'Locale creato');

select lives_ok($$ update public.aspetto set layout = 'elegante', font_titoli = 'Cormorant Garamond',
                   colore_sfondo = '#14110F', mostra_nome = false,
                   logo_dati = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' $$,
                'L''owner imposta tema elegante, scuro e logo');
select throws_ok($$ update public.aspetto set logo_dati = 'data:image/svg+xml;base64,PHN2Zz4=' $$, '23514', null,
                 'Un logo SVG viene rifiutato');
select throws_ok($$ update public.aspetto set logo_dati = 'javascript:alert(1)' $$, '23514', null,
                 'Un logo non immagine viene rifiutato');
select throws_ok($$ update public.aspetto set layout = 'fantasia' $$, '23514', null, 'Impaginazione sconosciuta rifiutata');

select pg_temp.come('b2222222-2222-2222-2222-222222222222');
select is_empty($$ update public.aspetto set colore_sfondo = '#000000' returning locale_id $$,
                'Un estraneo non modifica l''aspetto altrui');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
select is((public.menu_pubblico('vineria-test') -> 'aspetto' ->> 'mostra_nome'), 'false',
          'Il menu pubblico riceve le nuove impostazioni');

select * from finish();
rollback;
