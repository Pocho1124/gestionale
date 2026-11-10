-- percorsi_sfondo_validi() (controllo delle foto del carosello) era eseguibile da PUBLIC, quindi anche dalla chiave pubblica:
-- la usa solo il vincolo sull'aspetto, valutato con i permessi di chi modifica (staff autenticato).
revoke execute on function public.percorsi_sfondo_validi(uuid, text[]) from public, anon;
grant execute on function public.percorsi_sfondo_validi(uuid, text[]) to authenticated, service_role;
