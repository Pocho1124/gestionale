-- Test dei rinforzi dopo l'analisi di sicurezza: organizzazione del locale, gestione utenti tra locali, blocco del codice
-- del tavolo, ordini su tavolo chiuso, storico senza testi dei clienti, fatture conservate, permessi. Dati sintetici.
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
create function pg_temp.v(p text) returns text language sql as $$ select valore from ctx where chiave = p $$;
create function pg_temp.riga() returns jsonb language sql as $$
  select '[{"prodotto_id":"ed300000-0000-0000-0000-000000000001","quantita":1,"nota":"Allergia sintetica alle noci"}]'::jsonb $$;

select plan(10);
insert into auth.users (id, email, raw_user_meta_data) values
  ('ed111111-1111-1111-1111-111111111111', 'titolare@rinforzi.local', '{}'),
  ('ed222222-2222-2222-2222-222222222222', 'responsabile@rinforzi.local', '{}'),
  ('ed333333-3333-3333-3333-333333333333', 'cameriere.org@rinforzi.local', '{}'),
  ('ed444444-4444-4444-4444-444444444444', 'cameriere.locale@rinforzi.local', '{}'),
  ('ed555555-5555-5555-5555-555555555555', 'altro@rinforzi.local', '{}');
set local role authenticated;
select pg_temp.come('ed555555-5555-5555-5555-555555555555');
select public.crea_organizzazione('Org Altra Rinforzi', 'Locale Altro Rinforzi', 'locale-altro-rinforzi');
select pg_temp.come('ed111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Rinforzi', 'Locale Rinforzi', 'locale-rinforzi');
reset role;
insert into ctx select 'loc', id from public.locali where slug = 'locale-rinforzi';
insert into ctx select 'org_altra', organizzazione_id from public.locali where slug = 'locale-altro-rinforzi';
insert into public.membri (organizzazione_id, user_id, ruolo, locale_id) select l.organizzazione_id, v.u::uuid, v.r::public.ruolo, case when v.solo then l.id end
  from public.locali l, (values ('ed222222-2222-2222-2222-222222222222', 'manager', true), ('ed333333-3333-3333-3333-333333333333', 'cameriere', false),
                                ('ed444444-4444-4444-4444-444444444444', 'cameriere', true)) v(u, r, solo)
 where l.slug = 'locale-rinforzi';
insert into public.categorie (id, locale_id, nome) values ('ed200000-0000-0000-0000-000000000001', pg_temp.v('loc')::uuid, 'Menu');
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent) values
  ('ed300000-0000-0000-0000-000000000001', pg_temp.v('loc')::uuid, 'ed200000-0000-0000-0000-000000000001', 'Calice', 600);
insert into public.sale (id, locale_id, nome) values ('ed400000-0000-0000-0000-000000000001', pg_temp.v('loc')::uuid, 'Interno');
insert into public.tavoli (id, locale_id, sala_id, nome, qr_token) values
  ('ed500000-0000-0000-0000-000000000001', pg_temp.v('loc')::uuid, 'ed400000-0000-0000-0000-000000000001', '2', 'token-tavolo-due-rinforzi');

-- 1. Il locale non cambia organizzazione, nemmeno per il titolare
set local role authenticated; select pg_temp.come('ed111111-1111-1111-1111-111111111111');
select throws_ok($$ update public.locali set organizzazione_id = pg_temp.v('org_altra')::uuid where slug = 'locale-rinforzi' $$, '42501', null,
                 'Un locale non si sposta in un''altra organizzazione');

-- 2. Il responsabile di un solo locale non gestisce account di tutta l'organizzazione
select pg_temp.come('ed222222-2222-2222-2222-222222222222');
select throws_ok($$ select public.modifica_ruolo_utente(pg_temp.v('loc')::uuid, 'ed333333-3333-3333-3333-333333333333', 'cucina') $$, '42501', null,
                 'Account valido su tutti i locali: il responsabile di un locale non lo modifica');
select lives_ok($$ select public.modifica_ruolo_utente(pg_temp.v('loc')::uuid, 'ed444444-4444-4444-4444-444444444444', 'cucina') $$,
                'Il responsabile gestisce il personale del suo locale');

-- 3. Codice del tavolo: blocco a tempo e sblocco dal personale
select pg_temp.come('ed111111-1111-1111-1111-111111111111');
select public.apri_tavolo('ed500000-0000-0000-0000-000000000001', 2);
reset role;
insert into ctx select 'codice', codice from public.sessioni_tavolo where tavolo_id = 'ed500000-0000-0000-0000-000000000001' and chiusa_at is null;
insert into ctx select 'ses', id from public.sessioni_tavolo where tavolo_id = 'ed500000-0000-0000-0000-000000000001' and chiusa_at is null;
set local role anon; select pg_temp.anonimo();
select public.invia_ordine('token-tavolo-due-rinforzi', 'zzzz', '[]') from generate_series(1, 10);
select is(public.invia_ordine('token-tavolo-due-rinforzi', pg_temp.v('codice'), pg_temp.riga()) ->> 'errore',
          'Troppi tentativi: riprova tra qualche minuto o chiedi al personale', 'Dopo 10 errori il codice si blocca per qualche minuto');
set local role authenticated; select pg_temp.come('ed111111-1111-1111-1111-111111111111');
select public.sblocca_codice_tavolo('ed500000-0000-0000-0000-000000000001');
set local role anon; select pg_temp.anonimo();
select is(public.invia_ordine('token-tavolo-due-rinforzi', pg_temp.v('codice'), pg_temp.riga(), 'Allergia sintetica: senza noci') ->> 'errore', null,
          'Sbloccato dal personale, il codice giusto funziona di nuovo');

-- 4. Lo storico non conserva le note dei clienti
reset role;
select is((select count(*) from public.audit_log where coalesce(prima::text, '') || coalesce(dopo::text, '') like '%Allergia sintetica%'), 0::bigint,
          'Le note scritte dal cliente non finiscono nello storico');

-- 5. Nessun ordine su un tavolo chiuso
update public.sessioni_tavolo set chiusa_at = now() where id = pg_temp.v('ses')::uuid;
select throws_ok($$ select public.crea_ordine_interno(pg_temp.v('loc')::uuid, pg_temp.v('ses')::uuid, 'ed500000-0000-0000-0000-000000000001',
                    '[{"prodotto_id":"ed300000-0000-0000-0000-000000000001","quantita":1}]', '', 'sala', 'confermato') $$, '22023', null,
                 'Un ordine non si aggancia a un tavolo già chiuso');

-- 6. Fatture conservate, permessi pericolosi tolti, richieste dal telefono di dimensione limitata
select is((select confdeltype::text from pg_constraint where conname = 'fatture_locale_id_fkey'), 'r',
          'Le fatture non si cancellano insieme al locale');
select ok(not has_table_privilege('authenticated', 'public.ordini', 'truncate') and not has_table_privilege('anon', 'public.prodotti', 'truncate'),
          'TRUNCATE tolto ai ruoli dell''API');
select throws_ok($$ insert into public.richieste_tavolo (locale_id, tavolo_id, segreto_hash, righe)
                    values (pg_temp.v('loc')::uuid, 'ed500000-0000-0000-0000-000000000001', 'x', jsonb_build_array(jsonb_build_object('nota', repeat('a', 30000)))) $$,
                 '23514', null, 'Richiesta dal telefono troppo grande rifiutata');

select * from finish();
rollback;
