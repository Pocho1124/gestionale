-- Test nome del cliente: attivazione dalle impostazioni, validazione, visibilità solo alla sala, nessuna traccia
-- nell'audit, cancellazione a rifiuto, scadenza e chiusura del tavolo. Nomi sintetici.
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

select plan(23);
insert into auth.users (id, email, raw_user_meta_data) values
  ('d0111111-1111-1111-1111-111111111111', 'owner@nome.local', '{}'),
  ('d0222222-2222-2222-2222-222222222222', 'manager@nome.local', '{}'),
  ('d0333333-3333-3333-3333-333333333333', 'cameriere@nome.local', '{}'),
  ('d0444444-4444-4444-4444-444444444444', 'cucina@nome.local', '{}');
set local role authenticated;
select pg_temp.come('d0111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Nome', 'Locale Nome', 'locale-nome');
insert into public.sale (id, locale_id, nome) select 'd1000000-0000-0000-0000-000000000001', id, 'Interno' from public.locali where slug = 'locale-nome';
insert into public.tavoli (id, locale_id, sala_id, nome, qr_token) select 'd2000000-0000-0000-0000-000000000001', id,
  'd1000000-0000-0000-0000-000000000001', '7', 'token-tavolo-sette-nome' from public.locali where slug = 'locale-nome';
insert into public.categorie (id, locale_id, nome) select 'd3000000-0000-0000-0000-000000000001', id, 'Vini' from public.locali where slug = 'locale-nome';
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent)
  select 'd4000000-0000-0000-0000-000000000001', id, 'd3000000-0000-0000-0000-000000000001', 'Calice bianco', 600 from public.locali where slug = 'locale-nome';
insert into public.membri (organizzazione_id, user_id, ruolo) select organizzazione_id, v.id::uuid, v.r::public.ruolo from public.locali,
  (values ('d0222222-2222-2222-2222-222222222222', 'manager'), ('d0333333-3333-3333-3333-333333333333', 'cameriere'),
          ('d0444444-4444-4444-4444-444444444444', 'cucina')) v(id, r) where slug = 'locale-nome';
reset role;
create temp table ctx (chiave text primary key, valore text);
grant all on ctx to anon, authenticated;
create function pg_temp.righe() returns jsonb language sql as $$ select '[{"prodotto_id":"d4000000-0000-0000-0000-000000000001","quantita":1}]'::jsonb $$;
create function pg_temp.id(p text) returns uuid language sql as $$ select valore::uuid from ctx where chiave = p $$;

-- Predefinito: il nome non si chiede e, se arriva lo stesso, non si conserva
set local role anon; select pg_temp.anonimo();
select is(public.tavolo_cliente('token-tavolo-sette-nome') ->> 'chiedi_nome', 'false', 'Per impostazione predefinita il nome non si chiede');
insert into ctx select 'senza', public.richiedi_tavolo('token-tavolo-sette-nome', 'telefono-uno-0000000001', pg_temp.righe(), '', 'Nome Ignorato') ->> 'richiesta';
select ok(pg_temp.id('senza') is not null, 'Con la funzione spenta la richiesta parte comunque');
reset role;
select is((select count(*) from public.nomi_clienti), 0::bigint, 'Con la funzione spenta il nome non viene conservato');

-- Solo titolare e responsabile attivano la funzione
set local role authenticated; select pg_temp.come('d0111111-1111-1111-1111-111111111111');
select ok(public.puo((select id from public.locali where slug = 'locale-nome'), 'impostazioni'), 'Il titolare gestisce le impostazioni');
select pg_temp.come('d0333333-3333-3333-3333-333333333333');
select ok(not public.puo((select id from public.locali where slug = 'locale-nome'), 'impostazioni'), 'Il cameriere no');
select throws_ok($$ insert into public.impostazioni_tavolo (locale_id, chiedi_nome) select id, true from public.locali where slug = 'locale-nome' $$,
                 '42501', null, 'Il cameriere non attiva la funzione');
select pg_temp.come('d0222222-2222-2222-2222-222222222222');
select lives_ok($$ insert into public.impostazioni_tavolo (locale_id, chiedi_nome, nome_obbligatorio) select id, true, true from public.locali where slug = 'locale-nome' $$,
                'Il responsabile attiva il nome obbligatorio');
select throws_ok($$ update public.impostazioni_tavolo set chiedi_nome = false $$, '23514', null, 'Obbligatorio senza chiedere il nome: rifiutato');

-- Pagina del tavolo e validazione
set local role anon; select pg_temp.anonimo();
select is(public.tavolo_cliente('token-tavolo-sette-nome') ->> 'nome_obbligatorio', 'true', 'La pagina del tavolo sa che il nome è obbligatorio');
select is(public.richiedi_tavolo('token-tavolo-sette-nome', 'telefono-due-00000000002', pg_temp.righe(), '', '   ') ->> 'errore',
          'Scrivi il tuo nome per chiedere l''apertura del tavolo', 'Senza nome la richiesta non parte');
select alike(public.richiedi_tavolo('token-tavolo-sette-nome', 'telefono-due-00000000002', pg_temp.righe(), '', '<script>x</script>') ->> 'errore',
            'Nome non valido%', 'Caratteri non ammessi rifiutati');
select alike(public.richiedi_tavolo('token-tavolo-sette-nome', 'telefono-due-00000000002', pg_temp.righe(), '', repeat('a', 41)) ->> 'errore',
            'Nome non valido%', 'Nome oltre 40 caratteri rifiutato');
insert into ctx select 'anna', public.richiedi_tavolo('token-tavolo-sette-nome', 'telefono-due-00000000002', pg_temp.righe(), '', '  Anna   D''Esempio ') ->> 'richiesta';
select ok(pg_temp.id('anna') is not null, 'Con un nome valido la richiesta parte');
select throws_ok($$ select count(*) from public.nomi_clienti $$, '42501', null, 'Il pubblico non legge i nomi');

-- Chi vede il nome
set local role authenticated; select pg_temp.come('d0444444-4444-4444-4444-444444444444');
select is((select count(*) from public.nomi_clienti), 0::bigint, 'La cucina non vede i nomi');
select pg_temp.come('d0333333-3333-3333-3333-333333333333');
select is((select n.nome from public.richieste_tavolo r join public.nomi_clienti n on n.richiesta_id = r.id where r.id = pg_temp.id('anna')),
          'Anna D''Esempio', 'Il cameriere vede il nome, con gli spazi normalizzati');
select throws_ok($$ update public.nomi_clienti set nome = 'Altro' $$, '42501', null, 'Il personale non modifica i nomi');

-- Accettata: il nome segue il tavolo, ma non finisce nell'audit
select lives_ok($$ select public.accetta_richiesta(pg_temp.id('anna'), 2) $$, 'Il cameriere accetta la richiesta');
reset role;
select is((select sessione_id from public.nomi_clienti where richiesta_id = pg_temp.id('anna')),
          (select id from public.sessioni_tavolo where tavolo_id = 'd2000000-0000-0000-0000-000000000001' and chiusa_at is null), 'Il nome è legato al tavolo aperto');
select is((select count(*) from public.audit_log where coalesce(prima::text, '') || coalesce(dopo::text, '') like '%Esempio%'), 0::bigint,
          'Il nome non compare nello storico delle modifiche');

-- Rifiutata o scaduta: il nome si cancella
set local role anon; select pg_temp.anonimo();
insert into ctx select 'bruno', public.richiedi_tavolo('token-tavolo-sette-nome', 'telefono-tre-00000000003', pg_temp.righe(), '', 'Bruno Esempio') ->> 'richiesta';
insert into ctx select 'carla', public.richiedi_tavolo('token-tavolo-sette-nome', 'telefono-quattro-0000004', pg_temp.righe(), '', 'Carla Esempio') ->> 'richiesta';
set local role authenticated; select pg_temp.come('d0333333-3333-3333-3333-333333333333');
select public.rifiuta_richiesta(pg_temp.id('bruno'), 'Prova');
reset role;
update public.richieste_tavolo set creato_at = now() - interval '20 minutes' where id = pg_temp.id('carla');
set local role anon; select pg_temp.anonimo();
select is(public.stato_richiesta('token-tavolo-sette-nome', pg_temp.id('carla'), 'telefono-quattro-0000004') ->> 'stato', 'scaduta', 'La richiesta non gestita scade');
reset role;
select is((select count(*) from public.nomi_clienti where richiesta_id in (pg_temp.id('bruno'), pg_temp.id('carla'))), 0::bigint,
          'Nomi di richieste rifiutate o scadute cancellati');

-- Tavolo chiuso: il nome si cancella
set local role authenticated; select pg_temp.come('d0111111-1111-1111-1111-111111111111');
select public.chiudi_tavolo('d2000000-0000-0000-0000-000000000001', 'carta');
reset role;
select is((select count(*) from public.nomi_clienti), 0::bigint, 'Alla chiusura del tavolo il nome si cancella');

select * from finish();
rollback;
