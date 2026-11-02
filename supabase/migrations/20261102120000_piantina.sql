-- Piantina disegnabile: proporzioni reali della sala, planimetria di sfondo, rotazione dei tavoli,
-- elementi d'arredo (muri, bancone, porte, finestre, colonne, piante, zone, scritte, cassa, bagni).

alter table public.sale
  add column larghezza_m    numeric(5,1) not null default 12 check (larghezza_m between 2 and 200),
  add column profondita_m   numeric(5,1) not null default 8  check (profondita_m between 2 and 200),
  add column sfondo_dati    text check (sfondo_dati is null or (sfondo_dati ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$'
                                                                 and char_length(sfondo_dati) <= 1400000)),
  add column sfondo_opacita int not null default 40 check (sfondo_opacita between 0 and 100);

-- La piantina è larga 1000 punti; l'altezza segue le proporzioni della sala (fino a 2000)
alter table public.tavoli drop constraint tavoli_y_check;
alter table public.tavoli add constraint tavoli_y_check check (y between 0 and 2000);
alter table public.tavoli add column rotazione int not null default 0 check (rotazione between 0 and 359);

create table public.elementi_sala (
  id         uuid primary key default gen_random_uuid(),
  locale_id  uuid not null,
  sala_id    uuid not null,
  tipo       text not null check (tipo in ('muro', 'bancone', 'porta', 'finestra', 'colonna', 'pianta', 'zona', 'testo', 'cassa', 'bagni')),
  x          int  not null check (x between 0 and 1000),          -- centro dell'elemento
  y          int  not null check (y between 0 and 2000),
  w          int  not null check (w between 4 and 1000),
  h          int  not null check (h between 4 and 2000),
  rotazione  int  not null default 0 check (rotazione between 0 and 359),
  etichetta  text not null default '' check (char_length(etichetta) <= 40),
  created_at timestamptz not null default now(),
  foreign key (sala_id, locale_id) references public.sale (id, locale_id) on delete cascade
);
create index on public.elementi_sala (sala_id);
create trigger elementi_sala_audit after insert or update or delete on public.elementi_sala
  for each row execute function public.scrivi_audit();

alter table public.elementi_sala enable row level security;
create policy elementi_select on public.elementi_sala for select to authenticated using (public.ruolo_in_locale(locale_id) is not null);
create policy elementi_write on public.elementi_sala for all to authenticated
  using (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]))
  with check (public.ha_ruolo_locale(locale_id, array['owner','manager']::public.ruolo[]));
revoke all on public.elementi_sala from anon;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.elementi_sala;
  end if;
end $$;
