-- Test del coperto (fissato all'apertura, modificabile), coperti, sposta e unisci tavoli. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;
create function pg_temp.anonimo() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('request.jwt.claim.sub', '', true); end $$;
create temp table ctx (chiave text primary key, valore text);
grant all on ctx to anon, authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select valore::uuid from ctx where chiave = p $$;
create function pg_temp.ses(p_tavolo text) returns uuid language sql as $$
  select id from public.sessioni_tavolo where tavolo_id = p_tavolo::uuid and chiusa_at is null $$;
create function pg_temp.totale(p_tavolo text) returns int language sql as $$
  select (public.stato_conto(pg_temp.ses(p_tavolo)) ->> 'totale_cent')::int $$;
create function pg_temp.pinsa() returns jsonb language sql as $$ select '[{"prodotto_id":"ee300000-0000-0000-0000-000000000001","quantita":1}]'::jsonb $$;

select plan(12);
insert into auth.users (id, email, raw_user_meta_data) values
  ('ee111111-1111-1111-1111-111111111111', 'titolare@coperto.local', '{}'),
  ('ee333333-3333-3333-3333-333333333333', 'cameriere@coperto.local', '{}');
set local role authenticated; select pg_temp.come('ee111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Coperto', 'Locale Coperto', 'locale-coperto');
reset role;
insert into ctx select 'loc', id from public.locali where slug = 'locale-coperto';
insert into public.membri (organizzazione_id, user_id, ruolo)
  select organizzazione_id, 'ee333333-3333-3333-3333-333333333333', 'cameriere' from public.locali where slug = 'locale-coperto';
insert into public.categorie (id, locale_id, nome) values ('ee200000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'Menu');
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent) values
  ('ee300000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'ee200000-0000-0000-0000-000000000001', 'Pinsa', 1000);
insert into public.sale (id, locale_id, nome) values ('ee400000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'Interno');
insert into public.tavoli (id, locale_id, sala_id, nome, qr_token) select ('ee50000' || n || '-0000-0000-0000-000000000001')::uuid, pg_temp.v('loc'),
  'ee400000-0000-0000-0000-000000000001', n::text, 'token-tavolo-coperto-' || n from generate_series(1, 3) n;

set local role authenticated; select pg_temp.come('ee111111-1111-1111-1111-111111111111');
insert into public.impostazioni_tavolo (locale_id, coperto_cent) values (pg_temp.v('loc'), 250);
select public.apri_tavolo('ee500001-0000-0000-0000-000000000001', 3);
select public.ordine_sala('ee500001-0000-0000-0000-000000000001', pg_temp.pinsa());
select is(pg_temp.totale('ee500001-0000-0000-0000-000000000001'), 1750, 'Conto: pinsa 10 € + 3 coperti da 2,50 €');
update public.impostazioni_tavolo set coperto_cent = 300 where locale_id = pg_temp.v('loc');
select is(pg_temp.totale('ee500001-0000-0000-0000-000000000001'), 1750, 'Il nuovo prezzo del coperto non tocca il tavolo già aperto');

-- Coperti e prezzo del coperto
select pg_temp.come('ee333333-3333-3333-3333-333333333333');
select public.imposta_coperti(pg_temp.ses('ee500001-0000-0000-0000-000000000001'), 4);
select throws_ok($$ select public.imposta_coperto(pg_temp.ses('ee500001-0000-0000-0000-000000000001'), 0) $$, '42501', null,
                 'Il cameriere non cambia il prezzo del coperto');
select pg_temp.come('ee111111-1111-1111-1111-111111111111');
select is(pg_temp.totale('ee500001-0000-0000-0000-000000000001'), 2000, 'Il cameriere aggiunge un coperto: 10 € + 4 × 2,50 €');
select public.imposta_coperto(pg_temp.ses('ee500001-0000-0000-0000-000000000001'), 0);
select is(pg_temp.totale('ee500001-0000-0000-0000-000000000001'), 1000, 'Coperto tolto dal titolare');
select public.imposta_coperto(pg_temp.ses('ee500001-0000-0000-0000-000000000001'), 250);

-- Sposta e unisci
select public.apri_tavolo('ee500003-0000-0000-0000-000000000001', 2);   -- nuovo tavolo: coperto a 3 €
select public.ordine_sala('ee500003-0000-0000-0000-000000000001', pg_temp.pinsa());
select public.sposta_tavolo('ee500001-0000-0000-0000-000000000001', 'ee500002-0000-0000-0000-000000000001');
select is((select count(*) from public.ordini where tavolo_id = 'ee500002-0000-0000-0000-000000000001'), 1::bigint,
          'Il conto e i suoi ordini passano sul tavolo libero');
select throws_ok($$ select public.sposta_tavolo('ee500002-0000-0000-0000-000000000001', 'ee500003-0000-0000-0000-000000000001') $$, '22023', null,
                 'Non si sposta su un tavolo occupato');
reset role;
insert into ctx select 'codice', codice from public.sessioni_tavolo where tavolo_id = 'ee500002-0000-0000-0000-000000000001' and chiusa_at is null;
set local role anon; select pg_temp.anonimo();
select is(public.ordini_tavolo('token-tavolo-coperto-2', (select valore from ctx where chiave = 'codice')) -> 'coperto',
          '{"coperti": 4, "prezzo_cent": 250}'::jsonb, 'Il cliente vede il coperto nel suo conto');
set local role authenticated; select pg_temp.come('ee333333-3333-3333-3333-333333333333');
select public.unisci_tavoli('ee500002-0000-0000-0000-000000000001', 'ee500003-0000-0000-0000-000000000001');
select pg_temp.come('ee111111-1111-1111-1111-111111111111');
select is(pg_temp.totale('ee500002-0000-0000-0000-000000000001'), 3500, 'Tavoli uniti: 2 pinse + 6 coperti al prezzo del primo tavolo');
select is((select count(*) from public.sessioni_tavolo where tavolo_id = 'ee500003-0000-0000-0000-000000000001'), 0::bigint,
          'Il secondo tavolo si libera senza lasciare un conto vuoto');
select throws_ok($$ select public.unisci_tavoli('ee500002-0000-0000-0000-000000000001', 'ee500003-0000-0000-0000-000000000001') $$, '22023', null,
                 'Non si unisce un tavolo libero');
select is(public.chiudi_tavolo('ee500002-0000-0000-0000-000000000001', 'contanti'), 3500, 'Chiusura con il coperto nel totale');

select * from finish();
rollback;
