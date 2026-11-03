-- Minimo privilegio per la chiave pubblica (ruolo anon): nessuna tabella, nessuna sequenza,
-- solo le funzioni del menu pubblico e degli ordini dal tavolo. Vale anche per gli oggetti creati in futuro.

-- 1) Le funzioni nascono eseguibili da PUBLIC (quindi anche da anon): prima di togliere quel permesso
--    si rende esplicito ciò che authenticated e service_role possono già fare, così nulla si rompe.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' loop
    if has_function_privilege('authenticated', f.firma, 'execute') then execute format('grant execute on function %s to authenticated', f.firma); end if;
    if has_function_privilege('service_role', f.firma, 'execute') then execute format('grant execute on function %s to service_role', f.firma); end if;
  end loop;
end $$;

revoke execute on all functions in schema public from public, anon;
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;

-- 2) Elenco chiuso di ciò che il pubblico può chiamare
grant execute on function
  public.menu_pubblico(text),                          -- menu pubblico e menu interno
  public.foto_prodotto(uuid),                          -- foto dei piatti visibili
  public.tavolo_cliente(text),                         -- pagina del tavolo (QR)
  public.invia_ordine(text, text, jsonb, text),        -- ordine con codice del tavolo
  public.ordini_tavolo(text, text),                    -- stato degli ordini con codice
  public.richiedi_tavolo(text, text, jsonb, text),     -- richiesta di apertura senza codice
  public.stato_richiesta(text, uuid, text),            -- esito della richiesta (solo con il segreto del telefono)
  public.chiedi_conto(text, text, text)                -- richiesta del conto con codice
to anon;

-- 3) Oggetti futuri: tabelle e sequenze nuove non sono più pubbliche per default.
--    Le funzioni nascono comunque eseguibili da PUBLIC (regola globale di PostgreSQL, toglierla romperebbe
--    le estensioni): ogni migrazione deve revocarlo, e il test anon.test.sql blocca il rilascio se una
--    funzione non prevista diventa chiamabile dal pubblico.
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
