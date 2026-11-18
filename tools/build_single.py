"""Build one self-contained HTML file (Leaflet inlined) from src/index.html.

Usage:  python tools/build_single.py            -> dist/koncentrator-finder.html
The result works opened from disk, on GitHub Pages, or as a single file on a phone.
It contains only the fictitious demo data generated in the page itself.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "app"
OUT = ROOT / "dist" / "koncentrator-kort.html"

html = (SRC / "index.html").read_text(encoding="utf-8")
css = (SRC / "vendor" / "leaflet.css").read_text(encoding="utf-8")
js = (SRC / "vendor" / "leaflet.js").read_text(encoding="utf-8")
if "</script" in js.lower():
    raise SystemExit("leaflet.js contains </script; refusing to inline")

link = '<link rel="stylesheet" href="vendor/leaflet.css">'
script = '<script src="vendor/leaflet.js"></script>'
for needle in (link, script):
    if needle not in html:
        raise SystemExit(f"marker not found in src/index.html: {needle}")

html = html.replace(link, "<style>/* Leaflet 1.9.4, BSD-2-Clause */\n" + css + "</style>")
html = html.replace(script, "<script>\n" + js + "\n</script>")
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding="utf-8")
print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
