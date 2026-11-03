-- Test archivio immagini: percorsi confinati al proprio locale, menu leggero, regole dell'archivio (se installato).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

-- Lettura del limite con SQL dinamico: dove lo schema storage non esiste, la query non viene neppure preparata
create function pg_temp.limite_archivio() returns bigint language plpgsql as $f$
declare v bigint;
begin execute $q$select file_size_limit from storage.buckets where id = 'immagini'$q$ into v; return v; end $f$;

select plan(11);
insert into auth.users (id, email, raw_user_meta_data) values
  ('e0111111-1111-1111-1111-111111111111', 'owner@arch.local', '{}'),
  ('e0222222-2222-2222-2222-222222222222', 'altro@arch.local', '{}'),
  ('e0333333-3333-3333-3333-333333333333', 'cameriere@arch.local', '{}');
set local role authenticated;
select pg_temp.come('e0222222-2222-2222-2222-222222222222');
select public.crea_organizzazione('Org Altra', 'Locale Altro', 'locale-altro');
select pg_temp.come('e0111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Arch', 'Locale Arch', 'locale-arch');
reset role;
create temp table ctx as select (select id from public.locali where slug = 'locale-arch') as mio, (select id from public.locali where slug = 'locale-altro') as altro;
grant select on ctx to authenticated;
insert into public.membri (organizzazione_id, user_id, ruolo)
  select organizzazione_id, 'e0333333-3333-3333-3333-333333333333', 'cameriere' from public.locali where slug = 'locale-arch';
insert into public.categorie (id, locale_id, nome) select 'e1000000-0000-0000-0000-000000000001', mio, 'Pinse' from ctx;
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent) select 'e2000000-0000-0000-0000-000000000001', mio, 'e1000000-0000-0000-0000-000000000001', 'Pinsa', 1200 from ctx;
set local role authenticated;
select pg_temp.come('e0111111-1111-1111-1111-111111111111');

select lives_ok($$ update public.aspetto set logo_path = (select mio from ctx) || '/logo/a1b2c3d4-0000-4000-8000-000000000001.webp',
                   logo_dati = 'data:image/png;base64,AAAA' $$, 'Il titolare imposta il logo nell''archivio');
select throws_ok($$ update public.aspetto set logo_path = (select altro from ctx) || '/logo/a1b2c3d4-0000-4000-8000-000000000001.webp' $$,
                 '23514', null, 'Un percorso nella cartella di un altro locale è rifiutato');
select throws_ok($$ update public.aspetto set sfondo_path = (select mio from ctx) || '/sfondo/a1b2c3d4-0000-4000-8000-000000000001.svg' $$,
                 '23514', null, 'Un formato non ammesso è rifiutato');
select is(public.menu_pubblico('locale-arch') -> 'aspetto' ->> 'logo_dati', null, 'Con il logo nell''archivio il menu non porta più il base64');
select ok(public.menu_pubblico('locale-arch') -> 'aspetto' ->> 'logo_path' like '%/logo/%', 'Il menu porta l''indirizzo del logo');
select lives_ok($$ insert into public.foto_prodotti (prodotto_id, locale_id, path)
                   select 'e2000000-0000-0000-0000-000000000001', mio, mio || '/piatti/a1b2c3d4-0000-4000-8000-000000000002.jpg' from ctx $$,
                'La foto del piatto può stare solo nell''archivio');
select ok(public.menu_pubblico('locale-arch') -> 'categorie' -> 0 -> 'prodotti' -> 0 ->> 'foto_path' like '%/piatti/%', 'Il menu porta l''indirizzo della foto');

-- Regole dell'archivio: provate solo dove il servizio Storage è installato (in locale e sul server)
select case when to_regclass('storage.buckets') is not null and exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'immagini_carica')
  then lives_ok($$ insert into storage.objects (bucket_id, name) select 'immagini', mio || '/piatti/a1b2c3d4-0000-4000-8000-000000000003.jpg' from ctx $$,
                'Il titolare carica nella cartella del suo locale')
  else skip('archivio non installato', 1) end;
select case when exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'immagini_carica')
  then throws_ok($$ insert into storage.objects (bucket_id, name) select 'immagini', altro || '/piatti/a1b2c3d4-0000-4000-8000-000000000004.jpg' from ctx $$,
                 '42501', null, 'Il titolare non carica nella cartella di un altro locale')
  else skip('archivio non installato', 1) end;
select pg_temp.come('e0333333-3333-3333-3333-333333333333');
select case when exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'immagini_carica')
  then throws_ok($$ insert into storage.objects (bucket_id, name) select 'immagini', mio || '/piatti/a1b2c3d4-0000-4000-8000-000000000005.jpg' from ctx $$,
                 '42501', null, 'Il cameriere non carica immagini')
  else skip('archivio non installato', 1) end;
reset role;
select case when to_regclass('storage.buckets') is not null and exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit')
  then is(pg_temp.limite_archivio(), 2097152::bigint, 'Il server limita ogni immagine a 2 MB')
  else skip('archivio non installato', 1) end;

select * from finish();
rollback;
