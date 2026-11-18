#!/usr/bin/env python3
"""
Build ONE private data file for the app (koncentrator-data.json) from the real sources.
Run it on a company PC, inside the OneDrive "date-reale" folder. The output never goes to Git.

    python tools/build_dataset.py ^
        --radiomesh  "<date-reale>/merged/concentrators_merged.csv" ^
        --photos     "<date-reale>/poze_concentratoare/raport_poze.csv" ^
        --linkiq-sites "<date-reale>/linkiq_sites.csv" ^
        --linkiq-concentrators "<date-reale>/linkiq_koncentratorer.csv" ^
        --out "<date-reale>/koncentrator-data.json"

What it does
- Radio Mesh: READy list + My Maps text, classified with app/data/placement-dictionary.json.
  Old codes (SAT 6/7/8, N01) are removed from the description; the original text is kept in `legacyText`.
  Parts with phone numbers / contact persons are moved to `accessRestricted` (only shown to roles that need it).
  `ownSite` = Kredsløb/AVA installation (anlæg, bygværk, pumperum…): no appointment needed.
- Photos: rows with status ok from raport_poze.csv (Windows tool) or photos.csv (Python importer).
  Stored as relative paths "<id>/<file>", the app links them to the photo folder you select locally.
- LinkIQ: sites (pump stations etc.) with their concentrators (serial, model, firmware).
  Radio Mesh concentrators closer than 150 m to a LinkIQ site get `nearSite`.
Standard library only.
"""
import argparse, csv, json, math, re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PHONE_RE = re.compile(r"(?<!\d)(?:\+?45\s?)?(?:\d{2}\s?){3}\d{2}(?!\d)")
CONTACT_RE = re.compile(r"kontakt|spørg efter|info på ejer|telefonnummer|\btlf|\bnummer til|ring til", re.I)
META_RE = re.compile(r"\bSAT\s*\d\b|\bN0\d\b", re.I)


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        sample = f.read(2048); f.seek(0)
        delim = ";" if sample.count(";") >= sample.count(",") else ","
        return list(csv.DictReader(f, delimiter=delim))


def num(s):
    try:
        return float(str(s).strip().replace(",", "."))
    except (TypeError, ValueError):
        return None


def hav(a, b, c, d):
    r = math.pi / 180
    x = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(x))


def clean_description(text):
    """-> (description, restricted, removed_codes)"""
    t = re.sub(r"\s+", " ", text or "").strip()
    codes = META_RE.findall(t)
    t = META_RE.sub("", t)
    parts = [p.strip(" ,;:.") for p in re.split(r"[,;]", t)]
    keep, restricted = [], []
    for p in parts:
        if not p:
            continue
        (restricted if PHONE_RE.search(p) or CONTACT_RE.search(p) else keep).append(p)
    return ", ".join(keep), ", ".join(restricted), codes


def classify(text_place, text_all, dictionary):
    out = {}
    lp, la = (text_place or "").lower(), (text_all or "").lower()
    for cat, items in dictionary["categories"].items():
        hits = [i["key"] for i in items if re.search(i["pattern"], la if i["key"] == "eget_anlaeg" else lp)]
        if hits:
            out[cat] = hits
    return out


def photos_index(path):
    idx = {}
    if not path:
        return idx
    for r in read_csv(path):
        status = (r.get("Status") or r.get("status") or "").lower()
        if status not in ("ok", "deja_descarcata", "ok_cached"):
            continue
        cid = (r.get("Id") or r.get("concentratorId") or "").strip()
        full = (r.get("Fisier") or r.get("localPath") or "").replace("\\", "/")
        name = full.split("/")[-1]
        if cid and name:
            idx.setdefault(cid, []).append({"file": f"{cid}/{name}", "sha256": (r.get("Sha256") or r.get("sha256") or "").lower(), "source": "google_mymaps"})
    return idx


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--radiomesh", required=True)
    ap.add_argument("--photos")
    ap.add_argument("--linkiq-sites")
    ap.add_argument("--linkiq-concentrators")
    ap.add_argument("--dictionary", default=str(ROOT / "app/data/placement-dictionary.json"))
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    dictionary = json.loads(Path(a.dictionary).read_text(encoding="utf-8"))
    photos = photos_index(a.photos)
    sha_count = Counter(p["sha256"] for ps in photos.values() for p in ps if p["sha256"])

    sites, site_conc = [], {}
    if a.linkiq_concentrators:
        for r in read_csv(a.linkiq_concentrators):
            site_conc.setdefault(r["siteCode"].strip(), []).append({
                "serialNumber": r["serialNumber"].strip(), "model": r.get("deviceType", "").strip(),
                "firmware": r.get("firmware", "").strip(), "status": r.get("status", "").strip(),
                "active": str(r.get("active", "")).strip() in ("1", "true", "True")})
    if a.linkiq_sites:
        for r in read_csv(a.linkiq_sites):
            code = r["siteCode"].strip()
            sites.append({"siteId": code, "technologyId": "linkiq", "name": r.get("name", "").strip(),
                          "address": r.get("address", "").strip(), "latitude": num(r["latitude"]), "longitude": num(r["longitude"]),
                          "status": r.get("status", "").strip(), "ownSite": True,
                          "concentrators": site_conc.get(code, []),
                          "antenna": {"mount": "", "notes": ""}, "accessInstructions": "", "photos": []})

    conc = []
    for r in read_csv(a.radiomesh):
        cid = r["concentratorId"].strip()
        legacy = r.get("physicalLocationDescription", "") or ""
        raw = r.get("physicalLocationRaw", "") or ""
        desc, restricted, codes = clean_description(legacy)
        placement = classify(desc, raw, dictionary)
        lat, lng = num(r.get("latitude")), num(r.get("longitude"))
        near = ""
        if lat is not None:
            best = min(((hav(lat, lng, s["latitude"], s["longitude"]), s["siteId"]) for s in sites if s["latitude"] is not None), default=None)
            if best and best[0] <= 150:
                near = best[1]
        ph = photos.get(cid, [])
        for p in ph:
            p["sharedWithOther"] = bool(p["sha256"]) and sha_count[p["sha256"]] > 1
        conc.append({
            "concentratorId": cid, "technologyId": "radiomesh", "code": r.get("code", ""), "simNumber": r.get("simNumber", ""),
            "operationalStatus": r.get("operationalStatus", "Active"), "source": r.get("source", ""),
            "referenceAddress": r.get("referenceAddress", ""), "postalCode": r.get("postalCode", ""), "city": r.get("city", ""),
            "latitude": lat, "longitude": lng, "coordinateSource": r.get("coordinateSource", ""),
            "description": desc, "legacyText": legacy, "accessRestricted": restricted,
            "placement": placement, "ownSite": "eget_anlaeg" in placement.get("access", []),
            "nearSite": near, "photos": ph, "verificationStatus": "unverified", "lastVerifiedAt": None,
        })

    detailed = sum(1 for c in conc if c["placement"].get("room") and (c["placement"].get("side") or c["placement"].get("height")))
    out = {"schema": "koncentrator-kort/1", "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
           "classification": "INTERN – driftsdata Kredsløb. Må ikke deles eller lægges i Git.",
           "sites": sites, "concentrators": conc}
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"Radio Mesh: {len(conc)} concentratoare | cu coordonate {sum(1 for c in conc if c['latitude'] is not None)} | "
          f"cu foto {sum(1 for c in conc if c['photos'])} ({sum(len(c['photos']) for c in conc)} fotografii) | "
          f"loc recunoscut {sum(1 for c in conc if c['placement'].get('room'))} | detaliat {detailed} | "
          f"instalații proprii {sum(1 for c in conc if c['ownSite'])} | lângă un site LinkIQ {sum(1 for c in conc if c['nearSite'])} | "
          f"cu date de contact mutate în câmpul restricționat {sum(1 for c in conc if c['accessRestricted'])}")
    print(f"LinkIQ: {len(sites)} site-uri | {sum(len(s['concentrators']) for s in sites)} concentratoare | "
          f"site-uri fără nume {sum(1 for s in sites if not s['name'])} | "
          f"concentratoare fără site în lista de site-uri {sum(len(v) for k, v in site_conc.items() if k not in {s['siteId'] for s in sites})}")
    print(f"-> {a.out}")


if __name__ == "__main__":
    main()
