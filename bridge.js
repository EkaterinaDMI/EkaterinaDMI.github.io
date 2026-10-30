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
  const SKIP = '.hwleft,.hwph,#dictShow,.wck > .qn + .inline .btn.ghost,#dwBar,.dw-tb,#dwCanvas,.rv-tab,.rv-panel,#showErr,#errpanel,#finRep,#finErr,#hwSave,#hwCopy,#copyHw,.hwd summary,nav.chips,.ui-add,.ui-zoom,.ui-zoombtn,#stuName,textarea[id^="uicap-"],textarea[id^="uinote-"]';
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
      else if (ev.k === 'goto' && !replay) { const el = byPath(ev.p); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    } catch (err) { console.warn('sync', err); }
  }
  function anchor(){ for (const f of [0.3, 0.45, 0.2, 0.6]) { const el = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight * f)); const a = el && !el.closest('nav.chips,#dwBar,.progress') && el.closest('.q,.ex,.nb,.theory,.memo,.part-head,.ui-card,.hwc,section.part'); if (a) return pathOf(a); } return null; }
  /* линии рисунка: база не хранит массив внутри массива, поэтому точки уходят строкой */
  const packDraw = ev => { if (ev && ev.k === 'dadd' && ev.s && Array.isArray(ev.s.pts)) { const st = Object.assign({}, ev.s); st.pj = JSON.stringify(st.pts.map(q => [Math.round(q[0] * 1e4) / 1e4, Math.round(q[1] * 1e4) / 1e4])); delete st.pts; return { k: 'dadd', s: st }; } return ev; };
  const unpackDraw = ev => { if (ev && ev.k === 'dadd' && ev.s && ev.s.pj && !ev.s.pts) { const st = Object.assign({}, ev.s); try { st.pts = JSON.parse(st.pj); } catch (e) { st.pts = []; } return { k: 'dadd', s: st }; } return ev; };
  window.__dwSync = { path: pathOf, byPath, emit: ev => send(packDraw(ev)) };
  window.__sync = {
    apply, anchor,
    section: p => { const el = byPath(p); const sec = el && el.closest('section.part'); const h = sec && sec.querySelector('h2'); return h ? h.textContent.trim() : ''; },
    scrollTo: p => { const el = byPath(p); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  };

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
    function mode(){ document.documentElement.classList.toggle('hw-mode', finished); paint(); }
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
  css.textContent = `.hwph{margin-top:16px;display:grid;gap:10px;padding:16px;border:2px dashed var(--accent,#2e8b57);border-radius:16px;background:var(--surface,#fff)}.hwph-h{display:grid;gap:2px}.hwph-h span,.hwph-msg,.hwph-empty{color:var(--muted,#666);font-size:.92rem}.hwph-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.hwph-add{font:inherit;font-weight:600;border:none;border-radius:12px;padding:12px 18px;background:var(--accent,#2e8b57);color:#fff;cursor:pointer}.hwph-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.hwph-card{margin:0;display:grid;gap:4px}.hwph-card img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:10px;border:1px solid var(--line,#ddd);cursor:zoom-in}.hwph-card figcaption{font-size:.8rem;color:var(--muted,#666)}.hwph-card button{font:inherit;font-size:.8rem;border:1px solid var(--line,#ddd);background:transparent;border-radius:8px;padding:3px 8px;cursor:pointer}.hwleft{margin-top:16px;display:grid;gap:8px;padding:16px;border:2px solid #f2a900;border-radius:16px;background:#fff8e1}.hwleft[hidden]{display:none!important}.hwleft-sub{color:var(--muted,#666);font-size:.92rem}.hwleft-list{display:flex;flex-wrap:wrap;gap:8px}.hwleft-it{font:inherit;font-size:.9rem;border:1.5px solid #f2a900;background:#fff;border-radius:10px;padding:6px 12px;cursor:pointer}.hw-x{position:absolute;top:6px;right:40px;z-index:3;height:28px;border-radius:999px;border:1px solid #f2a900;background:#fff;color:#8a6100;font:700 .78rem/1 sans-serif;padding:0 10px;cursor:pointer;opacity:.7}.hw-x:hover{opacity:1}section.part>.hw-x{top:40px}.to-hw>.hw-x{opacity:1;background:#f2a900;color:#222}.st-mode .hw-x{display:none!important}.tc-mode .to-hw{outline:3px dashed #f2a900;outline-offset:6px;border-radius:12px}.st-mode:not(.hw-mode) .to-hw{display:none!important}.st-mode.hw-mode .to-hw{outline:3px solid #f2a900;outline-offset:6px;border-radius:12px}.st-mode.hw-mode .to-hw::before,.tc-mode .to-hw::before{content:'Домашнее задание';display:inline-block;justify-self:start;font:700 .72rem/1 sans-serif;letter-spacing:.05em;text-transform:uppercase;background:#f2a900;color:#222;padding:5px 9px;border-radius:999px;margin-bottom:6px}.hw-task-old{content:'Домашнее задание';display:inline-block;justify-self:start;font:700 .72rem/1 sans-serif;letter-spacing:.05em;text-transform:uppercase;background:#f2a900;color:#222;padding:5px 9px;border-radius:999px;margin-bottom:6px}.hwdone{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding-top:6px;border-top:1px dashed var(--line,#ddd)}.hwdone-btn{font:inherit;font-weight:700;border:none;border-radius:12px;padding:12px 18px;background:#f2a900;color:#222;cursor:pointer}.hwdone-st{font-weight:600}.hwph-zoom{position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.85);display:grid;place-items:center;cursor:zoom-out}.hwph-zoom img{max-width:96vw;max-height:94vh}
.st-mode .dict-veil{font-size:0!important;user-select:none}.st-mode .dict-veil *{font-size:0!important}.st-mode .dict-veil br{display:none}.st-mode .dict-veil::before{content:'Текст диктует учитель. Он откроется после проверки.';font-size:.95rem;font-style:italic;font-weight:400;color:var(--muted,#777)}
.st-mode .tk-hidden{display:none!important}.st-mode nav.chips a.tk-off{display:none}
.st-mode .tk-x,.st-mode .rv-tab,.st-mode .rv-panel,.st-mode .ui-add,.st-mode .ui-del,.st-mode #dictShow,.st-mode #dictDone,.st-mode .dlist input,.st-mode .dlist .dmark,.st-mode .wck .inline,.st-mode .nbq .opts,.st-mode .tchk,.st-mode .ui-card .opts,.st-mode .ui-card textarea,.st-mode #finBtn,.st-mode #redo,.st-mode #saveMsg,.st-mode .hw-head p,.st-mode #hwSave,.st-mode #hwCopy,.st-mode .hwd{display:none!important}`;
  document.head.appendChild(css);
  addEventListener('load', () => setTimeout(() => API.ready(), 400));
})();
