/* Koncentrator-kort – field app. Focus: find a Radio Mesh concentrator fast and keep its location data complete. */
'use strict';
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = Data.esc;
  const ROOM_ICON = { loft: '🔼', garage: '🚗', carport: '🚗', skur: '🛖', cykelskur: '🚲', affald: '🗑️', teknikrum: '⚙️', teknikskab: '🗄️', kaelder: '⬇️',
    bryggers: '🧺', vaskerum: '🧺', depotrum: '📦', vaerksted: '🔧', trappeopgang: '🪜', faellesrum: '🏠', entre: '🚪', udvendig: '🧱', halvtag: '⛺',
    lejlighed: '🏢', anlaeg_bygning: '🏭', kontor: '🗂️' };
  const TECH_COLOR = { radiomesh: '#7b1fa2', linkiq: '#1565c0' };
  const PREP = { da: 'ved', en: 'by', ro: 'lângă' };

  /* ---------------- state ---------------- */
  const S = {
    lang: 'da', dict: null, mode: 'demo', ds: null, ch: {}, prefs: { name: '' },
    me: null, heading: null, compassListening: false, sim: false, follow: false,
    q: '', filters: { tech: new Set(['radiomesh', 'linkiq']), info: new Set() },
    tab: 'map', prevTab: 'map', detail: null, listLimit: 80, effCache: new Map(), imgCache: new Map(), wz: null, photoTarget: null,
    events: [], sync: { cfg: null, state: { since: 0, version: '' }, busy: false, lastOk: null, error: '', timer: null }
  };

  /* ---------------- i18n ---------------- */
  function t(k, vars) {
    let s = (I18N[S.lang] && I18N[S.lang][k]); if (s === undefined) s = I18N.da[k]; if (s === undefined) s = k;
    if (vars && typeof s === 'string') for (const [a, b] of Object.entries(vars)) s = s.split('{' + a + '}').join(b);
    return s;
  }
  function applyI18n() {
    document.documentElement.lang = S.lang;
    $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
    $$('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    $$('.langs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === S.lang));
    updateBadge();
  }

  function updateBadge() {
    const src = $('#srcBadge'); if (!src) return;
    const pending = S.events.filter(e => !e.synced).length;
    let txt = S.mode === 'local' ? t('srcLocal') : S.mode === 'shared' ? t('srcShared') : t('srcDemo');
    if (S.mode === 'shared') txt += S.sync.busy ? ' · ⟳' : pending ? ' · ' + pending + ' ⇡' : S.sync.error ? ' · ⚠' : ' · ✓';
    src.textContent = txt; src.classList.toggle('local', S.mode !== 'demo');
  }

  /* ---------------- dictionary helpers ---------------- */
  function dictItems(cat) { return (S.dict.categories[cat] || []).slice().sort((a, b) => b.count - a.count); }
  function label(cat, key) { const it = (S.dict.categories[cat] || []).find(i => i.key === key); return it ? (it[S.lang] || it.da) : key; }
  const short = (s) => s.split(' / ')[0].split(' (')[0];
  function sentence(p) {
    if (!p) return '';
    const parts = [];
    if (p.room && p.room.length) parts.push(short(label('room', p.room[0])));
    (p.floor || []).forEach(k => parts.push(short(label('floor', k))));
    (p.side || []).forEach(k => parts.push(short(label('side', k))));
    (p.height || []).forEach(k => parts.push(short(label('height', k))));
    if (p.landmark && p.landmark.length) parts.push(PREP[S.lang] + ' ' + p.landmark.map(k => short(label('landmark', k)).toLowerCase()).join(' / '));
    (p.antenna || []).forEach(k => parts.push(short(label('antenna', k))));
    return parts.map((s, i) => i ? s.charAt(0).toLowerCase() + s.slice(1) : s).join(', ');
  }

  /* ---------------- geo helpers ---------------- */
  function hav(a, b) { const R = 6371000, r = Math.PI / 180; const x = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
  function bearing(a, b) { const r = Math.PI / 180; const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r); const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r); return (Math.atan2(y, x) / r + 360) % 360; }
  const dirName = (deg) => t('dirs')[Math.round(deg / 45) % 8];
  function fmtDist(m) { if (m < 1000) return Math.round(m) + ' ' + t('m'); const v = m / 1000; return (v < 10 ? v.toFixed(1) : Math.round(v)).toString().replace('.', S.lang === 'en' ? '.' : ',') + ' ' + t('km'); }
  function fmtDate(iso, time) { if (!iso) return '—'; const o = { year: 'numeric', month: '2-digit', day: '2-digit' }; if (time) { o.hour = '2-digit'; o.minute = '2-digit'; } return new Date(iso).toLocaleString({ da: 'da-DK', en: 'en-GB', ro: 'ro-RO' }[S.lang], o); }
  function arrowFor(pos) { if (!S.me || !pos) return ''; const b = bearing(S.me, pos); const rot = S.heading == null ? b : b - S.heading; return `<span class="arr" style="transform:rotate(${Math.round(rot)}deg)">⬆</span>`; }

  /* ---------------- effective record = base data + my changes ---------------- */
  function eff(c) {
    let e = S.effCache.get(c.concentratorId); if (e) return e;
    const ch = S.ch[c.concentratorId] || {};
    const v = ch.verified;
    e = Object.assign({}, c, {
      kind: 'c', id: c.concentratorId,
      placement: ch.placement || c.placement || {},
      lat: v ? v.lat : c.latitude, lng: v ? v.lng : c.longitude,
      coordSource: v ? (v.source === 'manual' ? 'manual' : 'gps') : (c.coordinateSource || (c.latitude != null ? 'ready' : 'none')),
      status: ch.status || c.operationalStatus || 'Active',
      verified: v || null,
      photos: [...(c.photos || []).map(p => ({ base: true, file: p.file, demo: p.demo })), ...(ch.photos || []).map(p => ({ base: false, pid: p.pid, caption: p.caption, at: p.at, by: p.by }))],
      notes: ch.notes || [], events: ch.events || [], changed: !!S.ch[c.concentratorId]
    });
    const p = e.placement;
    e.ck = { gps: e.coordSource === 'gps', room: !!(p.room && p.room.length), detail: !!((p.side && p.side.length) || (p.height && p.height.length) || (p.landmark && p.landmark.length)), photo: e.photos.length > 0 };
    e.score = Object.values(e.ck).filter(Boolean).length;
    e.ownSite = !!(c.ownSite || (p.access || []).includes('eget_anlaeg'));
    S.effCache.set(c.concentratorId, e);
    return e;
  }
  function siteRec(s) { return Object.assign({}, s, { kind: 's', id: s.siteId, lat: s.latitude, lng: s.longitude }); }
  function allRecords() {
    const out = [];
    if (S.filters.tech.has('radiomesh')) for (const c of S.ds.concentrators) out.push(eff(c));
    if (S.filters.tech.has('linkiq')) for (const s of S.ds.sites) out.push(siteRec(s));
    return out;
  }
  function hay(r) {
    if (r.kind === 's') return [r.siteId, r.name, r.address, ...(r.concentrators || []).map(c => c.serialNumber + ' ' + c.model)].join(' ').toLowerCase();
    const p = r.placement; const labels = Object.entries(p).flatMap(([cat, keys]) => (keys || []).map(k => label(cat, k)));
    return [r.id, r.code, r.referenceAddress, r.postalCode, r.city, r.description, r.legacyText, r.simNumber, ...labels, ...r.notes.map(n => n.text)].join(' ').toLowerCase();
  }
  function filtered() {
    const words = S.q.trim().toLowerCase().split(/\s+/).filter(Boolean); const f = S.filters.info;
    let r = allRecords().filter(x => {
      if (x.kind === 'c') {
        if (f.has('incomplete') && x.score >= 3) return false;
        if (f.has('photo') && !x.photos.length) return false;
        if (f.has('nophoto') && x.photos.length) return false;
        if (f.has('own') && !x.ownSite) return false;
        if (f.has('verify') && x.status !== 'RequiresVerification') return false;
        if (f.has('changed') && !x.changed) return false;
      } else if (f.size && !(f.size === 1 && f.has('own'))) return false;
      if (words.length) { const h = hay(x); if (!words.every(w => h.includes(w))) return false; }
      return true;
    });
    if (S.me) { for (const x of r) x._d = x.lat != null ? hav(S.me, x) : Infinity; r.sort((a, b) => a._d - b._d); }
    else r.sort((a, b) => (a.kind === b.kind ? String(a.id).localeCompare(String(b.id), undefined, { numeric: true }) : a.kind === 's' ? 1 : -1));
    if (words.length) {   // an ID typed in the search box always comes first
      const q = S.q.trim().toLowerCase();
      const rank = (x) => { const id = String(x.id).toLowerCase(); return id === q ? 0 : id.startsWith(q) ? 1 : 2; };
      r.sort((a, b) => rank(a) - rank(b));
    }
    return r;
  }

  /* ---------------- photos: resolve URLs (demo SVG, local IDB, new IDB) ---------------- */
  function photoKey(p) { return p.base ? Data.imgKey(S.mode, p.file) : Data.newImgKey(S.mode, p.pid); }
  function demoSrc(p, e) { return Data.demoPhotoSvg(p.demo, p.demo === 'way' ? '' : short(label('room', p.demo))); }
  function imgTag(p, e, which, cls) {
    if (p.base && S.mode === 'demo') return `<img alt="" class="${cls || ''}" src="${demoSrc(p, e)}">`;
    const k = photoKey(p); const c = S.imgCache.get(k);
    if (c) return `<img alt="" class="${cls || ''}" src="${c[which]}">`;
    return `<img alt="" class="${cls || ''}" data-k="${esc(k)}" data-w="${which}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">`;
  }
  async function hydrate(root) {
    for (const img of $$('img[data-k]', root)) {
      const k = img.dataset.k; let v = S.imgCache.get(k);
      if (!v) { v = await Data.kvGet(k); if (v) S.imgCache.set(k, v); }
      if (!v && S.mode === 'shared') v = await fetchRemotePhoto(k);
      if (v) { img.src = v[img.dataset.w]; img.removeAttribute('data-k'); } else { img.replaceWith(Object.assign(document.createElement('span'), { textContent: '📷', className: img.className })); }
    }
  }

  /* ---------------- map ---------------- */
  let map, layerC, layerS, meMarker, meCircle, lineLayer;
  function initMap() {
    map = L.map('map', { zoomControl: true, preferCanvas: true, tap: true }).setView([56.16, 10.18], 11);
    let ok = 0, bad = 0;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' })
      .on('tileload', () => ok++).on('tileerror', () => { bad++; if (bad > 3 && !ok) { $('#map').classList.add('notiles'); const n = $('#mapNote'); n.textContent = t('tilesBlocked'); n.hidden = false; setTimeout(() => (n.hidden = true), 9000); } })
      .addTo(map);
    layerC = L.layerGroup().addTo(map); layerS = L.layerGroup().addTo(map); lineLayer = L.layerGroup().addTo(map);
    map.on('click', (e) => { if (S.sim) { S.sim = false; setManual(e.latlng.lat, e.latlng.lng, t('posMap')); } });
    map.on('dragstart', () => { if (S.follow) { S.follow = false; $('#btnLocate').classList.remove('on'); } });
  }
  function renderMarkers() {
    layerC.clearLayers(); layerS.clearLayers();
    const sel = S.detail && S.detail.id;
    for (const r of filtered()) {
      if (r.lat == null) continue;
      if (r.kind === 's') {
        const m = L.marker([r.lat, r.lng], { icon: L.divIcon({ className: '', html: '<div class="siteMarker"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 500 });
        m.bindTooltip(esc(r.name || r.siteId) + ' · LinkIQ'); m.on('click', () => openDetail('s', r.id)); layerS.addLayer(m); continue;
      }
      const isSel = r.id === sel, verify = r.status !== 'Active';
      const m = L.circleMarker([r.lat, r.lng], { radius: isSel ? 14 : 9, weight: isSel ? 5 : 3, color: r.score >= 3 ? '#fff' : '#f9c400',
        fillColor: TECH_COLOR.radiomesh, fillOpacity: verify ? .45 : .95, dashArray: verify ? '3 3' : null });
      m.bindTooltip(esc(r.id) + (r.placement.room ? ' · ' + esc(short(label('room', r.placement.room[0]))) : ''));
      m.on('click', () => openDetail('c', r.id)); layerC.addLayer(m);
    }
    drawLine();
  }
  function drawLine() {
    lineLayer.clearLayers();
    const r = currentDetail(); if (!S.me || !r || r.lat == null) return;
    L.polyline([[S.me.lat, S.me.lng], [r.lat, r.lng]], { color: '#0b2a3c', weight: 4, dashArray: '8 8', opacity: .8 }).addTo(lineLayer);
  }
  function fitData() {
    const pts = []; for (const c of S.ds.concentrators) if (c.latitude != null) pts.push([c.latitude, c.longitude]);
    for (const s of S.ds.sites) if (s.latitude != null) pts.push([s.latitude, s.longitude]);
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(.05));
  }

  /* ---------------- GPS + compass ---------------- */
  let watchId = null;
  function startGps() {
    if (!('geolocation' in navigator)) return gpsFail();
    toast(t('gpsWait'));
    try {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      let first = true;
      watchId = navigator.geolocation.watchPosition((p) => {
        S.manual = false; setMe({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), simulated: false }, first); first = false;
      }, gpsFail, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
    } catch { gpsFail(); }
  }
  function gpsFail() { if (watchId != null) { try { navigator.geolocation.clearWatch(watchId); } catch {} watchId = null; }
    $('#toast').classList.remove('show');
    if (!S.me && !S.gpsFailShown) { S.gpsFailShown = true; positionSheet(); } renderNear(); }
  function setManual(lat, lng, lbl) {
    if (watchId != null) { try { navigator.geolocation.clearWatch(watchId); } catch {} watchId = null; }
    S.manual = true; setMe({ lat, lng, acc: 5, simulated: true, label: lbl || '' }, true);
    Data.kvSet('lastManualPos', { lat, lng, label: lbl || '', at: new Date().toISOString() });
    toast(t('posSet', { p: lbl || (lat.toFixed(5) + ', ' + lng.toFixed(5)) }));
  }
  function addressIndex() {
    if (S.addrIdx && S.addrIdx.ds === S.ds) return S.addrIdx.list;
    const seen = new Map();
    const add = (addr, pc, city, lat, lng) => {
      if (!addr || lat == null) return; const lbl = [addr, [pc, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      const k = lbl.toLowerCase(); if (!seen.has(k)) seen.set(k, { label: lbl, lat, lng, norm: k.replace(/[.,;:]/g, ' ').replace(/\s+/g, ' ') });
    };
    for (const c of S.ds.concentrators) add(c.referenceAddress, c.postalCode, c.city, c.latitude, c.longitude);
    for (const s of S.ds.sites) add(s.address, '', '', s.latitude, s.longitude);
    const list = [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'da', { numeric: true }));
    S.addrIdx = { ds: S.ds, list }; return list;
  }
  function positionSheet() {
    openSheet({ title: t('posTitle'),
      body: `${S.me && S.manual ? `<div class="alert info"><span class="ic">📌</span><span>${esc(t('posManual'))}: ${esc(S.me.label || (S.me.lat.toFixed(5) + ', ' + S.me.lng.toFixed(5)))}</span></div>` : ''}
        <button class="btn primary big" data-act="posMap">🗺️ ${esc(t('posMap'))}</button>
        <div class="grp"><h3>🔎 ${esc(t('posAddr'))}</h3><input class="f" id="posQ" type="search" autocomplete="off" enterkeyhint="search" placeholder="${esc(t('posAddrPh'))}">
          <div class="muted" style="margin-top:6px">${esc(t('posCoordHint'))}</div><div id="posRes" class="list" style="margin-top:8px"></div>
          <div class="muted" style="margin-top:6px">${esc(t('posFromData'))}</div></div>
        ${'geolocation' in navigator ? `<button class="btn outline" data-act="posGps">📍 ${esc(t('posGps'))}</button>` : ''}`,
      onMount: (sh) => {
        const q = $('#posQ', sh), res = $('#posRes', sh);
        const run = () => {
          const v = q.value.trim(); res.innerHTML = '';
          if (!v) return;
          const m = v.match(/^\s*(-?\d{1,2}[.,]\d+)\s*[,; ]\s*(-?\d{1,3}[.,]\d+)\s*$/);
          if (m) { const la = +m[1].replace(',', '.'), lo = +m[2].replace(',', '.');
            res.innerHTML = `<button class="item" data-setpos="${la},${lo}" data-lbl="${esc(la.toFixed(5) + ', ' + lo.toFixed(5))}"><span class="th">📌</span><span class="main"><span class="t1">${esc(la.toFixed(5) + ', ' + lo.toFixed(5))}</span></span></button>`; return; }
          const words = v.toLowerCase().replace(/[.,;:]/g, ' ').split(/\s+/).filter(Boolean);
          const hits = addressIndex().filter(a => words.every(w => a.norm.includes(w))).slice(0, 8);
          res.innerHTML = hits.length ? hits.map(a => `<button class="item" data-setpos="${a.lat},${a.lng}" data-lbl="${esc(a.label)}" style="min-height:56px"><span class="th" style="width:40px;height:40px;font-size:20px">📍</span><span class="main"><span class="t1" style="font-size:16px">${esc(a.label)}</span></span></button>`).join('')
            : `<div class="muted">${esc(t('posNoMatch'))}</div>`;
        };
        let tm; q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(run, 150); });
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { run(); const first = $('[data-setpos]', res); if (first) first.click(); } });
        setTimeout(() => q.focus(), 80);
      } });
  }
  let lastFullRender = 0;
  function setMe(me, center) {
    const moved = !S.me || hav(S.me, me) > 15;
    S.me = me;
    const ll = [me.lat, me.lng];
    if (!meMarker) {
      meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="you"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 1000 }).addTo(map);
      meCircle = L.circle(ll, { radius: me.acc, color: '#1565c0', weight: 1, fillOpacity: .08 }).addTo(map);
    }
    meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(me.acc);
    meMarker.bindTooltip(me.simulated ? '📌 ' + t('posManual') + (me.label ? ': ' + me.label : '') : t('youAreHere', { a: me.acc }));
    if (center || S.follow) map.setView(ll, Math.max(map.getZoom(), 16), { animate: !center });
    if (center) $('#toast').classList.remove('show');
    updateCompass(); drawLine();
    const now = Date.now();
    if (moved || now - lastFullRender > 20000) { lastFullRender = now; renderNear(); if (!$('#v-list').hidden) renderList(); }
    if (S.wz && S.wz.step === 1) renderWizard();
  }
  function startCompass(fromTap) {
    if (S.compassListening) return;
    const attach = () => {
      const ev = ('ondeviceorientationabsolute' in window) ? 'deviceorientationabsolute' : 'deviceorientation';
      window.addEventListener(ev, onOrientation, true); S.compassListening = true;
    };
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      if (!fromTap) return;   // iOS: must be started from a tap
      DeviceOrientationEvent.requestPermission().then(r => { if (r === 'granted') attach(); }).catch(() => {});
    } else if (typeof DeviceOrientationEvent !== 'undefined') attach();
  }
  let rafPending = false;
  function onOrientation(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;
    if (h == null) return;
    const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    S.heading = (h + ang + 360) % 360;
    if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; updateCompass(); }); }
  }
  function updateCompass() {
    const box = $('#compassBox'); if (!box) return;
    const r = currentDetail(); if (!r) return;
    const dist = $('#cDist'), sub = $('#cSub'), rose = $('#cRose'), arrow = $('#cArrow');
    if (!S.me || r.lat == null) { dist.textContent = '—'; sub.textContent = t('noGpsForDir'); arrow.style.opacity = .25; return; }
    const d = hav(S.me, r), b = bearing(S.me, r);
    const h = S.heading == null ? 0 : S.heading;
    rose.setAttribute('transform', `rotate(${-h} 60 60)`);
    arrow.setAttribute('transform', `rotate(${b - h} 60 60)`);
    arrow.style.opacity = d < Math.max(12, S.me.acc) ? .25 : 1;
    dist.textContent = d < Math.max(12, S.me.acc) ? t('youAreAt') : fmtDist(d);
    sub.textContent = (d < Math.max(12, S.me.acc) ? '' : t('toward', { dir: dirName(b) }) + ' · ') + t('gpsAcc', { a: S.me.acc });
    const hint = $('#cHint'); if (hint) hint.textContent = S.heading == null ? t('compassNone') : t('compassOn');
    const tapBtn = $('#cTap'); if (tapBtn) tapBtn.hidden = S.compassListening;
  }

  /* ---------------- views ---------------- */
  const wide = () => matchMedia('(min-width:980px)').matches;
  function showView(v) {
    for (const id of ['map', 'list', 'detail', 'more']) $('#v-' + id).hidden = !(id === v || (wide() && id === 'map'));
    if (wide() && v === 'map') $('#v-list').hidden = false;
    const tab = v === 'detail' ? S.prevTab : v;
    $$('nav.tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
    $('.searchbar').hidden = v === 'more' || (v === 'detail' && !wide());
    setTimeout(() => map.invalidateSize(), 60);
  }
  function setTab(tab) { S.tab = tab; S.prevTab = tab; if (tab === 'list') renderList(); if (tab === 'more') renderMore(); showView(tab); }

  function itemHtml(r) {
    const dist = S.me && r.lat != null ? `${fmtDist(hav(S.me, r))}<br>${arrowFor(r)}` : '';
    if (r.kind === 's') {
      return `<button class="item" data-open="s:${esc(r.id)}"><span class="th" style="background:#e3effc">◆</span><span class="main">
        <span class="t1"><span class="dot" style="background:${TECH_COLOR.linkiq}"></span>${esc(r.name || t('unnamedSite'))}</span>
        <span class="t2">LinkIQ · ${(r.concentrators || []).length} × ${esc(t('model'))}</span><span class="t3">${esc(r.address || '')}</span></span><span class="dist">${dist}</span></button>`;
    }
    const ph = r.photos[0]; const room = r.placement.room && r.placement.room[0];
    const where = sentence(r.placement) || r.description || '—';
    return `<button class="item" data-open="c:${esc(r.id)}">${ph ? imgTag(ph, r, 'thumb', 'th') : `<span class="th">${room ? (ROOM_ICON[room] || '📍') : '❔'}</span>`}
      <span class="main"><span class="t1"><span class="dot" style="background:${TECH_COLOR.radiomesh}"></span>${esc(r.id)}${r.score < 3 ? ' <span class="badge b-warn" style="padding:1px 7px">!</span>' : ''}${r.changed ? ' <span class="badge b-ok" style="padding:1px 7px">✎</span>' : ''}</span>
      <span class="t2">${esc(where)}</span><span class="t3">${esc(r.referenceAddress || '')}${r.postalCode ? ', ' + esc(r.postalCode) : ''} ${esc(r.city || '')}</span></span>
      <span class="dist">${dist}</span></button>`;
  }
  function renderNear() {
    const el = $('#nearSheet');
    if (!S.me) { el.innerHTML = `<div class="row"><button class="btn primary big" data-act="locate">📍 ${esc(t('showNearest'))}</button><button class="btn outline big" data-act="sim" style="flex:.45" aria-label="${esc(t('posTitle'))}">📌</button></div>`; return; }
    el.classList.remove('collapsed');
    if (sharedEmptyHtml()) { el.innerHTML = sharedEmptyHtml(); return; }
    const r = filtered().filter(x => x.kind === 'c' && x.status === 'Active' && x.lat != null).slice(0, 2);
    if (S.prefs.nearCollapsed) {
      el.classList.add('collapsed');
      el.innerHTML = `<button class="pill" data-act="toggleNear" aria-label="${esc(t('nearest'))}">▴ ${esc(t('nearest'))}${r[0] ? ' · ' + fmtDist(hav(S.me, r[0])) : ''}</button>`; return;
    }
    el.innerHTML = `<div class="head"><span>${esc(t('nearest'))}${S.manual ? ` · <button class="btn small ghost" data-act="sim" style="min-height:34px;padding:2px 10px">📌 ${esc(t('posManual'))} · ${esc(t('posChange'))}</button>` : ''}</span><span style="display:flex;gap:6px"><button class="btn small ghost" data-tab="list">${esc(t('tabList'))} ›</button><button class="btn small ghost" data-act="toggleNear" aria-label="${esc(t('hideNear'))}" style="min-width:44px">▾</button></span></div><div class="list">${r.map(itemHtml).join('')}</div>`;
    hydrate(el);
  }
  function sharedEmptyHtml() {
    if (S.mode !== 'shared' || S.ds.concentrators.length) return '';
    const admin = S.sync.cfg && S.sync.cfg.admin;
    return `<div class="alert warn"><span class="ic">⚠</span><span>${esc(admin ? t('sharedEmptyAdmin') : t('sharedEmptyMember'))}</span></div>`
      + (admin ? `<button class="btn primary" data-tab="more">⬆ ${esc(t('uploadShared'))}</button>` : '');
  }
  function renderList() {
    const r = filtered(); const w = $('#listWrap');
    if (sharedEmptyHtml()) { w.innerHTML = sharedEmptyHtml(); return; }
    if (!r.length) { w.innerHTML = `<div class="empty"><b>${esc(t('noResults'))}</b>${esc(t('noResultsHint'))}</div><button class="btn ghost" data-act="clearFilters">${esc(t('clear'))}</button>`; return; }
    const nc = r.filter(x => x.kind === 'c').length, ns = r.length - nc;
    w.innerHTML = `<div class="muted">${esc(t('found', { n: nc }))}${ns ? ' · ' + esc(t('sitesN', { n: ns })) : ''}</div><div class="list">${r.slice(0, S.listLimit).map(itemHtml).join('')}</div>`
      + (r.length > S.listLimit ? `<button class="btn ghost" data-act="more">${esc(t('showMore'))} (${r.length - S.listLimit})</button>` : '');
    hydrate(w);
  }
  function renderAll() { S.effCache.clear(); renderMarkers(); renderNear(); if (!$('#v-list').hidden) renderList(); if (S.detail && !$('#v-detail').hidden) renderDetail();
    const n = S.filters.info.size + (S.filters.tech.size < 2 ? 1 : 0); const c = $('#filterCount'); c.textContent = n || ''; c.hidden = !n; }

  function currentDetail() {
    if (!S.detail) return null;
    if (S.detail.type === 'c') { const c = S.ds.concentrators.find(x => x.concentratorId === S.detail.id); return c ? eff(c) : null; }
    const s = S.ds.sites.find(x => x.siteId === S.detail.id); return s ? siteRec(s) : null;
  }
  function openDetail(type, id) {
    if (S.tab !== 'detail') S.prevTab = $('#v-list').hidden || wide() ? (wide() ? 'list' : 'map') : 'list';
    S.detail = { type, id }; renderDetail(); showView('detail'); $('#v-detail').scrollTop = 0; renderMarkers();
    const r = currentDetail(); if (r && r.lat != null) map.setView([r.lat, r.lng], Math.max(map.getZoom(), 17));
    startCompass(false);
  }
  function compassHtml() {
    return `<div class="card" id="compassBox"><div class="compass">
      <div class="dial"><svg viewBox="0 0 120 120" aria-hidden="true">
        <g id="cRose"><circle cx="60" cy="60" r="56" fill="#fff" stroke="#c9d2d8" stroke-width="3"/>
          <text x="60" y="20" text-anchor="middle" font-size="15" font-weight="900" fill="#c62828">N</text>
          <text x="104" y="65" text-anchor="middle" font-size="11" fill="#55626b">${esc(t('dirs')[2])}</text><text x="60" y="110" text-anchor="middle" font-size="11" fill="#55626b">S</text><text x="16" y="65" text-anchor="middle" font-size="11" fill="#55626b">${esc(t('dirs')[6])}</text></g>
        <g id="cArrow"><path d="M60 14 L78 66 L60 56 L42 66 Z" fill="#1565c0" stroke="#0b2a3c" stroke-width="2"/><rect x="56" y="58" width="8" height="40" rx="3" fill="#1565c0"/></g>
        <circle cx="60" cy="60" r="5" fill="#0b2a3c"/></svg></div>
      <div style="flex:1;min-width:0"><div class="dist-big" id="cDist">—</div><div class="dist-sub" id="cSub"></div>
        <div class="muted" id="cHint" style="margin-top:4px"></div>
        <button class="btn small outline" id="cTap" data-act="compass" style="margin-top:6px" ${typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function' ? '' : 'hidden'}>🧭 ${esc(t('compassTap'))}</button>
      </div></div></div>`;
  }
  function navUrl(r) { return `https://www.google.com/maps/dir/?api=1&destination=${r.lat.toFixed(6)},${r.lng.toFixed(6)}`; }
  function renderDetail() {
    const r = currentDetail(); const w = $('#detailWrap'); if (!r) { w.innerHTML = ''; return; }
    if (r.kind === 's') return renderSite(r, w);
    const p = r.placement, room = p.room && p.room[0], sent = sentence(p);
    const ph = r.photos;
    const statusCls = r.status === 'Active' ? 'b-ok' : 'b-warn';
    const cs = { gps: 'cs_gps', manual: 'cs_manual', ready: 'cs_ready', mymaps: 'cs_mymaps', kml_point: 'cs_mymaps', address_field: 'cs_mymaps', Adr_field: 'cs_mymaps', unnamed1_field: 'cs_mymaps' }[r.coordSource] || 'cs_none';
    const checks = [['gps', 'ck_gps'], ['room', 'ck_room'], ['detail', 'ck_detail'], ['photo', 'ck_photo']];
    const nearSite = r.nearSite && S.ds.sites.find(s => s.siteId === r.nearSite);
    w.innerHTML = `
      <div class="row" style="flex:none"><button class="btn small ghost" data-act="back" style="flex:none">‹ ${esc(t('back'))}</button><span></span></div>
      <div class="dhead"><span class="id">${esc(r.id)}</span><span class="badge ${statusCls}">${esc(t('st_' + r.status))}</span>
        <span class="badge"><span class="dot" style="background:${TECH_COLOR.radiomesh}"></span>${esc(t('techName_radiomesh'))}</span></div>
      ${r.ownSite ? `<div class="alert ok"><span class="ic">🏭</span><span>${esc(t('ownSite'))}</span></div>` : ''}
      ${compassHtml()}
      <div class="where"><div class="lbl">${esc(t('whereTitle'))}</div>
        ${room ? `<div class="room">${ROOM_ICON[room] || '📍'} ${esc(label('room', room))}</div>` : ''}
        ${sent && sent !== short(label('room', room)) ? `<div class="sentence">${esc(sent)}</div>` : ''}
        ${r.description ? `<div class="legacy"><b>${esc(t('legacyLabel'))}</b>${esc(r.description)}</div>` : ''}
        ${!room ? `<div class="missing">⚠ ${esc(t('whereMissing'))}</div>` : ''}
      </div>
      ${ph.length ? `<button class="hero" data-photo="0">${imgTag(ph[0], r, 'full')}${ph[0].caption ? `<span class="cap">${esc(ph[0].caption)}</span>` : ''}<span class="n">📷 ${ph.length}</span></button>` : ''}
      ${(p.access && p.access.filter(k => k !== 'eget_anlaeg').length) || r.accessRestricted ? `<div class="card"><h2>${esc(t('accessTitle'))}</h2>
        ${(p.access || []).filter(k => k !== 'eget_anlaeg').map(k => `<div style="font-weight:700">🔑 ${esc(label('access', k))}</div>`).join('')}
        ${r.accessRestricted ? `<details style="margin-top:8px"><summary class="muted" style="cursor:pointer;min-height:40px">${esc(t('showContact'))}</summary><div class="mono" style="margin-top:6px">${esc(r.accessRestricted)}</div></details>` : ''}</div>` : ''}
      <div class="card"><h2>${esc(t('addrTitle'))}</h2>
        <div style="font-size:19px;font-weight:800">${esc(r.referenceAddress || '—')}</div><div>${esc(r.postalCode || '')} ${esc(r.city || '')}</div>
        <div class="muted" style="margin:6px 0 10px">${esc(t('addrNote'))}</div>
        ${r.lat != null ? `<div class="copyline"><span><span class="mono" style="font-size:16px">${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}</span><br><span class="muted">${r.coordSource === 'gps' ? '✓ ' : ''}${esc(t(cs))}${r.verified ? ' · ' + fmtDate(r.verified.at) : ''}</span></span>
          <button class="btn small ghost" data-copy="${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}">${esc(t('copy'))}</button></div>` : `<div class="alert warn">${esc(t('cs_none'))}</div>`}
        ${nearSite ? `<div style="margin-top:10px"><button class="btn small outline" data-open="s:${esc(nearSite.siteId)}">◆ ${esc(t('nearSiteLbl'))}: ${esc(nearSite.name || nearSite.siteId)}</button></div>` : ''}
      </div>
      <div class="card"><h2>${esc(t('completeness'))} · ${r.score}/4</h2><div class="meter"><i style="width:${r.score * 25}%"></i></div>
        <div class="checks" style="margin-top:10px">${checks.map(([k, l]) => `<div><span class="${r.ck[k] ? 'ok' : 'no'}">${r.ck[k] ? '✓' : '○'}</span>${esc(t(l))}</div>`).join('')}</div></div>
      <div class="card"><h2>${esc(t('photos'))} (${ph.length})</h2>
        ${ph.length ? `<div class="thumbs">${ph.map((x, i) => `<button data-photo="${i}" aria-label="${esc(x.caption || '')}">${imgTag(x, r, 'thumb')}${x.base ? '' : `<span class="new">${esc(t('newBadge'))}</span>`}</button>`).join('')}</div>` : `<div class="muted">${esc(t('noPhotos'))}</div>`}
        <button class="btn outline" data-act="addPhoto" style="margin-top:10px">📷 ${esc(t('addPhoto'))}</button></div>
      <div class="card"><h2>${esc(t('notes'))}</h2>
        ${r.notes.length ? `<ul class="timeline">${r.notes.slice().reverse().map(n => `<li class="mine"><time>${fmtDate(n.at, true)} · ${esc(n.by || t('unknownUser'))}</time>${esc(n.text)}</li>`).join('')}</ul>` : ''}
        <button class="btn ghost" data-act="addNote" style="margin-top:8px">＋ ${esc(t('addNote'))}</button></div>
      <div class="card"><h2>${esc(t('tech'))}</h2><dl class="kv">
        <dt>${esc(t('code'))}</dt><dd class="mono">${esc(r.code || '—')}</dd><dt>${esc(t('sim'))}</dt><dd class="mono">${esc(r.simNumber || '—')}</dd>
        <dt>${esc(t('status'))}</dt><dd>${esc(t('st_' + r.status))}</dd></dl></div>
      <div class="card"><h2>${esc(t('history'))}</h2><ul class="timeline">
        ${r.events.slice().reverse().map(ev => `<li class="${ev.mine ? 'mine' : ''}"><time>${fmtDate(ev.at, true)} · ${esc(ev.by || t('unknownUser'))}</time>${esc(t('ev_' + ev.type))}${ev.text ? ' – ' + esc(ev.text) : ''}</li>`).join('')}
        <li><time>—</time>${esc(t('ev_import'))}</li></ul></div>
      <button class="btn danger" data-act="report">⚑ ${esc(t('report'))}</button>
      <div class="actionbar">
        ${r.lat != null ? `<a class="btn go big" href="${navUrl(r)}" target="_blank" rel="noopener" aria-label="${esc(t('navigate'))}">🧭 ${esc(t('navShort'))}</a>` : ''}
        <button class="btn ${r.score < 4 ? 'warn' : 'primary'} big" data-act="wizard" aria-label="${esc(r.score < 4 ? t('complete') : t('confirmFound'))}">${r.score < 4 ? '✎ ' + esc(t('completeShort')) : '✓ ' + esc(t('confirmShort'))}</button>
      </div>`;
    hydrate(w); updateCompass();
  }
  function renderSite(r, w) {
    const near = S.ds.concentrators.map(eff).filter(c => c.lat != null && r.lat != null && hav(c, r) < 150);
    w.innerHTML = `
      <div class="row" style="flex:none"><button class="btn small ghost" data-act="back" style="flex:none">‹ ${esc(t('back'))}</button><span></span></div>
      <div class="dhead"><span class="id">◆ ${esc(r.name || t('unnamedSite'))}</span><span class="badge b-ok">${esc(t('st_' + (r.status || 'ACTIVE')))}</span></div>
      <div class="muted">${esc(t('siteTitle'))} · ${esc(r.siteId)}</div>
      <div class="alert ok"><span class="ic">🏭</span><span>${esc(t('ownSite'))}</span></div>
      ${compassHtml()}
      <div class="card"><h2>${esc(t('addrTitle'))}</h2><div style="font-size:19px;font-weight:800">${esc(r.address || '—')}</div>
        ${r.lat != null ? `<div class="copyline" style="margin-top:8px"><span class="mono">${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}</span><button class="btn small ghost" data-copy="${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}">${esc(t('copy'))}</button></div>` : ''}</div>
      <div class="card"><h2>${esc(t('siteConcs'))} (${(r.concentrators || []).length})</h2><dl class="kv">
        ${(r.concentrators || []).map(c => `<dt>${esc(t('serial'))}</dt><dd class="mono">${esc(c.serialNumber)}</dd><dt>${esc(t('model'))}</dt><dd>${esc(c.model)} · ${esc(c.firmware)}</dd>`).join('')}</dl></div>
      ${near.length ? `<div class="card"><h2>${esc(t('nearbyRM'))}</h2><div class="list">${near.map(itemHtml).join('')}</div></div>` : ''}
      <div class="actionbar">${r.lat != null ? `<a class="btn go big" href="${navUrl(r)}" target="_blank" rel="noopener">🧭 ${esc(t('navigate'))}</a>` : ''}</div>`;
    hydrate(w); updateCompass();
  }

  /* ---------------- changes (stored on this device) ---------------- */
  /* Current state per concentrator = base data + all events (mine and, when shared, everybody's), in time order. */
  function rebuildCh() {
    const ch = {};
    const evs = S.events.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
    for (const e of evs) {
      const c = ch[e.cid] || (ch[e.cid] = { events: [] }); const d = e.data || {};
      if (e.type === 'verify') c.verified = { lat: d.lat, lng: d.lng, acc: d.acc, at: e.at, by: e.by, source: d.source || 'gps', simulated: !!d.simulated };
      else if (e.type === 'placement') c.placement = d.placement || {};
      else if (e.type === 'note') (c.notes = c.notes || []).push({ text: d.text, at: e.at, by: e.by });
      else if (e.type === 'photo') (c.photos = c.photos || []).push({ pid: d.pid, caption: d.caption || '', at: e.at, by: e.by, kind: d.kind || '' });
      else if (e.type === 'report' && d.status) c.status = d.status;
      c.events.push({ type: e.type, at: e.at, by: e.by, text: d.summary || (e.type === 'note' ? d.text : '') || '', mine: !e.remote });
    }
    S.ch = ch; S.effCache.clear();
  }
  async function addEvent(cid, type, data) {
    S.events.push({ eid: Data.uid(), cid, type, at: new Date().toISOString(), by: S.prefs.name || t('unknownUser'), data, synced: S.mode !== 'shared' ? true : false, local: true });
    const ok = await Data.saveEvents(S.mode, S.events); if (!ok) toast(t('storageWarn'));
    rebuildCh(); renderAll(); updateBadge(); scheduleSync(1500);
  }

  /* ---------------- sheet (dialogs) ---------------- */
  function openSheet({ title, body, foot, onMount, steps }) {
    const sh = $('#sheet');
    sh.innerHTML = `<div class="panel" role="dialog" aria-modal="true"><div class="shead"><h2>${esc(title)}</h2><button class="iconbtn" data-act="closeSheet" aria-label="${esc(t('close'))}">✕</button></div>
      ${steps || ''}<div class="sbody">${body}</div>${foot ? `<div class="sfoot">${foot}</div>` : ''}</div>`;
    sh.hidden = false; if (onMount) onMount(sh);
  }
  function closeSheet() { $('#sheet').hidden = true; $('#sheet').innerHTML = ''; S.wz = null; }

  function filterSheet() {
    const f = S.filters;
    const chip = (grp, val, txt) => `<button class="chip" data-fgrp="${grp}" data-fval="${val}" aria-pressed="${f[grp].has(val)}">${txt}</button>`;
    openSheet({ title: t('filter'),
      body: `<div class="grp"><h3>${esc(t('f_tech'))}</h3><div class="chips">${chip('tech', 'radiomesh', '<span class="dot" style="background:' + TECH_COLOR.radiomesh + '"></span> Radio Mesh')}${chip('tech', 'linkiq', '◆ LinkIQ')}</div></div>
        <div class="grp"><h3>${esc(t('f_info'))}</h3><div class="chips">${['incomplete', 'photo', 'nophoto', 'own', 'verify', 'changed'].map(k => chip('info', k, esc(t('f_' + k)))).join('')}</div></div>`,
      foot: `<button class="btn ghost" data-act="clearFilters">${esc(t('clear'))}</button><button class="btn primary" data-act="closeSheet">${esc(t('apply'))}</button>`,
      onMount: (sh) => $$('[data-fgrp]', sh).forEach(b => b.onclick = () => {
        const s = f[b.dataset.fgrp], v = b.dataset.fval; s.has(v) ? s.delete(v) : s.add(v);
        if (b.dataset.fgrp === 'info' && v === 'photo') f.info.delete('nophoto'); if (v === 'nophoto') f.info.delete('photo');
        if (!f.tech.size) f.tech.add(v === 'radiomesh' ? 'linkiq' : 'radiomesh');
        $$('[data-fgrp]', sh).forEach(x => x.setAttribute('aria-pressed', f[x.dataset.fgrp].has(x.dataset.fval))); renderAll();
      }) });
  }
  function qrSheet(text, secret) {
    let svg = '';
    try { const q = qrcode(0, 'M'); q.addData(text); q.make(); svg = q.createSvgTag({ cellSize: 6, margin: 3, scalable: true }); } catch { svg = ''; }
    openSheet({ title: secret ? t('qrSetupTitle') : t('qrAppTitle'),
      body: `<div class="qrbox">${svg || esc(text)}</div><p style="margin:0">${esc(secret ? t('qrSetupHint') : t('qrAppHint'))}</p>
        ${secret ? `<div class="alert warn"><span class="ic">🔒</span><span>${esc(t('linkHint'))}</span></div>` : ''}`,
      foot: `<button class="btn ghost" data-act="closeSheet">${esc(t('close'))}</button>` });
  }
  function nameSheet() {
    openSheet({ title: t('yourName'), body: `<p style="margin:0">${esc(t('askName'))}</p><input class="f" id="nameIn" maxlength="60" autocomplete="name">`,
      foot: `<button class="btn primary" data-act="saveName">${esc(t('save'))}</button>`,
      onMount: () => setTimeout(() => { const n = $('#nameIn'); if (n) n.focus(); }, 80) });
  }
  function noteSheet(id) {
    openSheet({ title: t('addNote') + ' · ' + id, body: `<textarea class="f" id="noteTxt" maxlength="1000" placeholder="${esc(t('noteOpt'))}"></textarea>`,
      foot: `<button class="btn ghost" data-act="closeSheet">${esc(t('cancel'))}</button><button class="btn primary" data-act="saveNote">${esc(t('save'))}</button>`,
      onMount: () => setTimeout(() => { const n = $('#noteTxt'); if (n) n.focus(); }, 50) });
  }
  function reportSheet(id) {
    openSheet({ title: t('report') + ' · ' + id,
      body: `<div class="chips">${['notfound', 'gone', 'wrong', 'other'].map((k, i) => `<button class="chip" data-rp="${k}" aria-pressed="${i === 0}">${esc(t('rp_' + k))}</button>`).join('')}</div>
        <label class="f" for="rpTxt">${esc(t('describe'))}</label><textarea class="f" id="rpTxt" maxlength="1000"></textarea>`,
      foot: `<button class="btn ghost" data-act="closeSheet">${esc(t('cancel'))}</button><button class="btn warn" data-act="saveReport">${esc(t('save'))}</button>`,
      onMount: (sh) => $$('[data-rp]', sh).forEach(b => b.onclick = () => $$('[data-rp]', sh).forEach(x => x.setAttribute('aria-pressed', x === b))) });
  }

  /* ---------------- wizard: 1 position, 2 where, 3 photos ---------------- */
  function openWizard(id) {
    const e = eff(S.ds.concentrators.find(c => c.concentratorId === id));
    S.wz = { id, step: 1, placement: JSON.parse(JSON.stringify(e.placement || {})), more: {}, note: '', dirty: false };
    renderWizard();
  }
  function chipGroup(cat, single, limit) {
    const wz = S.wz, sel = new Set(wz.placement[cat] || []), items = dictItems(cat);
    const visible = wz.more[cat] || !limit ? items : items.filter((it, i) => i < limit || sel.has(it.key));
    const chips = visible.map(it => `<button class="chip" data-wcat="${cat}" data-wkey="${it.key}" data-single="${single ? 1 : 0}" aria-pressed="${sel.has(it.key)}">${cat === 'room' ? `<span class="ic">${ROOM_ICON[it.key] || '📍'}</span>` : ''}${esc(short(it[S.lang] || it.da))}</button>`).join('');
    const more = limit && !wz.more[cat] && items.length > visible.length ? `<button class="chip more" data-wmore="${cat}">${esc(t('moreOptions'))}</button>` : '';
    return `<div class="grp"><h3>${esc(t('cat_' + cat))}</h3><div class="chips">${chips}${more}</div></div>`;
  }
  function renderWizard() {
    const wz = S.wz; if (!wz) return;
    const e = eff(S.ds.concentrators.find(c => c.concentratorId === wz.id));
    const steps = `<div class="steps">${[1, 2, 3].map(i => `<i class="${i <= wz.step ? 'on' : ''}"></i>`).join('')}</div>`;
    let body = '', foot = '';
    if (wz.step === 1) {
      const me = S.me;
      body = `<h3 style="margin:0">1 · ${esc(t('wz1'))}</h3><p style="margin:0">${esc(t('wzGpsText'))}</p>
        ${e.verified ? `<div class="alert ok"><span class="ic">✓</span><span>${esc(t('posAlready', { t: fmtDate(e.verified.at, true) }))}</span></div>` : ''}
        ${me ? `<div class="card" style="text-align:center"><div class="mono" style="font-size:18px">${me.lat.toFixed(6)}, ${me.lng.toFixed(6)}</div>
          <div class="${me.acc > 25 ? '' : 'muted'}" style="margin-top:4px;font-weight:700;color:${me.acc > 25 ? '#8a5a00' : ''}">${esc(me.acc > 25 ? t('gpsBad', { a: me.acc }) : t('gpsAcc', { a: me.acc }))}${me.simulated ? ' · ' + esc(t('simulated')) : ''}</div></div>
          ${me.simulated ? `<div class="alert warn"><span class="ic">📌</span><span>${esc(t('posManualVerify'))}</span></div>` : ''}
          <button class="btn go big" data-act="wzHere">📍 ${esc(t('iAmHere'))}</button>`
        : `<div class="alert warn"><span class="ic">📍</span><span>${esc(t('gpsNeeded'))}</span></div><button class="btn primary" data-act="locate">📍 ${esc(t('showNearest'))}</button>`}`;
      foot = `<button class="btn ghost" data-act="wzNext">${esc(t('skip'))} ›</button>`;
    } else if (wz.step === 2) {
      body = `<h3 style="margin:0">2 · ${esc(t('wz2'))}</h3>
        <div class="preview"><div class="muted" style="color:#c9d6de;font-size:13px">${esc(t('preview'))}</div>${esc(sentence(wz.placement) || '…')}</div>
        ${chipGroup('room', true, 9)}${chipGroup('side', false, 0)}${chipGroup('height', true, 0)}${chipGroup('landmark', false, 0)}${chipGroup('floor', true, 0)}
        ${chipGroup('access', false, 0)}${chipGroup('antenna', false, 0)}
        <label class="f" for="wzNote">${esc(t('noteOpt'))}</label><textarea class="f" id="wzNote" maxlength="1000">${esc(wz.note)}</textarea>`;
      foot = `<button class="btn ghost" data-act="wzPrev" style="flex:.5">‹</button><button class="btn primary" data-act="wzNext">${esc(t('next'))} ›</button>`;
    } else {
      const mine = (S.ch[wz.id] && S.ch[wz.id].photos || []).filter(p => p.at >= (wz.startedAt || ''));
      body = `<h3 style="margin:0">3 · ${esc(t('wz3'))}</h3><p class="muted" style="margin:0">${esc(t('photoHint'))}</p>
        <button class="btn primary big" data-act="wzPhoto" data-kind="unit">📷 ${esc(t('photoUnit'))}</button>
        <button class="btn outline big" data-act="wzPhoto" data-kind="way">🚪 ${esc(t('photoWay'))}</button>
        ${mine.length ? `<div class="thumbs">${mine.map(p => `<button>${imgTag({ base: false, pid: p.pid }, e, 'thumb')}<span class="new">${esc(t('saved'))}</span></button>`).join('')}</div>` : ''}`;
      foot = `<button class="btn ghost" data-act="wzPrev" style="flex:.5">‹</button><button class="btn go" data-act="wzDone">✓ ${esc(t('done'))}</button>`;
    }
    const scroll = $('#sheet .sbody') ? $('#sheet .sbody').scrollTop : 0;
    openSheet({ title: t('wzTitle') + ' · ' + wz.id, steps, body, foot });
    const sb = $('#sheet .sbody'); if (sb && wz.keepScroll) sb.scrollTop = scroll; wz.keepScroll = false;
    hydrate($('#sheet'));
    const note = $('#wzNote'); if (note) note.oninput = () => { wz.note = note.value; };
  }
  async function wzSavePlacement() {
    const wz = S.wz; if (!wz) return;
    if (wz.dirty) {
      const p = {}; for (const [k, v] of Object.entries(wz.placement)) if (v && v.length) p[k] = v;
      wz.dirty = false; await addEvent(wz.id, 'placement', { placement: p, summary: sentence(p) });
    }
    if (wz.note.trim()) { const text = wz.note.trim(); wz.note = ''; await addEvent(wz.id, 'note', { text }); }
  }

  /* ---------------- photo intake ---------------- */
  $('#fileIn').addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; const target = S.photoTarget; S.photoTarget = null;
    if (!f || !target) return;
    if (f.size > 20 * 1024 * 1024) return toast(t('photoTooBig'));
    if (f.type && !/^image\//.test(f.type)) return toast(t('photoType'));
    toast(t('photoProc'));
    try {
      const img = await Data.processPhoto(f);
      const pid = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const ok = await Data.kvSet(Data.newImgKey(S.mode, pid), img); S.imgCache.set(Data.newImgKey(S.mode, pid), img);
      if (!ok) toast(t('storageWarn'));
      await addEvent(target.id, 'photo', { pid, caption: target.kind === 'way' ? t('photoWay') : target.kind === 'unit' ? t('photoUnit') : '', kind: target.kind || '', summary: '' });
      toast(t('saved'));
      if (S.wz) renderWizard();
    } catch { toast(t('photoType')); }
  });
  function takePhoto(id, kind) { S.photoTarget = { id, kind }; $('#fileIn').click(); }

  /* ---------------- shared store (temporary: Google Apps Script on Drive; later the Azure API, same calls) ---------------- */
  const remoteKey = (k) => k.startsWith('img:shared:') ? 'base__' + k.slice(11).replace(/[^A-Za-z0-9_.\-]/g, '_') : k.startsWith('newimg:shared:') ? 'new__' + k.slice(14).replace(/[^A-Za-z0-9_.\-]/g, '_') : '';
  async function api(action, payload, cfg) {
    const c = cfg || S.sync.cfg; if (!c) throw new Error('not_configured');
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 60000);
    try {
      const r = await fetch(c.url, { method: 'POST', body: JSON.stringify(Object.assign({ action, code: c.code }, payload || {})), redirect: 'follow', signal: ctl.signal });
      const j = await r.json(); if (!j.ok) throw new Error(j.error || 'error'); return j;
    } finally { clearTimeout(tm); }
  }
  const photoFetching = new Map();
  function fetchRemotePhoto(k) {
    const rk = remoteKey(k); if (!rk || !S.sync.cfg || !navigator.onLine) return Promise.resolve(null);
    if (!photoFetching.has(k)) photoFetching.set(k, api('getPhoto', { key: rk }).then(async j => { const v = { full: j.full, thumb: j.thumb }; await Data.kvSet(k, v); S.imgCache.set(k, v); return v; }).catch(() => null).finally(() => setTimeout(() => photoFetching.delete(k), 30000)));
    return photoFetching.get(k);
  }
  function scheduleSync(ms) { if (S.mode !== 'shared' || !S.sync.cfg) return; clearTimeout(S.sync.timer); S.sync.timer = setTimeout(syncNow, ms || 0); }
  async function syncNow() {
    if (S.mode !== 'shared' || !S.sync.cfg || S.sync.busy) return;
    if (!navigator.onLine) { S.sync.error = 'offline'; updateBadge(); return; }
    S.sync.busy = true; S.sync.error = ''; updateBadge();
    try {
      const st = S.sync.state;
      const man = await api('manifest');
      if (man.datasetVersion && man.datasetVersion !== st.version) {
        const j = await api('getDataset');
        if (j.dataset) { const ds = Data.validate(j.dataset); ds.demo = false; S.ds = ds; await Data.kvSet('dataset:shared', ds); st.version = j.version; S.addrIdx = null; }
      }
      // 1. send my photos, then my changes
      const mine = S.events.filter(e => !e.synced);
      for (const e of mine) if (e.type === 'photo' && !e.photoUp) {
        const k = Data.newImgKey('shared', e.data.pid); const v = S.imgCache.get(k) || await Data.kvGet(k);
        if (v) await api('putPhoto', { key: remoteKey(k), full: v.full, thumb: v.thumb });
        e.photoUp = true;
      }
      if (mine.length) {
        await api('pushEvents', { events: mine.map(e => ({ eid: e.eid, cid: e.cid, type: e.type, at: e.at, by: e.by, data: e.data })) });
        for (const e of mine) e.synced = true;
      }
      // 2. get everybody's changes
      let more = true, guard = 0;
      while (more && guard++ < 20) {
        const j = await api('getEvents', { since: st.since });
        const known = new Set(S.events.map(e => e.eid));
        for (const e of j.events) if (!known.has(e.eid)) S.events.push(Object.assign(e, { synced: true, remote: true }));
        st.since = j.total; more = !!j.more;
      }
      await Data.saveEvents('shared', S.events); await Data.kvSet('sync:state', st);
      S.sync.lastOk = new Date().toISOString();
      rebuildCh(); renderAll();
    } catch (err) {
      S.sync.error = String(err && err.message || err);
      if (S.sync.error === 'unauthorized') toast(t('syncUnauthorized'));
    } finally {
      S.sync.busy = false; updateBadge(); if (!$('#v-more').hidden) renderMore();
      if (S.events.some(e => !e.synced)) scheduleSync(60000);
    }
  }
  async function connectShared(cfg, silent) {
    const j = await api('ping', null, cfg);
    cfg.admin = !!j.admin;
    S.sync.cfg = cfg; await Data.kvSet('sync:cfg', cfg); await Data.kvSet('mode', 'shared');
    S.sync.state = (await Data.kvGet('sync:state')) || { since: 0, version: '' };
    const ds = await Data.kvGet('dataset:shared');
    await activate('shared', ds || { schema: 'koncentrator-kort/1', sites: [], concentrators: [], generatedAt: '' });
    if (!silent) toast(t('syncConnected'));
    await syncNow(); fitData();
    if (!S.prefs.name) nameSheet();
  }
  async function uploadToShared() {
    // office: put the current local dataset (+ old photos) into the shared store. Contact persons are not uploaded.
    const msg = $('#syncMsg');
    const local = await Data.kvGet('dataset:local');
    if (!local) { toast(t('uploadNeedsLocal')); return; }
    const ds = JSON.parse(JSON.stringify(local)); for (const c of ds.concentrators) delete c.accessRestricted;
    if (msg) msg.textContent = t('uploading', { i: 0, n: 1 });
    await api('putDataset', { dataset: ds });
    const files = []; for (const c of ds.concentrators) for (const p of c.photos || []) files.push(p.file);
    let i = 0, ok = 0;
    for (const f of files) {
      i++; if (msg) msg.textContent = t('uploading', { i, n: files.length });
      const v = S.imgCache.get(Data.imgKey('local', f)) || await Data.kvGet(Data.imgKey('local', f));
      if (!v) continue;
      try { await api('putPhoto', { key: remoteKey('img:shared:' + f), full: v.full, thumb: v.thumb }); await Data.kvSet(Data.imgKey('shared', f), v); ok++; } catch {}
    }
    // my local changes travel along
    const localEv = await Data.getEvents('local');
    for (const e of localEv) if (e.type === 'photo') { const v = await Data.kvGet(Data.newImgKey('local', e.data.pid)); if (v) { await api('putPhoto', { key: remoteKey(Data.newImgKey('shared', e.data.pid)), full: v.full, thumb: v.thumb }); await Data.kvSet(Data.newImgKey('shared', e.data.pid), v); } }
    if (localEv.length) await api('pushEvents', { events: localEv.map(e => ({ eid: e.eid, cid: e.cid, type: e.type, at: e.at, by: e.by, data: e.data })) });
    await connectShared(S.sync.cfg, true);
    toast(t('uploadDone', { n: ds.concentrators.length, p: ok })); const m2 = $('#syncMsg'); if (m2) m2.textContent = t('uploadDone', { n: ds.concentrators.length, p: ok });
  }
  function setupLink() {
    const c = S.sync.cfg; if (!c) return '';
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ url: c.url, code: c.memberCode || c.code }))));
    return location.origin + location.pathname + '#setup=' + payload;
  }
  window.addEventListener('online', () => scheduleSync(500));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(300); });
  setInterval(() => { if (document.visibilityState === 'visible') scheduleSync(0); }, 120000);

  /* ---------------- photo viewer ---------------- */
  let vList = [], vIdx = 0, vRec = null;
  function openViewer(rec, i) { vRec = rec; vList = rec.photos; vIdx = i; $('#viewer').hidden = false; showViewerImg(); }
  async function showViewerImg() {
    const p = vList[vIdx]; const img = $('#viewerImg');
    if (p.base && S.mode === 'demo') img.src = demoSrc(p, vRec);
    else { const k = photoKey(p); let v = S.imgCache.get(k) || await Data.kvGet(k); if (!v && S.mode === 'shared') v = await fetchRemotePhoto(k); if (v) { S.imgCache.set(k, v); img.src = v.full; } }
    $('#viewerTxt').textContent = `${vIdx + 1}/${vList.length}${p.caption ? ' · ' + p.caption : ''}${p.at ? ' · ' + fmtDate(p.at) : ''}`;
  }

  /* ---------------- more view: data, changes, settings ---------------- */
  function renderMore() {
    const all = S.ds.concentrators.map(eff);
    const st = { total: all.length, withPhoto: all.filter(e => e.photos.length).length, detailed: all.filter(e => e.ck.room && e.ck.detail).length, verified: all.filter(e => e.ck.gps).length, own: all.filter(e => e.ownSite).length };
    const changed = Object.keys(S.ch).length;
    $('#moreWrap').innerHTML = `
      <div class="card"><h2>${esc(t('stats'))}</h2><dl class="kv">
        <dt>${esc(t('st_total'))}</dt><dd>${st.total}</dd><dt>${esc(t('st_withPhoto'))}</dt><dd>${st.withPhoto}</dd>
        <dt>${esc(t('st_detailed'))}</dt><dd>${st.detailed}</dd><dt>${esc(t('st_verified'))}</dt><dd>${st.verified}</dd><dt>${esc(t('st_own'))}</dt><dd>${st.own}</dd>
        <dt>LinkIQ</dt><dd>${esc(t('sitesN', { n: S.ds.sites.length }))}</dd></dl>
        <button class="btn ghost" data-act="showIncomplete" style="margin-top:10px">${esc(t('f_incomplete'))} (${all.filter(e => e.score < 3).length}) ›</button></div>
      <div class="card"><h2>${esc(t('changes'))}</h2><p style="margin:0 0 10px">${esc(t('changesN', { n: changed }))}</p>
        <button class="btn primary" data-act="export" ${changed ? '' : 'disabled'}>⬇ ${esc(t('exportChanges'))}</button>
        <p class="muted">${esc(t('exportHint'))}</p>
        <button class="btn outline" data-act="importChanges" style="margin-top:8px">⬆ ${esc(t('importChanges'))}</button>
        ${S.mode !== 'shared' ? `<button class="btn danger" data-act="clearChanges" ${changed ? '' : 'disabled'}>${esc(t('clearChanges'))}</button>` : ''}</div>
      ${sharedCard()}
      <div class="card"><h2>${esc(t('dataTitle'))}</h2>
        <div class="alert ${S.mode !== 'demo' ? 'ok' : 'info'}"><span class="ic">${S.mode !== 'demo' ? '🔒' : 'ℹ'}</span><span>${S.mode !== 'demo' ? esc(t('loaded', { n: S.ds.concentrators.length })) : esc(t('aboutDemo'))}</span></div>
        <h3 style="margin:14px 0 6px">${esc(t('loadLocal'))}</h3><p class="muted" style="margin:0 0 8px">${esc(t('loadLocalHint'))}</p>
        <button class="btn outline" data-act="pickJson">📄 ${esc(t('pickJson'))}</button>
        <button class="btn outline" data-act="pickPhotos" style="margin-top:8px" ${S.mode === 'local' ? '' : 'disabled'}>🖼 ${esc(t('pickPhotos'))}</button>
        <div id="loadMsg" class="muted" style="margin-top:8px"></div>
        ${S.mode === 'local' ? `<button class="btn primary" data-act="phonePack" style="margin-top:12px">📱 ${esc(t('phonePack'))}</button><p class="muted" style="margin:6px 0 0">${esc(t('phonePackHint'))}</p>` : ''}
        ${S.mode === 'local' ? `<button class="btn ghost" data-act="useDemo" style="margin-top:12px">${esc(t('useDemo'))}</button>
          <button class="btn danger" data-act="forget" style="margin-top:8px">${esc(t('forget'))}</button>` : ''}</div>
      <div class="card"><h2>${esc(t('yourName'))}</h2><input class="f" id="myName" maxlength="60" value="${esc(S.prefs.name)}" autocomplete="name"></div>
      <div class="card"><h2>${esc(t('about'))}</h2><button class="btn outline" data-act="showQr" data-qr="app" style="margin-bottom:10px">▦ ${esc(t('qrAppTitle'))}</button><p style="margin:0 0 6px">${esc(t('aboutDemo'))}</p><p class="muted" style="margin:0">${esc(t('aboutPrivacy'))}</p></div>`;
    $('#myName').onchange = async (e) => { S.prefs.name = e.target.value.trim(); await Data.kvSet('prefs', S.prefs); toast(t('saved')); };
  }
  function sharedCard() {
    const c = S.sync.cfg, pending = S.events.filter(e => !e.synced).length;
    if (!c) return `<div class="card"><h2>${esc(t('syncTitle'))}</h2><p class="muted" style="margin:0 0 8px">${esc(t('syncHint'))}</p>
      <label class="f" for="syUrl">${esc(t('syncUrl'))}</label><input class="f" id="syUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec">
      <label class="f" for="syCode">${esc(t('syncCode'))}</label><input class="f" id="syCode" autocomplete="off">
      <button class="btn primary" data-act="syncConnect" style="margin-top:10px">${esc(t('syncConnect'))}</button><div id="syncMsg" class="muted" style="margin-top:6px"></div></div>`;
    return `<div class="card"><h2>${esc(t('syncTitle'))}${c.admin ? ' · ' + esc(t('adminBadge')) : ''}</h2>
      <div class="alert ${S.sync.error ? 'warn' : 'ok'}"><span class="ic">${S.sync.error ? '⚠' : '✓'}</span><span>${esc(S.sync.error === 'offline' ? t('syncOffline') : S.sync.error ? t('syncErr', { e: S.sync.error }) : t('syncConnected'))}<br>
        <span class="muted">${esc(t('syncLast', { t: S.sync.lastOk ? fmtDate(S.sync.lastOk, true) : t('never2') }))}${pending ? ' · ' + esc(t('syncPending', { n: pending })) : ''}</span></span></div>
      <button class="btn primary" data-act="syncNow" style="margin-top:10px" ${S.sync.busy ? 'disabled' : ''}>⟳ ${esc(t('syncNow'))}</button>
      ${c.admin ? `<label class="f" for="syMember">${esc(t('memberCode'))}</label><input class="f" id="syMember" autocomplete="off" value="${esc(c.memberCode || '')}">
        <div class="row" style="margin-top:8px"><button class="btn outline" data-act="copyLink">🔗 ${esc(t('copyLinkShort'))}</button><button class="btn primary" data-act="copyLink" data-mode="qr">▦ ${esc(t('showQr'))}</button></div><p class="muted" style="margin:6px 0 0">${esc(t('linkHint'))}</p>
        <button class="btn ${S.ds.concentrators.length ? 'outline' : 'primary big'}" data-act="uploadShared" style="margin-top:10px">⬆ ${esc(t('uploadShared'))}</button>` : ''}
      <div id="syncMsg" class="muted" style="margin-top:6px"></div>
      <button class="btn danger" data-act="syncDisconnect" style="margin-top:10px">${esc(t('syncDisconnect'))}</button></div>`;
  }
  let confirmArmed = null;
  function armed(key) { if (confirmArmed === key) { confirmArmed = null; return true; } confirmArmed = key; toast(t('confirmAgain')); setTimeout(() => { if (confirmArmed === key) confirmArmed = null; }, 4000); return false; }

  async function loadJsonFile(file) {
    try {
      const ds = Data.validate(JSON.parse(await file.text()));
      ds.demo = false;
      if (ds.embeddedPhotos && typeof ds.embeddedPhotos === 'object') {   // phone package: photos travel inside the JSON
        let n = 0;
        for (const [f, img] of Object.entries(ds.embeddedPhotos)) {
          if (f.startsWith('new:') && img && typeof img.full === 'string' && img.full.startsWith('data:image/')) { await Data.kvSet(Data.newImgKey('local', f.slice(4)), img); S.imgCache.set(Data.newImgKey('local', f.slice(4)), img); n++; continue; }
          if (img && typeof img.full === 'string' && img.full.startsWith('data:image/') && typeof img.thumb === 'string' && img.thumb.startsWith('data:image/')) {
            await Data.kvSet(Data.imgKey('local', f), { full: img.full, thumb: img.thumb }); S.imgCache.set(Data.imgKey('local', f), img); n++;
          }
        }
        delete ds.embeddedPhotos; toast(t('photosLinked', { n }));
      }
      const packEvents = Array.isArray(ds.events) ? ds.events : null; delete ds.events;
      const ok = await Data.saveLocalDataset(ds); if (!ok) toast(t('storageWarn'));
      await activate('local', ds);
      if (packEvents) await mergeEvents(packEvents, null, true);
      $('#loadMsg') && ($('#loadMsg').textContent = t('loaded', { n: ds.concentrators.length }));
      renderMore(); fitData(); toast(t('loaded', { n: ds.concentrators.length }));
    } catch { toast(t('badFile')); }
  }
  async function loadPhotoFiles(files) {
    const byName = new Map(); for (const f of files) byName.set(f.name.toLowerCase(), f);
    const wanted = []; for (const c of S.ds.concentrators) for (const p of c.photos || []) wanted.push(p.file);
    let linked = 0, missing = 0, i = 0;
    for (const file of wanted) {
      i++; const msg = $('#loadMsg'); if (msg) msg.textContent = t('loadingPhotos', { i, n: wanted.length });
      const f = byName.get(file.split('/').pop().toLowerCase());
      if (!f) { missing++; continue; }
      try { const img = await Data.processPhoto(f); await Data.kvSet(Data.imgKey('local', file), img); S.imgCache.set(Data.imgKey('local', file), img); linked++; } catch { missing++; }
    }
    const msg = $('#loadMsg'); if (msg) msg.textContent = t('photosLinked', { n: linked }) + (missing ? ' · ' + t('photosMissing', { n: missing }) : '');
    toast(t('photosLinked', { n: linked })); renderAll();
  }
  function download(obj, name) {
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  async function phonePack() {
    const msg = $('#loadMsg'); if (msg) msg.textContent = t('packing');
    const out = Object.assign({}, S.ds, { embeddedPhotos: {} }); let n = 0;
    for (const c of S.ds.concentrators) for (const p of c.photos || []) {
      const k = Data.imgKey('local', p.file); const v = S.imgCache.get(k) || await Data.kvGet(k);
      if (v) { out.embeddedPhotos[p.file] = { full: v.full, thumb: v.thumb }; n++; }
    }
    out.events = S.events.map(e => ({ eid: e.eid, cid: e.cid, type: e.type, at: e.at, by: e.by, data: e.data }));
    for (const e of S.events) if (e.type === 'photo') { const k = Data.newImgKey(S.mode, e.data.pid); const v = S.imgCache.get(k) || await Data.kvGet(k); if (v) out.embeddedPhotos['new:' + e.data.pid] = v; }
    download(out, 'koncentrator-telefon.json');
    if (msg) msg.textContent = t('packDone', { n }); toast(t('packDone', { n }));
  }
  async function exportChanges() {
    const photos = {};
    for (const e of S.events) if (e.type === 'photo') { const k = Data.newImgKey(S.mode, e.data.pid); const v = S.imgCache.get(k) || await Data.kvGet(k); if (v) photos[e.data.pid] = v; }
    const out = { schema: 'koncentrator-kort-changes/2', exportedAt: new Date().toISOString(), by: S.prefs.name || '', mode: S.mode, datasetGeneratedAt: S.ds.generatedAt || '',
      events: S.events.map(e => ({ eid: e.eid, cid: e.cid, type: e.type, at: e.at, by: e.by, data: e.data })), photos };
    download(out, `koncentrator-aendringer-${(S.prefs.name || 'montoer').replace(/\W+/g, '_')}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`);
  }
  async function mergeEvents(list, photos, remote) {
    const known = new Set(S.events.map(e => e.eid)); let added = 0;
    for (const e of list || []) {
      if (!e || !e.eid || known.has(e.eid) || !/^(verify|placement|note|photo|report)$/.test(e.type)) continue;
      S.events.push({ eid: e.eid, cid: String(e.cid), type: e.type, at: e.at, by: e.by, data: e.data || {}, synced: true, remote: !!remote }); known.add(e.eid); added++;
    }
    for (const [pid, v] of Object.entries(photos || {})) {
      const img = typeof v === 'string' ? { full: v, thumb: v } : v;
      if (img && typeof img.full === 'string' && img.full.startsWith('data:image/')) { await Data.kvSet(Data.newImgKey(S.mode, pid), img); S.imgCache.set(Data.newImgKey(S.mode, pid), img); }
    }
    if (added) { await Data.saveEvents(S.mode, S.events); rebuildCh(); renderAll(); }
    return added;
  }
  async function importChangeFiles(files) {
    let added = 0, bad = 0;
    for (const f of files) {
      try {
        const j = JSON.parse(await f.text());
        if (j.schema === 'koncentrator-kort-changes/2') added += await mergeEvents(j.events, j.photos, true);
        else if (j.schema === 'koncentrator-kort-changes/1') added += await mergeEvents(Data.changesToEvents(j.changes).map(e => Object.assign(e, { synced: true })), j.photos, true);
        else bad++;
      } catch { bad++; }
    }
    toast(t('importDone', { n: added }) + (bad ? ' · ' + t('badFile') : '')); renderMore();
  }


  /* ---------------- events ---------------- */
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2800); }
  async function copy(txt) { try { await navigator.clipboard.writeText(txt); toast(t('copied')); } catch { toast(txt); } }

  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-act],[data-open],[data-tab],[data-photo],[data-copy],[data-wcat],[data-wmore],[data-lang],[data-setpos]'); if (!el) return;
    if (el.dataset.setpos) { const [la, lo] = el.dataset.setpos.split(',').map(Number); closeSheet(); setTab('map'); setManual(la, lo, el.dataset.lbl || ''); return; }
    if (el.dataset.lang) { S.lang = el.dataset.lang; S.prefs.lang = S.lang; Data.kvSet('prefs', S.prefs); applyI18n(); renderAll(); if (!$('#v-more').hidden) renderMore(); if (S.wz) renderWizard(); return; }
    if (el.dataset.tab) { closeSheet(); setTab(el.dataset.tab); return; }
    if (el.dataset.open) { closeSheet(); const [ty, ...rest] = el.dataset.open.split(':'); openDetail(ty, rest.join(':')); return; }
    if (el.dataset.photo) { openViewer(currentDetail(), +el.dataset.photo); return; }
    if (el.dataset.copy) { copy(el.dataset.copy); return; }
    if (el.dataset.wmore) { S.wz.more[el.dataset.wmore] = true; S.wz.keepScroll = true; renderWizard(); return; }
    if (el.dataset.wcat) {
      const wz = S.wz, cat = el.dataset.wcat, key = el.dataset.wkey, single = el.dataset.single === '1';
      const cur = new Set(wz.placement[cat] || []);
      if (cur.has(key)) cur.delete(key); else { if (single) cur.clear(); cur.add(key); }
      wz.placement[cat] = [...cur]; wz.dirty = true; wz.keepScroll = true; renderWizard(); return;
    }
    const r = currentDetail();
    switch (el.dataset.act) {
      case 'closeSheet': if (S.wz) await wzSavePlacement(); closeSheet(); break;
      case 'back': S.detail = null; lineLayer.clearLayers(); showView(S.prevTab === 'list' || wide() ? (wide() ? 'map' : 'list') : 'map'); if (!$('#v-list').hidden) renderList(); renderMarkers(); break;
      case 'locate': closeSheet(); if (S.me && S.manual) { positionSheet(); break; }
        if (S.me) { S.follow = !S.follow; $('#btnLocate').classList.toggle('on', S.follow); toast(t(S.follow ? 'followOn' : 'followOff')); if (S.follow) map.setView([S.me.lat, S.me.lng], Math.max(map.getZoom(), 16)); } else startGps(); startCompass(true); break;
      case 'toggleNear': S.prefs.nearCollapsed = !S.prefs.nearCollapsed; Data.kvSet('prefs', S.prefs); renderNear(); break;
      case 'showQr': qrSheet(el.dataset.qr === 'setup' ? setupLink() : location.origin + location.pathname, el.dataset.qr === 'setup'); break;
      case 'sim': positionSheet(); break;
      case 'posMap': closeSheet(); S.sim = true; setTab('map'); toast(t('posTapMap')); break;
      case 'posGps': closeSheet(); S.gpsFailShown = true; startGps(); break;
      case 'compass': startCompass(true); break;
      case 'filter': filterSheet(); break;
      case 'clearFilters': S.filters.info.clear(); S.filters.tech = new Set(['radiomesh', 'linkiq']); S.q = ''; $('#q').value = ''; closeSheet(); renderAll(); break;
      case 'more': S.listLimit += 100; renderList(); break;
      case 'wizard': openWizard(r.id); break;
      case 'addPhoto': takePhoto(r.id, ''); break;
      case 'addNote': noteSheet(r.id); break;
      case 'saveNote': { const v = $('#noteTxt').value.trim(); if (!v) return; closeSheet(); await addEvent(r.id, 'note', { text: v }); toast(t('noteSaved')); break; }
      case 'report': reportSheet(r.id); break;
      case 'saveReport': { const k = ($('[data-rp][aria-pressed="true"]') || {}).dataset.rp || 'other'; const txt = $('#rpTxt').value.trim();
        closeSheet(); await addEvent(r.id, 'report', { kind: k, text: txt, status: (k === 'notfound' || k === 'gone') ? 'RequiresVerification' : null, summary: t('rp_' + k) + (txt ? ': ' + txt : '') }); toast(t('reportSaved')); break; }
      case 'wzHere': { const wz = S.wz, me = S.me; if (!me) return;
        await addEvent(wz.id, 'verify', { lat: +me.lat.toFixed(6), lng: +me.lng.toFixed(6), acc: me.acc, simulated: !!me.simulated, source: me.simulated ? 'manual' : 'gps', summary: (me.simulated ? '📌 ' : '±' + me.acc + ' m') });
        toast(t('posSaved')); wz.step = 2; renderWizard(); break; }
      case 'wzNext': if (S.wz.step === 2) { if (!(S.wz.placement.room || []).length && S.wz.dirty) { toast(t('nothingChosen')); return; } await wzSavePlacement(); }
        S.wz.step = Math.min(3, S.wz.step + 1); if (S.wz.step === 3) S.wz.startedAt = S.wz.startedAt || new Date(Date.now() - 1000).toISOString(); renderWizard(); break;
      case 'wzPrev': if (S.wz.step === 2) await wzSavePlacement(); S.wz.step = Math.max(1, S.wz.step - 1); renderWizard(); break;
      case 'wzPhoto': if (!S.wz.startedAt) S.wz.startedAt = new Date(Date.now() - 1000).toISOString(); takePhoto(S.wz.id, el.dataset.kind); break;
      case 'wzDone': await wzSavePlacement(); closeSheet(); toast(t('saved')); renderDetail(); break;
      case 'pickJson': $('#jsonIn').click(); break;
      case 'pickPhotos': $('#dirIn').click(); break;
      case 'useDemo': await Data.useDemo(); await activate('demo', Data.demoDataset()); renderMore(); fitData(); break;
      case 'forget': if (!armed('forget')) return; await Data.forgetLocal(); S.imgCache.clear(); await activate('demo', Data.demoDataset()); renderMore(); fitData(); break;
      case 'export': exportChanges(); break;
      case 'phonePack': phonePack(); break;
      case 'importChanges': $('#chgIn').click(); break;
      case 'saveName': { const v = ($('#nameIn').value || '').trim(); if (!v) return; S.prefs.name = v; await Data.kvSet('prefs', S.prefs); closeSheet(); toast(t('saved')); break; }
      case 'syncConnect': { const url = ($('#syUrl').value || '').trim(), code = ($('#syCode').value || '').trim();
        if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url) || !code) { toast(t('required')); return; }
        $('#syncMsg').textContent = t('connecting');
        try { await connectShared({ url, code }); setTab('map'); } catch (e) { $('#syncMsg').textContent = t('syncErr', { e: e.message }); } break; }
      case 'syncNow': await syncNow(); break;
      case 'copyLink': { const m = ($('#syMember').value || '').trim(); if (!m || m === S.sync.cfg.code) { toast(t('linkNeedsMember')); return; }
        S.sync.cfg.memberCode = m; await Data.kvSet('sync:cfg', S.sync.cfg);
        if (el.dataset.mode === 'qr') qrSheet(setupLink(), true); else copy(setupLink()); break; }
      case 'uploadShared': try { await uploadToShared(); } catch (e) { toast(t('syncErr', { e: e.message })); } break;
      case 'syncDisconnect': if (!armed('disc')) return; await Data.forgetShared(); S.sync.cfg = null; S.imgCache.clear(); await activate('demo', Data.demoDataset()); renderMore(); fitData(); break;
      case 'clearChanges': if (!armed('clear')) return; await Data.clearChanges(S.mode); S.events = []; rebuildCh(); renderAll(); renderMore(); break;
      case 'showIncomplete': S.filters.info = new Set(['incomplete']); S.filters.tech = new Set(['radiomesh']); setTab('list'); renderAll(); break;
    }
  });
  $('#jsonIn').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) loadJsonFile(f); });
  $('#chgIn').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) importChangeFiles(fs); });
  $('#dirIn').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) loadPhotoFiles(fs); });
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') { if (S.wz) wzSavePlacement(); closeSheet(); } });
  $('#viewerClose').onclick = () => { $('#viewer').hidden = true; };
  $('#viewerPrev').onclick = () => { vIdx = (vIdx - 1 + vList.length) % vList.length; showViewerImg(); };
  $('#viewerNext').onclick = () => { vIdx = (vIdx + 1) % vList.length; showViewerImg(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('#viewer').hidden) $('#viewer').hidden = true; else if (!$('#sheet').hidden) { if (S.wz) wzSavePlacement(); closeSheet(); } } });
  let qT; $('#q').addEventListener('input', (e) => { clearTimeout(qT); qT = setTimeout(() => { S.q = e.target.value; S.listLimit = 80; renderAll();
    if (S.q && !$('#v-map').hidden && !wide()) { const r = filtered().filter(x => x.lat != null); if (r.length === 1) openDetail(r[0].kind, r[0].id); else if (r.length && r.length < 300) map.fitBounds(L.latLngBounds(r.map(x => [x.lat, x.lng])).pad(.2), { maxZoom: 17 }); } }, 220); });
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(qT); S.q = e.target.value; e.target.blur(); renderAll(); const r = filtered(); if (r.length) openDetail(r[0].kind, r[0].id); } });
  window.addEventListener('resize', () => { if (S.detail && !$('#v-detail').hidden) showView('detail'); else showView(S.tab); });

  /* ---------------- boot ---------------- */
  async function activate(mode, ds) { S.mode = mode; S.ds = ds; S.events = await Data.getEvents(mode); rebuildCh(); S.detail = null; applyI18n(); renderAll(); }
  (async function boot() {
    $('#listWrap').innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
    S.prefs = Object.assign({ name: '', lang: 'da' }, (await Data.kvGet('prefs')) || {});
    S.lang = I18N[S.prefs.lang] ? S.prefs.lang : 'da';
    try { S.dict = await Data.loadDictionary(); } catch { S.dict = { categories: {} }; toast('placement-dictionary.json ?'); }
    initMap();
    S.sync.cfg = (await Data.kvGet('sync:cfg')) || null;
    S.sync.state = (await Data.kvGet('sync:state')) || { since: 0, version: '' };
    const m = location.hash.match(/^#setup=([A-Za-z0-9+/=]+)$/);
    if (m) {
      history.replaceState(null, '', location.pathname + location.search);
      try { const cfg = JSON.parse(decodeURIComponent(escape(atob(m[1])))); if (/^https:\/\/script\.google(usercontent)?\.com\//.test(cfg.url) && cfg.code) { toast(t('setupLinkOk')); S.sync.cfg = null; await connectShared({ url: cfg.url, code: cfg.code }, true).catch(() => toast(t('syncUnauthorized'))); } } catch { toast(t('badFile')); }
    }
    if (!S.mode || S.mode === 'demo' || !S.ds) {
      const { mode, ds } = await Data.loadActive();
      if (mode !== 'shared' || S.sync.cfg) await activate(mode, ds); else await activate('demo', Data.demoDataset());
    }
    setTab('map'); fitData(); if (S.mode === 'shared') scheduleSync(200);
    let granted = false;
    try { if (navigator.permissions) { const p = await navigator.permissions.query({ name: 'geolocation' }); granted = p.state === 'granted'; if (p.state === 'denied') S.gpsFailShown = true; } } catch {}
    if (granted) startGps();
    else { const last = await Data.kvGet('lastManualPos'); if (last && typeof last.lat === 'number') { S.manual = true; setMe({ lat: last.lat, lng: last.lng, acc: 5, simulated: true, label: last.label || '' }, true); } }
  })();
})();
