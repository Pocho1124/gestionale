-- Test piantina disegnabile: elementi d'arredo, proporzioni, permessi.
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
  ('ae111111-1111-1111-1111-111111111111', 'owner@piantina.local', '{}'),
  ('ae333333-3333-3333-3333-333333333333', 'cameriere@piantina.local', '{}');

set local role authenticated;
select pg_temp.come('ae111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Piantina', 'Locale Piantina', 'locale-piantina');
insert into public.sale (id, locale_id, nome) select 'af000000-0000-0000-0000-000000000001', id, 'Interno' from public.locali where slug = 'locale-piantina';
insert into public.membri (organizzazione_id, user_id, ruolo)
  select organizzazione_id, 'ae333333-3333-3333-3333-333333333333', 'cameriere' from public.locali where slug = 'locale-piantina';

select lives_ok($$ update public.sale set larghezza_m = 15, profondita_m = 10, sfondo_opacita = 30 $$, 'L''owner imposta le misure della sala');
select throws_ok($$ update public.sale set larghezza_m = 1 $$, '23514', null, 'Misure non realistiche rifiutate');
select lives_ok($$ insert into public.elementi_sala (locale_id, sala_id, tipo, x, y, w, h, rotazione, etichetta)
                   select locale_id, id, 'bancone', 500, 100, 260, 60, 90, 'Bancone' from public.sale $$, 'L''owner disegna il bancone');
select throws_ok($$ insert into public.elementi_sala (locale_id, sala_id, tipo, x, y, w, h)
                    select locale_id, id, 'piscina', 1, 1, 10, 10 from public.sale $$, '23514', null, 'Tipo di elemento sconosciuto rifiutato');
select lives_ok($$ insert into public.tavoli (locale_id, sala_id, nome, x, y, rotazione)
                   select locale_id, id, '1', 500, 1500, 90 from public.sale $$, 'Tavolo ruotato in una sala profonda');

select pg_temp.come('ae333333-3333-3333-3333-333333333333');
select is((select count(*) from public.elementi_sala), 1::bigint, 'Il cameriere vede la piantina');
select is_empty($$ update public.elementi_sala set x = 10 returning id $$, 'Il cameriere non modifica la piantina');

select * from finish();
rollback;
