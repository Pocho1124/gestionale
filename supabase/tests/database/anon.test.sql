-- Test della chiave pubblica: esattamente le funzioni previste, nessuna tabella, nessuna sequenza.
-- Se in futuro una migrazione espone qualcos'altro ad anon, questo test fallisce.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(7);

select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')),
  array['chiedi_conto', 'foto_prodotto', 'invia_ordine', 'menu_pubblico', 'ordini_tavolo', 'richiedi_tavolo', 'stato_richiesta', 'tavolo_cliente'],
  'Il pubblico può chiamare solo le funzioni del menu e degli ordini dal tavolo');

select is((select count(*) from information_schema.role_table_grants where grantee in ('anon', 'PUBLIC') and table_schema = 'public'),
          0::bigint, 'Il pubblico non ha permessi su nessuna tabella');
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and case when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, 'usage,select,update') else false end),
          0::bigint, 'Il pubblico non usa nessuna sequenza');
select ok(not has_function_privilege('anon', 'public.ha_ruolo_locale(uuid, public.ruolo[])', 'execute'), 'Le funzioni dei permessi non sono pubbliche');
select ok(has_function_privilege('authenticated', 'public.crea_organizzazione(text, text, text)', 'execute'), 'Lo staff continua a usare le sue funzioni');
select ok(not has_function_privilege('authenticated', 'public.verifica_tavolo(text, text)', 'execute'), 'Le funzioni interne restano chiuse anche allo staff');

-- Una tabella creata dopo non diventa pubblica da sola (le funzioni sono sorvegliate dal primo test)
create table public.prova_futura_t (id int);
select ok(not has_table_privilege('anon', 'public.prova_futura_t', 'select'), 'Le tabelle nuove non sono pubbliche per default');

select * from finish();
rollback;
