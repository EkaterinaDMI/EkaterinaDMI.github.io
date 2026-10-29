/* Общее для страниц сайта: уровни, достижения, подсчёт прогресса ученика */
window.KIT = (function(){
  const LEVELS = [
    { min: 0,    name: 'Новичок',      ic: '🌱' },
    { min: 50,   name: 'Ученик',       ic: '📘' },
    { min: 150,  name: 'Знаток',       ic: '🔍' },
    { min: 300,  name: 'Грамотей',     ic: '✒️' },
    { min: 500,  name: 'Мастер слова', ic: '🎓' },
    { min: 800,  name: 'Профессор',    ic: '🧠' },
    { min: 1200, name: 'Легенда',      ic: '👑' }
  ];
  function level(points){
    let i = 0; LEVELS.forEach((l, k) => { if (points >= l.min) i = k; });
    const cur = LEVELS[i], next = LEVELS[i + 1] || null;
    const pct = next ? Math.round((points - cur.min) / (next.min - cur.min) * 100) : 100;
    return { n: i + 1, name: cur.name, ic: cur.ic, next, pct, toNext: next ? next.min - points : 0 };
  }
  const ACH = [
    { id: 'first',   ic: '🚀', t: 'Первый урок',        d: 'Пройди первый урок',            ok: s => s.lessons >= 1 },
    { id: 'five',    ic: '🖐', t: 'Пять уроков',         d: 'Пройди 5 уроков',               ok: s => s.lessons >= 5 },
    { id: 'ten',     ic: '🔟', t: 'Десять уроков',       d: 'Пройди 10 уроков',              ok: s => s.lessons >= 10 },
    { id: 'c100',    ic: '💯', t: 'Сто верных',          d: '100 верных ответов',            ok: s => s.correct >= 100 },
    { id: 'c500',    ic: '🏔', t: 'Пятьсот верных',      d: '500 верных ответов',            ok: s => s.correct >= 500 },
    { id: 'perfect', ic: '💎', t: 'Безупречный урок',    d: 'Урок без единой ошибки',        ok: s => s.perfect >= 1 },
    { id: 'perf3',   ic: '🏆', t: 'Три безупречных',     d: '3 урока без ошибок',            ok: s => s.perfect >= 3 },
    { id: 'b10',     ic: '🎖', t: 'Коллекционер',        d: 'Собери 10 наград',              ok: s => s.nbadges >= 10 },
    { id: 'b30',     ic: '🌟', t: 'Звёздная коллекция',  d: 'Собери 30 наград',              ok: s => s.nbadges >= 30 },
    { id: 'p90',     ic: '🎯', t: 'Снайпер',             d: 'Урок с точностью от 90%',       ok: s => s.best >= 90 }
  ];
  function lessonPoints(l){ return (l.correct || 0) + (l.badges ? l.badges.length : 0) * 5 + (l.perfect ? 10 : 0); }
  function aggregate(lessons){
    const s = { lessons: 0, solved: 0, correct: 0, points: 0, perfect: 0, nbadges: 0, best: 0, badges: {}, badgeIcons: {}, last: null };
    lessons.forEach(l => {
      s.lessons++; s.solved += l.solved || 0; s.correct += l.correct || 0; s.points += lessonPoints(l);
      if (l.perfect) s.perfect++; if ((l.pct || 0) > s.best && (l.solved || 0) >= 10) s.best = l.pct;
      (l.badges || []).forEach(b => { s.nbadges++; s.badges[b.t] = (s.badges[b.t] || 0) + 1; s.badgeIcons[b.t] = b.ic; });
      if (!s.last || String(l.date) > String(s.last)) s.last = l.date;
    });
    s.accuracy = s.solved ? Math.round(s.correct / s.solved * 100) : 0;
    s.level = level(s.points).n;
    s.achievements = ACH.filter(a => a.ok(s)).map(a => a.id);
    return s;
  }
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function rid(n){ const a = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = ''; crypto.getRandomValues(new Uint32Array(n || 12)).forEach(x => s += a[x % a.length]); return s; }
  const fmtDate = iso => { try { return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }); } catch (e) { return ''; } };
  /* пересчитать карточку ученика по всем его урокам и обновить рейтинг */
  async function recompute(fdb, sid){
    const st = fdb.collection('students').doc(sid);
    const [sd, q] = await Promise.all([st.get(), st.collection('lessons').get()]);
    if (!sd.exists) return null;
    const stu = sd.data();
    const stats = aggregate(q.docs.map(d => d.data()));
    await st.update({ stats });
    if (stu.bid) {
      const b = fdb.collection('board').doc(stu.bid);
      if (stu.inBoard === false) await b.delete().catch(() => {});
      else await b.set({ name: stu.name || '', avatar: stu.avatar || '🙂', points: stats.points, level: stats.level, lessons: stats.lessons, nbadges: stats.nbadges, updatedAt: new Date().toISOString() });
    }
    return stats;
  }
  const AVATARS = ['🦊','🐼','🐯','🦁','🐨','🐸','🐙','🦄','🐲','🦉','🐬','🐝','🐧','🦖','🚀','⚽','🎸','🎨','🌻','⭐'];
  return { LEVELS, level, ACH, aggregate, lessonPoints, esc, rid, fmtDate, recompute, AVATARS };
})();
