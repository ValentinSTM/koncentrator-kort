// Quick checks run by the pipeline (node tools/check.js): JS syntax is checked by loading the files,
// every UI text exists in DA/EN/RO, the dictionary has all three languages, no real-data markers.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');
let fail = 0; const bad = (m) => { console.error('FAIL ' + m); fail++; };
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'app/js/i18n.js'), 'utf8'), ctx);
const L = ctx.window.I18N;
for (const lang of ['en', 'ro']) for (const k of Object.keys(L.da)) if (!(k in L[lang])) bad(`i18n ${lang} missing ${k}`);
for (const lang of ['en', 'ro']) for (const k of Object.keys(L[lang])) if (!(k in L.da)) bad(`i18n da missing ${k}`);
const dict = JSON.parse(fs.readFileSync(path.join(root, 'app/data/placement-dictionary.json'), 'utf8'));
for (const [cat, items] of Object.entries(dict.categories)) for (const it of items) for (const l of ['da', 'en', 'ro']) if (!it[l]) bad(`dictionary ${cat}.${it.key} missing ${l}`);
for (const f of ['app/js/app.js', 'app/js/data.js']) { try { new vm.Script(fs.readFileSync(path.join(root, f), 'utf8')); } catch (e) { bad(f + ': ' + e.message); } }
for (const f of fs.readdirSync(path.join(root, 'app'), { recursive: true })) {
  if (/\.(csv|kmz|kml|xlsx)$/i.test(f) || /koncentrator-data|koncentrator-telefon/i.test(f)) bad('real-data file in app/: ' + f);
}
if (fail) { console.error(fail + ' problem(s)'); process.exit(1); }
console.log('ok: i18n ' + Object.keys(L.da).length + ' keys × 3, dictionary ' + Object.values(dict.categories).flat().length + ' entries × 3');
