# Dicționarul pozițiilor fizice (DA / EN / RO)

Construit din descrierile reale din Google My Maps. Conține doar vocabularul și numărări agregate, nicio adresă și nicio dată despre concentratoare individuale.

## Ce arată datele existente

| Indicator | Număr |
|---|---:|
| concentratoare | 1162 |
| cu text despre locul fizic | 1047 |
| tipul locului recunoscut automat | 975 |
| descriere de un singur cuvânt (ex. „Skur”) | 516 |
| cu parte (stânga/dreapta/după ușă…) | 93 |
| cu înălțime (sub tavan, pe căprior) | 98 |
| cu reper (ușă, tablou, trapă…) | 231 |
| **descriere detaliată** (loc + parte sau înălțime) | **135** |

Concluzie: aproape toate au tipul locului, dar doar ~13% au destule detalii. Fluxul „Completează în 1 minut” cere exact categoriile de mai jos, din butoane.

Codurile `SAT 6/7/8` și `N01` din textele vechi (etape istorice ale rețelei Radio Mesh) se elimină din descriere la import; textul original rămâne păstrat.

## Rum / tip loc / room type

Unde e montat (camera, construcția).

| Cheie | Dansk | English | Română | Frecvență |
|---|---|---|---|---:|
| `skur` | Skur / redskabsrum | Shed / tool room | Magazie / magazie de unelte | 284 |
| `loft` | Loft / loftrum | Loft / attic | Pod / mansardă | 224 |
| `garage` | Garage | Garage | Garaj | 136 |
| `teknikrum` | Teknikrum | Technical room | Cameră tehnică | 88 |
| `carport` | Carport | Carport | Carport | 69 |
| `teknikskab` | Teknikskab / højskab | Technical cabinet | Dulap tehnic | 62 |
| `kaelder` | Kælder / kælderrum | Basement | Subsol | 57 |
| `trappeopgang` | Trappeopgang | Stairwell | Casa scării | 42 |
| `bryggers` | Bryggers | Utility room | Cameră utilitară | 39 |
| `depotrum` | Depot- / opbevaringsrum | Storage room | Debara / depozit | 36 |
| `vaerksted` | Værksted | Workshop | Atelier | 35 |
| `entre` | Entré / gang / indgang | Entrance / hallway | Intrare / hol | 32 |
| `cykelskur` | Cykelskur / cykelrum | Bike shed | Magazie / adăpost biciclete | 26 |
| `udvendig` | Udvendig (mur / gavl / mast) | Outside (wall / gable / mast) | Exterior (perete / fronton / stâlp) | 24 |
| `faellesrum` | Fælleshus / fællesrum | Common room / house | Spațiu comun | 22 |
| `affald` | Skralderum / affaldsrum | Bin room | Cameră deșeuri | 19 |
| `vaskerum` | Vaskerum / vaskehus | Laundry room | Spălătorie | 19 |
| `kontor` | Kontor / viceværtsrum | Office / caretaker room | Birou / cameră administrator | 16 |
| `halvtag` | Halvtag / overdækket / udhæng | Lean-to / covered area / eaves | Șopron / zonă acoperită / streașină | 14 |
| `lejlighed` | I lejlighed / bolig | Inside a flat / home | În apartament / locuință | 10 |
| `anlaeg_bygning` | Eget anlæg (Kredsløb/AVA: bygværk, pumperum, station) | Own site (Kredsløb/AVA: plant, pump room, station) | Instalație proprie (Kredsløb/AVA: clădire tehnică, cameră pompe, stație) | 9 |

## Side / partea / side

Unde, față de ușă sau de intrare.

| Cheie | Dansk | English | Română | Frecvență |
|---|---|---|---|---:|
| `venstre` | Til venstre | On the left | În stânga | 45 |
| `inden_for_doer` | Inden for døren | Just inside the door | Imediat după ușă | 33 |
| `hoejre` | Til højre | On the right | În dreapta | 22 |
| `over_doer` | Over døren | Above the door | Deasupra ușii | 10 |
| `hjoerne` | I hjørnet | In the corner | În colț | 7 |
| `ved_siden_af` | Ved siden af … | Next to … | Lângă … | 6 |
| `under_trappe` | Under trappen | Under the stairs | Sub scară | 3 |
| `lige_frem` | Lige frem | Straight ahead | Drept înainte | 2 |
| `bag_doer` | Bag døren | Behind the door | În spatele ușii | 0 |

## Højde / înălțimea / height

| Cheie | Dansk | English | Română | Frecvență |
|---|---|---|---|---:|
| `under_loft` | Oppe under loftet | Up under the ceiling | Sus, sub tavan | 91 |
| `paa_spaer` | På et spær / i kip | On a rafter / at the ridge | Pe o căprior / la coamă | 21 |
| `oejenhoejde` | I øjenhøjde | At eye level | La nivelul ochilor | 0 |
| `gulv` | Ved gulvet | Near the floor | Jos, lângă podea | 0 |

## Etage / etaj / floor

| Cheie | Dansk | English | Română | Frecvență |
|---|---|---|---|---:|
| `kaelder_etage` | Kælderetage | Basement level | Nivel subsol | 57 |
| `sal4` | 4. sal | 4th floor | Etajul 4 | 11 |
| `sal1` | 1. sal | 1st floor | Etajul 1 | 9 |
| `sal2` | 2. sal | 2nd floor | Etajul 2 | 7 |
| `sal3` | 3. sal | 3rd floor | Etajul 3 | 6 |
| `stue` | Stueetage | Ground floor | Parter | 1 |
| `sal6plus` | 6. sal eller højere | 6th floor or higher | Etajul 6 sau mai sus | 1 |
| `oeverste` | Øverste etage | Top floor | Ultimul etaj | 1 |
| `sal5` | 5. sal | 5th floor | Etajul 5 | 0 |

## Pejlemærke / reper / landmark

Obiectul lângă care e montat.

| Cheie | Dansk | English | Română | Frecvență |
|---|---|---|---|---:|
| `doer` | Dør / port | Door / gate | Ușă / poartă | 129 |
| `trappe` | Trappe | Stairs | Scară | 31 |
| `gruppetavle` | Gruppetavle / el-tavle | Fuse board | Tablou electric | 26 |
| `varme` | Varmeinstallation / varmemåler | Heating installation / heat meter | Instalație termică / contor căldură | 24 |
| `loftlem` | Loftlem | Loft hatch | Trapă pod | 16 |
| `vindue` | Vindue | Window | Fereastră | 13 |
| `elevator` | Elevator | Lift | Lift | 2 |

## Antenne / antena / antenna

Unde e antena, dacă nu e lângă concentrator.

| Cheie | Dansk | English | Română | Frecvență |
|---|---|---|---|---:|
| `ant_udvendig` | Antenne udvendig | External antenna | Antenă exterioară | 13 |
| `ant_retning` | Antenne peger mod … | Antenna points towards … | Antena e orientată spre … | 9 |
| `ant_vindue` | Antenne peger ud af vindue | Antenna points out of window | Antena iese pe fereastră | 7 |
| `ant_mast` | Antenne på mast | Antenna on mast | Antenă pe stâlp | 2 |
| `ant_tag` | Antenne på tag / skorsten | Antenna on roof / chimney | Antenă pe acoperiș / coș | 1 |

## Adgang / acces / access

Cum intri. `eget_anlaeg` = instalație proprie Kredsløb/AVA, nu e nevoie de programare. Numele și telefoanele persoanelor NU stau în descriere (GDPR), ci în câmpul de acces restricționat.

| Cheie | Dansk | English | Română | Frecvență |
|---|---|---|---|---:|
| `institution` | Institution (børnehave, skole, plejehjem …) | Institution (kindergarten, school, care home …) | Instituție (grădiniță, școală, cămin …) | 23 |
| `vicevaert` | Kontakt vicevært / varmemester | Contact caretaker | Contact administrator / fochist | 22 |
| `eget_anlaeg` | Eget anlæg – ingen aftale nødvendig | Own site – no appointment needed | Instalație proprie – nu e nevoie de programare | 18 |
| `kontaktperson` | Kontaktperson (navn / tlf.) | Contact person (name / phone) | Persoană de contact (nume / tel.) | 4 |
| `noegle` | Nøgle / nøgleboks | Key / key box | Cheie / cutie chei | 2 |
| `kode` | Kode | Code | Cod | 2 |

## Status / stare informație / info status

| Cheie | Dansk | English | Română | Frecvență |
|---|---|---|---|---:|
| `ukendt` | Placering ukendt | Location unknown | Poziție necunoscută | 45 |
| `flyttet` | Flyttet / udskiftet | Moved / replaced | Mutat / înlocuit | 20 |
| `gps_afvigelse` | Adresse ≠ GPS-position | Address ≠ GPS position | Adresa ≠ poziția GPS | 3 |

## Cum se folosește

- **La import:** `tools/build_dataset.py` aplică tiparele (`pattern`) pe textul vechi și propune categoriile. Textul original se păstrează neschimbat.
- **În teren:** montatorul alege din aceleași chei, prin butoane; aplicația compune descrierea în limba fiecărui utilizator.
- Cheile noi se adaugă în `tools/placement_dict.py` (sursa) și se regenerează JSON-ul și acest document.
