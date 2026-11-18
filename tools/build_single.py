"""Build one self-contained HTML file from app/ (CSS, JS, Leaflet and the placement dictionary inlined).

    python tools/build_single.py        -> dist/koncentrator-kort.html

The result opens from disk, works on GitHub Pages, and can be copied to a phone as one file.
It contains only fictitious demo data; real data is loaded locally from OneDrive inside the app.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
OUT = ROOT / "dist" / "koncentrator-kort.html"

html = (APP / "index.html").read_text(encoding="utf-8")


def safe(text, what):
    if "</script" in text.lower():
        raise SystemExit(f"{what} contains </script; refusing to inline")
    return text


def css(m):
    return "<style>\n" + (APP / m.group(1)).read_text(encoding="utf-8") + "\n</style>"


def js(m):
    return "<script>\n" + safe((APP / m.group(1)).read_text(encoding="utf-8"), m.group(1)) + "\n</script>"


html, n_css = re.subn(r'<link rel="stylesheet" href="([^"]+)">', css, html)
html, n_js = re.subn(r'<script src="([^"]+)"></script>', js, html)
dict_json = safe((APP / "data" / "placement-dictionary.json").read_text(encoding="utf-8"), "dictionary")
marker = '<script id="placement-dict" type="application/json"></script>'
if marker not in html:
    raise SystemExit("placement-dict marker missing in app/index.html")
html = html.replace(marker, '<script id="placement-dict" type="application/json">' + dict_json + "</script>")
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding="utf-8")
print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB; {n_css} css, {n_js} js inlined)")
