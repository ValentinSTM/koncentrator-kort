"""Regenerate docs/placement-dictionary.md from app/data/placement-dictionary.json.
    python tools/dict_to_md.py"""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
d = json.loads((ROOT / "app/data/placement-dictionary.json").read_text(encoding="utf-8"))
titles = {"room": ("Rum / tip loc / room type", "Unde e montat (camera, construcția)."),
          "side": ("Side / partea / side", "Unde, față de ușă sau de intrare."),
          "height": ("Højde / înălțimea / height", ""), "floor": ("Etage / etaj / floor", ""),
          "landmark": ("Pejlemærke / reper / landmark", "Obiectul lângă care e montat."),
          "antenna": ("Antenne / antena / antenna", "Unde e antena, dacă nu e lângă concentrator."),
          "access": ("Adgang / acces / access", "Cum intri. `eget_anlaeg` = instalație proprie Kredsløb/AVA, nu e nevoie de programare. Numele și telefoanele persoanelor NU stau în descriere (GDPR), ci în câmpul de acces restricționat."),
          "status": ("Status / stare informație / info status", "")}
c = d["coverage"]
L = ["# Dicționarul pozițiilor fizice (DA / EN / RO)", "",
     "Construit din descrierile reale din Google My Maps. Conține doar vocabularul și numărări agregate, nicio adresă și nicio dată despre concentratoare individuale.", "",
     "## Ce arată datele existente", "", "| Indicator | Număr |", "|---|---:|",
     f"| concentratoare | {c['concentrators']} |", f"| cu text despre locul fizic | {c['withPlaceText']} |",
     f"| tipul locului recunoscut automat | {c['roomRecognised']} |", f"| descriere de un singur cuvânt (ex. „Skur”) | {c['onlyOneWord']} |",
     f"| cu parte (stânga/dreapta/după ușă…) | {c['sideRecognised']} |", f"| cu înălțime (sub tavan, pe căprior) | {c['heightRecognised']} |",
     f"| cu reper (ușă, tablou, trapă…) | {c['landmarkRecognised']} |",
     f"| **descriere detaliată** (loc + parte sau înălțime) | **{c['detailed(room+side or height)']}** |", "",
     "Concluzie: aproape toate au tipul locului, dar doar ~13% au destule detalii. Fluxul „Completează în 1 minut” cere exact categoriile de mai jos, din butoane.", "",
     "Codurile `SAT 6/7/8` și `N01` din textele vechi (etape istorice ale rețelei Radio Mesh) se elimină din descriere la import; textul original rămâne păstrat.", ""]
for cat, items in d["categories"].items():
    t, desc = titles[cat]
    L += [f"## {t}", ""] + ([desc, ""] if desc else []) + ["| Cheie | Dansk | English | Română | Frecvență |", "|---|---|---|---|---:|"]
    L += [f"| `{i['key']}` | {i['da']} | {i['en']} | {i['ro']} | {i['count']} |" for i in sorted(items, key=lambda x: -x["count"])] + [""]
L += ["## Cum se folosește", "",
      "- **La import:** `tools/build_dataset.py` aplică tiparele (`pattern`) pe textul vechi și propune categoriile. Textul original se păstrează neschimbat.",
      "- **În teren:** montatorul alege din aceleași chei, prin butoane; aplicația compune descrierea în limba fiecărui utilizator.",
      "- Cheile noi se adaugă în `tools/placement_dict.py` (sursa) și se regenerează JSON-ul și acest document."]
(ROOT / "docs/placement-dictionary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
print("ok")
