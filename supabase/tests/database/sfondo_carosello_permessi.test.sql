-- Test dei permessi del controllo delle foto del carosello: chiuso al pubblico, usabile dallo staff.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(2);
select ok(not has_function_privilege('anon', 'public.percorsi_sfondo_validi(uuid, text[])', 'execute'), 'Il pubblico non esegue il controllo del carosello');
select ok(has_function_privilege('authenticated', 'public.percorsi_sfondo_validi(uuid, text[])', 'execute'), 'Lo staff salva l''aspetto con il controllo del carosello');
select * from finish();
rollback;
