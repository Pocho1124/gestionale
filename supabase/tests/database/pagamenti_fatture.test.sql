-- Test di pagamenti divisi, sconto, esito POS, chiusura al centesimo, resoconto di cassa e fatture. Dati sintetici.
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
-- Sessione aperta del tavolo indicato
create function pg_temp.ses(p_tavolo text) returns uuid language sql as $$
  select id from public.sessioni_tavolo where tavolo_id = p_tavolo::uuid and chiusa_at is null $$;
create function pg_temp.cliente(p_piva text) returns jsonb language sql as $$
  select jsonb_build_object('denominazione', 'Azienda Esempio Srl', 'partita_iva', p_piva, 'indirizzo', 'Via di Prova 1',
                            'cap', '00100', 'comune', 'Roma', 'provincia', 'rm', 'codice_destinatario', 'abc1234') $$;

select plan(28);
insert into auth.users (id, email, raw_user_meta_data) values
  ('f0111111-1111-1111-1111-111111111111', 'titolare@pagamenti.local', '{}'),
  ('f0222222-2222-2222-2222-222222222222', 'caposala@pagamenti.local', '{}'),
  ('f0333333-3333-3333-3333-333333333333', 'cameriere@pagamenti.local', '{}');
set local role authenticated; select pg_temp.come('f0111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Pagamenti', 'Locale Pagamenti', 'locale-pagamenti');
reset role;
insert into ctx select 'loc', id from public.locali where slug = 'locale-pagamenti';
insert into public.membri (organizzazione_id, user_id, ruolo) select organizzazione_id, v.id::uuid, v.r::public.ruolo from public.locali,
  (values ('f0222222-2222-2222-2222-222222222222', 'caposala'), ('f0333333-3333-3333-3333-333333333333', 'cameriere')) v(id, r)
  where slug = 'locale-pagamenti';
insert into public.categorie (id, locale_id, nome) values ('f1000000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'Menu');
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent, aliquota_iva) values
  ('f2000000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'f1000000-0000-0000-0000-000000000001', 'Pizza', 1000, 10),
  ('f2000000-0000-0000-0000-000000000002', pg_temp.v('loc'), 'f1000000-0000-0000-0000-000000000001', 'Bottiglia', 2000, 22);
insert into public.sale (id, locale_id, nome) values ('f3000000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'Interno');
insert into public.tavoli (id, locale_id, sala_id, nome, qr_token) values
  ('f4000000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'f3000000-0000-0000-0000-000000000001', '1', 'token-tavolo-uno-pagamenti'),
  ('f4000000-0000-0000-0000-000000000002', pg_temp.v('loc'), 'f3000000-0000-0000-0000-000000000001', '2', 'token-tavolo-due-pagamenti');
insert into public.terminali_pos (id, locale_id, nome) values ('f5000000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'POS banco');

set local role authenticated; select pg_temp.come('f0222222-2222-2222-2222-222222222222');
select public.apri_tavolo('f4000000-0000-0000-0000-000000000001', 3);
select public.ordine_sala('f4000000-0000-0000-0000-000000000001',
  '[{"prodotto_id":"f2000000-0000-0000-0000-000000000001","quantita":1},{"prodotto_id":"f2000000-0000-0000-0000-000000000002","quantita":1}]');
insert into ctx values ('s1', pg_temp.ses('f4000000-0000-0000-0000-000000000001'));

-- Permessi e conto
select pg_temp.come('f0333333-3333-3333-3333-333333333333');
select throws_ok($$ select public.registra_pagamento(pg_temp.v('s1'), 'contanti', 1000) $$, '42501', null, 'Il cameriere non incassa');
select pg_temp.come('f0222222-2222-2222-2222-222222222222');
select is((public.stato_conto(pg_temp.v('s1')) ->> 'totale_cent')::int, 3000, 'Il conto parte da 30 €');
select is((public.imposta_sconto(pg_temp.v('s1'), null, 10) ->> 'totale_cent')::int, 2700, 'Sconto del 10%: 27 €');

-- Pagamenti divisi
select is((public.registra_pagamento(pg_temp.v('s1'), 'contanti', 1000, null, 2000, 'Quota 1') ->> 'resto_cent')::int, 1000,
          'Contanti: 10 € su 20 dati, resto 10 €');
insert into ctx select 'p1', id from public.pagamenti where sessione_id = pg_temp.v('s1') and quota = 'Quota 1';
select is((public.registra_pagamento(pg_temp.v('s1'), 'contanti', null, 50, null, '50%') ->> 'residuo_cent')::int, 350,
          'Il 50% del totale lo calcola il database (13,50 €): restano 3,50 €');
select throws_ok($$ select public.registra_pagamento(pg_temp.v('s1'), 'contanti', 500) $$, '22023', null, 'Oltre il residuo: rifiutato');
select throws_ok($$ select public.registra_pagamento(pg_temp.v('s1'), 'carta', 100, null, 200) $$, '22023', null, 'Il resto vale solo per i contanti');
select is((public.registra_pagamento(pg_temp.v('s1'), 'carta', 350, null, null, 'Quota POS', 'f5000000-0000-0000-0000-000000000001') ->> 'in_attesa_cent')::int,
          350, 'Il pagamento con il POS attende l''esito');
insert into ctx select 'pos', id from public.pagamenti where sessione_id = pg_temp.v('s1') and metodo = 'carta';
select throws_ok($$ select public.chiudi_tavolo('f4000000-0000-0000-0000-000000000001') $$, '22023', null, 'Con il POS in attesa il tavolo non si chiude');
select is((public.esito_pos(pg_temp.v('pos'), true, 'AUT123') ->> 'pagato_cent')::int, 2700, 'POS approvato: conto saldato');
select throws_ok($$ select public.esito_pos(pg_temp.v('pos'), false) $$, '22023', null, 'Un esito non si cambia');
select is((public.annulla_pagamento(pg_temp.v('p1')) ->> 'residuo_cent')::int, 1000, 'Pagamento annullato: tornano da pagare 10 €');
select throws_ok($$ select public.imposta_sconto(pg_temp.v('s1'), 2000) $$, '22023', null, 'Lo sconto non scende sotto il già pagato');
select throws_ok($$ select public.chiudi_tavolo('f4000000-0000-0000-0000-000000000001') $$, '22023', 'Mancano 10,00 € per saldare il conto',
                 'Il tavolo non si chiude finché manca qualcosa');
select public.registra_pagamento(pg_temp.v('s1'), 'contanti', 1000);
select is(public.chiudi_tavolo('f4000000-0000-0000-0000-000000000001'), 2700, 'Chiusura con il conto saldato al centesimo');
select is((select pagamento from public.sessioni_tavolo where id = pg_temp.v('s1')), 'misto', 'Contanti e POS: pagamento misto');
select throws_ok($$ select public.registra_pagamento(pg_temp.v('s1'), 'contanti', 100) $$, '22023', null, 'A tavolo chiuso non si incassa');

-- Chiusura semplice (senza parti): un pagamento unico col metodo scelto
select public.apri_tavolo('f4000000-0000-0000-0000-000000000002', 2);
select public.ordine_sala('f4000000-0000-0000-0000-000000000002', '[{"prodotto_id":"f2000000-0000-0000-0000-000000000001","quantita":2}]');
select public.chiudi_tavolo('f4000000-0000-0000-0000-000000000002', 'carta');
select is((select stato || ' ' || importo_cent from public.pagamenti p join public.sessioni_tavolo s on s.id = p.sessione_id
           where s.tavolo_id = 'f4000000-0000-0000-0000-000000000002'), 'approvato 2000', 'Chiusura diretta: pagamento unico registrato');

-- Cassa: incassi per metodo dai singoli pagamenti
select pg_temp.come('f0111111-1111-1111-1111-111111111111');
select is(public.resoconto_cassa(pg_temp.v('loc')) -> 'per_pagamento', '{"carta": 2350, "contanti": 2350}'::jsonb,
          'Contanti 13,50 + 10 €; carta 3,50 + 20 € (l''annullato non conta)');
select is((public.resoconto_cassa(pg_temp.v('loc')) ->> 'sconti_cent')::int, 300, 'Il resoconto riporta gli sconti');

-- Fatture
select throws_ok($$ select public.emetti_fattura(pg_temp.v('loc'), pg_temp.cliente('11111111115'), pg_temp.v('s1')) $$, '22023',
                 'Compila prima i dati fiscali del locale', 'Senza dati fiscali niente fattura');
select throws_ok($$ insert into public.dati_fiscali (locale_id, denominazione, partita_iva, indirizzo, cap, comune)
                    values (pg_temp.v('loc'), 'Locale Pagamenti Srl', '11111111111', 'Via Esempio 2', '00100', 'Roma') $$, '23514', null,
                 'Partita IVA con cifra di controllo errata rifiutata');
insert into public.dati_fiscali (locale_id, denominazione, partita_iva, indirizzo, cap, comune, provincia)
  values (pg_temp.v('loc'), 'Locale Pagamenti Srl', '01234567897', 'Via Esempio 2', '00100', 'Roma', 'RM');
select throws_ok($$ select public.emetti_fattura(pg_temp.v('loc'), pg_temp.cliente('11111111111'), pg_temp.v('s1')) $$, '22023',
                 'Partita IVA del cliente non valida', 'Partita IVA del cliente controllata');
insert into ctx select 'f1', public.emetti_fattura(pg_temp.v('loc'), pg_temp.cliente('11111111115'), pg_temp.v('s1')) ->> 'id';
select is((select numero || ' · ' || imponibile_cent || ' + ' || imposta_cent || ' = ' || totale_cent || ' · ' || (cliente ->> 'provincia')
           from public.fatture where id = pg_temp.v('f1')), '1 · 2293 + 407 = 2700 · RM',
          'Fattura n. 1: sconto ripartito tra 10% e 22%, scorporo IVA, totale come il conto');
select throws_ok($$ select public.emetti_fattura(pg_temp.v('loc'), pg_temp.cliente('11111111115'), pg_temp.v('s1')) $$, '22023', null,
                 'Una sola fattura per conto');
select is((public.emetti_fattura(pg_temp.v('loc'), pg_temp.cliente('11111111115'), null,
           '[{"descrizione":"Cena aziendale","quantita":2,"prezzo_cent":5500,"aliquota":10}]') ->> 'numero')::int, 2,
          'Fattura a righe libere: numero successivo');
select throws_ok($$ update public.fatture set totale_cent = 1 $$, '42501', null, 'Le fatture emesse non si modificano');
select pg_temp.come('f0222222-2222-2222-2222-222222222222');
select is((select count(*) from public.fatture), 0::bigint, 'Il caposala non vede le fatture né i dati dei clienti');

select * from finish();
rollback;
