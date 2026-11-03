-- Test richiesta del conto e utenti Telegram gestiti dal backoffice.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;
create function pg_temp.anonimo() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

select plan(11);
insert into auth.users (id, email, raw_user_meta_data) values
  ('d0111111-1111-1111-1111-111111111111', 'owner@conto.local', '{}'),
  ('d0222222-2222-2222-2222-222222222222', 'manager@conto.local', '{}'),
  ('d0333333-3333-3333-3333-333333333333', 'cameriere@conto.local', '{}');
set local role authenticated;
select pg_temp.come('d0111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Conto', 'Locale Conto', 'locale-conto');
insert into public.sale (id, locale_id, nome) select 'd1000000-0000-0000-0000-000000000001', id, 'Interno' from public.locali where slug = 'locale-conto';
insert into public.tavoli (id, locale_id, sala_id, nome, qr_token) select 'd2000000-0000-0000-0000-000000000001', id,
  'd1000000-0000-0000-0000-000000000001', '4', 'token-tavolo-quattro-conto' from public.locali where slug = 'locale-conto';
insert into public.membri (organizzazione_id, user_id, ruolo) select organizzazione_id, v.id::uuid, v.r::public.ruolo from public.locali,
  (values ('d0222222-2222-2222-2222-222222222222', 'manager'), ('d0333333-3333-3333-3333-333333333333', 'cameriere')) v(id, r) where slug = 'locale-conto';
select pg_temp.come('d0333333-3333-3333-3333-333333333333');
select public.apri_tavolo('d2000000-0000-0000-0000-000000000001', 4);
reset role;
create temp table ctx as select codice from public.sessioni_tavolo where chiusa_at is null;
grant select on ctx to anon, authenticated;

set local role anon; select pg_temp.anonimo();
select is(public.chiedi_conto('token-tavolo-quattro-conto', 'nope', '') ->> 'errore', 'Codice del tavolo non corretto', 'Senza codice non si chiede il conto');
select is(public.chiedi_conto('token-tavolo-quattro-conto', (select codice from ctx), 'Pago con carta') ->> 'conto', 'richiesto', 'Con il codice il cliente chiede il conto');
select is(public.chiedi_conto('token-tavolo-quattro-conto', (select codice from ctx), '') ->> 'conto', 'richiesto', 'Una seconda richiesta non crea doppioni');
select is(public.ordini_tavolo('token-tavolo-quattro-conto', (select codice from ctx)) ->> 'conto', 'in_attesa', 'Il telefono vede il conto richiesto');

set local role authenticated; select pg_temp.come('d0333333-3333-3333-3333-333333333333');
select is((select count(*) from public.richieste_conto where stato = 'in_attesa'), 1::bigint, 'Il cameriere vede una sola richiesta di conto');
select lives_ok($$ select public.gestisci_conto((select id from public.richieste_conto limit 1)) $$, 'Il cameriere la segna come gestita');
select public.chiudi_tavolo('d2000000-0000-0000-0000-000000000001');
select is((select count(*) from public.richieste_conto where stato = 'in_attesa'), 0::bigint, 'Alla chiusura del tavolo non restano richieste aperte');

-- Utenti Telegram: il titolare li gestisce, il responsabile (e il bot) li legge, il cameriere no
select pg_temp.come('d0111111-1111-1111-1111-111111111111');
select lives_ok($$ insert into public.telegram_utenti (locale_id, telegram_id, nome) select id, 123456789, 'Claudio' from public.locali where slug = 'locale-conto' $$,
                'Il titolare aggiunge un utente Telegram');
select pg_temp.come('d0222222-2222-2222-2222-222222222222');
select is((select count(*) from public.telegram_utenti), 1::bigint, 'Il responsabile vede gli utenti Telegram');
select throws_ok($$ insert into public.telegram_utenti (locale_id, telegram_id) select id, 987654321 from public.locali where slug = 'locale-conto' $$,
                 '42501', null, 'Il responsabile non aggiunge utenti Telegram');
select pg_temp.come('d0333333-3333-3333-3333-333333333333');
select is((select count(*) from public.telegram_utenti), 0::bigint, 'Il cameriere non vede gli utenti Telegram');

select * from finish();
rollback;
