const $ = (id)=>document.getElementById(id);
const ed = $('editor');
const out = $('bubble');


const MAX_STACK = 10000;
const undoStack = [];
let inputTimer = null;

const CLIPBOARD_SVG = `
<svg width="12" height="12" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M21.2346 24.9925C21.2346 19.0001 25.6513 14.1423 31.0995 14.1423H76.1351C81.5833 14.1423 86 19.0001 86 24.9925V89.1498C86 95.1422 81.5833 99.9999 76.1351 99.9999H31.0995C25.6513 99.9999 21.2346 95.1422 21.2346 89.1498V24.9925Z" fill="currentColor"/>
<path d="M57.4692 0H15.8649C10.4167 0 6 4.85777 6 10.8501V71.2335C6 76.3316 6 82.6047 15.8649 82.6047V23.0053C15.8649 14.7983 21.9139 8.14529 29.3756 8.14529H69.1567C69.1567 0 61.7911 0 57.4692 0Z" fill="currentColor"/>
</svg>`;

// постоянные частицы поверх закрытых спойлеров
const SP_MAP = new Map();
let SP_RAF = 0;

function spStart(el){
  if (SP_MAP.has(el)) return;

  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const cnv = document.createElement('canvas');
  cnv.className = 'sp-canvas';
  el.appendChild(cnv);

  const ctx = cnv.getContext('2d');

  const st = { el, cnv, ctx, dpr, w:0, h:0, parts:[], t:0 };
  SP_MAP.set(el, st);
  spResize(st, true);
  if (!SP_RAF) SP_RAF = requestAnimationFrame(spLoop);
}

function spStop(el){
  const st = SP_MAP.get(el);
  if (!st) return;
  st.cnv.remove();
  SP_MAP.delete(el);
  if (SP_MAP.size === 0 && SP_RAF){
    cancelAnimationFrame(SP_RAF);
    SP_RAF = 0;
  }
}

function spResize(st, regen=false){
  const r = st.el.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  if (w === st.w && h === st.h && !regen) return;

  st.w = w; st.h = h;
  st.cnv.width  = Math.ceil(w * st.dpr);
  st.cnv.height = Math.ceil(h * st.dpr);
  st.cnv.style.width  = w + 'px';
  st.cnv.style.height = h + 'px';
  st.ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);

  // Ещё больше точек — прям облако
  const count = Math.max(400, Math.min(1200, Math.floor((w*h)/8)));
  st.parts = [];
  const gray = '#aaa';    
  const size = 0.7;        // ещё мельче точки (менее 1px)

  for (let i=0; i<count; i++){
    const x = Math.random()*w;
    const y = Math.random()*h;
    const ang = Math.random()*Math.PI*2;
    const speed = 15 + Math.random()*15; // скорость чуть медленнее
    const vx = Math.cos(ang)*speed;
    const vy = Math.sin(ang)*speed;
    st.parts.push({x,y,vx,vy,r:size,col:gray,wob:Math.random()*Math.PI*2});
  }
}




function spLoop(ts){
  SP_MAP.forEach(st=>{
    // пропущенное время
    const dt = st.t ? Math.min(32, ts - st.t) : 16;
    st.t = ts;
    const sec = dt/1000;

    // на всякий случай обновить размер
    spResize(st);

    const ctx = st.ctx, w = st.w, h = st.h;
    ctx.clearRect(0,0,w,h);

    for (const p of st.parts){
      // небольшая турбулентность
      const n = (Math.sin(p.wob) + Math.cos(p.wob*1.3))*0.5;
      p.vx += n * 6 * sec;
      p.vy += n * 6 * sec;
      // ограничим скорость, чтобы не улетали слишком быстро
      const spd = Math.hypot(p.vx, p.vy);
      const maxS = 80, minS = 18;
      if (spd > maxS){ p.vx *= maxS/spd; p.vy *= maxS/spd; }
      if (spd < minS){ p.vx *= (minS/spd); p.vy *= (minS/spd); }

      p.x += p.vx * sec;
      p.y += p.vy * sec;
      p.wob += 1.5 * sec;

      // зацикливание по краям с небольшим полем
      const m = 6;
      if (p.x < -m) p.x = w + m;
      if (p.x > w + m) p.x = -m;
      if (p.y < -m) p.y = h + m;
      if (p.y > h + m) p.y = -m;

      ctx.fillStyle = p.col;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });

  SP_RAF = SP_MAP.size ? requestAnimationFrame(spLoop) : 0;
}

// синхронизировать канвасы со спойлерами в DOM
function syncSpoilers(){
  const list = out.querySelectorAll('.sp');
  const seen = new Set();
  list.forEach(el=>{
    seen.add(el);
    if (el.classList.contains('reveal')) spStop(el);
    else spStart(el);
  });
  // удалить анимации у удаленных эл-тов
  SP_MAP.forEach((st, el)=>{ if (!seen.has(el) || !el.isConnected) spStop(el); });
}

window.addEventListener('resize', ()=>{ SP_MAP.forEach(st=>spResize(st)); });



function getState(){ return { v: ed.value, s: ed.selectionStart, e: ed.selectionEnd }; }
function applyState(st){ ed.value = st.v; ed.setSelectionRange(st.s, st.e); renderAll(); }

function saveSnapshot(){
  const cur = getState();
  const last = undoStack[undoStack.length - 1];
  undoStack.push(cur);
}



function undo(){
  if(undoStack.length <= 1) return false;
  const cur = undoStack.pop();
  const prev = undoStack[undoStack.length - 1];
  applyState(prev);
  return true;
}



// init first snapshot
saveSnapshot();

function escapeHTML(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// render with custom <: ... :> quotes, spoilers, code, etc.
function renderMarkdown(src){
  const code = [];
  src = src.replace(/```([\s\S]*?)```/g, (_, inner)=>{
    const i = code.length; code.push(inner); return `%%CODE${i}%%`;
  });

  const q = [];
  src = src.replace(/<:([\s\S]*?):>/g, (_, body)=>{
    const i = q.length; q.push(body); return `%%QUOTE${i}%%`;
  });

  let html = escapeHTML(src);

  html = html.replace(/\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/`([^`]+)`/g,'<code>$1</code>');
  // html = html.replace(/\|\|([^|]+)\|\|/g,'<span class="sp">$1</span>');
  html = html.replace(/\|\|([^|]+)\|\|/g,'<span class="sp"><span class="sp-text">$1</span></span>');

  html = html.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
  html = html.replace(/__([^_]+)__/g,'<u>$1</u>');
  html = html.replace(/_([^_]+)_/g,'<i>$1</i>');
  html = html.replace(/~~([^~]+)~~/g,'<s>$1</s>');
  html = html.replace(/\n/g,'<br>');

  html = html.replace(/%%QUOTE(\d+)%%\s*/g, (_, i) => {
    const inner = renderMarkdown(q[Number(i)]).trim();
    return `<div class="q">${inner}</div>`;
  });


  html = html.replace(/%%CODE(\d+)%%/g, (_, i)=>{
    const raw = code[Number(i)].trimEnd();
    const lines = raw.split("\n");

    let title = "copy";
    let body = raw;

    // если строк больше 1 и первая не пустая
    if (lines.length > 1 && lines[0].trim() !== "") {
      title = lines[0].trim().toLowerCase();
      body = lines.slice(1).join("\n");
    }

    const escapedBody = escapeHTML(body);

    return `
      <div class="pre-pre">
        <div class="pre-header">
          <span>${title}</span>
          <span class="pre-copy">${CLIPBOARD_SVG}</span>
        </div>
        <code>${escapedBody}</code>
      </div>`;
  });
  html = html.replace(/<\/div>\s*<br\s*\/?>/g, '</div>');
  return html;
}

function autosize(){
  const current = ed.offsetHeight;
  const needed = ed.scrollHeight;
  if (Math.abs(needed - current) < 1) return;
  ed.style.height = current + 'px';
  requestAnimationFrame(()=>{ ed.style.height = needed + 'px'; });
}

function tightenQuotes(){
  document.querySelectorAll('.q').forEach(el=>{
    const parent = el.parentElement;
    const overflowed = (parent.clientWidth - 32 - 50) < el.clientWidth;
    el.classList.toggle('tight', overflowed);
  });
}

function tightenCodeBlocks(){
  document.querySelectorAll('.pre-pre code').forEach(el=>{
    const parent = el.parentElement.parentElement;
    const overflowed = (parent.clientWidth - 32 - 50) < el.clientWidth;
    el.classList.toggle('tight', overflowed);
  });

}

function render(){ out.innerHTML = renderMarkdown(ed.value); }
function autosize(){ ed.style.height='auto'; ed.style.height=ed.scrollHeight+'px'; }
function renderAll(){ autosize(); render(); tightenQuotes(); tightenCodeBlocks(); syncSpoilers();}
renderAll();

// save snapshots on input with debounce
ed.addEventListener('input', ()=>{
  renderAll();
  clearTimeout(inputTimer);
  inputTimer = setTimeout(saveSnapshot, 400);
});

// selection helpers
function wrapSelection(left, right=left){
  const s = ed.selectionStart, e = ed.selectionEnd;
  const a = ed.value.slice(0,s), m = ed.value.slice(s,e), b = ed.value.slice(e);
  ed.value = a + left + m + right + b;
  const cs = s + left.length, ce = cs + m.length;
  ed.setSelectionRange(cs, ce);
  saveSnapshot();
  renderAll();
  
}
function wrapBlock(prefix, suffix=''){
  const s = ed.selectionStart, e = ed.selectionEnd;
  const a = ed.value.slice(0,s), m = ed.value.slice(s,e), b = ed.value.slice(e);
  const block = prefix + (m || '') + suffix;
  ed.value = a + block + b;
  const off = prefix.length;
  ed.setSelectionRange(a.length + off, a.length + off + (m||'').length);
  saveSnapshot();
  renderAll();
}
function clearSelection(){
  const s = ed.selectionStart, e = ed.selectionEnd;
  if(s===e) return;
  const a = ed.value.slice(0,s); let m = ed.value.slice(s,e); const b = ed.value.slice(e);
  m = m
    .replace(/```([\s\S]*?)```/g,'$1')
    .replace(/<:([\s\S]*?):>/g,'$1')
    .replace(/`([^`]+)`/g,'$1')
    .replace(/\*\*([^*]+)\*\*/g,'$1')
    .replace(/__([^_]+)__/g,'$1')
    .replace(/_([^_]+)_/g,'$1')
    .replace(/~~([^~]+)~~/g,'$1')
    .replace(/\|\|([^|]+)\|\|/g,'$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'$1');
  ed.value = a + m + b;
  ed.setSelectionRange(a.length, a.length + m.length);
  saveSnapshot();
  renderAll();
}

// toolbar
$('bUndo').onclick = ()=> undo();
$('bBold').onclick      = ()=> wrapSelection('**');
$('bItalic').onclick    = ()=> wrapSelection('_');
$('bUnderline').onclick = ()=> wrapSelection('__');
$('bStrike').onclick    = ()=> wrapSelection('~~');
$('bMono').onclick      = ()=> wrapSelection('`');
$('bCode').onclick      = ()=> wrapBlock('```','```');
$('bQuote').onclick     = ()=> wrapBlock('<:', ':>');
$('bSpoiler').onclick   = ()=> wrapSelection('||');
$('bLink').onclick      = ()=> openLinkModal();
$('bClear').onclick     = clearSelection;

// theme toggle
const btnLight = document.getElementById('btnThemeLight');
const btnDark  = document.getElementById('btnThemeDark');

function setTheme(mode){
  document.documentElement.setAttribute('data-theme', mode);
  updateThemeIcons();
}
function updateThemeIcons(){
  const t = document.documentElement.getAttribute('data-theme') || 'light';
  btnLight?.classList.toggle('active', t === 'light');
  btnDark?.classList.toggle('active',  t === 'dark');
}
btnLight?.addEventListener('click', ()=> setTheme('light'));
btnDark ?.addEventListener('click', ()=> setTheme('dark'));
updateThemeIcons();

// spoiler reveal
// out.addEventListener('click', (e)=>{ if(e.target.classList.contains('sp')) e.target.classList.toggle('reveal'); });
out.addEventListener('click', (e)=>{
  const sp = e.target.closest('.sp');
  if(!sp) return;

  // переключаем состояние
  const willReveal = !sp.classList.contains('reveal');
  if (willReveal){
    sp.classList.add('reveal');
    spStop(sp);                // точки больше не нужны
  }else{
    sp.classList.remove('reveal');
    spStart(sp);               // снова включаем точки
  }
});

// dblclick code to copy
out.addEventListener('dblclick', (e)=>{
  if(e.target.tagName==='CODE'){ navigator.clipboard.writeText(e.target.innerText).catch(()=>{}); }
});

// link modal
const modal = $('linkModal');
function openLinkModal(){
  const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
  $('linkText').value = sel || '';
  $('linkUrl').value = 'https://';
  modal.classList.remove('hidden');
  setTimeout(()=> $('linkUrl').focus(), 20);
}
$('linkCancel').onclick = ()=> modal.classList.add('hidden');
$('linkClose').onclick  = ()=> modal.classList.add('hidden');
$('linkOk').onclick = ()=> {
  let text = $('linkText').value.trim();
  const url  = $('linkUrl').value.trim();
  if(!url) return;
  if(!text) text = url.replace(/^https?:\/\//i,'').replace(/\/$/,'');
  saveSnapshot();
  const s = ed.selectionStart, e = ed.selectionEnd;
  const a = ed.value.slice(0,s), b = ed.value.slice(e);
  ed.value = a + `[${text}](${url})` + b;
  const pos = (a + `[${text}](${url})`).length;
  ed.setSelectionRange(pos, pos);
  modal.classList.add('hidden');
  renderAll();
};
window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') modal.classList.add('hidden'); });

// global shortcuts
document.addEventListener('keydown', (e)=>{
  const code = e.code;                 
  const ctrl = e.ctrlKey || e.metaKey;   
  const sh   = e.shiftKey;

  // Undo / Redo
  if (ctrl && !sh && code === 'KeyZ') { if (undo()) { e.preventDefault(); } return; }
  // If modal open, ignore
  if (!modal.classList.contains('hidden')) return;

  // Shortcuts (layout-independent)
  if (ctrl && !sh && code === 'KeyB') { e.preventDefault(); wrapSelection('**'); }
  else if (ctrl && !sh && code === 'KeyI') { e.preventDefault(); wrapSelection('_'); }
  else if (ctrl && !sh && code === 'KeyU') { e.preventDefault(); wrapSelection('__'); }
  else if (ctrl && sh && code === 'KeyX')  { e.preventDefault(); wrapSelection('~~'); }
  else if (ctrl && sh && code === 'KeyM')  { e.preventDefault(); wrapSelection('`'); }
  else if (ctrl && sh && code === 'KeyC')  { e.preventDefault(); wrapBlock('```','```'); }
  else if (ctrl && !sh && code === 'KeyK') { e.preventDefault(); openLinkModal(); }
  else if (ctrl && sh && code === 'KeyP')  { e.preventDefault(); wrapSelection('||'); }
  else if (ctrl && sh && code === 'Period'){ e.preventDefault(); wrapBlock('<:',':>'); }
});



out.addEventListener('click', e=>{
  if(e.target.classList.contains('pre-copy')){
    const pre = e.target.closest('pre');
    const code = pre.querySelector('code').innerText;
    navigator.clipboard.writeText(code).catch(()=>{});
  }
});

const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

function getPayload(){
  return { text: ed.value.trim() || "" };
}

function sendToBot(){
  const payload = JSON.stringify(getPayload());
  if (tg) tg.sendData(payload);
  else alert(payload); // fallback вне Telegram
}

const sendBtn = document.getElementById('sendBtn');
// проверяем авторизацию
if (tg){
  tg.ready();
  tg.expand();

  const user = tg.initDataUnsafe?.user;
  if (user){
    // если есть данные о пользователе — показываем кнопку
    tg.MainButton.setText('Отправить в бота');
    tg.MainButton.onClick(sendToBot);
    tg.MainButton.show();
    tg.enableClosingConfirmation();

    if (sendBtn){
      sendBtn.style.display = 'inline-block';
      sendBtn.addEventListener('click', sendToBot);
    }
  } else {
    // если нет user — скрываем кнопку
    if (sendBtn) sendBtn.style.display = 'none';
  }
} else {
  // вне Telegram просто показываем кнопку для тестов
  const sendBtnWrap = document.getElementById('sendBtnWrap');

  if (user){
    if (sendBtnWrap){
      sendBtnWrap.style.display = 'block';   // показываем обёртку
      sendBtn.addEventListener('click', sendToBot);
    }
  } else {
    if (sendBtnWrap){
      sendBtnWrap.style.display = 'none';    // полностью убираем
    }
  }
  
}
