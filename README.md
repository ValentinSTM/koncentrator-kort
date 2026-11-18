# Koncentrator-kort

Aplicație de teren pentru găsirea concentratoarelor (Radio Mesh, LinkIQ și altele) în zona Aarhus:
hartă cu poziția montatorului, descrierea exactă a locului de montaj, fotografii, completarea fișelor din teren
și, mai târziu, depanare prin SMS și integrare în Azure / Microsoft 365.

**Repository privat. Nu conține și nu va conține date reale** – vezi `REGULI.md`.

## Structură
| Cale | Ce conține |
|---|---|
| `app/index.html`, `app/css/`, `app/js/` | aplicația web (HTML + JavaScript simplu, Leaflet inclus local), DA/EN/RO |
| `app/js/data.js` | stratul de date: date demo fictive, stocare pe dispozitiv (IndexedDB), încărcarea datelor locale |
| `app/data/placement-dictionary.json` | dicționarul pozițiilor fizice (DA/EN/RO) |
| `docs/placement-dictionary.md` | dicționarul explicat, cu frecvențele din datele vechi |
| `tools/mymaps_import.py` | convertește exportul Google My Maps (KMZ/KML) într-un pachet de migrare |
| `tools/merge_ready.py` | combină lista READy (coordonate, listă actuală) cu datele din My Maps |
| `tools/placement_dict.py` | sursa dicționarului; regenerează `placement-dictionary.json` din descrierile vechi |
| `tools/dict_to_md.py` | regenerează `docs/placement-dictionary.md` |
| `tools/build_dataset.py` | face fișierul privat `koncentrator-data.json` (Radio Mesh + LinkIQ + fotografii) pe care aplicația îl încarcă local |
| `tools/windows/Descarca-poze.bat` | descarcă fotografiile din exportul My Maps (dublu-clic, Windows) |
| `tools/build_single.py` | face din `app/` un singur fișier HTML |

## Ce face aplicația (versiunea 1 – Radio Mesh)
- hartă cu poziția GPS a montatorului, concentratoarele Radio Mesh (cerc mov; inel galben = lipsesc informații) și site-urile LinkIQ (romb albastru);
- „Cele mai apropiate” cu distanță și săgeată de direcție;
- fișa: busolă cu distanța și direcția spre concentrator, **unde e montat** (descriere compusă din dicționar + nota originală), fotografii, adresă, coordonate, calitatea datelor;
- buton mare **Google Maps** pentru navigare;
- **Completează în 1 minut**: 1) „Sunt lângă concentrator” (GPS), 2) unde e – doar butoane, 3) fotografii;
- note, raportare problemă, istoric; modificările rămân pe dispozitiv și se exportă ca fișier pentru birou (până la Azure).

## Rulare locală
```
cd app
python -m http.server 8080
```
Deschide http://localhost:8080 (GPS-ul și camera merg pe `localhost` sau HTTPS).

Fișier unic (pentru telefon sau demo): `python tools/build_single.py` → `dist/koncentrator-kort.html`.

### Datele reale în aplicație
În aplicație: **Mere → Indlæs rigtige data**: 1) `koncentrator-data.json`, 2) folderul `poze_concentratoare`.
Datele și fotografiile se salvează doar în browserul acelui dispozitiv (IndexedDB) și pot fi șterse din același ecran.

### Publicare demo
GitHub Pages pentru un repository **privat** cere un plan GitHub plătit (Pro/Team). Demo-ul cu date fictive se poate arăta
și ca fișier unic. Pentru folosirea reală pe telefoane urmează Azure Static Web Apps + Entra ID (cazul IT 0008075).

## Datele reale (doar local)
Toate fișierele reale stau în OneDrive Kredsløb, de ex. `Infrastructura\date-reale\`:
```
python tools/mymaps_import.py "<export>.kmz" --out "<date-reale>/migration"
python tools/merge_ready.py "<READy>.csv" "<date-reale>/migration/concentrators.csv" "<date-reale>/migration/photos.csv" --out "<date-reale>/merged"
```
Apoi fișierul unic pentru aplicație:
```
python tools/build_dataset.py --radiomesh "<date-reale>/merged/concentrators_merged.csv" --photos "<date-reale>/poze_concentratoare/raport_poze.csv" --linkiq-sites "<date-reale>/linkiq_sites.csv" --linkiq-concentrators "<date-reale>/linkiq_koncentratorer.csv" --out "<date-reale>/koncentrator-data.json"
```
Clonați repository-ul în afara OneDrive (de ex. `C:\dev\koncentrator-kort`).
