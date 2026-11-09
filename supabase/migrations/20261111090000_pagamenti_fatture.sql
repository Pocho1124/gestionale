-- Pagamenti del conto in più parti (importo, percentuale, alla romana; contanti, POS, altro), sconto,
-- terminali POS con esito (oggi confermato da chi incassa, domani dal servizio di collegamento) e fatture
-- elettroniche (dati fiscali del locale, numerazione annuale, scorporo IVA): tutto calcolato dal database.

-- ============================================================ Sconto sul conto
alter table public.sessioni_tavolo add column sconto_cent int not null default 0 check (sconto_cent >= 0);

-- ============================================================ Terminali POS
create table public.terminali_pos (
  id         uuid primary key default gen_random_uuid(),
  locale_id  uuid not null references public.locali (id) on delete cascade,
  nome       text not null check (char_length(btrim(nome)) between 1 and 40),
  attivo     boolean not null default true,
  posizione  int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.terminali_pos (locale_id, posizione);
alter table public.terminali_pos enable row level security;
create policy terminali_select on public.terminali_pos for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
create policy terminali_write on public.terminali_pos for all to authenticated
  using (public.puo(locale_id, 'impostazioni')) with check (public.puo(locale_id, 'impostazioni'));
revoke all on public.terminali_pos from anon;
revoke truncate on public.terminali_pos from authenticated;

-- ============================================================ Pagamenti (scritti solo dalle funzioni)
create table public.pagamenti (
  id            uuid primary key default gen_random_uuid(),
  locale_id     uuid not null references public.locali (id) on delete cascade,
  sessione_id   uuid not null references public.sessioni_tavolo (id) on delete cascade,
  metodo        text not null check (metodo in ('contanti', 'carta', 'altro')),
  importo_cent  int  not null check (importo_cent between 1 and 10000000),
  ricevuto_cent int  check (ricevuto_cent is null or ricevuto_cent >= importo_cent),   -- contanti: quanto ha dato il cliente
  quota         text not null default '' check (char_length(quota) <= 40),            -- es. «Quota 2/4», «30%»
  terminale_id  uuid references public.terminali_pos (id) on delete set null,
  stato         text not null default 'approvato' check (stato in ('in_attesa', 'approvato', 'rifiutato', 'annullato')),
  riferimento   text not null default '' check (char_length(riferimento) <= 40),      -- codice di autorizzazione del POS
  creato_da     uuid default auth.uid(),
  creato_at     timestamptz not null default now(),
  esito_at      timestamptz,
  check (metodo = 'contanti' or ricevuto_cent is null)
);
create index on public.pagamenti (sessione_id);
create index on public.pagamenti (locale_id, creato_at);
alter table public.pagamenti enable row level security;
create policy pagamenti_select on public.pagamenti for select to authenticated using (public.puo(locale_id, 'sala.chiudi'));
revoke all on public.pagamenti from anon;
revoke insert, update, delete, truncate on public.pagamenti from authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.pagamenti;
  end if;
end $$;

-- ============================================================ Stato del conto
create or replace function public.stato_conto(p_sessione uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ses public.sessioni_tavolo; v_lordo int; v_totale int; v_pagato int; v_attesa int;
begin
  select * into v_ses from public.sessioni_tavolo where id = p_sessione;
  if v_ses.id is null or not public.puo(v_ses.locale_id, 'sala.chiudi') then raise exception 'Permesso negato' using errcode = '42501'; end if;
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
      from public.pagamenti p left join public.terminali_pos t on t.id = p.terminale_id where p.sessione_id = v_ses.id), '[]'::jsonb));
end $$;

-- Sessione aperta del conto, bloccata fino a fine transazione (pagamenti e chiusura non si sovrappongono)
create or replace function public.sessione_da_incassare(p_sessione uuid)
returns public.sessioni_tavolo language plpgsql security definer set search_path = '' as $$
declare v_ses public.sessioni_tavolo;
begin
  select * into v_ses from public.sessioni_tavolo where id = p_sessione for update;
  if v_ses.id is null or not public.puo(v_ses.locale_id, 'sala.chiudi') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if v_ses.chiusa_at is not null then raise exception 'Il tavolo è già chiuso' using errcode = '22023'; end if;
  return v_ses;
end $$;

-- Sconto in euro o in percentuale sul totale degli ordini
create or replace function public.imposta_sconto(p_sessione uuid, p_cent int default null, p_percentuale numeric default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ses public.sessioni_tavolo := public.sessione_da_incassare(p_sessione); v_lordo int := public.totale_sessione(p_sessione); v_sconto int; v_impegnato int;
begin
  if p_percentuale is not null then
    if p_percentuale < 0 or p_percentuale > 100 then raise exception 'Percentuale di sconto tra 0 e 100' using errcode = '22023'; end if;
    v_sconto := round(v_lordo * p_percentuale / 100)::int;
  else
    v_sconto := coalesce(p_cent, 0);
  end if;
  if v_sconto < 0 or v_sconto > v_lordo then raise exception 'Lo sconto non può superare il conto' using errcode = '22023'; end if;
  select coalesce(sum(importo_cent), 0) into v_impegnato from public.pagamenti where sessione_id = p_sessione and stato in ('approvato', 'in_attesa');
  if v_lordo - v_sconto < v_impegnato then raise exception 'Con questo sconto il conto scende sotto quanto già pagato: annulla prima un pagamento' using errcode = '22023'; end if;
  update public.sessioni_tavolo set sconto_cent = v_sconto where id = v_ses.id;
  return public.stato_conto(p_sessione);
end $$;

-- Un pagamento (o una parte): in contanti e «altro» è subito incassato, con il POS attende l'esito
create or replace function public.registra_pagamento(p_sessione uuid, p_metodo text, p_importo_cent int default null, p_percentuale numeric default null,
                                                     p_ricevuto_cent int default null, p_quota text default '', p_terminale uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ses public.sessioni_tavolo := public.sessione_da_incassare(p_sessione); v_conto jsonb; v_importo int; v_id uuid;
begin
  if p_metodo not in ('contanti', 'carta', 'altro') then raise exception 'Metodo di pagamento non valido' using errcode = '22023'; end if;
  v_conto := public.stato_conto(p_sessione);
  if (v_conto->>'residuo_cent')::int <= 0 then raise exception 'Il conto è già saldato' using errcode = '22023'; end if;
  if p_percentuale is not null then
    if p_percentuale <= 0 or p_percentuale > 100 then raise exception 'Percentuale tra 0 e 100' using errcode = '22023'; end if;
    v_importo := least(round((v_conto->>'totale_cent')::int * p_percentuale / 100)::int, (v_conto->>'residuo_cent')::int);
  else
    v_importo := p_importo_cent;
  end if;
  if v_importo is null or v_importo < 1 then raise exception 'Importo non valido' using errcode = '22023'; end if;
  if v_importo > (v_conto->>'residuo_cent')::int then
    raise exception 'L''importo supera quanto resta da pagare (% €)', replace(to_char((v_conto->>'residuo_cent')::int / 100.0, 'FM999990.00'), '.', ',') using errcode = '22023';
  end if;
  if p_metodo <> 'contanti' and p_ricevuto_cent is not null then raise exception 'Il contante ricevuto vale solo per i contanti' using errcode = '22023'; end if;
  if p_ricevuto_cent is not null and p_ricevuto_cent < v_importo then raise exception 'Il contante ricevuto è inferiore all''importo' using errcode = '22023'; end if;
  if p_terminale is not null and (p_metodo <> 'carta' or not exists (
       select 1 from public.terminali_pos where id = p_terminale and locale_id = v_ses.locale_id and attivo)) then
    raise exception 'Terminale POS non valido' using errcode = '22023';
  end if;
  insert into public.pagamenti (locale_id, sessione_id, metodo, importo_cent, ricevuto_cent, quota, terminale_id, stato, esito_at)
  values (v_ses.locale_id, v_ses.id, p_metodo, v_importo, p_ricevuto_cent, left(btrim(coalesce(p_quota, '')), 40), p_terminale,
          case when p_metodo = 'carta' then 'in_attesa' else 'approvato' end, case when p_metodo = 'carta' then null else now() end)
  returning id into v_id;
  return public.stato_conto(p_sessione) || jsonb_build_object('pagamento', v_id, 'resto_cent', coalesce(p_ricevuto_cent - v_importo, 0));
end $$;

-- Esito del POS: approvato (con il codice di autorizzazione) o rifiutato
create or replace function public.esito_pos(p_pagamento uuid, p_approvato boolean, p_riferimento text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pag public.pagamenti;
begin
  select * into v_pag from public.pagamenti where id = p_pagamento;
  if v_pag.id is null then raise exception 'Pagamento inesistente' using errcode = '22023'; end if;
  perform public.sessione_da_incassare(v_pag.sessione_id);
  if v_pag.stato <> 'in_attesa' then raise exception 'Il pagamento ha già un esito' using errcode = '22023'; end if;
  update public.pagamenti set stato = case when p_approvato then 'approvato' else 'rifiutato' end, esito_at = now(),
         riferimento = left(btrim(coalesce(p_riferimento, '')), 40) where id = p_pagamento;
  return public.stato_conto(v_pag.sessione_id);
end $$;

-- Annullo di un pagamento a tavolo ancora aperto (es. metodo sbagliato): resta nello storico come annullato
create or replace function public.annulla_pagamento(p_pagamento uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pag public.pagamenti;
begin
  select * into v_pag from public.pagamenti where id = p_pagamento;
  if v_pag.id is null then raise exception 'Pagamento inesistente' using errcode = '22023'; end if;
  perform public.sessione_da_incassare(v_pag.sessione_id);
  if v_pag.stato not in ('approvato', 'in_attesa') then raise exception 'Il pagamento è già annullato o rifiutato' using errcode = '22023'; end if;
  update public.pagamenti set stato = 'annullato', esito_at = now() where id = p_pagamento;
  return public.stato_conto(v_pag.sessione_id);
end $$;

-- Chiusura: con pagamenti registrati il conto deve tornare al centesimo; senza, un pagamento unico col metodo indicato
create or replace function public.chiudi_tavolo(p_tavolo uuid, p_pagamento text default 'contanti')
returns int language plpgsql security definer set search_path = '' as $$
declare v_locale uuid; v_ses public.sessioni_tavolo; v_totale int; v_pagato int; v_metodo text; v_metodi int;
begin
  select locale_id into v_locale from public.tavoli where id = p_tavolo;
  if v_locale is null or not public.puo(v_locale, 'sala.chiudi') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  select * into v_ses from public.sessioni_tavolo where tavolo_id = p_tavolo and chiusa_at is null for update;
  if v_ses.id is null then raise exception 'Il tavolo non è aperto' using errcode = '22023'; end if;
  v_totale := greatest(public.totale_sessione(v_ses.id) - v_ses.sconto_cent, 0);
  if exists (select 1 from public.pagamenti where sessione_id = v_ses.id and stato = 'in_attesa') then
    raise exception 'C''è un pagamento POS in attesa di esito' using errcode = '22023';
  end if;
  select coalesce(sum(importo_cent), 0), count(distinct metodo), min(metodo) into v_pagato, v_metodi, v_metodo
    from public.pagamenti where sessione_id = v_ses.id and stato = 'approvato';
  if v_metodi > 0 then
    if v_pagato < v_totale then
      raise exception 'Mancano % € per saldare il conto', replace(to_char((v_totale - v_pagato) / 100.0, 'FM999990.00'), '.', ',') using errcode = '22023';
    elsif v_pagato > v_totale then
      raise exception 'Pagato % € in più del conto: annulla o correggi un pagamento', replace(to_char((v_pagato - v_totale) / 100.0, 'FM999990.00'), '.', ',') using errcode = '22023';
    end if;
    if v_metodi > 1 then v_metodo := 'misto'; end if;
  else
    if p_pagamento not in ('contanti', 'carta', 'altro') then
      raise exception 'Metodo di pagamento non valido: per il pagamento misto registra le singole parti' using errcode = '22023';
    end if;
    v_metodo := p_pagamento;
    if v_totale > 0 then
      insert into public.pagamenti (locale_id, sessione_id, metodo, importo_cent, quota, stato, esito_at)
      values (v_ses.locale_id, v_ses.id, p_pagamento, v_totale, 'Unico', 'approvato', now());
    end if;
  end if;
  update public.sessioni_tavolo set chiusa_at = now(), chiusa_da = (select auth.uid()), pagamento = v_metodo, totale_cent = v_totale
   where id = v_ses.id;
  return v_totale;
end $$;

-- Resoconto di cassa: incassi per metodo dai singoli pagamenti, più gli sconti fatti
create or replace function public.resoconto_cassa(p_locale uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_dal timestamptz; v_al timestamptz := now();
begin
  if not public.puo(p_locale, 'cassa') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  select coalesce(max(al), '-infinity'::timestamptz) into v_dal from public.chiusure_cassa where locale_id = p_locale;
  return (
    with conti as (
      select s.* from public.sessioni_tavolo s where s.locale_id = p_locale and s.chiusa_at > v_dal and s.chiusa_at <= v_al),
    righe as (
      select r.*, o.stato from public.ordini o join public.righe_ordine r on r.ordine_id = o.id where o.sessione_id in (select id from conti)),
    incassi as (
      select p.metodo, p.importo_cent from public.pagamenti p where p.stato = 'approvato' and p.sessione_id in (select id from conti)
      union all   -- conti chiusi prima dei pagamenti divisi
      select coalesce(c.pagamento, 'non indicato'), c.totale_cent from conti c
       where not exists (select 1 from public.pagamenti p where p.sessione_id = c.id and p.stato = 'approvato'))
    select jsonb_build_object(
      'dal', case when v_dal = '-infinity' then null else v_dal end, 'al', v_al,
      'conti', (select count(*) from conti),
      'coperti', (select coalesce(sum(coperti), 0) from conti),
      'totale_cent', (select coalesce(sum(totale_cent), 0) from conti),
      'sconti_cent', (select coalesce(sum(sconto_cent), 0) from conti),
      'per_pagamento', (select coalesce(jsonb_object_agg(metodo, t), '{}') from
                          (select metodo, sum(importo_cent) t from incassi group by metodo) x),
      'per_reparto', (select coalesce(jsonb_agg(jsonb_build_object('reparto', coalesce(rp.nome, 'Senza reparto'), 'totale_cent', t) order by t desc), '[]') from
                          (select reparto_id, sum(quantita * prezzo_cent) t from righe where stato not in ('rifiutato', 'annullato') group by reparto_id) x
                          left join public.reparti rp on rp.id = x.reparto_id),
      'piu_venduti', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'quantita', q, 'totale_cent', t) order by q desc), '[]') from
                          (select nome, sum(quantita) q, sum(quantita * prezzo_cent) t from righe where stato not in ('rifiutato', 'annullato')
                           group by nome order by sum(quantita) desc limit 15) x),
      'annullati', (select jsonb_build_object('ordini', count(distinct ordine_id), 'totale_cent', coalesce(sum(quantita * prezzo_cent), 0)) from righe where stato = 'annullato'),
      'tavoli_aperti', (select count(*) from public.sessioni_tavolo where locale_id = p_locale and chiusa_at is null))
  );
end $$;

-- ============================================================ Fatture elettroniche
-- Partita IVA italiana: 11 cifre con cifra di controllo
create or replace function public.partita_iva_valida(p text)
returns boolean language sql immutable set search_path = '' as $$
  select case when coalesce(p, '') !~ '^[0-9]{11}$' then false else
    (select sum(case when i % 2 = 1 then d when d * 2 > 9 then d * 2 - 9 else d * 2 end)
       from (select i, substr(p, i, 1)::int as d from generate_series(1, 11) i) x) % 10 = 0 end;
$$;

-- Dati del locale come emittente (cedente/prestatore)
create table public.dati_fiscali (
  locale_id      uuid primary key references public.locali (id) on delete cascade,
  denominazione  text not null check (char_length(btrim(denominazione)) between 1 and 80),
  partita_iva    text not null check (public.partita_iva_valida(partita_iva)),
  codice_fiscale text not null default '' check (codice_fiscale ~ '^([0-9]{11}|[A-Z0-9]{16})?$'),
  regime_fiscale text not null default 'RF01' check (regime_fiscale ~ '^RF(0[1-9]|1[0-9])$'),
  indirizzo      text not null check (char_length(btrim(indirizzo)) between 1 and 60),
  cap            text not null check (cap ~ '^[0-9]{5}$'),
  comune         text not null check (char_length(btrim(comune)) between 1 and 60),
  provincia      text not null default '' check (provincia ~ '^([A-Z]{2})?$'),
  updated_at     timestamptz not null default now()
);
create trigger dati_fiscali_updated_at before update on public.dati_fiscali for each row execute function public.set_updated_at();
alter table public.dati_fiscali enable row level security;
create policy dati_fiscali_select on public.dati_fiscali for select to authenticated using (public.puo(locale_id, 'cassa'));
create policy dati_fiscali_insert on public.dati_fiscali for insert to authenticated with check (public.puo(locale_id, 'cassa'));
create policy dati_fiscali_update on public.dati_fiscali for update to authenticated
  using (public.puo(locale_id, 'cassa')) with check (public.puo(locale_id, 'cassa'));
revoke all on public.dati_fiscali from anon;
revoke delete, truncate on public.dati_fiscali from authenticated;

-- Fatture emesse: immutabili (nessuna modifica né cancellazione), numerate per anno, solo per l'amministratore
create table public.fatture (
  id           uuid primary key default gen_random_uuid(),
  locale_id    uuid not null references public.locali (id) on delete cascade,
  anno         int  not null,
  numero       int  not null check (numero > 0),
  data         date not null default current_date,
  sessione_id  uuid references public.sessioni_tavolo (id) on delete set null,
  cedente      jsonb not null,    -- copia dei dati fiscali al momento dell'emissione
  cliente      jsonb not null,
  righe        jsonb not null,    -- descrizione, quantita, prezzo_cent (IVA inclusa), aliquota, prezzo_unitario (netto, 8 decimali), totale_netto_cent
  riepilogo    jsonb not null,    -- per aliquota: imponibile_cent, imposta_cent
  imponibile_cent int not null,
  imposta_cent    int not null,
  totale_cent     int not null check (totale_cent > 0),
  modalita     text check (modalita in ('MP01', 'MP08')),   -- contanti / carta, se il conto è stato pagato in un solo modo
  creato_da    uuid default auth.uid(),
  creato_at    timestamptz not null default now(),
  unique (locale_id, anno, numero)
);
create unique index fatture_una_per_conto on public.fatture (sessione_id) where sessione_id is not null;
alter table public.fatture enable row level security;
create policy fatture_select on public.fatture for select to authenticated using (public.puo(locale_id, 'cassa'));
revoke all on public.fatture from anon;
revoke insert, update, delete, truncate on public.fatture from authenticated;

create or replace function public.emetti_fattura(p_locale uuid, p_cliente jsonb, p_sessione uuid default null, p_righe jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_df public.dati_fiscali; v_ses public.sessioni_tavolo; v_righe jsonb := '[]'::jsonb; v_r jsonb; v_cli jsonb;
  v_den text; v_nome text; v_cogn text; v_piva text; v_cf text; v_ind text; v_cap text; v_com text; v_prov text; v_naz text; v_cod text; v_pec text;
  v_anno int := extract(year from current_date)::int; v_num int; v_mod text; v_riep jsonb; v_imp int; v_iva int; v_id uuid;
  a record; v_lordo int; v_resto int; v_quota int; v_n int; v_i int := 0;
begin
  if not public.puo(p_locale, 'cassa') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  select * into v_df from public.dati_fiscali where locale_id = p_locale;
  if v_df.locale_id is null then raise exception 'Compila prima i dati fiscali del locale' using errcode = '22023'; end if;
  if jsonb_typeof(p_cliente) is distinct from 'object' then raise exception 'Dati del cliente mancanti' using errcode = '22023'; end if;

  -- Cliente (cessionario/committente): testi ripuliti, codici in maiuscolo
  v_den  := btrim(coalesce(p_cliente->>'denominazione', ''));
  v_nome := btrim(coalesce(p_cliente->>'nome', ''));
  v_cogn := btrim(coalesce(p_cliente->>'cognome', ''));
  v_piva := upper(regexp_replace(coalesce(p_cliente->>'partita_iva', ''), '\s', '', 'g'));
  v_cf   := upper(regexp_replace(coalesce(p_cliente->>'codice_fiscale', ''), '\s', '', 'g'));
  v_ind  := btrim(coalesce(p_cliente->>'indirizzo', ''));
  v_cap  := btrim(coalesce(p_cliente->>'cap', ''));
  v_com  := btrim(coalesce(p_cliente->>'comune', ''));
  v_prov := upper(btrim(coalesce(p_cliente->>'provincia', '')));
  v_naz  := upper(coalesce(nullif(btrim(p_cliente->>'nazione'), ''), 'IT'));
  v_cod  := upper(coalesce(nullif(btrim(p_cliente->>'codice_destinatario'), ''), '0000000'));
  v_pec  := lower(btrim(coalesce(p_cliente->>'pec', '')));
  if v_den = '' and (v_nome = '' or v_cogn = '') then
    raise exception 'Indica la ragione sociale oppure nome e cognome del cliente' using errcode = '22023';
  end if;
  if greatest(char_length(v_den), char_length(v_nome), char_length(v_cogn), char_length(v_ind), char_length(v_com)) > 80 then
    raise exception 'Testo del cliente troppo lungo (massimo 80 caratteri)' using errcode = '22023';
  end if;
  if v_naz <> 'IT' then raise exception 'Per ora si emettono fatture solo a clienti con sede in Italia' using errcode = '22023'; end if;
  if v_piva = '' and v_cf = '' then raise exception 'Serve la partita IVA o il codice fiscale del cliente' using errcode = '22023'; end if;
  if v_piva <> '' and not public.partita_iva_valida(v_piva) then raise exception 'Partita IVA del cliente non valida' using errcode = '22023'; end if;
  if v_cf <> '' and v_cf !~ '^([0-9]{11}|[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z])$' then
    raise exception 'Codice fiscale del cliente non valido' using errcode = '22023';
  end if;
  if v_ind = '' or v_com = '' or v_cap !~ '^[0-9]{5}$' then
    raise exception 'Indirizzo, CAP (5 cifre) e comune del cliente sono obbligatori' using errcode = '22023';
  end if;
  if v_prov !~ '^([A-Z]{2})?$' then raise exception 'Provincia: sigla di due lettere' using errcode = '22023'; end if;
  if v_cod !~ '^[A-Z0-9]{7}$' then raise exception 'Codice destinatario: 7 lettere o cifre (0000000 se non c''è)' using errcode = '22023'; end if;
  if v_pec <> '' and (char_length(v_pec) > 100 or v_pec !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$') then
    raise exception 'Indirizzo PEC non valido' using errcode = '22023';
  end if;
  if v_den <> '' then v_nome := ''; v_cogn := ''; end if;
  v_cli := jsonb_build_object('denominazione', v_den, 'nome', v_nome, 'cognome', v_cogn, 'partita_iva', v_piva, 'codice_fiscale', v_cf,
                              'indirizzo', v_ind, 'cap', v_cap, 'comune', v_com, 'provincia', v_prov, 'nazione', v_naz,
                              'codice_destinatario', v_cod, 'pec', v_pec);

  if p_sessione is not null then
    -- Dal conto di un tavolo chiuso: righe uguali raggruppate, aliquota del prodotto, sconto ripartito per aliquota
    select * into v_ses from public.sessioni_tavolo where id = p_sessione and locale_id = p_locale;
    if v_ses.id is null then raise exception 'Conto non trovato' using errcode = '22023'; end if;
    if v_ses.chiusa_at is null then raise exception 'Chiudi il tavolo prima di emettere la fattura' using errcode = '22023'; end if;
    if exists (select 1 from public.fatture where sessione_id = p_sessione) then
      raise exception 'Per questo conto è già stata emessa una fattura' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('descrizione', d, 'quantita', q, 'prezzo_cent', p, 'aliquota', al) order by d, p), '[]'::jsonb) into v_righe
    from (select left(r.nome || coalesce(' (' || (select string_agg(x->>'nome', ', ') from jsonb_array_elements(r.opzioni) x) || ')', ''), 200) as d,
                 sum(r.quantita)::int as q, r.prezzo_cent as p, coalesce(pr.aliquota_iva, 10)::numeric as al
            from public.ordini o join public.righe_ordine r on r.ordine_id = o.id left join public.prodotti pr on pr.id = r.prodotto_id
           where o.sessione_id = p_sessione and o.stato not in ('rifiutato', 'annullato') and r.prezzo_cent > 0
           group by 1, 3, 4) x;
    if v_ses.sconto_cent > 0 and jsonb_array_length(v_righe) > 0 then
      select sum(t.quantita * t.prezzo_cent)::int, count(distinct t.aliquota) into v_lordo, v_n
        from jsonb_to_recordset(v_righe) as t(quantita int, prezzo_cent int, aliquota numeric);
      v_resto := least(v_ses.sconto_cent, v_lordo);
      for a in select t.aliquota, sum(t.quantita * t.prezzo_cent)::int as lordo
                 from jsonb_to_recordset(v_righe) as t(quantita int, prezzo_cent int, aliquota numeric) group by t.aliquota order by t.aliquota loop
        v_i := v_i + 1;
        v_quota := case when v_i = v_n then v_resto else least(v_resto, round(v_ses.sconto_cent::numeric * a.lordo / v_lordo)::int) end;
        v_resto := v_resto - v_quota;
        if v_quota > 0 then
          v_righe := v_righe || jsonb_build_object('descrizione', 'Sconto', 'quantita', 1, 'prezzo_cent', -v_quota, 'aliquota', a.aliquota);
        end if;
      end loop;
    end if;
    select case min(metodo) when 'contanti' then 'MP01' when 'carta' then 'MP08' end into v_mod
      from public.pagamenti where sessione_id = p_sessione and stato = 'approvato' having count(distinct metodo) = 1;
  else
    -- Righe scritte a mano
    if jsonb_typeof(p_righe) is distinct from 'array' or jsonb_array_length(p_righe) not between 1 and 100 then
      raise exception 'La fattura deve avere da 1 a 100 righe' using errcode = '22023';
    end if;
    for v_r in select * from jsonb_array_elements(p_righe) loop
      if btrim(coalesce(v_r->>'descrizione', '')) = '' or char_length(v_r->>'descrizione') > 200
         or coalesce(v_r->>'quantita', '') !~ '^[1-9][0-9]{0,2}$'
         or coalesce(v_r->>'prezzo_cent', '') !~ '^[0-9]{1,8}$' or (v_r->>'prezzo_cent')::int = 0
         or coalesce(v_r->>'aliquota', '') not in ('4', '5', '10', '22') then
        raise exception 'Riga non valida: descrizione, quantità (1-999), prezzo IVA inclusa e aliquota (4, 5, 10 o 22)' using errcode = '22023';
      end if;
      v_righe := v_righe || jsonb_build_object('descrizione', btrim(v_r->>'descrizione'), 'quantita', (v_r->>'quantita')::int,
                                               'prezzo_cent', (v_r->>'prezzo_cent')::int, 'aliquota', (v_r->>'aliquota')::numeric);
    end loop;
  end if;
  if jsonb_array_length(v_righe) = 0 then raise exception 'Il conto non ha importi da fatturare' using errcode = '22023'; end if;

  -- Scorporo IVA riga per riga (prezzo unitario netto con 8 decimali), poi riepilogo per aliquota
  select jsonb_agg(r || jsonb_build_object(
           'prezzo_unitario', round((r->>'prezzo_cent')::numeric / 100 / (1 + (r->>'aliquota')::numeric / 100), 8)::text,
           'totale_netto_cent', round((r->>'quantita')::numeric * (r->>'prezzo_cent')::numeric / (1 + (r->>'aliquota')::numeric / 100))::int)
         order by n)
    into v_righe from jsonb_array_elements(v_righe) with ordinality as e(r, n);
  select jsonb_agg(jsonb_build_object('aliquota', al, 'imponibile_cent', imp, 'imposta_cent', round(imp * al / 100)::int) order by al),
         sum(imp)::int, sum(round(imp * al / 100))::int
    into v_riep, v_imp, v_iva
    from (select (r->>'aliquota')::numeric as al, sum((r->>'totale_netto_cent')::int) as imp from jsonb_array_elements(v_righe) r group by 1) x;
  if v_imp + v_iva <= 0 then raise exception 'Il totale della fattura deve essere maggiore di zero' using errcode = '22023'; end if;

  -- Numerazione progressiva per anno, senza buchi né doppioni
  perform pg_advisory_xact_lock(hashtext('fatture:' || p_locale::text || ':' || v_anno));
  select coalesce(max(numero), 0) + 1 into v_num from public.fatture where locale_id = p_locale and anno = v_anno;
  insert into public.fatture (locale_id, anno, numero, sessione_id, cedente, cliente, righe, riepilogo, imponibile_cent, imposta_cent, totale_cent, modalita)
  values (p_locale, v_anno, v_num, p_sessione, to_jsonb(v_df) - 'locale_id' - 'updated_at', v_cli, v_righe, v_riep, v_imp, v_iva, v_imp + v_iva, v_mod)
  returning id into v_id;
  return (select to_jsonb(f) from public.fatture f where f.id = v_id);
end $$;

-- ============================================================ Permessi
revoke execute on function public.stato_conto(uuid), public.sessione_da_incassare(uuid), public.imposta_sconto(uuid, int, numeric),
  public.registra_pagamento(uuid, text, int, numeric, int, text, uuid), public.esito_pos(uuid, boolean, text), public.annulla_pagamento(uuid),
  public.chiudi_tavolo(uuid, text), public.resoconto_cassa(uuid), public.partita_iva_valida(text),
  public.emetti_fattura(uuid, jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.stato_conto(uuid), public.imposta_sconto(uuid, int, numeric),
  public.registra_pagamento(uuid, text, int, numeric, int, text, uuid), public.esito_pos(uuid, boolean, text), public.annulla_pagamento(uuid),
  public.chiudi_tavolo(uuid, text), public.resoconto_cassa(uuid), public.emetti_fattura(uuid, jsonb, uuid, jsonb) to authenticated;
-- Serve a chi scrive i dati fiscali: il vincolo della tabella la richiama con i permessi dell'utente
grant execute on function public.partita_iva_valida(text) to authenticated;
