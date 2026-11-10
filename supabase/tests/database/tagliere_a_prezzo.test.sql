-- Test di «Componi il tuo tagliere»: prezzo = piatto (anche 0) + voci scelte al prezzo dell'aggiunta. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(4);
insert into auth.users (id, email, raw_user_meta_data) values ('ff111111-1111-1111-1111-111111111111', 'titolare@componi.local', '{}');
set local role authenticated; select pg_temp.come('ff111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Componi', 'Locale Componi', 'locale-componi');
insert into public.categorie (id, locale_id, nome) select 'ff200000-0000-0000-0000-000000000001', id, 'Taglieri' from public.locali where slug = 'locale-componi';
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent)
  select 'ff300000-0000-0000-0000-000000000001', id, 'ff200000-0000-0000-0000-000000000001', 'Componi il tuo tagliere', 0 from public.locali where slug = 'locale-componi';
insert into public.gruppi_opzioni (id, locale_id, prodotto_id, nome, min_scelte, max_scelte, posizione)
  select x.id::uuid, l.id, 'ff300000-0000-0000-0000-000000000001', x.nome, 0, 6, x.pos from public.locali l,
    (values ('ff400000-0000-0000-0000-000000000001', 'Salumi', 0), ('ff400000-0000-0000-0000-000000000002', 'Formaggi', 1)) as x(id, nome, pos)
   where l.slug = 'locale-componi';
insert into public.aggiunte (id, locale_id, nome, prezzo_cent, gruppo)
  select x.id::uuid, l.id, x.nome, x.prezzo, x.gruppo from public.locali l,
    (values ('ff500000-0000-0000-0000-000000000001', 'Prosciutto crudo', 600, 'Salumi'),
            ('ff500000-0000-0000-0000-000000000002', 'Pecorino', 400, 'Formaggi')) as x(id, nome, prezzo, gruppo)
   where l.slug = 'locale-componi';
reset role;

create temp table ctx as select id as loc from public.locali where slug = 'locale-componi';
create function pg_temp.prezzo(p jsonb) returns jsonb language sql as $$
  select public.prezzo_riga((select loc from ctx), 'ff300000-0000-0000-0000-000000000001', p) $$;

select is(pg_temp.prezzo('["ff400000-0000-0000-0000-000000000001:ff500000-0000-0000-0000-000000000001"]') ->> 'prezzo_cent', '600',
          'Un salume da 6 €: il tagliere parte da 6 €');
select is(pg_temp.prezzo('["ff400000-0000-0000-0000-000000000001:ff500000-0000-0000-0000-000000000001", "ff400000-0000-0000-0000-000000000002:ff500000-0000-0000-0000-000000000002"]') ->> 'prezzo_cent',
          '1000', 'Poi si sommano gli altri: 6 + 4');
select is(pg_temp.prezzo('["ff400000-0000-0000-0000-000000000001:ff500000-0000-0000-0000-000000000001"]') -> 'opzioni' -> 0,
          '{"id": "ff500000-0000-0000-0000-000000000001", "gruppo": "Salumi", "nome": "Prosciutto crudo", "sovrapprezzo_cent": 600}'::jsonb,
          'Nella comanda la voce con il suo gruppo e il suo prezzo');
select is(public.menu_pubblico('locale-componi') -> 'categorie' -> 0 -> 'prodotti' -> 0 -> 'opzioni' -> 0 -> 'scelte' -> 0 ->> 'sovrapprezzo_cent', '600',
          'Il menu mostra il prezzo di ogni voce');

select * from finish();
rollback;
