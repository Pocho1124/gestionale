-- Foto dei piatti: una per piatto, caricata da backoffice o Telegram, aperta dal cliente toccando il piatto.
-- Le foto stanno in una tabella separata: il menu resta leggero e ogni foto si scarica solo quando serve.

create table public.foto_prodotti (
  prodotto_id   uuid primary key,
  locale_id     uuid not null,
  dati          text not null
                check (dati ~ '^data:image/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$' and char_length(dati) <= 900000),
  aggiornata_at timestamptz not null default now(),
  foreign key (prodotto_id, locale_id) references public.prodotti (id, locale_id) on delete cascade
);
create index on public.foto_prodotti (locale_id);

-- Nessun audit sul contenuto: copierebbe centinaia di KB nel log a ogni foto
create or replace function public.foto_aggiornata()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.aggiornata_at := now();
  return new;
end $$;
create trigger foto_prodotti_aggiornata before update on public.foto_prodotti
  for each row execute function public.foto_aggiornata();

alter table public.foto_prodotti enable row level security;
create policy foto_select on public.foto_prodotti for select to authenticated
  using (public.ruolo_in_locale(locale_id) is not null);
create policy foto_write on public.foto_prodotti for all to authenticated
  using (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]))
  with check (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]));
revoke all on public.foto_prodotti from anon;

-- Foto per il menu pubblico: solo piatti visibili di locali attivi
create or replace function public.foto_prodotto(p_prodotto uuid)
returns text language sql stable security definer set search_path = '' as $$
  select f.dati
  from public.foto_prodotti f
  join public.prodotti p on p.id = f.prodotto_id
  join public.locali l on l.id = p.locale_id
  where f.prodotto_id = p_prodotto and p.visibile and l.attivo;
$$;
revoke execute on function public.foto_prodotto(uuid) from public;
grant  execute on function public.foto_prodotto(uuid) to anon, authenticated;

-- Menu pubblico: aggiunge la versione della foto di ogni piatto
create or replace function public.menu_pubblico(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'locale',  jsonb_build_object('nome', l.nome, 'indirizzo', l.indirizzo),
    'aspetto', to_jsonb(a) - 'locale_id',
    'categorie', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'nome', c.nome, 'descrizione', c.descrizione,
               'prodotti', (
                 select jsonb_agg(jsonb_build_object(
                          'id', p.id, 'nome', p.nome, 'descrizione', p.descrizione,
                          'prezzo_cent', p.prezzo_cent, 'disponibile', p.disponibile,
                          'allergeni', p.allergeni, 'etichette', p.etichette, 'immagine_url', p.immagine_url,
                          -- Versione della foto (null se assente): la foto si scarica a parte, solo quando serve
                          'foto', (select floor(extract(epoch from f.aggiornata_at))::bigint
                                   from public.foto_prodotti f where f.prodotto_id = p.id),
                          'opzioni', coalesce((
                            select jsonb_agg(jsonb_build_object(
                                     'nome', g.nome, 'min', g.min_scelte, 'max', g.max_scelte,
                                     'scelte', coalesce((
                                       select jsonb_agg(jsonb_build_object('nome', o.nome, 'sovrapprezzo_cent', o.sovrapprezzo_cent)
                                                        order by o.posizione, o.nome)
                                       from public.opzioni o where o.gruppo_id = g.id and o.disponibile), '[]'::jsonb))
                                   order by g.posizione, g.nome)
                            from public.gruppi_opzioni g where g.prodotto_id = p.id), '[]'::jsonb))
                        order by p.posizione, p.nome)
                 from public.prodotti p where p.categoria_id = c.id and p.visibile))
             order by c.posizione, c.nome)
      from public.categorie c
      where c.locale_id = l.id and c.visibile
        and exists (select 1 from public.prodotti p where p.categoria_id = c.id and p.visibile)), '[]'::jsonb)
  )
  from public.locali l
  left join public.aspetto a on a.locale_id = l.id
  where l.slug = lower(p_slug) and l.attivo;
$$;
