(function applyProps(){
  const q = new URLSearchParams(location.search), r = document.documentElement.style;
  const set = (k, v, suffix) => { if (v) r.setProperty(k, v + (suffix||'')); };
  set('--head-font',   q.get('headFont'));
  set('--body-font',   q.get('bodyFont'));
  set('--head-weight', q.get('headWeight'));
  set('--body-weight', q.get('bodyWeight'));
  set('--head-size',   q.get('headSize'), 'px');
  set('--body-size',   q.get('bodySizePx'), 'px');
  set('--head-track',  q.get('headTrack'), 'em');
  const p = q.get('primary');
  if (p){ r.setProperty('--vermilion', p); r.setProperty('--ember', p); }
})();

(function () {
'use strict';

const W = window.MemoraWorld;
const REDUCE = W.REDUCE, COARSE = W.COARSE;
const $  = s => document.querySelector(s);
const $$ = s => [].slice.call(document.querySelectorAll(s));
const clamp = (v,a,b) => v<a?a:(v>b?b:v);
const smooth = (e0,e1,x) => { const t = clamp((x-e0)/(e1-e0),0,1); return t*t*(3-2*t); };
const vpH = () => innerHeight;

const nav = $('#nav'), preEl = $('#pre'), preFill = $('#pre-fill'), prePct = $('#pre-pct');

/* ------------------------------------------------------------ grain */
function makeGrain(){
  const c = document.createElement('canvas'); c.width = c.height = 180;
  const x = c.getContext('2d'), im = x.createImageData(180,180), d = im.data;
  for (let i=0;i<180*180;i++){
    const v = 110 + Math.random()*90;
    d[i*4]=d[i*4+1]=d[i*4+2]=v; d[i*4+3]=255;
  }
  x.putImageData(im,0,0);
  $('#grain').style.backgroundImage = 'url('+c.toDataURL()+')';
}

/* ------------------------------------------------- heading word split */
function splitHeadingWords(){
  if (REDUCE) return;
  $$('h1.display, h2.display').forEach(heading => {
    const lines = heading.querySelectorAll('.mask-line');
    const targets = lines.length ? [].slice.call(lines) : [heading];
    targets.forEach(target => {
      if (target.dataset.wordReady === 'true') return;
      const phrase = target.textContent.replace(/\s+/g,' ').trim();
      if (!phrase) return;
      target.dataset.wordReady = 'true';
      target.classList.add('word-reveal');
      target.setAttribute('aria-label', phrase);
      target.textContent = '';
      phrase.split(' ').forEach((word,i) => {
        if (i) target.appendChild(document.createTextNode(' '));
        const mask = document.createElement('span'), inner = document.createElement('span');
        mask.className = 'word-mask'; mask.setAttribute('aria-hidden','true');
        inner.className = 'word'; inner.textContent = word;
        inner.style.setProperty('--word-delay', (i*72)+'ms');
        mask.appendChild(inner); target.appendChild(mask);
      });
    });
  });
}

function wireReveals(){
  splitHeadingWords();
  const groups = new Map();
  const items = $$('[data-rv], .mask-line');
  items.forEach(el => {
    const key = el.parentElement;
    const arr = groups.get(key) || []; arr.push(el); groups.set(key, arr);
  });
  groups.forEach(arr => arr.forEach((el,i) => el.dataset.rvd = i*85));
  const io = new IntersectionObserver(es => {
    es.forEach(e => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const d = parseFloat(e.target.dataset.rvd || 0);
      setTimeout(() => e.target.classList.add('rv-in'), REDUCE ? 0 : d);
    });
  }, { rootMargin:'0px 0px -10% 0px', threshold:.04 });
  items.forEach(el => { if (!el.closest('#hero')) io.observe(el); });
}

/* --------------------------------------------------------- hero exit */
function wireHeroExit(){
  const hero = $('#hero'); if (!hero) return;
  const seq = [
    { el:$('.peek'),      at:.00, span:.26, blur:10 },
    { el:$('.hero-cue'),  at:.10, span:.30, shift:true },
    ...$$('.chip').map((el,i) => ({ el, at:.20+i*.10, span:.30, shift:true })),
    { el:$('.chapters'),  at:.60, span:.30 },
    { el:$('.hero-side'), at:.70, span:.30 }
  ].filter(o => o.el);
  let on = false;
  const apply = () => {
    const t = clamp(scrollY / Math.max(1, vpH()*.58), 0, 1);
    if (t <= 0){
      if (!on) return;
      seq.forEach(o => {
        o.el.style.opacity=''; o.el.style.transform=''; o.el.style.filter='';
        o.el.style.pointerEvents=''; o.el.style.transition='';
      });
      on = false; return;
    }
    on = true;
    seq.forEach(o => {
      o.el.style.transition = 'none';
      const a = 1 - smooth(o.at, o.at+o.span, t);
      o.el.style.opacity = a.toFixed(3);
      if (o.shift) o.el.style.transform = 'translate3d(0,'+((1-a)*15).toFixed(1)+'px,0)';
      if (o.blur)  o.el.style.filter = a > .999 ? '' : 'blur('+((1-a)*o.blur).toFixed(1)+'px)';
      o.el.style.pointerEvents = a < .05 ? 'none' : '';
    });
  };
  addEventListener('scroll', apply, { passive:true });
  addEventListener('resize', apply, { passive:true });
  apply();
}

/* -------------------------------------------------------------- nav */
function wireNav(){
  let last = 0;
  const rail = $('#rail');
  const names = ['Hero','The Studio','The Collection','How It Works','Reviews',
                 'Questions','Place an Order','Colophon'];
  const anchors = W.anchors();
  anchors.forEach((_, i) => {
    const b = document.createElement('button');
    b.innerHTML = '<i></i>'; b.title = names[i] || '';
    b.setAttribute('aria-label', names[i] || 'section');
    b.addEventListener('click', () => W.scrollToScene(i));
    rail.appendChild(b);
  });
  const dots = $$('#rail button');
  const links = $$('.nav-link');
  const burger = $('.nav-burger');

  const closeMenu = () => {
    nav.classList.remove('menu-open');
    burger.classList.remove('active');
    burger.setAttribute('aria-expanded','false');
    document.documentElement.classList.remove('nav-open');
  };
  const setMenu = open => {
    if (open) nav.classList.remove('hide');
    nav.classList.toggle('menu-open', open);
    burger.classList.toggle('active', open);
    burger.setAttribute('aria-expanded', String(open));
    document.documentElement.classList.toggle('nav-open', open);
  };
  burger.addEventListener('click', () => setMenu(!nav.classList.contains('menu-open')));
  $$('.nav-links a').forEach(a => a.addEventListener('click', closeMenu));
  addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

  const onScroll = () => {
    const y = scrollY;
    nav.classList.toggle('stuck', y > 40);
    if (!nav.classList.contains('menu-open'))
      nav.classList.toggle('hide', y > last && y > 260);
    last = y;
    const i = W.sceneIndex();
    dots.forEach((d,k) => d.classList.toggle('on', k === i));
    const map = { story:1, products:2, process:3, voices:4, order:6 };
    links.forEach(a => {
      const id = (a.getAttribute('href')||'').replace('#','');
      a.classList.toggle('on', map[id] === i);
    });
  };
  addEventListener('scroll', onScroll, { passive:true });
  onScroll();

  /* smooth internal navigation through the rig's own anchors */
  $$('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
    const id = a.getAttribute('href').slice(1);
    const target = id === 'top' ? document.body : document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    const top = id === 'top' ? 0
      : target.getBoundingClientRect().top + scrollY - vpH()*0.14;
    scrollTo({ top, behavior: REDUCE ? 'auto' : 'smooth' });
  }));
}

/* ------------------------------------------------------ chip / focus */
function wireFocus(){
  $$('.chip').forEach(c => {
    const i = parseInt(c.dataset.chip, 10);
    c.addEventListener('mouseenter', () => { W.focus(i); c.classList.add('on'); });
    c.addEventListener('mouseleave', () => { W.focus(-1); c.classList.remove('on'); });
    c.addEventListener('click', () => W.scrollToScene(i + 1));
  });
  $$('.les').forEach(l => {
    l.addEventListener('mouseenter', () => W.focus(parseInt(l.dataset.les,10)));
    l.addEventListener('mouseleave', () => W.focus(-1));
  });
  addEventListener('pointermove', e => {
    W.pointer((e.clientX / innerWidth)*2 - 1, (e.clientY / innerHeight)*2 - 1);
  }, { passive:true });
}

/* ----------------------------------------------------------- cursor */
function wireCursor(){
  if (COARSE) return;
  const dot = $('#cursor');
  let x = 0, y = 0, tx = 0, ty = 0, on = false;
  addEventListener('pointermove', e => { tx = e.clientX; ty = e.clientY; }, { passive:true });
  const tick = () => {
    x += (tx - x) * 0.18; y += (ty - y) * 0.18;
    dot.style.transform = 'translate3d('+x.toFixed(1)+'px,'+y.toFixed(1)+'px,0)';
    requestAnimationFrame(tick);
  };
  tick();
  document.addEventListener('pointerover', e => {
    const hit = e.target.closest('[data-cursor]');
    if (!!hit !== on){ on = !!hit; dot.classList.toggle('act', on); }
  });
}

/* -------------------------------------------------- product filtering */
function wireProducts(){
  const tabs = $$('.cat-tab'), cards = $$('.pcard');
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(o => o.classList.toggle('on', o === t));
    const cat = t.dataset.cat;
    cards.forEach(c => {
      const cats = (c.dataset.cat || '').split(/\s+/);
      c.classList.toggle('hide', cat !== 'all' && cats.indexOf(cat) === -1);
    });
  }));
  /* an Order button on a card preselects that product in the form */
  $$('.obtn[data-p]').forEach(b => b.addEventListener('click', () => {
    const sel = $('#oproduct'), want = b.dataset.p;
    if (!sel) return;
    const hit = [].slice.call(sel.options).find(o =>
      o.textContent.replace(/\s+/g,' ').trim() === want.replace(/\s+/g,' ').trim());
    sel.value = hit ? hit.value : sel.options[sel.options.length-1].value;
    sel.dispatchEvent(new Event('change'));
  }));
}

/* -------------------------------------------------------- order form
   No backend is wired: the form composes the enquiry and hands it to the
   studio's own mail and WhatsApp. Point `action` at your endpoint (or the
   original Supabase `orders` insert) when you have one. */
function wireOrderForm(){
  const f = $('#oform'); if (!f) return;
  const note = $('#onote'), wa = $('#wa');
  const EMAIL = 'thegiftememora@gmail.com';

  const compose = () => {
    const d = new FormData(f);
    return [
      'New order — The Giftè Memora','',
      'Name: '        + (d.get('name')||''),
      'Phone: '       + (d.get('phone')||''),
      'Email: '       + (d.get('email')||''),
      'Occasion: '    + (d.get('occasion')||''),
      'Product: '     + (d.get('product')||''),
      'Address: '     + (d.get('address')||''),
      'Customisation: '+ (d.get('custom')||'')
    ].join('\n');
  };
  const refreshWA = () => {
    /* set your number here, in international format without the + */
    const PHONE = '';
    wa.href = PHONE
      ? 'https://wa.me/'+PHONE+'?text='+encodeURIComponent(compose())
      : 'https://www.instagram.com/thegiftememora';
    if (!PHONE) wa.querySelector('span').textContent = 'Message on Instagram';
  };
  f.addEventListener('input', refreshWA);
  f.addEventListener('change', refreshWA);
  refreshWA();

  f.addEventListener('submit', e => {
    e.preventDefault();
    const missing = [].slice.call(f.querySelectorAll('[required]'))
      .filter(el => !el.value.trim());
    if (missing.length){
      note.textContent = 'Please fill every required field.';
      missing[0].focus(); return;
    }
    /* backend.js (if loaded) claims the submit and stores the order in
       Supabase; otherwise this falls back to the studio's mail app. */
    if (window.MemoraBackend && window.MemoraBackend.submitOrder){
      window.MemoraBackend.submitOrder(f, note);
      return;
    }
    note.textContent = 'Opening your mail app — send it and we reply within 24 hours.';
    location.href = 'mailto:'+EMAIL
      + '?subject='+encodeURIComponent('Order — '+(new FormData(f).get('product')||'Custom'))
      + '&body='+encodeURIComponent(compose());
  });
}


/* ------------------------------------------- product photo thumbnails */
function wireThumbs(){
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.pth'); if (!b) return;
    const card = b.closest('.pcard'), img = card.querySelector('.pimg img');
    img.src = b.dataset.src;
    card.querySelectorAll('.pth').forEach(x => x.classList.toggle('on', x === b));
  });
}

/* ------------------------- hero "Collection" preview: live video frame */
function wirePeek(){
  const fr = $('.peek-fr'); if (!fr) return;
  const cv = document.createElement('canvas'); cv.width = 480; cv.height = 300;
  fr.appendChild(cv);
  const cx = cv.getContext('2d'); let last = 0;
  (function tick(t){
    requestAnimationFrame(tick);
    if (t - last < 90 || document.hidden) return; last = t;
    const M = window.__memora, v = M && M.VID && M.VID.a;
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    const k = Math.max(480/v.videoWidth, 300/v.videoHeight), w = v.videoWidth*k, h = v.videoHeight*k;
    cx.drawImage(v, (480-w)/2, (300-h)/2, w, h);
  })(0);
}

/* ------------------------------------------------------ intro video
   Plays once, full-frame and uncropped, as the loading screen. The
   interactive world only launches once the clip has ended AND the
   real assets (frames, WebGL, video plate) have finished loading —
   whichever takes longer holds the other. */
let jobsReady = false, introReady = REDUCE;
function maybeLaunch(){ if (jobsReady && introReady) setTimeout(launch, 120); }

function wireIntro(){
  const wrap = $('#introVideo');
  if (!wrap) { introReady = true; return; }
  if (REDUCE){ wrap.style.display = 'none'; introReady = true; return; }
  const v = $('#introVideoEl');
  let settled = false;
  const finish = hide => {
    if (settled) return; settled = true;
    introReady = true;
    if (hide) wrap.style.display = 'none';
    maybeLaunch();
  };
  if (!v){ introReady = true; return; }
  v.addEventListener('ended', () => finish(false), { once:true });
  v.addEventListener('error', () => finish(true), { once:true });
  setTimeout(() => finish(true), 12000); /* never block launch on a stalled clip */
  const p = v.play(); if (p && p.catch) p.catch(() => finish(true));
}

/* ---------------------------------------------------------- fallback */
function fallback(err){
  const iv = $('#introVideo'); if (iv) iv.style.display = 'none';
  document.documentElement.classList.add('no-webgl');
  document.body.classList.add('no-webgl');
  document.body.classList.remove('is-locked');
  preEl.classList.add('done');
  /* the video still plays, just as a plain covered element behind the page */
  const v = document.createElement('video');
  v.id = 'vfallback'; v.src = 'assets/video/1000093499.mp4';
  v.loop = v.muted = v.autoplay = true; v.playsInline = true;
  v.setAttribute('playsinline',''); document.body.appendChild(v);
  const p = v.play(); if (p && p.catch) p.catch(()=>{});
  $$('[data-rv], .mask-line').forEach(e => e.classList.add('rv-in'));
  console.warn('[memora] falling back to CSS', err);
}

/* -------------------------------------------------------------- boot */
function boot(){
  makeGrain();
  wireReveals(); wireHeroExit(); wireFocus(); wireCursor();
  wireProducts(); wireOrderForm(); wireThumbs(); wirePeek(); wireIntro();
  document.body.classList.add('is-locked');

  let i = 0;
  const step = () => {
    const j = W.JOBS[i];
    const done = () => {
      i++;
      const p = i / W.JOBS.length;
      preFill.style.right = ((1-p)*100).toFixed(1)+'%';
      prePct.textContent = Math.round(p*100);
      if (i < W.JOBS.length) setTimeout(step, 16); else { jobsReady = true; maybeLaunch(); }
    };
    let r;
    try { r = j[1](); }
    catch (err){
      console.error('[memora] job "'+j[0]+'" failed', err);
      if (i <= 3) return fallback(err);
    }
    (r && r.then) ? r.then(done, done) : done();
  };
  setTimeout(step, 60);
}

function launch(){
  W.start();
  wireNav();                       /* the rail needs the measured anchors */
  preEl.classList.add('done');
  const iv = $('#introVideo');
  if (iv){ iv.classList.add('done'); setTimeout(() => iv.remove(), 900); }
  setTimeout(() => {
    document.body.classList.remove('is-locked');
    $('#hero').querySelectorAll('[data-rv], .mask-line').forEach((e,i) =>
      setTimeout(() => e.classList.add('rv-in'), REDUCE ? 0 : 120 + i*95));
  }, REDUCE ? 0 : 340);
}

if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot,0);
else addEventListener('DOMContentLoaded', boot);
})();
