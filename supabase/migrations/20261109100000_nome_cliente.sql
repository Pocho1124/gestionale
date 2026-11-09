-- Nome del cliente all'apertura del tavolo dal telefono, attivabile dalle impostazioni del locale.
-- Dato personale (ISO 27701, minimizzazione): spento per impostazione predefinita, facoltativo salvo scelta del locale,
-- tenuto in una tabella a parte SENZA audit (non finisce nello storico), visibile solo al personale di sala,
-- cancellato quando il tavolo si chiude, quando la richiesta è rifiutata o scade.

-- ============================================================ Capacità «impostazioni» (titolare e responsabile)
create or replace function public.puo(p_locale uuid, p_capacita text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.ruolo_in_locale(p_locale)::text = any (case p_capacita
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
    else array[]::text[] end), false);
$$;

-- ============================================================ Impostazioni della pagina del tavolo
create table public.impostazioni_tavolo (
  locale_id         uuid primary key references public.locali (id) on delete cascade,
  chiedi_nome       boolean not null default false,   -- campo «Il tuo nome» quando si chiede di aprire il tavolo
  nome_obbligatorio boolean not null default false,   -- senza nome la richiesta non parte
  updated_at        timestamptz not null default now(),
  check (chiedi_nome or not nome_obbligatorio)
);
create trigger impostazioni_tavolo_updated_at before update on public.impostazioni_tavolo for each row execute function public.set_updated_at();
create trigger impostazioni_tavolo_audit after insert or update or delete on public.impostazioni_tavolo for each row execute function public.scrivi_audit();

alter table public.impostazioni_tavolo enable row level security;
create policy impostazioni_tavolo_select on public.impostazioni_tavolo for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
create policy impostazioni_tavolo_insert on public.impostazioni_tavolo for insert to authenticated with check (public.puo(locale_id, 'impostazioni'));
create policy impostazioni_tavolo_update on public.impostazioni_tavolo for update to authenticated
  using (public.puo(locale_id, 'impostazioni')) with check (public.puo(locale_id, 'impostazioni'));
revoke all on public.impostazioni_tavolo from anon;
revoke delete, truncate on public.impostazioni_tavolo from authenticated;

-- ============================================================ Nomi dei clienti (nessun audit, conservazione minima)
create table public.nomi_clienti (
  richiesta_id uuid primary key references public.richieste_tavolo (id) on delete cascade,
  locale_id    uuid not null references public.locali (id) on delete cascade,
  sessione_id  uuid references public.sessioni_tavolo (id) on delete cascade,
  nome         text not null check (char_length(nome) between 1 and 40),
  creato_at    timestamptz not null default now()
);
create index on public.nomi_clienti (sessione_id);
create index on public.nomi_clienti (locale_id, creato_at);

alter table public.nomi_clienti enable row level security;
-- Solo il personale di sala (la cucina non ne ha bisogno); scritture solo dalle funzioni del database
create policy nomi_clienti_select on public.nomi_clienti for select to authenticated using (public.puo(locale_id, 'sala.apri'));
revoke all on public.nomi_clienti from anon;
revoke insert, update, delete, truncate on public.nomi_clienti from authenticated;

-- Richiesta decisa: accettata → il nome segue il tavolo; rifiutata o scaduta → il nome si cancella
create or replace function public.nome_cliente_richiesta()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stato = 'accettata' then
    update public.nomi_clienti set sessione_id = new.sessione_id where richiesta_id = new.id;
  elsif new.stato in ('rifiutata', 'scaduta') then
    delete from public.nomi_clienti where richiesta_id = new.id;
  end if;
  return null;
end $$;
create trigger richieste_nome_cliente after update of stato on public.richieste_tavolo
  for each row when (old.stato is distinct from new.stato) execute function public.nome_cliente_richiesta();

-- Tavolo chiuso → i nomi del tavolo si cancellano
create or replace function public.nome_cliente_chiusura()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.nomi_clienti where sessione_id = new.id;
  return null;
end $$;
create trigger sessioni_nome_cliente after update of chiusa_at on public.sessioni_tavolo
  for each row when (old.chiusa_at is null and new.chiusa_at is not null) execute function public.nome_cliente_chiusura();

-- ============================================================ Pagina del tavolo: sa se chiedere il nome
create or replace function public.tavolo_cliente(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('tavolo', t.nome, 'slug', l.slug, 'locale', l.nome,
           'aperto', exists (select 1 from public.sessioni_tavolo s where s.tavolo_id = t.id and s.chiusa_at is null),
           'chiedi_nome', coalesce(i.chiedi_nome, false), 'nome_obbligatorio', coalesce(i.nome_obbligatorio, false))
  from public.tavoli t join public.locali l on l.id = t.locale_id
  left join public.impostazioni_tavolo i on i.locale_id = l.id
  where t.qr_token = p_token and t.attivo and l.attivo;
$$;

-- ============================================================ Richiesta dal telefono con il nome (facoltativo)
drop function public.richiedi_tavolo(text, text, jsonb, text);
create function public.richiedi_tavolo(p_token text, p_segreto text, p_righe jsonb, p_nota text default '', p_nome text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tav public.tavoli; v_imp public.impostazioni_tavolo; v_id uuid; r jsonb;
        v_nome text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
begin
  select * into v_tav from public.tavoli where qr_token = p_token and attivo;
  if v_tav.id is null then return jsonb_build_object('errore', 'Tavolo non valido: inquadra di nuovo il QR'); end if;
  if coalesce(length(p_segreto), 0) < 16 then return jsonb_build_object('errore', 'Richiesta non valida'); end if;
  if jsonb_typeof(p_righe) is distinct from 'array' or jsonb_array_length(p_righe) not between 1 and 30 then
    return jsonb_build_object('errore', 'Ordine vuoto o troppo lungo');
  end if;
  -- Nome: considerato solo se il locale lo chiede (altrimenti non si conserva nulla)
  select * into v_imp from public.impostazioni_tavolo where locale_id = v_tav.locale_id;
  if not coalesce(v_imp.chiedi_nome, false) then v_nome := ''; end if;
  if v_nome = '' and coalesce(v_imp.nome_obbligatorio, false) then
    return jsonb_build_object('errore', 'Scrivi il tuo nome per chiedere l''apertura del tavolo');
  end if;
  if v_nome <> '' and (char_length(v_nome) > 40 or v_nome !~ '^[[:alpha:]0-9][[:alpha:]0-9 .''’-]*$') then
    return jsonb_build_object('errore', 'Nome non valido: usa solo lettere, numeri, spazi, apostrofi e trattini (max 40)');
  end if;
  begin
    for r in select * from jsonb_array_elements(p_righe) loop
      if coalesce(r->>'quantita', '') !~ '^([1-9]|1[0-9]|20)$' or coalesce(r->>'prodotto_id', '') !~ '^[0-9a-f-]{36}$' then
        return jsonb_build_object('errore', 'Quantità non valida');
      end if;
      perform public.prezzo_riga(v_tav.locale_id, (r->>'prodotto_id')::uuid, r->'opzioni');
    end loop;
  exception when sqlstate '22023' then return jsonb_build_object('errore', sqlerrm);
  end;
  if (select count(*) from public.richieste_tavolo where tavolo_id = v_tav.id and stato = 'in_attesa' and creato_at > now() - interval '15 minutes') >= 3 then
    return jsonb_build_object('errore', 'Ci sono già richieste in attesa per questo tavolo: il personale arriva subito');
  end if;
  -- Pulizia: nomi di richieste mai gestite (oltre 15 minuti) o rimasti senza tavolo da più di un giorno
  delete from public.nomi_clienti n using public.richieste_tavolo q
   where q.id = n.richiesta_id and n.sessione_id is null and q.stato = 'in_attesa' and q.creato_at < now() - interval '15 minutes';
  delete from public.nomi_clienti where sessione_id is null and creato_at < now() - interval '1 day';

  insert into public.richieste_tavolo (locale_id, tavolo_id, segreto_hash, righe, nota)
  values (v_tav.locale_id, v_tav.id, encode(extensions.digest(p_segreto, 'sha256'), 'hex'), p_righe, left(coalesce(p_nota, ''), 200))
  returning id into v_id;
  if v_nome <> '' then
    insert into public.nomi_clienti (richiesta_id, locale_id, nome) values (v_id, v_tav.locale_id, v_nome);
  end if;
  return jsonb_build_object('richiesta', v_id, 'stato', 'in_attesa');
end $$;

-- ============================================================ Permessi
revoke execute on function public.puo(uuid, text), public.tavolo_cliente(text), public.richiedi_tavolo(text, text, jsonb, text, text),
  public.nome_cliente_richiesta(), public.nome_cliente_chiusura() from public, anon, authenticated;
grant execute on function public.puo(uuid, text) to authenticated;
grant execute on function public.tavolo_cliente(text), public.richiedi_tavolo(text, text, jsonb, text, text) to anon, authenticated;
