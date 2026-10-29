"""Превращает рабочий лист-артефакт в версию для сайта.
Использование: python3 site_sheet.py лист.html лист-сайт.html"""
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf8').read()
def rep(a, b, need=True):
    global s
    n = s.count(a)
    if need: assert n == 1, (a[:70], n)
    s = s.replace(a, b)
rep("const attemptId='a'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);",
    "const attemptId=window.__ATTEMPT_ID||('a'+Date.now().toString(36)+Math.random().toString(36).slice(2,6));")
rep("const started=new Date().toISOString();", "const started=window.__STARTED||new Date().toISOString();")
# проверка учителя в зрительном диктанте прячется от ученика
s = s.replace("const mk=el('div','opts');const fb=el('div','fb');let tm=null;", "const mk=el('div','opts tchk');const fb=el('div','fb');let tm=null;")
# картинки учителя: адрес берётся из хранилища сайта
rep("img.src='/_blob/'+d.assetId;", "if(window.__blobSrc)window.__blobSrc(d.assetId).then(u=>{img.src=u;});else img.src='/_blob/'+d.assetId;", need=('/_blob/' in s))
# скрытые задания на сайте восстанавливаются из общей истории урока, а не из памяти устройства
s = s.replace("if(st[key])set(true);", "if(st[key]&&!window.__ATTEMPT_ID)set(true);")
# тексты про claude.ai
s = s.replace("Сохранение доступно, когда лист открыт в claude.ai под твоим аккаунтом.", "Отметки сохраняются на сайте.")
s = s.replace("Результаты не отправлены: лист открыт не под твоим аккаунтом.", "Результаты не отправлены.")
open(dst, 'w', encoding='utf8').write(s)
print('ok', len(s))

# ---------- общее рисование: пометки видны учителю и ученику ----------
s = open(dst, encoding='utf8').read()
def rp(a, b):
    global s
    assert s.count(a) == 1, ('draw', a[:70], s.count(a)); s = s.replace(a, b)
hook = r"""
  /* общее рисование: каждая пометка привязана к заданию и пересылается второму участнику */
  const SY=(function(){
    const S=window.__dwSync||null;
    const rid=()=>'d'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    function anchorAt(x,y){
      let els=[];try{els=document.elementsFromPoint(x-scrollX,y-scrollY);}catch(e){}
      const el=els.find(e=>e.closest&&!e.closest('#dwCanvas,.dw-bar,.dw-tb'));
      return (el&&el.closest('.q,.ex,.nb,.theory,.memo,.part-head,.hwc,.ui-card,section.part'))||document.body;}
    function box(a){const r=a.getBoundingClientRect();return {L:r.left+scrollX,T:r.top+scrollY,W:Math.max(1,r.width),H:Math.max(1,r.height)};}
    function mkRel(st){const a=anchorAt(st.p[0][0],st.p[0][1]);const b=box(a);return {ref:a,a:S?S.path(a):null,pts:st.p.map(q=>[(q[0]-b.L)/b.W,(q[1]-b.T)/b.H])};}
    function lay(){for(const st of strokes){if(!st.rel||(cur&&cur.mv===st))continue;
      let a=st.rel.ref;if(!a||!a.isConnected){a=S&&st.rel.a!=null?S.byPath(st.rel.a):null;st.rel.ref=a;}
      if(!a||!a.getClientRects().length)continue;const b=box(a);st.p=st.rel.pts.map(q=>[b.L+q[0]*b.W,b.T+q[1]*b.H]);}}
    function add(st){if(!st||!st.p||!st.p.length)return;st.id=st.id||rid();st.rel=mkRel(st);
      if(S)S.emit({k:'dadd',s:{id:st.id,t:st.t||'pen',c:st.c||null,w:st.w,e:st.e||null,f:st.f||null,a:st.rel.a,pts:st.rel.pts}});}
    function rem(st){if(st&&st.id&&S)S.emit({k:'drem',id:st.id});}
    function clear(){if(S)S.emit({k:'dclr'});}
    function apply(ev){
      if(ev.k==='dadd'){const d=ev.s;const st={id:d.id,t:d.t,c:d.c,w:d.w,e:d.e,f:d.f,p:[[0,0]],rel:{a:d.a,ref:null,pts:d.pts}};
        const i=strokes.findIndex(z=>z.id===d.id);if(i>=0)strokes[i]=st;else strokes.push(st);}
      else if(ev.k==='drem')strokes=strokes.filter(z=>z.id!==ev.id);
      else if(ev.k==='dclr')strokes=[];
      draw();}
    window.__dwHook={apply};
    return {lay,add,rem,clear};
  })();
"""
rp("  let tool='none',color='#e0312b',emoji='👍',strokes=[],cur=null,dpr=1,raf=0;\n",
   "  let tool='none',color='#e0312b',emoji='👍',strokes=[],cur=null,dpr=1,raf=0;\n"+hook)
rp("  function draw(){\n", "  function draw(){\n    SY.lay();\n")
rp("document.getElementById('dwUndo').addEventListener('click',()=>{strokes.pop();draw();});",
   "document.getElementById('dwUndo').addEventListener('click',()=>{const z=strokes.pop();draw();SY.rem(z);});")
rp("document.getElementById('dwClear').addEventListener('click',()=>{strokes=[];draw();});",
   "document.getElementById('dwClear').addEventListener('click',()=>{strokes=[];draw();SY.clear();});")
rp("if(v.trim()){strokes.push({t:'tx',e:v,c:cc,w:cw,f:cf,p:[[r.left+6+scrollX,r.top+4+scrollY]]});draw();}};",
   "if(v.trim()){strokes.push({t:'tx',e:v,c:cc,w:cw,f:cf,p:[[r.left+6+scrollX,r.top+4+scrollY]]});SY.add(strokes[strokes.length-1]);draw();}};")
rp("function eraseAt(x,y){const r=14;const n=strokes.length;", "function eraseAt(x,y){const r=14;const n=strokes.length;const before=strokes.slice();")
rp("if(strokes.length!==n)draw();}", "if(strokes.length!==n){draw();before.filter(z=>!strokes.includes(z)).forEach(z=>SY.rem(z));}}")
rp("if(tool==='emoji'){strokes.push({t:'em',e:emoji,w:36,p:[p]});draw();return;}",
   "if(tool==='emoji'){strokes.push({t:'em',e:emoji,w:36,p:[p]});SY.add(strokes[strokes.length-1]);draw();return;}")
rp("const end=()=>{if(cur&&cur.mv&&!cur.moved){const s=cur.mv;strokes=strokes.filter(z=>z!==s);draw();openText(",
   "const end=()=>{if(cur&&cur.mv&&cur.moved){const mv=cur.mv;cur=null;SY.add(mv);draw();return;}if(cur&&!cur.mv&&!cur.erase&&cur.p)SY.add(cur);if(cur&&cur.mv&&!cur.moved){const s=cur.mv;strokes=strokes.filter(z=>z!==s);draw();SY.rem(s);openText(")
rp("else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();strokes.pop();draw();}});",
   "else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();const z=strokes.pop();draw();SY.rem(z);}});")
# счётчики наград переносятся из карточки ученика
if "window.badgesEarned=[];" in s:
    s = s.replace("window.badgesEarned=[];", "if(window.__badgeCounts)BADGES.forEach(b=>{const n=window.__badgeCounts[b.t];if(n)PREV_BADGES[b.id]=n;});\nwindow.badgesEarned=[];", 1)
open(dst, 'w', encoding='utf8').write(s)
print('draw ok')
