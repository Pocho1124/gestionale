-- Sicurezza (punti aperti dell'analisi):
-- 1. tetto allo sconto per chi non gestisce le impostazioni (caposala): percentuale massima decisa dal titolare;
-- 2. il ruolo del servizio di stampa legge solo le colonne che stampa (niente qr_token dei tavoli, codici, nomi).

-- ============================================================ 1. Sconto massimo per il caposala
alter table public.impostazioni_tavolo add column sconto_max_pct int not null default 100 check (sconto_max_pct between 0 and 100);

create or replace function public.imposta_sconto(p_sessione uuid, p_cent int default null, p_percentuale numeric default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ses public.sessioni_tavolo := public.sessione_da_incassare(p_sessione); v_lordo int := public.totale_sessione(p_sessione);
        v_sconto int; v_impegnato int; v_max int;
begin
  if p_percentuale is not null then
    if p_percentuale < 0 or p_percentuale > 100 then raise exception 'Percentuale di sconto tra 0 e 100' using errcode = '22023'; end if;
    v_sconto := round(v_lordo * p_percentuale / 100)::int;
  else
    v_sconto := coalesce(p_cent, 0);
  end if;
  if v_sconto < 0 or v_sconto > v_lordo then raise exception 'Lo sconto non può superare il conto' using errcode = '22023'; end if;
  -- Titolare e responsabile senza limiti; per gli altri ruoli il tetto delle impostazioni
  if not public.puo(v_ses.locale_id, 'impostazioni') then
    v_max := coalesce((select sconto_max_pct from public.impostazioni_tavolo where locale_id = v_ses.locale_id), 100);
    if v_sconto > round(v_lordo * v_max / 100.0) then
      raise exception 'Sconto oltre il limite del tuo ruolo (massimo %): chiedi al responsabile', v_max || '%' using errcode = '42501';
    end if;
  end if;
  select coalesce(sum(importo_cent), 0) into v_impegnato from public.pagamenti where sessione_id = p_sessione and stato in ('approvato', 'in_attesa');
  if v_lordo - v_sconto < v_impegnato then raise exception 'Con questo sconto il conto scende sotto quanto già pagato: annulla prima un pagamento' using errcode = '22023'; end if;
  update public.sessioni_tavolo set sconto_cent = v_sconto where id = v_ses.id;
  return public.stato_conto(p_sessione);
end $$;
revoke execute on function public.imposta_sconto(uuid, int, numeric) from public, anon, authenticated;
grant execute on function public.imposta_sconto(uuid, int, numeric) to authenticated;

-- ============================================================ 2. Servizio di stampa: solo le colonne della comanda
revoke select on public.tavoli, public.ordini, public.righe_ordine, public.stampanti, public.reparti from servizio_stampa;
grant select (id, locale_id, nome) on public.tavoli to servizio_stampa;
grant select (id, locale_id, tavolo_id, nota, origine) on public.ordini to servizio_stampa;
grant select (ordine_id, locale_id, reparto_id, nome, quantita, nota, opzioni) on public.righe_ordine to servizio_stampa;
grant select (id, locale_id, nome, indirizzo, porta, colonne, attiva) on public.stampanti to servizio_stampa;
grant select (id, locale_id, nome) on public.reparti to servizio_stampa;
