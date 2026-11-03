-- Reparti con stampanti, magazzino collegato alle vendite, resoconto e chiusura di cassa (solo amministratore).

-- ============================================================ Stampanti e reparti
create table public.stampanti (
  id         uuid primary key default gen_random_uuid(),
  locale_id  uuid not null references public.locali (id) on delete cascade,
  nome       text not null check (char_length(nome) between 1 and 40),
  indirizzo  text not null check (indirizzo ~ '^(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])){3}$'),  -- IP nella rete del locale
  porta      int  not null default 9100 check (porta between 1 and 65535),
  colonne    int  not null default 48 check (colonne in (32, 42, 48)),   -- 58 mm = 32, 80 mm = 42/48
  attiva     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, locale_id)
);

create table public.reparti (
  id           uuid primary key default gen_random_uuid(),
  locale_id    uuid not null references public.locali (id) on delete cascade,
  nome         text not null check (char_length(nome) between 1 and 40),
  stampante_id uuid,
  copie        int  not null default 1 check (copie between 1 and 3),
  posizione    int  not null default 0,
  created_at   timestamptz not null default now(),
  unique (id, locale_id),
  unique (locale_id, nome),
  foreign key (stampante_id, locale_id) references public.stampanti (id, locale_id) on delete set null (stampante_id)
);

alter table public.categorie add column reparto_id uuid,
  add foreign key (reparto_id, locale_id) references public.reparti (id, locale_id) on delete set null (reparto_id);
alter table public.prodotti add column reparto_id uuid,   -- facoltativo: prevale sul reparto della categoria
  add foreign key (reparto_id, locale_id) references public.reparti (id, locale_id) on delete set null (reparto_id);
alter table public.righe_ordine add column reparto_id uuid,
  add foreign key (reparto_id, locale_id) references public.reparti (id, locale_id) on delete set null (reparto_id);

-- Coda di stampa: un biglietto per reparto e ordine, preso in carico dal servizio di stampa del server
create table public.comande_stampa (
  id           uuid primary key default gen_random_uuid(),
  locale_id    uuid not null references public.locali (id) on delete cascade,
  ordine_id    uuid references public.ordini (id) on delete cascade,
  reparto_id   uuid,
  stampante_id uuid not null,
  tipo         text not null default 'comanda' check (tipo in ('comanda', 'annullo', 'prova')),
  stato        text not null default 'da_stampare' check (stato in ('da_stampare', 'stampata', 'errore')),
  tentativi    int  not null default 0,
  errore       text not null default '',
  creata_at    timestamptz not null default now(),
  stampata_at  timestamptz,
  foreign key (stampante_id, locale_id) references public.stampanti (id, locale_id) on delete cascade,
  foreign key (reparto_id, locale_id) references public.reparti (id, locale_id) on delete set null (reparto_id)
);
create index on public.comande_stampa (stato, creata_at);
create index on public.comande_stampa (ordine_id);

create or replace function public.accoda_stampa(p_ordine uuid, p_tipo text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Un biglietto per reparto (ripetuto per il numero di copie del reparto)
  insert into public.comande_stampa (locale_id, ordine_id, reparto_id, stampante_id, tipo)
  select x.locale_id, x.ordine_id, x.reparto_id, x.stampante_id, p_tipo
  from (select distinct o.locale_id, o.id as ordine_id, rp.id as reparto_id, rp.stampante_id, rp.copie
        from public.ordini o join public.righe_ordine r on r.ordine_id = o.id
        join public.reparti rp on rp.id = r.reparto_id
        join public.stampanti s on s.id = rp.stampante_id and s.attiva
        where o.id = p_ordine) x
  cross join generate_series(1, x.copie);
end $$;

create or replace function public.stampa_prova(p_stampante uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_locale uuid;
begin
  select locale_id into v_locale from public.stampanti where id = p_stampante;
  if v_locale is null or not public.puo(v_locale, 'reparti') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  insert into public.comande_stampa (locale_id, stampante_id, tipo) values (v_locale, p_stampante, 'prova');
end $$;

create or replace function public.ristampa_comanda(p_comanda uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.comande_stampa;
begin
  select * into v from public.comande_stampa where id = p_comanda;
  if v.id is null or not public.puo(v.locale_id, 'sala.comanda') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  insert into public.comande_stampa (locale_id, ordine_id, reparto_id, stampante_id, tipo)
  values (v.locale_id, v.ordine_id, v.reparto_id, v.stampante_id, v.tipo);
end $$;

-- ============================================================ Magazzino
alter table public.prodotti add column esaurito_magazzino boolean not null default false;   -- esaurito messo dal magazzino

create table public.articoli (
  id              uuid primary key default gen_random_uuid(),
  locale_id       uuid not null references public.locali (id) on delete cascade,
  nome            text not null check (char_length(nome) between 1 and 80),
  unita           text not null default 'pz' check (unita in ('pz', 'kg', 'g', 'l', 'ml', 'bottiglia')),
  giacenza        numeric(12,3) not null default 0,
  scorta_minima   numeric(12,3) not null default 0 check (scorta_minima >= 0),
  costo_cent      int check (costo_cent >= 0),
  blocca_esauriti boolean not null default false,   -- a giacenza zero, i piatti collegati diventano esauriti
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, locale_id),
  unique (locale_id, nome)
);

-- Quanto di ogni articolo consuma una vendita del prodotto (es. Calice rosso → 0,15 l di Aglianico)
create table public.componenti (
  prodotto_id uuid not null,
  articolo_id uuid not null,
  locale_id   uuid not null,
  quantita    numeric(12,3) not null check (quantita > 0),
  primary key (prodotto_id, articolo_id),
  foreign key (prodotto_id, locale_id) references public.prodotti (id, locale_id) on delete cascade,
  foreign key (articolo_id, locale_id) references public.articoli (id, locale_id) on delete cascade
);

create table public.movimenti (
  id          uuid primary key default gen_random_uuid(),
  locale_id   uuid not null,
  articolo_id uuid not null,
  tipo        text not null check (tipo in ('carico', 'vendita', 'storno', 'rettifica')),
  quantita    numeric(12,3) not null check (quantita <> 0),   -- con segno: + entra, − esce
  ordine_id   uuid references public.ordini (id) on delete set null,
  nota        text not null default '' check (char_length(nota) <= 120),
  creato_at   timestamptz not null default now(),
  creato_da   uuid default auth.uid(),
  foreign key (articolo_id, locale_id) references public.articoli (id, locale_id) on delete cascade
);
create index on public.movimenti (articolo_id, creato_at desc);
create index on public.movimenti (ordine_id);

create trigger articoli_updated_at before update on public.articoli for each row execute function public.set_updated_at();

-- La giacenza cambia solo tramite movimenti; gli esauriti seguono il magazzino
create or replace function public.applica_movimento()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v public.articoli;
begin
  update public.articoli set giacenza = giacenza + new.quantita where id = new.articolo_id returning * into v;
  if v.blocca_esauriti and v.giacenza <= 0 then
    update public.prodotti p set disponibile = false, esaurito_magazzino = true
     where p.disponibile and exists (select 1 from public.componenti c where c.prodotto_id = p.id and c.articolo_id = v.id);
  elsif v.giacenza > 0 then
    -- Torna disponibile solo ciò che il magazzino aveva esaurito, e solo se tutti i suoi articoli bloccanti ci sono
    update public.prodotti p set disponibile = true, esaurito_magazzino = false
     where p.esaurito_magazzino and exists (select 1 from public.componenti c where c.prodotto_id = p.id and c.articolo_id = v.id)
       and not exists (select 1 from public.componenti c join public.articoli a on a.id = c.articolo_id
                       where c.prodotto_id = p.id and a.blocca_esauriti and a.giacenza <= 0);
  end if;
  return new;
end $$;
create trigger movimenti_applica after insert on public.movimenti for each row execute function public.applica_movimento();
create trigger movimenti_audit after insert on public.movimenti for each row execute function public.scrivi_audit();
create trigger articoli_audit after insert or update or delete on public.articoli for each row execute function public.scrivi_audit();

create or replace function public.carico_magazzino(p_articolo uuid, p_quantita numeric, p_nota text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v_locale uuid;
begin
  select locale_id into v_locale from public.articoli where id = p_articolo;
  if v_locale is null or not public.puo(v_locale, 'magazzino') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if coalesce(p_quantita, 0) <= 0 then raise exception 'Quantità non valida' using errcode = '22023'; end if;
  insert into public.movimenti (locale_id, articolo_id, tipo, quantita, nota) values (v_locale, p_articolo, 'carico', p_quantita, left(coalesce(p_nota, ''), 120));
end $$;

-- Inventario: si indica la quantità contata, il movimento registra la differenza
create or replace function public.rettifica_magazzino(p_articolo uuid, p_contata numeric, p_nota text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v public.articoli;
begin
  select * into v from public.articoli where id = p_articolo for update;
  if v.id is null or not public.puo(v.locale_id, 'magazzino') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  if p_contata is null or p_contata < 0 then raise exception 'Quantità non valida' using errcode = '22023'; end if;
  if p_contata <> v.giacenza then
    insert into public.movimenti (locale_id, articolo_id, tipo, quantita, nota)
    values (v.locale_id, v.id, 'rettifica', p_contata - v.giacenza, left(coalesce(p_nota, 'Inventario'), 120));
  end if;
end $$;

-- ============================================================ Effetti di un ordine confermato / annullato
create or replace function public.ordine_confermato(p_ordine uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.movimenti where ordine_id = p_ordine and tipo = 'vendita') then return; end if;   -- una sola volta
  insert into public.movimenti (locale_id, articolo_id, tipo, quantita, ordine_id, nota)
  select r.locale_id, c.articolo_id, 'vendita', -sum(c.quantita * r.quantita), p_ordine, 'Vendita'
  from public.righe_ordine r join public.componenti c on c.prodotto_id = r.prodotto_id
  where r.ordine_id = p_ordine group by r.locale_id, c.articolo_id;
  perform public.accoda_stampa(p_ordine, 'comanda');
end $$;

create or replace function public.ordine_annullato(p_ordine uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.movimenti (locale_id, articolo_id, tipo, quantita, ordine_id, nota)
  select locale_id, articolo_id, 'storno', -sum(quantita), p_ordine, 'Ordine annullato'
  from public.movimenti where ordine_id = p_ordine and tipo in ('vendita', 'storno')
  group by locale_id, articolo_id having sum(quantita) <> 0;
  -- Il biglietto di annullo va solo ai reparti che avevano già ricevuto la comanda
  if exists (select 1 from public.comande_stampa where ordine_id = p_ordine and tipo = 'comanda') then
    perform public.accoda_stampa(p_ordine, 'annullo');
  end if;
end $$;

-- Gli ordini nati già confermati (con codice, dalla sala, da richiesta accettata) passano da qui
create or replace function public.crea_ordine_interno(p_locale uuid, p_sessione uuid, p_tavolo uuid, p_righe jsonb,
                                                     p_nota text, p_origine text, p_stato text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ord uuid; r jsonb; v_prod public.prodotti; v_q int; v_rep uuid;
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
    select coalesce(v_prod.reparto_id, c.reparto_id) into v_rep from public.categorie c where c.id = v_prod.categoria_id;
    insert into public.righe_ordine (ordine_id, locale_id, prodotto_id, nome, prezzo_cent, quantita, nota, reparto_id)
    values (v_ord, p_locale, v_prod.id, v_prod.nome, v_prod.prezzo_cent, v_q, left(coalesce(r->>'nota', ''), 120), v_rep);
  end loop;
  if p_stato = 'confermato' then perform public.ordine_confermato(v_ord); end if;
  return v_ord;
end $$;

-- ============================================================ Cassa: resoconto e chiusura (solo amministratore)
create table public.chiusure_cassa (
  id         uuid primary key default gen_random_uuid(),
  locale_id  uuid not null references public.locali (id) on delete cascade,
  numero     int  not null,
  dal        timestamptz not null,
  al         timestamptz not null,
  riepilogo  jsonb not null,
  creato_da  uuid default auth.uid(),
  creato_at  timestamptz not null default now(),
  unique (locale_id, numero)
);
create trigger chiusure_audit after insert on public.chiusure_cassa for each row execute function public.scrivi_audit();

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
      select r.*, o.stato from public.ordini o join public.righe_ordine r on r.ordine_id = o.id where o.sessione_id in (select id from conti))
    select jsonb_build_object(
      'dal', case when v_dal = '-infinity' then null else v_dal end, 'al', v_al,
      'conti', (select count(*) from conti),
      'coperti', (select coalesce(sum(coperti), 0) from conti),
      'totale_cent', (select coalesce(sum(totale_cent), 0) from conti),
      'per_pagamento', (select coalesce(jsonb_object_agg(coalesce(pagamento, 'non indicato'), t), '{}') from
                          (select pagamento, sum(totale_cent) t from conti group by pagamento) x),
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

create or replace function public.chiudi_cassa(p_locale uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_num int;
begin
  if not public.puo(p_locale, 'cassa') then raise exception 'Permesso negato' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('cassa:' || p_locale::text));   -- due chiusure contemporanee non si sovrappongono
  v := public.resoconto_cassa(p_locale);
  if (v->>'tavoli_aperti')::int > 0 then raise exception 'Ci sono ancora tavoli aperti: chiudili prima della cassa' using errcode = '22023'; end if;
  select coalesce(max(numero), 0) + 1 into v_num from public.chiusure_cassa where locale_id = p_locale;
  insert into public.chiusure_cassa (locale_id, numero, dal, al, riepilogo)
  values (p_locale, v_num, coalesce((v->>'dal')::timestamptz, (v->>'al')::timestamptz), (v->>'al')::timestamptz, v || jsonb_build_object('numero', v_num));
  return v || jsonb_build_object('numero', v_num);
end $$;

-- ============================================================ Accessi
alter table public.stampanti      enable row level security;
alter table public.reparti        enable row level security;
alter table public.comande_stampa enable row level security;
alter table public.articoli       enable row level security;
alter table public.componenti     enable row level security;
alter table public.movimenti      enable row level security;
alter table public.chiusure_cassa enable row level security;

create policy stampanti_select on public.stampanti for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
create policy stampanti_write  on public.stampanti for all to authenticated using (public.puo(locale_id, 'reparti')) with check (public.puo(locale_id, 'reparti'));
create policy reparti_select   on public.reparti for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
create policy reparti_write    on public.reparti for all to authenticated using (public.puo(locale_id, 'reparti')) with check (public.puo(locale_id, 'reparti'));
create policy comande_select   on public.comande_stampa for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
create policy articoli_select  on public.articoli for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
create policy articoli_write   on public.articoli for all to authenticated using (public.puo(locale_id, 'magazzino')) with check (public.puo(locale_id, 'magazzino'));
create policy componenti_select on public.componenti for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
create policy componenti_write  on public.componenti for all to authenticated using (public.puo(locale_id, 'magazzino')) with check (public.puo(locale_id, 'magazzino'));
create policy movimenti_select on public.movimenti for select to authenticated using (public.puo(locale_id, 'magazzino'));
create policy chiusure_select  on public.chiusure_cassa for select to authenticated using (public.puo(locale_id, 'cassa'));

revoke all on public.stampanti, public.reparti, public.comande_stampa, public.articoli, public.componenti, public.movimenti, public.chiusure_cassa from anon;
revoke insert, update, delete on public.comande_stampa, public.movimenti, public.chiusure_cassa from authenticated;
-- La giacenza non si scrive a mano: solo i movimenti la cambiano
revoke insert, update on public.articoli from authenticated;
grant insert (id, locale_id, nome, unita, scorta_minima, costo_cent, blocca_esauriti) on public.articoli to authenticated;
grant update (nome, unita, scorta_minima, costo_cent, blocca_esauriti) on public.articoli to authenticated;

-- Funzioni: tutte chiuse al pubblico; allo staff solo quelle con il proprio controllo di capacità
revoke execute on function
  public.livello_ruolo(public.ruolo), public.puo(uuid, text), public.totale_sessione(uuid),
  public.apri_tavolo(uuid, int), public.chiudi_tavolo(uuid, text), public.decidi_ordine(uuid, boolean, text), public.avanza_ordine(uuid, text),
  public.annulla_ordine(uuid, text), public.accetta_richiesta(uuid, int), public.rifiuta_richiesta(uuid, text), public.ordine_sala(uuid, jsonb, text),
  public.gestisci_conto(uuid), public.imposta_disponibilita(uuid, boolean),
  public.email_accesso(text), public.controlla_gestione(uuid, uuid, public.ruolo), public.crea_utente(uuid, text, text, text, public.ruolo),
  public.elenco_utenti(uuid), public.modifica_ruolo_utente(uuid, uuid, public.ruolo), public.reimposta_password_utente(uuid, uuid, text),
  public.imposta_attivo_utente(uuid, uuid, boolean), public.rimuovi_utente(uuid, uuid), public.chiudi_sessioni_utente(uuid),
  public.inserisci_utente_auth(jsonb), public.blocca_accesso(uuid, boolean),
  public.accoda_stampa(uuid, text), public.stampa_prova(uuid), public.ristampa_comanda(uuid),
  public.applica_movimento(), public.carico_magazzino(uuid, numeric, text), public.rettifica_magazzino(uuid, numeric, text),
  public.ordine_confermato(uuid), public.ordine_annullato(uuid), public.crea_ordine_interno(uuid, uuid, uuid, jsonb, text, text, text),
  public.resoconto_cassa(uuid), public.chiudi_cassa(uuid)
from public, anon, authenticated;
grant execute on function
  public.puo(uuid, text), public.apri_tavolo(uuid, int), public.chiudi_tavolo(uuid, text), public.decidi_ordine(uuid, boolean, text),
  public.avanza_ordine(uuid, text), public.annulla_ordine(uuid, text), public.accetta_richiesta(uuid, int), public.rifiuta_richiesta(uuid, text),
  public.ordine_sala(uuid, jsonb, text), public.gestisci_conto(uuid), public.imposta_disponibilita(uuid, boolean),
  public.crea_utente(uuid, text, text, text, public.ruolo), public.elenco_utenti(uuid), public.modifica_ruolo_utente(uuid, uuid, public.ruolo),
  public.reimposta_password_utente(uuid, uuid, text), public.imposta_attivo_utente(uuid, uuid, boolean), public.rimuovi_utente(uuid, uuid),
  public.stampa_prova(uuid), public.ristampa_comanda(uuid), public.carico_magazzino(uuid, numeric, text), public.rettifica_magazzino(uuid, numeric, text),
  public.resoconto_cassa(uuid), public.chiudi_cassa(uuid)
to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.comande_stampa, public.articoli;
  end if;
end $$;
