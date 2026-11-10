-- Prenotazioni: nome, telefono facoltativo, persone, ora, tavolo (facoltativo), note.
-- Dati personali (ISO 27701): niente storico (audit), solo personale di sala, cancellate 30 giorni dopo la data.
-- Lo stesso tavolo non si prenota due volte in orari che si sovrappongono. «Arrivati» apre il tavolo.

create table public.prenotazioni (
  id          uuid primary key default gen_random_uuid(),
  locale_id   uuid not null references public.locali (id) on delete cascade,
  tavolo_id   uuid,
  nome        text not null check (char_length(btrim(nome)) between 1 and 60),
  telefono    text not null default '' check (telefono ~ '^[0-9 +]{0,20}$'),
  persone     int  not null check (persone between 1 and 60),
  data_ora    timestamptz not null,
  durata_min  int  not null default 120 check (durata_min between 15 and 480),
  note        text not null default '' check (char_length(note) <= 200),
  stato       text not null default 'attiva' check (stato in ('attiva', 'arrivata', 'annullata', 'non_presentata')),
  sessione_id uuid references public.sessioni_tavolo (id) on delete set null,
  creato_da   uuid default auth.uid(),
  creato_at   timestamptz not null default now(),
  foreign key (tavolo_id, locale_id) references public.tavoli (id, locale_id) on delete set null (tavolo_id)
);
create index on public.prenotazioni (locale_id, data_ora);
create index on public.prenotazioni (tavolo_id, data_ora);

-- Un tavolo, una prenotazione attiva per fascia oraria
create or replace function public.controlla_prenotazione()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_altra public.prenotazioni;
begin
  if new.stato = 'attiva' and new.tavolo_id is not null then
    select * into v_altra from public.prenotazioni p
     where p.tavolo_id = new.tavolo_id and p.stato = 'attiva' and p.id <> new.id
       and tstzrange(p.data_ora, p.data_ora + make_interval(mins => p.durata_min))
           && tstzrange(new.data_ora, new.data_ora + make_interval(mins => new.durata_min))
     limit 1;
    if v_altra.id is not null then
      raise exception 'Il tavolo è già prenotato alle % (%)', to_char(v_altra.data_ora at time zone 'Europe/Rome', 'HH24:MI'), v_altra.nome
        using errcode = '23P01';
    end if;
  end if;
  return new;
end $$;
create trigger prenotazioni_controllo before insert or update on public.prenotazioni
  for each row execute function public.controlla_prenotazione();

-- Conservazione minima: si cancellano da sole 30 giorni dopo la data (a ogni nuova prenotazione del locale)
create or replace function public.pulisci_prenotazioni()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.prenotazioni where locale_id = new.locale_id and data_ora < now() - interval '30 days';
  return null;
end $$;
create trigger prenotazioni_pulizia after insert on public.prenotazioni for each row execute function public.pulisci_prenotazioni();

alter table public.prenotazioni enable row level security;
create policy prenotazioni_select on public.prenotazioni for select to authenticated using (public.puo(locale_id, 'sala.apri'));
create policy prenotazioni_insert on public.prenotazioni for insert to authenticated with check (public.puo(locale_id, 'sala.apri'));
create policy prenotazioni_update on public.prenotazioni for update to authenticated
  using (public.puo(locale_id, 'sala.apri')) with check (public.puo(locale_id, 'sala.apri'));
create policy prenotazioni_delete on public.prenotazioni for delete to authenticated using (public.puo(locale_id, 'sala.apri'));
revoke all on public.prenotazioni from anon;
revoke truncate, references, trigger on public.prenotazioni from authenticated;
-- Colonne scrivibili dal personale: la sessione si collega solo da «Arrivati», autore e data non si toccano
revoke insert, update on public.prenotazioni from authenticated;
grant insert (locale_id, tavolo_id, nome, telefono, persone, data_ora, durata_min, note) on public.prenotazioni to authenticated;
grant update (tavolo_id, nome, telefono, persone, data_ora, durata_min, note, stato) on public.prenotazioni to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.prenotazioni;
  end if;
end $$;

-- Arrivati: si apre il tavolo prenotato (o quello indicato) con le persone della prenotazione
create or replace function public.arriva_prenotazione(p_prenotazione uuid, p_tavolo uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_pre public.prenotazioni; v_tav uuid; v_ses public.sessioni_tavolo;
begin
  select * into v_pre from public.prenotazioni where id = p_prenotazione for update;
  if v_pre.id is null or not public.puo(v_pre.locale_id, 'sala.apri') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if v_pre.stato <> 'attiva' then raise exception 'La prenotazione non è più attiva' using errcode = '22023'; end if;
  v_tav := coalesce(p_tavolo, v_pre.tavolo_id);
  if v_tav is null then raise exception 'Scegli il tavolo' using errcode = '22023'; end if;
  if not exists (select 1 from public.tavoli where id = v_tav and locale_id = v_pre.locale_id and attivo) then
    raise exception 'Tavolo non valido' using errcode = '22023';
  end if;
  if exists (select 1 from public.sessioni_tavolo where tavolo_id = v_tav and chiusa_at is null) then
    raise exception 'Il tavolo è occupato: liberalo o scegline un altro' using errcode = '22023';
  end if;
  v_ses := public.sessione_aperta_o_nuova(v_tav, v_pre.persone);
  update public.prenotazioni set stato = 'arrivata', tavolo_id = v_tav, sessione_id = v_ses.id where id = v_pre.id;
  return v_ses.id;
end $$;

revoke execute on function public.controlla_prenotazione(), public.pulisci_prenotazioni(), public.arriva_prenotazione(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.arriva_prenotazione(uuid, uuid) to authenticated;
