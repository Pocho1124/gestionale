-- Aspetto: logo caricato dal backoffice, scelta se mostrare il nome, impaginazione «elegante», font Cormorant Garamond.

-- Logo come immagine incorporata (PNG/JPEG/WebP, max ~500 KB): niente storage esterno, funziona offline
alter table public.aspetto
  add column logo_dati text
    check (logo_dati is null or (logo_dati ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
                                 and char_length(logo_dati) <= 700000)),
  add column mostra_nome boolean not null default true;

alter table public.aspetto drop constraint aspetto_layout_check;
alter table public.aspetto add constraint aspetto_layout_check
  check (layout in ('lista', 'griglia', 'compatto', 'elegante'));

alter table public.aspetto drop constraint aspetto_font_titoli_check;
alter table public.aspetto add constraint aspetto_font_titoli_check
  check (font_titoli in ('Young Serif','Playfair Display','Cormorant Garamond','Lora','Merriweather',
                         'Oswald','Montserrat','Poppins','Figtree','Inter','Nunito'));

alter table public.aspetto drop constraint aspetto_font_testo_check;
alter table public.aspetto add constraint aspetto_font_testo_check
  check (font_testo in ('Figtree','Inter','Nunito','Poppins','Montserrat','Lora','Merriweather','Cormorant Garamond'));
