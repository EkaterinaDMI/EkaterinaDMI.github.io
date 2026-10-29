import sys
fn=sys.argv[1]
s=open(fn,encoding='utf8').read()
def rep(a,b,n=1):
    global s
    assert s.count(a)==n,(a[:60],s.count(a)); s=s.replace(a,b)
rep("function update(){const all=reg.length,done=reg.filter(i=>i.done).length,ok=reg.filter(i=>i.ok).length;",
    "function vis(i){return !(i.box&&i.box.closest&&i.box.closest('.tk-hidden'));}\nfunction update(){const R=reg.filter(vis);const all=R.length,done=R.filter(i=>i.done).length,ok=R.filter(i=>i.ok).length;")
rep("$('#redo').hidden=!reg.some(i=>i.done&&!i.ok);}","$('#redo').hidden=!R.some(i=>i.done&&!i.ok);}")
rep("const it=reg.filter(i=>!(i.box.closest&&i.box.closest('#hw')));got=","const it=reg.filter(i=>!(i.box.closest&&i.box.closest('#hw'))&&vis(i));got=")
rep("const it=reg.filter(i=>i.box.closest&&i.box.closest(b.sec));got=","const it=reg.filter(i=>i.box.closest&&i.box.closest(b.sec)&&vis(i));got=")
rep("'Решено: '+done.length+' из '+reg.length+', верно: '","'Решено: '+done.length+' из '+reg.filter(vis).length+', верно: '")
rep("function lessonStats(){const it=reg.filter(i=>!(i.box&&i.box.closest&&i.box.closest('#hw'))),d=","function lessonStats(){const it=reg.filter(i=>!(i.box&&i.box.closest&&i.box.closest('#hw'))&&vis(i)),d=")
rep("function lessonItems(){return reg.filter(i=>!(i.box&&i.box.closest&&i.box.closest('#hw')));}","function lessonItems(){return reg.filter(i=>!(i.box&&i.box.closest&&i.box.closest('#hw'))&&vis(i));}")
rep("badges:window.badgesEarned||[],timing:sectionTiming()","badges:window.badgesEarned||[],timing:sectionTiming(),hidden:window.hiddenTasks||[]",2)
css='''<style>
.tk-host{position:relative}
.tk-x{position:absolute;top:6px;right:6px;z-index:3;width:28px;height:28px;border-radius:50%;border:1px solid var(--line);background:var(--surface);color:var(--muted);font:600 1rem/1 var(--f-body);cursor:pointer;display:grid;place-items:center;opacity:.55;padding:0}
.tk-x:hover{opacity:1;color:var(--bad);border-color:var(--bad)}
section.part>.part-head{padding-right:40px}
section.part>.tk-x{top:40px}
.ex.tk-host>.ex-head,.nb.tk-host>.label{padding-right:34px}
.tk-bar{display:none}
.tk-hidden>*:not(.tk-bar){display:none!important}
.tk-hidden{gap:0!important;padding:0!important;border:none!important;background:none!important}
.tk-hidden>.tk-bar{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:8px 12px;border:1.5px dashed var(--line);border-radius:12px;color:var(--muted);font-size:.88rem;background:var(--surface)}
section.part.tk-hidden{padding-top:14px}
.tk-bar button{font:inherit;font-size:.82rem;font-weight:600;border:1.5px solid var(--accent);color:var(--accent);background:transparent;border-radius:8px;padding:3px 10px;cursor:pointer}
nav.chips a.tk-off{opacity:.45;text-decoration:line-through}
</style>
'''
rep('<div class="wrap">',css+'<div class="wrap">')
js=r'''
/* Скрыть задание на сегодня: крестик у каждого раздела и задания */
(function(){
  const KEY='tkHidden:'+document.title;let st={};
  try{st=JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch(e){}
  const targets=[...document.querySelectorAll('section.part:not(#hw):not(#errpanel), section.part .ex, section.part .nb')];
  const names={};
  function label(t){
    if(t.matches('section.part')){const h=t.querySelector('h2');return 'Раздел: '+(h?h.textContent.trim():t.id);}
    const tag=t.querySelector('.ex-head .tag,.nb-l');return tag?tag.textContent.trim():'Задание';}
  function sync(){
    window.hiddenTasks=targets.filter(t=>t.classList.contains('tk-hidden')).map(t=>names[t.dataset.tk]);
    document.querySelectorAll('nav.chips a').forEach(a=>{const sec=document.querySelector(a.getAttribute('href'));a.classList.toggle('tk-off',!!(sec&&sec.classList.contains('tk-hidden')));});
    try{localStorage.setItem(KEY,JSON.stringify(st));}catch(e){}
    update();}
  targets.forEach((t,k)=>{
    const key=t.id||((t.closest('section.part')||{}).id+'-'+k);t.dataset.tk=key;names[key]=label(t);
    t.classList.add('tk-host');
    const x=el('button','tk-x','×');x.type='button';x.title='Скрыть на сегодня';x.setAttribute('aria-label','Скрыть: '+names[key]);
    const bar=el('div','tk-bar','<span>Скрыто: '+names[key]+'</span>');const back=el('button','','Вернуть');back.type='button';bar.appendChild(back);
    t.prepend(bar);t.appendChild(x);
    const set=v=>{t.classList.toggle('tk-hidden',v);if(v)st[key]=1;else delete st[key];};
    x.addEventListener('click',()=>{set(true);sync();});
    back.addEventListener('click',()=>{set(false);sync();});
    if(st[key])set(true);
  });
  sync();
})();
update();
'''
rep("\nupdate();\n",js,1)
open(fn,'w',encoding='utf8').write(s);print('ok')
