-- Test dei piatti componibili (tagliere personalizzato): prezzo calcolato dal database, limiti per gruppo, magazzino.
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
-- Ordine con le scelte indicate (identificativi delle voci)
create function pg_temp.riga(p_scelte text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('prodotto_id', 'b9000000-0000-0000-0000-000000000001', 'quantita', 2, 'opzioni', p_scelte::jsonb, 'prezzo_cent', 1));
$$;

select plan(13);
insert into auth.users (id, email, raw_user_meta_data) values ('b8000000-0000-0000-0000-000000000001', 'titolare@tag.local', '{}');
set local role authenticated;
select pg_temp.come('b8000000-0000-0000-0000-000000000001');
select public.crea_organizzazione('Org Tag', 'Locale Tag', 'locale-tag');
reset role;
create temp table ctx as select id as loc from public.locali where slug = 'locale-tag';
grant select on ctx to anon, authenticated;
insert into public.categorie (id, locale_id, nome) select 'b9100000-0000-0000-0000-000000000001', loc, 'Taglieri' from ctx;
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent) select x.id::uuid, loc, 'b9100000-0000-0000-0000-000000000001', x.n, x.p from ctx,
  (values ('b9000000-0000-0000-0000-000000000001', 'Tagliere personalizzato', 300), ('b9000000-0000-0000-0000-000000000002', 'Altro piatto', 500)) x(id, n, p);
insert into public.gruppi_opzioni (id, locale_id, prodotto_id, nome, min_scelte, max_scelte, posizione) select x.id::uuid, loc, x.p::uuid, x.n, x.mi, x.ma, x.pos from ctx,
  (values ('b9200000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001', 'Salumi', 1, 3, 0),
          ('b9200000-0000-0000-0000-000000000002', 'b9000000-0000-0000-0000-000000000001', 'Formaggi', 0, 3, 1),
          ('b9200000-0000-0000-0000-000000000003', 'b9000000-0000-0000-0000-000000000002', 'Altro', 0, 1, 0)) x(id, p, n, mi, ma, pos);
insert into public.opzioni (id, locale_id, gruppo_id, nome, sovrapprezzo_cent, disponibile) select x.id::uuid, loc, x.g::uuid, x.n, x.c, x.d from ctx,
  (values ('b9300000-0000-0000-0000-000000000001', 'b9200000-0000-0000-0000-000000000001', 'Prosciutto crudo', 350, true),
          ('b9300000-0000-0000-0000-000000000002', 'b9200000-0000-0000-0000-000000000001', 'Salame', 250, true),
          ('b9300000-0000-0000-0000-000000000003', 'b9200000-0000-0000-0000-000000000001', 'Bresaola', 300, true),
          ('b9300000-0000-0000-0000-000000000004', 'b9200000-0000-0000-0000-000000000001', 'Lardo', 200, true),
          ('b9300000-0000-0000-0000-000000000005', 'b9200000-0000-0000-0000-000000000002', 'Gorgonzola', 300, true),
          ('b9300000-0000-0000-0000-000000000006', 'b9200000-0000-0000-0000-000000000002', 'Pecorino', 280, false),
          ('b9300000-0000-0000-0000-000000000007', 'b9200000-0000-0000-0000-000000000003', 'Voce di un altro piatto', 100, true)) x(id, g, n, c, d);
insert into public.sale (id, locale_id, nome) select 'b9400000-0000-0000-0000-000000000001', loc, 'Interno' from ctx;
insert into public.tavoli (id, locale_id, sala_id, nome, qr_token) select 'b9500000-0000-0000-0000-000000000001', loc, 'b9400000-0000-0000-0000-000000000001', '3', 'token-tavolo-tre-tagliere' from ctx;
insert into public.articoli (id, locale_id, nome, unita) select 'b9600000-0000-0000-0000-000000000001', loc, 'Prosciutto crudo', 'kg' from ctx;
insert into public.componenti_opzioni (opzione_id, articolo_id, locale_id, quantita)
  select 'b9300000-0000-0000-0000-000000000001', 'b9600000-0000-0000-0000-000000000001', loc, 0.05 from ctx;
set local role authenticated;
select pg_temp.come('b8000000-0000-0000-0000-000000000001');
select public.apri_tavolo('b9500000-0000-0000-0000-000000000001', 2);

select ok((select jsonb_array_length(public.menu_pubblico('locale-tag') -> 'categorie' -> 0 -> 'prodotti' -> 1 -> 'opzioni' -> 0 -> 'scelte') = 4
           and public.menu_pubblico('locale-tag') -> 'categorie' -> 0 -> 'prodotti' -> 1 -> 'opzioni' -> 0 -> 'scelte' -> 0 ? 'id'),
          'Il menu porta gruppi e voci con i loro identificativi');

select public.ordine_sala('b9500000-0000-0000-0000-000000000001',
  pg_temp.riga('["b9300000-0000-0000-0000-000000000001","b9300000-0000-0000-0000-000000000002","b9300000-0000-0000-0000-000000000005"]'));
select is((select prezzo_cent from public.righe_ordine where prodotto_id = 'b9000000-0000-0000-0000-000000000001' limit 1), 1200,
          'Prezzo = base 3 € + crudo 3,50 + salame 2,50 + gorgonzola 3 = 12 € (il prezzo inviato dal client è ignorato)');
select is((select jsonb_array_length(opzioni) from public.righe_ordine limit 1), 3, 'Le scelte restano salvate nella riga');
select is((select giacenza from public.articoli), -0.100, 'Il crudo scelto scarica 0,05 kg per ogni tagliere (2 taglieri)');

select throws_ok($$ select public.ordine_sala('b9500000-0000-0000-0000-000000000001', pg_temp.riga(
  '["b9300000-0000-0000-0000-000000000001","b9300000-0000-0000-0000-000000000002","b9300000-0000-0000-0000-000000000003","b9300000-0000-0000-0000-000000000004"]')) $$,
  '22023', null, 'Più di 3 salumi rifiutato');
select throws_ok($$ select public.ordine_sala('b9500000-0000-0000-0000-000000000001', pg_temp.riga('["b9300000-0000-0000-0000-000000000005"]')) $$,
  '22023', null, 'Senza il salume obbligatorio rifiutato');
select throws_ok($$ select public.ordine_sala('b9500000-0000-0000-0000-000000000001', pg_temp.riga('["b9300000-0000-0000-0000-000000000001","b9300000-0000-0000-0000-000000000007"]')) $$,
  '22023', null, 'Una voce di un altro piatto rifiutata');
select throws_ok($$ select public.ordine_sala('b9500000-0000-0000-0000-000000000001', pg_temp.riga('["b9300000-0000-0000-0000-000000000001","b9300000-0000-0000-0000-000000000006"]')) $$,
  '22023', null, 'Una voce non disponibile rifiutata');
select throws_ok($$ select public.ordine_sala('b9500000-0000-0000-0000-000000000001', pg_temp.riga('["b9300000-0000-0000-0000-000000000001","b9300000-0000-0000-0000-000000000001"]')) $$,
  '22023', null, 'La stessa voce ripetuta rifiutata');

-- Dal telefono del cliente
reset role;
create temp table cod as select codice from public.sessioni_tavolo where chiusa_at is null;
grant select on cod to anon;
set local role anon; select pg_temp.anonimo();
select is(public.invia_ordine('token-tavolo-tre-tagliere', (select codice from cod), pg_temp.riga('["b9300000-0000-0000-0000-000000000003"]')) ->> 'stato',
          'confermato', 'Il cliente compone il tagliere dal telefono');
select alike(public.richiedi_tavolo('token-tavolo-tre-tagliere', 'segreto-telefono-abcdef', pg_temp.riga('[]')) ->> 'errore',
          '%Salumi%', 'Una richiesta senza la scelta obbligatoria riceve un messaggio chiaro');
select ok(public.ordini_tavolo('token-tavolo-tre-tagliere', (select codice from cod))::text like '%"opzioni": ["Bresaola"]%',
          'Il cliente rivede le sue scelte negli ordini inviati');
select throws_ok($$ select public.prezzo_riga((select loc from ctx limit 1), 'b9000000-0000-0000-0000-000000000001', '[]') $$, '42501', null,
                 'La funzione di calcolo è interna');

select * from finish();
rollback;
