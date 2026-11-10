-- Test delle prenotazioni: permessi, sovrapposizioni, arrivo con apertura del tavolo, niente storico, pulizia. Dati sintetici.
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
create function pg_temp.alle(p_ora text) returns timestamptz language sql as $$ select (current_date + 1 + p_ora::time) at time zone 'Europe/Rome' $$;

select plan(10);
insert into auth.users (id, email, raw_user_meta_data) values
  ('ef111111-1111-1111-1111-111111111111', 'titolare@prenota.local', '{}'),
  ('ef333333-3333-3333-3333-333333333333', 'cameriere@prenota.local', '{}'),
  ('ef444444-4444-4444-4444-444444444444', 'cucina@prenota.local', '{}');
set local role authenticated; select pg_temp.come('ef111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Prenota', 'Locale Prenota', 'locale-prenota');
reset role;
insert into ctx select 'loc', id from public.locali where slug = 'locale-prenota';
insert into public.membri (organizzazione_id, user_id, ruolo) select l.organizzazione_id, v.u::uuid, v.r::public.ruolo from public.locali l,
  (values ('ef333333-3333-3333-3333-333333333333', 'cameriere'), ('ef444444-4444-4444-4444-444444444444', 'cucina')) v(u, r) where l.slug = 'locale-prenota';
insert into public.sale (id, locale_id, nome) values ('ef400000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'Interno');
insert into public.tavoli (id, locale_id, sala_id, nome, qr_token) values
  ('ef500000-0000-0000-0000-000000000001', pg_temp.v('loc'), 'ef400000-0000-0000-0000-000000000001', '4', 'token-tavolo-quattro-prenota');
-- Prenotazione vecchia di 40 giorni (da cancellare alla prossima prenotazione)
insert into public.prenotazioni (locale_id, nome, persone, data_ora) values (pg_temp.v('loc'), 'Cliente Vecchio', 2, now() - interval '40 days');

set local role authenticated; select pg_temp.come('ef444444-4444-4444-4444-444444444444');
select throws_ok($$ insert into public.prenotazioni (locale_id, nome, persone, data_ora) values (pg_temp.v('loc'), 'Prova', 2, now()) $$, '42501', null,
                 'La cucina non prende prenotazioni');
select pg_temp.come('ef333333-3333-3333-3333-333333333333');
select lives_ok($$ insert into public.prenotazioni (locale_id, tavolo_id, nome, telefono, persone, data_ora)
                   values (pg_temp.v('loc'), 'ef500000-0000-0000-0000-000000000001', 'Cliente Esempio', '+39 000 0000000', 4, pg_temp.alle('20:00')) $$,
                'Il cameriere prenota il tavolo 4 per le 20');
select throws_ok($$ insert into public.prenotazioni (locale_id, tavolo_id, nome, persone, data_ora)
                    values (pg_temp.v('loc'), 'ef500000-0000-0000-0000-000000000001', 'Altro Esempio', 2, pg_temp.alle('20:30')) $$, '23P01', null,
                 'Lo stesso tavolo non si prenota in un orario che si sovrappone');
select lives_ok($$ insert into public.prenotazioni (locale_id, tavolo_id, nome, persone, data_ora)
                   values (pg_temp.v('loc'), 'ef500000-0000-0000-0000-000000000001', 'Secondo Turno', 2, pg_temp.alle('22:15')) $$,
                'Dopo le due ore della prima prenotazione il tavolo è di nuovo prenotabile');
select is((select count(*) from public.prenotazioni where nome = 'Cliente Vecchio'), 0::bigint, 'Le prenotazioni di oltre 30 giorni fa si cancellano');
insert into ctx select 'p', id from public.prenotazioni where nome = 'Cliente Esempio';
select throws_ok($$ update public.prenotazioni set sessione_id = gen_random_uuid() where id = pg_temp.v('p') $$, '42501', null,
                 'Il collegamento al tavolo aperto lo fa solo «Arrivati»');

select lives_ok($$ select public.arriva_prenotazione(pg_temp.v('p')) $$, 'Arrivati: si apre il tavolo');
reset role;
select is((select s.coperti || ' ' || p.stato from public.prenotazioni p join public.sessioni_tavolo s on s.id = p.sessione_id where p.id = pg_temp.v('p')),
          '4 arrivata', 'Il tavolo è aperto con le persone della prenotazione');
select is((select count(*) from public.audit_log where coalesce(prima::text, '') || coalesce(dopo::text, '') like '%Cliente Esempio%'), 0::bigint,
          'Nome e telefono non finiscono nello storico');
set local role anon; select pg_temp.anonimo();
select throws_ok($$ select count(*) from public.prenotazioni $$, '42501', null, 'Il pubblico non vede le prenotazioni');

select * from finish();
rollback;
