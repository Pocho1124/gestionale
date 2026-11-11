-- Codice personale sempre. Ogni azione sui tavoli (aprire, comandare, confermare, incassare, stornare) chiede nome + codice
-- su qualsiasi account, titolare compreso: è attivo da subito sui locali esistenti e lo spegne solo il titolare
-- (uscita di emergenza). Lavora senza codice solo l'account esente del bot Telegram, che approva richieste e conti dal telefono.
-- Le postazioni condivise lavorano solo in sala e in cucina: catalogo, aspetto, magazzino, cassa e impostazioni si gestiscono
-- solo dal proprio account, e una postazione ha il ruolo di cameriere o caposala, mai di più.
-- Chi ha inserito il codice vede anche conto e pagamenti del tavolo (es. il caposala che incassa dal tablet dei camerieri).

alter table public.sicurezza_sala add column codice_obbligatorio boolean not null default false;
insert into public.sicurezza_sala (locale_id, codice_obbligatorio) select id, true from public.locali
  on conflict (locale_id) do update set codice_obbligatorio = true;

alter table public.membri add column esente_codice boolean not null default false;
-- Account del bot creato da bot-installa.sh (bot-telegram-<slug>@gestionale.local)
update public.membri m set esente_codice = true from auth.users u where u.id = m.user_id and u.email like 'bot-telegram-%@gestionale.local';
update public.membri set chiede_codice = false where chiede_codice and ruolo not in ('cameriere', 'caposala');
alter table public.membri add constraint postazione_solo_sala check (not chiede_codice or ruolo in ('cameriere', 'caposala'));

/** L'account collegato è una postazione condivisa. */
create function public.e_postazione(p_locale uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.chiede_codice from public.membri m join public.locali l on l.organizzazione_id = m.organizzazione_id
                    where l.id = p_locale and m.user_id = (select auth.uid()) and (m.locale_id is null or m.locale_id = p_locale)), false);
$$;

create or replace function public.chiede_codice(p_locale uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select m.chiede_codice
        or (not m.esente_codice and coalesce((select s.codice_obbligatorio from public.sicurezza_sala s where s.locale_id = p_locale), false))
      from public.membri m join public.locali l on l.organizzazione_id = m.organizzazione_id
     where l.id = p_locale and m.user_id = (select auth.uid()) and (m.locale_id is null or m.locale_id = p_locale)), false);
$$;

/**
 * Capacità senza codice (per guardare e per tutto ciò che non è sala): sulle postazioni solo sala e cucina.
 * Per guardare conto, nomi e pagamenti vale anche il ruolo di chi ha inserito il codice.
 */
create or replace function public.puo_account(p_locale uuid, p_capacita text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when public.e_postazione(p_locale)
         and not (p_capacita = any (array['sala.apri','sala.comanda','ordini.conferma','sala.chiudi','ordini.annulla','cucina.avanza','esauriti']))
      then false
    else coalesce(public.ruolo_in_locale(p_locale)::text = any (public.ruoli_capacita(p_capacita)), false)
      or (p_capacita = any (array['sala.apri','sala.comanda','ordini.conferma','sala.chiudi','ordini.annulla'])
          and coalesce(public.ruolo_effettivo(p_locale)::text = any (public.ruoli_capacita(p_capacita)), false))
  end;
$$;

drop function public.imposta_sicurezza_sala(uuid, int, boolean);
create function public.imposta_sicurezza_sala(p_locale uuid, p_durata_secondi int, p_solo_responsabile boolean, p_codice_obbligatorio boolean default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_attuale boolean;
begin
  if not public.puo(p_locale, 'impostazioni') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  v_attuale := coalesce((select s.codice_obbligatorio from public.sicurezza_sala s where s.locale_id = p_locale), false);
  if p_codice_obbligatorio is not null and p_codice_obbligatorio <> v_attuale and not public.puo(p_locale, 'cassa') then
    raise exception 'Solo il titolare cambia l''obbligo del codice' using errcode = '42501';
  end if;
  insert into public.sicurezza_sala (locale_id, durata_secondi, solo_responsabile, codice_obbligatorio)
    values (p_locale, p_durata_secondi, p_solo_responsabile, coalesce(p_codice_obbligatorio, v_attuale))
    on conflict (locale_id) do update set durata_secondi = excluded.durata_secondi, solo_responsabile = excluded.solo_responsabile,
                                          codice_obbligatorio = excluded.codice_obbligatorio;
end $$;

/** Account esente dal codice (bot Telegram): lo decide chi gestisce il personale; mai una postazione. */
create function public.imposta_esente_codice(p_locale uuid, p_utente uuid, p_valore boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.controlla_gestione(p_locale, p_utente);
  update public.membri m set esente_codice = p_valore
    from public.locali l where l.id = p_locale and m.organizzazione_id = l.organizzazione_id and m.user_id = p_utente and not m.chiede_codice;
end $$;

create or replace function public.stato_operatore(p_locale uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_op uuid;
begin
  if public.ruolo_in_locale(p_locale) is null then raise exception 'Permesso negato' using errcode = '42501'; end if;
  v_op := public.operatore_corrente(p_locale);
  return jsonb_build_object(
    'chiede_codice', public.chiede_codice(p_locale),
    'postazione', public.e_postazione(p_locale),
    'durata_secondi', coalesce((select s.durata_secondi from public.sicurezza_sala s where s.locale_id = p_locale), 120),
    'solo_responsabile', coalesce((select s.solo_responsabile from public.sicurezza_sala s where s.locale_id = p_locale), false),
    'codice_obbligatorio', coalesce((select s.codice_obbligatorio from public.sicurezza_sala s where s.locale_id = p_locale), false),
    'operatore', case when v_op is null then null else jsonb_build_object(
        'id', v_op, 'nome', public.nome_responsabile(v_op), 'ruolo', public.ruolo_di(p_locale, v_op),
        'scade_at', (select o.scade_at from public.operatori_attivi o where o.locale_id = p_locale and o.account = (select auth.uid())
                       and o.sessione = public.sessione_accesso())) end,
    'personale', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.user_id, 'nome', coalesce(nullif(p.nome, ''), 'Senza nome'), 'ruolo', m.ruolo,
                                          'ha_codice', c.user_id is not null, 'postazione', m.chiede_codice, 'esente', m.esente_codice)
                       order by public.livello_ruolo(m.ruolo) desc, p.nome)
        from public.membri m join public.locali l on l.organizzazione_id = m.organizzazione_id
        left join public.profili p on p.id = m.user_id
        left join public.codici_personali c on c.locale_id = p_locale and c.user_id = m.user_id
       where l.id = p_locale and (m.locale_id is null or m.locale_id = p_locale)
         and public.ruolo_di(p_locale, m.user_id) is not null), '[]'::jsonb));
end $$;

/** Postazione: solo per account di cameriere o caposala (lo garantisce anche il vincolo su membri). */
create or replace function public.imposta_chiede_codice(p_locale uuid, p_utente uuid, p_valore boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_ruolo public.ruolo := public.controlla_gestione(p_locale, p_utente);
begin
  if p_valore and v_ruolo not in ('cameriere', 'caposala') then
    raise exception 'Una postazione condivisa deve avere il ruolo di cameriere o caposala' using errcode = '22023';
  end if;
  update public.membri m set chiede_codice = p_valore, esente_codice = case when p_valore then false else m.esente_codice end
    from public.locali l where l.id = p_locale and m.organizzazione_id = l.organizzazione_id and m.user_id = p_utente;
end $$;

revoke execute on function public.e_postazione(uuid), public.imposta_sicurezza_sala(uuid, int, boolean, boolean),
  public.imposta_esente_codice(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.imposta_sicurezza_sala(uuid, int, boolean, boolean), public.imposta_esente_codice(uuid, uuid, boolean) to authenticated;
