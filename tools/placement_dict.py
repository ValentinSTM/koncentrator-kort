"""Build the placement dictionary from the real My Maps texts and measure coverage.
Writes: dictionary JSON (no real data, only vocabulary + aggregate counts) and a private per-concentrator parse."""
import csv, json, re, sys, collections

SRC, OUT_DICT, OUT_PARSE = sys.argv[1], sys.argv[2], sys.argv[3]

# key: (da, en, ro, regex on lower-case Danish free text)
D = {
 "room": [
  ("loft",          "Loft / loftrum",            "Loft / attic",             "Pod / mansardă",          r"\bloft|\bkip\b|loftlem|spær|tagetage"),
  ("garage",        "Garage",                    "Garage",                   "Garaj",                   r"garage"),
  ("carport",       "Carport",                   "Carport",                  "Carport",                 r"carport"),
  ("skur",          "Skur / redskabsrum",        "Shed / tool room",         "Skur / magazie unelte",   r"skur|redskab|havehus|udhus|øverum"),
  ("cykelskur",     "Cykelskur / cykelrum",      "Bike shed",                "Adăpost biciclete",       r"cykel"),
  ("affald",        "Skralderum / affaldsrum",   "Bin room",                 "Cameră deșeuri",          r"skralde|affald|container|renovation"),
  ("teknikrum",     "Teknikrum",                 "Technical room",           "Cameră tehnică",          r"teknikrum|teknikum|teknik rum|teknikskakt|skakt|ventilationsrum|pumperum|boilerrum|varmecentral|varmeveksler"),
  ("teknikskab",    "Teknikskab / højskab",      "Technical cabinet",        "Dulap tehnic",            r"teknikskab|højskab|el.?skab|fjernvarmeskab|\bskab"),
  ("kaelder",       "Kælder / kælderrum",        "Basement",                 "Subsol",                  r"kælder|kld\b|nedgang"),
  ("bryggers",      "Bryggers",                  "Utility room",             "Cameră utilitară",        r"bryggers|viktualie"),
  ("vaskerum",      "Vaskerum / vaskehus",       "Laundry room",             "Spălătorie",              r"vaske"),
  ("depotrum",      "Depot- / opbevaringsrum",   "Storage room",             "Debara / depozit",        r"depot|opbevaring|barnevognsrum|baglokale"),
  ("vaerksted",     "Værksted",                  "Workshop",                 "Atelier",                 r"værksted"),
  ("trappeopgang",  "Trappeopgang",              "Stairwell",                "Casa scării",             r"trappe|opgang"),
  ("faellesrum",    "Fælleshus / fællesrum",     "Common room / house",      "Spațiu comun",            r"fælles"),
  ("entre",         "Entré / gang / indgang",    "Entrance / hallway",       "Intrare / hol",           r"entr[eé]|\bgang\b|baggang|forgang|indgang|hoveddør|garderobe"),
  ("udvendig",      "Udvendig (mur / gavl / mast)", "Outside (wall / gable / mast)", "Exterior (perete / fronton / stâlp)", r"udv\b|udvendig|udenfor|\bgavl|\bmast\b|på taget"),
  ("halvtag",       "Halvtag / overdækket / udhæng", "Lean-to / covered area / eaves", "Șopron / zonă acoperită / streașină", r"halvtag|overdækket|udhæng"),
  ("lejlighed",     "I lejlighed / bolig",       "Inside a flat / home",     "În apartament / locuință", r"lejlighed|bolig"),
  ("ava_anlaeg",    "Kredsløb-/AVA-anlæg (bygværk, fjernvarmestation)", "Kredsløb/AVA site (plant, district-heating station)", "Instalație Kredsløb/AVA (clădire tehnică, stație termoficare)", r"\bava\b.*(anlæg|bygning|byg)|bygværk|byg\.|fjernvarme ?station|anlæg \d"),
  ("kontor",        "Kontor / viceværtsrum",     "Office / caretaker room",  "Birou / cameră administrator", r"kontor|vicevært(s|kontor)?$|tavlerum|rengøringsrum|opholdsrum|klublokal|lokalcenter"),
 ],
 "side": [
  ("venstre",       "Til venstre",               "On the left",              "În stânga",               r"venstre"),
  ("hoejre",        "Til højre",                 "On the right",             "În dreapta",              r"højre"),
  ("lige_frem",     "Lige frem",                 "Straight ahead",           "Drept înainte",           r"lige frem"),
  ("inden_for_doer","Inden for døren",           "Just inside the door",     "Imediat după ușă",        r"inden ?for (døren|porten)"),
  ("over_doer",     "Over døren",                "Above the door",           "Deasupra ușii",           r"over (døren|porten|hoveddør)"),
  ("bag_doer",      "Bag døren",                 "Behind the door",          "În spatele ușii",         r"bag (døren|porten)"),
  ("under_trappe",  "Under trappen",             "Under the stairs",         "Sub scară",               r"under trappe"),
  ("ved_siden_af",  "Ved siden af …",            "Next to …",                "Lângă …",                 r"ved siden af"),
  ("hjoerne",       "I hjørnet",                 "In the corner",            "În colț",                 r"hjørne"),
 ],
 "height": [
  ("under_loft",    "Oppe under loftet",         "Up under the ceiling",     "Sus, sub tavan",          r"under (loft|taget)|oppe"),
  ("paa_spaer",     "På et spær / i kip",        "On a rafter / at the ridge","Pe o căprior / la coamă", r"spær|\bkip\b"),
  ("oejenhoejde",   "I øjenhøjde",               "At eye level",             "La nivelul ochilor",      r"øjenhøjde"),
  ("gulv",          "Ved gulvet",                "Near the floor",           "Jos, lângă podea",        r"ved gulv|nede"),
 ],
 "floor": [
  ("kaelder_etage", "Kælderetage",               "Basement level",           "Nivel subsol",            r"kælder"),
  ("stue",          "Stueetage",                 "Ground floor",             "Parter",                  r"stue ?etage|\bstuen\b"),
  ("sal1",          "1. sal",                    "1st floor",                "Etajul 1",                r"\b1\.? ?sal"),
  ("sal2",          "2. sal",                    "2nd floor",                "Etajul 2",                r"\b2\.? ?sal"),
  ("oeverste",      "Øverste etage",             "Top floor",                "Ultimul etaj",            r"øverste"),
 ],
 "landmark": [
  ("gruppetavle",   "Gruppetavle / el-tavle",    "Fuse board",               "Tablou electric",         r"tavle"),
  ("varme",         "Varmeinstallation / varmemåler", "Heating installation / heat meter", "Instalație termică / contor căldură", r"varme"),
  ("loftlem",       "Loftlem",                   "Loft hatch",               "Trapă pod",               r"loftlem"),
  ("vindue",        "Vindue",                    "Window",                   "Fereastră",               r"vindue"),
  ("doer",          "Dør / port",                "Door / gate",              "Ușă / poartă",            r"dør|port"),
  ("trappe",        "Trappe",                    "Stairs",                   "Scară",                   r"trappe"),
  ("elevator",      "Elevator",                  "Lift",                     "Lift",                    r"elevator"),
 ],
 "antenna": [
  ("ant_udvendig",  "Antenne udvendig",          "External antenna",         "Antenă exterioară",       r"antenne\w* (er )?(blevet )?(flyttet )?(udv|udenfor|oppe på taget)|antenne udv|værksted antenne"),
  ("ant_mast",      "Antenne på mast",           "Antenna on mast",          "Antenă pe stâlp",         r"mast"),
  ("ant_tag",       "Antenne på tag / skorsten", "Antenna on roof / chimney","Antenă pe acoperiș / coș", r"på taget|skorsten"),
  ("ant_vindue",    "Antenne peger ud af vindue","Antenna points out of window","Antena iese pe fereastră", r"(antenne\w*).{0,30}vindue|peger ud af vinduet"),
  ("ant_retning",   "Antenne peger mod …",       "Antenna points towards …", "Antena e orientată spre …", r"peger"),
 ],
 "access": [
  ("vicevaert",     "Kontakt vicevært / varmemester", "Contact caretaker",  "Contact administrator / fochist", r"vicevært|varmemester|pedel"),
  ("noegle",        "Nøgle / nøgleboks",         "Key / key box",            "Cheie / cutie chei",      r"nøgle|key ?box"),
  ("kode",          "Kode",                      "Code",                     "Cod",                     r"\bkode"),
  ("kontaktperson", "Kontaktperson (navn / tlf.)","Contact person (name / phone)", "Persoană de contact (nume / tel.)", r"kontakt|spørg efter|telefonnummer|\b\d{8}\b"),
  ("institution",   "Institution (børnehave, skole, plejehjem …)", "Institution (kindergarten, school, care home …)", "Instituție (grădiniță, școală, cămin …)", r"børnehave|børnehus|dagtilbud|skole|plejehjem|hal\b|gym"),
 ],
 "status": [
  ("ukendt",        "Placering ukendt",          "Location unknown",         "Poziție necunoscută",     r"ukendt|usikker"),
  ("flyttet",       "Flyttet / udskiftet",       "Moved / replaced",         "Mutat / înlocuit",        r"flyttet|udskift|ny koncentrator|gl\.? ?kon|tidligere"),
  ("gps_afvigelse", "Adresse ≠ GPS-position",    "Address ≠ GPS position",   "Adresa ≠ poziția GPS",    r"kordinat|koordinat|gps|adressen|udfra"),
 ],
}
META = [  # codes found in the free text that are not location words
  ("sat_kode",  r"\bsat\s*\d\b"),
  ("n_kode",    r"\bn0\d\b"),
  ("ava",       r"\bava\b"),
]

rows = list(csv.DictReader(open(SRC, encoding="utf-8-sig"), delimiter=";"))
def place_text(x):
    return ";".join(x["physicalLocationRaw"].split(";")[2:]).strip(" ,;")

counts = {c: collections.Counter() for c in D}
meta = collections.Counter()
parsed = []
words_total = []
for x in rows:
    t = place_text(x); low = t.lower()
    rec = {"concentratorId": x["concentratorId"], "text": t}
    for cat, items in D.items():
        hits = [k for k, *_ , rx in items if re.search(rx, low)]
        if cat == "room" and len(hits) > 1:
            # 'teknikskab' is implied by 'teknikrum' words; keep the most specific first hit
            pass
        counts[cat].update(hits)
        rec[cat] = "|".join(hits)
    for k, rx in META:
        if re.search(rx, low): meta[k] += 1
    rec["hasText"] = bool(t)
    rec["wordCount"] = len(re.findall(r"\w+", t))
    words_total.append(rec["wordCount"])
    parsed.append(rec)

with_text = [p for p in parsed if p["hasText"]]
cov = {
  "concentrators": len(rows), "withPlaceText": len(with_text),
  "roomRecognised": sum(1 for p in with_text if p["room"]),
  "sideRecognised": sum(1 for p in with_text if p["side"]),
  "heightRecognised": sum(1 for p in with_text if p["height"]),
  "floorRecognised": sum(1 for p in with_text if p["floor"]),
  "landmarkRecognised": sum(1 for p in with_text if p["landmark"]),
  "detailed(room+side or height)": sum(1 for p in with_text if p["room"] and (p["side"] or p["height"])),
  "onlyOneWord": sum(1 for p in with_text if p["wordCount"] <= 1),
}
out = {"generatedFrom": "Google My Maps export, field ADR (place part), aggregate counts only",
       "coverage": cov, "metaCodesInText": dict(meta), "categories": {}}
for cat, items in D.items():
    out["categories"][cat] = [{"key": k, "da": da, "en": en, "ro": ro, "pattern": rx, "count": counts[cat][k]} for k, da, en, ro, rx in items]
json.dump(out, open(OUT_DICT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
with open(OUT_PARSE, "w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=list(parsed[0].keys()), delimiter=";"); w.writeheader(); w.writerows(parsed)
print(json.dumps(cov, indent=1)); print(dict(meta))
for cat in D: print(cat, counts[cat].most_common())
unrec = [p["text"] for p in with_text if not p["room"]]
print("\nUNRECOGNISED ROOM", len(unrec)); print(collections.Counter(unrec).most_common(60))
