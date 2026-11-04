-- Descrizioni dei vini: acidità e gradazione (da X-Wines), profilo aromatico tipico dei principali vitigni (base curata).
alter table public.enciclopedia_vini
  add column acidita    text check (acidita in ('bassa', 'media', 'alta')),
  add column gradazione numeric(4,1) check (gradazione between 0 and 25),
  add column profilo    text not null default '' check (char_length(profilo) <= 200);
grant insert (acidita, gradazione, profilo) on public.enciclopedia_vini to authenticated;
grant update (acidita, gradazione, profilo) on public.enciclopedia_vini to authenticated;

-- Nomi con l'apostrofo nella base curata
update public.enciclopedia_vini set nome = 'Nero d''Avola' where fonte = 'base' and nome = 'Nero d Avola';
update public.enciclopedia_vini set nome = 'Cerasuolo d''Abruzzo' where fonte = 'base' and nome = 'Cerasuolo d Abruzzo';
update public.enciclopedia_vini set nome = 'Moscato d''Asti' where fonte = 'base' and nome = 'Moscato d Asti';

-- Profilo tipico dei vitigni e delle denominazioni principali (descrittori standard da degustazione)
update public.enciclopedia_vini set profilo = 'frutti rossi freschi e spuma vivace' where fonte = 'base' and nome = 'Gragnano';
update public.enciclopedia_vini set profilo = 'frutti rossi maturi, spezie, sottobosco e tannino deciso' where fonte = 'base' and nome = 'Taurasi';
update public.enciclopedia_vini set profilo = 'frutti neri, spezie e tannino deciso' where fonte = 'base' and nome = 'Aglianico del Vulture';
update public.enciclopedia_vini set profilo = 'frutti rossi maturi, spezie e tannino deciso' where fonte = 'base' and nome = 'Aglianico';
update public.enciclopedia_vini set profilo = 'piccoli frutti rossi, note floreali e speziate' where fonte = 'base' and nome = 'Piedirosso';
update public.enciclopedia_vini set profilo = 'pesca, agrumi e mineralità' where fonte = 'base' and nome = 'Greco di Tufo';
update public.enciclopedia_vini set profilo = 'frutta a polpa gialla, nocciola e miele' where fonte = 'base' and nome = 'Fiano';
update public.enciclopedia_vini set profilo = 'agrumi, frutta bianca e finale sapido' where fonte = 'base' and nome = 'Falanghina';
update public.enciclopedia_vini set profilo = 'frutta gialla e note minerali' where fonte = 'base' and nome = 'Coda di Volpe';
update public.enciclopedia_vini set profilo = 'agrumi, mela verde e acidità tagliente' where fonte = 'base' and nome = 'Asprinio';
update public.enciclopedia_vini set profilo = 'fiori bianchi, agrumi e sapidità marina' where fonte = 'base' and nome = 'Biancolella';
update public.enciclopedia_vini set profilo = 'frutta rossa matura, prugna e spezie dolci' where fonte = 'base' and nome = 'Primitivo';
update public.enciclopedia_vini set profilo = 'frutti neri e note balsamiche' where fonte = 'base' and nome = 'Negroamaro';
update public.enciclopedia_vini set profilo = 'frutti neri, viola e tannino deciso' where fonte = 'base' and nome = 'Nero di Troia';
update public.enciclopedia_vini set profilo = 'ciliegia, fiori e beva fresca' where fonte = 'base' and nome = 'Cerasuolo di Vittoria';
update public.enciclopedia_vini set profilo = 'ciliegia nera e spezie' where fonte = 'base' and nome = 'Nero d''Avola';
update public.enciclopedia_vini set profilo = 'frutti rossi, note floreali e minerali' where fonte = 'base' and nome = 'Nerello';
update public.enciclopedia_vini set profilo = 'agrumi, fiori bianchi e mineralità' where fonte = 'base' and nome = 'Etna Bianco';
update public.enciclopedia_vini set profilo = 'fragola, ciliegia e fiori' where fonte = 'base' and nome = 'Frappato';
update public.enciclopedia_vini set profilo = 'agrumi, erbe aromatiche e sapidità' where fonte = 'base' and nome = 'Grillo';
update public.enciclopedia_vini set profilo = 'albicocca secca, miele e fichi' where fonte = 'base' and nome = 'Passito di Pantelleria';
update public.enciclopedia_vini set profilo = 'frutti rossi maturi e macchia mediterranea' where fonte = 'base' and nome = 'Cannonau';
update public.enciclopedia_vini set profilo = 'agrumi, erbe mediterranee e sapidità' where fonte = 'base' and nome = 'Vermentino';
update public.enciclopedia_vini set profilo = 'ciliegia, fragola e freschezza' where fonte = 'base' and nome = 'Cerasuolo d''Abruzzo';
update public.enciclopedia_vini set profilo = 'frutti neri, spezie e morbidezza' where fonte = 'base' and nome = 'Montepulciano';
update public.enciclopedia_vini set profilo = 'frutta bianca, erbe aromatiche e freschezza' where fonte = 'base' and nome = 'Pecorino';
update public.enciclopedia_vini set profilo = 'mandorla, frutta bianca e mineralità' where fonte = 'base' and nome = 'Verdicchio';
update public.enciclopedia_vini set profilo = 'frutti neri, spezie e tannino potente' where fonte = 'base' and nome = 'Sagrantino';
update public.enciclopedia_vini set profilo = 'ciliegia matura, viola, spezie e note terrose' where fonte = 'base' and nome = 'Brunello';
update public.enciclopedia_vini set profilo = 'ciliegia, viola e note terrose' where fonte = 'base' and nome = 'Rosso di Montalcino';
update public.enciclopedia_vini set profilo = 'frutti neri, spezie e note balsamiche' where fonte = 'base' and nome = 'Bolgheri';
update public.enciclopedia_vini set profilo = 'frutta secca, miele e caramello' where fonte = 'base' and nome = 'Vin Santo';
update public.enciclopedia_vini set profilo = 'frutta bianca, mandorla e mineralità' where fonte = 'base' and nome = 'Vernaccia';
update public.enciclopedia_vini set profilo = 'frutti rossi e spuma vivace' where fonte = 'base' and nome = 'Lambrusco';
update public.enciclopedia_vini set profilo = 'rosa, frutti rossi, spezie e tannino importante' where fonte = 'base' and nome = 'Barolo';
update public.enciclopedia_vini set profilo = 'rosa, frutti rossi e tannino importante' where fonte = 'base' and nome = 'Nebbiolo';
update public.enciclopedia_vini set profilo = 'ciliegia, prugna e acidità vivace' where fonte = 'base' and nome = 'Barbera';
update public.enciclopedia_vini set profilo = 'pesca, fiori bianchi e dolcezza delicata' where fonte = 'base' and nome = 'Moscato d''Asti';
update public.enciclopedia_vini set profilo = 'frutta appassita, spezie e calore' where fonte = 'base' and nome = 'Amarone';
update public.enciclopedia_vini set profilo = 'ciliegia matura e spezie dolci' where fonte = 'base' and nome = 'Ripasso';
update public.enciclopedia_vini set profilo = 'ciliegia e piccoli frutti rossi' where fonte = 'base' and nome = 'Valpolicella';
update public.enciclopedia_vini set profilo = 'mela verde, fiori bianchi e bollicina fine' where fonte = 'base' and nome = 'Prosecco';
update public.enciclopedia_vini set profilo = 'fiori bianchi e mandorla' where fonte = 'base' and nome = 'Soave';
update public.enciclopedia_vini set profilo = 'frutta bianca, mandorla e mineralità' where fonte = 'base' and nome = 'Lugana';
update public.enciclopedia_vini set profilo = 'crosta di pane, frutta bianca e bollicina fine' where fonte = 'base' and nome = 'Franciacorta';
update public.enciclopedia_vini set profilo = 'frutti di bosco e note di cacao' where fonte = 'base' and nome = 'Lagrein';
update public.enciclopedia_vini set profilo = 'frutti neri e viola' where fonte = 'base' and nome = 'Teroldego';
update public.enciclopedia_vini set profilo = 'rosa, litchi e spezie' where fonte = 'base' and nome = 'Gewurztraminer';
update public.enciclopedia_vini set profilo = 'agrumi, mela e freschezza' where fonte = 'base' and nome = 'Ribolla';
update public.enciclopedia_vini set profilo = 'mandorla e fiori di campo' where fonte = 'base' and nome = 'Friulano';
update public.enciclopedia_vini set profilo = 'pera, fiori bianchi e freschezza' where fonte = 'base' and nome = 'Pinot Grigio';
update public.enciclopedia_vini set profilo = 'piccoli frutti rossi ed eleganza' where fonte = 'base' and nome = 'Pinot Nero';
update public.enciclopedia_vini set profilo = 'ribes nero, spezie e note erbacee' where fonte = 'base' and nome = 'Cabernet Sauvignon';
update public.enciclopedia_vini set profilo = 'frutti rossi e note erbacee' where fonte = 'base' and nome = 'Cabernet Franc';
update public.enciclopedia_vini set profilo = 'prugna, frutti rossi e morbidezza' where fonte = 'base' and nome = 'Merlot';
update public.enciclopedia_vini set profilo = 'frutti neri e pepe' where fonte = 'base' and nome = 'Syrah';
update public.enciclopedia_vini set profilo = 'mora, prugna e spezie' where fonte = 'base' and nome = 'Malbec';
update public.enciclopedia_vini set profilo = 'agrumi, frutto della passione ed erbe aromatiche' where fonte = 'base' and nome = 'Sauvignon Blanc';
update public.enciclopedia_vini set profilo = 'frutta gialla, note burrose e tostate' where fonte = 'base' and nome = 'Chardonnay';
update public.enciclopedia_vini set profilo = 'agrumi, pesca e note minerali' where fonte = 'base' and nome = 'Riesling';
update public.enciclopedia_vini set profilo = 'crosta di pane, agrumi e bollicina fine' where fonte = 'base' and nome = 'Champagne';
update public.enciclopedia_vini set profilo = 'pesca, fiori e dolcezza delicata' where fonte = 'base' and nome = 'Moscato';
update public.enciclopedia_vini set profilo = 'frutta secca, caramello e spezie' where fonte = 'base' and nome = 'Marsala';

drop function public.cerca_vino(text, int);
create or replace function public.cerca_vino(p_testo text, p_limite int default 10)
returns table (id uuid, nome text, cantina text, tipo text, corpo text, regione text, paese text, vitigno text, abbinamenti text,
               fonte text, contenuto boolean, punteggio real, acidita text, gradazione numeric, profilo text)
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
         t.lunghezza > 0 as contenuto, extensions.word_similarity(q.nudo, t.testo_ricerca) as punteggio, t.acidita, t.gradazione,
         -- Profilo: quello della voce o, in mancanza, quello del vitigno principale nella base curata
         coalesce(nullif(t.profilo, ''), (
           select b.profilo from public.enciclopedia_vini b
           where b.fonte = 'base' and b.profilo <> '' and t.vitigno <> ''
             and b.chiavi && public.sequenze_parole(split_part(t.vitigno, ',', 1))
           order by char_length(b.chiave) desc limit 1), '') as profilo
  from tutti t, q
  order by contenuto desc, t.lunghezza desc, case t.fonte when 'locale' then 0 when 'base' then 1 else 2 end, punteggio desc
  limit least(greatest(coalesce(p_limite, 10), 1), 50);
$$;
revoke execute on function public.cerca_vino(text, int) from public, anon;
grant execute on function public.cerca_vino(text, int) to authenticated;
