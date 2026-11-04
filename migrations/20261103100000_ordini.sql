-- F3a — Ordini dal tavolo. Il cliente invia, lo staff conferma: nessun ordine va in cucina senza conferma.
-- Il cliente accede solo tramite funzioni (token del QR + codice del tavolo), mai alle tabelle.

alter table public.sessioni_tavolo add column codice_errati int not null default 0;

create table public.ordini (
  id            uuid primary key default gen_random_uuid(),
  locale_id     uuid not null references public.locali (id) on delete cascade,
  sessione_id   uuid not null references public.sessioni_tavolo (id) on delete cascade,
  tavolo_id     uuid not null references public.tavoli (id) on delete cascade,
  stato         text not null default 'da_confermare'
                check (stato in ('da_confermare', 'confermato', 'in_preparazione', 'pronto', 'servito', 'rifiutato')),
  origine       text not null default 'cliente' check (origine in ('cliente', 'sala')),
  nota          text not null default '' check (char_length(nota) <= 200),
  motivo        text not null default '' check (char_length(motivo) <= 200),   -- motivo del rifiuto, visto dal cliente
  creato_at     timestamptz not null default now(),
  confermato_at timestamptz,
  confermato_da uuid,
  aggiornato_at timestamptz not null default now()
);
create index on public.ordini (locale_id, creato_at desc);
create index on public.ordini (sessione_id);

create table public.righe_ordine (
  id          uuid primary key default gen_random_uuid(),
  ordine_id   uuid not null references public.ordini (id) on delete cascade,
  locale_id   uuid not null,
  prodotto_id uuid references public.prodotti (id) on delete set null,
  nome        text not null,                      -- copia al momento dell'ordine: i cambi di menu non toccano gli ordini
  prezzo_cent int  not null check (prezzo_cent >= 0),
  quantita    int  not null check (quantita between 1 and 20),
  nota        text not null default '' check (char_length(nota) <= 120)
);
create index on public.righe_ordine (ordine_id);

create or replace function public.ordine_aggiornato()
returns trigger language plpgsql set search_path = '' as $$
begin new.aggiornato_at := now(); return new; end $$;
create trigger ordini_aggiornato before update on public.ordini for each row execute function public.ordine_aggiornato();
create trigger ordini_audit after insert or update or delete on public.ordini for each row execute function public.scrivi_audit();

alter table public.ordini       enable row level security;
alter table public.righe_ordine enable row level security;
create policy ordini_select on public.ordini for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
create policy righe_select  on public.righe_ordine for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
revoke all on public.ordini, public.righe_ordine from anon;
revoke insert, update, delete on public.ordini, public.righe_ordine from authenticated;

-- ============================================================ Funzioni per il cliente (anonimo)

-- Informazioni minime del tavolo inquadrato
create or replace function public.tavolo_cliente(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('tavolo', t.nome, 'slug', l.slug, 'locale', l.nome,
           'aperto', exists (select 1 from public.sessioni_tavolo s where s.tavolo_id = t.id and s.chiusa_at is null))
  from public.tavoli t join public.locali l on l.id = t.locale_id
  where t.qr_token = p_token and t.attivo and l.attivo;
$$;

-- Verifica token + codice; i codici sbagliati si contano (senza annullare il conteggio) e oltre 10 il tavolo si blocca
create or replace function public.verifica_tavolo(p_token text, p_codice text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tav public.tavoli; v_ses public.sessioni_tavolo;
begin
  select * into v_tav from public.tavoli where qr_token = p_token and attivo;
  if v_tav.id is null then return jsonb_build_object('errore', 'Tavolo non valido: inquadra di nuovo il QR'); end if;
  select * into v_ses from public.sessioni_tavolo where tavolo_id = v_tav.id and chiusa_at is null;
  if v_ses.id is null then return jsonb_build_object('errore', 'Il tavolo non è ancora aperto: chiedi al personale'); end if;
  if v_ses.codice_errati >= 10 then return jsonb_build_object('errore', 'Troppi codici errati: chiedi al personale'); end if;
  if p_codice is distinct from v_ses.codice then
    update public.sessioni_tavolo set codice_errati = codice_errati + 1 where id = v_ses.id;
    return jsonb_build_object('errore', 'Codice del tavolo non corretto', 'codice_errato', true);
  end if;
  return jsonb_build_object('tavolo_id', v_tav.id, 'sessione_id', v_ses.id, 'locale_id', v_tav.locale_id);
end $$;

create or replace function public.invia_ordine(p_token text, p_codice text, p_righe jsonb, p_nota text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := public.verifica_tavolo(p_token, p_codice);
  v_ord uuid; r jsonb; v_prod public.prodotti; v_q int;
begin
  if v ? 'errore' then return v; end if;
  if jsonb_typeof(p_righe) is distinct from 'array' or jsonb_array_length(p_righe) not between 1 and 30 then
    return jsonb_build_object('errore', 'Ordine vuoto o troppo lungo');
  end if;
  if (select count(*) from public.ordini where sessione_id = (v->>'sessione_id')::uuid and creato_at > now() - interval '10 minutes') >= 5 then
    return jsonb_build_object('errore', 'Troppi ordini ravvicinati: attendi qualche minuto o chiedi al personale');
  end if;
  insert into public.ordini (locale_id, sessione_id, tavolo_id, origine, nota)
  values ((v->>'locale_id')::uuid, (v->>'sessione_id')::uuid, (v->>'tavolo_id')::uuid, 'cliente', left(coalesce(p_nota, ''), 200))
  returning id into v_ord;
  for r in select * from jsonb_array_elements(p_righe) loop
    select * into v_prod from public.prodotti
     where id::text = r->>'prodotto_id' and locale_id = (v->>'locale_id')::uuid and visibile and disponibile;
    v_q := case when (r->>'quantita') ~ '^[0-9]{1,2}$' then (r->>'quantita')::int else 0 end;
    if v_prod.id is null or v_q not between 1 and 20 then
      raise exception 'Un piatto non è più disponibile o la quantità non è valida: aggiorna il menu' using errcode = '22023';
    end if;
    insert into public.righe_ordine (ordine_id, locale_id, prodotto_id, nome, prezzo_cent, quantita, nota)
    values (v_ord, v_prod.locale_id, v_prod.id, v_prod.nome, v_prod.prezzo_cent, v_q, left(coalesce(r->>'nota', ''), 120));
  end loop;
  return jsonb_build_object('id', v_ord, 'stato', 'da_confermare');
end $$;

-- Ordini del tavolo aperto, per seguire lo stato dal telefono
create or replace function public.ordini_tavolo(p_token text, p_codice text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb := public.verifica_tavolo(p_token, p_codice);
begin
  if v ? 'errore' then return v; end if;
  return jsonb_build_object('ordini', coalesce((
    select jsonb_agg(jsonb_build_object('id', o.id, 'stato', o.stato, 'motivo', o.motivo, 'creato_at', o.creato_at,
             'righe', (select jsonb_agg(jsonb_build_object('nome', r.nome, 'quantita', r.quantita, 'prezzo_cent', r.prezzo_cent, 'nota', r.nota))
                       from public.righe_ordine r where r.ordine_id = o.id)) order by o.creato_at desc)
    from public.ordini o where o.sessione_id = (v->>'sessione_id')::uuid), '[]'::jsonb));
end $$;

-- ============================================================ Funzioni per lo staff

create or replace function public.decidi_ordine(p_ordine uuid, p_conferma boolean, p_motivo text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v_locale uuid;
begin
  select locale_id into v_locale from public.ordini where id = p_ordine and stato = 'da_confermare';
  if v_locale is null then raise exception 'Ordine già gestito o inesistente' using errcode = '22023'; end if;
  if not public.ha_ruolo_locale(v_locale, array['owner','manager','cameriere']::public.ruolo[]) then
    raise exception 'Permesso negato' using errcode = '42501';
  end if;
  update public.ordini
     set stato = case when p_conferma then 'confermato' else 'rifiutato' end,
         motivo = case when p_conferma then '' else left(coalesce(p_motivo, ''), 200) end,
         confermato_at = now(), confermato_da = (select auth.uid())
   where id = p_ordine;
end $$;

-- Avanzamento in cucina e sala (cucina compresa)
create or replace function public.avanza_ordine(p_ordine uuid, p_stato text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.ordini;
begin
  select * into v from public.ordini where id = p_ordine;
  if v.id is null or not public.ha_ruolo_locale(v.locale_id, array['owner','manager','cameriere','cucina']::public.ruolo[]) then
    raise exception 'Permesso negato' using errcode = '42501';
  end if;
  if not ((v.stato = 'confermato' and p_stato = 'in_preparazione') or (v.stato = 'in_preparazione' and p_stato = 'pronto')
          or (v.stato = 'pronto' and p_stato = 'servito')) then
    raise exception 'Passaggio di stato non valido' using errcode = '22023';
  end if;
  update public.ordini set stato = p_stato where id = p_ordine;
end $$;

revoke execute on function public.tavolo_cliente(text), public.verifica_tavolo(text, text), public.invia_ordine(text, text, jsonb, text),
  public.ordini_tavolo(text, text), public.decidi_ordine(uuid, boolean, text), public.avanza_ordine(uuid, text) from public, anon, authenticated;
grant execute on function public.tavolo_cliente(text), public.invia_ordine(text, text, jsonb, text), public.ordini_tavolo(text, text) to anon, authenticated;
grant execute on function public.decidi_ordine(uuid, boolean, text), public.avanza_ordine(uuid, text) to authenticated;
-- verifica_tavolo resta interna: la usano solo le altre funzioni

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.ordini;
  end if;
end $$;
