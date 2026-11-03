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
  const SKIP = '.gate-btn,.vtabs,.hwleft,.hwph,#dictShow,.wck > .qn + .inline .btn.ghost,#dwBar,.dw-tb,#dwCanvas,.rv-tab,.rv-panel,#showErr,#errpanel,#finRep,#finErr,#hwSave,#hwCopy,#copyHw,.hwd summary,nav.chips,.ui-add,.ui-zoom,.ui-zoombtn,#stuName,textarea[id^="uicap-"],textarea[id^="uinote-"]';
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
      else if (ev.k === 'dadd' || ev.k === 'drem' || ev.k === 'dclr') { if (window.__dwHook) window.__dwHook.apply(unpackDraw(ev)); }
      else if (ev.k === 'open') { const el = byPath(ev.p); if (el) { el.classList.toggle('st-open', !!ev.v); gateUpdate(); if (!T && !replay && ev.v) setTimeout(() => { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); flashCall(el); }, 80); } }
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
  const st = document.createElement('style'); st.textContent = '.peer-here{position:relative;outline:3px solid #ff6a00!important;outline-offset:4px;border-radius:12px}.peer-here::before{content:attr(data-peer);position:absolute;top:-13px;right:10px;z-index:6;background:#ff6a00;color:#fff;font:700 12px/1.6 system-ui,sans-serif;padding:1px 10px;border-radius:999px;white-space:nowrap;pointer-events:none}.call-here{position:relative;animation:callPulse 1s ease-in-out 4;outline:4px solid #2f80ed!important;outline-offset:4px;border-radius:12px}.call-here::after{content:"Учитель зовёт сюда";position:absolute;top:-14px;left:10px;z-index:6;background:#2f80ed;color:#fff;font:700 13px/1.6 system-ui,sans-serif;padding:2px 12px;border-radius:999px;pointer-events:none}@keyframes callPulse{50%{outline-color:#9cc3ff}}.call-btn{position:fixed;z-index:80;display:none;font:600 13px system-ui,sans-serif;border:none;border-radius:999px;padding:6px 12px;background:#2f80ed;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer}.call-btn.sent{background:#1f9d55}.call-pick{outline:2px dashed #2f80ed!important;outline-offset:4px;border-radius:12px}';
  document.documentElement.appendChild(st);
  let callT = null;
  function flashCall(el){ document.querySelectorAll('.call-here').forEach(x => x.classList.remove('call-here')); el.classList.add('call-here'); clearTimeout(callT); callT = setTimeout(() => el.classList.remove('call-here'), 6000); }
  let peerEl = null;
  function markPeer(p, label){ if (peerEl) { peerEl.classList.remove('peer-here'); peerEl.removeAttribute('data-peer'); peerEl = null; } const el = p != null ? byPath(p) : null; if (el) { peerEl = el; el.classList.add('peer-here'); el.setAttribute('data-peer', label || 'Ученик здесь'); } }
  function describe(p){ const el = byPath(p); if (!el) return ''; const sec = el.closest('section.part'); const h = sec && sec.querySelector('h2'); let s = h ? h.textContent.trim() : ''; if (sec) { const qs = Array.prototype.filter.call(sec.querySelectorAll('.q,.nb'), x => !x.closest('.tk-hidden')); const q = el.closest('.q,.nb'); const i = q ? qs.indexOf(q) : -1; if (i >= 0 && qs.length > 1) s += ' · задание ' + (i + 1) + ' из ' + qs.length; } return s; }
  /* Пошаговый урок: ученик видит только те шаги, которые открыл учитель */
  const gst = document.createElement('style'); gst.textContent = '.gate-btn{order:-1;justify-self:start;font:700 14px/1 system-ui,sans-serif;border:2px solid #1f9d55;color:#1f9d55;background:#fff;border-radius:999px;padding:9px 16px;cursor:pointer}.st-open>.gate-btn{background:#1f9d55;color:#fff}.st-mode .gate-btn{display:none!important}.tc-mode section.part.st-open{box-shadow:-10px 0 0 -4px #1f9d55}html.st-mode:not(.hw-mode) section.part:not(.st-open):not(#errpanel){display:none!important}.gate-wait{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);z-index:30;display:none;max-width:min(420px,90vw);text-align:center;background:#fff;color:#222;border-radius:20px;padding:26px 24px;box-shadow:0 10px 40px rgba(0,0,0,.18);font:600 18px/1.4 system-ui,sans-serif}.gate-wait span{display:block;font-size:44px;margin-bottom:8px}.st-mode .wck,.st-mode .nbmark,.st-mode #ex-dict,.st-mode #dictHint,.st-mode #dictRes,.st-mode .dict-veil,.st-mode .t-st-hide{display:none!important}';
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
    if (!T) document.querySelectorAll('.qn').forEach(q => { if (!/^Проверка учителя/.test(q.textContent.trim())) return; q.classList.add('t-st-hide'); const n = q.nextElementSibling; if (n && n.classList.contains('opts')) n.classList.add('t-st-hide'); });
  });
  new MutationObserver(gateUpdate).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  /* учитель: кнопка «Позвать сюда» у задания под мышкой */
  if (T) addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'call-btn'; b.textContent = '📍 Позвать сюда'; document.documentElement.appendChild(b);
    let cur = null, hideT = null;
    const place = el => { const r = el.getBoundingClientRect(); b.style.display = 'block'; b.style.top = Math.max(4, r.top + 6) + 'px'; b.style.left = Math.min(innerWidth - b.offsetWidth - 8, r.right - b.offsetWidth - 40) + 'px'; };
    document.addEventListener('mousemove', e => { if (e.target === b) return; const t = e.target instanceof Element ? e.target.closest('.q,.nb,.wck,.ui-card,.part-head') : null;
      if (t && !t.closest('#dwBar,.progress,nav.chips,.tk-hidden')) { clearTimeout(hideT); if (cur !== t) { if (cur) cur.classList.remove('call-pick'); cur = t; b.classList.remove('sent'); b.textContent = '📍 Позвать сюда'; } place(t); }
      else { clearTimeout(hideT); hideT = setTimeout(() => { b.style.display = 'none'; if (cur) cur.classList.remove('call-pick'); cur = null; }, 700); } }, { passive: true });
    b.addEventListener('mouseenter', () => { clearTimeout(hideT); if (cur) cur.classList.add('call-pick'); });
    b.addEventListener('mouseleave', () => { if (cur) cur.classList.remove('call-pick'); });
    b.addEventListener('click', e => { e.stopPropagation(); if (!cur) return; const p = pathOf(cur); if (p == null) return; send({ k: 'goto', p }); b.classList.add('sent'); b.textContent = '✓ Позвала'; });
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
  /* Фото домашней работы: ученик прикрепляет, учитель видит сразу */
  addEventListener('load', () => {
    const hw = document.getElementById('hw'); if (!hw || hw.querySelector('.hwph')) return;
    const box = document.createElement('div'); box.className = 'hwph';
    box.innerHTML = '<div class="hwph-h"><b>Фото домашней работы</b><span>' + (T ? 'Здесь появятся фото, которые пришлёт ученик.' : 'Сделай фото тетради и прикрепи сюда. Учитель увидит его сразу.') + '</span></div>' +
      (T ? '' : '<div class="hwph-row"><button type="button" class="hwph-add">📷 Прикрепить фото</button><input type="file" accept="image/*" multiple hidden><span class="hwph-msg"></span></div>') + '<div class="hwph-list"></div>' + '<div class="hwdone">' + (T ? '' : '<button type="button" class="hwdone-btn">✅ Я выполнил(а) домашнее задание</button>') + '<span class="hwdone-st"></span></div>';
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
      inp.onchange = async () => { const fs = [...inp.files]; inp.value = ''; let ok = 0;
        for (const f of fs) { msg('Загружаю ' + (ok + 1) + ' из ' + fs.length + '…');
          try { const d = await shrink(f); await ref.add(clean({ d, at: Date.now(), name: f.name || '' })); ok++; }
          catch (e) { msg(e && e.code === 'unsupported_type' ? 'Этот формат не открывается. Сделай скриншот фото и прикрепи его.' : 'Не получилось загрузить: ' + ((e && e.message) || e)); return; } }
        msg(ok ? 'Готово! Фото отправлено: ' + ok + '.' : ''); }; }
    const zoom = d => { const o = document.createElement('div'); o.className = 'hwph-zoom'; o.innerHTML = '<img alt="Фото домашней работы">'; o.firstChild.src = d; o.onclick = () => o.remove(); document.body.appendChild(o); };
    ref.onSnapshot(q => { list.innerHTML = '';
      q.docs.map(x => ({ id: x.id, v: x.data() })).sort((a, b) => (a.v.at || 0) - (b.v.at || 0)).forEach(({ id, v }) => {
        const c = document.createElement('figure'); c.className = 'hwph-card';
        const im = document.createElement('img'); im.src = v.d; im.alt = 'Фото домашней работы'; im.onclick = () => zoom(v.d);
        const cap = document.createElement('figcaption'); cap.textContent = v.at ? new Date(v.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
        c.append(im, cap);
        if (T) { const del = document.createElement('button'); del.type = 'button'; del.textContent = 'Удалить'; del.onclick = () => { if (confirm('Удалить это фото?')) ref.doc(id).delete(); }; c.appendChild(del); }
        list.appendChild(c); });
      if (!q.docs.length && T) list.innerHTML = '<span class="hwph-empty">Пока фото нет.</span>'; }, () => {});
  });
  const css = document.createElement('style');
  css.textContent = `.hwph{margin-top:16px;display:grid;gap:10px;padding:16px;border:2px dashed var(--accent,#2e8b57);border-radius:16px;background:var(--surface,#fff)}.hwph-h{display:grid;gap:2px}.hwph-h span,.hwph-msg,.hwph-empty{color:var(--muted,#666);font-size:.92rem}.hwph-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.hwph-add{font:inherit;font-weight:600;border:none;border-radius:12px;padding:12px 18px;background:var(--accent,#2e8b57);color:#fff;cursor:pointer}.hwph-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.hwph-card{margin:0;display:grid;gap:4px}.hwph-card img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:10px;border:1px solid var(--line,#ddd);cursor:zoom-in}.hwph-card figcaption{font-size:.8rem;color:var(--muted,#666)}.hwph-card button{font:inherit;font-size:.8rem;border:1px solid var(--line,#ddd);background:transparent;border-radius:8px;padding:3px 8px;cursor:pointer}.hwleft{margin-top:16px;display:grid;gap:8px;padding:16px;border:2px solid #f2a900;border-radius:16px;background:#fff8e1}.hwleft[hidden]{display:none!important}.hwleft-sub{color:var(--muted,#666);font-size:.92rem}.hwleft-list{display:flex;flex-wrap:wrap;gap:8px}.hwleft-it{font:inherit;font-size:.9rem;border:1.5px solid #f2a900;background:#fff;border-radius:10px;padding:6px 12px;cursor:pointer}.hw-x{position:absolute;top:6px;right:40px;z-index:3;height:28px;border-radius:999px;border:1px solid #f2a900;background:#fff;color:#8a6100;font:700 .78rem/1 sans-serif;padding:0 10px;cursor:pointer;opacity:.7}.hw-x:hover{opacity:1}section.part>.hw-x{top:40px}.to-hw>.hw-x{opacity:1;background:#f2a900;color:#222}.st-mode .hw-x{display:none!important}.tc-mode .to-hw{outline:3px dashed #f2a900;outline-offset:6px;border-radius:12px}.st-mode:not(.hw-mode) .to-hw{display:none!important}.st-mode.hw-mode .to-hw{outline:3px solid #f2a900;outline-offset:6px;border-radius:12px}.st-mode.hw-mode .to-hw::before,.tc-mode .to-hw::before{content:'Домашнее задание';display:inline-block;justify-self:start;font:700 .72rem/1 sans-serif;letter-spacing:.05em;text-transform:uppercase;background:#f2a900;color:#222;padding:5px 9px;border-radius:999px;margin-bottom:6px}.hw-task-old{content:'Домашнее задание';display:inline-block;justify-self:start;font:700 .72rem/1 sans-serif;letter-spacing:.05em;text-transform:uppercase;background:#f2a900;color:#222;padding:5px 9px;border-radius:999px;margin-bottom:6px}.vtabs{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:45;display:flex;gap:4px;padding:4px;border-radius:999px;background:var(--surface,#fff);box-shadow:0 4px 18px rgba(0,0,0,.18)}.vtabs[hidden]{display:none!important}.vtabs button{font:inherit;font-weight:700;font-size:.9rem;border:none;border-radius:999px;padding:8px 16px;background:transparent;color:var(--ink,#222);cursor:pointer}.vtabs button{white-space:nowrap}@media (max-width:480px){.vtabs button{font-size:.82rem;padding:8px 12px}}.vtabs button[aria-pressed=true]{background:#f2a900;color:#222}.view-hw header.top,.view-hw nav.chips,.view-hw .badges,.view-hw .stubar,.view-hw .rv-tab,.view-hw .tree-card,.view-hw .hwleft{display:none!important}.view-hw section.part:not(#hw):not(.to-hw):not(:has(.to-hw)){display:none!important}.view-hw section.part:not(.to-hw):has(.to-hw)>*:not(.to-hw):not(.part-head){display:none!important}.view-hw #dwCanvas,.view-hw .dw-canvas,.view-hw #dwBar,.view-hw .dw-bar{display:none!important}.view-hw .wrap{padding-top:56px}.view-hw #hw{order:99}.st-mode.view-hw.hw-mode .to-hw{display:grid!important}html:not(.view-hw).st-mode .to-hw{display:none!important}.hwdone{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding-top:6px;border-top:1px dashed var(--line,#ddd)}.hwdone-btn{font:inherit;font-weight:700;border:none;border-radius:12px;padding:12px 18px;background:#f2a900;color:#222;cursor:pointer}.hwdone-st{font-weight:600}.hwph-zoom{position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.85);display:grid;place-items:center;cursor:zoom-out}.hwph-zoom img{max-width:96vw;max-height:94vh}
.st-mode .dict-veil{font-size:0!important;user-select:none}.st-mode .dict-veil *{font-size:0!important}.st-mode .dict-veil br{display:none}.st-mode .dict-veil::before{content:'Текст диктует учитель. Он откроется после проверки.';font-size:.95rem;font-style:italic;font-weight:400;color:var(--muted,#777)}
.st-mode .tk-hidden{display:none!important}.st-mode nav.chips a.tk-off{display:none}
.st-mode .tk-x,.st-mode .rv-tab,.st-mode .rv-panel,.st-mode .ui-add,.st-mode .ui-del,.st-mode #dictShow,.st-mode #dictDone,.st-mode .dlist input,.st-mode .dlist .dmark,.st-mode .wck .inline,.st-mode .nbq .opts,.st-mode .tchk,.st-mode .ui-card .opts,.st-mode .ui-card textarea,.st-mode #finBtn,.st-mode #redo,.st-mode #saveMsg,.st-mode .hw-head p,.st-mode #hwSave,.st-mode #hwCopy,.st-mode .hwd{display:none!important}`;
  document.head.appendChild(css);
  addEventListener('load', () => setTimeout(() => API.ready(), 400));
})();
