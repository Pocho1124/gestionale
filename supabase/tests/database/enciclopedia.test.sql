-- Test dell'enciclopedia dei vini: ricerca per nome intero e per somiglianza, voci protette, aggiunte del locale.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(10);
insert into auth.users (id, email, raw_user_meta_data) values
  ('c7000000-0000-0000-0000-000000000001', 'titolare@enc.local', '{}'), ('c7000000-0000-0000-0000-000000000002', 'cameriere@enc.local', '{}');
-- Una voce come quelle di X-Wines (importate a parte)
insert into public.enciclopedia_vini (nome, cantina, tipo, corpo, regione, paese, vitigno, fonte, riferimento)
values ('Falanghina del Sannio', 'Mastroberardino', 'bianco', 'medio', 'Sannio', 'Italia', 'Falanghina', 'xwines', '1');
set local role authenticated;
select pg_temp.come('c7000000-0000-0000-0000-000000000001');
select public.crea_organizzazione('Org Enc', 'Locale Enc', 'locale-enc');
reset role;
insert into public.membri (organizzazione_id, user_id, ruolo) select organizzazione_id, 'c7000000-0000-0000-0000-000000000002', 'cameriere' from public.locali where slug = 'locale-enc';
create temp table ctx as select id as loc from public.locali where slug = 'locale-enc';
grant select on ctx to authenticated;
set local role authenticated;

select is((select nome from public.cerca_vino('Falanghina del Sannio - Mastroberardino') limit 1), 'Falanghina del Sannio',
          'Il nome intero contenuto nel testo vince (la voce più specifica)');
select is((select tipo from public.cerca_vino('Gragnano della Penisola Sorrentina') limit 1), 'rosso', 'Gragnano: rosso (base curata)');
select is((select nome from public.cerca_vino('Primitivo di Manduria') limit 1), 'Primitivo', 'Denominazione riconosciuta dal vitigno');
select is((select nome from public.cerca_vino('Gewurtztraminer') limit 1), 'Gewurztraminer', 'Errore di battitura tollerato');
select is((select nome from public.cerca_vino('Zinfandel californiano') limit 1), 'Primitivo', 'Riconosciuto anche dal nome alternativo');
select is((select count(*) from public.cerca_vino('Feudi di Sangregorio')), 0::bigint, 'Una cantina sconosciuta non viene «indovinata»');

select lives_ok($$ insert into public.enciclopedia_vini (nome, tipo, corpo, regione, vitigno, fonte, locale_id)
                   select 'Feudi di San Gregorio Rubrato', 'rosso', 'strutturato', 'Campania', 'Aglianico', 'locale', loc from ctx $$,
                'Il titolare aggiunge un vino mancante all''enciclopedia');
select is((select fonte from public.cerca_vino('Rubrato Feudi di San Gregorio') limit 1), 'locale', 'La voce aggiunta viene trovata');
select is_empty($$ update public.enciclopedia_vini set tipo = 'bianco' where fonte = 'base' returning id $$, 'Le voci base non si modificano');
select pg_temp.come('c7000000-0000-0000-0000-000000000002');
select throws_ok($$ insert into public.enciclopedia_vini (nome, tipo, corpo, fonte, locale_id) select 'X vino', 'rosso', 'medio', 'locale', loc from ctx $$,
                 '42501', null, 'Il cameriere non aggiunge voci');

select * from finish();
rollback;
