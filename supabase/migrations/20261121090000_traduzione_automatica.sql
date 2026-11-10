-- Traduzione automatica del menu in inglese (IA locale del server, nel bot): per ogni categoria e piatto si ricorda
-- da quale testo italiano è stata fatta la traduzione, così si rifà solo quando l'italiano cambia.
-- «manuale» = scritta o corretta a mano nel Catalogo: il traduttore non la tocca più.
-- Prezzi e numeri non passano dal modello: il traduttore scarta le traduzioni che cambiano i numeri.

alter table public.categorie add column traduzione_da text not null default '' check (char_length(traduzione_da) <= 80);
alter table public.prodotti add column traduzione_da text not null default '' check (char_length(traduzione_da) <= 80);
