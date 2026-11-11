-- Codici personali di sala. Ogni persona dello staff ha il suo codice (da 4 a 6 cifre, salvato solo come hash bcrypt).
-- Sugli account segnati «chiede il codice» (postazioni condivise: tablet di sala, PC della cassa) le azioni di sala
-- (aprire, comandare, confermare, chiudere, stornare) valgono solo dopo nome + codice e con il ruolo di chi l'ha inserito:
-- una schermata lasciata aperta non modifica nulla. Il codice vale per qualche minuto (sicurezza_sala.durata_secondi).
-- Il cameriere che apre, approva o comanda per primo un tavolo ne diventa il responsabile: con «solo_responsabile» (da attivare
-- nelle impostazioni) gli altri camerieri non lo modificano (caposala, responsabile e titolare sì, e possono prenderlo con prendi_tavolo).
-- Codici sbagliati: 5 di fila dalla stessa postazione la bloccano 5 minuti; 10 sullo stesso codice lo bloccano 15 minuti.

alter table public.membri add column chiede_codice boolean not null default false;
alter table public.sessioni_tavolo add column responsabile uuid references auth.users (id) on delete set null;
alter table public.audit_log add column operatore uuid;

create table public.codici_personali (
  locale_id     uuid not null references public.locali (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  hash          text not null,
  errori        int  not null default 0,
  bloccato_fino timestamptz,
  aggiornato_at timestamptz not null default now(),
  primary key (locale_id, user_id)
);
-- Chi sta lavorando su una postazione: account + sessione d'accesso (ogni dispositivo ha la sua), con scadenza
create table public.operatori_attivi (
  locale_id  uuid not null references public.locali (id) on delete cascade,
  account    uuid not null references auth.users (id) on delete cascade,
  sessione   text not null,
  operatore  uuid not null references auth.users (id) on delete cascade,
  scade_at   timestamptz not null,
  primary key (locale_id, account, sessione)
);
create table public.tentativi_codice (
  account       uuid not null references auth.users (id) on delete cascade,
  sessione      text not null,
  errori        int  not null default 0,
  bloccato_fino timestamptz,
  primary key (account, sessione)
);
create table public.sicurezza_sala (
  locale_id         uuid primary key references public.locali (id) on delete cascade,
  durata_secondi    int not null default 120 check (durata_secondi between 30 and 900),
  solo_responsabile boolean not null default false
);
alter table public.codici_personali enable row level security;
alter table public.operatori_attivi enable row level security;
alter table public.tentativi_codice enable row level security;
alter table public.sicurezza_sala enable row level security;
-- Codici, operatori e tentativi solo attraverso le funzioni; le impostazioni si leggono, si cambiano con la funzione
revoke all on table public.codici_personali, public.operatori_attivi, public.tentativi_codice, public.sicurezza_sala from public, anon, authenticated;
grant select on table public.sicurezza_sala to authenticated;
create policy sicurezza_sala_select on public.sicurezza_sala for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);

-- ---------------------------------------------------------------- chi agisce
/** Sessione d'accesso del token (ogni login su ogni dispositivo ne ha una sua). */
create function public.sessione_accesso() returns text language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id', '');
$$;

/** Ruolo di un utente nel locale, solo se l'account è attivo. */
create function public.ruolo_di(p_locale uuid, p_utente uuid) returns public.ruolo
language sql stable security definer set search_path = '' as $$
  select m.ruolo from public.membri m
    join public.locali l on l.organizzazione_id = m.organizzazione_id
    join auth.users u on u.id = m.user_id
   where l.id = p_locale and m.user_id = p_utente and (m.locale_id is null or m.locale_id = p_locale)
     and coalesce((to_jsonb(u) ->> 'banned_until')::timestamptz < now(), true);
$$;

/** L'account collegato chiede il codice personale per le azioni di sala (postazione condivisa). */
create function public.chiede_codice(p_locale uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.chiede_codice from public.membri m join public.locali l on l.organizzazione_id = m.organizzazione_id
                    where l.id = p_locale and m.user_id = (select auth.uid()) and (m.locale_id is null or m.locale_id = p_locale)), false);
$$;

/** Persona che ha inserito il codice su questa postazione (se il codice non è scaduto). */
create function public.operatore_corrente(p_locale uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select o.operatore from public.operatori_attivi o
   where o.locale_id = p_locale and o.account = (select auth.uid()) and o.sessione = public.sessione_accesso()
     and o.scade_at > now() and public.ruolo_di(p_locale, o.operatore) is not null;
$$;

/** Chi risponde dell'azione: l'operatore sulle postazioni, altrimenti l'account. */
create function public.chi_agisce(p_locale uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case when public.chiede_codice(p_locale) then public.operatore_corrente(p_locale) else (select auth.uid()) end;
$$;

create function public.ruolo_effettivo(p_locale uuid) returns public.ruolo
language sql stable security definer set search_path = '' as $$
  select case when public.chiede_codice(p_locale) then public.ruolo_di(p_locale, public.operatore_corrente(p_locale))
              else public.ruolo_in_locale(p_locale) end;
$$;

create function public.ruoli_capacita(p_capacita text) returns text[] language sql immutable set search_path = '' as $$
  select case p_capacita
    when 'sala.apri'       then array['owner','manager','caposala','cameriere']
    when 'sala.comanda'    then array['owner','manager','caposala','cameriere']
    when 'ordini.conferma' then array['owner','manager','caposala','cameriere']
    when 'sala.chiudi'     then array['owner','manager','caposala']
    when 'ordini.annulla'  then array['owner','manager','caposala']
    when 'cucina.avanza'   then array['owner','manager','caposala','cameriere','cucina']
    when 'esauriti'        then array['owner','manager','caposala','cameriere','cucina']
    when 'magazzino'       then array['owner','manager']
    when 'reparti'         then array['owner','manager']
    when 'utenti'          then array['owner','manager']
    when 'catalogo'        then array['owner','manager']
    when 'impostazioni'    then array['owner','manager']
    when 'cassa'           then array['owner']
    else array[]::text[] end;
$$;

/** Capacità dell'account collegato, senza codice: per guardare (conto, nomi dei clienti, pagamenti). */
create function public.puo_account(p_locale uuid, p_capacita text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.ruolo_in_locale(p_locale)::text = any (public.ruoli_capacita(p_capacita)), false);
$$;

/** Le azioni di sala sulle postazioni valgono con il ruolo di chi ha inserito il codice; il resto come prima. */
create or replace function public.puo(p_locale uuid, p_capacita text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_capacita = any (array['sala.apri','sala.comanda','ordini.conferma','sala.chiudi','ordini.annulla'])
              then coalesce(public.ruolo_effettivo(p_locale)::text = any (public.ruoli_capacita(p_capacita)), false)
              else public.puo_account(p_locale, p_capacita) end;
$$;

-- ---------------------------------------------------------------- responsabile del tavolo
create function public.tavolo_permesso(p_locale uuid, p_responsabile uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_responsabile is null
      or p_responsabile = public.chi_agisce(p_locale)
      or not coalesce((select s.solo_responsabile from public.sicurezza_sala s where s.locale_id = p_locale), false)
      or coalesce(public.livello_ruolo(public.ruolo_effettivo(p_locale)) >= public.livello_ruolo('caposala'), false);
$$;

create function public.nome_responsabile(p_utente uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif((select p.nome from public.profili p where p.id = p_utente), ''), 'un collega');
$$;

/** Solo il responsabile (o dal caposala in su) modifica un tavolo aperto; il primo che ci lavora con il suo codice lo prende. */
create function public.controlla_tavolo(p_sessione uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.sessioni_tavolo; v_chi uuid;
begin
  if coalesce(current_setting('request.jwt.claims', true), '') = ''
     or nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'authenticated' then return; end if;
  select * into v from public.sessioni_tavolo where id = p_sessione;
  if v.id is null or v.chiusa_at is not null then return; end if;
  if not public.tavolo_permesso(v.locale_id, v.responsabile) then
    raise exception 'Tavolo seguito da %: può modificarlo solo chi lo segue o il caposala', public.nome_responsabile(v.responsabile) using errcode = '42501';
  end if;
  v_chi := public.chi_agisce(v.locale_id);
  -- Il tavolo lo prende il cameriere; caposala, responsabile, titolare e bot lo lasciano libero per tutti
  if v.responsabile is null and v_chi is not null and public.ruolo_effettivo(v.locale_id) = 'cameriere' then
    update public.sessioni_tavolo set responsabile = v_chi where id = v.id;
  end if;
end $$;

create function public.sessioni_responsabile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_staff boolean := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' = 'authenticated';
begin
  if not coalesce(v_staff, false) then return new; end if;
  if tg_op = 'INSERT' then
    -- Risponde del tavolo il cameriere che lo apre o approva la richiesta (sulle postazioni: chi ha inserito il codice)
    if public.ruolo_effettivo(new.locale_id) = 'cameriere' then
      new.responsabile := coalesce(new.responsabile, public.chi_agisce(new.locale_id));
    end if;
    if public.chiede_codice(new.locale_id) then new.aperta_da := coalesce(public.operatore_corrente(new.locale_id), new.aperta_da); end if;
    return new;
  end if;
  if old.chiusa_at is null and not public.tavolo_permesso(old.locale_id, old.responsabile) then
    raise exception 'Tavolo seguito da %: può modificarlo solo chi lo segue o il caposala', public.nome_responsabile(old.responsabile) using errcode = '42501';
  end if;
  if new.chiusa_at is not null and old.chiusa_at is null and public.chiede_codice(old.locale_id) then
    new.chiusa_da := coalesce(public.operatore_corrente(old.locale_id), new.chiusa_da);
  end if;
  return new;
end $$;
create trigger sessioni_responsabile before insert or update on public.sessioni_tavolo
  for each row execute function public.sessioni_responsabile();

create function public.ordini_responsabile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (old.stato = 'da_confermare' and new.stato is distinct from old.stato) then
    perform public.controlla_tavolo(new.sessione_id);
    if tg_op = 'UPDATE' and public.chiede_codice(new.locale_id) and public.operatore_corrente(new.locale_id) is not null then
      new.confermato_da := public.operatore_corrente(new.locale_id);
    end if;
  end if;
  return new;
end $$;
create trigger ordini_responsabile before insert or update of stato on public.ordini
  for each row execute function public.ordini_responsabile();

create function public.pagamenti_responsabile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.controlla_tavolo(new.sessione_id);
  return new;
end $$;
create trigger pagamenti_responsabile before insert on public.pagamenti
  for each row execute function public.pagamenti_responsabile();

-- Nel registro delle modifiche anche la persona del codice, oltre all'account della postazione
create function public.audit_operatore() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.operatore := (select o.operatore from public.operatori_attivi o
                     where o.account = (select auth.uid()) and o.sessione = public.sessione_accesso() and o.scade_at > now() limit 1);
  return new;
end $$;
create trigger audit_operatore before insert on public.audit_log for each row execute function public.audit_operatore();

-- ---------------------------------------------------------------- funzioni per l'interfaccia
/** Postazione: codice richiesto, chi è di turno e il personale con un codice (nomi per il tastierino). */
create function public.stato_operatore(p_locale uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_op uuid;
begin
  if public.ruolo_in_locale(p_locale) is null then raise exception 'Permesso negato' using errcode = '42501'; end if;
  v_op := public.operatore_corrente(p_locale);
  return jsonb_build_object(
    'chiede_codice', public.chiede_codice(p_locale),
    'durata_secondi', coalesce((select s.durata_secondi from public.sicurezza_sala s where s.locale_id = p_locale), 120),
    'solo_responsabile', coalesce((select s.solo_responsabile from public.sicurezza_sala s where s.locale_id = p_locale), false),
    'operatore', case when v_op is null then null else jsonb_build_object(
        'id', v_op, 'nome', public.nome_responsabile(v_op), 'ruolo', public.ruolo_di(p_locale, v_op),
        'scade_at', (select o.scade_at from public.operatori_attivi o where o.locale_id = p_locale and o.account = (select auth.uid())
                       and o.sessione = public.sessione_accesso())) end,
    'personale', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.user_id, 'nome', coalesce(nullif(p.nome, ''), 'Senza nome'), 'ruolo', m.ruolo,
                                          'ha_codice', c.user_id is not null, 'postazione', m.chiede_codice)
                       order by public.livello_ruolo(m.ruolo) desc, p.nome)
        from public.membri m join public.locali l on l.organizzazione_id = m.organizzazione_id
        left join public.profili p on p.id = m.user_id
        left join public.codici_personali c on c.locale_id = p_locale and c.user_id = m.user_id
       where l.id = p_locale and (m.locale_id is null or m.locale_id = p_locale)
         and public.ruolo_di(p_locale, m.user_id) is not null), '[]'::jsonb));
end $$;

/** Nome + codice sulla postazione: da qui in poi (per durata_secondi) le azioni di sala sono di questa persona. */
create function public.entra_operatore(p_locale uuid, p_utente uuid, p_codice text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s text := public.sessione_accesso(); v_t public.tentativi_codice; v_c public.codici_personali; v_ruolo public.ruolo; v_scade timestamptz;
begin
  if public.ruolo_in_locale(p_locale) is null then raise exception 'Permesso negato' using errcode = '42501'; end if;
  -- Gli errori si restituiscono senza eccezione: così il conteggio dei tentativi resta salvato
  select * into v_t from public.tentativi_codice where account = (select auth.uid()) and sessione = v_s;
  if v_t.bloccato_fino > now() then
    return jsonb_build_object('errore', format('Troppi codici sbagliati: riprova tra %s minuti', ceil(extract(epoch from v_t.bloccato_fino - now()) / 60)));
  end if;
  select * into v_c from public.codici_personali where locale_id = p_locale and user_id = p_utente;
  if v_c.bloccato_fino > now() then
    return jsonb_build_object('errore', 'Codice bloccato per troppi tentativi: riprova più tardi o chiedi al responsabile');
  end if;
  v_ruolo := public.ruolo_di(p_locale, p_utente);
  if v_ruolo is null or v_c.hash is null or coalesce(p_codice, '') !~ '^[0-9]{4,6}$'
     or extensions.crypt(p_codice, v_c.hash) <> v_c.hash then
    insert into public.tentativi_codice as t (account, sessione, errori) values ((select auth.uid()), v_s, 1)
      on conflict (account, sessione) do update
        set errori = case when t.errori + 1 >= 5 then 0 else t.errori + 1 end,
            bloccato_fino = case when t.errori + 1 >= 5 then now() + interval '5 minutes' else t.bloccato_fino end;
    update public.codici_personali
       set errori = case when errori + 1 >= 10 then 0 else errori + 1 end,
           bloccato_fino = case when errori + 1 >= 10 then now() + interval '15 minutes' else bloccato_fino end
     where locale_id = p_locale and user_id = p_utente;
    return jsonb_build_object('errore', 'Codice non valido');
  end if;
  delete from public.tentativi_codice where account = (select auth.uid()) and sessione = v_s;
  update public.codici_personali set errori = 0 where locale_id = p_locale and user_id = p_utente;
  delete from public.operatori_attivi where account = (select auth.uid()) and scade_at < now();
  v_scade := now() + make_interval(secs => coalesce((select s.durata_secondi from public.sicurezza_sala s where s.locale_id = p_locale), 120));
  insert into public.operatori_attivi (locale_id, account, sessione, operatore, scade_at)
    values (p_locale, (select auth.uid()), v_s, p_utente, v_scade)
    on conflict (locale_id, account, sessione) do update set operatore = excluded.operatore, scade_at = excluded.scade_at;
  return jsonb_build_object('id', p_utente, 'nome', public.nome_responsabile(p_utente), 'ruolo', v_ruolo, 'scade_at', v_scade);
end $$;

/** Blocca la postazione: le azioni di sala richiedono di nuovo il codice. */
create function public.esci_operatore(p_locale uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.operatori_attivi where locale_id = p_locale and account = (select auth.uid()) and sessione = public.sessione_accesso();
$$;

/**
 * Codice personale: il proprio (con il codice attuale, se c'è) oppure, per chi gestisce il personale, quello dei ruoli inferiori.
 * p_codice null = codice tolto. Niente cifre tutte uguali né in fila (1234, 9876).
 */
create function public.imposta_codice(p_locale uuid, p_utente uuid, p_codice text, p_attuale text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if p_utente = (select auth.uid()) then
    if public.ruolo_in_locale(p_locale) is null then raise exception 'Permesso negato' using errcode = '42501'; end if;
    select c.hash into v_hash from public.codici_personali c where c.locale_id = p_locale and c.user_id = p_utente;
    if v_hash is not null and (p_attuale is null or extensions.crypt(p_attuale, v_hash) <> v_hash) then
      raise exception 'Il codice attuale non è corretto' using errcode = '42501';
    end if;
  else
    perform public.controlla_gestione(p_locale, p_utente);
  end if;
  if p_codice is null then
    delete from public.codici_personali where locale_id = p_locale and user_id = p_utente;
    return;
  end if;
  if p_codice !~ '^[0-9]{4,6}$' then raise exception 'Il codice deve avere da 4 a 6 cifre' using errcode = '22023'; end if;
  if p_codice ~ '^(.)\1+$' or position(p_codice in '0123456789') > 0 or position(p_codice in '9876543210') > 0 then
    raise exception 'Codice troppo facile: niente cifre tutte uguali o in fila' using errcode = '22023';
  end if;
  insert into public.codici_personali (locale_id, user_id, hash)
    values (p_locale, p_utente, extensions.crypt(p_codice, extensions.gen_salt('bf', 8)))
    on conflict (locale_id, user_id) do update set hash = excluded.hash, errori = 0, bloccato_fino = null, aggiornato_at = now();
end $$;

/** Postazione condivisa (chiede il codice) o account personale: lo decide chi gestisce il personale. */
create function public.imposta_chiede_codice(p_locale uuid, p_utente uuid, p_valore boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.controlla_gestione(p_locale, p_utente);
  update public.membri m set chiede_codice = p_valore
    from public.locali l where l.id = p_locale and m.organizzazione_id = l.organizzazione_id and m.user_id = p_utente;
end $$;

create function public.imposta_sicurezza_sala(p_locale uuid, p_durata_secondi int, p_solo_responsabile boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.puo(p_locale, 'impostazioni') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  insert into public.sicurezza_sala (locale_id, durata_secondi, solo_responsabile) values (p_locale, p_durata_secondi, p_solo_responsabile)
    on conflict (locale_id) do update set durata_secondi = excluded.durata_secondi, solo_responsabile = excluded.solo_responsabile;
end $$;

/** Prendere un tavolo: libero per tutti, già seguito da un collega solo dal caposala in su. */
create function public.prendi_tavolo(p_sessione uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.sessioni_tavolo; v_chi uuid;
begin
  select * into v from public.sessioni_tavolo where id = p_sessione and chiusa_at is null;
  if v.id is null or not public.puo(v.locale_id, 'sala.apri') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  v_chi := public.chi_agisce(v.locale_id);
  if v_chi is null then raise exception 'Permesso negato' using errcode = '42501'; end if;
  update public.sessioni_tavolo set responsabile = v_chi where id = v.id;   -- il trigger controlla chi può farlo
end $$;

-- Guardare il conto, i nomi dei clienti e i pagamenti resta possibile anche con la postazione bloccata
drop policy nomi_clienti_select on public.nomi_clienti;
create policy nomi_clienti_select on public.nomi_clienti for select to authenticated using (public.puo_account(locale_id, 'sala.apri'));
drop policy pagamenti_select on public.pagamenti;
create policy pagamenti_select on public.pagamenti for select to authenticated using (public.puo_account(locale_id, 'sala.chiudi'));

create or replace function public.stato_conto(p_sessione uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ses public.sessioni_tavolo; v_lordo int; v_totale int; v_pagato int; v_attesa int;
begin
  select * into v_ses from public.sessioni_tavolo where id = p_sessione;
  if v_ses.id is null or not public.puo_account(v_ses.locale_id, 'sala.chiudi') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  v_lordo := case when v_ses.chiusa_at is null then public.totale_sessione(v_ses.id) else coalesce(v_ses.totale_cent, 0) + v_ses.sconto_cent end;
  v_totale := greatest(v_lordo - v_ses.sconto_cent, 0);
  select coalesce(sum(importo_cent) filter (where stato = 'approvato'), 0), coalesce(sum(importo_cent) filter (where stato = 'in_attesa'), 0)
    into v_pagato, v_attesa from public.pagamenti where sessione_id = v_ses.id;
  return jsonb_build_object(
    'sessione', v_ses.id, 'chiuso', v_ses.chiusa_at is not null, 'coperti', v_ses.coperti,
    'lordo_cent', v_lordo, 'sconto_cent', v_ses.sconto_cent, 'totale_cent', v_totale,
    'pagato_cent', v_pagato, 'in_attesa_cent', v_attesa, 'residuo_cent', v_totale - v_pagato - v_attesa,
    'pagamenti', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'metodo', p.metodo, 'importo_cent', p.importo_cent, 'ricevuto_cent', p.ricevuto_cent,
               'quota', p.quota, 'stato', p.stato, 'riferimento', p.riferimento, 'terminale', t.nome, 'creato_at', p.creato_at) order by p.creato_at)
      from public.pagamenti p left join public.terminali_pos t on t.id = p.terminale_id where p.sessione_id = v_ses.id), '[]'::jsonb),
    'righe', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'nome', r.nome, 'quantita', r.quantita, 'prezzo_cent', r.prezzo_cent, 'nota', r.nota,
               'opzioni', (select coalesce(jsonb_agg(x ->> 'nome'), '[]'::jsonb) from jsonb_array_elements(r.opzioni) x),
               'pagate', public.quantita_pagata(r.id)) order by o.creato_at, r.nome)
      from public.ordini o join public.righe_ordine r on r.ordine_id = o.id
      where o.sessione_id = v_ses.id and o.stato not in ('rifiutato', 'annullato') and r.prezzo_cent > 0), '[]'::jsonb));
end $$;

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
  -- Titolare e responsabile senza limiti (sulle postazioni conta chi ha inserito il codice); per gli altri ruoli il tetto delle impostazioni
  if not coalesce(public.ruolo_effettivo(v_ses.locale_id) in ('owner', 'manager'), false) then
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

revoke execute on function public.sessione_accesso(), public.ruolo_di(uuid, uuid), public.chiede_codice(uuid), public.operatore_corrente(uuid),
  public.chi_agisce(uuid), public.ruolo_effettivo(uuid), public.ruoli_capacita(text), public.puo_account(uuid, text),
  public.tavolo_permesso(uuid, uuid), public.nome_responsabile(uuid), public.controlla_tavolo(uuid),
  public.sessioni_responsabile(), public.ordini_responsabile(), public.pagamenti_responsabile(), public.audit_operatore(),
  public.stato_operatore(uuid), public.entra_operatore(uuid, uuid, text), public.esci_operatore(uuid),
  public.imposta_codice(uuid, uuid, text, text), public.imposta_chiede_codice(uuid, uuid, boolean),
  public.imposta_sicurezza_sala(uuid, int, boolean), public.prendi_tavolo(uuid) from public, anon, authenticated;
grant execute on function public.stato_operatore(uuid), public.entra_operatore(uuid, uuid, text), public.esci_operatore(uuid),
  public.imposta_codice(uuid, uuid, text, text), public.imposta_chiede_codice(uuid, uuid, boolean),
  public.imposta_sicurezza_sala(uuid, int, boolean), public.prendi_tavolo(uuid) to authenticated;
-- puo_account è nelle regole di lettura di nomi_clienti e pagamenti: le regole girano con i permessi di chi legge
grant execute on function public.puo_account(uuid, text) to authenticated;
