#!/usr/bin/env python3
"""
Merge the Kamstrup READy export (current concentrators + coordinates) with the
My Maps migration package (photos, physical-location text, field notes).

    python merge_ready.py ready.csv migration/concentrators.csv migration/photos.csv --out merged

READy is the master list: it decides which concentrators exist today and where.
My Maps adds what READy does not have: where exactly the unit sits, access hints, photos.
Concentrators that are only in My Maps are kept, flagged "RequiresVerification" (never dropped).
Standard library only.
"""
import argparse, csv, math, re
from collections import Counter
from pathlib import Path

LAT, LNG = (54.4, 57.9), (7.8, 15.3)


def num(s):
    s = (s or "").strip().replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def phone(s):
    d = re.sub(r"\D", "", s or "")
    return d[2:] if len(d) == 10 and d.startswith("45") else d


def hav(a, b, c, d):
    r = math.pi / 180
    x = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(x))


def read(p):
    with open(p, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f, delimiter=";"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ready"); ap.add_argument("mymaps"); ap.add_argument("photos")
    ap.add_argument("--out", type=Path, default=Path("merged"))
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)

    ready, issues = {}, []
    for i, r in enumerate(read(a.ready), 2):
        extra = r.pop(None, None)
        if extra:  # row with one column too many: values shifted one step right
            keys = list(r.keys())
            vals = list(r.values()) + extra
            k = keys.index("Telefon")
            vals = vals[:k + 1] + vals[k + 2:]  # drop the stray value after Telefon
            r = dict(zip(keys, vals))
            issues.append({"concentratorId": r["Målernummer"], "issue": "ready_row_shifted_fixed", "detail": f"line {i}"})
        lat, lng = num(r["Breddegrad"]), num(r["Længdegrad"])
        if lat is not None and lng is not None and not (LAT[0] <= lat <= LAT[1] and LNG[0] <= lng <= LNG[1]):
            if LAT[0] <= lng <= LAT[1]:
                lat, lng = lng, lat
            else:
                issues.append({"concentratorId": r["Målernummer"], "issue": "ready_bad_coordinates", "detail": f"{lat},{lng}"}); lat = lng = None
        r["_lat"], r["_lng"] = lat, lng
        ready[r["Målernummer"].strip()] = r

    mm = {r["concentratorId"]: r for r in read(a.mymaps) if r["concentratorId"]}
    photos = Counter(p["concentratorId"] for p in read(a.photos))

    rows, dists = [], []
    for cid in sorted(set(ready) | set(mm), key=lambda x: (len(x), x)):
        R, M = ready.get(cid), mm.get(cid)
        src = "both" if R and M else "ready_only" if R else "mymaps_only"
        lat = R["_lat"] if R else (num(M["latitude"]) if M and M["latitude"] else None)
        lng = R["_lng"] if R else (num(M["longitude"]) if M and M["longitude"] else None)
        d = ""
        if R and M and M["latitude"] and R["_lat"] is not None:
            d = round(hav(R["_lat"], R["_lng"], float(M["latitude"]), float(M["longitude"])))
            dists.append(d)
            if d > 100:
                issues.append({"concentratorId": cid, "issue": "ready_vs_mymaps_over_100m", "detail": f"{d} m"})
        sim_r, sim_m = phone(R["Telefon"]) if R else "", M["simNumber"] if M else ""
        if R and M and sim_r and sim_m and sim_r != sim_m:
            issues.append({"concentratorId": cid, "issue": "sim_differs", "detail": f"READy={sim_r} MyMaps={sim_m}"})
        if src == "mymaps_only":
            issues.append({"concentratorId": cid, "issue": "not_in_ready", "detail": "kept as RequiresVerification"})
        if src == "ready_only":
            issues.append({"concentratorId": cid, "issue": "not_in_mymaps", "detail": "no photo / place text yet"})
        rows.append({
            "concentratorId": cid,
            "code": M["code"] if M else "",
            "simNumber": sim_r or sim_m,
            "technology": "radiomesh" if R and "mesh" in R["Målertype"].lower() else "",
            "readyType": R["Målertype"] if R else "",
            "readyGroup": R["Kundenummer"] if R else "",
            "referenceAddress": (R["Adresse"] if R else M["referenceAddress"]).strip(),
            "postalCode": (R["Postnummer"] if R else M["postalCode"]).strip(),
            "city": R["By"].strip() if R else "",
            "latitude": f"{lat:.6f}" if lat is not None else "", "longitude": f"{lng:.6f}" if lng is not None else "",
            "coordinateSource": "ready" if R and R["_lat"] is not None else (M["coordinateSource"] if M else "none"),
            "physicalLocationDescription": M["physicalLocationDescription"] if M else "",
            "physicalLocationRaw": M["physicalLocationRaw"] if M else "",
            "locationTypeGuess": M["locationTypeGuess"] if M else "",
            "readyNote": R["Bemærkning"].strip() if R else "",
            "photoCount": photos.get(cid, 0),
            "operationalStatus": "Active" if R else "RequiresVerification",
            "verificationStatus": "unverified",
            "source": src, "readyVsMyMapsMeters": d,
        })

    with (a.out / "concentrators_merged.csv").open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), delimiter=";"); w.writeheader(); w.writerows(rows)
    with (a.out / "merge_issues.csv").open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["issue", "concentratorId", "detail"], delimiter=";"); w.writeheader(); w.writerows(issues)

    s = Counter(r["source"] for r in rows); ic = Counter(i["issue"] for i in issues); dists.sort()
    md = ["# Raport de combinare READy + My Maps", "",
          "| Indicator | Număr |", "|---|---:|",
          f"| concentratoare în READy (listă actuală) | {len(ready)} |",
          f"| concentratoare în My Maps | {len(mm)} |",
          f"| în ambele | {s['both']} |",
          f"| doar în READy (noi, fără foto/descriere) | {s['ready_only']} |",
          f"| doar în My Maps (de verificat, posibil dezafectate) | {s['mymaps_only']} |",
          f"| total în rezultat | {len(rows)} |",
          f"| cu coordonate | {sum(1 for r in rows if r['latitude'])} |",
          f"| cu descrierea locului fizic | {sum(1 for r in rows if r['physicalLocationDescription'])} |",
          f"| cu fotografii | {sum(1 for r in rows if r['photoCount'])} (din care active în READy: {sum(1 for r in rows if r['photoCount'] and r['source']=='both')}) |",
          "", f"Coordonate comparate READy vs My Maps: {len(dists)}, mediana {dists[len(dists)//2] if dists else '-'} m, peste 100 m: {ic['ready_vs_mymaps_over_100m']}", "",
          "## Probleme", "", "| Problemă | Număr |", "|---|---:|"] + [f"| {k} | {v} |" for k, v in ic.most_common()]
    (a.out / "merge_report.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))


if __name__ == "__main__":
    main()
