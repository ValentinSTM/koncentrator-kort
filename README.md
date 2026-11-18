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
| `tools/google-apps-script/Code.gs` | serverul temporar pe Google Drive (fără secrete; codurile stau în proprietățile scriptului) |
| `tools/build_single.py` | face din `app/` un singur fișier HTML |

## Ce face aplicația (versiunea 1 – Radio Mesh)
- hartă cu poziția GPS a montatorului, concentratoarele Radio Mesh (cerc mov; inel galben = lipsesc informații) și site-urile LinkIQ (romb albastru);
- „Cele mai apropiate” cu distanță și săgeată de direcție;
- fișa: busolă cu distanța și direcția spre concentrator, **unde e montat** (descriere compusă din dicționar + nota originală), fotografii, adresă, coordonate, calitatea datelor;
- buton mare **Google Maps** pentru navigare;
- **Completează în 1 minut**: 1) „Sunt lângă concentrator” (GPS), 2) unde e – doar butoane, 3) fotografii;
- **poziție manuală** când GPS-ul lipsește (ex. PC cu localizarea oprită): 📌 → alegi pe hartă, scrii o adresă (căutată doar în datele încărcate) sau coordonate; aplicația o ține minte;
- note, raportare problemă, istoric;
- **spațiu comun temporar** (Google Drive prin Google Apps Script) până la Azure: toți văd aceleași date, sincronizare automată, coadă offline – vezi `docs/ro/LAGER-TEMPORAR-GOOGLE.md`; modificările rămân pe dispozitiv și se exportă ca fișier pentru birou (până la Azure).

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

### Publicare (ca la LinkIQ)
**Azure Static Web Apps prin Azure DevOps** – `azure-pipelines.yml`: la fiecare modificare pe `main` verifică aplicația și publică `app/`.
Accesul îl stabilește `app/staticwebapp.config.json`: doar utilizatorii invitați cu rolul `montor` intră (login Microsoft Entra ID; login cu GitHub blocat).
Necesar în Azure DevOps: un pipeline nou din acest repository și variabilele `deployment_token` (secretă) și `publish_enabled` = `true`.

**GitHub Pages (opțional, pentru test)** – `.github/workflows/pages.yml`: publică doar aplicația cu datele demo, fără login.
Se activează cu Settings → Pages → Source = *GitHub Actions* și variabila de repository `PAGES_ENABLED` = `true`.

Datele reale nu se publică în niciuna din variante: se încarcă pe dispozitiv (Mere → Indlæs rigtige data).
