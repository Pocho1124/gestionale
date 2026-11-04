-- Enciclopedia dei vini: base curata (vitigni e denominazioni), dataset X-Wines (importato a parte, CC0)
-- e vini aggiunti dal locale. Il bot e il quiz attingono da qui: l'IA cerca, non inventa.

create extension if not exists pg_trgm with schema extensions;

-- Chiave di ricerca: minuscole, senza accenti né punteggiatura (funzione immutabile, usata nelle colonne calcolate)
create or replace function public.chiave_ricerca(p text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(translate(lower(coalesce(p, '')), 'àáâãäåèéêëìíîïòóôõöùúûüçñ''’', 'aaaaaaeeeeiiiiooooouuuucn  '), '[^a-z0-9]+', ' ', 'g'));
$$;

-- Tutte le chiavi di un vino: nome e nomi alternativi (separati da virgole)
create or replace function public.chiavi_vino(p_nome text, p_alias text)
returns text[] language sql immutable parallel safe set search_path = '' as $$
  select array_remove(array[public.chiave_ricerca(p_nome)]
         || coalesce((select array_agg(public.chiave_ricerca(x)) from unnest(string_to_array(coalesce(p_alias, ''), ',')) x), '{}'), '');
$$;

-- Tutte le sequenze di parole consecutive di un testo (fino a 6 parole): «falanghina del sannio mastroberardino» →
-- «falanghina», «falanghina del», «falanghina del sannio», … Servono a trovare con l'indice i nomi contenuti nel testo.
create or replace function public.sequenze_parole(p text)
returns text[] language sql immutable parallel safe set search_path = '' as $$
  with p as (select string_to_array(public.chiave_ricerca(p), ' ') as w)
  select coalesce(array_agg(distinct array_to_string(w[i:i + l - 1], ' ')), '{}')
  from p, generate_series(1, coalesce(array_length(w, 1), 0)) i, generate_series(1, 6) l
  where i + l - 1 <= array_length(w, 1);
$$;

create table public.enciclopedia_vini (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (char_length(nome) between 2 and 160),
  alias         text not null default '' check (char_length(alias) <= 400),      -- altri nomi, separati da virgole
  cantina       text not null default '' check (char_length(cantina) <= 160),
  tipo          text not null check (tipo in ('rosso', 'bianco', 'rosato', 'bollicine', 'dolce')),
  corpo         text not null check (corpo in ('leggero', 'medio', 'strutturato')),
  regione       text not null default '' check (char_length(regione) <= 120),
  paese         text not null default '' check (char_length(paese) <= 60),
  vitigno       text not null default '' check (char_length(vitigno) <= 200),
  abbinamenti   text not null default '' check (char_length(abbinamenti) <= 300), -- cibi consigliati
  fonte         text not null check (fonte in ('base', 'xwines', 'locale')),
  riferimento   text,                                                             -- es. WineID di X-Wines
  locale_id     uuid references public.locali (id) on delete cascade,             -- solo per le voci aggiunte dal locale
  creato_da     uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  chiave        text generated always as (public.chiave_ricerca(nome)) stored,
  testo_ricerca text generated always as (public.chiave_ricerca(nome || ' ' || cantina || ' ' || alias)) stored,
  chiavi        text[] generated always as (public.chiavi_vino(nome, alias)) stored,
  check ((fonte = 'locale') = (locale_id is not null))
);
create index enciclopedia_trgm on public.enciclopedia_vini using gin (testo_ricerca extensions.gin_trgm_ops);
create index enciclopedia_chiavi on public.enciclopedia_vini using gin (chiavi);
create index on public.enciclopedia_vini (fonte);
-- Audit solo delle voci del locale (le importazioni massive non intasano il registro)
create trigger enciclopedia_audit_scrittura after insert or update on public.enciclopedia_vini
  for each row when (new.fonte = 'locale') execute function public.scrivi_audit();
create trigger enciclopedia_audit_eliminazione after delete on public.enciclopedia_vini
  for each row when (old.fonte = 'locale') execute function public.scrivi_audit();

-- Capacità «catalogo» (menu ed enciclopedia): amministratore e responsabile
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
    when 'cassa'           then array['owner']
    else array[]::text[] end), false);
$$;

alter table public.enciclopedia_vini enable row level security;
-- Lettura per tutto il personale; le voci base e X-Wines non si modificano, quelle del locale solo da chi gestisce il menu
create policy enciclopedia_select on public.enciclopedia_vini for select to authenticated using (locale_id is null or public.ruolo_in_locale(locale_id) is not null);
create policy enciclopedia_write on public.enciclopedia_vini for all to authenticated
  using (fonte = 'locale' and public.puo(locale_id, 'catalogo'))
  with check (fonte = 'locale' and public.puo(locale_id, 'catalogo'));
revoke all on public.enciclopedia_vini from anon;
revoke insert, update on public.enciclopedia_vini from authenticated;
grant insert (nome, alias, cantina, tipo, corpo, regione, paese, vitigno, abbinamenti, fonte, locale_id) on public.enciclopedia_vini to authenticated;
grant update (nome, alias, cantina, tipo, corpo, regione, paese, vitigno, abbinamenti) on public.enciclopedia_vini to authenticated;

/**
 * Ricerca nell'enciclopedia: prima i nomi contenuti per intero nel testo (dal più specifico), poi per somiglianza
 * (tollera errori di battitura). A parità: voci del locale, poi base curata, poi X-Wines.
 */
create or replace function public.cerca_vino(p_testo text, p_limite int default 10)
returns table (id uuid, nome text, cantina text, tipo text, corpo text, regione text, paese text, vitigno text, abbinamenti text,
               fonte text, contenuto boolean, punteggio real)
language sql stable security definer set search_path = '' as $$
  with q as (select public.chiave_ricerca(p_testo) as nudo, public.sequenze_parole(p_testo) as seq),
  -- 1) nome (o nome alternativo) contenuto per intero nel testo: ricerca con l'indice sulle chiavi
  esatti as (
    select v.*, (select max(char_length(k)) from unnest(v.chiavi) k where k = any (q.seq)) as lunghezza
    from public.enciclopedia_vini v, q where char_length(q.nudo) >= 3 and v.chiavi && q.seq
      and (v.locale_id is null or public.ruolo_in_locale(v.locale_id) is not null)),
  -- 2) somiglianza (errori di battitura): ricerca con l'indice a trigrammi
  simili as (
    select v.*, 0 as lunghezza from public.enciclopedia_vini v, q
    where char_length(q.nudo) >= 3 and q.nudo operator(extensions.<%) v.testo_ricerca and not (v.chiavi && q.seq)
      and (v.locale_id is null or public.ruolo_in_locale(v.locale_id) is not null)
    order by extensions.word_similarity(q.nudo, v.testo_ricerca) desc limit 50),
  tutti as (select * from esatti union all select * from simili)
  select t.id, t.nome, t.cantina, t.tipo, t.corpo, t.regione, t.paese, t.vitigno, t.abbinamenti, t.fonte,
         t.lunghezza > 0 as contenuto, extensions.word_similarity(q.nudo, t.testo_ricerca) as punteggio
  from tutti t, q
  order by contenuto desc, t.lunghezza desc, case t.fonte when 'locale' then 0 when 'base' then 1 else 2 end, punteggio desc
  limit least(greatest(coalesce(p_limite, 10), 1), 50);
$$;

revoke execute on function public.cerca_vino(text, int), public.chiave_ricerca(text), public.chiavi_vino(text, text), public.sequenze_parole(text) from public, anon;
grant execute on function public.cerca_vino(text, int), public.chiave_ricerca(text), public.chiavi_vino(text, text), public.sequenze_parole(text) to authenticated;

-- Base curata (vitigni e denominazioni principali)
insert into public.enciclopedia_vini (nome, alias, tipo, corpo, regione, paese, vitigno, fonte) values
  ('Gragnano', 'lettere', 'rosso', 'leggero', 'Campania', 'Italia', 'Piedirosso, Aglianico, Sciascinoso', 'base'),
  ('Taurasi', '', 'rosso', 'strutturato', 'Campania', 'Italia', 'Aglianico', 'base'),
  ('Aglianico del Vulture', 'vulture', 'rosso', 'strutturato', 'Basilicata', 'Italia', 'Aglianico', 'base'),
  ('Aglianico', '', 'rosso', 'strutturato', 'Campania', 'Italia', 'Aglianico', 'base'),
  ('Piedirosso', 'per e palummo, pere palummo', 'rosso', 'leggero', 'Campania', 'Italia', 'Piedirosso', 'base'),
  ('Greco di Tufo', 'greco', 'bianco', 'medio', 'Campania', 'Italia', 'Greco', 'base'),
  ('Fiano', '', 'bianco', 'medio', 'Campania', 'Italia', 'Fiano', 'base'),
  ('Falanghina', '', 'bianco', 'leggero', 'Campania', 'Italia', 'Falanghina', 'base'),
  ('Coda di Volpe', '', 'bianco', 'medio', 'Campania', 'Italia', 'Coda di Volpe', 'base'),
  ('Asprinio', '', 'bianco', 'leggero', 'Campania', 'Italia', 'Asprinio', 'base'),
  ('Biancolella', 'forastera', 'bianco', 'leggero', 'Campania', 'Italia', 'Biancolella', 'base'),
  ('Pallagrello Bianco', '', 'bianco', 'medio', 'Campania', 'Italia', 'Pallagrello bianco', 'base'),
  ('Pallagrello Nero', 'casavecchia', 'rosso', 'strutturato', 'Campania', 'Italia', 'Pallagrello nero', 'base'),
  ('Primitivo', 'zinfandel', 'rosso', 'strutturato', 'Puglia', 'Italia', 'Primitivo', 'base'),
  ('Negroamaro', 'negro amaro, salice salentino', 'rosso', 'medio', 'Puglia', 'Italia', 'Negroamaro', 'base'),
  ('Susumaniello', '', 'rosso', 'medio', 'Puglia', 'Italia', 'Susumaniello', 'base'),
  ('Nero di Troia', '', 'rosso', 'strutturato', 'Puglia', 'Italia', 'Nero di Troia', 'base'),
  ('Cerasuolo di Vittoria', '', 'rosso', 'medio', 'Sicilia', 'Italia', 'Nero d''Avola, Frappato', 'base'),
  ('Nero d Avola', 'nero davola', 'rosso', 'medio', 'Sicilia', 'Italia', 'Nero d''Avola', 'base'),
  ('Nerello', 'etna rosso', 'rosso', 'medio', 'Sicilia', 'Italia', 'Nerello Mascalese', 'base'),
  ('Etna Bianco', 'carricante', 'bianco', 'medio', 'Sicilia', 'Italia', 'Carricante', 'base'),
  ('Frappato', '', 'rosso', 'leggero', 'Sicilia', 'Italia', 'Frappato', 'base'),
  ('Grillo', '', 'bianco', 'medio', 'Sicilia', 'Italia', 'Grillo', 'base'),
  ('Inzolia', 'insolia, catarratto', 'bianco', 'leggero', 'Sicilia', 'Italia', '', 'base'),
  ('Passito di Pantelleria', 'zibibbo', 'dolce', 'strutturato', 'Sicilia', 'Italia', 'Zibibbo', 'base'),
  ('Marsala', '', 'dolce', 'strutturato', 'Sicilia', 'Italia', '', 'base'),
  ('Cannonau', '', 'rosso', 'medio', 'Sardegna', 'Italia', 'Cannonau', 'base'),
  ('Carignano', '', 'rosso', 'medio', 'Sardegna', 'Italia', 'Carignano', 'base'),
  ('Vermentino', '', 'bianco', 'leggero', 'Sardegna', 'Italia', 'Vermentino', 'base'),
  ('Ciro', 'gaglioppo', 'rosso', 'medio', 'Calabria', 'Italia', 'Gaglioppo', 'base'),
  ('Tintilia', '', 'rosso', 'medio', 'Molise', 'Italia', 'Tintilia', 'base'),
  ('Cerasuolo d Abruzzo', 'cerasuolo', 'rosato', 'medio', 'Abruzzo', 'Italia', 'Montepulciano', 'base'),
  ('Vino Nobile', 'nobile di montepulciano', 'rosso', 'strutturato', 'Toscana', 'Italia', 'Sangiovese', 'base'),
  ('Montepulciano', '', 'rosso', 'medio', 'Abruzzo', 'Italia', 'Montepulciano', 'base'),
  ('Pecorino', '', 'bianco', 'medio', 'Abruzzo', 'Italia', 'Pecorino', 'base'),
  ('Trebbiano', '', 'bianco', 'leggero', 'Abruzzo', 'Italia', 'Trebbiano', 'base'),
  ('Passerina', '', 'bianco', 'leggero', 'Marche', 'Italia', 'Passerina', 'base'),
  ('Verdicchio', '', 'bianco', 'medio', 'Marche', 'Italia', 'Verdicchio', 'base'),
  ('Sagrantino', '', 'rosso', 'strutturato', 'Umbria', 'Italia', 'Sagrantino', 'base'),
  ('Brunello', '', 'rosso', 'strutturato', 'Toscana', 'Italia', 'Sangiovese', 'base'),
  ('Rosso di Montalcino', 'morellino, chianti, sangiovese', 'rosso', 'medio', 'Toscana', 'Italia', 'Sangiovese', 'base'),
  ('Bolgheri', 'supertuscan, super tuscan', 'rosso', 'strutturato', 'Toscana', 'Italia', '', 'base'),
  ('Vin Santo', 'vinsanto', 'dolce', 'strutturato', 'Toscana', 'Italia', '', 'base'),
  ('Vernaccia', '', 'bianco', 'medio', 'Toscana', 'Italia', 'Vernaccia', 'base'),
  ('Ciliegiolo', '', 'rosso', 'leggero', 'Toscana', 'Italia', 'Ciliegiolo', 'base'),
  ('Lambrusco', '', 'rosso', 'leggero', 'Emilia-Romagna', 'Italia', 'Lambrusco', 'base'),
  ('Gutturnio', 'bonarda', 'rosso', 'leggero', 'Emilia-Romagna', 'Italia', '', 'base'),
  ('Albana', '', 'bianco', 'medio', 'Emilia-Romagna', 'Italia', 'Albana', 'base'),
  ('Barolo', 'barbaresco', 'rosso', 'strutturato', 'Piemonte', 'Italia', 'Nebbiolo', 'base'),
  ('Nebbiolo', 'valtellina, sforzato', 'rosso', 'strutturato', 'Piemonte', 'Italia', 'Nebbiolo', 'base'),
  ('Barbera', '', 'rosso', 'medio', 'Piemonte', 'Italia', 'Barbera', 'base'),
  ('Dolcetto', 'grignolino, freisa', 'rosso', 'leggero', 'Piemonte', 'Italia', '', 'base'),
  ('Moscato d Asti', 'brachetto', 'dolce', 'leggero', 'Piemonte', 'Italia', '', 'base'),
  ('Gavi', 'cortese, arneis, roero, erbaluce', 'bianco', 'leggero', 'Piemonte', 'Italia', '', 'base'),
  ('Timorasso', '', 'bianco', 'medio', 'Piemonte', 'Italia', 'Timorasso', 'base'),
  ('Amarone', '', 'rosso', 'strutturato', 'Veneto', 'Italia', 'Corvina', 'base'),
  ('Ripasso', '', 'rosso', 'medio', 'Veneto', 'Italia', 'Corvina', 'base'),
  ('Valpolicella', 'bardolino, corvina', 'rosso', 'leggero', 'Veneto', 'Italia', 'Corvina', 'base'),
  ('Recioto', '', 'dolce', 'strutturato', 'Veneto', 'Italia', '', 'base'),
  ('Prosecco', 'glera', 'bollicine', 'leggero', 'Veneto', 'Italia', 'Glera', 'base'),
  ('Soave', 'garganega', 'bianco', 'leggero', 'Veneto', 'Italia', 'Garganega', 'base'),
  ('Lugana', 'turbiana', 'bianco', 'medio', 'Lombardia', 'Italia', 'Turbiana', 'base'),
  ('Franciacorta', 'trentodoc, trento doc, oltrepo pavese metodo classico', 'bollicine', 'medio', 'Lombardia', 'Italia', '', 'base'),
  ('Lagrein', '', 'rosso', 'medio', 'Alto Adige', 'Italia', 'Lagrein', 'base'),
  ('Schiava', 'vernatsch', 'rosso', 'leggero', 'Alto Adige', 'Italia', 'Schiava', 'base'),
  ('Teroldego', '', 'rosso', 'medio', 'Trentino', 'Italia', 'Teroldego', 'base'),
  ('Refosco', '', 'rosso', 'medio', 'Friuli', 'Italia', 'Refosco', 'base'),
  ('Gewurztraminer', 'gewuerztraminer, traminer', 'bianco', 'medio', 'Alto Adige', 'Italia', 'Gewürztraminer', 'base'),
  ('Muller Thurgau', 'mueller thurgau', 'bianco', 'leggero', 'Trentino', 'Italia', 'Müller-Thurgau', 'base'),
  ('Kerner', 'sylvaner', 'bianco', 'leggero', 'Alto Adige', 'Italia', '', 'base'),
  ('Ribolla', '', 'bianco', 'leggero', 'Friuli', 'Italia', 'Ribolla Gialla', 'base'),
  ('Friulano', '', 'bianco', 'medio', 'Friuli', 'Italia', 'Friulano', 'base'),
  ('Pinot Grigio', 'pinot gris', 'bianco', 'leggero', '', '', 'Pinot grigio', 'base'),
  ('Pinot Bianco', 'pinot blanc', 'bianco', 'leggero', '', '', 'Pinot bianco', 'base'),
  ('Pinot Nero', 'pinot noir', 'rosso', 'medio', '', '', 'Pinot nero', 'base'),
  ('Cabernet Sauvignon', '', 'rosso', 'strutturato', '', '', 'Cabernet Sauvignon', 'base'),
  ('Cabernet Franc', 'cabernet', 'rosso', 'medio', '', '', 'Cabernet Franc', 'base'),
  ('Merlot', '', 'rosso', 'medio', '', '', 'Merlot', 'base'),
  ('Syrah', 'shiraz', 'rosso', 'strutturato', '', '', 'Syrah', 'base'),
  ('Malbec', '', 'rosso', 'strutturato', '', '', 'Malbec', 'base'),
  ('Tempranillo', 'rioja', 'rosso', 'medio', '', 'Spagna', 'Tempranillo', 'base'),
  ('Sauvignon Blanc', 'sauvignon', 'bianco', 'leggero', '', '', 'Sauvignon', 'base'),
  ('Chardonnay', '', 'bianco', 'medio', '', '', 'Chardonnay', 'base'),
  ('Riesling', '', 'bianco', 'leggero', '', '', 'Riesling', 'base'),
  ('Viognier', '', 'bianco', 'medio', '', '', 'Viognier', 'base'),
  ('Champagne', '', 'bollicine', 'medio', '', 'Francia', '', 'base'),
  ('Cava', '', 'bollicine', 'leggero', '', 'Spagna', '', 'base'),
  ('Porto', 'port wine, sherry, madeira', 'dolce', 'strutturato', '', '', '', 'base'),
  ('Sauternes', 'tokaji, icewine', 'dolce', 'strutturato', '', '', '', 'base'),
  ('Moscato', 'malvasia', 'dolce', 'leggero', '', '', '', 'base'),
  ('Spumante', 'metodo classico, brut, pas dose, bollicin', 'bollicine', 'medio', '', '', '', 'base'),
  ('Rosato', 'rose, rosé', 'rosato', 'leggero', '', '', '', 'base');
