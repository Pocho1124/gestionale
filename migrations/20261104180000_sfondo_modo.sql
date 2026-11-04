-- Foto di sfondo: su tutto il menu («pagina») oppure solo dietro l'intestazione con il nome («testata»).
alter table public.aspetto add column sfondo_modo text not null default 'pagina' check (sfondo_modo in ('pagina', 'testata'));
