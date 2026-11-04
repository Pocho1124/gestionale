#!/usr/bin/env python3
"""Converte il file dei vini di X-Wines (CSV, licenza CC0) in istruzioni SQL per l'enciclopedia dei vini.
Fonte: de Azambuja, R.X.; Morais, A.J.; Filipe, V. X-Wines: A Wine Dataset for Recommender Systems and Machine
Learning. Big Data Cogn. Comput. 2023, 7, 20. https://doi.org/10.3390/bdcc7010020
Uso: python3 enciclopedia-importa.py XWines_Full_100K_wines.csv | psql ...   (sostituisce le voci X-Wines precedenti)"""
import ast, csv, io, sys

TIPI = {"red": "rosso", "white": "bianco", "rosé": "rosato", "rose": "rosato", "sparkling": "bollicine", "dessert": "dolce", "dessert/port": "dolce"}
CORPI = {"very light-bodied": "leggero", "light-bodied": "leggero", "medium-bodied": "medio", "full-bodied": "strutturato", "very full-bodied": "strutturato"}
PAESI = {"Italy": "Italia", "France": "Francia", "Spain": "Spagna", "Portugal": "Portogallo", "Germany": "Germania", "Austria": "Austria",
         "United States": "Stati Uniti", "Argentina": "Argentina", "Chile": "Cile", "Australia": "Australia", "New Zealand": "Nuova Zelanda",
         "South Africa": "Sudafrica", "Brazil": "Brasile", "Greece": "Grecia", "Hungary": "Ungheria", "Uruguay": "Uruguay", "Switzerland": "Svizzera",
         "Slovenia": "Slovenia", "Croatia": "Croazia", "Romania": "Romania", "Georgia": "Georgia", "Israel": "Israele", "Lebanon": "Libano",
         "Canada": "Canada", "Mexico": "Messico", "Moldova": "Moldavia", "Bulgaria": "Bulgaria", "Czech Republic": "Repubblica Ceca"}
CIBI = {"Beef": "manzo", "Lamb": "agnello", "Veal": "vitello", "Pork": "maiale", "Poultry": "pollame", "Game Meat": "selvaggina",
        "Fish": "pesce", "Lean Fish": "pesce magro", "Rich Fish": "pesce grasso", "Shellfish": "crostacei", "Seafood": "frutti di mare",
        "Pasta": "pasta", "Pizza": "pizza", "Cured Meat": "salumi", "Mild Cheese": "formaggi freschi", "Maturated Cheese": "formaggi stagionati",
        "Hard Cheese": "formaggi stagionati", "Soft Cheese": "formaggi morbidi", "Goat Cheese": "formaggi di capra", "Blue Cheese": "erborinati",
        "Cheese": "formaggi", "Appetizer": "antipasti", "Snack": "stuzzichini", "Aperitif": "aperitivo", "Vegetarian": "piatti vegetariani",
        "Mushrooms": "funghi", "Spicy Food": "piatti speziati", "Sweet Dessert": "dolci", "Dessert": "dolci", "Fruit Dessert": "dolci alla frutta",
        "Chocolate": "cioccolato", "Risotto": "risotto", "Salad": "insalate", "Barbecue": "grigliate", "Tomato Dishes": "piatti al pomodoro"}

def lista(valore):
    try:
        v = ast.literal_eval(valore) if valore and valore.strip().startswith("[") else []
        return [str(x).strip() for x in v if str(x).strip()]
    except (ValueError, SyntaxError):
        return []

def main(percorso):
    with open(percorso, newline="", encoding="utf-8-sig") as f:
        lettore = csv.DictReader(f)
        campi = {c.lower(): c for c in lettore.fieldnames or []}
        def c(r, nome): return (r.get(campi.get(nome.lower(), ""), "") or "").strip()
        mancanti = [n for n in ("WineID", "WineName", "Type", "Body") if n.lower() not in campi]
        if mancanti:
            sys.exit(f"Colonne mancanti nel file: {', '.join(mancanti)}. Colonne trovate: {', '.join(lettore.fieldnames or [])}")
        uscita = io.StringIO()
        scrittore = csv.writer(uscita, lineterminator="\n")
        n = scartati = 0
        for r in lettore:
            tipo, corpo = TIPI.get(c(r, "Type").lower()), CORPI.get(c(r, "Body").lower())
            nome = c(r, "WineName")[:160]
            if not tipo or not corpo or len(nome) < 2:
                scartati += 1
                continue
            vitigni = ", ".join(lista(c(r, "Grapes")))[:200]
            cibi = ", ".join(dict.fromkeys(CIBI[x] for x in lista(c(r, "Harmonize")) if x in CIBI))[:300]
            paese = c(r, "Country")
            scrittore.writerow([nome, c(r, "WineryName")[:160], tipo, corpo, c(r, "RegionName")[:120], PAESI.get(paese, paese)[:60],
                                vitigni, cibi, "xwines", c(r, "WineID")[:40]])
            n += 1
    print("\\set ON_ERROR_STOP on")
    print("begin;")
    print("delete from public.enciclopedia_vini where fonte = 'xwines';")
    print("copy public.enciclopedia_vini (nome, cantina, tipo, corpo, regione, paese, vitigno, abbinamenti, fonte, riferimento) from stdin with (format csv);")
    sys.stdout.write(uscita.getvalue())
    print("\\.")
    print("analyze public.enciclopedia_vini;")
    print("commit;")
    print(f"Vini importati: {n}, scartati (tipo o corpo mancanti): {scartati}", file=sys.stderr)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Uso: enciclopedia-importa.py <file dei vini X-Wines .csv>")
    main(sys.argv[1])
