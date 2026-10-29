"""Патч для любого рабочего листа: учитель добавляет в разделы свои картинки с заданиями.
Картинки хранятся в assets, записи в db (коллекция teacherimgs)."""
import sys
fn=sys.argv[1]
s=open(fn,encoding='utf8').read()
def rep(a,b,n=1):
    global s
    assert s.count(a)==n,(a[:60],s.count(a)); s=s.replace(a,b)
css='''<style>
.ui-box{display:grid;gap:12px}
.ui-box[hidden]{display:none!important}
.ui-list{display:grid;gap:12px}
.ui-list:empty{display:none}
.ui-add{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 12px;border:1.5px dashed var(--line);border-radius:12px;color:var(--muted);font-size:.86rem;background:transparent;cursor:pointer}
.ui-add:focus-visible,.ui-add.armed{outline:none;border-color:var(--accent);background:var(--accent-soft);color:var(--ink)}
.ui-add.over{border-color:var(--accent);background:var(--accent-soft)}
.ui-add .btn{min-height:34px;padding:5px 12px;font-size:.84rem}
.ui-card{display:grid;gap:10px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px}
.ui-card .label{color:var(--accent)}
.ui-card img{display:block;width:100%;max-width:100%;height:auto;border-radius:10px;border:1px solid var(--line);background:var(--bg)}
.ui-card textarea{min-height:42px;font-size:.95rem}
.ui-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ui-del{font:inherit;font-size:.8rem;border:1px solid var(--line);background:var(--bg);color:var(--muted);border-radius:8px;padding:4px 10px;cursor:pointer}
.ui-del.warn{border-color:var(--bad);color:var(--bad)}
.ui-msg{font-size:.82rem;color:var(--muted)}
.ui-zoom{position:fixed;inset:0;z-index:22;background:var(--bg);display:grid;place-items:center;padding:calc(env(safe-area-inset-top,0px) + 56px) max(16px,env(safe-area-inset-right,0px)) calc(env(safe-area-inset-bottom,0px) + 60px) max(16px,env(safe-area-inset-left,0px))}
.ui-zoom[hidden]{display:none!important}
.ui-zoom img{max-width:100%;max-height:100%;object-fit:contain;border-radius:10px;cursor:zoom-out}
.ui-zoom .ui-zx{position:fixed;top:calc(env(safe-area-inset-top,0px) + 10px);right:max(16px,env(safe-area-inset-right,0px));z-index:23;font:inherit;font-weight:600;font-size:.9rem;border:1.5px solid var(--accent);background:var(--surface);color:var(--accent);border-radius:999px;padding:8px 16px;cursor:pointer}
.ui-zoombtn{font:inherit;font-size:.8rem;border:1px solid var(--accent);background:transparent;color:var(--accent);border-radius:8px;padding:4px 10px;cursor:pointer}
</style>
'''
rep('<div class="wrap">',css+'<div class="wrap">')
js=r'''
/* Свои картинки учителя: в каждом разделе можно добавить задание картинкой */
(function(){
  const secs=[...document.querySelectorAll('section.part:not(#hw):not(#errpanel)')];
  const boxes={};
  secs.forEach(sec=>{
    const w=el('div','ui-box');w.hidden=true;w.dataset.sec=sec.id;
    const list=el('div','ui-list');
    const add=el('div','ui-add');add.tabIndex=0;add.setAttribute('role','button');add.setAttribute('aria-label','Добавить картинку в раздел');
    const btn=el('button','btn ghost','+ Своё задание картинкой');btn.type='button';
    const hint=el('span','','или нажми сюда и вставь картинку (Ctrl+V), или перетащи файл');
    const inp=el('input');inp.type='file';inp.accept='image/png,image/jpeg,image/webp,image/gif';inp.multiple=true;inp.hidden=true;
    const msg=el('span','ui-msg','');
    add.append(btn,hint,inp,msg);w.append(list,add);sec.appendChild(w);
    boxes[sec.id]={w,list,add,inp,msg};
  });
  let assets=null,dbx=null;const cards={};
  const zov=el('div','ui-zoom');zov.hidden=true;zov.setAttribute('role','dialog');zov.setAttribute('aria-label','Картинка крупно');const zimg=el('img');const zx=el('button','ui-zx','Закрыть');zx.type='button';zov.append(zimg,zx);document.body.appendChild(zov);
  function openZoom(src,alt){zimg.src=src;zimg.alt=alt||'';zov.hidden=false;zx.focus();}
  const closeZoom=()=>{zov.hidden=true;};zx.addEventListener('click',closeZoom);zimg.addEventListener('click',closeZoom);addEventListener('keydown',e=>{if(e.key==='Escape'&&!zov.hidden)closeZoom();});
  const secName=id=>{const h=document.querySelector('#'+id+' h2');return h?h.textContent.trim():id;};
  function render(id,d){
    const b=boxes[d.section];if(!b||cards[id])return;
    const card=el('div','ui-card q');card.dataset.uid=id;
    const item={box:card,done:false,ok:false};reg.push(item);
    const lab=el('div','ex-head','<span class="tag">Задание по картинке</span>');
    const img=el('img');img.alt=d.caption||'Задание учителя';img.src='/_blob/'+d.assetId;img.loading='lazy';
    img.onerror=()=>{img.replaceWith(el('div','ui-msg','Картинка не загрузилась.'));};
    const zb=el('button','ui-zoombtn','Показать крупно');zb.type='button';const zoom=()=>openZoom(img.src,img.alt);zb.addEventListener('click',zoom);
    const cap=el('textarea');cap.rows=1;cap.id='uicap-'+id;cap.placeholder='Что это за задание? Например: упр. 45, вставить пропущенные буквы';cap.value=d.caption||'';cap.setAttribute('aria-label','Описание задания');
    const chk=el('div','opts');const note=el('textarea');note.rows=1;note.id='uinote-'+id;note.placeholder='Какие ошибки были (слова, буквы)';note.value=d.note||'';note.setAttribute('aria-label','Ошибки в задании');
    const fb=el('div','fb');
    const row=el('div','ui-row');const del=el('button','ui-del','Удалить картинку');del.type='button';const st=el('span','ui-msg','');row.append(zb,del,st);
    function setCheck(v,save){item.done=v!==null&&v!==undefined;item.ok=v===true;
      chk.querySelectorAll('.opt').forEach(x=>{x.classList.remove('right','wrong');if(item.done&&String(v)===x.dataset.v)x.classList.add(v?'right':'wrong');});
      card.classList.toggle('is-ok',item.done&&item.ok);card.classList.toggle('is-bad',item.done&&!item.ok);
      fb.innerHTML=item.done?(item.ok?'<b>Отлично!</b>':'Ошибки разберём, задание попадёт в разминку.'):'';
      meta();update();if(save)put({check:item.done?v:null});}
    function meta(){card.dataset.q=(cap.value.trim()||'Своё задание учителя')+' (картинка)';card.dataset.g=note.value.trim()?'ошибки: '+note.value.trim():'есть ошибки';card.dataset.r='см. картинку в листе';
      if(item.done&&item.ok){delete card.dataset.r;}else if(item.done)card.dataset.r='см. картинку в листе';}
    [['Верно',true],['Есть ошибки',false]].forEach(([t,v])=>{const o=el('button','opt',t);o.type='button';o.dataset.v=String(v);o.addEventListener('click',()=>setCheck(v,true));chk.appendChild(o);});
    let tm=null;const put=patch=>{if(!dbx)return;st.textContent='Сохраняю…';
      dbx.collection('teacherimgs').doc(id).update(Object.assign({updatedAt:new Date().toISOString()},patch)).then(()=>{st.textContent='Сохранено.';},()=>{st.textContent='Не сохранилось, попробуй ещё раз.';});};
    const later=()=>{clearTimeout(tm);meta();tm=setTimeout(()=>put({caption:cap.value.trim(),note:note.value.trim()}),900);};
    cap.addEventListener('input',later);note.addEventListener('input',later);
    let armed=false;
    del.addEventListener('click',async()=>{
      if(!armed){armed=true;del.classList.add('warn');del.textContent='Точно удалить? Нажми ещё раз';setTimeout(()=>{armed=false;del.classList.remove('warn');del.textContent='Удалить картинку';},4000);return;}
      st.textContent='Удаляю…';
      try{await dbx.collection('teacherimgs').doc(id).delete();}catch(e){st.textContent='Не удалилось, попробуй ещё раз.';return;}
      try{if(assets)await assets.delete(d.assetId);}catch(e){}
      const k=reg.indexOf(item);if(k>=0)reg.splice(k,1);card.remove();delete cards[id];update();});
    item.reset=()=>setCheck(null,true);
    card.append(lab,img,cap,el('div','qn','Проверка учителя'),chk,note,fb,row);
    b.list.appendChild(card);cards[id]=card;
    if(d.check===true||d.check===false)setCheck(d.check,false);else meta();
  }
  async function addFiles(secId,files){
    const b=boxes[secId];const imgs=[...files].filter(f=>/^image\/(png|jpeg|webp|gif)$/.test(f.type));
    if(!imgs.length){b.msg.textContent='Нужна картинка: PNG, JPG, WEBP или GIF.';return;}
    for(const f of imgs){
      b.msg.textContent='Загружаю картинку…';
      try{const r=await assets.upload(f);
        const id='u'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
        const d={section:secId,sectionName:secName(secId),assetId:r.id,caption:'',note:'',check:null,sheet:document.title,addedAt:new Date().toISOString()};
        await dbx.collection('teacherimgs').doc(id).set(d);render(id,d);b.msg.textContent='Картинка добавлена. Подпиши, что это за задание.';}
      catch(e){const c=e&&e.code;b.msg.textContent=c==='too_large'?'Картинка больше 20 МБ, уменьши её.':c==='unsupported_type'?'Такой формат не подходит, нужна PNG или JPG.':c==='quota_or_state'?'Место для картинок в листе закончилось.':'Не получилось загрузить, попробуй ещё раз.';}
    }
  }
  Object.entries(boxes).forEach(([id,b])=>{
    b.add.querySelector('.btn').addEventListener('click',e=>{e.stopPropagation();b.inp.click();});
    b.inp.addEventListener('change',()=>{if(b.inp.files.length)addFiles(id,b.inp.files);b.inp.value='';});
    b.add.addEventListener('click',()=>b.add.focus());
    b.add.addEventListener('focus',()=>b.add.classList.add('armed'));b.add.addEventListener('blur',()=>b.add.classList.remove('armed'));
    b.add.addEventListener('paste',e=>{const fs=[...(e.clipboardData&&e.clipboardData.files||[])];if(fs.length){e.preventDefault();addFiles(id,fs);}else b.msg.textContent='В буфере нет картинки.';});
    b.add.addEventListener('dragover',e=>{e.preventDefault();b.add.classList.add('over');});
    b.add.addEventListener('dragleave',()=>b.add.classList.remove('over'));
    b.add.addEventListener('drop',e=>{e.preventDefault();b.add.classList.remove('over');if(e.dataTransfer&&e.dataTransfer.files.length)addFiles(id,e.dataTransfer.files);});
  });
  const P=window.claude&&window.claude.use?Promise.all([window.claude.use('db'),window.claude.use('assets')]):Promise.resolve([null,null]);
  Promise.resolve(P).then(([d,a])=>{dbx=d;assets=a;if(!dbx)return;
    if(assets)Object.values(boxes).forEach(b=>{b.w.hidden=false;});
    dbx.collection('teacherimgs').get().then(q=>{
      q.docs.map(x=>({id:x.id,d:x.data()})).sort((x,y)=>String(x.d.addedAt).localeCompare(String(y.d.addedAt))).forEach(({id,d})=>{render(id,d);const b=boxes[d.section];if(b)b.w.hidden=false;});
    },()=>{});
  },()=>{});
})();
'''
rep("\n/* Скрыть задание на сегодня",js+"\n/* Скрыть задание на сегодня",1)
open(fn,'w',encoding='utf8').write(s);print('ok')
