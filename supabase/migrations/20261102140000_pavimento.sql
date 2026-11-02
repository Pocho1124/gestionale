-- Piantina più realistica: tipo di pavimento della sala.
alter table public.sale add column pavimento text not null default 'parquet'
  check (pavimento in ('parquet', 'cotto', 'marmo', 'cemento', 'nessuno'));
