#!/usr/bin/env python3
"""
Google My Maps KMZ/KML -> normalised migration package (for Koncentrator Finder / Azure).

Official input only: the KMZ/KML that My Maps itself exports
(Export to KML/KMZ, "Entire map", WITHOUT "Keep data up to date with network link").
No Google login, no cookies, no undocumented endpoints.

    python mymaps_import.py export.kmz --out migration             # analyse + convert (no network)
    python mymaps_import.py export.kmz --out migration --download-photos   # also fetch photos
    (re-running is safe: photos already downloaded are skipped -> resumable)

Output (all private - never commit to GitHub):
    migration/concentrators.csv          one row per concentrator, normalised
    migration/concentrators.geojson      only rows that have coordinates
    migration/photos.csv                 photo manifest: concentrator <-> photo, status, sha256
    migration/photos/<concentratorId>/<photoId>.<ext>
    migration/needs_geocoding.csv        rows with a street address but no coordinates
    migration/issues.csv                 every data problem found, one per line
    migration/layers/<layer>.csv         the other layers, raw (all fields kept)
    migration/reconciliation.md / .json  counts: source vs. converted vs. problems
    migration/logs/import.log
Standard library only (Python 3.9+).
"""
from __future__ import annotations

import argparse, csv, hashlib, html, json, logging, re, sys, time, urllib.error, urllib.request, zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import xml.etree.ElementTree as ET

KML_NS = {"k": "http://www.opengis.net/kml/2.2"}
CONC_LAYER_HINT = "koncentrator"
# Denmark-ish bounding box: catches swapped lat/lng and garbage
LAT_RANGE, LNG_RANGE = (54.4, 57.9), (7.8, 15.3)
COORD_RE = re.compile(r"^\s*(-?\d{1,3}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)\s*$")
POSTAL_RE = re.compile(r"\b(\d{4})\b")
IMG_SRC_RE = re.compile(r'<img[^>]+src="([^"]+)"', re.I)
PLACE_KEYWORDS = [  # Danish words in the free text -> locationType used by the app
    ("affald", r"affald|skralde|renovation|miljøst"), ("skur", r"skur|redskab"), ("kaelder", r"kælder|kaelder|\bkld\b"),
    ("loft", r"\bloft"), ("teknikrum", r"teknik|varme|vekslerrum|fjernvarme|unit"), ("maalerrum", r"målerrum|maalerrum|måler"),
    ("faellesrum", r"fælles|vaskeri"), ("teknikskab", r"skab|tavle"), ("ydervaeg", r"\bmur\b|væg|gavl|facade"),
    ("tilbygning", r"garage|carport|tilbygning|udhus"),
]
MAX_PHOTO_BYTES = 25 * 1024 * 1024
MIME_EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/heic": ".heic"}

log = logging.getLogger("import")


# ---------------------------------------------------------------- helpers
def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def text(el, path: str) -> str:
    v = el.findtext(path, namespaces=KML_NS)
    return (v or "").strip()


def slug(s: str, n: int = 60) -> str:
    s = re.sub(r"[^\w\-]+", "_", s, flags=re.UNICODE).strip("_")
    return s[:n] or "layer"


def parse_coord(s: str):
    """'56.10000, 10.10000' -> (56.1, 10.1) if it is a plausible Danish lat,lng."""
    m = COORD_RE.match(s or "")
    if not m:
        return None
    a, b = float(m.group(1)), float(m.group(2))
    if LAT_RANGE[0] <= a <= LAT_RANGE[1] and LNG_RANGE[0] <= b <= LNG_RANGE[1]:
        return a, b
    if LAT_RANGE[0] <= b <= LAT_RANGE[1] and LNG_RANGE[0] <= a <= LNG_RANGE[1]:
        return b, a  # swapped
    return None


def excel_number(s: str) -> str:
    """Excel turned IDs/phone numbers into floats: '1.2345678E7' -> '12345678', '10001.0' -> '10001'."""
    s = (s or "").strip()
    if not s:
        return ""
    try:
        f = float(s)
        if f.is_integer():
            return str(int(f))
    except ValueError:
        pass
    return s


def guess_location_type(free_text: str) -> str:
    low = free_text.lower()
    for key, rx in PLACE_KEYWORDS:
        if re.search(rx, low):
            return key
    return ""


def redact_url(u: str) -> str:
    """Never log full hosted-image URLs (they work as capability links)."""
    return u[:60] + "…" if len(u) > 60 else u


# ---------------------------------------------------------------- KML reading
def load_kml(path: Path) -> ET.Element:
    if path.suffix.lower() == ".kmz":
        with zipfile.ZipFile(path) as z:
            name = "doc.kml" if "doc.kml" in z.namelist() else next(n for n in z.namelist() if n.lower().endswith(".kml"))
            data = z.read(name)
    else:
        data = path.read_bytes()
    root = ET.fromstring(data)
    if root.find(".//k:NetworkLink", KML_NS) is not None and root.find(".//k:Placemark", KML_NS) is None:
        raise SystemExit(
            "This file only contains a NetworkLink (a pointer to the live Google map), no data.\n"
            "Re-export from My Maps WITHOUT 'Keep data up to date with network link'.")
    return root


def placemark_record(pm: ET.Element) -> dict:
    data = {}
    for d in pm.findall(".//k:ExtendedData/k:Data", KML_NS):
        data[d.get("name") or ""] = text(d, "k:value")
    coords = None
    c = pm.find(".//k:Point/k:coordinates", KML_NS)
    if c is not None and c.text:
        parts = c.text.strip().split(",")
        try:
            coords = (float(parts[1]), float(parts[0]))
        except (IndexError, ValueError):
            coords = None
    geom = next((g for g in ("Point", "LineString", "Polygon", "MultiGeometry") if pm.find(f".//k:{g}", KML_NS) is not None), "")
    desc = text(pm, "k:description")
    media = data.get("gx_media_links", "").split()
    media += [html.unescape(u) for u in IMG_SRC_RE.findall(desc)]
    seen, photos = set(), []
    for u in media:  # keep order, drop duplicates (same photo appears in description and gx_media_links)
        key = u.split("?")[0]
        if key not in seen:
            seen.add(key)
            photos.append(u)
    return {"name": text(pm, "k:name"), "address": text(pm, "k:address"), "description": desc,
            "style": text(pm, "k:styleUrl"), "data": data, "point": coords, "geometry": geom, "photos": photos}


# ---------------------------------------------------------------- concentrator layer mapping
def map_concentrator(rec: dict, layer: str, issues: list) -> dict:
    d = rec["data"]
    cid = excel_number(rec["name"])
    code = d.get("tekst", "").strip()
    raw_adr = d.get("ADR", "")
    parts = [p.strip() for p in raw_adr.split(";")]
    street = parts[0] if parts else ""
    postal = ""
    m = POSTAL_RE.search(" ".join(parts[1:2])) or POSTAL_RE.search(raw_adr) or POSTAL_RE.search(d.get("Adr", ""))
    if m:
        postal = m.group(1)
    place = "; ".join(p for p in parts[2:] if p.strip(" ,")).strip(" ,") if len(parts) >= 3 else ""
    street = re.sub(r"\s+\d{4}\s+\D+$", "", street).strip()  # "Vej 1 B 8260 Viby   Affald…" keeps "Vej 1 B" … best effort
    # coordinate resolution, most trustworthy first
    lat = lng = None
    source = ""
    for label, candidate in (("kml_point", rec["point"]), ("address_field", parse_coord(rec["address"])),
                             ("Adr_field", parse_coord(d.get("Adr", ""))), ("unnamed1_field", parse_coord(d.get("unnamed (1)", "")))):
        if candidate:
            lat, lng, source = candidate[0], candidate[1], label
            break
    ref_address = d.get("Adr", "") if not parse_coord(d.get("Adr", "")) else rec["address"] if not parse_coord(rec["address"]) else ""
    if not ref_address:
        ref_address = street + (f", {postal}" if postal else "")
    sim = excel_number(d.get("mobil", ""))
    row = {
        "concentratorId": cid, "code": code, "simNumber": sim,
        "referenceAddress": re.sub(r"\s+", " ", ref_address).strip(), "postalCode": postal,
        "physicalLocationRaw": re.sub(r"\s+", " ", raw_adr).strip(),
        "physicalLocationDescription": place, "locationTypeGuess": guess_location_type(place) or guess_location_type(raw_adr),
        "latitude": f"{lat:.6f}" if lat is not None else "", "longitude": f"{lng:.6f}" if lng is not None else "",
        "coordinateSource": source or "none", "verificationStatus": "unverified",
        "photoCount": len(rec["photos"]), "value_Værdi": d.get("Værdi", ""), "extra_unnamed1": d.get("unnamed (1)", ""),
        "geocodeInput": rec["address"] if not parse_coord(rec["address"]) else "",
        "sourceLayer": layer, "sourceName": rec["name"],
    }
    def issue(kind, detail=""):
        issues.append({"layer": layer, "sourceName": rec["name"], "concentratorId": cid, "issue": kind, "detail": detail})
    if not cid:
        issue("missing_id")
    if not code:
        issue("missing_code_tekst")
    elif cid and not code.replace(" ", "").endswith(cid):
        issue("id_code_mismatch", f"name={cid} tekst={code}")
    if not source:
        issue("no_coordinates", "needs geocoding from address" if row["geocodeInput"] or street else "no address either")
    if not sim:
        issue("missing_sim")
    elif not re.fullmatch(r"\d{8}", sim):
        issue("sim_not_8_digits", sim)
    if not place:
        issue("no_physical_place_text")
    if not row["locationTypeGuess"]:
        issue("location_type_unknown")
    return row


# ---------------------------------------------------------------- photo download (optional)
def download_photos(rows_photos: list, out: Path, pause: float, max_retries: int = 5) -> None:
    for ph in rows_photos:
        target_dir = out / "photos" / ph["concentratorId"]
        existing = list(target_dir.glob(ph["photoId"] + ".*")) if target_dir.exists() else []
        if existing:
            data = existing[0].read_bytes()
            ph.update(status="ok_cached", localPath=str(existing[0].relative_to(out)), sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
            continue
        url = ph["_url"].replace("authuser=0&", "")  # anonymous request; we never send Google cookies
        delay = 2.0
        for attempt in range(1, max_retries + 1):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "koncentrator-migration/1.0"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    mime = (r.headers.get_content_type() or "").lower()
                    data = r.read(MAX_PHOTO_BYTES + 1)
                if len(data) > MAX_PHOTO_BYTES:
                    ph.update(status="too_large"); break
                if not mime.startswith("image/"):
                    ph.update(status="not_an_image", error=mime); break
                ext = MIME_EXT.get(mime, ".bin")
                target_dir.mkdir(parents=True, exist_ok=True)
                p = target_dir / (ph["photoId"] + ext)
                p.write_bytes(data)
                ph.update(status="ok", mime=mime, localPath=str(p.relative_to(out)), sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
                log.info("photo ok %s %s", ph["photoId"], mime)
                break
            except urllib.error.HTTPError as e:
                if e.code == 429 or 500 <= e.code < 600:
                    wait = float(e.headers.get("Retry-After") or delay)
                    log.warning("photo %s HTTP %s, retry %d in %.0fs", ph["photoId"], e.code, attempt, wait)
                    time.sleep(wait); delay *= 2; continue
                ph.update(status="forbidden_or_expired" if e.code in (401, 403, 404, 410) else "http_error", error=f"HTTP {e.code}")
                log.warning("photo %s failed HTTP %s (%s)", ph["photoId"], e.code, redact_url(url))
                break
            except Exception as e:  # network, timeout
                if attempt == max_retries:
                    ph.update(status="network_error", error=type(e).__name__)
                    log.warning("photo %s network error %s", ph["photoId"], type(e).__name__)
                else:
                    time.sleep(delay); delay *= 2
        time.sleep(pause)
    dup = Counter(p["sha256"] for p in rows_photos if p.get("sha256"))
    for p in rows_photos:
        if p.get("sha256") and dup[p["sha256"]] > 1:
            p["duplicateOf"] = next(q["photoId"] for q in rows_photos if q.get("sha256") == p["sha256"])


# ---------------------------------------------------------------- writers
def write_csv(path: Path, rows: list, fields: list | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = fields or (list(rows[0].keys()) if rows else ["empty"])
    with path.open("w", newline="", encoding="utf-8-sig") as f:  # BOM so Excel shows æøå correctly
        w = csv.DictWriter(f, fieldnames=fields, delimiter=";", extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", type=Path, help="KMZ or KML exported from Google My Maps")
    ap.add_argument("--out", type=Path, default=Path("migration"))
    ap.add_argument("--download-photos", action="store_true", help="fetch photos (needs internet; resumable)")
    ap.add_argument("--pause", type=float, default=0.5, help="seconds between photo requests")
    a = ap.parse_args(argv)

    out = a.out
    (out / "logs").mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.FileHandler(out / "logs" / "import.log", encoding="utf-8"), logging.StreamHandler()])
    src_bytes = a.source.read_bytes()
    root = load_kml(a.source)
    doc_name = text(root, "k:Document/k:name")
    log.info("source %s (%d bytes, sha256 %s) map '%s'", a.source.name, len(src_bytes), hashlib.sha256(src_bytes).hexdigest()[:16], doc_name)

    issues, layers_summary, conc_rows, photo_rows = [], [], [], []
    folders = list(root.iter(f"{{{KML_NS['k']}}}Folder"))
    doc = root.find("k:Document", KML_NS)
    if doc is not None and doc.findall("k:Placemark", KML_NS):
        folders.insert(0, doc)  # single-layer export: placemarks sit directly in <Document>
    for folder in folders:
        layer = text(folder, "k:name")
        recs = [placemark_record(pm) for pm in folder.findall("k:Placemark", KML_NS)]
        geoms = Counter(r["geometry"] or "none" for r in recs)
        is_conc = CONC_LAYER_HINT in layer.lower()
        layers_summary.append({"layer": layer, "placemarks": len(recs), "geometry": dict(geoms),
                               "withPhotos": sum(1 for r in recs if r["photos"]), "photos": sum(len(r["photos"]) for r in recs),
                               "migratedAs": "concentrators" if is_conc else "raw layer (review)"})
        if is_conc:
            for r in recs:
                row = map_concentrator(r, layer, issues)
                conc_rows.append(row)
                for i, u in enumerate(r["photos"], 1):
                    photo_rows.append({"photoId": f"{row['concentratorId'] or slug(r['name'])}-mm{i:02d}", "concentratorId": row["concentratorId"],
                                       "source": "google_mymaps", "originalRefHash": hashlib.sha256(u.split("?")[0].encode()).hexdigest()[:16],
                                       "status": "not_downloaded", "isPrimary": i == 1, "_url": u})
        else:
            raw = []
            for r in recs:
                base = {"name": r["name"], "geometry": r["geometry"], "address": r["address"],
                        "lat": r["point"][0] if r["point"] else "", "lng": r["point"][1] if r["point"] else "", "photos": len(r["photos"])}
                base.update({f"f_{k}": v for k, v in r["data"].items() if k != "gx_media_links"})
                raw.append(base)
            fields = sorted({k for x in raw for k in x}, key=lambda k: (not k in ("name", "geometry", "address", "lat", "lng", "photos"), k))
            write_csv(out / "layers" / f"{slug(layer)}.csv", raw, fields)

    # duplicates inside the concentrator layer
    for key in ("concentratorId", "code"):
        cnt = Counter(r[key] for r in conc_rows if r[key])
        for v, n in cnt.items():
            if n > 1:
                issues.append({"layer": "", "sourceName": "", "concentratorId": v if key == "concentratorId" else "", "issue": f"duplicate_{key}", "detail": f"{v} x{n}"})
    cnt = Counter((r["latitude"], r["longitude"]) for r in conc_rows if r["latitude"])
    for (la, lo), n in cnt.items():
        if n > 1:
            issues.append({"layer": "", "sourceName": "", "concentratorId": "", "issue": "same_coordinates", "detail": f"{la},{lo} x{n}"})

    if a.download_photos:
        log.info("downloading %d photos (resumable)…", len(photo_rows))
        download_photos(photo_rows, out, a.pause)

    # write outputs
    write_csv(out / "concentrators.csv", conc_rows)
    write_csv(out / "needs_geocoding.csv", [r for r in conc_rows if r["coordinateSource"] == "none"],
              ["concentratorId", "code", "geocodeInput", "referenceAddress", "postalCode", "physicalLocationRaw"])
    write_csv(out / "photos.csv", photo_rows, ["photoId", "concentratorId", "isPrimary", "source", "status", "error", "mime", "bytes",
                                               "sha256", "duplicateOf", "localPath", "originalRefHash"])
    write_csv(out / "issues.csv", issues, ["issue", "concentratorId", "sourceName", "layer", "detail"])
    feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [float(r["longitude"]), float(r["latitude"])]},
              "properties": {k: v for k, v in r.items() if k not in ("latitude", "longitude")}} for r in conc_rows if r["latitude"]]
    (out / "concentrators.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False), encoding="utf-8")
    # photo URLs are kept in a separate file: they work as links and must not be shared or logged
    (out / "photo_urls.private.json").write_text(json.dumps({p["photoId"]: p["_url"] for p in photo_rows}, indent=1), encoding="utf-8")

    ic = Counter(i["issue"] for i in issues)
    ps = Counter(p["status"] for p in photo_rows)
    rec = {
        "generatedAt": now_iso(), "source": a.source.name, "map": doc_name, "layers": layers_summary,
        "concentrators": {"found": len(conc_rows), "converted": len(conc_rows),
                          "withCoordinates": sum(1 for r in conc_rows if r["latitude"]),
                          "coordinateSources": dict(Counter(r["coordinateSource"] for r in conc_rows)),
                          "withoutCoordinates": sum(1 for r in conc_rows if not r["latitude"]),
                          "withoutId": ic["missing_id"], "withPhotos": sum(1 for r in conc_rows if r["photoCount"]),
                          "withPhysicalPlaceText": sum(1 for r in conc_rows if r["physicalLocationDescription"]),
                          "locationTypeGuessed": dict(Counter(r["locationTypeGuess"] or "unknown" for r in conc_rows))},
        "photos": {"referenced": len(photo_rows), "byStatus": dict(ps)},
        "issues": dict(ic),
    }
    (out / "reconciliation.json").write_text(json.dumps(rec, indent=2, ensure_ascii=False), encoding="utf-8")
    md = [f"# Raport de reconciliere – {doc_name}", "", f"Generat: {rec['generatedAt']} · Sursă: `{a.source.name}`", "",
          "## Straturi", "", "| Strat | Elemente | Geometrie | Cu foto | Foto | Migrat ca |", "|---|---:|---|---:|---:|---|"]
    md += [f"| {l['layer']} | {l['placemarks']} | {l['geometry']} | {l['withPhotos']} | {l['photos']} | {l['migratedAs']} |" for l in layers_summary]
    c = rec["concentrators"]
    md += ["", "## Concentratoare", "", "| Indicator | Număr |", "|---|---:|",
           f"| găsite în sursă | {c['found']} |", f"| convertite | {c['converted']} |", f"| cu coordonate | {c['withCoordinates']} |",
           f"| fără coordonate (de geocodat) | {c['withoutCoordinates']} |", f"| fără identificator | {c['withoutId']} |",
           f"| cu fotografii | {c['withPhotos']} |", f"| cu text despre locul fizic | {c['withPhysicalPlaceText']} |", "",
           "Sursa coordonatelor: " + ", ".join(f"{k}: {v}" for k, v in c["coordinateSources"].items()), "",
           "Tip loc (estimat din text): " + ", ".join(f"{k}: {v}" for k, v in sorted(c["locationTypeGuessed"].items(), key=lambda x: -x[1])), "",
           "## Fotografii", "", f"Referite: {rec['photos']['referenced']} · " + ", ".join(f"{k}: {v}" for k, v in ps.items()), "",
           "## Probleme", "", "| Problemă | Număr |", "|---|---:|"] + [f"| {k} | {v} |" for k, v in ic.most_common()]
    (out / "reconciliation.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    log.info("done: %d concentrators, %d photos referenced, %d issues -> %s", len(conc_rows), len(photo_rows), len(issues), out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
