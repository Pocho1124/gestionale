-- Test dei nuovi oggetti della piantina: tipi accettati, tipi sconosciuti rifiutati, permessi invariati.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(4);
insert into auth.users (id, email, raw_user_meta_data) values
  ('eb111111-1111-1111-1111-111111111111', 'owner@arredi.local', '{}'),
  ('eb333333-3333-3333-3333-333333333333', 'cameriere@arredi.local', '{}');
set local role authenticated;
select pg_temp.come('eb111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Arredi', 'Locale Arredi', 'locale-arredi');
insert into public.sale (id, locale_id, nome) select 'eb000000-0000-0000-0000-000000000001', id, 'Interno' from public.locali where slug = 'locale-arredi';
insert into public.membri (organizzazione_id, user_id, ruolo)
  select organizzazione_id, 'eb333333-3333-3333-3333-333333333333', 'cameriere' from public.locali where slug = 'locale-arredi';

select lives_ok($$ insert into public.elementi_sala (locale_id, sala_id, tipo, x, y, w, h)
                   select s.locale_id, s.id, t, 100, 100, 50, 50 from public.sale s,
                     unnest(array['botte', 'scaffale', 'divano', 'poltrona', 'sgabello', 'tappeto', 'camino', 'scala', 'cucina', 'vetrina', 'fioriera']) t $$,
                'Il titolare aggiunge tutti i nuovi oggetti');
select is((select count(*) from public.elementi_sala), 11::bigint, 'Gli undici oggetti sono salvati');
select throws_ok($$ insert into public.elementi_sala (locale_id, sala_id, tipo, x, y, w, h)
                    select locale_id, id, 'astronave', 1, 1, 10, 10 from public.sale $$, '23514', null, 'Tipo sconosciuto ancora rifiutato');
select pg_temp.come('eb333333-3333-3333-3333-333333333333');
select is_empty($$ update public.elementi_sala set x = 10 returning id $$, 'Il cameriere non modifica gli oggetti');

select * from finish();
rollback;
