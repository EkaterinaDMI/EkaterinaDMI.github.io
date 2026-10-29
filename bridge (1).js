/* Мост между рабочим листом и сайтом. Выполняется внутри листа до его собственных скриптов.
   1) подменяет window.claude.use (db, assets, downloads) на хранилище сайта;
   2) синхронизирует нажатия и ввод между учителем и учеником;
   3) делает случайные числа одинаковыми у обоих, чтобы игры шли одинаково. */
(function(){
  const API = parent.__sheetAPI;
  const T = API.mode === 't';
  document.documentElement.classList.add(T ? 'tc-mode' : 'st-mode');
  window.__ATTEMPT_ID = API.attemptId;
  if (API.badgeCounts) window.__badgeCounts = API.badgeCounts;
  window.__STARTED = API.started;

  /* одинаковые случайные числа у учителя и ученика */
  let seed = API.seed >>> 0;
  Math.random = function(){ seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  /* ---------- хранилище ---------- */
  const base = API.base;
  const clean = d => JSON.parse(JSON.stringify(d));
  const write = fn => T ? fn().then(() => undefined) : Promise.resolve();
  const snap = s => ({ id: s.id, exists: s.exists, data: () => s.data() });
  const qsnap = q => { const docs = q.docs.map(snap); return { docs, size: docs.length, empty: !docs.length, docChanges: () => docs.map((d, i) => ({ type: 'added', doc: d, oldIndex: -1, newIndex: i })) }; };
  function earnedBadges(){ return [...document.querySelectorAll('#badgeList .badge.got')].map(x => { const c = x.cloneNode(true); const bi = c.querySelector('.bi'); const ic = bi ? bi.textContent : '⭐'; c.querySelectorAll('.bi,.bc').forEach(z => z.remove()); return { ic, t: c.textContent.trim() }; }); }
  function docRef(r, cname){ return {
    id: r.id,
    get: () => r.get().then(snap),
    set: d => { if (T && cname === 'attempts' && d && d.finished && API.onFinish) { try { API.onFinish(clean(d), earnedBadges()); } catch (e) {} } return write(() => r.set(clean(d))); },
    update: d => write(() => r.update(clean(d))),
    delete: () => write(() => r.delete()),
    onSnapshot: (cb, err) => { r.get().then(s => cb(snap(s)), err || (() => {})); return () => {}; }
  }; }
  function coll(c){ const ref = base.collection(c); return {
    doc: id => docRef(id ? ref.doc(id) : ref.doc(), c),
    get: () => ref.get().then(qsnap),
    where: () => coll(c), orderBy: () => coll(c), limit: () => coll(c),
    onSnapshot: (cb, err) => { ref.get().then(q => cb(qsnap(q)), err || (() => {})); return () => {}; }
  }; }
  const db = { collection: coll, doc: p => { const parts = p.split('/'); return docRef(base.collection(parts[0]).doc(parts[1])); } };

  const blobCache = {};
  window.__blobSrc = id => blobCache[id] ? Promise.resolve(blobCache[id]) :
    base.collection('blobs').doc(id).get().then(s => { const u = s.exists ? s.data().d : ''; blobCache[id] = u; return u; });
  function shrink(blob){ return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob); const im = new Image();
    im.onload = () => { let w = im.naturalWidth, h = im.naturalHeight; const k = Math.min(1, 1800 / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(im, 0, 0, w, h);
      let q = 0.85, d = cv.toDataURL('image/jpeg', q);
      while (d.length > 900000 && q > 0.3) { q -= 0.1; d = cv.toDataURL('image/jpeg', q); }
      URL.revokeObjectURL(url); d.length > 1000000 ? rej({ code: 'too_large' }) : res(d); };
    im.onerror = () => rej({ code: 'unsupported_type' }); im.src = url; }); }
  const assets = T ? {
    upload: async blob => { const d = await shrink(blob); const id = 'b' + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
      await base.collection('blobs').doc(id).set({ d, at: Date.now() }); blobCache[id] = d; return { id, url: d, sizeBytes: d.length, contentType: 'image/jpeg' }; },
    delete: async id => { await base.collection('blobs').doc(id).delete(); return { deleted: true }; },
    list: async () => ({ assets: [], usage: {} })
  } : null;
  const downloads = { save: async ({ filename, data }) => { const a = document.createElement('a'); a.href = URL.createObjectURL(data); a.download = filename || 'file'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); } };
  window.claude = { use: n => Promise.resolve(n === 'db' ? db : n === 'assets' ? assets : n === 'downloads' ? downloads : null) };

  /* ---------- синхронизация ---------- */
  const SKIP = '#dwBar,.dw-tb,#dwCanvas,.rv-tab,.rv-panel,#showErr,#errpanel,#finRep,#finErr,#hwSave,#hwCopy,#copyHw,.hwd summary,nav.chips,.ui-add,.ui-zoom,.ui-zoombtn,#stuName,textarea[id^="uicap-"],textarea[id^="uinote-"]';
  function pathOf(el){ const parts = []; while (el && el !== document.body) { const p = el.parentElement; if (!p) return null; parts.unshift(Array.prototype.indexOf.call(p.children, el)); el = p; } return el === document.body ? parts.join('.') : null; }
  function byPath(p){ if (p == null) return null; if (p === '') return document.body; let el = document.body; for (const i of String(p).split('.')) { el = el && el.children[+i]; } return el || null; }
  const send = ev => API.emit(ev);

  document.addEventListener('click', e => {
    if (!e.isTrusted) return;
    const t = e.target; if (!(t instanceof Element) || t.closest(SKIP)) return;
    const lab = t.closest('label');
    if (lab && t.tagName !== 'INPUT' && (lab.control || lab.querySelector('input'))) return; // браузер сам пришлёт клик по флажку
    const target = t.closest('button,input,label,a,summary,[role=button],.gp,.wcard,.basket,.tok,.st,.opt') || t;
    const p = pathOf(target); if (p != null) send({ k: 'click', p });
  }, true);

  const timers = new Map();
  function flushVal(el){ const tm = timers.get(el); if (tm) { clearTimeout(tm); timers.delete(el); } const p = pathOf(el); if (p != null) send({ k: 'val', p, v: el.value }); }
  document.addEventListener('input', e => {
    if (!e.isTrusted) return; const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el.type === 'checkbox' || el.closest(SKIP)) return;
    clearTimeout(timers.get(el)); timers.set(el, setTimeout(() => flushVal(el), 350));
  }, true);
  document.addEventListener('keydown', e => {
    if (!e.isTrusted) return; const el = e.target;
    if (el instanceof Element && el.closest(SKIP)) return;
    if (e.key === 'Enter' && (el instanceof HTMLInputElement)) { flushVal(el); const p = pathOf(el); if (p != null) send({ k: 'key', p, key: 'Enter' }); }
    else if (e.code === 'Space' && !/INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) send({ k: 'key', p: null, key: ' ', code: 'Space' });
  }, true);
  let dragSrc = null;
  document.addEventListener('dragstart', e => { if (e.isTrusted && e.target instanceof Element) dragSrc = pathOf(e.target.closest('.wcard') || e.target); }, true);
  document.addEventListener('drop', e => { if (!e.isTrusted) return; const b = e.target instanceof Element ? e.target.closest('.basket') : null; if (b && dragSrc != null) { send({ k: 'click', p: dragSrc }); send({ k: 'click', p: pathOf(b) }); } dragSrc = null; }, true);

  function apply(ev, replay){
    try {
      if (ev.k === 'click') { const el = byPath(ev.p); if (el) el.click(); }
      else if (ev.k === 'val') { const el = byPath(ev.p); if (el && 'value' in el) { el.value = ev.v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }
      else if (ev.k === 'key') { const el = ev.p != null ? byPath(ev.p) : document.body; if (el) el.dispatchEvent(new KeyboardEvent('keydown', { key: ev.key, code: ev.code || '', bubbles: true })); }
      else if (ev.k === 'dadd' || ev.k === 'drem' || ev.k === 'dclr') { if (window.__dwHook) window.__dwHook.apply(ev); }
      else if (ev.k === 'goto' && !replay) { const el = byPath(ev.p); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    } catch (err) { console.warn('sync', err); }
  }
  function anchor(){ for (const f of [0.3, 0.45, 0.2, 0.6]) { const el = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight * f)); const a = el && !el.closest('nav.chips,#dwBar,.progress') && el.closest('.q,.ex,.nb,.theory,.memo,.part-head,.ui-card,.hwc,section.part'); if (a) return pathOf(a); } return null; }
  window.__dwSync = { path: pathOf, byPath, emit: ev => send(ev) };
  window.__sync = {
    apply, anchor,
    section: p => { const el = byPath(p); const sec = el && el.closest('section.part'); const h = sec && sec.querySelector('h2'); return h ? h.textContent.trim() : ''; },
    scrollTo: p => { const el = byPath(p); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  };

  const css = document.createElement('style');
  css.textContent = `.st-mode .tk-x,.st-mode .rv-tab,.st-mode .rv-panel,.st-mode .ui-add,.st-mode .ui-del,.st-mode #dictShow,.st-mode #dictDone,.st-mode .dlist input,.st-mode .dlist .dmark,.st-mode .wck .inline,.st-mode .nbq .opts,.st-mode .tchk,.st-mode .ui-card .opts,.st-mode .ui-card textarea,.st-mode #finBtn,.st-mode #redo,.st-mode #saveMsg,.st-mode .hw-head p,.st-mode #hwSave,.st-mode #hwCopy,.st-mode .hwd{display:none!important}`;
  document.head.appendChild(css);
  addEventListener('load', () => setTimeout(() => API.ready(), 400));
})();
