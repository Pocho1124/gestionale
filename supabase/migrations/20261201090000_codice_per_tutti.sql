-- Codice personale su tutti gli account, non solo sulle postazioni condivise: con «codice_per_tutti» le azioni di sala
-- chiedono nome + codice anche sul proprio account (una schermata lasciata aperta non modifica nulla).
-- Gli account esenti (es. il bot Telegram, che approva richieste e conti dal telefono) lavorano senza codice.

alter table public.sicurezza_sala add column codice_per_tutti boolean not null default false;
alter table public.membri add column esente_codice boolean not null default false;

create or replace function public.chiede_codice(p_locale uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select m.chiede_codice
        or (not m.esente_codice and coalesce((select s.codice_per_tutti from public.sicurezza_sala s where s.locale_id = p_locale), false))
      from public.membri m join public.locali l on l.organizzazione_id = m.organizzazione_id
     where l.id = p_locale and m.user_id = (select auth.uid()) and (m.locale_id is null or m.locale_id = p_locale)), false);
$$;

drop function public.imposta_sicurezza_sala(uuid, int, boolean);
create function public.imposta_sicurezza_sala(p_locale uuid, p_durata_secondi int, p_solo_responsabile boolean, p_codice_per_tutti boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.puo(p_locale, 'impostazioni') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  insert into public.sicurezza_sala (locale_id, durata_secondi, solo_responsabile, codice_per_tutti)
    values (p_locale, p_durata_secondi, p_solo_responsabile, coalesce(p_codice_per_tutti, false))
    on conflict (locale_id) do update set durata_secondi = excluded.durata_secondi, solo_responsabile = excluded.solo_responsabile,
                                          codice_per_tutti = excluded.codice_per_tutti;
end $$;

/** Account esente dal codice (bot Telegram): lo decide chi gestisce il personale. */
create function public.imposta_esente_codice(p_locale uuid, p_utente uuid, p_valore boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.controlla_gestione(p_locale, p_utente);
  update public.membri m set esente_codice = p_valore
    from public.locali l where l.id = p_locale and m.organizzazione_id = l.organizzazione_id and m.user_id = p_utente;
end $$;

create or replace function public.stato_operatore(p_locale uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_op uuid;
begin
  if public.ruolo_in_locale(p_locale) is null then raise exception 'Permesso negato' using errcode = '42501'; end if;
  v_op := public.operatore_corrente(p_locale);
  return jsonb_build_object(
    'chiede_codice', public.chiede_codice(p_locale),
    -- Account collegato segnato come postazione condivisa (lì non si cambia il «proprio» codice)
    'postazione', coalesce((select m.chiede_codice from public.membri m join public.locali l on l.organizzazione_id = m.organizzazione_id
                             where l.id = p_locale and m.user_id = (select auth.uid()) and (m.locale_id is null or m.locale_id = p_locale)), false),
    'durata_secondi', coalesce((select s.durata_secondi from public.sicurezza_sala s where s.locale_id = p_locale), 120),
    'solo_responsabile', coalesce((select s.solo_responsabile from public.sicurezza_sala s where s.locale_id = p_locale), false),
    'codice_per_tutti', coalesce((select s.codice_per_tutti from public.sicurezza_sala s where s.locale_id = p_locale), false),
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

revoke execute on function public.imposta_sicurezza_sala(uuid, int, boolean, boolean), public.imposta_esente_codice(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.imposta_sicurezza_sala(uuid, int, boolean, boolean), public.imposta_esente_codice(uuid, uuid, boolean) to authenticated;
