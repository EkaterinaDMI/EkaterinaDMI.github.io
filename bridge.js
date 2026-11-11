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
  /* объекты создаём в окне сайта: Firestore не принимает объекты, созданные внутри листа (другое окно) */
  const clean = d => parent.JSON.parse(JSON.stringify(d));
  const write = fn => T ? fn().then(() => undefined) : Promise.resolve();
  const snap = s => ({ id: s.id, exists: s.exists, data: () => s.data() });
  const qsnap = q => { const docs = q.docs.map(snap); return { docs, size: docs.length, empty: !docs.length, docChanges: () => docs.map((d, i) => ({ type: 'added', doc: d, oldIndex: -1, newIndex: i })) }; };
  function earnedBadges(){ return [...document.querySelectorAll('#badgeList .badge.got')].map(x => { const c = x.cloneNode(true); const bi = c.querySelector('.bi'); const ic = bi ? bi.textContent : '⭐'; c.querySelectorAll('.bi,.bc').forEach(z => z.remove()); return { ic, t: c.textContent.trim() }; }); }
  function docRef(r, cname){ return {
    id: r.id,
    get: () => r.get().then(snap),
    set: d => { if (T && cname === 'attempts' && d && d.finished) { if (API.onFinish) { try { API.onFinish(clean(d), earnedBadges()); } catch (e) {} } base.collection('presence').doc('lesson').set(clean({ finished: true, at: Date.now(), hidden: window.hiddenTasks || [] })).catch(() => {}); } return write(() => r.set(clean(d))); },
    update: d => write(() => r.update(clean(d))),
    delete: () => write(() => r.delete()),
    onSnapshot: (cb, err) => { r.get().then(s => cb(snap(s)), err || (() => {})); return () => {}; }
  }; }
  function coll(c){ const ref = base.collection(c); return {
    doc: id => docRef(id ? ref.doc(id) : ref.doc(), c),
    get: () => ref.get().then(qsnap),
    where: () => coll(c), orderBy: () => coll(c), limit: () => coll(c),
    onSnapshot: (cb, err) => { ref.get().then(q => cb(qsnap(q)), err || (() => {})); return () => {}; },
    watch: (cb, err) => ref.onSnapshot(q => cb(qsnap(q)), err || (() => {}))
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
  function imgErr(e, blob){ const c = (e && (e.code || e.name)) || ''; const m = (e && e.message) || String(e);
    const why = /permission/i.test(c + m) ? 'Нет прав на запись: открой урок кнопкой «Начать урок» в «Мои ученики», войдя под своей почтой.'
      : c === 'unsupported_type' ? 'Браузер не смог открыть этот файл (часто это формат HEIC с iPhone). Сделай скриншот картинки и вставь его.'
      : /quota|exhausted/i.test(c + m) ? 'Закончился бесплатный лимит базы на сегодня.' : 'Причина: ' + m;
    console.error('upload', e); let bx = document.getElementById('imgErrBox');
    if (!bx) { bx = document.createElement('div'); bx.id = 'imgErrBox'; bx.style.cssText = 'position:fixed;left:12px;right:12px;bottom:70px;z-index:99;background:#fff3f0;border:2px solid #d9534f;border-radius:12px;padding:10px 14px;font:14px/1.4 sans-serif;color:#333'; document.body.appendChild(bx); bx.onclick = () => bx.remove(); }
    bx.textContent = 'Картинка не загрузилась. ' + why + ' [' + (c || '—') + '; ' + (blob && blob.type || 'тип ?') + '; ' + Math.round((blob && blob.size || 0) / 1024) + ' КБ] Нажми, чтобы закрыть.'; }
  const assets = T ? {
    upload: async blob => { try { const d = await shrink(blob); const id = 'b' + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
      await base.collection('blobs').doc(id).set(clean({ d, at: Date.now() })); blobCache[id] = d; return { id, url: d, sizeBytes: d.length, contentType: 'image/jpeg' }; }
      catch (e) { imgErr(e, blob); throw e; } },
    delete: async id => { await base.collection('blobs').doc(id).delete(); return { deleted: true }; },
    list: async () => ({ assets: [], usage: {} })
  } : null;
  const downloads = { save: async ({ filename, data }) => { const a = document.createElement('a'); a.href = URL.createObjectURL(data); a.download = filename || 'file'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); } };
  window.claude = { use: n => Promise.resolve(n === 'db' ? db : n === 'assets' ? assets : n === 'downloads' ? downloads : null) };

  /* ---------- синхронизация ---------- */
  /* «Показать слова» и «Показать ответы» учитель открывает только у себя */
  const SKIP = '.wb,.wb-btn,.wb-tip,[contenteditable=true],[contenteditable=true] *,.txed-ui,.phq,.tph,.tph-toast,.gate-btn,.vtabs,.hwleft,.hwph,#dictShow,.wck > .qn + .inline .btn.ghost,#dwBar,.dw-tb,#dwCanvas,.rv-tab,.rv-panel,#showErr,#errpanel,#finRep,#finErr,#hwSave,#hwCopy,#copyHw,.hwd summary,nav.chips,.ui-add,.ui-zoom,.ui-zoombtn,#stuName,textarea[id^="uicap-"],textarea[id^="uinote-"]';
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
      if (ev.k === 'click') { const el = byPath(ev.p); if (el) { el.click();
          /* после проверки ученик видит слова со своими отметками */
          if (!T) { if (el.id === 'dictDone') { const d = document.getElementById('ex-dict'); if (d) d.classList.remove('dict-hidden'); }
            const w = el.closest && el.closest('.wck'); if (w && el.matches('.btn:not(.ghost)')) { const l = w.querySelector('.dlist'); if (l) l.classList.remove('dict-hidden'); }
            const nx = el.closest && el.closest('.nb'); if (nx && el.matches('.wck .btn:not(.ghost), .nbq .opt')) nx.querySelectorAll('.dict-veil').forEach(x => x.classList.remove('dict-veil')); } } }
      else if (ev.k === 'val') { const el = byPath(ev.p); if (el && 'value' in el) { el.value = ev.v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }
      else if (ev.k === 'key') { const el = ev.p != null ? byPath(ev.p) : document.body; if (el) el.dispatchEvent(new KeyboardEvent('keydown', { key: ev.key, code: ev.code || '', bubbles: true })); }
      else if (ev.k === 'wb') { if (window.__wb) window.__wb.apply(ev, replay); }
      else if (ev.k === 'dadd' || ev.k === 'drem' || ev.k === 'dclr') { if (window.__dwHook) window.__dwHook.apply(unpackDraw(ev)); }
      else if (ev.k === 'open') { const el = byPath(ev.p); if (el) { el.classList.toggle('st-open', !!ev.v); gateUpdate(); if (!T && !replay && ev.v) setTimeout(() => { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); flashCall(el); }, 80); } }
      else if (ev.k === 'txed') { if (window.__txed) window.__txed.put(ev.key, ev.html); }
      else if (ev.k === 'goto' && !replay) { const el = byPath(ev.p); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (!T) flashCall(el); } }
    } catch (err) { console.warn('sync', err); }
  }
  /* где находится человек: задание в середине экрана (сначала мелкие блоки, потом крупные) */
  const TGT = '.q,.nb,.wck,.theory,.memo,.part-head,.ui-card,.hwc';
  function anchor(){ for (const f of [0.42, 0.3, 0.55, 0.2, 0.68]) { for (const fx of [0.5, 0.35, 0.65]) { const el = document.elementFromPoint(Math.round(innerWidth * fx), Math.round(innerHeight * f)); if (!el || el.closest('nav.chips,#dwBar,.progress,.call-btn')) continue; const a = el.closest(TGT) || el.closest('.ex,section.part'); if (a) return pathOf(a); } } return null; }
  /* последнее задание, в котором ученик что-то делал */
  let act = null, actAt = 0;
  const markAct = e => { const t = e.target; if (!(t instanceof Element)) return; const q = t.closest('.q,.nb,.wck,.ui-card'); if (!q || t.closest('nav.chips,#dwBar,.progress')) return; const p = pathOf(q); if (p == null) return; act = p; actAt = Date.now(); if (window.__onAct) window.__onAct(); };
  document.addEventListener('pointerdown', markAct, true); document.addEventListener('focusin', markAct, true);
  /* подсветка: «ученик здесь» у учителя, «учитель зовёт сюда» у ученика */
  const st = document.createElement('style'); st.textContent = '.peer-here{position:relative;outline:3px solid #ff6a00!important;outline-offset:4px;border-radius:12px}.peer-here::before{content:attr(data-peer);position:absolute;top:-13px;right:10px;z-index:6;background:#ff6a00;color:#fff;font:700 12px/1.6 system-ui,sans-serif;padding:1px 10px;border-radius:999px;white-space:nowrap;pointer-events:none}.call-here{position:relative;animation:callPulse 1s ease-in-out 4;outline:4px solid #2f80ed!important;outline-offset:4px;border-radius:12px}.call-here::after{content:"Учитель зовёт сюда";position:absolute;top:-14px;left:10px;z-index:6;background:#2f80ed;color:#fff;font:700 13px/1.6 system-ui,sans-serif;padding:2px 12px;border-radius:999px;pointer-events:none}@keyframes callPulse{50%{outline-color:#9cc3ff}}.call-btn{position:fixed;z-index:80;display:none;width:36px;height:36px;font:600 17px/36px system-ui,sans-serif;text-align:center;border:none;border-radius:50%;padding:0;background:#2f80ed;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer}.call-btn.sent{background:#1f9d55}.call-pick{outline:2px dashed #2f80ed!important;outline-offset:4px;border-radius:12px}';
  document.documentElement.appendChild(st);
  let callT = null;
  function flashCall(el){ document.querySelectorAll('.call-here').forEach(x => x.classList.remove('call-here')); el.classList.add('call-here'); clearTimeout(callT); callT = setTimeout(() => el.classList.remove('call-here'), 6000); }
  let peerEl = null;
  function markPeer(p, label){ if (peerEl) { peerEl.classList.remove('peer-here'); peerEl.removeAttribute('data-peer'); peerEl = null; } const el = p != null ? byPath(p) : null; if (el) { peerEl = el; el.classList.add('peer-here'); el.setAttribute('data-peer', label || 'Ученик здесь'); } }
  function describe(p){ const el = byPath(p); if (!el) return ''; const sec = el.closest('section.part'); const h = sec && sec.querySelector('h2'); let s = h ? h.textContent.trim() : ''; if (sec) { const qs = Array.prototype.filter.call(sec.querySelectorAll('.q,.nb'), x => !x.closest('.tk-hidden')); const q = el.closest('.q,.nb'); const i = q ? qs.indexOf(q) : -1; if (i >= 0 && qs.length > 1) s += ' · задание ' + (i + 1) + ' из ' + qs.length; } return s; }
  /* Пошаговый урок: ученик видит только те шаги, которые открыл учитель */
  const gst = document.createElement('style'); gst.textContent = '.gate-btn{order:-1;justify-self:start;font:700 14px/1 system-ui,sans-serif;border:2px solid #1f9d55;color:#1f9d55;background:#fff;border-radius:999px;padding:9px 16px;cursor:pointer}.st-open>.gate-btn{background:#1f9d55;color:#fff}.st-mode .gate-btn{display:none!important}.tc-mode section.part.st-open{box-shadow:-10px 0 0 -4px #1f9d55}html.st-mode:not(.hw-mode) section.part:not(.st-open):not(#errpanel){display:none!important}.gate-wait{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);z-index:30;display:none;max-width:min(420px,90vw);text-align:center;background:#fff;color:#222;border-radius:20px;padding:26px 24px;box-shadow:0 10px 40px rgba(0,0,0,.18);font:600 18px/1.4 system-ui,sans-serif}.gate-wait span{display:block;font-size:44px;margin-bottom:8px}.st-mode .wck,.st-mode .nbmark,.st-mode #ex-dict,.st-mode #dictHint,.st-mode #dictRes,.st-mode .dict-veil,.st-mode .t-st-hide{display:none!important}.tc-mode .ptxt>.drill-word{filter:none!important}.tc-mode .dlist.dict-hidden .drill-word{filter:none!important;user-select:auto!important}.tc-mode .wck>.qn+.inline,.tc-mode #dictShow,.tc-mode #dictHint{display:none!important}.tc-mode .wck,.tc-mode .nbmark,.tc-mode #ex-dict{outline:2px dashed #7A4E9C;outline-offset:6px;border-radius:12px}.tc-mode .wck::before,.tc-mode .nbmark::before,.tc-mode #ex-dict::before,.tc-mode .qn.t-st-hide::after{content:"👁 Видите только вы";display:inline-block;font:700 .72rem/1 system-ui,sans-serif;letter-spacing:.03em;background:#7A4E9C;color:#fff;padding:5px 10px;border-radius:999px;margin-bottom:6px}.tc-mode #ex-dict::before{grid-column:1/-1;justify-self:start}.tc-mode .qn.t-st-hide::after{margin:0 0 0 8px;vertical-align:middle}';
  document.documentElement.appendChild(gst);
  const gw = document.createElement('div'); gw.className = 'gate-wait'; gw.innerHTML = '<span>⏳</span>Сейчас учитель откроет задание';
  function gateUpdate(){ if (T) { document.querySelectorAll('.gate-btn').forEach(b => { b.textContent = b.parentElement.classList.contains('st-open') ? '✓ Открыто ученику · скрыть' : '▶ Открыть ученику'; }); return; }
    const hw = document.documentElement.classList.contains('hw-mode');
    document.querySelectorAll('nav.chips a[href^="#"]').forEach(a => { let s = null; try { s = document.querySelector(a.getAttribute('href')); } catch (e) {} if (s && s.matches('section.part')) a.style.display = (hw || s.classList.contains('st-open')) ? '' : 'none'; });
    if (!gw.isConnected) document.documentElement.appendChild(gw);
    gw.style.display = (!hw && !document.querySelector('section.part.st-open')) ? 'block' : 'none'; }
  window.__gateUpdate = gateUpdate;
  const setOpen = (sec, v) => { const p = pathOf(sec); if (p == null) return; const ev = { k: 'open', p, v: !!v }; apply(ev, true); send(ev); };
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('section.part').forEach(sec => { if (sec.id === 'errpanel') return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'gate-btn'; b.textContent = '▶ Открыть ученику';
      b.addEventListener('click', e => { e.stopPropagation(); if (T) setOpen(sec, !sec.classList.contains('st-open')); });
      sec.appendChild(b); });
    gateUpdate();
    document.querySelectorAll('.qn').forEach(q => { if (!/^Проверка учителя/.test(q.textContent.trim()) || q.closest('.wck,.nbmark')) return; q.classList.add('t-st-hide'); const n = q.nextElementSibling; if (n && n.classList.contains('opts')) n.classList.add('t-st-hide'); });
  });
  new MutationObserver(gateUpdate).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  /* учитель: кнопка «Позвать сюда» у задания под мышкой */
  if (T) addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'call-btn'; b.textContent = '📍'; b.title = 'Позвать ученика сюда'; document.documentElement.appendChild(b);
    let cur = null, hideT = null;
    const place = el => { const r = el.getBoundingClientRect(); const sec = el.closest('section.part') || el; const c = sec.getBoundingClientRect(); b.style.display = 'block'; const w = b.offsetWidth || 36;
      let left, top = Math.max(4, r.top + 4);
      if (c.left >= w + 14) left = c.left - w - 10; else if (innerWidth - c.right >= w + 14) left = c.right + 10; else { left = Math.max(4, r.left); top = Math.max(4, r.top - w - 6); }
      b.style.top = top + 'px'; b.style.left = left + 'px'; };
    document.addEventListener('mousemove', e => { if (e.target === b) return; const t = e.target instanceof Element ? e.target.closest('.q,.nb,.wck,.ui-card,.part-head') : null;
      if (t && !t.closest('#dwBar,.progress,nav.chips,.tk-hidden')) { clearTimeout(hideT); if (cur !== t) { if (cur) cur.classList.remove('call-pick'); cur = t; b.classList.remove('sent'); b.textContent = '📍'; } place(t); }
      else { clearTimeout(hideT); hideT = setTimeout(() => { b.style.display = 'none'; if (cur) cur.classList.remove('call-pick'); cur = null; }, 700); } }, { passive: true });
    b.addEventListener('mouseenter', () => { clearTimeout(hideT); if (cur) cur.classList.add('call-pick'); });
    b.addEventListener('mouseleave', () => { if (cur) cur.classList.remove('call-pick'); });
    b.addEventListener('click', e => { e.stopPropagation(); if (!cur) return; const p = pathOf(cur); if (p == null) return; send({ k: 'goto', p }); b.classList.add('sent'); b.textContent = '✓'; });
    addEventListener('scroll', () => { if (cur && b.style.display === 'block') place(cur); }, { passive: true });
  });
  /* линии рисунка: база не хранит массив внутри массива, поэтому точки уходят строкой */
  const packDraw = ev => { if (ev && ev.k === 'dadd' && ev.s && Array.isArray(ev.s.pts)) { const st = Object.assign({}, ev.s); st.pj = JSON.stringify(st.pts.map(q => [Math.round(q[0] * 1e4) / 1e4, Math.round(q[1] * 1e4) / 1e4])); delete st.pts; return { k: 'dadd', s: st }; } return ev; };
  const unpackDraw = ev => { if (ev && ev.k === 'dadd' && ev.s && ev.s.pj && !ev.s.pts) { const st = Object.assign({}, ev.s); try { st.pts = JSON.parse(st.pj); } catch (e) { st.pts = []; } return { k: 'dadd', s: st }; } return ev; };
  window.__dwSync = { path: pathOf, byPath, emit: ev => send(packDraw(ev)) };
  window.__sync = {
    apply, anchor, describe, markPeer,
    openAll: v => document.querySelectorAll('section.part').forEach(sec => { if (sec.id !== 'errpanel' && sec.id !== 'hw') setOpen(sec, v); }),
    active: () => (act != null && Date.now() - actAt < 120000) ? act : null,
    section: p => { const el = byPath(p); const sec = el && el.closest('section.part'); const h = sec && sec.querySelector('h2'); return h ? h.textContent.trim() : ''; },
    scrollTo: p => { const el = byPath(p); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  };

  /* В окне «Урок закончен»: вместо отчёта для мамы — отчёт для Claude (учитель) */
  addEventListener('load', () => { const btn = document.getElementById('finRep'); if (!btn) return;
    if (!T) { btn.style.display = 'none'; return; }
    btn.textContent = 'Отчёт для Claude';
    btn.addEventListener('click', async e => { e.preventDefault(); e.stopImmediatePropagation();
      const ta = document.getElementById('repText'), msg = document.getElementById('repMsg');
      if (msg) msg.textContent = 'Собираю отчёт…';
      const lab = t => { if (t.matches('section.part')) { const h = t.querySelector('h2'); return 'раздел «' + (h ? h.textContent.trim() : '') + '»'; } const g = t.querySelector('.ex-head .tag,.nb-l'); return g ? g.textContent.trim() : 'задание'; };
      const toHw = [...document.querySelectorAll('.to-hw')].filter(t => !t.parentElement.closest('.to-hw')).map(lab);
      const unsolved = [...document.querySelectorAll('section.part:not(#hw):not(#errpanel)')].filter(sc => !sc.classList.contains('tk-hidden') && !sc.classList.contains('to-hw') && sc.querySelector('.q') && !sc.querySelector('.q.is-ok,.q.is-bad')).map(sc => { const h = sc.querySelector('h2'); return h ? h.textContent.trim() : sc.id; });
      try { await new Promise(r => setTimeout(r, 1800)); const t = await API.claudeReport({ toHw, unsolved });
        if (ta) { ta.value = t; ta.hidden = false; ta.focus(); ta.select(); }
        try { await navigator.clipboard.writeText(t); if (msg) msg.textContent = 'Отчёт скопирован. Вставь его в чат с Claude.'; }
        catch (_) { if (msg) msg.textContent = 'Текст выделен: нажми «Копировать» и вставь его в чат с Claude.'; } }
      catch (err) { if (msg) msg.textContent = 'Не получилось собрать отчёт: ' + ((err && err.message) || err); } }, true); });
  /* Кнопка «В ДЗ» у каждого задания и раздела (добавляется у обоих, чтобы пути совпадали) */
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tk-x').forEach(x => { const host = x.parentElement; if (!host || host.closest('#hw') || host.querySelector(':scope > .hw-x')) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'hw-x'; b.textContent = '→ ДЗ'; b.title = 'Отправить в домашнее задание';
      b.addEventListener('click', () => { const on = host.classList.toggle('to-hw'); b.textContent = on ? '✓ В ДЗ' : '→ ДЗ'; b.title = on ? 'Вернуть на урок' : 'Отправить в домашнее задание'; document.dispatchEvent(new Event('hwchange')); });
      host.appendChild(b); }); });
  /* тексты диктантов ученик не видит, пока учитель не проверит (класс меняем, узлы не добавляем: пути синхронизации не сдвигаются) */
  document.addEventListener('DOMContentLoaded', () => { if (T) return;
    document.querySelectorAll('.nb').forEach(nb => { const lab = (nb.querySelector('.nb-l') || {}).textContent || '';
      if (/диктант/i.test(lab) || /Учитель диктует/.test(nb.textContent)) nb.querySelectorAll('.nb-s').forEach(x => x.classList.add('dict-veil')); }); });
  /* Задания с кнопкой «В ДЗ» после «Урок закончен» открываются у ученика как домашка */
  addEventListener('load', () => {
    const hw = document.getElementById('hw'); if (!hw || hw.querySelector('.hwleft')) return;
    const box = document.createElement('div'); box.className = 'hwleft'; box.hidden = true;
    box.innerHTML = '<b>' + (T ? 'Уйдут в домашку' : 'Доделай на экране') + '</b><span class="hwleft-sub">' + (T ? 'Задания с отметкой «В ДЗ». После «Урок закончен» они откроются у ученика.' : 'Эти задания учитель отправил в домашку. Нажми на название, чтобы перейти к заданию.') + '</span><div class="hwleft-list"></div>';
    hw.insertBefore(box, hw.querySelector('.hwph') || null);
    const list = box.querySelector('.hwleft-list');
    let finished = false;
    const label = t => { if (t.matches('section.part')) { const h = t.querySelector('h2'); return 'Раздел: ' + (h ? h.textContent.trim() : ''); } const g = t.querySelector('.ex-head .tag,.nb-l'); return g ? g.textContent.trim() : 'Задание'; };
    function paint(){
      const items = [...document.querySelectorAll('.to-hw')].filter(t => !t.closest('#hw'));
      const top = items.filter(t => !items.some(o => o !== t && o.contains(t)));
      list.innerHTML = ''; top.forEach(t => { const b = document.createElement('button'); b.type = 'button'; b.className = 'hwleft-it'; b.textContent = label(t); b.onclick = () => t.scrollIntoView({ behavior: 'smooth', block: 'start' }); list.appendChild(b); });
      box.hidden = !top.length || (!T && !finished);
    }
    /* вкладки «Урок» и «Домашнее задание» */
    const tabs = document.createElement('div'); tabs.className = 'vtabs'; tabs.hidden = true;
    tabs.innerHTML = '<button type="button" data-v="lesson">Урок</button><button type="button" data-v="hw">Домашнее задание</button>';
    document.body.appendChild(tabs);
    let view = 'lesson';
    function setView(v){ view = v; document.documentElement.classList.toggle('view-hw', v === 'hw');
      tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
      scrollTo({ top: 0 }); setTimeout(() => dispatchEvent(new Event('resize')), 60); }
    tabs.querySelectorAll('button').forEach(b => b.onclick = () => setView(b.dataset.v));
    let autoDone = false;
    function mode(){ document.documentElement.classList.toggle('hw-mode', finished); paint();
      tabs.hidden = !(finished || T);
      if (finished && !T && !autoDone) { autoDone = true; setView('hw'); } }
    base.collection('presence').doc('lesson').onSnapshot(d => { finished = !!(d.exists && d.data().finished); mode(); }, () => {});
    document.addEventListener('hwchange', () => setTimeout(paint, 50));
    setTimeout(paint, 1500);
  });

  /* ---------- «Снять телефоном»: QR-код, фото с телефона сразу попадает в лист ---------- */
  let qrLib = null;
  const loadQR = site => qrLib || (qrLib = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = site + 'qr.js'; sc.onload = () => window.QRMake ? res(window.QRMake) : rej(); sc.onerror = () => { qrLib = null; rej(); }; document.documentElement.appendChild(sc); }));
  function phoneQR(key, label){
    const sid = API.sheetId; if (!sid) return;
    let site = ''; try { site = parent.location.origin + parent.location.pathname.replace(/[^/]*$/, ''); } catch (e) { site = 'https://ekaterinadmi.github.io/'; }
    const url = site + 'photo.html?s=' + encodeURIComponent(sid) + (key ? '&k=' + encodeURIComponent(key) + '&l=' + encodeURIComponent(label || '') : '');
    const o = document.createElement('div'); o.className = 'phq';
    o.innerHTML = '<div class="phq-c" role="dialog" aria-label="Снять телефоном"><button type="button" class="phq-x" aria-label="Закрыть">✕</button><b class="phq-t">📱 Снять телефоном</b>' +
      '<ol><li>Открой камеру на телефоне.</li><li>Наведи её на этот код и нажми на появившуюся ссылку.</li><li>Нажми «Сфотографировать». Фото само появится здесь.</li></ol>' +
      '<div class="phq-code"><span>Загружаю код…</span></div><div class="phq-st" role="status" aria-live="polite"></div>' +
      '<details class="phq-l"><summary>Код не читается?</summary><p>Открой на телефоне эту ссылку:</p><input readonly></details></div>';
    o.querySelector('input').value = url;
    document.documentElement.appendChild(o);
    const close = () => { o.remove(); if (unsub) unsub(); };
    o.querySelector('.phq-x').onclick = close; o.addEventListener('click', e => { if (e.target === o) close(); });
    loadQR(site).then(make => { o.querySelector('.phq-code').innerHTML = make(url, 220); })
      .catch(() => { o.querySelector('.phq-code').innerHTML = '<span>Код не загрузился. Открой ссылку ниже на телефоне.</span>'; o.querySelector('.phq-l').open = true; });
    const t0 = Date.now(); let got = 0; let unsub = null;
    try { unsub = base.collection('hwphotos').where('at', '>', t0 - 1000).onSnapshot(q => { const n = q.docs.filter(d => (d.data().task || '') === key).length;
      if (n > got) { got = n; o.querySelector('.phq-st').innerHTML = '✅ Фото пришло: ' + n + '. Можно снять ещё или <button type="button" class="phq-ok">закрыть</button>'; o.querySelector('.phq-ok').onclick = close; } }, () => {}); } catch (e) {}
  }
  /* Фото домашней работы: ученик прикрепляет, учитель видит сразу */
  addEventListener('load', () => {
    const hw = document.getElementById('hw'); if (!hw || hw.querySelector('.hwph')) return;
    const box = document.createElement('div'); box.className = 'hwph';
    box.innerHTML = '<div class="hwph-h"><b>Фото домашней работы</b><span>' + (T ? 'Здесь появятся фото, которые пришлёт ученик.' : 'Сделай фото тетради и прикрепи сюда. Учитель увидит его сразу.') + '</span></div>' +
      (T ? '' : '<div class="hwph-row"><button type="button" class="hwph-add">📷 Прикрепить фото</button><button type="button" class="ph-qr">📱 Снять телефоном</button><input type="file" accept="image/*" multiple hidden><span class="hwph-msg"></span></div>') + '<div class="hwph-list"></div>' + '<div class="hwdone">' + (T ? '' : '<button type="button" class="hwdone-btn">✅ Я выполнил(а) домашнее задание</button>') + '<span class="hwdone-st"></span></div>';
    hw.appendChild(box);
    const list = box.querySelector('.hwph-list'), msg = t => { const m = box.querySelector('.hwph-msg'); if (m) m.textContent = t; };
    const ref = base.collection('hwphotos');
    const dref = base.collection('presence').doc('hw'), st = box.querySelector('.hwdone-st');
    const when = t => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    dref.onSnapshot(d => { const v = d.exists ? d.data() : null;
      st.textContent = v && v.done ? (T ? 'Ученик отметил: домашнее задание выполнено, ' + when(v.at) + '.' : 'Отправлено учителю: ' + when(v.at) + '. Молодец!') : (T ? 'Ученик ещё не отметил, что сделал ДЗ.' : '');
      const b = box.querySelector('.hwdone-btn'); if (b) b.textContent = v && v.done ? '✅ Отметить ещё раз' : '✅ Я выполнил(а) домашнее задание'; }, () => {});
    const db_ = box.querySelector('.hwdone-btn');
    if (db_) db_.onclick = async () => { db_.disabled = true;
      try { await dref.set(clean({ done: true, at: Date.now(), photos: list.querySelectorAll('.hwph-card').length })); }
      catch (e) { st.textContent = 'Не получилось отправить: ' + ((e && e.message) || e); }
      db_.disabled = false; };
    if (!T) { const inp = box.querySelector('input'); box.querySelector('.hwph-add').onclick = () => inp.click();
      box.querySelector('.ph-qr').onclick = () => phoneQR('', 'Домашняя работа');
      inp.onchange = async () => { const fs = [...inp.files]; inp.value = ''; let ok = 0;
        for (const f of fs) { msg('Загружаю ' + (ok + 1) + ' из ' + fs.length + '…');
          try { const d = await shrink(f); await ref.add(clean({ d, at: Date.now(), name: f.name || '' })); ok++; }
          catch (e) { msg(e && e.code === 'unsupported_type' ? 'Этот формат не открывается. Сделай скриншот фото и прикрепи его.' : 'Не получилось загрузить: ' + ((e && e.message) || e)); return; } }
        msg(ok ? 'Готово! Фото отправлено: ' + ok + '.' : ''); }; }
    const zoom = d => { const o = document.createElement('div'); o.className = 'hwph-zoom'; o.innerHTML = '<img alt="Фото домашней работы">'; o.firstChild.src = d; o.onclick = () => o.remove(); document.body.appendChild(o); };
    ref.onSnapshot(q => { list.innerHTML = '';
      const hwDocs = q.docs.map(x => ({ id: x.id, v: x.data() })).filter(x => !x.v.task);
      hwDocs.sort((a, b) => (a.v.at || 0) - (b.v.at || 0)).forEach(({ id, v }) => {
        const c = document.createElement('figure'); c.className = 'hwph-card';
        const im = document.createElement('img'); im.src = v.d; im.alt = 'Фото домашней работы'; im.onclick = () => zoom(v.d);
        const cap = document.createElement('figcaption'); cap.textContent = v.at ? new Date(v.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
        c.append(im, cap);
        if (T) { const del = document.createElement('button'); del.type = 'button'; del.textContent = 'Удалить'; del.onclick = () => { if (confirm('Удалить это фото?')) ref.doc(id).delete(); }; c.appendChild(del); }
        list.appendChild(c); });
      if (!hwDocs.length && T) list.innerHTML = '<span class="hwph-empty">Пока фото нет.</span>'; }, () => {});
  });
  /* Фото заданий из тетради: ученик прикрепляет к заданию прямо на уроке */
  document.addEventListener('DOMContentLoaded', () => {
    const ref = base.collection('hwphotos'), boxes = {};
    const zoom = d => { const o = document.createElement('div'); o.className = 'hwph-zoom'; o.innerHTML = '<img alt="Фото задания">'; o.firstChild.src = d; o.onclick = () => o.remove(); document.documentElement.appendChild(o); };
    document.querySelectorAll('section.part .nb').forEach(nbEl => { const sec = nbEl.closest('section.part'); if (!sec || sec.id === 'hw' || sec.id === 'errpanel' || nbEl.closest('#hw')) return;
      const key = (sec.id || 's') + '#' + Array.prototype.indexOf.call(sec.querySelectorAll('.nb'), nbEl);
      const h2 = sec.querySelector('h2'), lab = h2 ? h2.textContent.trim() : '';
      const b = document.createElement('div'); b.className = 'tph'; b.dataset.k = key; b.dataset.lab = lab;
      b.innerHTML = (T ? '<div class="tph-t">📷 Фото из тетради</div>' : '<div class="tph-row"><button type="button" class="tph-add">📷 Прикрепить фото из тетради</button><button type="button" class="ph-qr">📱 Снять телефоном</button><input type="file" accept="image/*" multiple hidden><span class="tph-msg"></span></div>') + '<div class="tph-list"></div>';
      nbEl.appendChild(b); boxes[key] = b;
      if (!T) { const inp = b.querySelector('input'), msg = t => { b.querySelector('.tph-msg').textContent = t; };
        b.querySelector('.tph-add').onclick = () => inp.click();
        b.querySelector('.ph-qr').onclick = () => phoneQR(key, lab);
        inp.onchange = async () => { const fs = [...inp.files]; inp.value = ''; let ok = 0;
          for (const f of fs) { msg('Загружаю ' + (ok + 1) + ' из ' + fs.length + '…');
            try { const d = await shrink(f); await ref.add(clean({ d, at: Date.now(), name: f.name || '', task: key, label: lab })); ok++; }
            catch (e) { msg(e && e.code === 'unsupported_type' ? 'Этот формат не открывается. Сделай скриншот фото и прикрепи его.' : 'Не получилось загрузить: ' + ((e && e.message) || e)); return; } }
          msg(ok ? 'Отправлено учителю!' : ''); }; } });
    if (!Object.keys(boxes).length) return;
    let first = true; const seen = {};
    ref.onSnapshot(q => { const by = {};
      q.docs.forEach(x => { const v = x.data(); if (!v.task || !boxes[v.task]) return; (by[v.task] = by[v.task] || []).push({ id: x.id, v });
        if (T && !first && !seen[x.id]) toast(v); seen[x.id] = 1; });
      Object.keys(boxes).forEach(k => { const b = boxes[k], list = b.querySelector('.tph-list'), arr = (by[k] || []).sort((a, c) => (a.v.at || 0) - (c.v.at || 0));
        b.classList.toggle('has', arr.length > 0); list.innerHTML = '';
        arr.forEach(({ id, v }) => { const c = document.createElement('figure'); c.className = 'hwph-card';
          const im = document.createElement('img'); im.src = v.d; im.alt = 'Фото задания'; im.onclick = () => zoom(v.d);
          const cap = document.createElement('figcaption'); cap.textContent = v.at ? new Date(v.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
          c.append(im, cap);
          if (T) { const del = document.createElement('button'); del.type = 'button'; del.textContent = 'Удалить'; del.onclick = () => { if (confirm('Удалить это фото?')) ref.doc(id).delete(); }; c.appendChild(del); }
          list.appendChild(c); }); });
      first = false; }, () => {});
    function toast(v){ const t = document.createElement('div'); t.className = 'tph-toast'; t.textContent = '📷 Ученик прислал фото: ' + (v.label || 'задание') + '. Нажми, чтобы посмотреть.';
      t.onclick = () => { const b = boxes[v.task]; if (b) b.scrollIntoView({ behavior: 'smooth', block: 'center' }); t.remove(); };
      document.documentElement.appendChild(t); setTimeout(() => t.remove(), 12000); }
  });
  const css = document.createElement('style');
  css.textContent = `.ph-qr{font:inherit;font-weight:600;border:1.5px solid var(--line,#E6DED2);color:var(--ink,#2B2622);background:var(--surface,#fff);border-radius:12px;padding:9px 14px;cursor:pointer}
.hwph-row .ph-qr{font-size:1.05rem;padding:14px 20px;width:100%}
@media (pointer:coarse) and (max-width:820px){.ph-qr{display:none!important}}
.phq{position:fixed;inset:0;z-index:120;background:rgba(43,38,34,.45);display:grid;place-items:center;padding:16px}
.phq-c{position:relative;background:#fff;border-radius:22px;padding:22px;max-width:380px;width:100%;display:grid;gap:12px;font:16px/1.45 system-ui,-apple-system,sans-serif;color:#2B2622;box-shadow:0 24px 60px rgba(0,0,0,.25)}
.phq-t{font-size:1.2rem}.phq-c ol{margin:0;padding-left:20px;display:grid;gap:4px}
.phq-x{position:absolute;right:12px;top:12px;border:0;background:#F7F3EC;border-radius:50%;width:34px;height:34px;cursor:pointer;font-size:1rem}
.phq-code{justify-self:center;width:236px;min-height:236px;display:grid;place-items:center;padding:8px;border:1px solid #E6DED2;border-radius:14px;background:#fff;text-align:center;color:#8A7F74;font-size:.9rem}
.phq-code img,.phq-code canvas{display:block}
.phq-st{min-height:1.4em;font-weight:600;color:#5E7F4E;text-align:center}.phq-ok{font:inherit;color:#B5532E;background:none;border:0;text-decoration:underline;cursor:pointer;padding:0}
.phq-l summary{cursor:pointer;color:#8A7F74;font-size:.92rem}.phq-l input{width:100%;font:13px ui-monospace,monospace;padding:8px;border:1px solid #E6DED2;border-radius:10px}
.hwph{margin-top:16px;display:grid;gap:10px;padding:16px;border:2px dashed var(--accent,#2e8b57);border-radius:16px;background:var(--surface,#fff)}.hwph-h{display:grid;gap:2px}.hwph-h span,.hwph-msg,.hwph-empty{color:var(--muted,#666);font-size:.92rem}.hwph-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.hwph-add{font:inherit;font-weight:600;border:none;border-radius:12px;padding:12px 18px;background:var(--accent,#2e8b57);color:#fff;cursor:pointer}.hwph-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.hwph-card{margin:0;display:grid;gap:4px}.hwph-card img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:10px;border:1px solid var(--line,#ddd);cursor:zoom-in}.hwph-card figcaption{font-size:.8rem;color:var(--muted,#666)}.hwph-card button{font:inherit;font-size:.8rem;border:1px solid var(--line,#ddd);background:transparent;border-radius:8px;padding:3px 8px;cursor:pointer}.hwleft{margin-top:16px;display:grid;gap:8px;padding:16px;border:2px solid #f2a900;border-radius:16px;background:#fff8e1}.hwleft[hidden]{display:none!important}.hwleft-sub{color:var(--muted,#666);font-size:.92rem}.hwleft-list{display:flex;flex-wrap:wrap;gap:8px}.hwleft-it{font:inherit;font-size:.9rem;border:1.5px solid #f2a900;background:#fff;border-radius:10px;padding:6px 12px;cursor:pointer}.hw-x{position:absolute;top:6px;right:40px;z-index:3;height:28px;border-radius:999px;border:1px solid #f2a900;background:#fff;color:#8a6100;font:700 .78rem/1 sans-serif;padding:0 10px;cursor:pointer;opacity:.7}.hw-x:hover{opacity:1}section.part>.hw-x{top:40px}.to-hw>.hw-x{opacity:1;background:#f2a900;color:#222}.st-mode .hw-x{display:none!important}.tc-mode .to-hw{outline:3px dashed #f2a900;outline-offset:6px;border-radius:12px}.st-mode:not(.hw-mode) .to-hw{display:none!important}.st-mode.hw-mode .to-hw{outline:3px solid #f2a900;outline-offset:6px;border-radius:12px}.st-mode.hw-mode .to-hw::before,.tc-mode .to-hw::before{content:'Домашнее задание';display:inline-block;justify-self:start;font:700 .72rem/1 sans-serif;letter-spacing:.05em;text-transform:uppercase;background:#f2a900;color:#222;padding:5px 9px;border-radius:999px;margin-bottom:6px}.hw-task-old{content:'Домашнее задание';display:inline-block;justify-self:start;font:700 .72rem/1 sans-serif;letter-spacing:.05em;text-transform:uppercase;background:#f2a900;color:#222;padding:5px 9px;border-radius:999px;margin-bottom:6px}.vtabs{position:fixed;bottom:58px;left:50%;transform:translateX(-50%);z-index:45;display:flex;gap:4px;padding:4px;border-radius:999px;background:var(--surface,#fff);box-shadow:0 4px 18px rgba(0,0,0,.18)}@media (min-width:1100px){.vtabs{top:8px;bottom:auto;left:auto;right:12px;transform:none}}.vtabs[hidden]{display:none!important}.vtabs button{font:inherit;font-weight:700;font-size:.9rem;border:none;border-radius:999px;padding:8px 16px;background:transparent;color:var(--ink,#222);cursor:pointer}.vtabs button{white-space:nowrap}@media (max-width:480px){.vtabs button{font-size:.82rem;padding:8px 12px}}.vtabs button[aria-pressed=true]{background:#f2a900;color:#222}.view-hw header.top,.view-hw nav.chips,.view-hw .badges,.view-hw .stubar,.view-hw .rv-tab,.view-hw .tree-card,.view-hw .hwleft{display:none!important}.view-hw section.part:not(#hw):not(.to-hw):not(:has(.to-hw)){display:none!important}.view-hw section.part:not(.to-hw):has(.to-hw)>*:not(.to-hw):not(.part-head){display:none!important}.view-hw #dwCanvas,.view-hw .dw-canvas,.view-hw #dwBar,.view-hw .dw-bar{display:none!important}.view-hw .wrap{padding-top:56px}.view-hw #hw{order:99}.st-mode.view-hw.hw-mode .to-hw{display:grid!important}html:not(.view-hw).st-mode .to-hw{display:none!important}.hwdone{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding-top:6px;border-top:1px dashed var(--line,#ddd)}.hwdone-btn{font:inherit;font-weight:700;border:none;border-radius:12px;padding:12px 18px;background:#f2a900;color:#222;cursor:pointer}.hwdone-st{font-weight:600}.tph{margin-top:12px;display:grid;gap:8px}.tc-mode .tph:not(.has){display:none}.tph-t{font-weight:700;font-size:.9rem;color:var(--accent,#2e8b57)}.tph-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.tph-add{font:inherit;font-weight:600;border:2px solid var(--accent,#2e8b57);color:var(--accent,#2e8b57);background:transparent;border-radius:12px;padding:9px 14px;cursor:pointer}.tph-msg{color:var(--muted,#666);font-size:.9rem}.tph-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px}.tph-list:empty{display:none}.tph-toast{position:fixed;right:16px;bottom:80px;z-index:60;max-width:min(360px,90vw);background:#2e8b57;color:#fff;border-radius:14px;padding:12px 16px;font:600 15px/1.35 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.2);cursor:pointer}.hwph-zoom{position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.85);display:grid;place-items:center;cursor:zoom-out}.hwph-zoom img{max-width:96vw;max-height:94vh}
.st-mode .dict-veil{font-size:0!important;user-select:none}.st-mode .dict-veil *{font-size:0!important}.st-mode .dict-veil br{display:none}.st-mode .dict-veil::before{content:'Текст диктует учитель. Он откроется после проверки.';font-size:.95rem;font-style:italic;font-weight:400;color:var(--muted,#777)}
.st-mode .tk-hidden{display:none!important}.st-mode nav.chips a.tk-off{display:none}
.st-mode .tk-x,.st-mode .rv-tab,.st-mode .rv-panel,.st-mode .ui-add,.st-mode .ui-del,.st-mode #dictShow,.st-mode #dictDone,.st-mode .dlist input,.st-mode .dlist .dmark,.st-mode .wck .inline,.st-mode .nbq .opts,.st-mode .tchk,.st-mode .ui-card .opts,.st-mode .ui-card textarea,.st-mode #finBtn,.st-mode #redo,.st-mode #saveMsg,.st-mode .hw-head p,.st-mode #hwSave,.st-mode #hwCopy,.st-mode .hwd{display:none!important}`;
  document.head.appendChild(css);
  /* ---------- Ученик: строка «Что делать сейчас», меньше лишнего, рисование по кнопке на телефоне ---------- */
  if (!T) addEventListener('load', () => {
    const H = document.documentElement;
    const gb = document.createElement('div'); gb.className = 'guide'; gb.setAttribute('role', 'status'); gb.setAttribute('aria-live', 'polite');
    gb.innerHTML = '<div class="g-in"><span class="g-ic"></span><span class="g-tx"><small class="g-st"></small><b class="g-main"></b></span><button type="button" class="g-go" hidden></button></div>';
    H.appendChild(gb);
    const ic = gb.querySelector('.g-ic'), stp = gb.querySelector('.g-st'), main = gb.querySelector('.g-main'), go = gb.querySelector('.g-go');
    let goFn = null; go.onclick = () => { if (goFn) goFn(); };
    const secs = () => [...document.querySelectorAll('section.part')].filter(s => s.id !== 'hw' && s.id !== 'errpanel' && !s.classList.contains('tk-hidden'));
    const stepName = sec => { const n = sec.querySelector('.part-head .num'); const h = sec.querySelector('h2'); return (n ? n.textContent.trim().replace(/\s+/g, ' ') : '') || (h ? h.textContent.trim() : ''); };
    const isNb = sec => sec.classList.contains('sec-nb') || (!sec.querySelector('.q') && !!sec.querySelector('.nb'));
    const answered = q => q.classList.contains('is-ok') || q.classList.contains('is-bad');
    function how(q){
      if (!q) return null;
      if (q.closest('.nb,.wck')) return ['📓', 'Пиши в тетради. Потом нажми «📷 Прикрепить фото из тетради».'];
      const inp = q.querySelector('input[type=text],input:not([type]),textarea');
      if (inp) { const ph = (inp.getAttribute('placeholder') || '').trim(); return ['⌨️', (ph ? ph.replace(/[.…]+$/, '') : 'Напиши ответ') + ' и нажми «Проверить».']; }
      if (q.querySelector('.gp,.wcard,.tok')) return ['👆', 'Нажми на нужное место, потом на ответ.'];
      return ['👆', 'Нажми на правильный ответ.'];
    }
    function center(){ for (const f of [0.45, 0.35, 0.6, 0.25, 0.75]) { const el = document.elementFromPoint(innerWidth / 2, innerHeight * f); if (!el || el.closest('.guide,.dw-bar,.progress,.vtabs,.dwq')) continue; const s = el.closest('section.part'); if (s) return el; } return null; }
    const howCache = new WeakMap();
    function paint(){
      const hwm = H.classList.contains('hw-mode'), vhw = H.classList.contains('view-hw');
      gb.classList.toggle('with-tabs', hwm);
      let i = '', s = '', m = '', g = null, gl = '';
      if (vhw) {
        const hw = document.getElementById('hw'); const ph = hw ? hw.querySelectorAll('.hwph-card').length : 0;
        const done = hw && /Отправлено учителю/.test((hw.querySelector('.hwdone-st') || {}).textContent || '');
        const left = [...document.querySelectorAll('.to-hw')].filter(t => !t.closest('#hw')).length;
        s = 'Домашнее задание';
        if (done) { i = '🎉'; m = 'Домашка отправлена учителю. Молодец!'; }
        else if (!ph) { i = '📒'; m = (left ? 'Сделай задания на экране и в тетради.' : 'Сделай задания в тетради.') + ' Потом сфотографируй тетрадь.'; g = () => { const b = document.querySelector('.hwph'); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'center' }); }; gl = '📷 К фото'; }
        else { i = '✅'; m = 'Фото есть. Нажми «Я выполнил(а) домашнее задание».'; g = () => { const b = document.querySelector('.hwdone-btn'); if (b) { b.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }; gl = 'Отметить'; }
      } else if (hwm) { i = '🎉'; s = 'Урок закончен'; m = 'Теперь открой домашнее задание.'; g = () => { const b = document.querySelector('.vtabs [data-v=hw]'); if (b) b.click(); }; gl = 'Открыть домашку'; }
      else {
        const open = secs().filter(x => x.classList.contains('st-open'));
        if (!open.length) { i = '⏳'; s = 'Урок скоро начнётся'; m = 'Подожди: учитель сейчас откроет первое задание.'; }
        else {
          const el = center(); let sec = el && el.closest('section.part'); if (!sec || !sec.classList.contains('st-open')) sec = open[open.length - 1];
          s = stepName(sec);
          const qs = [...sec.querySelectorAll('.q')].filter(q => !q.closest('.tk-hidden'));
          const allDone = qs.length && qs.every(answered);
          const last = open[open.length - 1] === sec;
          if (allDone && !isNb(sec)) { i = '✅'; m = last ? 'Шаг готов! Подожди: учитель откроет следующий.' : 'Шаг готов! Листай вниз к следующему.'; }
          else if (isNb(sec) && !qs.length) { i = '📓'; m = 'Пиши в тетради. Когда закончишь, сфотографируй и прикрепи фото.'; }
          else {
            let q = el && el.closest('.q,.nb,.wck'); if (!q || !sec.contains(q)) q = qs.find(x => !answered(x)) || null;
            if (!q && el && el.closest('.theory,.memo')) { i = '📖'; m = 'Прочитай правило. Задания ниже.'; }
            else { const h = how(q) || ['👆', 'Выполняй задания этого шага.']; i = h[0]; m = h[1]; }
            const nxt = qs.find(x => !answered(x));
            const rr = nxt && nxt.getBoundingClientRect(); if (nxt && !isNb(sec) && (rr.bottom < 90 || rr.top > innerHeight - 90)) { g = () => nxt.scrollIntoView({ behavior: 'smooth', block: 'center' }); gl = 'К заданию'; }
          }
        }
      }
      ic.textContent = i; stp.textContent = s; main.textContent = m; goFn = g; go.hidden = !g; go.textContent = gl;
    }
    let tm = null; const soon = () => { if (tm) return; tm = setTimeout(() => { tm = null; paint(); }, 150); };
    addEventListener('scroll', soon, { passive: true }); addEventListener('resize', soon);
    document.addEventListener('click', () => setTimeout(paint, 250), true);
    new MutationObserver(soon).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
    new MutationObserver(soon).observe(H, { attributes: true, attributeFilter: ['class'] });
    paint();
    /* подпись способа ответа у каждого упражнения */
    document.querySelectorAll('.ex').forEach(ex => { const t = ex.querySelector('.ex-task'); const q = ex.querySelector('.q'); if (!t || !q) return; const h = how(q); if (h) t.setAttribute('data-how', h[0] === '⌨️' ? '⌨️ Пиши' : '👆 Нажимай'); });
    /* рисование на телефоне — по кнопке */
    const bar = document.getElementById('dwBar');
    if (bar) { const k = document.createElement('button'); k.type = 'button'; k.className = 'dwq'; k.textContent = '✏️'; k.title = 'Рисовать на экране'; H.appendChild(k);
      k.onclick = () => { const on = !H.classList.contains('dw-show'); H.classList.toggle('dw-show', on); k.textContent = on ? '✕' : '✏️';
        if (!on) { const n = bar.querySelector('[data-tool="none"]'); if (n) n.click(); } }; }
  });

  const gcss = document.createElement('style');
  gcss.textContent = `.guide{display:none}
.st-mode .guide{display:block;position:fixed;left:0;right:0;top:0;z-index:44;padding:8px 10px;background:linear-gradient(var(--bg,#fff) 70%,transparent);pointer-events:none}
.st-mode .guide.with-tabs{padding-top:58px}
.guide .g-in{pointer-events:auto;max-width:760px;margin:0 auto;display:flex;align-items:center;gap:10px;background:#1f2a44;color:#fff;border-radius:16px;padding:9px 12px;box-shadow:0 6px 20px rgba(0,0,0,.18);font:15px/1.3 system-ui,-apple-system,sans-serif}
.guide .g-ic{font-size:1.6rem;line-height:1;flex:none;font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}
.guide .g-tx{flex:1;min-width:0;display:grid;gap:1px}
.guide .g-st{font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.guide .g-st:empty{display:none}
.guide .g-main{font-weight:700}
.guide .g-go{flex:none;font:700 .88rem/1 system-ui,sans-serif;border:none;border-radius:999px;padding:10px 14px;background:#ffd43b;color:#222;cursor:pointer;white-space:nowrap}
.st-mode .wrap{padding-top:78px}
.st-mode.hw-mode .wrap{padding-top:130px}
.st-mode section.part{scroll-margin-top:120px}
.st-mode.hw-mode section.part{scroll-margin-top:170px}
.st-mode nav.chips,.st-mode .badges,.st-mode .stubar,.st-mode .gate-wait{display:none!important}
.st-mode .ex-task[data-how]::before{content:attr(data-how);display:inline-block;margin-right:8px;font:700 .75rem/1 system-ui,sans-serif;background:#1f2a44;color:#fff;border-radius:999px;padding:4px 9px;vertical-align:middle}
.st-mode section.part.sec-nb>.part-head::after{content:"📓 Этот шаг пишем в тетради";display:block;margin-top:10px;font:700 1rem/1.3 system-ui,sans-serif;background:#fff4d6;color:#5c4300;border:2px solid #f2a900;border-radius:12px;padding:10px 12px}
.st-mode .hwdone-btn{font-size:1.05rem;padding:14px 20px;width:100%}
.st-mode .hwph-add{font-size:1.05rem;padding:14px 20px;width:100%}
.st-mode .hwph{border-width:3px;border-style:solid}
.dwq{display:none}
@media (max-width:700px){.st-mode .dwq{display:grid;place-items:center;position:fixed;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 60px);z-index:41;width:48px;height:48px;border-radius:50%;border:none;background:#1f2a44;color:#fff;font-size:1.3rem;box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer}
html.st-mode:not(.dw-show) .dw-bar{display:none!important}
.st-mode .wrap{padding-bottom:140px}
.st-mode.view-hw .dwq{display:none}}`;
  document.head.appendChild(gcss);

  /* ---------- правка текста учителем: сохраняется для всех листов и учеников ---------- */
  (function(){
    const UNIT = 'p,li,h1,h2,h3,h4,h5,td,th,dt,dd,figcaption,blockquote,.ex-task,.theory,.dict-veil,.memo,.rule,.note,.tip,.label';
    const BLOCK = '.theory,.memo,.dict-veil,.rule';
    const BAD = 'input,button,select,textarea,canvas,video,audio,iframe,.gp,.wcard,.basket,.tok,.opt,.st';
    const OUT = 'nav.chips,#dwBar,.dw-bar,.dw-tb,#errpanel,.rv-panel,.badges,.stubar,.txed-ui,#finRep';
    const norm = h => String(h || '').replace(/\s*contenteditable="[^"]*"/g, '').replace(/\s*data-txu=""/g, '').replace(/\s*spellcheck="[^"]*"/g, '').replace(/\s+/g, ' ').replace(/> </g, '><').trim();
    const h32 = (s, seed) => { let h = seed >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
    const keyOf = html => { const n = norm(html); return 'k' + h32(n, 2166136261) + h32(n, 0x9747b28c) + n.length.toString(36); };
    const E = () => API.edits || {};
    const byKey = new Map();
    const reg = (k, el) => { if (!byKey.has(k)) byKey.set(k, []); if (!byKey.get(k).includes(el)) byKey.get(k).push(el); };
    /* блоки-правила целиком */
    const blocks = () => [...document.body.querySelectorAll(BLOCK)].filter(el => !el.parentElement.closest(BLOCK) && !el.closest(OUT) && !el.querySelector(BAD));
    const markB = el => { if (!el.__bk) { el.__bk = 'b' + keyOf(el.innerHTML); el.__borig = el.innerHTML; reg(el.__bk, el); } return el.__bk; };
    /* мелкие куски текста */
    const isUnit = el => el.matches(UNIT) && !el.closest(OUT) && !el.closest('[data-txb]') && !el.querySelector(BAD) && !el.querySelector(UNIT) && el.textContent.trim().length > 1;
    const units = root => [...(root || document.body).querySelectorAll(UNIT)].filter(isUnit);
    const markU = el => { if (!el.__k) { el.__k = keyOf(el.innerHTML); el.__orig = el.innerHTML; reg(el.__k, el); } return el.__k; };
    const showU = (el, html) => { el.innerHTML = html == null ? el.__orig : html; el.style.display = html === '' ? 'none' : ''; };
    const showB = (el, html) => {
      if (html == null) { el.innerHTML = el.__borig; el.removeAttribute('data-txb'); el.style.display = ''; units(el).forEach(u => { u.__k = null; const k = markU(u); if (E()[k] != null) showU(u, E()[k]); }); }
      else { el.innerHTML = html; el.setAttribute('data-txb', ''); el.style.display = html === '' ? 'none' : ''; }
    };
    const put = (k, html) => { (byKey.get(k) || []).forEach(el => { if (el.contains(document.activeElement) && el.isContentEditable) return; if (k[0] === 'b') showB(el, html); else showU(el, html); }); };
    window.__txed = { put };
    document.addEventListener('DOMContentLoaded', () => {
      blocks().forEach(el => { const k = markB(el); if (E()[k] != null) showB(el, E()[k]); });
      units().forEach(el => { const k = markU(el); if (E()[k] != null) showU(el, E()[k]); });
    });
    if (!T) return;

    /* ---------- режим правки (только учитель) ---------- */
    const css = document.createElement('style');
    css.textContent = `html.txed [data-txu]{outline:1.5px dashed #B5532E;outline-offset:3px;border-radius:4px;cursor:text}
html.txed [data-txu]:hover{background:rgba(181,83,46,.06)}
html.txed [data-txu]:focus{outline:2.5px solid #B5532E;background:rgba(181,83,46,.08)}
html.txed [data-txu].txed-ok{background:rgba(124,154,107,.3)!important}
html.txed .txed-blk{outline:2px solid #B5532E!important;outline-offset:6px}
.txed-ui{font:600 13px/1.2 system-ui,-apple-system,sans-serif}
.txed-tip{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:99;background:#2B2622;color:#fff;padding:8px 14px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.2);max-width:calc(100vw - 24px);text-align:center}
.txed-chip{position:absolute;z-index:60;display:flex;gap:6px}
.txed-chip button,.txed-fmt button{font:inherit;border:1px solid #E6DED2;background:#fff;color:#2B2622;border-radius:999px;padding:6px 11px;cursor:pointer;box-shadow:0 4px 12px rgba(43,38,34,.12);white-space:nowrap}
.txed-chip button.m{background:#B5532E;border-color:#B5532E;color:#fff}
.txed-fmt{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99;display:flex;gap:6px;flex-wrap:wrap;justify-content:center;background:#fff;border:1px solid #E6DED2;border-radius:16px;padding:8px;box-shadow:0 10px 30px rgba(43,38,34,.18);max-width:calc(100vw - 24px)}
.txed-fmt button{box-shadow:none;border-radius:10px;min-width:38px;padding:7px 10px}
.txed-fmt b{align-self:center;color:#8A7F74;font-weight:600;padding:0 4px}`;
    document.documentElement.appendChild(css);
    let tip = null; const say = (t, ms) => { if (!tip) { tip = document.createElement('div'); tip.className = 'txed-ui txed-tip'; document.documentElement.appendChild(tip); } tip.textContent = t; tip.hidden = false; clearTimeout(tip.__t); if (ms) tip.__t = setTimeout(() => { tip.hidden = true; }, ms); };
    const ok = el => { el.classList.add('txed-ok'); setTimeout(() => el.classList.remove('txed-ok'), 900); };
    const tidy = h => h == null ? h : String(h).replace(/\s*(contenteditable|spellcheck)="[^"]*"/g, '').replace(/\s*data-txu=""/g, '').replace(/\s*style=""/g, '').replace(/\s*class="txed-[a-z]+"/g, '');
    async function persist(k, val, orig, el, msg){ val = tidy(val); orig = tidy(orig);
      try { await API.saveEdit(k, val, orig, document.title); put(k, val); API.emit({ k: 'txed', key: k, html: val }); if (el) ok(el); say(msg, 2600); }
      catch (e) { say('Не сохранилось: ' + (e.message || e), 4000); }
    }
    const saveU = el => {
      const html = norm(el.innerHTML); if (html === el.__last0) return; el.__last0 = html;
      const reset = html === norm(el.__orig); const gone = !el.textContent.trim() && !el.querySelector('img');
      const val = reset ? null : gone ? '' : el.innerHTML; if (gone) showU(el, '');
      persist(el.__k, val, el.__orig, el, reset ? 'Вернула как было' : gone ? 'Строчка убрана во всех листах. Вернуть можно в админке, «Правки текста»' : 'Сохранено. Так будет во всех листах, где есть этот текст');
    };
    const saveB = el => {
      const html = norm(el.innerHTML); if (html === el.__last0) return; el.__last0 = html;
      const reset = html === norm(el.__borig); const gone = !el.textContent.trim() && !el.querySelector('img');
      const val = reset ? null : gone ? '' : el.innerHTML;
      persist(el.__bk, val, el.__borig, el, reset ? 'Правило вернулось как было' : gone ? 'Правило убрано во всех листах. Вернуть можно в админке' : 'Твоё правило сохранено. Оно будет во всех листах вместо старого');
    };
    const editable = (el, on) => { if (on) { el.setAttribute('data-txu', ''); el.contentEditable = 'true'; el.spellcheck = true; } else { el.removeAttribute('data-txu'); el.removeAttribute('contenteditable'); } };
    function bindU(el){ markU(el); editable(el, true); el.__last0 = norm(el.innerHTML);
      if (!el.__bu) { el.__bu = 1; el.addEventListener('blur', () => { if (el.isContentEditable && !el.closest('[data-txb]')) saveU(el); }); el.addEventListener('keydown', e => { if (e.key === 'Escape') el.blur(); }); } }
    function bindB(el){ editable(el, true); el.__last0 = norm(el.innerHTML);
      if (!el.__bb) { el.__bb = 1; el.addEventListener('focusout', e => { if (!el.hasAttribute('data-txb') || !el.isContentEditable) return; if (e.relatedTarget && (el.contains(e.relatedTarget))) return; setTimeout(() => { if (!el.contains(document.activeElement)) saveB(el); }, 0); }); } }
    /* кнопки над правилами (в documentElement, чтобы не сдвигать адреса элементов) */
    let chips = [];
    const place = () => chips.forEach(c => { const r = c.__el.getBoundingClientRect(); c.style.display = (r.height ? '' : 'none'); c.style.top = (scrollY + r.top - 16) + 'px'; c.style.left = (scrollX + Math.max(6, r.right - c.offsetWidth - 10)) + 'px'; });
    function chipFor(el){
      const c = document.createElement('div'); c.className = 'txed-ui txed-chip'; c.__el = el;
      const rep = el.hasAttribute('data-txb');
      c.innerHTML = '<button type="button" class="m" data-a="new">✍️ ' + (rep ? 'Переписать правило' : 'Заменить правило целиком') + '</button>' + (rep ? '<button type="button" data-a="back">↩ Вернуть исходное</button>' : '');
      c.addEventListener('mousedown', e => e.preventDefault());
      c.addEventListener('click', e => { const a = e.target.closest('button'); if (!a) return;
        if (a.dataset.a === 'new') {
          units(el).forEach(u => editable(u, false));
          if (!el.hasAttribute('data-txb')) { const lab = el.querySelector(':scope > .label'); el.innerHTML = (lab ? lab.outerHTML : '') + '<p>Напиши здесь своё правило</p>'; el.setAttribute('data-txb', ''); }
          bindB(el);
          el.classList.add('txed-blk'); el.focus();
          const ps = el.querySelectorAll('p'); const last = ps[ps.length - 1] || el; const rg = document.createRange(); rg.selectNodeContents(last); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg);
          say('Пиши своё правило. Внизу кнопки: жирный, подчеркнуть, маркер, список. Сохранится, когда нажмёшь мимо', 4500);
          refresh();
        }
        if (a.dataset.a === 'back') { editable(el, false); el.classList.remove('txed-blk'); persist(el.__bk, null, el.__borig, null, 'Правило вернулось как было'); showB(el, null); refresh(); }
      });
      document.documentElement.appendChild(c); return c;
    }
    /* кнопки оформления */
    let fmt = null;
    function fmtBar(){
      fmt = document.createElement('div'); fmt.className = 'txed-ui txed-fmt';
      const B = [['bold', '<b style="color:inherit;padding:0">Ж</b>', 'Жирный'], ['italic', '<i>К</i>', 'Курсив'], ['underline', '<u>Ч</u>', 'Подчеркнуть'], ['mark', '🖍', 'Маркер'], ['insertUnorderedList', '• список', 'Список'], ['insertOrderedList', '1. список', 'Нумерация'], ['removeFormat', '✕ формат', 'Убрать оформление'], ['undo', '↶', 'Отменить']];
      fmt.innerHTML = B.map(b => '<button type="button" title="' + b[2] + '" data-c="' + b[0] + '">' + b[1] + '</button>').join('');
      fmt.addEventListener('mousedown', e => e.preventDefault());
      fmt.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const c = b.dataset.c;
        if (c === 'mark') { const cur = document.queryCommandValue('backColor'); const on = /255, 2[23]\d, 1[0-9]{2}|ffe/i.test(cur || ''); document.execCommand('styleWithCSS', false, true); document.execCommand('backColor', false, on ? 'transparent' : '#FFE38A'); document.execCommand('styleWithCSS', false, false); }
        else document.execCommand(c, false, null); });
      document.documentElement.appendChild(fmt);
    }
    function refresh(){
      chips.forEach(c => c.remove()); chips = [];
      if (!document.documentElement.classList.contains('txed')) return;
      blocks().forEach(el => { markB(el); chips.push(chipFor(el)); });
      units().forEach(bindU);
      requestAnimationFrame(place);
    }
    addEventListener('scroll', () => chips.length && place(), { passive: true });
    addEventListener('resize', () => chips.length && place());
    window.__txedToggle = on => {
      document.documentElement.classList.toggle('txed', on);
      if (on) { refresh(); if (!fmt) fmtBar(); fmt.hidden = false; say('Нажми на текст и исправляй. Чтобы написать правило заново, нажми «Заменить правило целиком»', 4500); }
      else {
        if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
        document.querySelectorAll('[data-txu]').forEach(el => editable(el, false)); document.querySelectorAll('.txed-blk').forEach(el => el.classList.remove('txed-blk'));
        chips.forEach(c => c.remove()); chips = []; if (fmt) fmt.hidden = true; if (tip) tip.hidden = true;
      }
    };
  })();


  /* ---------- тексты ученика (сочинения): учитель сохраняет то, что пишет ученик ---------- */
  if (T) {
    const kt = new Map();
    const slug = t => String(t).toLowerCase().replace(/[^a-zа-яё0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'text';
    document.addEventListener('input', e => {
      const el = e.target; if (!(el instanceof HTMLTextAreaElement) || !el.dataset.keep) return;
      clearTimeout(kt.get(el)); kt.set(el, setTimeout(() => {
        base.collection('texts').doc(slug(el.dataset.keep)).set({ label: el.dataset.keep, text: el.value, at: Date.now() }).catch(() => {});
      }, 1200));
    }, true);
  }

  /* ---------- онлайн-доска по кнопке: учитель пишет и вставляет задания, оба рисуют ---------- */
  (function(){
    const W = 1000, NS = 'http://www.w3.org/2000/svg';
    const items = new Map(); let H = 1400, open = false, tool = 'pen', color = '#22201c', mine = [], sel = null, k = 1;
    const css = document.createElement('style');
    css.textContent = `
.wb-btn{position:fixed;left:14px;bottom:64px;z-index:2147482000;font:700 15px/1 system-ui,sans-serif;background:#2f6f5e;color:#fff;border:0;border-radius:999px;padding:12px 18px;box-shadow:0 6px 18px rgba(0,0,0,.18);cursor:pointer}
.wb-btn.ping{animation:wbPing 1.2s ease-in-out 3}
@keyframes wbPing{50%{transform:scale(1.12)}}
.wb{position:fixed;inset:0;z-index:2147483000;background:#eef0ec;display:flex;flex-direction:column}
.wb[hidden]{display:none}
html.wb-on #dwBar,html.wb-on .dw-tb,html.wb-on #dwCanvas,html.wb-on .wb-btn{visibility:hidden}
.wb-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 12px;background:#fff;border-bottom:1px solid #dcdfd8;font:600 14px system-ui,sans-serif}
.wb-top b{font-size:16px;margin-right:8px}
.wb-top button{min-width:38px;height:38px;border:1px solid #d6d9d2;background:#fafaf8;border-radius:10px;cursor:pointer;font:600 14px system-ui,sans-serif;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.wb-top button.on{outline:3px solid #2f6f5e;outline-offset:1px;background:#e6f1ec}
.wb-top .sw{width:24px;height:24px;border-radius:50%;display:inline-block;border:2px solid #fff;box-shadow:0 0 0 1px #bbb}
.wb-top .sep{width:1px;height:26px;background:#dcdfd8;margin:0 4px}
.wb-top .grow{flex:1}
.wb-top .x{background:#2f6f5e;color:#fff;border-color:#2f6f5e}
.wb-top .warn{background:#fff3ef;border-color:#e5b4a3}
.wb-sc{flex:1;overflow:auto;padding:16px}
.wb-wrap{margin:0 auto;position:relative}
.wb-pg{position:absolute;left:0;top:0;width:${W}px;transform-origin:0 0;background:#fff;
 background-image:linear-gradient(#dfe8f3 1px,transparent 1px),linear-gradient(90deg,#dfe8f3 1px,transparent 1px);background-size:25px 25px;box-shadow:0 2px 12px rgba(0,0,0,.08);border-radius:6px;touch-action:none}
.wb-pg.hand{touch-action:auto}
.wb-pg svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3}
.wb-it{position:absolute;z-index:2}
.wb-tx{font:400 26px/1.45 "Manrope",system-ui,sans-serif;color:#22201c;white-space:pre-wrap;word-break:break-word;min-width:60px;min-height:1.45em;padding:2px 6px;border-radius:6px;outline:none}
.tc-mode .wb-tx[contenteditable=true]:focus{box-shadow:0 0 0 2px #2f6f5e55;background:#ffffffcc}
.wb-im img{width:100%;display:block;border-radius:4px;user-select:none;-webkit-user-drag:none}
.wb-h{position:absolute;display:none;width:28px;height:28px;border-radius:8px;background:#2f6f5e;color:#fff;font:700 15px/28px system-ui;text-align:center;cursor:pointer;z-index:4;user-select:none;touch-action:none}
.tc-mode .wb-it:hover .wb-h,.tc-mode .wb-it.sel .wb-h{display:block}
.wb-h.mv{left:-32px;top:0;cursor:move}.wb-h.del{left:-32px;top:32px;background:#b5532e}.wb-h.rs{right:-14px;bottom:-14px;cursor:nwse-resize}
.wb-it.sel{outline:2px dashed #2f6f5e88;outline-offset:3px}
.wb-more{display:block;margin:14px auto 30px;font:600 14px system-ui;border:1px dashed #9aa59a;background:transparent;border-radius:10px;padding:10px 16px;cursor:pointer;color:#55604f}
.wb-tip{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#22201c;color:#fff;font:600 14px system-ui;padding:10px 16px;border-radius:12px;z-index:2147483001;opacity:0;transition:opacity .3s;pointer-events:none;max-width:90vw;text-align:center}
.wb-tip.on{opacity:.92}
@media (max-width:640px){.wb-top b{display:none}.wb-top button{min-width:34px;height:34px;padding:0 7px}.wb-sc{padding:8px}}`;
    document.head.appendChild(css);

    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'wb-btn'; btn.textContent = '🧑‍🏫 Доска'; btn.hidden = !T;
    const box = document.createElement('div'); box.className = 'wb'; box.hidden = true;
    const COLORS = [['#22201c','чёрный'],['#d23b2a','красный'],['#1f62c9','синий'],['#1d8a4e','зелёный']];
    box.innerHTML = '<div class="wb-top" role="toolbar" aria-label="Доска"><b>Доска</b>' +
      (T ? '<button type="button" data-t="text" title="Текст: нажми на доску и пиши">Т&nbsp;Текст</button><button type="button" data-a="img" title="Картинка или скриншот (можно Ctrl+V)">🖼&nbsp;Картинка</button><button type="button" data-a="sz-" title="Текст мельче">A−</button><button type="button" data-a="sz+" title="Текст крупнее">A+</button><span class="sep"></span>' : '') +
      '<button type="button" data-t="pen" title="Ручка">✏️</button><button type="button" data-t="hl" title="Маркер">🖍</button><button type="button" data-t="line" title="Прямая линия: подчеркнуть">➖</button><button type="button" data-t="er" title="Ластик">🧽</button><button type="button" data-t="hand" title="Листать">✋</button><span class="sep"></span>' +
      COLORS.map(c => '<button type="button" data-c="' + c[0] + '" title="' + c[1] + '"><i class="sw" style="background:' + c[0] + '"></i></button>').join('') +
      '<span class="sep"></span><button type="button" data-a="undo" title="Отменить своё последнее">↩︎</button>' + (T ? '<button type="button" data-a="clr" title="Очистить доску">🗑</button>' : '') +
      '<span class="grow"></span><button type="button" class="x" data-a="close">Закрыть доску</button></div>' +
      '<div class="wb-sc"><div class="wb-wrap"><div class="wb-pg"><svg xmlns="' + NS + '"></svg></div></div><button type="button" class="wb-more">+ место внизу</button></div>' +
      (T ? '<input type="file" accept="image/*" hidden>' : '');
    const tip = document.createElement('div'); tip.className = 'wb-tip';
    document.documentElement.append(btn, box, tip);
    const pg = box.querySelector('.wb-pg'), svg = pg.querySelector('svg'), wrap = box.querySelector('.wb-wrap'), sc = box.querySelector('.wb-sc');
    let tipT; const say = (t, ms) => { tip.textContent = t; tip.classList.add('on'); clearTimeout(tipT); tipT = setTimeout(() => tip.classList.remove('on'), ms || 2500); };
    const rid = () => 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const emit = op => { send(Object.assign({ k: 'wb' }, op)); if (op.op !== 'open' && typeof save === 'function') save(); };

    function fit(){ const avail = Math.min(sc.clientWidth - (innerWidth < 640 ? 16 : 32), 1100); k = Math.max(0.3, avail / W);
      pg.style.height = H + 'px'; pg.style.transform = 'scale(' + k + ')'; wrap.style.width = W * k + 'px'; wrap.style.height = H * k + 'px'; svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); }
    addEventListener('resize', () => { if (open) fit(); });
    const grow = y => { if (y > H - 200) { H = Math.ceil((y + 400) / 100) * 100; fit(); } };

    /* отрисовка */
    const pathD = p => p.length === 1 ? 'M' + p[0][0] + ' ' + p[0][1] + 'l0.1 0' : 'M' + p.map(q => q[0] + ' ' + q[1]).join('L');
    function draw(it){
      let el = it.el;
      if (it.t === 's') {
        if (!el) { el = document.createElementNS(NS, 'path'); el.setAttribute('fill', 'none'); el.setAttribute('stroke-linecap', it.f === 'hl' ? 'butt' : 'round'); el.setAttribute('stroke-linejoin', 'round'); svg.appendChild(el); it.el = el; }
        el.setAttribute('d', pathD(it.p)); el.setAttribute('stroke', it.c); el.setAttribute('stroke-width', it.w); el.setAttribute('opacity', it.f === 'hl' ? .38 : 1);
        grow(Math.max(...it.p.map(q => q[1]))); return; }
      if (!el) {
        el = document.createElement('div'); el.className = 'wb-it ' + (it.t === 'x' ? 'wb-tb' : 'wb-im'); el.dataset.id = it.id;
        el.innerHTML = (it.t === 'x' ? '<div class="wb-tx"></div>' : '<img alt="Задание на доске">') + '<span class="wb-h mv" title="Перетащить">⠿</span><span class="wb-h del" title="Удалить">✕</span>' + (it.t === 'i' ? '<span class="wb-h rs" title="Размер">⤡</span>' : '');
        pg.appendChild(el); it.el = el;
        if (it.t === 'x') { const tx = el.firstChild; if (T) { tx.contentEditable = 'true'; tx.spellcheck = false; bindText(it, tx); } }
        if (it.t === 'i') { const im = el.querySelector('img'); if (it.src) im.src = it.src; else blobOf(it).then(u => { if (u) im.src = u; }); im.onload = () => grow(it.y + im.getBoundingClientRect().height / k); }
        if (T) bindHandles(it, el);
      }
      el.style.left = it.x + 'px'; el.style.top = it.y + 'px';
      if (it.t === 'x') { el.style.maxWidth = (W - it.x - 10) + 'px'; const tx = el.firstChild; tx.style.fontSize = (it.s || 26) + 'px'; tx.style.color = it.col || ''; if (document.activeElement !== tx && tx.innerText !== it.h) tx.innerText = it.h || ''; grow(it.y + 60); }
      else el.style.width = it.w + 'px';
    }
    /* картинка могла быть загружена на прошлом уроке: тогда она лежит в другом листе */
    function blobOf(it){ if (!it.bs || it.bs === API.sheetId) return window.__blobSrc ? window.__blobSrc(it.b) : Promise.resolve('');
      return API.base.parent.doc(it.bs).collection('blobs').doc(it.b).get().then(s => s.exists ? s.data().d : '').catch(() => ''); }
    /* доска ученика переходит из урока в урок: учитель хранит её в карточке ученика */
    const SID = API.studentId || null; let seen = false, saveT = null, loaded = false;
    const stuRef = () => API.base.firestore.collection('students').doc(SID);
    function snapshot(){ return [...items.values()].map(it => it.t === 's' ? { id: it.id, t: 's', f: it.f, c: it.c, w: it.w, pj: JSON.stringify(it.p) }
      : it.t === 'x' ? { id: it.id, t: 'x', x: it.x, y: it.y, h: it.h || '', s: it.s || 26, col: it.col || null }
      : { id: it.id, t: 'i', x: it.x, y: it.y, w: it.w, b: it.b, bs: it.bs || API.sheetId }); }
    function save(){ if (!T || !SID || !loaded) return; clearTimeout(saveT); saveT = setTimeout(() => {
      const data = { at: Date.now(), sheet: API.sheetId, H, items: snapshot() };
      if (JSON.stringify(data).length > 900000) { say('Доска переполнена: очисти старые записи 🗑', 5000); return; }
      stuRef().update({ wb: data }).catch(e => console.warn('wb save', e)); }, 1500); }
    async function restore(){
      if (!T || !SID) { loaded = true; return; }
      if (seen) { loaded = true; save(); return; }
      try { const s = await stuRef().get(); const wb = s.exists && s.data().wb;
        if (wb && wb.items && wb.items.length && !seen) {
          const its = wb.items.map(z => Object.assign({}, z));
          local({ op: 'load', items: its, H: wb.H || 1400 });
          for (const z of its) if (z.t === 'i' && z.bs && z.bs !== API.sheetId) {
            try { const o = await API.base.parent.doc(z.bs).collection('blobs').doc(z.b).get();
              if (o.exists) { await API.base.collection('blobs').doc(z.b).set(o.data()); const it = items.get(z.id); if (it) it.bs = API.sheetId; } } catch (e) {} }
          btn.classList.add('ping'); say('На доске записи с прошлого урока', 3000);
        } } catch (e) { console.warn('wb restore', e); }
      loaded = true; save(); }
    function drop(id){ const it = items.get(id); if (!it) return; if (it.el) it.el.remove(); items.delete(id); if (sel === it) sel = null; }

    /* приём событий (и при перезагрузке страницы) */
    function apply(ev, replay){
      if (ev.op !== 'open') seen = true;
      if (ev.op === 'load') { [...items.keys()].forEach(drop); H = Math.max(1400, ev.H || 1400); (ev.items || []).forEach(z => { const it = Object.assign({}, z); if (it.pj) { try { it.p = JSON.parse(it.pj); } catch (e) { it.p = []; } delete it.pj; } items.set(it.id, it); draw(it); }); fit(); if (!T) btn.hidden = false; }
      else if (ev.op === 'add') { const it = Object.assign({}, ev.it); if (it.pj) { try { it.p = JSON.parse(it.pj); } catch (e) { it.p = []; } delete it.pj; } drop(it.id); items.set(it.id, it); draw(it); if (!replay && !open && !T) btn.hidden = false; }
      else if (ev.op === 'upd') { const it = items.get(ev.id); if (it) { Object.assign(it, ev.v); draw(it); } }
      else if (ev.op === 'del') drop(ev.id);
      else if (ev.op === 'clr') { [...items.keys()].forEach(drop); H = 1400; fit(); }
      if (ev.op !== 'open' && !replay) save();
      if (ev.op === 'open') { if (!T) { btn.hidden = false; setOpen(!!ev.v); if (ev.v && !replay) say('Учитель открыл доску'); if (!ev.v && !replay) btn.classList.add('ping'); } }
    }
    function local(op){ apply(op, false); emit(op); }

    function setOpen(v){ open = v; box.hidden = !v; document.documentElement.classList.toggle('wb-on', v); if (v) { fit(); setTool(tool); } }
    btn.onclick = () => { btn.classList.remove('ping'); setOpen(true); if (T) emit({ op: 'open', v: true }); };

    function setTool(t){ tool = t; box.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t)); pg.classList.toggle('hand', t === 'hand'); pg.style.cursor = t === 'text' ? 'text' : t === 'hand' ? 'grab' : 'crosshair'; }
    function setColor(c){ color = c; box.querySelectorAll('[data-c]').forEach(b => b.classList.toggle('on', b.dataset.c === c)); if (tool === 'er' || tool === 'hand') setTool('pen'); }
    setColor(color); setTool(T ? 'text' : 'pen');

    let clrArm = 0;
    box.querySelector('.wb-top').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.t) { setTool(b.dataset.t); if (b.dataset.t === 'text') say('Нажми на доску в нужном месте и пиши'); return; }
      if (b.dataset.c) { setColor(b.dataset.c); if (tool === 'text' && sel && sel.t === 'x') local({ op: 'upd', id: sel.id, v: { col: b.dataset.c } }); return; }
      const a = b.dataset.a;
      if (a === 'close') { setOpen(false); if (T) emit({ op: 'open', v: false }); }
      else if (a === 'undo') { while (mine.length && !items.has(mine[mine.length - 1])) mine.pop(); const id = mine.pop(); if (id) local({ op: 'del', id }); }
      else if (a === 'clr') { if (Date.now() - clrArm < 3000) { local({ op: 'clr' }); mine = []; b.classList.remove('warn'); clrArm = 0; } else { clrArm = Date.now(); b.classList.add('warn'); say('Нажми 🗑 ещё раз, чтобы очистить доску у обоих', 3000); setTimeout(() => b.classList.remove('warn'), 3000); } }
      else if (a === 'img') box.querySelector('input[type=file]').click();
      else if ((a === 'sz+' || a === 'sz-')) { if (!sel || sel.t !== 'x') { say('Сначала нажми на текст на доске'); return; } const s = Math.max(16, Math.min(60, (sel.s || 26) + (a === 'sz+' ? 4 : -4))); local({ op: 'upd', id: sel.id, v: { s } }); }
    });
    box.querySelector('.wb-more').onclick = () => { H += 600; fit(); sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); };

    const pt = e => { const r = pg.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / k * 10) / 10, Math.round((e.clientY - r.top) / k * 10) / 10]; };
    function select(it){ if (sel && sel.el) sel.el.classList.remove('sel'); sel = it; if (it && it.el) it.el.classList.add('sel'); }

    /* текст */
    function bindText(it, tx){ let tm;
      tx.addEventListener('focus', () => select(it));
      tx.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { it.h = tx.innerText; emit({ op: 'upd', id: it.id, v: { h: it.h } }); }, 450); });
      tx.addEventListener('blur', () => { clearTimeout(tm); const h = tx.innerText.replace(/\s+$/, ''); if (!h.trim()) { local({ op: 'del', id: it.id }); return; } if (h !== it.h) { it.h = h; emit({ op: 'upd', id: it.id, v: { h } }); } });
      tx.addEventListener('paste', e => { const f = [...(e.clipboardData || {}).items || []].find(x => x.type.startsWith('image/')); if (f) return; e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); });
      tx.addEventListener('keydown', e => { if (e.key === 'Escape') tx.blur(); e.stopPropagation(); });
    }
    function addText(p){ const it = { id: rid(), t: 'x', x: Math.max(4, Math.min(W - 120, p[0])), y: Math.max(0, p[1] - 18), h: '', s: 26, col: color === '#22201c' ? null : color }; mine.push(it.id); items.set(it.id, it); draw(it); emit({ op: 'add', it: Object.assign({}, it, { el: undefined }) }); const tx = it.el.firstChild; tx.focus(); select(it); }

    /* ручки «перетащить», «удалить», «размер» */
    function bindHandles(it, el){
      el.querySelector('.del').addEventListener('click', e => { e.stopPropagation(); local({ op: 'del', id: it.id }); });
      const drag = (h, onMove, onEnd) => h.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); select(it); h.setPointerCapture(e.pointerId); const s = pt(e), o = { x: it.x, y: it.y, w: it.w };
        const mv = ev => { const p = pt(ev); onMove(p[0] - s[0], p[1] - s[1], o); draw(it); };
        const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); onEnd(); };
        h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); });
      drag(el.querySelector('.mv'), (dx, dy, o) => { it.x = Math.max(0, Math.min(W - 60, o.x + dx)); it.y = Math.max(0, o.y + dy); }, () => emit({ op: 'upd', id: it.id, v: { x: it.x, y: it.y } }));
      const rs = el.querySelector('.rs'); if (rs) drag(rs, (dx, dy, o) => { it.w = Math.max(80, Math.min(W - it.x, o.w + dx)); }, () => emit({ op: 'upd', id: it.id, v: { w: it.w } }));
    }

    /* картинки: кнопка или Ctrl+V */
    async function addImage(file, p){
      const up = window.claude && (await window.claude.use('assets')); if (!up) return;
      say('Загружаю картинку…', 8000);
      try { const r = await up.upload(file); const im = new Image(); im.src = r.url; await im.decode().catch(() => {});
        const w = Math.min(W - 80, Math.max(160, Math.round((im.naturalWidth || 600) / 1.4)));
        const y = p ? p[1] : Math.max(20, ...[...items.values()].map(z => z.t === 's' ? 0 : z.y + (z.el ? z.el.getBoundingClientRect().height / k : 60) + 20));
        const it = { id: rid(), t: 'i', x: p ? Math.min(p[0], W - w) : 40, y, w, b: r.id }; mine.push(it.id);
        items.set(it.id, Object.assign({}, it, { src: r.url })); draw(items.get(it.id)); emit({ op: 'add', it }); say('Картинка на доске', 1500);
        sc.scrollTo({ top: Math.max(0, y * k - 80), behavior: 'smooth' }); }
      catch (e) { say('Картинка не загрузилась', 3000); }
    }
    if (T) {
      const fi = box.querySelector('input[type=file]'); fi.onchange = () => { [...fi.files].forEach(f => addImage(f)); fi.value = ''; };
      document.addEventListener('paste', e => { if (!open) return; const f = [...((e.clipboardData || {}).items || [])].find(x => x.type.startsWith('image/')); if (f) { e.preventDefault(); addImage(f.getAsFile()); } });
    }

    /* рисование */
    let cur = null;
    const near = (it, p) => it.p.some((q, i) => { const a = it.p[i - 1] || q; const dx = q[0] - a[0], dy = q[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1]; return x * x + y * y < Math.pow(it.w / 2 + 8, 2); });
    function erase(p){ for (const it of [...items.values()].reverse()) if (it.t === 's' && near(it, p)) { local({ op: 'del', id: it.id }); return; } }
    pg.addEventListener('pointerdown', e => {
      if (e.button > 0 || tool === 'hand') return; if (e.target.closest('.wb-it') && (tool === 'text' || e.target.closest('.wb-h'))) return;
      const p = pt(e);
      if (tool === 'text') { if (!T) return; e.preventDefault(); select(null); addText(p); return; }
      e.preventDefault(); pg.setPointerCapture(e.pointerId); select(null); if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      if (tool === 'er') { cur = { er: true }; erase(p); return; }
      const it = { id: rid(), t: 's', f: tool === 'hl' ? 'hl' : tool === 'line' ? 'line' : 'pen', c: tool === 'hl' ? (color === '#22201c' ? '#ffd400' : color) : color, w: tool === 'hl' ? 24 : 4, p: [p] };
      items.set(it.id, it); draw(it); cur = it;
    });
    pg.addEventListener('pointermove', e => {
      if (!cur) return; const p = pt(e);
      if (cur.er) { erase(p); return; }
      if (cur.f === 'line') { cur.p = [cur.p[0], [p[0], Math.abs(p[1] - cur.p[0][1]) < 14 ? cur.p[0][1] : p[1]]]; }
      else { const l = cur.p[cur.p.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) < 1.5) return; cur.p.push(p); }
      draw(cur);
    });
    const end = () => { if (!cur) return; const it = cur; cur = null; if (it.er) return; mine.push(it.id);
      emit({ op: 'add', it: { id: it.id, t: 's', f: it.f, c: it.c, w: it.w, pj: JSON.stringify(it.p) } }); };
    pg.addEventListener('pointerup', end); pg.addEventListener('pointercancel', end);
    document.addEventListener('keydown', e => { if (!open) return; if (e.key === 'Escape' && !(document.activeElement && document.activeElement.isContentEditable)) { setOpen(false); if (T) emit({ op: 'open', v: false }); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !(document.activeElement && document.activeElement.isContentEditable)) { e.preventDefault(); box.querySelector('[data-a=undo]').click(); } });
    window.__wb = { apply, afterReady: restore };
  })();

  addEventListener('load', () => setTimeout(() => { API.ready(); if (window.__wb) setTimeout(() => window.__wb.afterReady(), 300); }, 400));
})();
