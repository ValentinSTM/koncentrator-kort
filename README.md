# Koncentrator-kort

Aplicație de teren pentru găsirea concentratoarelor (Radio Mesh, LinkIQ și altele) în zona Aarhus:
hartă cu poziția montatorului, descrierea exactă a locului de montaj, fotografii, completarea fișelor din teren
și, mai târziu, depanare prin SMS și integrare în Azure / Microsoft 365.

**Repository privat. Nu conține și nu va conține date reale** – vezi `REGULI.md`.

## Structură
| Cale | Ce conține |
|---|---|
| `app/` | aplicația web (HTML + JavaScript, Leaflet inclus local), cu date demo fictive |
| `app/data/placement-dictionary.json` | dicționarul pozițiilor fizice (DA/EN/RO) |
| `docs/placement-dictionary.md` | dicționarul explicat, cu frecvențele din datele vechi |
| `tools/mymaps_import.py` | convertește exportul Google My Maps (KMZ/KML) într-un pachet de migrare |
| `tools/merge_ready.py` | combină lista READy (coordonate, listă actuală) cu datele din My Maps |
| `tools/placement_dict.py` | sursa dicționarului; regenerează `placement-dictionary.json` din descrierile vechi |
| `tools/dict_to_md.py` | regenerează `docs/placement-dictionary.md` |
| `tools/build_dataset.py` | face fișierul privat `koncentrator-data.json` (Radio Mesh + LinkIQ + fotografii) pe care aplicația îl încarcă local |
| `tools/windows/Descarca-poze.bat` | descarcă fotografiile din exportul My Maps (dublu-clic, Windows) |
| `tools/build_single.py` | face din `app/` un singur fișier HTML |

## Rulare locală
```
cd app
python -m http.server 8080
```
Deschide http://localhost:8080 (GPS-ul și camera merg pe `localhost` sau HTTPS).

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
