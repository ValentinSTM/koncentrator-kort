/* Antenne-check: the camera shows where the concentrator (Radio Mesh) or the LinkIQ site is.
   - phone flat above the antenna (camera down): a line from the centre towards the target, relative to the top edge
     of the phone, so the antenna seen from above can be lined up with it;
   - phone upright: the targets appear as pins in the camera image, in their compass direction.
   The photo is saved with the information band burnt in (target, distance, direction, deviation, GPS, time).
   Direction comes from the phone compass + GPS: indicative, typically ±10–20° near metal. */
'use strict';
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const wrap = (a) => ((a + 540) % 360) - 180;

  const A = { meter: { serial: '', order: '', raw: '' }, scanning: false, scanUntil: 0, lastScan: 0, open: false, stream: null, ori: null, sx: 0, sy: 0, smooth: null, targetId: null, techs: new Set(['radiomesh', 'linkiq']), raf: 0, lastPanel: 0 };

  function onOri(e) {
    A.ori = { alpha: e.alpha, beta: e.beta, gamma: e.gamma, absolute: !!e.absolute || e.type === 'deviceorientationabsolute', webkit: typeof e.webkitCompassHeading === 'number' ? e.webkitCompassHeading : null, acc: typeof e.webkitCompassAccuracy === 'number' ? e.webkitCompassAccuracy : null };
  }
  /* pose of the phone: heading of the top edge (flat use), heading + elevation of the back camera (upright use) */
  function pose() {
    const o = A.ori; if (!o || o.beta == null) return null;
    const a = (o.alpha || 0) * D2R, b = o.beta * D2R, g = (o.gamma || 0) * D2R;
    const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
    const vx = -(cA * sG + cG * sA * sB), vy = -(sA * sG - cA * cG * sB), vz = -cB * cG;   // back-camera direction (E, N, Up)
    const elev = Math.asin(Math.max(-1, Math.min(1, vz))) * R2D;
    const scr = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    let top, cam;
    if (o.webkit != null) { top = (o.webkit + scr) % 360; cam = o.webkit; }              // iOS: tilt-compensated compass
    else if (o.absolute && o.alpha != null) { top = (360 - o.alpha + scr) % 360; cam = (Math.atan2(vx, vy) * R2D + 360) % 360; }
    else return { elev, top: null, cam: null };
    // smooth the heading that is in use (unit-vector low-pass, no jump at 0/360)
    const h = elev < -55 ? top : cam, k = 0.25;
    A.sx = A.sx * (1 - k) + Math.sin(h * D2R) * k; A.sy = A.sy * (1 - k) + Math.cos(h * D2R) * k;
    const hs = (Math.atan2(A.sx, A.sy) * R2D + 360) % 360;
    return { elev, top: elev < -55 ? hs : top, cam: elev < -55 ? cam : hs, mode: elev < -55 ? 'top' : 'up', compassAcc: o.acc };
  }

  function targets(K) {
    const me = K.S.me; if (!me) return [];
    const out = [];
    if (A.techs.has('radiomesh')) for (const c of K.S.ds.concentrators) { const e = K.eff(c); if (e.lat != null) out.push({ id: e.id, kind: 'c', tech: 'radiomesh', label: e.id, lat: e.lat, lng: e.lng }); }
    if (A.techs.has('linkiq')) for (const s of K.S.ds.sites) if (s.latitude != null) out.push({ id: s.siteId, kind: 's', tech: 'linkiq', label: s.name || s.siteId, lat: s.latitude, lng: s.longitude });
    for (const x of out) { x.d = K.hav(me, x); x.b = K.bearing(me, x); }
    return out.filter(x => x.d < 5000).sort((a, b) => a.d - b.d).slice(0, 12);
  }

  function fov() { const K = window.KK; return +(K.S.prefs.arFov || 52); }

  function draw(cv, K, p, list, sel, forPhoto) {
    const g = cv.getContext('2d'), w = cv.width, h = cv.height, u = Math.max(1, w / 400);
    if (!forPhoto) g.clearRect(0, 0, w, h);
    g.lineCap = 'round'; g.font = `700 ${Math.round(14 * u)}px system-ui,sans-serif`; g.textAlign = 'center';
    const colorOf = (x) => x.tech === 'linkiq' ? '#42a5f5' : '#ce93d8';
    if (!p || p.cam == null) return;
    if (p.mode === 'top') {
      const cx = w / 2, cy = h * 0.45, L = Math.min(w, h) * 0.38;
      g.setLineDash([10 * u, 8 * u]); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3 * u;
      g.beginPath(); g.moveTo(cx, cy + L); g.lineTo(cx, cy - L); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(255,255,255,.9)'; g.fillText('▲', cx, cy - L - 6 * u);
      if (sel) {
        const ang = wrap(sel.b - p.top) * D2R;
        g.strokeStyle = colorOf(sel); g.lineWidth = 6 * u;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(ang) * L, cy - Math.cos(ang) * L); g.stroke();
        g.save(); g.translate(cx + Math.sin(ang) * L, cy - Math.cos(ang) * L); g.rotate(ang);
        g.fillStyle = colorOf(sel); g.beginPath(); g.moveTo(0, -18 * u); g.lineTo(12 * u, 6 * u); g.lineTo(-12 * u, 6 * u); g.closePath(); g.fill(); g.restore();
        g.fillStyle = '#fff'; g.fillText(sel.label, cx + Math.sin(ang) * (L + 26 * u), cy - Math.cos(ang) * (L + 26 * u));
      }
      const tr = 40 * u;   // the antenna seen from above: the tip of the triangle towards the top of the phone
      g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 7 * u; g.beginPath(); g.moveTo(cx, cy - tr * 1.6); g.lineTo(cx + tr, cy + tr * .8); g.lineTo(cx - tr, cy + tr * .8); g.closePath(); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = 3.5 * u; g.stroke();
      return;
    }
    // upright: pins on the horizon
    const hf = fov(), vf = hf * h / w;
    const horizon = h / 2 + (p.elev / vf) * h;
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.5 * u; g.beginPath(); g.moveTo(0, horizon); g.lineTo(w, horizon); g.stroke();
    const drawn = [];
    for (const x of list.slice().reverse()) {
      const rel = wrap(x.b - p.cam), isSel = sel && x.id === sel.id;
      if (Math.abs(rel) > hf / 2) {
        if (!isSel) continue;
        const left = rel < 0, ex = left ? 22 * u : w - 22 * u;
        g.fillStyle = colorOf(x); g.font = `900 ${Math.round(34 * u)}px system-ui,sans-serif`; g.fillText(left ? '◀' : '▶', ex, horizon + 12 * u);
        g.font = `700 ${Math.round(13 * u)}px system-ui,sans-serif`; g.fillStyle = '#fff'; g.fillText(`${Math.abs(Math.round(rel))}°`, ex, horizon + 34 * u);
        continue;
      }
      const px = w / 2 + (rel / hf) * w;
      const r = (isSel ? 16 : 10) * u, top = horizon - (isSel ? 70 : 44) * u;
      g.strokeStyle = colorOf(x); g.lineWidth = (isSel ? 4 : 2) * u; g.beginPath(); g.moveTo(px, horizon); g.lineTo(px, top + r); g.stroke();
      g.fillStyle = colorOf(x); g.beginPath();
      if (x.tech === 'linkiq') { g.moveTo(px, top - r); g.lineTo(px + r, top); g.lineTo(px, top + r); g.lineTo(px - r, top); g.closePath(); } else g.arc(px, top, r, 0, Math.PI * 2);
      g.fill(); g.lineWidth = 3 * u; g.strokeStyle = '#fff'; g.stroke();
      g.font = `${isSel ? 800 : 600} ${Math.round((isSel ? 15 : 12) * u)}px system-ui,sans-serif`;
      const t1 = `${x.label} · ${K.fmtDist(x.d)}`, tw = g.measureText(t1).width + 12 * u, ly = top - r - 26 * u;
      const box = [px - tw / 2, px + tw / 2, ly];
      if (isSel || drawn.every(b => box[1] < b[0] || box[0] > b[1] || Math.abs(box[2] - b[2]) > 22 * u)) {
        g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(px - tw / 2, ly, tw, 20 * u);
        g.fillStyle = '#fff'; g.fillText(t1, px, top - r - 11 * u); drawn.push(box);
      }
    }
    if (sel) { g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2 * u; g.beginPath(); g.moveTo(w / 2, h / 2 - 14 * u); g.lineTo(w / 2, h / 2 + 14 * u); g.moveTo(w / 2 - 14 * u, h / 2); g.lineTo(w / 2 + 14 * u, h / 2); g.stroke(); }
  }

  function info(K, p, sel) {
    if (!sel) return null;
    const head = p ? (p.mode === 'top' ? p.top : p.cam) : null;
    const dev = head == null ? null : Math.round(wrap(sel.b - head));
    const m = A.meter;
    return { dev, head, txt: [
      `${sel.tech === 'linkiq' ? 'LinkIQ' : 'Radio Mesh'} · ${sel.label}`,
      `${K.fmtDist(sel.d)} · ${Math.round(sel.b)}° ${K.dirName(sel.b)}${dev == null ? '' : ' · ' + K.t('arDeviation', { d: (dev > 0 ? '+' : '') + dev })}`,
      `GPS ±${K.S.me ? K.S.me.acc : '?'} m · ${p && p.mode === 'top' ? K.t('arModeTop') : K.t('arModeUp')}`
    ] };
  }
  const devClass = (d) => d == null ? '' : Math.abs(d) <= 10 ? 'ok' : Math.abs(d) <= 25 ? 'mid' : 'bad';

  function loop() {
    if (!A.open) return;
    const K = window.KK, cv = $('#arCanvas'), stage = $('#arStage');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(stage.clientWidth * dpr), H = Math.round(stage.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    if (A.scanning) scanTick(K);
    const p = pose(), list = targets(K);
    let sel = list.find(x => x.id === A.targetId);
    if (!sel && list[0]) { sel = list[0]; A.targetId = sel.id; }
    draw(cv, K, p, list, sel, false);
    const now = performance.now();
    if (now - A.lastPanel > 150) {
      A.lastPanel = now;
      const inf = info(K, p, sel);
      $('#arHint').textContent = A.scanning ? K.t('arScanHint') : !K.S.me ? K.t('noGpsForDir') : !p || p.cam == null ? K.t('arNoCompass') : p.mode === 'top' ? K.t('arTop') : K.t('arUp');
      $('#arCompassBtn').hidden = !!(p && p.cam != null);
      $('#arMeterTxt').innerHTML = A.meter.serial ? `${K.esc(K.t('meterSerial'))}: <b>${K.esc(A.meter.serial)}</b>${A.meter.order ? ' · ' + K.esc(K.t('meterOrder')) + ': ' + K.esc(A.meter.order) : ''}` : `<span class="warnTxt">${K.esc(K.t('arNeedMeter'))}</span>`;
      $('#arShutter').classList.toggle('off', !A.meter.serial);
      const pan = $('#arInfo');
      if (inf) { pan.innerHTML = `<b>${K.esc(inf.txt[0])}</b><span class="dev ${devClass(inf.dev)}">${K.esc(inf.txt[1])}</span><small>${K.esc(inf.txt[2])}</small>`; }
      else pan.innerHTML = `<b>${K.esc(K.t('arNoTargets'))}</b>`;
      $('#arTargets').innerHTML = list.slice(0, 6).map(x => `<button class="chip${x.id === A.targetId ? ' on' : ''}" data-artarget="${K.esc(x.id)}"><span class="dot" style="background:${x.tech === 'linkiq' ? '#1565c0' : '#7b1fa2'}"></span>${K.esc(x.label)} · ${K.fmtDist(x.d)}</button>`).join('');
    }
    A.raf = requestAnimationFrame(loop);
  }

  /* meter label QR: two numbers (order/type number and serial number). The 8-digit one is taken as the serial;
     both stay editable, because the label format is not documented here. */
  function parseMeterQr(text) {
    const nums = (String(text).match(/\d{5,}/g) || []);
    let serial = nums.find(n => n.length === 8) || '', order = '';
    if (!serial && nums.length) serial = nums.slice().sort((a, b) => a.length - b.length)[0];
    order = nums.find(n => n !== serial) || '';
    return { serial, order, raw: String(text).slice(0, 200) };
  }
  const scanCv = document.createElement('canvas');
  async function scanTick(K) {
    const now = performance.now(); if (now - A.lastScan < 300) return; A.lastScan = now;
    if (now > A.scanUntil) { A.scanning = false; K.toast(K.t('qrNotFound')); return; }
    const v = $('#arVideo'); if (!v.videoWidth) return;
    const k = Math.min(1, 900 / Math.max(v.videoWidth, v.videoHeight));
    scanCv.width = Math.round(v.videoWidth * k); scanCv.height = Math.round(v.videoHeight * k);
    const g = scanCv.getContext('2d', { willReadFrequently: true }); g.drawImage(v, 0, 0, scanCv.width, scanCv.height);
    let text = '';
    if ('BarcodeDetector' in window) { try { const r = await new BarcodeDetector({ formats: ['qr_code', 'data_matrix', 'code_128'] }).detect(scanCv); if (r[0]) text = r[0].rawValue; } catch {} }
    if (!text && window.jsQR) { const d = g.getImageData(0, 0, scanCv.width, scanCv.height); const r = jsQR(d.data, scanCv.width, scanCv.height); if (r) text = r.data; }
    if (!text || !A.scanning) return;
    const m = parseMeterQr(text);
    if (!m.serial) { K.toast(K.t('arQrNoNumbers')); return; }
    A.meter = m; A.scanning = false; A.lastPanel = 0;
    try { navigator.vibrate && navigator.vibrate(120); } catch {}
    showMeterForm(true);
  }
  function showMeterForm(show) {
    const f = $('#arMeterForm'); f.hidden = !show;
    if (show) { $('#arSerial').value = A.meter.serial || ''; $('#arOrder').value = A.meter.order || ''; }
  }

  async function open(targetId) {
    const K = window.KK; A.targetId = targetId || null; A.open = true;
    // iOS: compass permission must be asked inside the tap
    try { if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') await DeviceOrientationEvent.requestPermission(); } catch {}
    window.addEventListener('deviceorientationabsolute', onOri, true); window.addEventListener('deviceorientation', onOri, true);
    $('#arView').hidden = false; document.body.style.overflow = 'hidden';
    $('#arTechs').innerHTML = ['radiomesh', 'linkiq'].map(tk => `<button class="chip${A.techs.has(tk) ? ' on' : ''}" data-artech="${tk}">${tk === 'linkiq' ? '◆ LinkIQ' : '● Radio Mesh'}</button>`).join('');
    $('#arFov').value = fov(); $('#arFovVal').textContent = fov() + '°';
    if (!K.S.me) K.startGps();
    try {
      A.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      const v = $('#arVideo'); v.srcObject = A.stream; await v.play().catch(() => {});
    } catch { K.toast(K.t('arNoCam')); }
    cancelAnimationFrame(A.raf); A.raf = requestAnimationFrame(loop);
  }
  function close() {
    A.open = false; cancelAnimationFrame(A.raf);
    if (A.stream) { A.stream.getTracks().forEach(tr => tr.stop()); A.stream = null; }
    window.removeEventListener('deviceorientationabsolute', onOri, true); window.removeEventListener('deviceorientation', onOri, true);
    $('#arView').hidden = true; document.body.style.overflow = '';
  }

  /* photo = camera frame + overlay + information band */
  async function shoot() {
    const K = window.KK, v = $('#arVideo'), stage = $('#arStage');
    if (!A.meter.serial) { K.toast(K.t('arNeedMeter')); showMeterForm(true); return; }
    const p = pose(), list = targets(K), sel = list.find(x => x.id === A.targetId) || list[0];
    if (!sel) { K.toast(K.t('arNoTargets')); return; }
    const sw = stage.clientWidth, sh = stage.clientHeight, scale = Math.min(2, 1600 / Math.max(sw, sh) * 1.0) || 1;
    const W = Math.round(sw * scale), H = Math.round(sh * scale), band = Math.round(H * 0.22);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H + band;
    const g = cv.getContext('2d'); g.fillStyle = '#222'; g.fillRect(0, 0, W, H + band);
    if (v.videoWidth) {   // same "cover" crop as on screen
      const vr = v.videoWidth / v.videoHeight, sr = W / H; let sx = 0, sy = 0, cw = v.videoWidth, ch = v.videoHeight;
      if (vr > sr) { cw = ch * sr; sx = (v.videoWidth - cw) / 2; } else { ch = cw / sr; sy = (v.videoHeight - ch) / 2; }
      g.drawImage(v, sx, sy, cw, ch, 0, 0, W, H);
    }
    const ov = document.createElement('canvas'); ov.width = W; ov.height = H; draw(ov, K, p, list, sel, false); g.drawImage(ov, 0, 0);
    const inf = info(K, p, sel), u = W / 400;
    g.fillStyle = '#0b2a3c'; g.fillRect(0, H, W, band);
    const d = inf.dev; g.fillStyle = d == null ? '#cfd8dc' : Math.abs(d) <= 10 ? '#7cd992' : Math.abs(d) <= 25 ? '#f9c400' : '#ff8a80';
    g.fillRect(0, H, Math.round(8 * u), band);
    g.textAlign = 'left'; g.fillStyle = '#fff';
    const taken = new Date(), pad = (n) => String(n).padStart(2, '0');
    const stamp = `${taken.getFullYear()}-${pad(taken.getMonth() + 1)}-${pad(taken.getDate())} ${pad(taken.getHours())}:${pad(taken.getMinutes())}:${pad(taken.getSeconds())}`;
    const lines = [`${K.t('meterShort2')} ${A.meter.serial}${A.meter.order ? ' · ' + K.t('meterOrder') + ' ' + A.meter.order : ''}`,
      '→ ' + inf.txt[0], inf.txt[1], inf.txt[2] + ` · ${K.S.me ? K.S.me.lat.toFixed(5) + ', ' + K.S.me.lng.toFixed(5) : ''}`, stamp + (K.S.prefs.name ? ' · ' + K.S.prefs.name : '')];
    const fs = Math.round(band / 6.4), maxW = W - 24 * u;
    const fit = (txt, weight, size, y) => { let sz = size; do { g.font = `${weight} ${sz}px system-ui,sans-serif`; sz--; } while (g.measureText(txt).width > maxW && sz > 8); g.fillText(txt, 14 * u, y); };
    fit(lines[0], 800, fs, H + fs * 1.2);
    fit(lines[1], 700, Math.round(fs * .92), H + fs * 2.35);
    lines.slice(2).forEach((l, i) => fit(l, 600, Math.round(fs * .86), H + fs * (3.45 + i * 1.08)));
    const fileName = `${A.meter.serial}-${sel.label}_${stamp.replace(/[: ]/g, (c) => c === ' ' ? '_' : '-')}.jpg`.replace(/[^\w.\-]+/g, '_');
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.88));
    K.antennaPhotoSheet(blob, { fileName, takenAt: taken.toISOString(), meterSerial: A.meter.serial, meterOrder: A.meter.order, meterQr: A.meter.raw, targetId: sel.id, kind: sel.kind, label: sel.label, tech: sel.tech, distance: Math.round(sel.d), bearing: Math.round(sel.b), deviation: d, heading: inf.head == null ? null : Math.round(inf.head), mode: p ? p.mode : '', gps: K.S.me ? { lat: +K.S.me.lat.toFixed(6), lng: +K.S.me.lng.toFixed(6), acc: K.S.me.acc } : null });
    close();
  }

  document.addEventListener('click', (e) => {
    if (!A.open) return;
    const el = e.target.closest('[data-artarget],[data-artech],[data-aract]'); if (!el) return;
    if (el.dataset.aract === 'scanMeter') { A.scanning = true; A.scanUntil = performance.now() + 15000; showMeterForm(false); A.lastPanel = 0; return; }
    if (el.dataset.aract === 'editMeter') { A.scanning = false; showMeterForm(!(!$('#arMeterForm').hidden)); return; }
    if (el.dataset.aract === 'meterOk') { const s1 = ($('#arSerial').value || '').replace(/\s+/g, ''), o1 = ($('#arOrder').value || '').replace(/\s+/g, ''); if (!s1) { window.KK.toast(window.KK.t('arNeedMeter')); return; } A.meter = { serial: s1, order: o1, raw: A.meter.raw || '' }; showMeterForm(false); A.lastPanel = 0; return; }
    if (el.dataset.artarget) { A.targetId = el.dataset.artarget; A.lastPanel = 0; return; }
    if (el.dataset.artech) { const tk = el.dataset.artech; A.techs.has(tk) && A.techs.size > 1 ? A.techs.delete(tk) : A.techs.add(tk); el.classList.toggle('on', A.techs.has(tk)); A.lastPanel = 0; return; }
    if (el.dataset.aract === 'close') close();
    if (el.dataset.aract === 'shoot') shoot();
    if (el.dataset.aract === 'compass') { try { if (typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission(); } catch {} }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'arFov') return;
    const K = window.KK; K.S.prefs.arFov = +e.target.value; $('#arFovVal').textContent = e.target.value + '°'; Data.kvSet('prefs', K.S.prefs);
  });
  document.addEventListener('keydown', (e) => { if (A.open && e.key === 'Escape') close(); });

  window.AR = { open, close, _pose: pose, _state: A };
})();
