-- Richieste dal tavolo: il cliente ordina anche a tavolo chiuso o senza codice; lo staff riceve la notifica,
-- apre il tavolo (se serve) e accetta con un tocco. Il codice arriva da solo sul telefono che ha fatto la richiesta.
-- Inoltre: comande aggiunte dalla sala, già confermate.

-- ============================================================ Ordini: logica comune
create or replace function public.crea_ordine_interno(p_locale uuid, p_sessione uuid, p_tavolo uuid, p_righe jsonb,
                                                     p_nota text, p_origine text, p_stato text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ord uuid; r jsonb; v_prod public.prodotti; v_q int;
begin
  if jsonb_typeof(p_righe) is distinct from 'array' or jsonb_array_length(p_righe) not between 1 and 30 then
    raise exception 'Ordine vuoto o troppo lungo' using errcode = '22023';
  end if;
  insert into public.ordini (locale_id, sessione_id, tavolo_id, origine, nota, stato, confermato_at, confermato_da)
  values (p_locale, p_sessione, p_tavolo, p_origine, left(coalesce(p_nota, ''), 200), p_stato,
          case when p_stato = 'confermato' then now() end, case when p_stato = 'confermato' then (select auth.uid()) end)
  returning id into v_ord;
  for r in select * from jsonb_array_elements(p_righe) loop
    select * into v_prod from public.prodotti where id::text = r->>'prodotto_id' and locale_id = p_locale and visibile and disponibile;
    v_q := case when (r->>'quantita') ~ '^[0-9]{1,2}$' then (r->>'quantita')::int else 0 end;
    if v_prod.id is null or v_q not between 1 and 20 then
      raise exception 'Un piatto non è più disponibile o la quantità non è valida: aggiorna il menu' using errcode = '22023';
    end if;
    insert into public.righe_ordine (ordine_id, locale_id, prodotto_id, nome, prezzo_cent, quantita, nota)
    values (v_ord, p_locale, v_prod.id, v_prod.nome, v_prod.prezzo_cent, v_q, left(coalesce(r->>'nota', ''), 120));
  end loop;
  return v_ord;
end $$;

-- Apre il tavolo se è chiuso (stessa logica di apri_tavolo), restituisce la sessione aperta
create or replace function public.sessione_aperta_o_nuova(p_tavolo uuid, p_coperti int)
returns public.sessioni_tavolo language plpgsql security definer set search_path = '' as $$
declare v public.sessioni_tavolo; v_locale uuid;
begin
  select * into v from public.sessioni_tavolo where tavolo_id = p_tavolo and chiusa_at is null;
  if v.id is not null then return v; end if;
  select locale_id into v_locale from public.tavoli where id = p_tavolo and attivo;
  insert into public.sessioni_tavolo (locale_id, tavolo_id, coperti, codice)
  values (v_locale, p_tavolo, greatest(1, least(coalesce(p_coperti, 2), 60)),
          lpad((('x' || encode(extensions.gen_random_bytes(2), 'hex'))::bit(16)::int % 10000)::text, 4, '0'))
  returning * into v;
  return v;
end $$;

-- invia_ordine ora usa la logica comune (comportamento invariato)
create or replace function public.invia_ordine(p_token text, p_codice text, p_righe jsonb, p_nota text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb := public.verifica_tavolo(p_token, p_codice); v_ord uuid;
begin
  if v ? 'errore' then return v; end if;
  if (select count(*) from public.ordini where sessione_id = (v->>'sessione_id')::uuid and creato_at > now() - interval '10 minutes') >= 5 then
    return jsonb_build_object('errore', 'Troppi ordini ravvicinati: attendi qualche minuto o chiedi al personale');
  end if;
  v_ord := public.crea_ordine_interno((v->>'locale_id')::uuid, (v->>'sessione_id')::uuid, (v->>'tavolo_id')::uuid,
                                      p_righe, p_nota, 'cliente', 'da_confermare');
  return jsonb_build_object('id', v_ord, 'stato', 'da_confermare');
end $$;

-- ============================================================ Richieste dal tavolo
create table public.richieste_tavolo (
  id           uuid primary key default gen_random_uuid(),
  locale_id    uuid not null references public.locali (id) on delete cascade,
  tavolo_id    uuid not null references public.tavoli (id) on delete cascade,
  segreto_hash text not null,                         -- solo il telefono che ha fatto la richiesta conosce il segreto
  righe        jsonb not null,
  nota         text not null default '' check (char_length(nota) <= 200),
  stato        text not null default 'in_attesa' check (stato in ('in_attesa', 'accettata', 'rifiutata', 'scaduta')),
  motivo       text not null default '' check (char_length(motivo) <= 200),
  sessione_id  uuid references public.sessioni_tavolo (id) on delete set null,
  ordine_id    uuid references public.ordini (id) on delete set null,
  creato_at    timestamptz not null default now(),
  deciso_at    timestamptz,
  deciso_da    uuid
);
create index on public.richieste_tavolo (locale_id, stato, creato_at desc);
create trigger richieste_audit after insert or update on public.richieste_tavolo for each row execute function public.scrivi_audit();

alter table public.richieste_tavolo enable row level security;
create policy richieste_select on public.richieste_tavolo for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
revoke all on public.richieste_tavolo from anon;
revoke insert, update, delete on public.richieste_tavolo from authenticated;

-- Il cliente chiede di ordinare (tavolo chiuso o codice sconosciuto)
create or replace function public.richiedi_tavolo(p_token text, p_segreto text, p_righe jsonb, p_nota text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tav public.tavoli; v_id uuid; r jsonb;
begin
  select * into v_tav from public.tavoli where qr_token = p_token and attivo;
  if v_tav.id is null then return jsonb_build_object('errore', 'Tavolo non valido: inquadra di nuovo il QR'); end if;
  if coalesce(length(p_segreto), 0) < 16 then return jsonb_build_object('errore', 'Richiesta non valida'); end if;
  if jsonb_typeof(p_righe) is distinct from 'array' or jsonb_array_length(p_righe) not between 1 and 30 then
    return jsonb_build_object('errore', 'Ordine vuoto o troppo lungo');
  end if;
  for r in select * from jsonb_array_elements(p_righe) loop
    if not exists (select 1 from public.prodotti where id::text = r->>'prodotto_id' and locale_id = v_tav.locale_id and visibile and disponibile)
       or coalesce(r->>'quantita', '') !~ '^([1-9]|1[0-9]|20)$' then
      return jsonb_build_object('errore', 'Un piatto non è più disponibile: aggiorna il menu');
    end if;
  end loop;
  if (select count(*) from public.richieste_tavolo where tavolo_id = v_tav.id and stato = 'in_attesa' and creato_at > now() - interval '15 minutes') >= 3 then
    return jsonb_build_object('errore', 'Ci sono già richieste in attesa per questo tavolo: il personale arriva subito');
  end if;
  insert into public.richieste_tavolo (locale_id, tavolo_id, segreto_hash, righe, nota)
  values (v_tav.locale_id, v_tav.id, encode(extensions.digest(p_segreto, 'sha256'), 'hex'), p_righe, left(coalesce(p_nota, ''), 200))
  returning id into v_id;
  return jsonb_build_object('richiesta', v_id, 'stato', 'in_attesa');
end $$;

-- Il telefono che ha fatto la richiesta ne segue lo stato e, se accettata, riceve il codice del tavolo
create or replace function public.stato_richiesta(p_token text, p_richiesta uuid, p_segreto text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.richieste_tavolo; v_codice text;
begin
  select r.* into v from public.richieste_tavolo r join public.tavoli t on t.id = r.tavolo_id
   where r.id = p_richiesta and t.qr_token = p_token and r.segreto_hash = encode(extensions.digest(coalesce(p_segreto, ''), 'sha256'), 'hex');
  if v.id is null then return jsonb_build_object('errore', 'Richiesta non trovata'); end if;
  if v.stato = 'in_attesa' and v.creato_at < now() - interval '15 minutes' then
    update public.richieste_tavolo set stato = 'scaduta' where id = v.id;
    return jsonb_build_object('stato', 'scaduta');
  end if;
  if v.stato = 'accettata' then
    select codice into v_codice from public.sessioni_tavolo where id = v.sessione_id and chiusa_at is null;
  end if;
  return jsonb_build_object('stato', v.stato, 'motivo', v.motivo, 'codice', v_codice);
end $$;

-- Lo staff accetta: apre il tavolo se serve, crea l'ordine già confermato, restituisce il codice
create or replace function public.accetta_richiesta(p_richiesta uuid, p_coperti int default 2)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.richieste_tavolo; v_ses public.sessioni_tavolo; v_ord uuid;
begin
  select * into v from public.richieste_tavolo where id = p_richiesta for update;
  if v.id is null or not public.ha_ruolo_locale(v.locale_id, array['owner','manager','cameriere']::public.ruolo[]) then
    raise exception 'Permesso negato' using errcode = '42501';
  end if;
  if v.stato <> 'in_attesa' or v.creato_at < now() - interval '15 minutes' then
    raise exception 'Richiesta già gestita o scaduta' using errcode = '22023';
  end if;
  v_ses := public.sessione_aperta_o_nuova(v.tavolo_id, p_coperti);
  v_ord := public.crea_ordine_interno(v.locale_id, v_ses.id, v.tavolo_id, v.righe, v.nota, 'cliente', 'confermato');
  update public.richieste_tavolo set stato = 'accettata', sessione_id = v_ses.id, ordine_id = v_ord, deciso_at = now(), deciso_da = (select auth.uid())
   where id = v.id;
  return jsonb_build_object('codice', v_ses.codice, 'sessione_id', v_ses.id, 'ordine_id', v_ord);
end $$;

create or replace function public.rifiuta_richiesta(p_richiesta uuid, p_motivo text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v public.richieste_tavolo;
begin
  select * into v from public.richieste_tavolo where id = p_richiesta;
  if v.id is null or not public.ha_ruolo_locale(v.locale_id, array['owner','manager','cameriere']::public.ruolo[]) then
    raise exception 'Permesso negato' using errcode = '42501';
  end if;
  if v.stato <> 'in_attesa' then raise exception 'Richiesta già gestita' using errcode = '22023'; end if;
  update public.richieste_tavolo set stato = 'rifiutata', motivo = left(coalesce(p_motivo, ''), 200), deciso_at = now(), deciso_da = (select auth.uid())
   where id = v.id;
end $$;

-- Comanda aggiunta dal cameriere: già confermata
create or replace function public.ordine_sala(p_tavolo uuid, p_righe jsonb, p_nota text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ses public.sessioni_tavolo;
begin
  select s.* into v_ses from public.sessioni_tavolo s where s.tavolo_id = p_tavolo and s.chiusa_at is null;
  if v_ses.id is null then
    if not exists (select 1 from public.tavoli t where t.id = p_tavolo
                   and public.ha_ruolo_locale(t.locale_id, array['owner','manager','cameriere']::public.ruolo[])) then
      raise exception 'Permesso negato' using errcode = '42501';
    end if;
    raise exception 'Apri prima il tavolo' using errcode = '22023';
  end if;
  if not public.ha_ruolo_locale(v_ses.locale_id, array['owner','manager','cameriere']::public.ruolo[]) then
    raise exception 'Permesso negato' using errcode = '42501';
  end if;
  return public.crea_ordine_interno(v_ses.locale_id, v_ses.id, p_tavolo, p_righe, p_nota, 'sala', 'confermato');
end $$;

revoke execute on function public.crea_ordine_interno(uuid, uuid, uuid, jsonb, text, text, text), public.sessione_aperta_o_nuova(uuid, int),
  public.richiedi_tavolo(text, text, jsonb, text), public.stato_richiesta(text, uuid, text), public.accetta_richiesta(uuid, int),
  public.rifiuta_richiesta(uuid, text), public.ordine_sala(uuid, jsonb, text), public.invia_ordine(text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.richiedi_tavolo(text, text, jsonb, text), public.stato_richiesta(text, uuid, text),
  public.invia_ordine(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.accetta_richiesta(uuid, int), public.rifiuta_richiesta(uuid, text), public.ordine_sala(uuid, jsonb, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.richieste_tavolo;
  end if;
end $$;
