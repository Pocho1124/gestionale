-- Test: tetto allo sconto per il caposala; il servizio di stampa legge solo le colonne della comanda. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;
create temp table ctx (chiave text primary key, valore text);
grant all on ctx to authenticated;
create function pg_temp.v(p text) returns uuid language sql as $$ select valore::uuid from ctx where chiave = p $$;

select plan(7);
insert into auth.users (id, email, raw_user_meta_data) values
  ('f8111111-1111-1111-1111-111111111111', 'titolare@sconto.local', '{}'),
  ('f8222222-2222-2222-2222-222222222222', 'responsabile@sconto.local', '{}'),
  ('f8333333-3333-3333-3333-333333333333', 'caposala@sconto.local', '{}');
set local role authenticated; select pg_temp.come('f8111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Sconto', 'Locale Sconto', 'locale-sconto');
reset role;
insert into ctx select 'loc', id from public.locali where slug = 'locale-sconto';
insert into public.membri (organizzazione_id, user_id, ruolo) select l.organizzazione_id, v.u::uuid, v.r::public.ruolo from public.locali l,
  (values ('f8222222-2222-2222-2222-222222222222', 'manager'), ('f8333333-3333-3333-3333-333333333333', 'caposala')) v(u, r) where l.slug = 'locale-sconto';
insert into public.categorie (id, locale_id, nome) values ('f8200000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'Menu');
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent) values
  ('f8300000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'f8200000-0000-0000-0000-000000000001', 'Tagliere', 4000);
insert into public.sale (id, locale_id, nome) values ('f8400000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'Interno');
insert into public.tavoli (id, locale_id, sala_id, nome, qr_token) values
  ('f8500000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'f8400000-0000-0000-0000-000000000001', '9', 'token-tavolo-nove-sconto');
insert into public.impostazioni_tavolo (locale_id, sconto_max_pct) values (pg_temp.v('loc'), 20);

set local role authenticated; select pg_temp.come('f8333333-3333-3333-3333-333333333333');
select public.apri_tavolo('f8500000-0000-0000-0000-000000000001', 2);
select public.ordine_sala('f8500000-0000-0000-0000-000000000001', '[{"prodotto_id":"f8300000-0000-0000-0000-000000000001","quantita":1}]');
reset role;
insert into ctx select 's', id from public.sessioni_tavolo where tavolo_id = 'f8500000-0000-0000-0000-000000000001' and chiusa_at is null;

-- 1. Tetto allo sconto
set local role authenticated; select pg_temp.come('f8333333-3333-3333-3333-333333333333');
select throws_ok($$ select public.imposta_sconto(pg_temp.v('s'), null, 30) $$, '42501', 'Sconto oltre il limite del tuo ruolo (massimo 20%): chiedi al responsabile',
                 'Il caposala non supera il tetto del 20%');
select is((public.imposta_sconto(pg_temp.v('s'), 800) ->> 'sconto_cent')::int, 800, 'Il caposala sconta fino al 20% (8 € su 40 €)');
select pg_temp.come('f8222222-2222-2222-2222-222222222222');
select is((public.imposta_sconto(pg_temp.v('s'), null, 50) ->> 'sconto_cent')::int, 2000, 'Il responsabile non ha il tetto');

-- 2. Servizio di stampa: solo le colonne della comanda (controllo dei permessi senza cambiare ruolo:
--    il ruolo del servizio non ha accesso allo schema delle funzioni di test)
reset role;
select ok(not has_column_privilege('servizio_stampa', 'public.tavoli', 'qr_token', 'select'), 'Il servizio di stampa non legge il QR dei tavoli');
select ok(not has_table_privilege('servizio_stampa', 'public.sessioni_tavolo', 'select'), 'Né i codici dei tavoli');
select ok(has_column_privilege('servizio_stampa', 'public.tavoli', 'nome', 'select') and has_column_privilege('servizio_stampa', 'public.ordini', 'nota', 'select')
          and has_column_privilege('servizio_stampa', 'public.ordini', 'origine', 'select') and has_column_privilege('servizio_stampa', 'public.ordini', 'tavolo_id', 'select'),
          'Legge ciò che stampa: tavolo, nota e origine dell''ordine');
select ok(has_column_privilege('servizio_stampa', 'public.righe_ordine', 'opzioni', 'select') and has_column_privilege('servizio_stampa', 'public.righe_ordine', 'reparto_id', 'select')
          and has_column_privilege('servizio_stampa', 'public.stampanti', 'indirizzo', 'select') and not has_column_privilege('servizio_stampa', 'public.righe_ordine', 'prezzo_cent', 'select'),
          'E le righe della comanda, senza i prezzi');

select * from finish();
rollback;
