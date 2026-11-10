-- Sfondo del menu a carosello: oltre alla foto principale (sfondo_path) fino a 5 foto che si sfumano una nell'altra.
-- Percorsi solo nell'archivio del locale (<locale>/sfondo/<uuid>.<ext>), intervallo tra le foto e zoom lento facoltativo.
-- Il menu pubblico le espone già (to_jsonb dell'aspetto).

create function public.percorsi_sfondo_validi(p_locale uuid, p_percorsi text[])
returns boolean language sql immutable set search_path = '' as $$
  select cardinality(p_percorsi) <= 5
     and cardinality(p_percorsi) = (select count(distinct x) from unnest(p_percorsi) x)
     and coalesce((select bool_and(x ~ ('^' || p_locale::text || '/sfondo/[0-9a-f-]{36}\.(jpg|png|webp)$')) from unnest(p_percorsi) x), true);
$$;

alter table public.aspetto
  add column sfondo_carosello  text[]  not null default '{}',
  add column sfondo_intervallo int     not null default 8 check (sfondo_intervallo between 4 and 30),
  add column sfondo_zoom       boolean not null default true,
  add constraint sfondo_carosello_valido check (public.percorsi_sfondo_validi(locale_id, sfondo_carosello));
