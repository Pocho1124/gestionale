-- Più oggetti per disegnare la sala: botti, bottigliere, divani, poltrone, sgabelli, tappeti, camino, scale,
-- cucina, vetrine, fioriere. I tipi già esistenti restano validi.
alter table public.elementi_sala drop constraint elementi_sala_tipo_check;
alter table public.elementi_sala add constraint elementi_sala_tipo_check check (tipo in (
  'muro', 'bancone', 'porta', 'finestra', 'colonna', 'pianta', 'zona', 'testo', 'cassa', 'bagni',
  'botte', 'scaffale', 'divano', 'poltrona', 'sgabello', 'tappeto', 'camino', 'scala', 'cucina', 'vetrina', 'fioriera'));
