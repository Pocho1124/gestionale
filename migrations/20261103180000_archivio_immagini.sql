-- Immagini fuori dal database: archivio Supabase Storage (contenitore «immagini»), con limiti imposti dal server.
-- Nel database restano solo gli indirizzi. Il base64 resta leggibile finché le immagini non sono migrate.

create or replace function public.uuid_o_null(p text)
returns uuid language sql immutable set search_path = '' as $$
  select case when p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end;
$$;
revoke execute on function public.uuid_o_null(text) from public, anon;

-- Percorso: <locale>/<tipo>/<uuid>.<jpg|png|webp>, sempre nella cartella del proprio locale
alter table public.aspetto
  add column logo_path   text check (logo_path   ~ ('^' || locale_id::text || '/logo/[0-9a-f-]{36}\.(jpg|png|webp)$')),
  add column sfondo_path text check (sfondo_path ~ ('^' || locale_id::text || '/sfondo/[0-9a-f-]{36}\.(jpg|png|webp)$'));
alter table public.sale
  add column sfondo_path text check (sfondo_path ~ ('^' || locale_id::text || '/sale/[0-9a-f-]{36}\.(jpg|png|webp)$'));
alter table public.foto_prodotti
  alter column dati drop not null,
  add column path text check (path ~ ('^' || locale_id::text || '/piatti/[0-9a-f-]{36}\.(jpg|png|webp)$')),
  add constraint foto_dati_o_path check (dati is not null or path is not null);

-- Contenitore e regole dell'archivio: applicati solo se il servizio Storage è installato e aggiornato
create or replace function public.configura_archivio_immagini()
returns text language plpgsql security definer set search_path = '' as $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    return 'archivio non installato: configurazione rimandata';
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('immagini', 'immagini', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

  -- Lettura pubblica per indirizzo diretto (contenitore pubblico); elenco, scrittura e cancellazione solo allo staff del locale
  execute 'drop policy if exists immagini_elenco on storage.objects';
  execute 'drop policy if exists immagini_carica on storage.objects';
  execute 'drop policy if exists immagini_modifica on storage.objects';
  execute 'drop policy if exists immagini_elimina on storage.objects';
  execute $p$create policy immagini_elenco on storage.objects for select to authenticated
    using (bucket_id = 'immagini' and public.ruolo_in_locale(public.uuid_o_null(split_part(name, '/', 1))) is not null)$p$;
  execute $p$create policy immagini_carica on storage.objects for insert to authenticated
    with check (bucket_id = 'immagini' and name ~ '^[0-9a-f-]{36}/(logo|sfondo|sale|piatti)/[0-9a-f-]{36}\.(jpg|png|webp)$'
                and public.ha_ruolo_locale(public.uuid_o_null(split_part(name, '/', 1)), array['owner','manager']::public.ruolo[]))$p$;
  execute $p$create policy immagini_modifica on storage.objects for update to authenticated
    using (bucket_id = 'immagini' and public.ha_ruolo_locale(public.uuid_o_null(split_part(name, '/', 1)), array['owner','manager']::public.ruolo[]))
    with check (bucket_id = 'immagini' and public.ha_ruolo_locale(public.uuid_o_null(split_part(name, '/', 1)), array['owner','manager']::public.ruolo[]))$p$;
  execute $p$create policy immagini_elimina on storage.objects for delete to authenticated
    using (bucket_id = 'immagini' and public.ha_ruolo_locale(public.uuid_o_null(split_part(name, '/', 1)), array['owner','manager']::public.ruolo[]))$p$;
  return 'archivio configurato';
end $$;
revoke execute on function public.configura_archivio_immagini() from public, anon, authenticated;

-- Durante la migrazione si prova; se l'utente delle migrazioni non può toccare lo schema storage,
-- lo farà l'installer dell'archivio con l'amministratore del database
do $$
begin
  raise notice '%', public.configura_archivio_immagini();
exception when insufficient_privilege or undefined_table or undefined_column then
  raise notice 'archivio: configurazione rimandata all''installer (%)', sqlerrm;
end $$;

-- Menu pubblico: indirizzi delle immagini al posto del base64
create or replace function public.menu_pubblico(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'locale',  jsonb_build_object('nome', l.nome, 'indirizzo', l.indirizzo),
    -- Immagini: indirizzo nell'archivio; il base64 solo per le immagini non ancora migrate
    'aspetto', (to_jsonb(a) - 'locale_id' - 'logo_dati' - 'sfondo_dati')
               || jsonb_build_object('logo_dati', case when a.logo_path is null then a.logo_dati end,
                                     'sfondo_dati', case when a.sfondo_path is null then a.sfondo_dati end),
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
                          'foto_path', (select f.path from public.foto_prodotti f where f.prodotto_id = p.id),
                          -- Scheda del vino (null se il prodotto non è un vino)
                          'vino', (select jsonb_build_object('tipo', v.tipo, 'corpo', v.corpo, 'regione', v.regione,
                                          'vitigno', v.vitigno, 'cantina', v.cantina, 'annata', v.annata, 'note', v.note,
                                          'prezzo_bottiglia_cent', v.prezzo_bottiglia_cent)
                                   from public.vini v where v.prodotto_id = p.id),
                          -- Abbinamenti in entrambe le direzioni, solo verso prodotti visibili
                          'abbinamenti', coalesce((
                            select jsonb_agg(jsonb_build_object('id', x.altro, 'motivo', x.motivo))
                            from (select a.vino_id as altro, a.motivo from public.abbinamenti a
                                    join public.prodotti q on q.id = a.vino_id where a.piatto_id = p.id and q.visibile
                                  union all
                                  select a.piatto_id, a.motivo from public.abbinamenti a
                                    join public.prodotti q on q.id = a.piatto_id where a.vino_id = p.id and q.visibile) x), '[]'::jsonb),
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
