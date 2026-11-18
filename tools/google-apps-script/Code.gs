/**
 * Koncentrator-kort – TEMPORARY shared store on Google Drive (until Azure is approved).
 *
 * Installed in the owner's Google account as a Web app. It keeps:
 *   - data.json            the concentrator list (uploaded by the office, without contact persons)
 *   - "Ændringer" sheet    every change made in the field, one row per change (append-only)
 *   - photos/              photos as small JSON files {full, thumb} (JPEG data URLs, already resized by the app)
 *
 * Access: every request carries a code. ACCESS_CODE is for installers (read + add changes/photos),
 * ADMIN_CODE is for the office (also replaces data.json). Both are random and set by setup().
 * Nothing secret is stored in GitHub: the codes live only in this script's properties.
 *
 * Install: see docs/ro/LAGER-TEMPORAR-GOOGLE.md
 */
const FOLDER_NAME = 'Koncentrator-kort (midlertidig)';
const MAX_PHOTO_CHARS = 6 * 1024 * 1024;   // one photo pair (full + thumb) as data URLs
const MAX_EVENTS_PER_PUSH = 500;

/** Run once from the editor (Run ▶ setup). Creates the folder + sheet and prints the two codes. */
function setup() {
  const P = PropertiesService.getScriptProperties();
  let folder = P.getProperty('FOLDER_ID') ? DriveApp.getFolderById(P.getProperty('FOLDER_ID')) : null;
  if (!folder) { folder = DriveApp.createFolder(FOLDER_NAME); P.setProperty('FOLDER_ID', folder.getId()); }
  if (!P.getProperty('PHOTOS_ID')) P.setProperty('PHOTOS_ID', folder.createFolder('photos').getId());
  if (!P.getProperty('SHEET_ID')) {
    const ss = SpreadsheetApp.create('Koncentrator-kort – ændringer');
    const sh = ss.getSheets()[0]; sh.setName('Ændringer');
    sh.appendRow(['eid', 'at', 'by', 'concentratorId', 'type', 'summary', 'data', 'receivedAt']);
    sh.setFrozenRows(1);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    P.setProperty('SHEET_ID', ss.getId());
  }
  if (!P.getProperty('ACCESS_CODE')) P.setProperty('ACCESS_CODE', randomCode_());
  if (!P.getProperty('ADMIN_CODE')) P.setProperty('ADMIN_CODE', randomCode_());
  Logger.log('Mappe: ' + folder.getUrl());
  Logger.log('Kode for montører (ACCESS_CODE): ' + P.getProperty('ACCESS_CODE'));
  Logger.log('Kode for kontoret (ADMIN_CODE): ' + P.getProperty('ADMIN_CODE'));
}

/** Run to give everybody a new code (e.g. if a link was shared by mistake). Old links stop working. */
function rotateCodes() {
  const P = PropertiesService.getScriptProperties();
  P.setProperty('ACCESS_CODE', randomCode_()); P.setProperty('ADMIN_CODE', randomCode_());
  Logger.log('Ny montør-kode: ' + P.getProperty('ACCESS_CODE'));
  Logger.log('Ny kontor-kode: ' + P.getProperty('ADMIN_CODE'));
}

function randomCode_() {
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now() + Math.random());
  return Utilities.base64EncodeWebSafe(b).replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
}

function doGet() { return out_({ ok: true, service: 'koncentrator-kort', hint: 'POST only' }); }

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return out_({ ok: false, error: 'bad_json' }); }
  const P = PropertiesService.getScriptProperties();
  const access = P.getProperty('ACCESS_CODE'), admin = P.getProperty('ADMIN_CODE');
  if (!access || !admin) return out_({ ok: false, error: 'not_configured' });
  const isAdmin = req.code === admin;
  if (!isAdmin && req.code !== access) { Utilities.sleep(800); return out_({ ok: false, error: 'unauthorized' }); }
  try {
    switch (req.action) {
      case 'ping': return out_({ ok: true, admin: isAdmin });
      case 'manifest': return out_({ ok: true, datasetVersion: P.getProperty('DATASET_VERSION') || '', events: Math.max(0, sheet_().getLastRow() - 1), admin: isAdmin });
      case 'getDataset': {
        const f = fileByName_(folder_(), 'data.json');
        return out_({ ok: true, version: P.getProperty('DATASET_VERSION') || '', dataset: f ? JSON.parse(f.getBlob().getDataAsString('UTF-8')) : null });
      }
      case 'putDataset': {
        if (!isAdmin) return out_({ ok: false, error: 'admin_only' });
        const ds = req.dataset;
        if (!ds || !Array.isArray(ds.concentrators)) return out_({ ok: false, error: 'bad_dataset' });
        ds.concentrators.forEach(function (c) { delete c.accessRestricted; });   // no contact persons on Drive
        const text = JSON.stringify(ds);
        const f = fileByName_(folder_(), 'data.json');
        if (f) f.setContent(text); else folder_().createFile('data.json', text, 'application/json');
        const v = new Date().toISOString(); P.setProperty('DATASET_VERSION', v);
        return out_({ ok: true, version: v });
      }
      case 'getEvents': {
        const since = Math.max(0, parseInt(req.since, 10) || 0);
        const sh = sheet_(), last = sh.getLastRow();
        if (last - 1 <= since) return out_({ ok: true, events: [], total: Math.max(0, last - 1) });
        const n = Math.min(last - 1 - since, 2000);
        const rows = sh.getRange(2 + since, 1, n, 8).getValues();
        const events = rows.map(function (r) { let d = {}; try { d = JSON.parse(r[6]); } catch (x) {}
          return { eid: String(r[0]), at: toIso_(r[1]), by: String(r[2]), cid: String(r[3]), type: String(r[4]), data: d }; });
        return out_({ ok: true, events: events, total: since + n, more: since + n < last - 1 });
      }
      case 'pushEvents': {
        const list = Array.isArray(req.events) ? req.events.slice(0, MAX_EVENTS_PER_PUSH) : [];
        const lock = LockService.getScriptLock(); lock.waitLock(20000);
        try {
          const sh = sheet_(), last = sh.getLastRow();
          const known = {};
          if (last > 1) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { known[String(r[0])] = 1; });
          const now = new Date().toISOString(), rows = [];
          list.forEach(function (ev) {
            if (!ev || !ev.eid || known[ev.eid]) return;
            if (!/^(verify|placement|note|photo|report)$/.test(String(ev.type))) return;
            const data = JSON.stringify(ev.data || {}); if (data.length > 20000) return;
            rows.push([String(ev.eid).slice(0, 80), String(ev.at || now).slice(0, 40), String(ev.by || '').slice(0, 80), String(ev.cid || '').slice(0, 40),
              String(ev.type), String((ev.data && ev.data.summary) || (ev.data && ev.data.text) || '').slice(0, 300), data, now]);
            known[ev.eid] = 1;
          });
          if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
          return out_({ ok: true, added: rows.length, total: sh.getLastRow() - 1 });
        } finally { lock.releaseLock(); }
      }
      case 'putPhoto': {
        const key = safeKey_(req.key);
        if (!key || typeof req.full !== 'string' || typeof req.thumb !== 'string') return out_({ ok: false, error: 'bad_photo' });
        if (!/^data:image\/(jpeg|png|webp);base64,/.test(req.full) || !/^data:image\/(jpeg|png|webp);base64,/.test(req.thumb)) return out_({ ok: false, error: 'bad_photo' });
        if (req.full.length + req.thumb.length > MAX_PHOTO_CHARS) return out_({ ok: false, error: 'too_large' });
        if (key.indexOf('base__') === 0 && !isAdmin) return out_({ ok: false, error: 'admin_only' });
        const folder = photos_();
        if (fileByName_(folder, key + '.json')) return out_({ ok: true, existed: true });
        folder.createFile(key + '.json', JSON.stringify({ full: req.full, thumb: req.thumb }), 'application/json');
        return out_({ ok: true });
      }
      case 'getPhoto': {
        const key = safeKey_(req.key); const f = key && fileByName_(photos_(), key + '.json');
        if (!f) return out_({ ok: false, error: 'not_found' });
        return out_(Object.assign({ ok: true }, JSON.parse(f.getBlob().getDataAsString('UTF-8'))));
      }
      default: return out_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err).slice(0, 200) });
  }
}

function folder_() { return DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('FOLDER_ID')); }
function photos_() { return DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('PHOTOS_ID')); }
function sheet_() { return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getSheetByName('Ændringer'); }
function fileByName_(folder, name) { const it = folder.getFilesByName(name); return it.hasNext() ? it.next() : null; }
function safeKey_(k) { k = String(k || ''); return /^[A-Za-z0-9_.\-]{1,160}$/.test(k) ? k : ''; }
function toIso_(v) { return v instanceof Date ? v.toISOString() : String(v); }
function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
