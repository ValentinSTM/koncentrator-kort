# Spațiu comun temporar pe Google Drive (până la Azure)

Toți montatorii și biroul văd aceleași date. Modificările din teren (poziție GPS, unde e montat, fotografii,
note, probleme) se trimit automat când telefonul are semnal; fără semnal stau la coadă pe telefon.

**Temporar.** Datele stau în contul Google al proprietarului. Când IT aprobă Azure, se mută acolo cu aceleași
fișiere și același format, iar folderul de pe Google Drive se șterge.

## Ce se salvează pe Google Drive
Folderul **„Koncentrator-kort (midlertidig)”** din Drive-ul tău:

| Ce | Unde |
|---|---|
| lista concentratoarelor (fără datele de contact ale persoanelor) | `data.json` |
| toate modificările din teren, câte un rând fiecare (cine, când, ce) | foaia Google **„Koncentrator-kort – ændringer”** |
| fotografiile (micșorate) | folderul `photos/` |

Datele de contact ale persoanelor (nume, telefoane) **nu** se urcă; rămân doar pe PC-ul biroului.

## Instalare (o singură dată, ~15 minute, pe PC)

1. Deschide https://script.google.com cu contul Google care va păstra datele → **New project**.
   Redenumește proiectul în `Koncentrator-kort lager`.
2. Șterge tot textul din `Code.gs` și lipește conținutul fișierului
   [`tools/google-apps-script/Code.gs`](../../tools/google-apps-script/Code.gs) din acest repository → **Save** (💾).
3. Sus, din lista de funcții alege **`setup`** → **Run**.
   - Google cere permisiuni: *Review permissions* → alegi contul → apare „Google hasn't verified this app”
     (e scriptul tău) → **Advanced** → **Go to Koncentrator-kort lager (unsafe)** → **Allow**.
4. Jos, în *Execution log*, apar:
   - linkul folderului creat;
   - **Kode for montører** (codul montatorilor);
   - **Kode for kontoret** (codul biroului).
   Notează cele două coduri într-un loc sigur. **Nu le pune pe GitHub.**
5. **Deploy → New deployment** → la ⚙ alege **Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
   - **Deploy** → copiază **Web app URL** (se termină cu `/exec`).

## Încărcarea datelor (birou, pe PC)

1. Deschide aplicația: https://valentinstm.github.io/koncentrator-kort/
2. **Mere → Indlæs rigtige data**: `koncentrator-data.json` și folderul `poze_concentratoare` (dacă nu le-ai încărcat deja).
3. **Mere → Fælles lager**: lipește *Web app URL*, scrie **codul biroului** → **Forbind** → scrie-ți numele.
4. **Upload data og fotos (kontor)**. Durează 1–2 minute (1.207 concentratoare + 49 de fotografii).
5. La *Montør-kode* scrie **codul montatorilor**, apoi:
   - **▦ Vis QR-kode** → montatorul scanează codul de pe ecranul PC-ului cu camera telefonului (merge și când politica firmei nu permite copierea linkurilor din Teams), sau
   - **🔗 Kopiér link** → trimiți linkul pe SMS / mail, unde se poate deschide direct.

## Pe telefonul montatorului

1. Scanează codul QR (sau deschide linkul) → aplicația se deschide în browserul telefonului, se configurează singură și încarcă datele.
2. Își scrie numele (apare în istoric la modificările lui).
3. **Mere → App på telefonen → Installér appen** (Android) sau în Safari: Partajare → «Adaugă pe ecranul principal» (iPhone).
4. Opțional, înainte de o zi fără semnal: **Mere → Hent alle fotos til brug uden internet**.

În antet: **DELT · ✓** = totul e trimis; **DELT · 2 ⇡** = 2 modificări așteaptă semnal; **⟳** = sincronizează acum.
Aplicația sincronizează la deschidere, la revenirea semnalului și la fiecare 2 minute.

## Biroul vede modificările
- în aplicație (aceleași date ca montatorii; istoric pe fiecare concentrator);
- direct în foaia Google **„Koncentrator-kort – ændringer”** (un rând pe modificare; se poate filtra și exporta în Excel).

## Întreținere
- **Lista nouă din READy:** încarci noul `koncentrator-data.json` local, apoi **Upload data og fotos (kontor)**.
  Modificările din teren se păstrează (sunt separate de listă).
- **Codul a ajuns unde nu trebuie:** în script rulezi `rotateCodes` → noi coduri în log → biroul se reconectează,
  montatorii primesc un link nou. Linkurile vechi nu mai merg.
- **Actualizarea scriptului** (dacă `Code.gs` se schimbă): lipești codul nou → **Deploy → Manage deployments → ✏ →
  Version: New version → Deploy**. Adresa rămâne aceeași.

## Limite și riscuri (de știut)
- Oricine are linkul de configurare poate citi lista (fără contacte) și poate adăuga modificări. Trimite-l doar echipei.
- Datele stau într-un cont Google, în afara Kredsløb. E o soluție temporară, până la aprobarea Azure.
- Google Apps Script are cote de utilizare; pentru câțiva utilizatori și câteva sute de modificări pe zi sunt suficiente.

## Mutarea în Azure (mai târziu)
1. Biroul descarcă `data.json`, foaia de modificări (Excel/CSV) și folderul `photos/`.
2. Se importă în stocarea aprobată de IT (SharePoint sau Azure); aplicația schimbă doar adresa serverului.
3. Se șterg folderul de pe Drive și proiectul Apps Script.
