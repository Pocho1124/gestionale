-- Aspetto: foto di sfondo «vedo non vedo» (immagine incorporata, visibilità, sfocatura, bianco e nero).
alter table public.aspetto
  add column sfondo_dati text
    check (sfondo_dati is null or (sfondo_dati ~ '^data:image/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$'
                                   and char_length(sfondo_dati) <= 1400000)),
  add column sfondo_opacita   int     not null default 22 check (sfondo_opacita between 0 and 100),
  add column sfondo_sfocatura int     not null default 3  check (sfondo_sfocatura between 0 and 20),
  add column sfondo_bn        boolean not null default false;
