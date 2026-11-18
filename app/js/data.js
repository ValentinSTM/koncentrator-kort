/* Data layer: dictionary, on-device storage, demo data, loading the private dataset.
   The UI only talks to window.Data. Later an Azure adapter (Functions + SharePoint/SQL) replaces
   the local store without changing the screens. */
'use strict';
(function () {
  const DB_NAME = 'koncentrator-kort', STORE = 'kv';

  /* ---------------- tiny IndexedDB key/value store (memory fallback) ---------------- */
  const mem = new Map();
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      try {
        const rq = indexedDB.open(DB_NAME, 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
    return dbp;
  }
  async function kvGet(k) {
    const d = await db(); if (!d) return mem.get(k);
    return new Promise((res) => { try { const r = d.transaction(STORE).objectStore(STORE).get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(mem.get(k)); } catch { res(mem.get(k)); } });
  }
  async function kvSet(k, v) {
    mem.set(k, v);
    const d = await db(); if (!d) return false;
    return new Promise((res) => { try { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(v, k); tx.oncomplete = () => res(true); tx.onerror = () => res(false); } catch { res(false); } });
  }
  async function kvDel(k) {
    mem.delete(k);
    const d = await db(); if (!d) return;
    return new Promise((res) => { try { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(k); tx.oncomplete = () => res(); tx.onerror = () => res(); } catch { res(); } });
  }
  async function kvKeys(prefix) {
    const d = await db(); if (!d) return [...mem.keys()].filter(k => k.startsWith(prefix));
    return new Promise((res) => { try { const r = d.transaction(STORE).objectStore(STORE).getAllKeys(); r.onsuccess = () => res(r.result.filter(k => String(k).startsWith(prefix))); r.onerror = () => res([]); } catch { res([]); } });
  }

  /* ---------------- dictionary ---------------- */
  async function loadDictionary() {
    const el = document.getElementById('placement-dict');
    if (el && el.textContent.trim()) return JSON.parse(el.textContent);
    const r = await fetch('data/placement-dictionary.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('dictionary ' + r.status);
    return r.json();
  }

  /* ---------------- helpers ---------------- */
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function demoPhotoSvg(kind, label) {
    const bg = { skur: '#8d6e63', loft: '#8c7b6b', garage: '#6d7b86', kaelder: '#5d6d7e', teknikrum: '#607d8b', way: '#7a9a6a' }[kind] || '#78909c';
    const scene = kind === 'way'
      ? '<rect x="0" y="300" width="640" height="180" fill="#9e9e9e"/><path d="M240 480 L300 300 L340 300 L400 480Z" fill="#bdbdbd"/><rect x="420" y="150" width="160" height="150" fill="#795548"/><polygon points="410,150 500,90 590,150" fill="#5d4037"/><rect x="480" y="220" width="40" height="80" fill="#3e2723"/><text x="320" y="270" font-size="64" text-anchor="middle" fill="#ffeb3b">➜</text>'
      : '<rect x="0" y="380" width="640" height="100" fill="rgba(0,0,0,.25)"/><rect x="360" y="110" width="120" height="150" rx="8" fill="#eceff1" stroke="#263238" stroke-width="5"/><circle cx="420" cy="150" r="8" fill="#43a047"/><rect x="455" y="60" width="8" height="55" fill="#263238"/><circle cx="420" cy="185" r="118" fill="none" stroke="#ffeb3b" stroke-width="8" stroke-dasharray="18 10"/>';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><rect width="640" height="480" fill="${bg}"/>${scene}<rect x="12" y="12" width="236" height="44" rx="8" fill="rgba(0,0,0,.6)"/><text x="24" y="42" font-size="22" fill="#fff" font-family="sans-serif" font-weight="bold">DEMO · fiktivt</text><text x="24" y="460" font-size="20" fill="#fff" font-family="sans-serif">${esc(label || '')}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ---------------- fictitious demo dataset ---------------- */
  function demoDataset() {
    const R = rng(20261118), pick = (a) => a[Math.floor(R() * a.length)];
    const towns = [
      { city: 'Aarhus C', pc: '8000', lat: 56.156, lng: 10.205 }, { city: 'Aarhus N', pc: '8200', lat: 56.180, lng: 10.190 },
      { city: 'Viby J', pc: '8260', lat: 56.127, lng: 10.160 }, { city: 'Risskov', pc: '8240', lat: 56.190, lng: 10.230 },
      { city: 'Brabrand', pc: '8220', lat: 56.155, lng: 10.110 }, { city: 'Hasselager', pc: '8361', lat: 56.103, lng: 10.100 },
      { city: 'Tilst', pc: '8381', lat: 56.188, lng: 10.110 }, { city: 'Højbjerg', pc: '8270', lat: 56.118, lng: 10.200 }];
    const streets = ['Demovej', 'Prøvegade', 'Testparken', 'Eksempelvænget', 'Fiktivvej', 'Modelallé', 'Skitsevej'];
    // [room, extra placement, Danish legacy-style text] – fictitious, written like the real notes
    const tpl = [
      ['skur', {}, 'Skur'], ['skur', { side: ['venstre'], landmark: ['doer'], height: ['under_loft'] }, 'Redskabsrum til venstre inden for døren oppe under loftet'],
      ['loft', { side: ['venstre'], height: ['paa_spaer'], landmark: ['loftlem'] }, 'Loftrum til venstre for loftlemmen placeret på et spær'],
      ['loft', {}, 'Loft'], ['garage', {}, 'Garage'], ['garage', { side: ['hoejre', 'inden_for_doer'] }, 'I garagen til højre inden for porten'],
      ['carport', {}, 'Carport / redskabsrum'], ['teknikrum', { side: ['over_doer'] }, 'Teknikrum placeret over døren'],
      ['kaelder', { landmark: ['vindue'] }, 'Kælderrum ved et vindue'], ['bryggers', { landmark: ['gruppetavle'], height: ['under_loft'] }, 'I bryggers oppe under loftet ved gruppetavle'],
      ['trappeopgang', { floor: ['sal1'] }, 'Trappeopgang 1 sal'], ['cykelskur', {}, 'Cykelskur'], ['teknikskab', {}, 'Teknikskab i trappeopgang'],
      ['affald', { side: ['venstre'] }, 'Skralderum til venstre'], [null, {}, 'Ukendt'], [null, {}, '']];
    const ds = { schema: 'koncentrator-kort/1', demo: true, generatedAt: '2026-11-18T00:00:00Z', sites: [], concentrators: [] };
    for (let i = 1; i <= 90; i++) {
      const tw = pick(towns), t = pick(tpl);
      const lat = +(tw.lat + (R() - .5) * 0.03).toFixed(6), lng = +(tw.lng + (R() - .5) * 0.05).toFixed(6);
      const placement = t[0] ? { room: [t[0]], ...t[1] } : {};
      const own = R() < .08;
      if (own) (placement.access = ['eget_anlaeg']);
      const id = 'DEMO-' + String(10000 + i * 7);
      const photos = [];
      if (t[0] && R() < .35) { photos.push({ file: id + '/1', demo: t[0] }); if (R() < .5) photos.push({ file: id + '/2', demo: 'way' }); }
      ds.concentrators.push({
        concentratorId: id, technologyId: 'radiomesh', code: 'c-DEMO-' + i, simNumber: '+4500' + String(100000 + i).slice(-6),
        operationalStatus: R() < .06 ? 'RequiresVerification' : 'Active', referenceAddress: pick(streets) + ' ' + (1 + Math.floor(R() * 80)),
        postalCode: tw.pc, city: tw.city, latitude: lat, longitude: lng, coordinateSource: R() < .9 ? 'ready' : 'mymaps',
        description: (own ? 'Anlæg 9' + i + ' (fiktivt), ' : '') + t[2], legacyText: t[2], accessRestricted: R() < .05 ? 'Kontakt vicevært (fiktivt nr.)' : '',
        placement, ownSite: own, nearSite: '', photos, verificationStatus: 'unverified', lastVerifiedAt: null });
    }
    const siteCenters = [[56.170, 10.150, 'Demo-site Nord'], [56.120, 10.190, 'Demo-site Syd'], [56.150, 10.090, ''], [56.200, 10.240, 'Demo-site Øst']];
    siteCenters.forEach(([la, lo, name], k) => ds.sites.push({
      siteId: 'DEMO-S' + (k + 1), technologyId: 'linkiq', name, address: 'Pumpevej ' + (k + 1) + ' (fiktiv)', latitude: la, longitude: lo, status: 'ACTIVE', ownSite: true,
      concentrators: Array.from({ length: 1 + (k % 3) }, (_, j) => ({ serialNumber: 'DEMO-7300' + k + j, model: j ? 'READy Concentrator 1M' : 'READy Concentrator 2M', firmware: 'K20', status: 'ACTIVE', active: true }))
    }));
    return ds;
  }

  /* ---------------- dataset validation ---------------- */
  function validate(ds) {
    if (!ds || typeof ds !== 'object' || !Array.isArray(ds.concentrators)) throw new Error('format');
    if (ds.schema && !String(ds.schema).startsWith('koncentrator-kort/')) throw new Error('schema');
    ds.sites = Array.isArray(ds.sites) ? ds.sites : [];
    for (const c of ds.concentrators) {
      c.concentratorId = String(c.concentratorId || '').trim();
      c.placement = c.placement && typeof c.placement === 'object' ? c.placement : {};
      c.photos = Array.isArray(c.photos) ? c.photos : [];
      c.latitude = typeof c.latitude === 'number' ? c.latitude : null;
      c.longitude = typeof c.longitude === 'number' ? c.longitude : null;
    }
    ds.concentrators = ds.concentrators.filter(c => c.concentratorId);
    return ds;
  }

  /* ---------------- image processing: resize + strip EXIF by re-encoding ---------------- */
  async function toJpeg(blob, max, q) {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    if (bmp.close) bmp.close();
    return cv.toDataURL('image/jpeg', q);
  }
  async function processPhoto(blob) {
    return { full: await toJpeg(blob, 1600, .82), thumb: await toJpeg(blob, 360, .75) };
  }
  async function sha256(blob) {
    try { const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); } catch { return ''; }
  }

  window.Data = {
    kvGet, kvSet, kvDel, kvKeys, loadDictionary, demoDataset, demoPhotoSvg, validate, processPhoto, sha256, esc,
    /* active dataset: 'demo' or 'local' */
    async loadActive() {
      const mode = (await kvGet('mode')) || 'demo';
      if (mode === 'local') {
        const ds = await kvGet('dataset:local');
        if (ds) return { mode: 'local', ds };
      }
      return { mode: 'demo', ds: demoDataset() };
    },
    async saveLocalDataset(ds) { const ok = await kvSet('dataset:local', ds); await kvSet('mode', 'local'); return ok; },
    async useDemo() { await kvSet('mode', 'demo'); },
    async forgetLocal() {
      await kvDel('dataset:local'); await kvSet('mode', 'demo');
      for (const k of await kvKeys('img:local:')) await kvDel(k);
      await kvDel('changes:local');
      for (const k of await kvKeys('newimg:local:')) await kvDel(k);
    },
    async getChanges(mode) { return (await kvGet('changes:' + mode)) || {}; },
    async saveChanges(mode, ch) { return kvSet('changes:' + mode, ch); },
    async clearChanges(mode) { await kvDel('changes:' + mode); for (const k of await kvKeys('newimg:' + mode + ':')) await kvDel(k); },
    imgKey: (mode, file) => 'img:' + mode + ':' + file,
    newImgKey: (mode, pid) => 'newimg:' + mode + ':' + pid
  };
})();
