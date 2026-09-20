/* =====================================================================
   GIFTÈ MEMORA — the Kage camera rig, driven by two video plates.
   Preserves Kage's scroll grammar exactly:
     · progressFor()   scene-anchored scroll → 0..N progress
     · damp()          frame-rate independent smoothing of that progress
     · CAM[]           per-scene camera waypoints, interpolated
     · parallax        plates at different Z move at different rates
     · foreground veil dissolves as the camera reaches it
     · POST.comp       one composite pass: grade, vignette, grain, fade
     · PERF            resolution governor that sheds pixels under load
   ===================================================================== */
window.MemoraWorld = (function () {
'use strict';

const Q      = new URLSearchParams(location.search);
const qs     = (k, d) => { const v = Q.get(k); return v === null ? d : v; };
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE = matchMedia('(hover: none)').matches;
const LOW    = COARSE || (navigator.hardwareConcurrency || 4) <= 4;

const clamp  = (v,a,b) => v < a ? a : (v > b ? b : v);
const sat    = v => clamp(v,0,1);
const lerp   = (a,b,t) => a + (b-a)*t;
const smooth = (e0,e1,x) => { const t = sat((x-e0)/(e1-e0)); return t*t*(3-2*t); };
const easeOut= t => 1 - Math.pow(1-t,3);
const damp   = (cur,to,rate,dt) => lerp(cur,to,1-Math.exp(-rate*dt));
const TAU    = Math.PI*2;

const vpW = () => innerWidth;
const vpH = () => innerHeight;

/* primaryColor #c9956a — the accent and the ember tint it drives */
const PRIMARY = qs('primary','#c9956a');
function hexToVec3(h){
  const n = parseInt(h.replace('#',''),16);
  return [((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255];
}

/* --------------------------------------------------------- 1 · state */
let renderer, scene, camera, gl;
let running = false, tPrev = 0, clock = 0, fadeIn = 0;
let raf = 0;

const RIG   = { prog:0, smooth:0, mx:0, my:0, tmx:0, tmy:0, intro:0, focus:-1, focusAmt:0 };
const PERF  = { scale: LOW ? .72 : 1, acc:0, n:0, locked:false };
const INTRO = { t0:0 };
const WORLD = { plates:[], veil:null, embers:null, glows:[], uT:{value:0} };
const POST  = { scene:null, comp:null, quad:null, cam:null };
const VID   = { a:null, texA:null, ready:0, aspA:16/9 };

/* the far "bed" plate used to be a looping <video> (assets/video/1000093473.mp4).
   Video-as-texture is fragile across hosts/embeds (autoplay policy, range-request
   support for seeking, decode stalls), so the bed is now a still-frame sequence
   extracted from that same clip and scrubbed by scroll position — same shader,
   same parallax/grading pipeline, just a CanvasTexture instead of a VideoTexture. */
const FRAMES_DIR   = 'assets/img/bg-frames/';
const FRAMES_COUNT = 80;
const FRAMES_PAD    = 3;
const FRAMES = {
  imgs: [], loadedCount: 0, aspect: 16/9,
  canvas: null, ctx: null, tex: null, curIdx: -1, firstReady: false
};

let SECS = [], anchors = [];

/* Per-scene camera waypoints. Kage walks the rig down −Z through the
   sanctuary; here it walks in through the plates, so the near plate slides
   past faster than the far one and the parallax is real camera parallax
   rather than a scroll-linked transform. */
const CAM = [
  { z: 16.0, y: 0.00, rx: 0.000, fov: 52, plate: 0, blur: 0.00 },  /* 0 hero      */
  { z: 12.4, y: 0.32, rx:-0.020, fov: 50, plate: 0, blur: 0.10 },  /* 1 studio    */
  { z:  8.2, y: 0.10, rx: 0.010, fov: 47, plate: 1, blur: 0.26 },  /* 2 products  */
  { z:  5.0, y:-0.22, rx: 0.030, fov: 45, plate: 1, blur: 0.34 },  /* 3 process   */
  { z:  2.4, y:-0.06, rx: 0.012, fov: 43, plate: 1, blur: 0.30 },  /* 4 voices    */
  { z:  0.2, y: 0.14, rx:-0.014, fov: 42, plate: 0, blur: 0.22 },  /* 5 faq       */
  { z: -2.6, y: 0.00, rx: 0.000, fov: 40, plate: 0, blur: 0.10 },  /* 6 order     */
  { z: -5.0, y: 0.18, rx:-0.010, fov: 39, plate: 0, blur: 0.04 }   /* 7 footer    */
];

/* ------------------------------------------------- 2 · scroll anchors
   Identical to Kage: every [data-cam] section contributes one anchor, and
   progressFor maps raw scrollY onto a continuous scene index so the camera
   can be interpolated between waypoints instead of snapping per section. */
function measure(){
  SECS = [].slice.call(document.querySelectorAll('[data-cam]'));
  anchors = SECS.map(s => {
    const r = s.getBoundingClientRect();
    return Math.max(0, r.top + scrollY - (s.id === 'hero' ? 0 : vpH()*0.28));
  });
  document.documentElement.style.setProperty('--vw', vpW()+'px');
}
function progressFor(y){
  if (anchors.length < 2) return 0;
  for (let i = 0; i < anchors.length-1; i++){
    const a = anchors[i], b = anchors[i+1];
    if (y < b) return i + sat((y-a)/Math.max(1,b-a));
  }
  return anchors.length-1;
}

/* --------------------------------------------------------- 3 · video */
function makeVideo(src){
  const v = document.createElement('video');
  v.src = src; v.loop = true; v.muted = true; v.defaultMuted = true;
  v.playsInline = true; v.setAttribute('playsinline','');
  v.setAttribute('webkit-playsinline','');
  v.crossOrigin = 'anonymous'; v.preload = 'auto';
  v.style.position = 'fixed'; v.style.width = '1px'; v.style.height = '1px';
  v.style.opacity = '0'; v.style.pointerEvents = 'none'; v.style.left = '-10px';
  v.addEventListener('pause', () => { if (!document.hidden){ const p = v.play(); if (p && p.catch) p.catch(()=>{}); } });
  document.body.appendChild(v);
  return v;
}
/* --------------------------------------------------- 3b · frame sequence */
function frameSrc(i){
  return FRAMES_DIR + 'frame-' + String(i+1).padStart(FRAMES_PAD,'0') + '.webp';
}
function loadFrames(){
  return new Promise(resolve => {
    FRAMES.canvas = document.createElement('canvas');
    FRAMES.ctx = FRAMES.canvas.getContext('2d');
    let settled = false;
    const settle = () => { if (!settled){ settled = true; resolve(); } };
    for (let i = 0; i < FRAMES_COUNT; i++){
      const im = new Image();
      im.decoding = 'async';
      im.addEventListener('load', () => {
        FRAMES.loadedCount++;
        if (!FRAMES.firstReady){
          FRAMES.firstReady = true;
          FRAMES.aspect = im.naturalWidth / im.naturalHeight || FRAMES.aspect;
          FRAMES.canvas.width  = im.naturalWidth  || 1280;
          FRAMES.canvas.height = im.naturalHeight || 720;
          settle();
        }
      }, { once:true });
      im.src = frameSrc(i);
      FRAMES.imgs[i] = im;
    }
    /* never hang the preloader on a slow network */
    setTimeout(settle, 6000);
  });
}
function drawFrame(i){
  const im = FRAMES.imgs[i];
  if (!im || !im.complete || !im.naturalWidth) return;
  FRAMES.ctx.drawImage(im, 0, 0, FRAMES.canvas.width, FRAMES.canvas.height);
  if (FRAMES.tex) FRAMES.tex.needsUpdate = true;
}
function updateFrameTexture(){
  if (!FRAMES.firstReady || anchors.length < 2) return;
  const span = Math.max(1, CAM.length - 1);
  const t = sat(RIG.smooth / span);
  const idx = Math.min(FRAMES_COUNT - 1, Math.round(t * (FRAMES_COUNT - 1)));
  if (idx !== FRAMES.curIdx && FRAMES.imgs[idx] && FRAMES.imgs[idx].complete){
    FRAMES.curIdx = idx;
    drawFrame(idx);
  }
}

function loadVideos(){
  return new Promise(resolve => {
    VID.a = makeVideo('assets/video/1000093499.mp4');
    VID.a.addEventListener('loadedmetadata', () => {
      VID.aspA = (VID.a.videoWidth||16)/(VID.a.videoHeight||9);
      resolve();
    }, { once:true });
    /* never hang the preloader on a slow network or a blocked autoplay */
    setTimeout(resolve, 6000);
  });
}
function playVideos(){
  [VID.a].forEach(v => { const p = v && v.play(); if (p && p.catch) p.catch(()=>{}); });
}
/* a blocked autoplay policy only releases on a gesture */
function wireGesture(){
  const kick = () => { playVideos(); };
  ['pointerdown','touchstart','keydown','scroll'].forEach(e =>
    addEventListener(e, kick, { once:true, passive:true }));
}

/* ----------------------------------------------------------- 4 · GL */
function initGL(){
  const canvas = document.getElementById('gl');
  renderer = new THREE.WebGLRenderer({
    canvas, antialias:false, alpha:false, powerPreference:'high-performance',
    stencil:false, depth:true, preserveDrawingBuffer:false
  });
  gl = renderer.getContext();
  if (!gl) throw new Error('no webgl context');
  renderer.setClearColor(0x05070a, 1);
  renderer.autoClear = false;
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  else renderer.outputEncoding = THREE.sRGBEncoding;

  scene  = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05070a, 0.028);
  camera = new THREE.PerspectiveCamera(52, vpW()/vpH(), 0.1, 260);
  camera.position.set(0, 0, CAM[0].z);
}

/* ------------------------------------------------ 5 · the video plates
   Three plates. The two video plates sit at different depths, so the camera
   walk produces genuine parallax between them; the veil is the near plane
   and behaves exactly like Kage's WORLD.fg — it dissolves as the camera
   reaches it, so the walk goes *through* the layer instead of steering
   around it. */
const PLATE_SHADER = {
  vertex: `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }`,
  fragment: `
    precision highp float;
    uniform sampler2D uTex;
    uniform float uOpacity, uCover, uZoom, uT, uDrift, uWarm;
    uniform vec2  uPan;
    uniform vec3  uPrimary;
    varying vec2  vUv;

    void main(){
      /* cover-fit the video into the plate, then zoom and pan it — this is
         the second, texture-space half of the parallax: the near plate pans
         further per unit of scroll than the far one */
      vec2 uv = vUv - 0.5;
      uv.x *= uCover;
      uv /= uZoom;
      uv += uPan;
      uv += 0.5;

      /* a slow organic drift so a looping clip never reads as a loop */
      uv += vec2(sin(uT*0.07)*0.004, cos(uT*0.053)*0.003) * uDrift;

      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){
        gl_FragColor = vec4(0.02,0.027,0.039,uOpacity); return;
      }
      vec3 c = texture2D(uTex, uv).rgb;

      /* grade toward the studio palette: crush the base to the Kage ink,
         and let primaryColor warm the highlights so the vermilion accent in
         the DOM and the light in the video agree */
      float l = dot(c, vec3(0.2126,0.7152,0.0722));
      vec3 cool = mix(vec3(0.02,0.027,0.039), c, 0.86);
      vec3 warm = mix(cool, cool * (1.0 + uPrimary*0.85), smoothstep(0.42,1.0,l)*uWarm);
      gl_FragColor = vec4(warm, uOpacity);
    }`
};

function buildPlate(tex, aspect, z, scale){
  const geo = new THREE.PlaneGeometry(1,1,1,1);
  const mat = new THREE.ShaderMaterial({
    vertexShader: PLATE_SHADER.vertex,
    fragmentShader: PLATE_SHADER.fragment,
    uniforms: {
      uTex:{value:tex}, uOpacity:{value:1}, uCover:{value:1}, uZoom:{value:1},
      uPan:{value:new THREE.Vector2(0,0)}, uT:WORLD.uT, uDrift:{value:1},
      uWarm:{value:0.5}, uPrimary:{value:new THREE.Vector3(...hexToVec3(PRIMARY))}
    },
    transparent:true, depthWrite:false, depthTest:false
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.z = z;
  m.userData = { aspect, baseZ:z, scale, parallax: 1 - (z + 40) / 60 };
  m.renderOrder = -Math.round(z);
  scene.add(m);
  WORLD.plates.push(m);
  return m;
}

function buildPlates(){
  VID.texA = new THREE.VideoTexture(VID.a);
  FRAMES.tex = new THREE.CanvasTexture(FRAMES.canvas);
  drawFrame(0); FRAMES.curIdx = 0;
  [VID.texA, FRAMES.tex].forEach(t => {
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
    else t.encoding = THREE.sRGBEncoding;
  });

  /* far plate — the wide establishing bed, now a scroll-scrubbed frame sequence */
  buildPlate(FRAMES.tex, FRAMES.aspect, -34, 1.00);
  /* mid plate — the closer detail pass */
  buildPlate(VID.texA, VID.aspA, -17, 0.86);
  /* near plate — the mid clip again at a large scale, heavily darkened,
     standing in for Kage's near-plane cut-outs */
  const near = buildPlate(VID.texA, VID.aspA, -6.5, 0.62);
  near.material.uniforms.uWarm.value = 0.15;
  near.userData.veil = true;
  WORLD.veil = near;
}

/* ---------------------------------------------------- 6 · the embers
   Kage's ember points, kept: they are the only thing in the frame that is
   not the video, and they are what stops the background reading as a flat
   playing clip. */
function buildEmbers(){
  const N = LOW ? 180 : 520;
  const pos = new Float32Array(N*3), seed = new Float32Array(N);
  for (let i=0;i<N;i++){
    pos[i*3]   = (Math.random()-0.5)*44;
    pos[i*3+1] = (Math.random()-0.5)*26;
    pos[i*3+2] = -34 + Math.random()*32;
    seed[i]    = Math.random()*TAU;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  geo.setAttribute('aSeed',    new THREE.BufferAttribute(seed,1));

  const mat = new THREE.ShaderMaterial({
    uniforms:{ uT:WORLD.uT, uSize:{value:vpH()*0.5},
               uPrimary:{value:new THREE.Vector3(...hexToVec3(PRIMARY))},
               uFocus:{value:0} },
    vertexShader:`
      attribute float aSeed;
      uniform float uT, uSize;
      varying float vA;
      void main(){
        vec3 p = position;
        p.y += sin(uT*0.22 + aSeed)*1.4 + mod(uT*0.28 + aSeed, 22.0) - 11.0;
        p.x += cos(uT*0.17 + aSeed*1.7)*1.9;
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * (0.0016 + 0.0022*sin(aSeed)) / max(0.6,-mv.z);
        vA = 0.32 + 0.42*(sin(uT*1.5 + aSeed*3.1)*0.5+0.5);
      }`,
    fragmentShader:`
      precision mediump float;
      uniform vec3 uPrimary; uniform float uFocus;
      varying float vA;
      void main(){
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d);
        if (r > 0.5) discard;
        float a = smoothstep(0.5,0.0,r) * vA * (0.55 + uFocus*0.45);
        vec3 c = mix(vec3(1.0,0.86,0.72), uPrimary*1.5+vec3(0.25), 0.55);
        gl_FragColor = vec4(c, a);
      }`,
    transparent:true, depthWrite:false, depthTest:false,
    blending:THREE.AdditiveBlending
  });
  WORLD.embers = new THREE.Points(geo, mat);
  WORLD.embers.renderOrder = 20;
  scene.add(WORLD.embers);
}

/* ------------------------------------------------- 7 · the post pass
   One composite, as Kage does it: grade, vignette, animated grain, the
   scroll-driven defocus, and the intro fade. */
function initPost(){
  POST.scene = new THREE.WebGLRenderTarget(2,2,{
    minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter,
    type:THREE.UnsignedByteType, depthBuffer:true, stencilBuffer:false,
    samples: (!LOW && PERF.scale > .78) ? 2 : 0
  });
  POST.cam = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  POST.comp = new THREE.ShaderMaterial({
    uniforms:{
      uTex:{value:POST.scene.texture}, uT:{value:0}, uFade:{value:0},
      uBlur:{value:0}, uPx:{value:new THREE.Vector2(1,1)},
      uPrimary:{value:new THREE.Vector3(...hexToVec3(PRIMARY))}
    },
    vertexShader:`
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = vec4(position.xy,0.0,1.0); }`,
    fragmentShader:`
      precision highp float;
      uniform sampler2D uTex;
      uniform float uT, uFade, uBlur;
      uniform vec2  uPx;
      uniform vec3  uPrimary;
      varying vec2  vUv;

      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

      void main(){
        vec2 uv = vUv;

        /* a cheap 5-tap defocus, opened by the scroll — the deeper chapters
           sit further into the frame, so the plate behind them softens */
        vec2 t = uBlur / uPx * 2.4;
        vec3 c = texture2D(uTex, uv).rgb * 0.36;
        c += texture2D(uTex, uv + vec2( t.x, 0.0)).rgb * 0.16;
        c += texture2D(uTex, uv + vec2(-t.x, 0.0)).rgb * 0.16;
        c += texture2D(uTex, uv + vec2( 0.0, t.y)).rgb * 0.16;
        c += texture2D(uTex, uv + vec2( 0.0,-t.y)).rgb * 0.16;

        /* a whisper of lateral aberration, warm side toward primaryColor */
        float ab = 0.0011 + uBlur*0.0022;
        c.r = mix(c.r, texture2D(uTex, uv + vec2(ab,0.0)).r, 0.5);
        c.b = mix(c.b, texture2D(uTex, uv - vec2(ab,0.0)).b, 0.5);

        /* vignette */
        vec2 q = (uv - 0.5) * vec2(1.06,1.0);
        c *= 1.0 - smoothstep(0.30, 0.88, dot(q,q)) * 0.62;

        /* ember lift in the shadows so the accent reads through the black */
        float l = dot(c, vec3(0.2126,0.7152,0.0722));
        c += uPrimary * (1.0 - smoothstep(0.0,0.30,l)) * 0.030;

        /* grain */
        float g = hash(uv*uPx + fract(uT)*97.3) - 0.5;
        c += g * 0.030;

        gl_FragColor = vec4(c * uFade, 1.0);
      }`,
    depthTest:false, depthWrite:false
  });
  POST.quad = new THREE.Mesh(new THREE.PlaneGeometry(2,2), POST.comp);
  POST.quad.frustumCulled = false;
}

/* --------------------------------------------------- 8 · layout / fit */
function fitPlates(){
  const vAsp = vpW()/vpH();
  WORLD.plates.forEach(m => {
    const u = m.userData;
    const dist = Math.abs(camera.position.z - m.position.z);
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov)/2) * dist;
    const w = h * vAsp;
    /* over-scale so the plate still covers the frame at the widest waypoint
       and while the mouse parallax pushes it around */
    const over = 1.34;
    m.scale.set(w*over*u.scale/Math.max(.4,u.scale), h*over, 1);
    m.scale.set(w*over, h*over, 1);
    m.material.uniforms.uCover.value = vAsp / u.aspect;
  });
}

function resize(){
  const w = vpW(), h = vpH();
  const dpr = Math.min(devicePixelRatio || 1, LOW ? 1.5 : 2) * PERF.scale;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
  const pw = Math.max(2, Math.round(w*dpr)), ph = Math.max(2, Math.round(h*dpr));
  if (POST.scene) POST.scene.setSize(pw, ph);
  if (POST.comp)  POST.comp.uniforms.uPx.value.set(pw, ph);
  if (POST.scene){
    const want = (!LOW && PERF.scale > .78) ? 2 : 0;
    if (POST.scene.samples !== want){ POST.scene.samples = want; POST.scene.dispose(); }
  }
  if (WORLD.embers) WORLD.embers.material.uniforms.uSize.value = h * renderer.getPixelRatio() * 0.5;
  fitPlates();
  measure();
}

/* ---------------------------------------------- 9 · the camera walk */
function applyCamera(){
  const p  = clamp(RIG.smooth, 0, CAM.length-1);
  const i  = Math.min(CAM.length-2, Math.floor(p));
  const t  = easeOut(sat(p - i));
  const A  = CAM[i], B = CAM[i+1];

  const intro = easeOut(RIG.intro);
  const zPush = (1 - intro) * 7.5;          /* the opening dolly in */

  camera.fov = lerp(A.fov, B.fov, t);
  camera.updateProjectionMatrix();
  camera.position.set(
    RIG.mx * 0.85,
    lerp(A.y, B.y, t) + RIG.my * 0.45,
    lerp(A.z, B.z, t) + zPush
  );
  camera.rotation.set(
    lerp(A.rx, B.rx, t) - RIG.my * 0.020,
    -RIG.mx * 0.024,
    0
  );

  /* which plate leads. Crossfade on the plate opacities so the depth
     layers trade the frame across the scroll rather than cutting. */
  const lead = lerp(A.plate, B.plate, t);
  WORLD.plates.forEach((m, k) => {
    const u = m.userData;
    /* texture-space parallax: the nearer the plate, the further it pans */
    const depth = 1 - (m.position.z + 40)/42;
    m.material.uniforms.uPan.value.set(
      RIG.mx * 0.026 * depth,
      -RIG.my * 0.020 * depth + (RIG.smooth * 0.012 * depth)
    );
    m.material.uniforms.uZoom.value = 1 + RIG.smooth*0.035*depth + (1-intro)*0.08;

    let a;
    if (k === 0)      a = 1;                              /* far bed, always on */
    else if (k === 1) a = 0.34 + lead * 0.60;             /* the mid clip leads  */
    else {                                                 /* the veil dissolves */
      a = smooth(0.9, 4.6, camera.position.z - m.position.z) * 0.42;
    }
    m.material.uniforms.uOpacity.value = a * (0.4 + 0.6*intro);
    m.visible = m.material.uniforms.uOpacity.value > 0.006;
  });

  if (POST.comp) POST.comp.uniforms.uBlur.value = lerp(A.blur, B.blur, t);
}

function updateWorld(dt){
  WORLD.uT.value = clock;
  RIG.focusAmt = damp(RIG.focusAmt, RIG.focus >= 0 ? 1 : 0, 5, dt);
  if (WORLD.embers) WORLD.embers.material.uniforms.uFocus.value = RIG.focusAmt;
}

/* ------------------------------------------------------ 10 · frame */
function render(){
  renderer.setRenderTarget(POST.scene);
  renderer.clear(true,true,false);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  POST.comp.uniforms.uT.value = clock;
  POST.comp.uniforms.uFade.value = fadeIn;
  renderer.render(POST.quad, POST.cam);
}

function frame(now){
  if (!running) return;
  const rawDt = (now - tPrev)/1000 || 0;
  const dt = Math.min(rawDt, 0.05);
  tPrev = now; clock += dt;
  fadeIn = INTRO.t0 ? sat((now - INTRO.t0)/700) : 1;

  /* the governor, unchanged from Kage: read the truthful frame time, shed
     resolution when it slips, take it back when it recovers */
  if (!PERF.locked && clock > 2.2){
    PERF.acc += rawDt; PERF.n++;
    if (PERF.n >= 40 || PERF.acc > 0.9){
      const avg = PERF.acc/PERF.n; PERF.acc = 0; PERF.n = 0;
      if (avg > 0.0230 && PERF.scale > 0.55){
        PERF.scale = Math.max(0.55, PERF.scale * (avg > 0.05 ? 0.64 : 0.85)); resize();
      } else if (avg < 0.0138 && PERF.scale < 1){
        PERF.scale = Math.min(1, PERF.scale + 0.08); resize();
      }
    }
  }

  RIG.prog   = progressFor(scrollY);
  RIG.smooth = REDUCE ? RIG.prog : damp(RIG.smooth, RIG.prog, 5.2, dt);
  RIG.mx = damp(RIG.mx, RIG.tmx, 2.6, dt);
  RIG.my = damp(RIG.my, RIG.tmy, 2.6, dt);
  if (INTRO.t0) RIG.intro = sat((now - INTRO.t0)/1000/2.4);

  applyCamera();
  updateWorld(dt);
  updateFrameTexture();
  render();
  raf = requestAnimationFrame(frame);
}

/* --------------------------------------------------- 11 · public API */
function pointer(nx, ny){
  if (COARSE) return;
  RIG.tmx = clamp(nx, -1, 1);
  RIG.tmy = clamp(ny, -1, 1);
}
function focus(i){ RIG.focus = (typeof i === 'number') ? i : -1; }
function scrollToScene(i){
  const n = clamp(i|0, 0, Math.max(0, anchors.length-1));
  scrollTo({ top: anchors[n], behavior: REDUCE ? 'auto' : 'smooth' });
}
function sceneIndex(){ return Math.round(RIG.smooth); }
function anchorList(){ return anchors.slice(); }

/* the preloader job list, in Kage's shape: [label, fn] */
const JOBS = [
  ['Reading the type',      () => document.fonts && document.fonts.load('400 46px Onest')],
  ['Loading the plates',    () => Promise.all([loadVideos(), loadFrames()])],
  ['Pouring the ground',    () => { initGL(); }],
  ['Setting the backdrop',  () => { buildPlates(); }],
  ['Lighting the embers',   () => { buildEmbers(); }],
  ['Polishing the resin',   () => { initPost(); measure(); fitPlates(); }]
];

function start(){
  addEventListener('resize', resize, { passive:true });
  addEventListener('orientationchange', () => setTimeout(resize, 250));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden){ running = false; cancelAnimationFrame(raf);
      [VID.a].forEach(v => v && v.pause()); }
    else if (!running){ running = true; playVideos();
      tPrev = performance.now(); raf = requestAnimationFrame(frame); }
  });
  resize();
  playVideos(); wireGesture();
  running = true; tPrev = performance.now();
  INTRO.t0 = REDUCE ? performance.now() - 4000 : performance.now();
  raf = requestAnimationFrame(frame);
  window.__memora = { RIG, WORLD, POST, VID, CAM, renderer, scene, camera,
                      anchors: anchorList };
}

return { JOBS, start, resize, measure, pointer, focus, scrollToScene,
         sceneIndex, anchors: anchorList, REDUCE, COARSE };
})();
