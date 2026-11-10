-- Test delle note dei vini in inglese: il menu pubblico le espone accanto all'italiano. Dati sintetici.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.come(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

select plan(3);
insert into auth.users (id, email, raw_user_meta_data) values ('fa111111-1111-1111-1111-111111111111', 'titolare@noteen.local', '{}');
set local role authenticated; select pg_temp.come('fa111111-1111-1111-1111-111111111111');
select public.crea_organizzazione('Org Note', 'Locale Note', 'locale-note-en');
insert into public.categorie (id, locale_id, nome) select 'fa200000-0000-0000-0000-000000000001', id, 'Rossi' from public.locali where slug = 'locale-note-en';
insert into public.prodotti (id, locale_id, categoria_id, nome, prezzo_cent)
  select 'fa300000-0000-0000-0000-000000000001', id, 'fa200000-0000-0000-0000-000000000001', 'Taurasi', 900 from public.locali where slug = 'locale-note-en';
insert into public.vini (prodotto_id, locale_id, tipo, corpo, note, note_en)
  select 'fa300000-0000-0000-0000-000000000001', id, 'rosso', 'strutturato', 'Affinato in botte', 'Aged in barrel' from public.locali where slug = 'locale-note-en';
reset role;

select is(public.menu_pubblico('locale-note-en') -> 'categorie' -> 0 -> 'prodotti' -> 0 -> 'vino' ->> 'note_en', 'Aged in barrel', 'Il menu pubblico porta le note inglesi');
select is(public.menu_pubblico('locale-note-en') -> 'categorie' -> 0 -> 'prodotti' -> 0 -> 'vino' ->> 'note', 'Affinato in botte', 'E quelle italiane');
select throws_ok($$ update public.vini set note_en = repeat('x', 601) $$, '23514', null, 'Note inglesi di lunghezza limitata');

select * from finish();
rollback;
