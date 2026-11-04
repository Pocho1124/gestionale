-- Nuovo ruolo intermedio tra responsabile e cameriere. In un file a sé: il nuovo valore
-- dell'enum si può usare solo dopo la fine della transazione che lo aggiunge.
alter type public.ruolo add value if not exists 'caposala' after 'manager';
