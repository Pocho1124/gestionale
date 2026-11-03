-- 1) Con il codice del tavolo gli ordini vanno diretti in cucina (la conferma serve solo per sbloccare il tavolo).
-- 2) Richiesta del conto dal telefono: è l'unico momento in cui lo staff deve intervenire.
-- 3) Utenti Telegram del bot gestibili dal backoffice.

-- ============================================================ 1. Ordini con codice: già confermati
create or replace function public.invia_ordine(p_token text, p_codice text, p_righe jsonb, p_nota text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb := public.verifica_tavolo(p_token, p_codice); v_ord uuid;
begin
  if v ? 'errore' then return v; end if;
  if (select count(*) from public.ordini where sessione_id = (v->>'sessione_id')::uuid and creato_at > now() - interval '10 minutes') >= 6 then
    return jsonb_build_object('errore', 'Troppi ordini ravvicinati: attendi qualche minuto o chiedi al personale');
  end if;
  v_ord := public.crea_ordine_interno((v->>'locale_id')::uuid, (v->>'sessione_id')::uuid, (v->>'tavolo_id')::uuid,
                                      p_righe, p_nota, 'cliente', 'confermato');
  return jsonb_build_object('id', v_ord, 'stato', 'confermato');
end $$;

-- ============================================================ 2. Richiesta del conto
create table public.richieste_conto (
  id          uuid primary key default gen_random_uuid(),
  locale_id   uuid not null references public.locali (id) on delete cascade,
  sessione_id uuid not null references public.sessioni_tavolo (id) on delete cascade,
  tavolo_id   uuid not null references public.tavoli (id) on delete cascade,
  nota        text not null default '' check (char_length(nota) <= 120),   -- es. «pago con carta», «conti separati»
  stato       text not null default 'in_attesa' check (stato in ('in_attesa', 'gestita')),
  creato_at   timestamptz not null default now(),
  gestita_at  timestamptz,
  gestita_da  uuid
);
create index on public.richieste_conto (locale_id, stato);
create unique index richieste_conto_una_aperta on public.richieste_conto (sessione_id) where stato = 'in_attesa';
create trigger richieste_conto_audit after insert or update on public.richieste_conto for each row execute function public.scrivi_audit();

alter table public.richieste_conto enable row level security;
create policy conto_select on public.richieste_conto for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
revoke all on public.richieste_conto from anon;
revoke insert, update, delete on public.richieste_conto from authenticated;

create or replace function public.chiedi_conto(p_token text, p_codice text, p_nota text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb := public.verifica_tavolo(p_token, p_codice);
begin
  if v ? 'errore' then return v; end if;
  if not exists (select 1 from public.richieste_conto where sessione_id = (v->>'sessione_id')::uuid and stato = 'in_attesa') then
    insert into public.richieste_conto (locale_id, sessione_id, tavolo_id, nota)
    values ((v->>'locale_id')::uuid, (v->>'sessione_id')::uuid, (v->>'tavolo_id')::uuid, left(coalesce(p_nota, ''), 120));
  end if;
  return jsonb_build_object('conto', 'richiesto');
end $$;

create or replace function public.gestisci_conto(p_richiesta uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_locale uuid;
begin
  select locale_id into v_locale from public.richieste_conto where id = p_richiesta;
  if v_locale is null or not public.ha_ruolo_locale(v_locale, array['owner','manager','cameriere']::public.ruolo[]) then
    raise exception 'Permesso negato' using errcode = '42501';
  end if;
  update public.richieste_conto set stato = 'gestita', gestita_at = now(), gestita_da = (select auth.uid())
   where id = p_richiesta and stato = 'in_attesa';
end $$;

-- Alla chiusura del tavolo le richieste di conto rimaste aperte si considerano gestite
create or replace function public.chiudi_richieste_conto()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.chiusa_at is not null and old.chiusa_at is null then
    update public.richieste_conto set stato = 'gestita', gestita_at = now() where sessione_id = new.id and stato = 'in_attesa';
  end if;
  return new;
end $$;
create trigger sessioni_chiudi_conto after update on public.sessioni_tavolo for each row execute function public.chiudi_richieste_conto();

-- Lo stato del conto si vede anche dal telefono
create or replace function public.ordini_tavolo(p_token text, p_codice text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb := public.verifica_tavolo(p_token, p_codice);
begin
  if v ? 'errore' then return v; end if;
  return jsonb_build_object(
    'conto', (select stato from public.richieste_conto where sessione_id = (v->>'sessione_id')::uuid order by creato_at desc limit 1),
    'ordini', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'stato', o.stato, 'motivo', o.motivo, 'creato_at', o.creato_at,
               'righe', (select jsonb_agg(jsonb_build_object('nome', r.nome, 'quantita', r.quantita, 'prezzo_cent', r.prezzo_cent, 'nota', r.nota))
                         from public.righe_ordine r where r.ordine_id = o.id)) order by o.creato_at desc)
      from public.ordini o where o.sessione_id = (v->>'sessione_id')::uuid), '[]'::jsonb));
end $$;

revoke execute on function public.chiedi_conto(text, text, text), public.gestisci_conto(uuid), public.chiudi_richieste_conto(),
  public.ordini_tavolo(text, text), public.invia_ordine(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.chiedi_conto(text, text, text), public.ordini_tavolo(text, text), public.invia_ordine(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.gestisci_conto(uuid) to authenticated;

-- ============================================================ 3. Utenti Telegram del bot
create table public.telegram_utenti (
  id          uuid primary key default gen_random_uuid(),
  locale_id   uuid not null references public.locali (id) on delete cascade,
  telegram_id bigint not null check (telegram_id > 0),
  nome        text not null default '' check (char_length(nome) <= 40),
  attivo      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (locale_id, telegram_id)
);
create trigger telegram_utenti_audit after insert or update or delete on public.telegram_utenti for each row execute function public.scrivi_audit();
alter table public.telegram_utenti enable row level security;
-- Lettura per titolare e responsabile (anche l'account del bot), modifica solo per il titolare
create policy telegram_select on public.telegram_utenti for select to authenticated
  using (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]));
create policy telegram_write on public.telegram_utenti for all to authenticated
  using (public.ha_ruolo_locale(locale_id, array['owner']::public.ruolo[]))
  with check (public.ha_ruolo_locale(locale_id, array['owner']::public.ruolo[]));
revoke all on public.telegram_utenti from anon;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.richieste_conto;
  end if;
end $$;
