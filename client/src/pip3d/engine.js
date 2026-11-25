// Pip in real-time 3D (three.js), ported from the Pip Maker prototype. Two kinds: a "blob"
// creature with PBR materials, and an anime chibi with toon shading, outlines, a canvas-drawn
// face, hair locks, animal ears and tails, outfits, extras, moods with little effects, and things
// to do (study, drawing at an easel, writing, a cocoa break, bedtime).
//
// Pip looks around on its own (mostly at you); it never follows the pointer and no camera is used.
// Drag turns it round. `still` stops all movement (reduced motion). Rendering only runs while
// something moves and the stage is active, pauses while the page is hidden, and `dispose()` frees
// every GL resource.
//
// Plain JavaScript with its types in engine.d.ts. Load it with a dynamic import so three.js stays
// out of the main bundle.

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { DEFAULT_LOOK, HAIR, IRIS, OUTFIT, PALETTES, SKIN, normaliseLook } from "./look";

const toState = (look) => { const l = normaliseLook(look); return { ...l, wear: new Set(l.wear) }; };

/** True when this browser can draw WebGL at all. */
export function webglAvailable() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

export function createPipStage(canvas, look = DEFAULT_LOOK, opts = {}) {
let state = toState(look);
if (opts.mood) state.mood = opts.mood;
if (opts.activity) state.activity = opts.activity;
let still = !!opts.still, active = opts.active !== false, disposed = false;
let yaw = -0.25, yawV = 0, dragging = false, lastX = 0;
let need = true, running = false, raf = 0;
// framing "portrait": the live view is framed on the head and shoulders (small previews), like a profile picture.
let portraitBox = null;

// ── renderer ─────────────────────────────────────────────────────────────────────
// ── renderer ─────────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50); camera.position.set(0, 0.25, 6.2);
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-3, 4, 5); scene.add(key);
const rim = new THREE.DirectionalLight(0xffc6e8, 1.2); rim.position.set(3, 2, -4); scene.add(rim);
scene.add(new THREE.HemisphereLight(0xfbeaf6, 0x2a1020, 0.5));

// A tall stage steps the camera back, so wide things (the bed, the easel) still fit across it.
function resize(){ const r = canvas.parentElement.getBoundingClientRect(); if (!r.width || !r.height) return; renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height;
  if (portraitBox) { aimAt(portraitBox, "portrait"); return; }
  camera.position.set(0, 0.25, Math.min(9, 6.2 / Math.min(1, camera.aspect))); camera.lookAt(0, 0.25, 0); camera.updateProjectionMatrix(); }
const ro = new ResizeObserver(() => { resize(); invalidate(); }); ro.observe(canvas.parentElement);

// ── textures ─────────────────────────────────────────────────────────────────────
function canvasTex(w, h, draw, color = true){ const cv = document.createElement("canvas"); cv.width = w; cv.height = h; draw(cv.getContext("2d"), w, h); const t = new THREE.CanvasTexture(cv); if (color) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function patternTex(pal, pattern){
  const [a,b,c] = PALETTES[pal].c;
  return canvasTex(1024, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, a); gr.addColorStop(.55, b); gr.addColorStop(1, c); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    let rnd = 7; const R = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
    if (pattern === "galaxy"){
      const gg = g.createLinearGradient(0,0,w,h); gg.addColorStop(0,"#2E2470"); gg.addColorStop(.5,"#5B3596"); gg.addColorStop(1,"#B5509A"); g.globalAlpha = pal === "galaxy" ? 0.0 : 0.85; g.fillStyle = gg; g.fillRect(0,0,w,h); g.globalAlpha = 1;
      for (let i=0;i<14;i++){ const x=R()*w,y=R()*h,r=60+R()*140; const n=g.createRadialGradient(x,y,0,x,y,r); n.addColorStop(0,"rgba(255,170,230,.25)"); n.addColorStop(1,"rgba(255,170,230,0)"); g.fillStyle=n; g.fillRect(x-r,y-r,2*r,2*r); }
      for (let i=0;i<420;i++){ const x=R()*w,y=R()*h,s=R()<.08?2.6:R()*1.4+.4; g.fillStyle=`rgba(255,248,225,${.5+R()*.5})`; g.beginPath(); g.arc(x,y,s,0,7); g.fill(); }
    } else if (pattern === "spots"){
      g.fillStyle = "rgba(255,255,255,.55)"; for (let i=0;i<70;i++){ const x=R()*w,y=R()*h*.9+h*.05,r=14+R()*26; g.beginPath(); g.ellipse(x,y,r,r*.85,0,0,7); g.fill(); }
    } else if (pattern === "stripes"){
      g.fillStyle = "rgba(255,255,255,.42)"; for (let y=20;y<h;y+=64){ g.beginPath(); g.moveTo(0,y); for (let x=0;x<=w;x+=16) g.lineTo(x, y + Math.sin(x/70)*8); g.lineTo(w, y+24); for (let x=w;x>=0;x-=16) g.lineTo(x, y+24 + Math.sin(x/70)*8); g.fill(); }
    }
  });
}
const noiseNormal = canvasTex(256, 256, (g,w,h) => { const d = g.createImageData(w,h); for (let i=0;i<d.data.length;i+=4){ const n = 128 + (Math.random()-.5)*60; d.data[i]=n; d.data[i+1]=128+(Math.random()-.5)*60; d.data[i+2]=255; d.data[i+3]=255; } g.putImageData(d,0,0); }, false);
noiseNormal.wrapS = noiseNormal.wrapT = THREE.RepeatWrapping; noiseNormal.repeat.set(6, 3);
const shadowTex = canvasTex(256, 256, (g,w,h) => { const r = g.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2); r.addColorStop(0,"rgba(0,0,0,.55)"); r.addColorStop(1,"rgba(0,0,0,0)"); g.fillStyle=r; g.fillRect(0,0,w,h); });

// ── materials ────────────────────────────────────────────────────────────────────
const bodyMat = new THREE.MeshPhysicalMaterial({ color:0xffffff });
function applyStyle(){
  const s = state.style; bodyMat.map?.dispose();
  if (state.kind === "chibi") { bodyMat.map = null; bodyMat.color.set(SKIN[state.skin]); } else { bodyMat.color.set("#ffffff"); bodyMat.map = patternTex(state.palette, state.pattern); }
  Object.assign(bodyMat, { roughness:.35, metalness:0, clearcoat:0, clearcoatRoughness:.1, sheen:0, sheenRoughness:.6, normalMap:null, normalScale:new THREE.Vector2(.25,.25) });
  if (s === "glossy") Object.assign(bodyMat, { roughness:.32, clearcoat:state.kind === "chibi" ? .35 : 1, clearcoatRoughness:.06 });
  if (s === "clay")   Object.assign(bodyMat, { roughness:.88, normalMap:noiseNormal, normalScale:new THREE.Vector2(.12,.12) });
  if (s === "plush")  Object.assign(bodyMat, { roughness:1, sheen:state.kind === "chibi" ? .4 : 1, sheenRoughness:.75, sheenColor:new THREE.Color("#FFE9F6"), normalMap:noiseNormal, normalScale:new THREE.Vector2(.45,.45) });
  bodyMat.needsUpdate = true;
}
const dark = new THREE.MeshPhysicalMaterial({ color:"#2A1C27", roughness:.25, clearcoat:1, clearcoatRoughness:.05 });
const irisMat = new THREE.MeshPhysicalMaterial({ color:"#2A1C27", roughness:.25, clearcoat:1, clearcoatRoughness:.05 });
const pupilMat = new THREE.MeshBasicMaterial({ color:"#1A1018" });
const hairMat = new THREE.MeshPhysicalMaterial({ color:"#2B2233", roughness:.55, clearcoat:.25, clearcoatRoughness:.35 });
const outfitMat = new THREE.MeshPhysicalMaterial({ color:"#CDA4E8", roughness:.9, sheen:.8, sheenColor:new THREE.Color("#ffffff"), sheenRoughness:.7 });
const shoeMat = new THREE.MeshPhysicalMaterial({ color:"#F4E9D8", roughness:.5, clearcoat:.4 });
const white = new THREE.MeshBasicMaterial({ color:"#FFFFFF" });
const mouthMat = new THREE.MeshStandardMaterial({ color:"#5A2338", roughness:.6 });
const tongueMat = new THREE.MeshStandardMaterial({ color:"#E46A7E", roughness:.6 });
const cheekMat = new THREE.MeshBasicMaterial({ color:"#FF8FA8", transparent:true, opacity:.45, depthWrite:false });
const pinkInner = new THREE.MeshStandardMaterial({ color:"#F7C9DD", roughness:.8 });
const beanieMat = new THREE.MeshPhysicalMaterial({ color:"#E3A91C", roughness:.9, sheen:.5, sheenColor:new THREE.Color("#ffe08a"), sheenRoughness:.8 });
const scarfMat = new THREE.MeshPhysicalMaterial({ color:"#7FD0C9", roughness:.9, sheen:1, sheenColor:new THREE.Color("#e6fffb") });
const frameMat = new THREE.MeshPhysicalMaterial({ color:"#2A1C27", roughness:.3, clearcoat:1 });
const lensMat = new THREE.MeshPhysicalMaterial({ color:"#ffffff", roughness:.05, transmission:0, transparent:true, opacity:.18 });
const phoneMat = new THREE.MeshPhysicalMaterial({ color:"#3A2434", roughness:.4, clearcoat:.6 });

// ── Pip ──────────────────────────────────────────────────────────────────────────
const root = new THREE.Group(); scene.add(root);
const pip = new THREE.Group(); root.add(pip);
// blob body: a sphere pushed into a soft egg with a flatter base
const bodyGeo = new THREE.SphereGeometry(1, 128, 96);
{ const p = bodyGeo.attributes.position; const v = new THREE.Vector3();
  for (let i=0;i<p.count;i++){ v.fromBufferAttribute(p,i); let y=v.y;
    const widen = 1 + 0.10*Math.max(0,-y) - 0.06*Math.max(0,y);
    v.x*=widen*1.02; v.z*=widen*0.96;
    if (y < -0.55) y = -0.55 + (y+0.55)*0.45;
    v.y = y*0.96; p.setXYZ(i,v.x,v.y,v.z); }
  bodyGeo.computeVertexNormals(); }
const head = new THREE.Group(); pip.add(head);
const body = new THREE.Mesh(bodyGeo, bodyMat); head.add(body);
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), new THREE.MeshBasicMaterial({ map:shadowTex, transparent:true, depthWrite:false }));
shadow.rotation.x = -Math.PI/2; shadow.position.y = -0.83; root.add(shadow);

// face on the front surface
const face = new THREE.Group(); face.position.set(0, 0.06, 0.93); head.add(face);
function eye(x){ const g = new THREE.Group(); g.position.x = x;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.105, 32, 24), irisMat); ball.scale.set(1, 1.5, .55); g.add(ball);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(.055, 24, 16), pupilMat); pupil.scale.set(1, 1.5, .3); pupil.position.z = .035; g.add(pupil);
  const hi = new THREE.Mesh(new THREE.SphereGeometry(.032, 16, 12), white); hi.position.set(-.035, .07, .06); g.add(hi);
  const hi2 = new THREE.Mesh(new THREE.SphereGeometry(.015, 12, 8), white); hi2.position.set(.035, -.05, .06); g.add(hi2);
  g.userData = { ball }; return g; }
const eyes = new THREE.Group(); face.add(eyes);
const eL = eye(-.25), eR = eye(.25); eyes.add(eL, eR);
// happy / sleepy eye arcs
function arc(r, up){ const m = new THREE.Mesh(new THREE.TorusGeometry(r, .028, 12, 32, Math.PI), dark); if (!up) m.rotation.z = Math.PI; return m; }
const happyEyes = new THREE.Group(); face.add(happyEyes);
{ const a = arc(.09, true); a.position.set(-.25, -.02, 0); const b = arc(.09, true); b.position.set(.25, -.02, 0); happyEyes.add(a, b); }
const sleepyEyes = new THREE.Group(); face.add(sleepyEyes);
{ const a = arc(.09, false); a.position.set(-.25, .03, 0); const b = arc(.09, false); b.position.set(.25, .03, 0); sleepyEyes.add(a, b); }
// heart eyes (loving)
const heartEyes = new THREE.Group(); face.add(heartEyes); heartEyes.visible = false;
{ const s = .11, sh = new THREE.Shape(); sh.moveTo(0, -s * .9); sh.bezierCurveTo(-s * 1.6, s * .1, -s * .9, s * 1.25, 0, s * .45); sh.bezierCurveTo(s * .9, s * 1.25, s * 1.6, s * .1, 0, -s * .9);
  const hg = new THREE.ExtrudeGeometry(sh, { depth: .03, bevelEnabled: true, bevelThickness: .02, bevelSize: .015, bevelSegments: 3, curveSegments: 20 }); hg.center();
  const hm = new THREE.MeshPhysicalMaterial({ color: "#FF5C8A", roughness: .3, clearcoat: 1 });
  for (const x of [-.25, .25]) { const h = new THREE.Mesh(hg, hm); h.position.set(x, 0, .02); heartEyes.add(h); } }
// cheeks
const blobCheeks = [];
for (const x of [-.47, .47]) { const ch = new THREE.Mesh(new THREE.CircleGeometry(.1, 32), cheekMat); ch.scale.set(1.25, .8, 1); ch.position.set(x, -.17, -.06); ch.rotation.y = x * .55; face.add(ch); blobCheeks.push(ch); }
// mouths
const mouths = new THREE.Group(); face.add(mouths); mouths.position.set(0, -.27, .0);
const smile = new THREE.Mesh(new THREE.TorusGeometry(.085, .022, 12, 32, Math.PI), mouthMat); smile.rotation.z = Math.PI; mouths.add(smile);
const open = new THREE.Group(); mouths.add(open);
const openM = new THREE.Mesh(new THREE.SphereGeometry(.1, 32, 24), mouthMat); openM.scale.set(1, .8, .35); open.add(openM);
const tongue = new THREE.Mesh(new THREE.SphereGeometry(.06, 24, 16), tongueMat); tongue.scale.set(1.1, .55, .3); tongue.position.set(0, -.04, .02); open.add(tongue);
const flat = new THREE.Mesh(new THREE.CapsuleGeometry(.018, .11, 6, 12), mouthMat); flat.rotation.z = Math.PI/2; mouths.add(flat);
const smirk = new THREE.Mesh(new THREE.TorusGeometry(.06, .02, 12, 24, Math.PI*.8), mouthMat); smirk.rotation.z = Math.PI*1.1; smirk.position.x = .08; mouths.add(smirk);
const tongueOut = new THREE.Mesh(new THREE.SphereGeometry(.045, 20, 14), tongueMat); tongueOut.scale.set(1, 1.25, .45); tongueOut.position.set(.025, -.075, .01); mouths.add(tongueOut);

// parts (built once, shown on demand) — all real 3D, using the body material so patterns carry on
const parts = {};
function earPair(make){ const g = new THREE.Group(); for (const s of [-1, 1]) { const e = make(s); g.add(e); } return g; }
parts.fox = earPair(s => { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.ConeGeometry(.26, .62, 48), bodyMat); g.add(c);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(.15, .38, 32), pinkInner); inner.position.set(0, -.04, .09); inner.scale.z = .5; g.add(inner);
  g.position.set(s*.5, .9, -.05); g.rotation.z = -s*.42; g.rotation.x = -.08; return g; });
parts.cat = earPair(s => { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.ConeGeometry(.22, .36, 4), bodyMat); c.rotation.y = Math.PI/4; g.add(c);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(.12, .22, 4), pinkInner); inner.rotation.y = Math.PI/4; inner.position.set(0, -.02, .08); inner.scale.z = .5; g.add(inner);
  g.position.set(s*.52, .85, 0); g.rotation.z = -s*.35; return g; });
parts.bunny = earPair(s => { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.CapsuleGeometry(.14, .72, 12, 32), bodyMat); c.scale.z = .6; g.add(c);
  const inner = new THREE.Mesh(new THREE.CapsuleGeometry(.075, .55, 8, 24), pinkInner); inner.position.z = .07; inner.scale.z = .4; g.add(inner);
  g.position.set(s*.3, 1.25, -.05); g.rotation.z = -s*.18; g.rotation.x = -.12; return g; });
parts.bear = earPair(s => { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.SphereGeometry(.22, 32, 24), bodyMat); c.scale.z = .7; g.add(c);
  const inner = new THREE.Mesh(new THREE.SphereGeometry(.12, 24, 16), pinkInner); inner.position.z = .09; inner.scale.z = .4; g.add(inner);
  g.position.set(s*.6, .78, -.05); return g; });
parts.beanie = (() => { const g = new THREE.Group();
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1.02, 64, 32, 0, Math.PI*2, 0, Math.PI*.29), beanieMat); cap.position.y = .05; g.add(cap);
  const brim = new THREE.Mesh(new THREE.TorusGeometry(.79, .1, 20, 64), beanieMat); brim.rotation.x = Math.PI/2; brim.position.y = .66; brim.scale.set(.86,.86,.8); g.add(brim);
  const pom = new THREE.Mesh(new THREE.SphereGeometry(.17, 32, 24), beanieMat); pom.position.y = 1.1; g.add(pom); return g; })();
parts.scarf = (() => { const g = new THREE.Group();
  const loop = new THREE.Mesh(new THREE.TorusGeometry(.96, .13, 20, 72), scarfMat); loop.rotation.x = Math.PI/2; loop.position.y = -.36; loop.scale.set(1.04, 1, 1); g.add(loop);
  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .42, 8, 16), scarfMat); tail.position.set(.45, -.62, .78); tail.rotation.z = .25; tail.scale.z = .55; g.add(tail); return g; })();
parts.glasses = (() => { const g = new THREE.Group(); g.position.set(0, .07, .98);
  for (const x of [-.25, .25]) { const r = new THREE.Mesh(new THREE.TorusGeometry(.16, .022, 12, 40), frameMat); r.position.x = x; g.add(r);
    const l = new THREE.Mesh(new THREE.CircleGeometry(.155, 32), lensMat); l.position.set(x, 0, -.005); g.add(l); }
  const bridge = new THREE.Mesh(new THREE.TorusGeometry(.06, .016, 8, 16, Math.PI), frameMat); bridge.position.y = .03; g.add(bridge); return g; })();
parts.headphones = (() => { const g = new THREE.Group();
  const band = new THREE.Mesh(new THREE.TorusGeometry(.98, .05, 16, 64, Math.PI), phoneMat); band.position.y = .12; g.add(band);
  for (const s of [-1, 1]) { const cup = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, .16, 40), phoneMat); cup.rotation.z = Math.PI/2; cup.position.set(s*1.0, .1, 0); g.add(cup);
    const pad = new THREE.Mesh(new THREE.TorusGeometry(.16, .05, 12, 32), new THREE.MeshPhysicalMaterial({ color:"#F7A055", roughness:.8 })); pad.rotation.y = Math.PI/2; pad.position.set(s*.93, .1, 0); g.add(pad); }
  return g; })();
parts.wolf = earPair(s => { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.ConeGeometry(.24, .7, 48), bodyMat); c.scale.z = .7; g.add(c);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(.13, .42, 32), pinkInner); inner.position.set(0, -.06, .08); inner.scale.z = .45; g.add(inner);
  g.position.set(s*.47, .95, -.05); g.rotation.z = -s*.3; g.rotation.x = -.15; return g; });
for (const k in parts) { parts[k].visible = false; head.add(parts[k]); }

// ── anime chibi: hair on the head, a small body below ────────────────────────────
const hair = new THREE.Group(); head.add(hair);
const hairBack = new THREE.Mesh(new THREE.SphereGeometry(1.08, 64, 32, Math.PI, Math.PI, 0, Math.PI*.72), hairMat); hair.add(hairBack);
const hairTop = new THREE.Mesh(new THREE.SphereGeometry(1.085, 64, 32, 0, Math.PI*2, 0, Math.PI*.34), hairMat); hair.add(hairTop);
const bangs = new THREE.Group(); hair.add(bangs);
for (let i = -3; i <= 3; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(.3, 32, 20), hairMat); const a = i * .24; b.position.set(Math.sin(a) * .84, .6 - Math.abs(i) * .035 - (i % 2 ? .05 : 0), Math.cos(a) * .8); b.scale.set(.85, .72, .42); b.rotation.y = a; b.rotation.z = -i * .1; bangs.add(b); }
for (const sx of [-1, 1]) { const side = new THREE.Mesh(new THREE.CapsuleGeometry(.2, .55, 8, 16), hairMat); side.position.set(sx * .92, .05, .25); side.rotation.z = sx * .08; side.scale.z = .5; bangs.add(side); }
const longHair = new THREE.Mesh(new THREE.CapsuleGeometry(.62, 1.1, 12, 32), hairMat); longHair.position.set(0, -.75, -.55); longHair.scale.set(1.05, 1, .5); hair.add(longHair);
const twin = new THREE.Group(); hair.add(twin);
for (const sx of [-1, 1]) { const t = new THREE.Mesh(new THREE.CapsuleGeometry(.24, .9, 8, 24), hairMat); t.position.set(sx * 1.08, -.45, -.15); t.rotation.z = sx * .28; twin.add(t);
  const tie = new THREE.Mesh(new THREE.SphereGeometry(.12, 16, 12), shoeMat); tie.position.set(sx * 1.0, .12, -.15); twin.add(tie); }
const bob = new THREE.Mesh(new THREE.SphereGeometry(1.14, 64, 32, 0, Math.PI*2, Math.PI*.28, Math.PI*.36), hairMat); bob.scale.set(1.02, 1, .96); hair.add(bob);

const chibi = new THREE.Group(); pip.add(chibi);
const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.3, .2, 12, 32), outfitMat); torso.position.y = -.14; chibi.add(torso);
const hood = new THREE.Mesh(new THREE.TorusGeometry(.24, .07, 12, 32), outfitMat); hood.rotation.x = Math.PI/2; hood.position.y = .13; chibi.add(hood);
const pocket = new THREE.Mesh(new THREE.CapsuleGeometry(.05, .2, 6, 12), new THREE.MeshPhysicalMaterial({ color:"#ffffff", transparent:true, opacity:.25, roughness:.9 })); pocket.rotation.z = Math.PI/2; pocket.position.set(0, -.22, .29); chibi.add(pocket);
for (const sx of [-1, 1]) {
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.09, .22, 8, 16), outfitMat); arm.position.set(sx * .34, -.1, 0); arm.rotation.z = sx * .55; chibi.add(arm);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(.08, 16, 12), bodyMat); hand.position.set(sx * .44, -.25, .02); chibi.add(hand);
  const leg = new THREE.Mesh(new THREE.CapsuleGeometry(.1, .1, 8, 16), outfitMat); leg.position.set(sx * .13, -.44, 0); chibi.add(leg);
  const shoe = new THREE.Mesh(new THREE.SphereGeometry(.12, 20, 14), shoeMat); shoe.scale.set(1, .7, 1.3); shoe.position.set(sx * .13, -.57, .04); chibi.add(shoe);
}
const tails = {};
{ const mk = (geo, pos, rot, sc) => { const m = new THREE.Mesh(geo, hairMat); m.position.set(...pos); m.rotation.set(...rot); if (sc) m.scale.set(...sc); return m; };
  tails.wolf = mk(new THREE.CapsuleGeometry(.14, .5, 8, 20), [0, -.3, -.42], [-.9, 0, .25], [1, 1, .85]);
  tails.fox = new THREE.Group(); tails.fox.add(mk(new THREE.CapsuleGeometry(.16, .5, 8, 20), [0, -.3, -.44], [-.8, 0, .3]));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(.13, 16, 12), new THREE.MeshPhysicalMaterial({ color:"#FFF6EE", roughness:.6 })); tip.position.set(.1, -.06, -.66); tails.fox.add(tip);
  tails.cat = mk(new THREE.CapsuleGeometry(.05, .7, 6, 12), [0, -.2, -.42], [-.6, 0, .4]);
  tails.bunny = mk(new THREE.SphereGeometry(.12, 16, 12), [0, -.38, -.3], [0, 0, 0]);
  tails.bear = mk(new THREE.SphereGeometry(.09, 16, 12), [0, -.38, -.3], [0, 0, 0]);
  for (const k in tails) { tails[k].visible = false; chibi.add(tails[k]); } }

// ── ANIME CHIBI v2: cel shading, outlines, layered anime eyes, tapered hair locks, mitten hands, props ──
const chibiRoot = new THREE.Group(); chibiRoot.visible = false; root.add(chibiRoot);
const hemi = scene.children.find(o => o.isHemisphereLight);
const toonRamp = (() => { const d = new Uint8Array([120, 120, 200, 255]); const t = new THREE.DataTexture(d, 4, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: toonRamp });
const skinRamp = (() => { const d = new Uint8Array([228, 228, 246, 255]); const t = new THREE.DataTexture(d, 4, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
const skinToon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: skinRamp });
const lighten = (hex, k) => { const c = new THREE.Color(hex); c.lerp(new THREE.Color("#ffffff"), k); return c; };
const darken = (hex, k) => { const c = new THREE.Color(hex); c.lerp(new THREE.Color("#140a12"), k); return c; };
function outlineMaterial(width, color = "#2A1C27") {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>\n transformed += normalize(normal) * ${width.toFixed(4)};`); };
  return m;
}
const OL = { thick: outlineMaterial(0.035), mid: outlineMaterial(0.022), thin: outlineMaterial(0.012) };
function withOutline(mesh, kind = "mid", color) {
  const mat = color ? outlineMaterial({ thick: .035, mid: .022, thin: .012 }[kind], color) : OL[kind];
  const o = new THREE.Mesh(mesh.geometry, mat); o.renderOrder = -1; mesh.add(o); return mesh;
}
const sph = (theta, a, r = 1) => new THREE.Vector3(Math.sin(theta) * Math.sin(a) * r, Math.cos(theta) * r, Math.sin(theta) * Math.cos(a) * r);

// a tapered, flattened hair lock (or tail) along a curve; flat side faces away from `center`
function lockGeo(points, rMax, flat = .5, center = new THREE.Vector3(), seg = 28, radial = 10, baseFrac = .55) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => p.isVector3 ? p : new THREE.Vector3(...p)), false, "centripetal");
  const pos = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, P = curve.getPointAt(t), T = curve.getTangentAt(t).normalize();
    let O = P.clone().sub(center); O.sub(T.clone().multiplyScalar(O.dot(T))); if (O.lengthSq() < 1e-6) O.set(0, 0, 1); O.normalize();
    const S = new THREE.Vector3().crossVectors(T, O).normalize();
    const r = rMax * Math.pow(Math.sin(Math.PI * (baseFrac * .32 + (1 - baseFrac * .32) * t)), .85);
    for (let j = 0; j < radial; j++) { const a = j / radial * Math.PI * 2, cx = Math.cos(a) * r, cy = Math.sin(a) * r * flat;
      pos.push(P.x + S.x * cx + O.x * cy, P.y + S.y * cx + O.y * cy, P.z + S.z * cx + O.z * cy); }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++) { const a = i * radial + j, b = i * radial + (j + 1) % radial, c = a + radial, d = b + radial; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

// ── the face: one canvas decal wrapped on the front of the head ─────────────────
const faceCanvas = document.createElement("canvas"); faceCanvas.width = faceCanvas.height = 512;
const faceTex = new THREE.CanvasTexture(faceCanvas); faceTex.colorSpace = THREE.SRGBColorSpace; faceTex.anisotropy = 4;
const FACE = { x0: -.78, w: 1.56, y0: .707, h: 1.414 }; // the patch covers phi ±0.9 rad, theta 0.25π–0.75π
const fx = x => (x - FACE.x0) / FACE.w * 512, fy = y => (FACE.y0 - y) / FACE.h * 512;
let faceKey = "";
function drawFace(o) {
  const key = [o.gx.toFixed(2), o.gy.toFixed(2), o.lid.toFixed(2), o.mood, o.mouth, o.iris, o.fang, o.skin].join("|");
  if (key === faceKey) return; faceKey = key;
  const g = faceCanvas.getContext("2d"); g.clearRect(0, 0, 512, 512);
  // blush: soft and low, under the outer eye
  const flush = o.mood === "shy" || o.mood === "loving" ? 1 : o.mood === "sad" ? .3 : o.mood === "excited" ? .7 : .5, br = o.mood === "shy" ? 60 : 46;
  for (const x of [fx(-.47), fx(.47)]) { const y = fy(-.2); const r = g.createRadialGradient(x, y, 0, x, y, br); r.addColorStop(0, `rgba(255,110,140,${flush})`); r.addColorStop(1, "rgba(255,110,140,0)"); g.fillStyle = r; g.fillRect(x - br - 4, y - br - 4, br * 2 + 8, br * 2 + 8);
    g.strokeStyle = `rgba(230,90,120,${flush * .7})`; g.lineWidth = 3; for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(x - 12 + k * 13, y + 6); g.lineTo(x - 4 + k * 13, y - 6); g.stroke(); } }
  // some moods steer the eyes: shy looks down and away, sad looks down, surprised stares
  const eo = { ...o };
  if (o.mood === "shy") { eo.gx = .6; eo.gy = -.6; eo.lid = Math.min(o.lid, .72); }
  if (o.mood === "sad") { eo.gx = 0; eo.gy = -.45; eo.lid = Math.min(o.lid, .82); }
  if (o.mood === "surprised") { eo.gx = 0; eo.gy = 0; eo.lid = Math.max(o.lid, .9); }
  for (const [x, side] of [[fx(-.31), -1], [fx(.31), 1]]) drawEye(g, x, fy(-.05), side, eo);
  drawMouth(g, fx(0), fy(-.36), o);
  faceTex.needsUpdate = true;
}
function drawEye(g, cx, cy, side, o) {
  const ink = "#2A1C27";
  g.lineCap = "round"; g.lineJoin = "round";
  // brows: soft short strokes, raised for thinking (one side), lowered when sleepy
  const browY = cy - 100 - (o.mood === "thinking" && side === 1 ? 10 : 0) + (o.mood === "sleepy" ? 6 : 0) - (o.mood === "surprised" ? 18 : 0) - (o.mood === "cheeky" && side === -1 ? 10 : 0);
  const [bin, bout] = { sad: [-16, 8], shy: [-9, 3], proud: [5, -5], excited: [-6, -6], loving: [-4, 0] }[o.mood] || [0, 0]; // inner / outer end heights
  g.strokeStyle = darken(o.hairHex, .25).getStyle(); g.lineWidth = 7; g.beginPath(); g.moveTo(cx - 24 * side - 4 * side, browY + 4 + bin); g.quadraticCurveTo(cx, browY - 6 + (bin + bout) / 2, cx + 22 * side, browY + 2 + bout); g.stroke();
  if (o.mood === "proud") { // contented closed eyes, lids curving down, with a lash flick
    g.strokeStyle = ink; g.lineWidth = 10; g.beginPath(); g.moveTo(cx - 44, cy + 4); g.quadraticCurveTo(cx, cy + 30, cx + 44, cy + 4); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.moveTo(cx + 40 * side, cy + 8); g.lineTo(cx + 56 * side, cy - 2); g.stroke(); return;
  }
  if (o.mood === "cheeky" && side === 1) { // a wink
    g.strokeStyle = ink; g.lineWidth = 10; g.beginPath(); g.moveTo(cx - 40, cy + 16); g.quadraticCurveTo(cx, cy - 34, cx + 40, cy + 16); g.stroke(); return;
  }
  if (o.mood === "happy" || o.lid < .2) { // ^ ^ closed happy eyes, or a blink
    g.strokeStyle = ink; g.lineWidth = 9; g.beginPath();
    if (o.mood === "happy") { g.moveTo(cx - 44, cy + 14); g.quadraticCurveTo(cx, cy - 44, cx + 44, cy + 14); } else { g.moveTo(cx - 46, cy + 8); g.quadraticCurveTo(cx, cy + 24, cx + 46, cy + 8); }
    g.stroke(); return;
  }
  if (o.mood === "sleepy") { // heavy lids: half-closed, drooping
    g.save(); g.beginPath(); g.ellipse(cx, cy + 18, 48, 32, 0, 0, Math.PI); g.closePath(); g.clip();
    paintIris(g, cx, cy + 6, o); g.restore();
    g.strokeStyle = ink; g.lineWidth = 9; g.beginPath(); g.moveTo(cx - 38, cy + 12); g.quadraticCurveTo(cx, cy + 2, cx + 38, cy + 14); g.stroke(); return;
  }
  const big = o.mood === "excited" ? 1.14 : o.mood === "surprised" ? 1.1 : 1, irisS = o.mood === "surprised" ? .68 : big;
  const ew = 50 * big, eh = 70 * big * Math.max(.15, o.lid);
  g.save(); g.beginPath(); g.ellipse(cx, cy + (1 - o.lid) * 40, ew, eh, 0, 0, Math.PI * 2); g.clip();
  g.fillStyle = "#FFF8FB"; g.fillRect(cx - 80, cy - 100, 160, 210);
  if (o.mood === "loving") { // heart-shaped irises
    const hx = cx + o.gx * 10, hy = cy + 8; g.fillStyle = "#FF5C8A"; heartPath(g, hx, hy, 92); g.fill(); g.strokeStyle = "#B8325A"; g.lineWidth = 4; g.stroke();
    g.fillStyle = "#FFFFFF"; g.beginPath(); g.ellipse(hx - 16, hy - 16, 10, 13, -.4, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(hx + 14, hy + 14, 5, 0, Math.PI * 2); g.fill();
  } else paintIris(g, cx, cy, o, irisS);
  g.restore();
  if (o.mood === "sad") { // eyes welling up: a wet shine along the lower lid, and a tear on one cheek
    g.strokeStyle = "rgba(150,205,255,.95)"; g.lineWidth = 7; g.beginPath(); g.ellipse(cx, cy + (1 - o.lid) * 40, ew * .82, eh * .92, 0, Math.PI * .18, Math.PI * .82); g.stroke();
    if (side === -1) { const tx = cx + 26, ty = cy + 96; g.fillStyle = "#A6DAFF"; g.strokeStyle = "#5E9CD6"; g.lineWidth = 3; g.beginPath(); g.moveTo(tx, ty - 22); g.quadraticCurveTo(tx + 14, ty, tx, ty + 10); g.quadraticCurveTo(tx - 14, ty, tx, ty - 22); g.fill(); g.stroke();
      g.fillStyle = "#FFFFFF"; g.beginPath(); g.arc(tx - 3, ty - 2, 3, 0, Math.PI * 2); g.fill(); }
  }
  // upper lash line: thick, with a flick at the outer corner
  const top = cy + (1 - o.lid) * 40 - eh;
  g.strokeStyle = ink; g.lineWidth = 13; g.beginPath(); g.moveTo(cx - ew * side, cy - eh * .3); g.quadraticCurveTo(cx - ew * .15 * side, top - 9, cx + ew * 1.02 * side, top + eh * .22); g.stroke();
  g.lineWidth = 6; for (const [dx, dy] of [[1.28, -.02], [1.2, .14]]) { g.beginPath(); g.moveTo(cx + ew * .95 * side, top + eh * .24); g.lineTo(cx + ew * dx * side, top + eh * dy); g.stroke(); }
  // a little lower lash at the outer corner
  g.lineWidth = 4; g.beginPath(); g.moveTo(cx + ew * .45 * side, cy + eh * .95); g.quadraticCurveTo(cx + ew * .8 * side, cy + eh * .82, cx + ew * .9 * side, cy + eh * .6); g.stroke();
}
function paintIris(g, cx, cy, o, big = 1) {
  const ix = cx + o.gx * 14, iy = cy + 10 - o.gy * 10;
  const base = new THREE.Color(o.iris);
  const gr = g.createLinearGradient(0, iy - 46, 0, iy + 46); gr.addColorStop(0, darken(o.iris, .55).getStyle()); gr.addColorStop(.45, base.getStyle()); gr.addColorStop(1, lighten(o.iris, .45).getStyle());
  g.fillStyle = gr; g.beginPath(); g.ellipse(ix, iy, 40 * big, 58 * big, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = darken(o.iris, .6).getStyle(); g.lineWidth = 3; g.stroke();
  g.fillStyle = darken(o.iris, .75).getStyle(); g.beginPath(); g.ellipse(ix, iy + 4, 15 * big, 25 * big, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = lighten(o.iris, .35).getStyle(); g.lineWidth = 2; g.beginPath(); g.ellipse(ix, iy + 6, 30 * big, 42 * big, 0, Math.PI * .15, Math.PI * .85); g.stroke();
  // pale lower tint
  g.fillStyle = "rgba(255,255,255,.28)"; g.beginPath(); g.ellipse(ix, iy + 34, 24, 13, 0, 0, Math.PI * 2); g.fill();
  // highlights: same place in both eyes
  g.fillStyle = "#FFFFFF"; g.beginPath(); g.ellipse(ix - 14, iy - 22, 13 * big, 16 * big, -.3, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(ix + 16, iy + 24, 6, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(ix + 4, iy - 30, 3.5, 0, Math.PI * 2); g.fill();
  if (o.mood === "excited") { star(g, ix + 8, iy - 6, 9); star(g, ix - 14, iy + 14, 5); }
}
function heartPath(g, x, y, s) { g.beginPath(); g.moveTo(x, y + s * .42); g.bezierCurveTo(x - s * .75, y - s * .02, x - s * .42, y - s * .58, x, y - s * .2); g.bezierCurveTo(x + s * .42, y - s * .58, x + s * .75, y - s * .02, x, y + s * .42); g.closePath(); }
function star(g, x, y, r) { g.fillStyle = "#FFFFFF"; g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * .35 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill(); }
function drawMouth(g, cx, cy, o) {
  const ink = "#5A2338"; g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 6; g.lineCap = "round";
  const m = o.mouth;
  if (m === "M") { g.beginPath(); g.moveTo(cx - 10, cy); g.lineTo(cx + 10, cy); g.stroke(); return; }
  if (m === "smile-small" || m === "smile") {
    if (o.fang) { g.beginPath(); g.moveTo(cx - 16, cy - 4); g.quadraticCurveTo(cx - 8, cy + 6, cx, cy - 2); g.quadraticCurveTo(cx + 8, cy + 6, cx + 16, cy - 4); g.stroke(); // :3
      g.fillStyle = "#FFFFFF"; g.beginPath(); g.moveTo(cx + 6, cy + 1); g.lineTo(cx + 12, cy + 1); g.lineTo(cx + 9, cy + 9); g.fill(); return; }
    const w = m === "smile" ? 18 : 12; g.beginPath(); g.moveTo(cx - w, cy - 3); g.quadraticCurveTo(cx, cy + (m === "smile" ? 14 : 9), cx + w, cy - 3); g.stroke(); return; }
  if (m === "frown") { g.beginPath(); g.moveTo(cx - 13, cy + 7); g.quadraticCurveTo(cx, cy - 7, cx + 13, cy + 7); g.stroke(); return; }
  if (m === "wavy") { g.lineWidth = 5; g.beginPath(); g.moveTo(cx - 15, cy + 1); g.quadraticCurveTo(cx - 8, cy - 6, cx - 2, cy + 1); g.quadraticCurveTo(cx + 5, cy + 7, cx + 13, cy); g.stroke(); return; }
  if (m === "grin") { // a big open "D" grin
    g.beginPath(); g.moveTo(cx - 22, cy - 5); g.lineTo(cx + 22, cy - 5); g.quadraticCurveTo(cx + 20, cy + 24, cx, cy + 24); g.quadraticCurveTo(cx - 20, cy + 24, cx - 22, cy - 5); g.closePath(); g.fill();
    g.fillStyle = "#E46A7E"; g.beginPath(); g.ellipse(cx, cy + 15, 12, 6, 0, 0, Math.PI * 2); g.fill();
    if (o.fang) { g.fillStyle = "#FFFFFF"; g.beginPath(); g.moveTo(cx + 8, cy - 5); g.lineTo(cx + 15, cy - 5); g.lineTo(cx + 11.5, cy + 4); g.fill(); } return; }
  if (m === "tongue") { // a cheeky little tongue poking out
    g.fillStyle = "#E46A7E"; g.beginPath(); g.ellipse(cx + 5, cy + 9, 8, 10, 0, 0, Math.PI * 2); g.fill(); g.lineWidth = 3; g.stroke(); g.lineWidth = 6;
    g.beginPath(); g.moveTo(cx - 15, cy - 3); g.quadraticCurveTo(cx, cy + 8, cx + 15, cy - 3); g.stroke(); return; }
  if (m === "smirk") { g.beginPath(); g.moveTo(cx - 6, cy + 2); g.quadraticCurveTo(cx + 6, cy + 4, cx + 14, cy - 4); g.stroke(); return; }
  const sh = { A: [17, 16], E: [20, 8], O: [10, 13], "O-small": [7, 6] }[m] || [14, 12];
  g.beginPath(); g.ellipse(cx, cy + 4, sh[0], sh[1], 0, 0, Math.PI * 2); g.fill();
  if (m === "A") { g.fillStyle = "#E46A7E"; g.beginPath(); g.ellipse(cx, cy + 12, sh[0] * .6, sh[1] * .4, 0, 0, Math.PI * 2); g.fill(); }
  if (o.fang && (m === "A" || m === "E")) { g.fillStyle = "#FFFFFF"; g.beginPath(); g.moveTo(cx + 5, cy - sh[1] + 5); g.lineTo(cx + 11, cy - sh[1] + 5); g.lineTo(cx + 8, cy - sh[1] + 13); g.fill(); }
}


function shapePoint(v) { let { x, y, z } = v; const cheek = Math.exp(-((y + .18) ** 2) / .16); x *= 1.07 + .07 * cheek;
  if (y < -.35) { const k = (-y - .35) / .65; x *= 1 - .38 * k * k; z *= 1 - .12 * k * k; y = -.35 - (-y - .35) * .82; } z *= z > 0 ? .9 : 1.05; y *= .96; return new THREE.Vector3(x, y, z); }
// soft chibi head shape applied to a sphere's vertices (also used for the face decal so it sits on the surface)
function shapeHead(geo, normals = true) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); let { x, y, z } = v;
    const cheek = Math.exp(-((y + .18) ** 2) / .16);
    x *= 1.07 + .07 * cheek;
    if (y < -.35) { const k = (-y - .35) / .65; x *= 1 - .38 * k * k; z *= 1 - .12 * k * k; y = -.35 - (-y - .35) * .82; }
    z *= z > 0 ? .9 : 1.05; y *= .96;
    p.setXYZ(i, x, y, z); }
  if (normals) geo.computeVertexNormals(); return geo;
}
// a smooth tube whose radius goes from r0 to r1, with rounded ends (for limbs)
function taperTube(points, r0, r1, seg = 16, radial = 18) {
  const curve = new THREE.CatmullRomCurve3(points), pos = [], idx = [], up = new THREE.Vector3(0, 0, 1);
  const rings = seg + 1, caps = 6;
  const ring = (P, T, r) => { let N = new THREE.Vector3().crossVectors(T, up); if (N.lengthSq() < 1e-6) N.set(1, 0, 0); N.normalize(); const B = new THREE.Vector3().crossVectors(T, N).normalize();
    for (let j = 0; j < radial; j++) { const a = j / radial * Math.PI * 2; pos.push(P.x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * r, P.y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * r, P.z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * r); } };
  const T0 = curve.getTangentAt(0), T1 = curve.getTangentAt(1), P0 = curve.getPointAt(0), P1 = curve.getPointAt(1);
  for (let c = caps; c >= 1; c--) { const a = c / caps * Math.PI / 2; ring(P0.clone().addScaledVector(T0, -Math.sin(a) * r0), T0, Math.cos(a) * r0 + 1e-4); }
  for (let i = 0; i < rings; i++) { const t = i / seg; ring(curve.getPointAt(t), curve.getTangentAt(t), r0 + (r1 - r0) * t); }
  for (let c = 1; c <= caps; c++) { const a = c / caps * Math.PI / 2; ring(P1.clone().addScaledVector(T1, Math.sin(a) * r1), T1, Math.cos(a) * r1 + 1e-4); }
  const total = caps + rings + caps;
  for (let i = 0; i < total - 1; i++) for (let j = 0; j < radial; j++) { const a = i * radial + j, b = i * radial + (j + 1) % radial, c2 = a + radial, d = b + radial; idx.push(a, b, c2, b, d, c2); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}


// a hair lock: tapered, flattened, with vertex colours for darker roots, lighter tips and an "angel ring" shine band
function hairLockGeo(points, rMax, flat, center, offset, ring = true, seg = 30, radial = 10) {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, P = curve.getPointAt(t), T = curve.getTangentAt(t).normalize();
    let Ov = P.clone().sub(center); Ov.sub(T.clone().multiplyScalar(Ov.dot(T))); if (Ov.lengthSq() < 1e-6) Ov.set(0, 0, 1); Ov.normalize();
    const S = new THREE.Vector3().crossVectors(T, Ov).normalize();
    const r = rMax * Math.pow(Math.sin(Math.PI * (.16 + .84 * t)), .8);
    const W = P.clone().add(offset); const ang = Math.atan2(W.x, W.z);
    for (let j = 0; j < radial; j++) { const a = j / radial * Math.PI * 2, cx = Math.cos(a) * r, cy = Math.sin(a) * r * flat;
      pos.push(P.x + S.x * cx + Ov.x * cy, P.y + S.y * cx + Ov.y * cy, P.z + S.z * cx + Ov.z * cy);
      let k = .78 + .22 * Math.min(1, t / .35) + .05 * t;
      if (ring && Math.sin(a) > -.2) { const band = .5 + .04 * Math.sin(ang * 13); const d = Math.abs(W.y - band); if (d < .05) k = 1.55; else if (d < .075) k = 1.22; }
      col.push(k, k, k); }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++) { const a = i * radial + j, b = i * radial + (j + 1) % radial, c = a + radial, d = b + radial; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

// ── build the chibi from the current state ──────────────────────────────────────
const C = { headY: .62, headS: .46 };
let CH = null; // handles to animated parts
function buildChibi() {
  // each rebuild makes new geometry, materials and small textures: free the old ones (shared outline materials and the face texture stay)
  const keep = new Set([OL.thick, OL.mid, OL.thin, bodyMat, hairMat, outfitMat, shoeMat]);
  chibiRoot.traverse(o => { if (!o.isMesh && !o.isSprite) return; if (o.geometry && !o.userData.keepGeo) o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (!m || keep.has(m)) continue; if (m.map && m.map !== faceTex) m.map.dispose(); m.dispose(); } });
  chibiRoot.clear();
  const hairHex = HAIR[state.hair], skinHex = SKIN[state.skin], outfitHex = OUTFIT[state.outfit];
  const M = { skin: skinToon(skinHex), hair: toon(hairHex), hairDark: toon(darken(hairHex, .35)), outfit: toon(outfitHex), cuff: toon(lighten(outfitHex, .35)), shoe: toon("#FBF4EA"), sole: toon("#B79CB0"), inner: toon("#F7C9DD"), white: toon("#FFF6EE"), shine: new THREE.MeshBasicMaterial({ color: lighten(hairHex, .55), transparent: true, opacity: .8 }) };
  const hairOutline = darken(hairHex, .6).getStyle();
  const add = (parent, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], ol = "mid", olColor) => { const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.rotation.set(...rot); m.scale.set(...scale); if (ol) withOutline(m, ol, olColor); parent.add(m); return m; };

  // body: a slim chibi torso (narrower than the head) with sloped shoulders, dressed in one of a set of cosy outfits
  const body = new THREE.Group(); body.scale.setScalar(1.2); body.position.y = .04; chibiRoot.add(body);
  const skinShade = skinToon(darken(skinHex, .18));
  const ost = state.activity === "sleepy" ? "pyjamas" : (state.outfitStyle || "hoodie"); // bedtime means pyjamas
  const lathe = (pts, mat, sc = [1, 1, .84], ol = "mid") => add(body, new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 56), mat, [0, 0, 0], [0, 0, 0], sc, ol);
  const top = [[0, -.36], [.17, -.355], [.215, -.31], [.225, -.2], [.215, -.08], [.19, .01], [.15, .065], [.1, .095], [.06, .11], [0, .112]];
  const shirtM = toon(state.outfit === "cream" ? "#CDA4E8" : "#FFF6EE"), front = (y, k = 1) => .185 * k - Math.max(0, -y - .2) * .02; // z of the torso front at height y
  const sleeveM = ost === "dungarees" ? shirtM : M.outfit, longSleeves = ost !== "dress" && ost !== "dungarees", trousers = ost === "tracksuit" || ost === "pyjamas";
  if (ost === "hoodie") { // an oversized hoodie: ribbed hem, kangaroo pocket, hood on the back, drawstrings
    lathe(top, M.outfit);
    add(body, new THREE.TorusGeometry(.205, .03, 10, 40), M.cuff, [0, -.33, 0], [Math.PI / 2, 0, 0], [1, .84, 1], "thin");
    add(body, new THREE.CylinderGeometry(.1, .12, .1, 24, 1, true, -Math.PI * .4, Math.PI * .8), M.cuff, [0, -.21, .02], [0, 0, 0], [1, 1, 1.7], null);
    add(body, new THREE.SphereGeometry(.15, 24, 16, 0, Math.PI * 2, 0, Math.PI * .5), M.outfit, [0, .06, -.1], [-1.35, 0, 0], [1.1, .85, .7], "thin");
    for (const sx of [-1, 1]) { add(body, new THREE.CapsuleGeometry(.008, .08, 4, 8), M.cuff, [sx * .035, .03, .165], [.12, 0, 0], [1, 1, 1], null); add(body, new THREE.SphereGeometry(.016, 8, 6), M.cuff, [sx * .035, -.02, .17], [0, 0, 0], [1, 1, 1], null); }
  }
  if (ost === "dress") { // a pinafore-style dress that flares out, with a round white collar and a little bow
    lathe([[0, -.37], [.25, -.365], [.275, -.335], [.24, -.2], [.2, -.09], [.19, .01], [.15, .065], [.1, .095], [.06, .11], [0, .112]], M.outfit, [1, 1, .9]);
    add(body, new THREE.TorusGeometry(.262, .018, 8, 48), M.cuff, [0, -.345, 0], [Math.PI / 2, 0, 0], [1, .9, 1], null); // hem trim
    add(body, new THREE.TorusGeometry(.2, .014, 8, 48), M.cuff, [0, -.1, 0], [Math.PI / 2, 0, 0], [1, .9, 1], null); // waist seam
    for (const sx of [-1, 1]) add(body, new THREE.SphereGeometry(.06, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.white, [sx * .045, .1, .085], [.95, 0, sx * -.5], [1, .35, .8], "thin"); // collar
    const bow = new THREE.Group(); bow.position.set(0, .075, .16); body.add(bow);
    for (const sx of [-1, 1]) add(bow, new THREE.ConeGeometry(.03, .055, 10), toon("#F2A2C4"), [sx * .028, 0, 0], [0, 0, sx * Math.PI / 2], [1, 1, .6], "thin");
    add(bow, new THREE.SphereGeometry(.016, 10, 8), toon("#F2A2C4"), [0, 0, .006], [0, 0, 0], [1, 1, 1], null);
  }
  if (ost === "dungarees") { // a T-shirt under dungarees: bib, straps, buttons and a front pocket
    lathe(top, shirtM);
    lathe([[0, -.375], [.2, -.37], [.232, -.33], [.236, -.2], [.226, -.13], [.0, -.13]], M.outfit, [1, 1, .86]);
    add(body, new THREE.BoxGeometry(.2, .16, .03), M.outfit, [0, -.06, .17], [-.12, 0, 0], [1, 1, 1], "thin"); // bib
    add(body, new THREE.BoxGeometry(.09, .05, .012), M.cuff, [0, -.075, .186], [-.12, 0, 0], [1, 1, 1], null); // bib pocket
    for (const sx of [-1, 1]) { add(body, new THREE.BoxGeometry(.035, .2, .02), M.outfit, [sx * .085, .04, .13], [-.55, 0, sx * .12], [1, 1, 1], "thin"); // straps
      add(body, new THREE.CylinderGeometry(.016, .016, .012, 12), toon("#F4C542"), [sx * .08, .0, .18], [Math.PI / 2 - .12, 0, 0], [1, 1, 1], null); }
  }
  if (ost === "tracksuit") { // a zip-up track top with a high collar; matching joggers below
    lathe(top, M.outfit);
    add(body, new THREE.TorusGeometry(.205, .026, 10, 40), M.cuff, [0, -.335, 0], [Math.PI / 2, 0, 0], [1, .84, 1], "thin");
    add(body, new THREE.CylinderGeometry(.085, .095, .06, 24, 1, true), M.outfit, [0, .12, 0], [0, 0, 0], [1, 1, .9], "thin"); // high collar
    add(body, new THREE.BoxGeometry(.012, .42, .01), M.white, [0, -.12, .182], [-.03, 0, 0], [1, 1, 1], null); // zip
    add(body, new THREE.BoxGeometry(.026, .04, .012), toon("#D9D6E6"), [0, .07, .186], [0, 0, 0], [1, 1, 1], null); // zip pull
  }
  if (ost === "pyjamas") { // soft pyjamas with a contrast collar, buttons and little stars
    lathe(top, M.outfit);
    add(body, new THREE.TorusGeometry(.205, .022, 10, 40), M.cuff, [0, -.335, 0], [Math.PI / 2, 0, 0], [1, .84, 1], null);
    for (const sx of [-1, 1]) add(body, new THREE.SphereGeometry(.06, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.cuff, [sx * .045, .1, .085], [.95, 0, sx * -.5], [1, .35, .8], "thin");
    for (let k = 0; k < 3; k++) add(body, new THREE.SphereGeometry(.013, 10, 8), M.white, [0, .02 - k * .1, front(.02 - k * .1) + .004], [0, 0, 0], [1, 1, .5], null);
    for (const [x, y, a] of [[-.11, -.05, .35], [.12, -.18, -.3], [-.07, -.27, .1], [.1, .02, -.2]]) { const st = new THREE.Shape(); for (let i = 0; i < 10; i++) { const r = i % 2 ? .009 : .022, an = i * Math.PI / 5 + Math.PI / 2; st[i ? "lineTo" : "moveTo"](Math.cos(an) * r, Math.sin(an) * r); }
      const m = add(body, new THREE.ShapeGeometry(st), toon("#F4C542"), [x, y, 0], [0, 0, 0], [1, 1, 1], null); const zf = Math.sqrt(Math.max(0, .215 * .215 - x * x)) * .84 + .003; m.position.z = zf; m.rotation.y = Math.atan2(x, zf) * .9; }
  }
  if (ost !== "hoodie" && ost !== "pyjamas" && ost !== "dress") add(body, new THREE.TorusGeometry(.075, .028, 10, 28), ost === "dungarees" ? toon(lighten(state.outfit === "cream" ? "#CDA4E8" : "#FFF6EE", .2)) : M.cuff, [0, .1, 0], [Math.PI / 2, 0, 0], [1, .9, 1], "thin");
  // neck: slim and short, in shade under the chin the way anime draws it
  add(body, new THREE.CylinderGeometry(.045, .055, .2, 20), skinShade, [0, .19, .0], [0, 0, 0], [1, 1, .9], "thin");
  if (ost === "hoodie" || ost === "pyjamas") add(body, new THREE.TorusGeometry(.075, .03, 10, 28), M.cuff, [0, .1, 0], [Math.PI / 2, 0, 0], [1, .9, 1], "thin"); // neckline
  // legs: bare legs with socks (hoodie, dress), shorts (dungarees) or full-length trousers (tracksuit, pyjamas); rounded two-tone shoes
  for (const sx of [-1, 1]) {
    if (trousers) { add(body, taperTube([new THREE.Vector3(sx * .085, -.3, 0), new THREE.Vector3(sx * .088, -.39, .005), new THREE.Vector3(sx * .086, -.47, .01)], .074, .066), M.outfit, [0, 0, 0], [0, 0, 0], [1, 1, 1], "thin");
      add(body, new THREE.CylinderGeometry(.067, .067, .03, 20), M.cuff, [sx * .086, -.462, .01], [0, 0, 0], [1, 1, 1], "thin");
      if (ost === "tracksuit") add(body, new THREE.BoxGeometry(.008, .16, .02), M.white, [sx * .158, -.38, .005], [0, 0, 0], [1, 1, 1], null); // side stripe
    } else {
    add(body, taperTube([new THREE.Vector3(sx * .085, -.3, 0), new THREE.Vector3(sx * .087, -.39, .005), new THREE.Vector3(sx * .085, -.45, .01)], .068, .058), M.skin, [0, 0, 0], [0, 0, 0], [1, 1, 1], "thin");
    if (ost === "dungarees") add(body, taperTube([new THREE.Vector3(sx * .086, -.32, 0), new THREE.Vector3(sx * .088, -.39, .004)], .078, .076), M.outfit, [0, 0, 0], [0, 0, 0], [1, 1, 1], "thin"); // shorts
    add(body, new THREE.CylinderGeometry(.062, .064, ost === "dress" ? .1 : .06, 20), M.white, [sx * .085, ost === "dress" ? -.43 : -.445, .01], [0, 0, 0], [1, 1, 1], "thin");   // sock cuff (knee-ish socks with a dress)
    }
    add(body, new THREE.SphereGeometry(.08, 24, 16), M.shoe, [sx * .085, -.5, .03], [0, 0, 0], [1.05, .62, 1.42], "mid");
    add(body, new THREE.CylinderGeometry(.084, .084, .022, 24), M.sole, [sx * .085, -.535, .035], [0, 0, 0], [1.05, 1, 1.42], null);
  }
  // arms: tapered sleeves from the shoulder line, cuffs, and mitten hands (a palm and a thumb)
  const arms = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * .165, .03, 0); body.add(pivot);
    if (longSleeves) {
      add(pivot, taperTube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(sx * .045, -.1, .005), new THREE.Vector3(sx * .075, -.2, .012)], .078, .058), sleeveM, [0, 0, 0], [0, 0, 0], [1, 1, 1], "mid");
      add(pivot, new THREE.TorusGeometry(.055, .02, 8, 20), M.cuff, [sx * .078, -.205, .012], [Math.PI / 2, 0, sx * .3], [1, 1, 1], null);
      if (ost === "tracksuit") add(pivot, taperTube([new THREE.Vector3(sx * .07, -.01, 0), new THREE.Vector3(sx * .112, -.1, .004), new THREE.Vector3(sx * .14, -.18, .01)], .009, .008), M.white, [0, 0, 0], [0, 0, 0], [1, 1, 1], null); // sleeve stripe
    } else { // short sleeves: a puffed sleeve at the shoulder, then a bare arm
      add(pivot, taperTube([new THREE.Vector3(sx * .015, -.02, 0), new THREE.Vector3(sx * .045, -.1, .005), new THREE.Vector3(sx * .075, -.21, .012)], .052, .046), M.skin, [0, 0, 0], [0, 0, 0], [1, 1, 1], "thin");
      add(pivot, new THREE.SphereGeometry(.082, 20, 14), sleeveM, [sx * .02, -.04, 0], [0, 0, sx * .3], [1, ost === "dress" ? 1.05 : .9, 1], "mid");
      add(pivot, new THREE.TorusGeometry(.062, .014, 8, 20), ost === "dress" ? M.white : M.cuff, [sx * .036, -.1, .003], [Math.PI / 2, 0, sx * .3], [1, 1, 1], null);
    }
    const hand = new THREE.Group(); hand.position.set(sx * .085, -.262, .016); pivot.add(hand);
    add(hand, new THREE.SphereGeometry(.068, 22, 16), M.skin, [0, 0, 0], [0, 0, sx * .2], [.95, 1.12, .78], "thin");
    add(hand, new THREE.SphereGeometry(.03, 12, 10), M.skin, [-sx * .05, .02, .032], [0, 0, -sx * .5], [1, 1.35, 1], "thin");
    arms.push({ pivot, hand, sx });
  }
  // head: a chibi head shape (wide soft cheeks, small chin, rounder back, flatter face), not a ball
  const head = new THREE.Group(); head.position.y = C.headY; head.scale.setScalar(C.headS); chibiRoot.add(head);
  const headGeo = shapeHead(new THREE.SphereGeometry(1, 72, 54));
  add(head, headGeo, M.skin, [0, 0, 0], [0, 0, 0], [1, 1, 1], "mid");
  const faceGeo = shapeHead(new THREE.SphereGeometry(1.012, 48, 32, Math.PI / 2 - .9, 1.8, Math.PI * .25, Math.PI * .5), false);
  const face = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false })); face.renderOrder = 2; head.add(face);
  faceKey = "";

  // hair: layered, overlapping tapered locks with darker roots, an "angel ring" shine band, split tips, and sway
  const hair = new THREE.Group(); head.add(hair);
  const hsph = (theta, a, r = 1) => shapePoint(sph(theta, a, 1)).multiplyScalar(1 + (r - 1) * .5);
  const O = new THREE.Vector3(0, .05, 0);
  const style = state.hairStyle;
  let hs = 11 + style.length; const rnd = () => (hs = (hs * 16807) % 2147483647) / 2147483647; const jit = (k) => (rnd() - .5) * k;
  const hairToon = new THREE.MeshToonMaterial({ color: hairHex, gradientMap: toonRamp, vertexColors: true });
  const innerToon = new THREE.MeshToonMaterial({ color: darken(hairHex, .3), gradientMap: toonRamp, vertexColors: true });
  const locks = [];
  // one lock: geometry built around its root so it can sway from the root
  const H = (pts, r, flat = .5, opts = {}) => {
    const P = pts.map(p => p.isVector3 ? p.clone() : new THREE.Vector3(...p));
    const rootP = P[0].clone();
    const geo = hairLockGeo(P.map(p => p.clone().sub(rootP)), r, flat, O.clone().sub(rootP), rootP, opts.ring ?? true);
    const pivot = new THREE.Group(); pivot.position.copy(rootP); hair.add(pivot);
    const m = new THREE.Mesh(geo, opts.inner ? innerToon : hairToon); withOutline(m, opts.thin ? "thin" : "mid", hairOutline); pivot.add(m);
    const len = P[0].distanceTo(P[P.length - 1]);
    locks.push({ pivot, amp: Math.min(1, len / 1.6) * (opts.stiff ? .3 : 1), phase: rnd() * 6.28, side: Math.sign(rootP.x) || 1 });
    // split tips: a couple of small strands peeling off near the end of longer locks
    if (opts.split && len > .7) for (const s of [-1, 1]) {
      const n = P.length, a = P[n - 2], b = P[n - 1], dir = b.clone().sub(a);
      const side = new THREE.Vector3().crossVectors(dir, b.clone().sub(O)).normalize().multiplyScalar(s * r * .7);
      const tip = [a.clone().lerp(b, .35).add(side.clone().multiplyScalar(.3)), b.clone().add(side).add(dir.clone().multiplyScalar(-.05 + rnd() * .2))];
      const g2 = hairLockGeo([tip[0].clone().sub(rootP), a.clone().lerp(b, .7).add(side.clone().multiplyScalar(.8)).sub(rootP), tip[1].clone().sub(rootP)], r * .42, flat, O.clone().sub(rootP), rootP, false);
      const m2 = new THREE.Mesh(g2, hairToon); withOutline(m2, "thin", hairOutline); pivot.add(m2);
    }
  };
  // scalp shell under everything, so no skin shows between locks
  const scalp = new THREE.Mesh(shapeHead(new THREE.SphereGeometry(1.03, 48, 24, 0, Math.PI * 2, 0, Math.PI * .36)), toon(darken(hairHex, .12))); scalp.position.y = .015; hair.add(scalp);
  const back = new THREE.Mesh(shapeHead(new THREE.SphereGeometry(1.035, 48, 24, Math.PI / 2 + .8, Math.PI * 2 - 1.6, 0, Math.PI * .64)), toon(darken(hairHex, .2))); back.position.y = .005; withOutline(back, "mid", hairOutline); hair.add(back);
  // crown: overlapping locks sweeping from the crown whorl, giving the top its volume and silhouette
  for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2 + .2; if (Math.cos(a) > .55) continue;
    H([hsph(.05, a, 1.0), hsph(Math.PI * .2, a + .1, 1.16 + jit(.04)), hsph(Math.PI * .36, a + .18, 1.12), hsph(Math.PI * .44, a + .22, 1.04)], .28 + jit(.04), .3, { stiff: true }); }
  if (style !== "curly") {
    // fringe: 7 main clumps (odd number), tips above the eye line at varied lengths, with thin wisps between
    for (let i = -3; i <= 3; i++) { const a = i * .26 + jit(.04), tip = .42 + (i % 2 ? -.03 : .02) + jit(.025) - Math.abs(i) * .01;
      const curl = i === 0 ? 0 : -Math.sign(i) * .08;
      H([hsph(Math.PI * .08, a * .5, 1.0), hsph(Math.PI * .24, a * .95, 1.15), hsph(Math.PI * (tip - .07), a * 1.08 + curl * .5, 1.12), hsph(Math.PI * tip, a * 1.12 + curl, 1.06)], .25 - Math.abs(i) * .012 + jit(.02), .38); }
    for (let i = -2; i <= 2; i++) { if (!i) continue; const a = i * .26 + .13 * Math.sign(i);
      H([hsph(Math.PI * .15, a * .6, 1.05), hsph(Math.PI * .3, a, 1.14), hsph(Math.PI * (.45 + jit(.03)), a * 1.05, 1.07)], .1, .45, { thin: true, ring: false }); }
  }
  // side locks framing the face (two layers each side)
  const sideLen = { short: .55, bob: .72, long: .8, twin: .62, ponytail: .64, buns: .6, curly: 0, braids: .6 }[style];
  if (sideLen) for (const sx of [-1, 1]) {
    for (const [da, dl, r] of [[0, 0, .15], [.24, -.06, .13], [-.16, -.1, .11]]) // two or three slim framing locks per side, varied lengths
      H([hsph(Math.PI * .2, sx * (1.0 + da), 1.05), hsph(Math.PI * .42, sx * (1.14 + da), 1.1), hsph(Math.PI * (sideLen + dl), sx * (1.2 + da * .8), 1.07), hsph(Math.PI * (sideLen + dl + .06), sx * (1.12 + da * .6), 1.0)], r, .62);
  }
  // back of the head
  const backLock = (a, end, r, out = .95, extra = 0) => { const wob = jit(.12);
    H([hsph(Math.PI * .28, a, 1.05), hsph(Math.PI * .5, a + wob * .3, 1.17), new THREE.Vector3(Math.sin(a + wob) * out * .9, -.55 - extra * .3, Math.cos(a + wob) * out * .9 - .12),
       new THREE.Vector3(Math.sin(a + wob * 1.5) * out * .78, -end * .72, Math.cos(a + wob) * out * .78 - .22), new THREE.Vector3(Math.sin(a - wob) * out * .66, -end, Math.cos(a) * out * .66 - .28)], r, .42, { split: true }); };
  if (style === "long") { for (let k = -5; k <= 5; k++) backLock(Math.PI + k * .3, 1.75 + jit(.3) - Math.abs(k) * .04, .3 + jit(.05));
    for (let k = -4; k <= 4; k++) H([hsph(Math.PI * .4, Math.PI + k * .34, 1.0), new THREE.Vector3(Math.sin(Math.PI + k * .34) * .9, -.6, Math.cos(Math.PI + k * .34) * .9 - .05), new THREE.Vector3(Math.sin(Math.PI + k * .34) * .75, -1.5, Math.cos(Math.PI + k * .34) * .75 - .15)], .3, .45, { inner: true, ring: false }); }
  if (["short", "buns", "ponytail", "twin", "braids"].includes(style)) for (let k = -4; k <= 4; k++) { const a = Math.PI + k * .36 + jit(.06);
    H([hsph(Math.PI * .3, a, 1.05), hsph(Math.PI * .55, a, 1.14), hsph(Math.PI * (.68 + jit(.04)), a + jit(.1), 1.0)], .27 + jit(.04), .45); }
  if (style === "bob") for (let k = -6; k <= 6; k++) { const a = Math.PI + k * .38 + jit(.05); if (Math.cos(a) > .3) continue;
    H([hsph(Math.PI * .3, a, 1.05), hsph(Math.PI * .56, a, 1.16), hsph(Math.PI * .73, a + jit(.08), 1.07), hsph(Math.PI * .76, a + jit(.1), .93)], .3, .42); }
  const tie = (pos) => { const m = new THREE.Mesh(new THREE.TorusGeometry(.11, .045, 10, 20), toon("#F2A2C4")); m.position.copy(pos); withOutline(m, "thin"); hair.add(m); return m; };
  if (style === "twin") for (const sx of [-1, 1]) { const base = new THREE.Vector3(sx * .98, .45, -.25); tie(base).rotation.set(0, Math.PI / 2, .3 * sx);
    for (let k = -2; k <= 2; k++) H([base, new THREE.Vector3(sx * (1.5 + jit(.1)), .22 + k * .07, -.28 + k * .08), new THREE.Vector3(sx * (1.68 + jit(.1)), -.55, -.25 + k * .1), new THREE.Vector3(sx * (1.45 + jit(.1)), -1.15, -.12 + k * .06), new THREE.Vector3(sx * (1.25 + jit(.15)), -1.45 - jit(.2), 0)], .24 + jit(.04), .55, { split: true }); }
  if (style === "ponytail") { const base = new THREE.Vector3(0, .58, -1.04); tie(base).rotation.x = .9;
    for (let k = -2; k <= 2; k++) H([base, new THREE.Vector3(k * .1, .35, -1.48), new THREE.Vector3(k * .16 + jit(.08), -.4, -1.55), new THREE.Vector3(k * .1 + jit(.1), -1.1, -1.3), new THREE.Vector3(k * .05, -1.4, -1.1)], .26 + jit(.04), .55, { split: true }); }
  if (style === "buns") for (const sx of [-1, 1]) { const c = new THREE.Vector3(sx * .62, .9, -.12);
    for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; H([c.clone().add(new THREE.Vector3(Math.cos(a) * .05, -.15, Math.sin(a) * .05)), c.clone().add(new THREE.Vector3(Math.cos(a) * .3, .05, Math.sin(a) * .3)), c.clone().add(new THREE.Vector3(Math.cos(a + 1) * .22, .25, Math.sin(a + 1) * .22)), c.clone().add(new THREE.Vector3(Math.cos(a + 1.8) * .05, .3, Math.sin(a + 1.8) * .05))], .16, .55, { stiff: true, ring: false }); }
    tie(c.clone().add(new THREE.Vector3(0, -.14, 0))).rotation.x = Math.PI / 2; }
  if (style === "braids") for (const sx of [-1, 1]) { for (let k = 0; k < 7; k++) { const y = -.25 - k * .22, x = sx * (1.0 - k * .025), z = .42 - k * .02;
      H([new THREE.Vector3(x - sx * .06, y + .12, z), new THREE.Vector3(x + sx * .05, y, z + .04), new THREE.Vector3(x - sx * .02, y - .12, z)], .14 - k * .008, .7, { thin: true, stiff: true, ring: false }); }
    tie(new THREE.Vector3(sx * .83, -1.83, .28)).rotation.x = Math.PI / 2; H([new THREE.Vector3(sx * .83, -1.85, .28), new THREE.Vector3(sx * .85, -2.05, .3), new THREE.Vector3(sx * .82, -2.18, .32)], .1, .6, { thin: true, ring: false }); }
  if (style === "curly") { // coils: small tight spirals all over, plus a curly fringe
    const coil = (c, r, turns = 2.2) => { const pts = []; for (let k = 0; k <= 10; k++) { const a = k / 10 * turns * Math.PI * 2; pts.push(c.clone().add(new THREE.Vector3(Math.cos(a) * r, -k * .025, Math.sin(a) * r))); } H(pts, .11, .8, { thin: true, stiff: true, ring: false }); };
    for (let k = 0; k < 64; k++) { const th = Math.acos(1 - rnd() * 1.6), a = rnd() * Math.PI * 2; if (Math.cos(a) > .5 && th > Math.PI * .28) continue; coil(hsph(th, a, 1.16 + rnd() * .2), .1 + rnd() * .05); }
    for (let i = -3; i <= 3; i++) coil(hsph(Math.PI * .28, i * .24, 1.12), .08);
  }
  if (state.ahoge) H([new THREE.Vector3(0, 1.0, 0), new THREE.Vector3(.02, 1.35, .05), new THREE.Vector3(.16, 1.5, .3), new THREE.Vector3(.1, 1.36, .44)], .07, .5, { thin: true, ring: false });
  // animal ears: soft anime silhouettes (curved sides, rounded or pointed tips), sitting high on the head at the crown's sides,
  // tilted outward, with fluffy inner fur and fur tufts blending them into the hair
  const ears = new THREE.Group(); head.add(ears);
  const e = state.ears;
  const earShape = (w, h, tipX = 0, round = 0) => { const sh = new THREE.Shape(); sh.moveTo(-w, 0);
    sh.bezierCurveTo(-w * 1.05, h * .45, tipX - w * .35 - round, h * .9, tipX - round * .5, h); if (round) sh.quadraticCurveTo(tipX, h + round * .6, tipX + round * .5, h);
    sh.bezierCurveTo(tipX + w * .35 + round, h * .9, w * 1.05, h * .45, w, 0); sh.quadraticCurveTo(0, -w * .25, -w, 0); return sh; };
  const earMesh = (shape, depth, mat, ol = "mid", olc) => { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: depth * .45, bevelThickness: depth * .45, bevelSegments: 4, curveSegments: 24 }); g.translate(0, 0, -depth / 2); const m = new THREE.Mesh(g, mat); if (ol) withOutline(m, ol, olc); return m; };
  const furInner = new THREE.MeshToonMaterial({ color: e === "fox" ? "#FFF6EE" : lighten(hairHex, .55), gradientMap: toonRamp, vertexColors: true });
  if (e !== "none") for (const sx of [-1, 1]) {
    const ear = new THREE.Group(); ears.add(ear); ear.userData.sx = sx;
    const spec = { fox: [.33, .9, 0, 0, .14], wolf: [.33, .78, 0, .02, .14], cat: [.32, .58, 0, .07, .13], bunny: [.2, 1.3, sx * .05, .14, .12], bear: [.27, .38, 0, .22, .13] }[e];
    const [w, h, tipX, round, d] = spec;
    const outer = earMesh(earShape(w, h, tipX, round), d, M.hair, "mid", hairOutline); ear.add(outer);
    const innerMat = e === "bunny" || e === "bear" ? M.inner : M.inner;
    const inner = earMesh(earShape(w * .6, h * .72, tipX * .6, round * .6), d * .35, innerMat, null); inner.position.set(0, h * .07, d * .55); ear.add(inner);
    if (e === "fox") { const tip = earMesh(earShape(w * .42, h * .32, 0, 0), d * 1.05, M.hairDark, null); tip.position.set(0, h * .68, 0); ear.add(tip); }
    if (e === "fox" || e === "wolf" || e === "cat") for (const k of [-1, 0, 1]) { // fluffy inner fur
      const f = new THREE.Mesh(hairLockGeo([new THREE.Vector3(k * w * .3, .02, d * .7), new THREE.Vector3(k * w * .35, h * .2, d * .8), new THREE.Vector3(k * w * .2 - k * .02, h * (.36 + .08 * (1 - Math.abs(k))), d * .7)], w * .22, .6, new THREE.Vector3(0, 0, -1), new THREE.Vector3(), false, 16, 8), furInner); withOutline(f, "thin", hairOutline); ear.add(f); }
    for (const k of [-1, 1]) { // tufts where the ear meets the hair
      const f = new THREE.Mesh(hairLockGeo([new THREE.Vector3(k * w * .6, .05, 0), new THREE.Vector3(k * w * .95, -.06, .05), new THREE.Vector3(k * w * 1.15, -.14, .08)], .09, .55, new THREE.Vector3(0, .5, -1), new THREE.Vector3(), false, 12, 8), M.hair); withOutline(f, "thin", hairOutline); ear.add(f); }
    const pos = { fox: [Math.PI * .2, 1.25], wolf: [Math.PI * .2, 1.28], cat: [Math.PI * .21, 1.2], bunny: [Math.PI * .12, .75], bear: [Math.PI * .24, 1.2] }[e];
    ear.position.copy(sph(pos[0], sx * pos[1], .97));
    ear.rotation.set(-.12, sx * -.35, -sx * ({ fox: .42, wolf: .38, cat: .4, bunny: .12, bear: .45 }[e]));
    ear.userData.baseRot = ear.rotation.clone();
  }
  // tail: a fluffy bundle of fur locks from a tuft on the lower back (fox plume with a white tip, bushy wolf, slim cat, bunny puff)
  let tail = null;
  if (e !== "none") { tail = new THREE.Group(); tail.position.set(0, -.27, -.17); body.add(tail);
    const furToon = new THREE.MeshToonMaterial({ color: hairHex, gradientMap: toonRamp, vertexColors: true });
    const tipToon = new THREE.MeshToonMaterial({ color: "#FFF6EE", gradientMap: toonRamp, vertexColors: true });
    const Z = new THREE.Vector3();
    const fur = (pts, r, mat = furToon, flat = .75) => { const m = new THREE.Mesh(hairLockGeo(pts.map(p => new THREE.Vector3(...p)), r, flat, new THREE.Vector3(0, .1, .1), Z, false, 26, 12), mat); withOutline(m, "thin", hairOutline); tail.add(m); return m; };
    if (e === "fox" || e === "wolf") {
      const big = e === "fox" ? 1 : .82, rise = e === "fox" ? .5 : .3;
      const spine = [[0, 0, 0], [.05, -.06, -.16], [.16, .04 * big, -.33], [.24, rise * .55, -.42], [.27, rise, -.4]];
      for (const [dx, dy, dz, r] of [[0, 0, 0, .17], [.03, .03, .02, .14], [-.03, .02, -.02, .14], [.0, -.03, .03, .13]])
        fur(spine.map(([x, y, z], i) => [x + dx * i * .5, y + dy * i * .5, z + dz * i * .5]), r * big);
      if (e === "fox") fur([[.24, rise * .62, -.42], [.27, rise * .86, -.41], [.28, rise * 1.12, -.38]], .13, tipToon, .8);
      else fur([[.25, rise * .75, -.41], [.27, rise * .95, -.4], [.27, rise * 1.1, -.38]], .1, new THREE.MeshToonMaterial({ color: darken(hairHex, .3), gradientMap: toonRamp, vertexColors: true }), .8);
      for (const s2 of [-1, 1]) fur([[0, .02, 0], [s2 * .05, .03, -.06], [s2 * .07, .0, -.1]], .06);  // base tuft
    }
    if (e === "cat") { fur([[0, 0, 0], [.04, -.08, -.15], [.12, .05, -.28], [.06, .3, -.33], [.13, .45, -.3], [.2, .48, -.24]], .055, furToon, .9); }
    if (e === "bunny") for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; fur([[0, 0, 0], [Math.cos(a) * .06, Math.sin(a) * .06, -.08], [Math.cos(a + .6) * .03, Math.sin(a + .6) * .03, -.13]], .07, tipToon, .9); }
    if (e === "bear") { const m = new THREE.Mesh(new THREE.SphereGeometry(.07, 14, 10), M.hair); m.position.z = -.04; withOutline(m, "thin", hairOutline); tail.add(m); }
  }
  // wearables
  if (state.wear.has("beanie")) { const bc = beanieMat.color.getStyle(), bn = new THREE.Group(); bn.position.set(0, .06, -.04); bn.rotation.x = -.22; head.add(bn);
    const capR = 1.27, th = Math.PI * .41, edgeR = Math.sin(th) * capR, edgeY = Math.cos(th) * capR * 1.12;
    add(bn, new THREE.SphereGeometry(capR, 48, 24, 0, Math.PI * 2, 0, th), toon(bc), [0, 0, 0], [0, 0, 0], [1.05, 1.12, 1.02], "mid");
    add(bn, new THREE.CylinderGeometry(edgeR * 1.08, edgeR * 1.1, .26, 56, 1, true), toon(darken(bc, .1)), [0, edgeY + .02, 0], [0, 0, 0], [1.05, 1, 1.02], "mid"); // snug turn-up band
    for (let k = 0; k < 36; k++) { const a = k / 36 * Math.PI * 2; add(bn, new THREE.BoxGeometry(.035, .24, .02), toon(darken(bc, .22)), [Math.sin(a) * edgeR * 1.095 * 1.05, edgeY + .02, Math.cos(a) * edgeR * 1.095 * 1.02], [0, a, 0], [1, 1, 1], null); } // ribs
    add(bn, new THREE.SphereGeometry(.26, 18, 14), toon(bc), [0, capR * 1.12 + .14, 0], [0, 0, 0], [1, 1, 1], "thin"); }
  if (state.wear.has("scarf")) add(body, new THREE.TorusGeometry(.17, .065, 12, 32), toon("#7FD0C9"), [0, .09, .01], [Math.PI / 2, 0, 0], [1, .9, 1], "thin");
  if (state.wear.has("headphones")) { add(head, new THREE.TorusGeometry(1.3, .08, 10, 48, Math.PI), toon("#3A2434"), [0, .02, -.05], [-.12, 0, 0], [1.04, 1.02, 1], "thin");
    for (const sx of [-1, 1]) { add(head, new THREE.CylinderGeometry(.3, .3, .2, 28), toon("#F7A055"), [sx * 1.3, .02, -.05], [0, 0, Math.PI / 2], [1, 1, 1], "thin");
      add(head, new THREE.CylinderGeometry(.22, .22, .06, 24), toon("#3A2434"), [sx * 1.42, .02, -.05], [0, 0, Math.PI / 2], [1, 1, 1], null); } }
  if (state.wear.has("glasses") || state.activity === "study") { const gl = new THREE.Group(); gl.position.set(0, -.01, 1.03); head.add(gl);
    for (const x of [-.27, .27]) add(gl, new THREE.TorusGeometry(.2, .025, 10, 32), toon("#2A1C27"), [x, 0, 0], [0, 0, 0], [1, 1, 1], null);
    add(gl, new THREE.TorusGeometry(.06, .02, 8, 12, Math.PI), toon("#2A1C27"), [0, .03, 0], [0, 0, 0], [1, 1, 1], null); }

  // props: built in the body's space where they're used, facing her; the arms then reach for them (see animateChibi)
  const act = state.activity;
  const propRoot = new THREE.Group(); body.add(propRoot);
  const P = {};
  const book = (cover) => { const g = new THREE.Group(); // open book tilted up towards her face, pages in a soft V
    for (const sx of [-1, 1]) { const c = add(g, new THREE.BoxGeometry(.13, .012, .18), toon(cover), [sx * .066, -.006, 0], [0, 0, sx * .14], [1, 1, 1], "thin");
      const pg = add(g, new THREE.BoxGeometry(.118, .02, .165), M.white, [sx * .062, .01, 0], [0, 0, sx * .14], [1, 1, 1], null);
      for (let k = 0; k < 4; k++) add(g, new THREE.BoxGeometry(.07 - (k % 2) * .02, .002, .006), toon("#B79CB0"), [sx * (.06 + (k % 2) * -.01), .022 + Math.abs(sx * .06) * .14 * sx * sx, -.05 + k * .03], [0, 0, sx * .14], [1, 1, 1], null); }
    g.rotation.x = -.75; return g; };
  if (act === "study" || act === "writing") {
    P.book = book(act === "study" ? "#6C8FE6" : "#CDA4E8"); P.book.position.set(0, -.11, .23); propRoot.add(P.book);
    P.tool = new THREE.Group(); propRoot.add(P.tool);
    if (act === "study") { add(P.tool, new THREE.CylinderGeometry(.013, .013, .2, 8), toon("#F4C542"), [0, .1, 0], [0, 0, 0], [1, 1, 1], "thin"); add(P.tool, new THREE.ConeGeometry(.013, .035, 8), toon("#E3AE8A"), [0, -.017, 0], [Math.PI, 0, 0], [1, 1, 1], null); add(P.tool, new THREE.CylinderGeometry(.014, .014, .025, 8), toon("#F2A2C4"), [0, .21, 0], [0, 0, 0], [1, 1, 1], null); }
    else { add(P.tool, new THREE.CylinderGeometry(.007, .007, .07, 6), toon("#2A1C27"), [0, .02, 0], [0, 0, 0], [1, 1, 1], null); add(P.tool, lockGeo([[0, .04, 0], [.02, .14, -.01], [.05, .26, -.03]], .045, .25, new THREE.Vector3(0, .1, -1)), toon("#FFF6EE"), [0, 0, 0], [0, 0, 0], [1, 1, 1], "thin"); }
  }
  if (act === "art") {
    P.palette = new THREE.Group(); P.palette.position.set(-.15, -.12, .17); P.palette.rotation.set(-.9, .4, .2); propRoot.add(P.palette);
    add(P.palette, new THREE.CylinderGeometry(.11, .11, .016, 28), toon("#E9C46A"), [0, 0, 0], [0, 0, 0], [1.25, 1, 1], "thin");
    ["#E25C6E", "#6C8FE6", "#4FB27A", "#F7A055", "#FFF6EE"].forEach((c, i) => add(P.palette, new THREE.SphereGeometry(.02, 10, 8), toon(c), [Math.cos(i * 1.25 + .3) * .085, .012, Math.sin(i * 1.25 + .3) * .06], [0, 0, 0], [1, .45, 1], null));
    P.tool = new THREE.Group(); propRoot.add(P.tool);
    add(P.tool, new THREE.CylinderGeometry(.011, .009, .2, 8), toon("#8D5A3C"), [0, .06, 0], [0, 0, 0], [1, 1, 1], "thin"); add(P.tool, new THREE.CylinderGeometry(.013, .013, .02, 8), toon("#D9D6E6"), [0, -.045, 0], [0, 0, 0], [1, 1, 1], null); add(P.tool, new THREE.ConeGeometry(.016, .05, 10), toon("#6C8FE6"), [0, -.08, 0], [Math.PI, 0, 0], [1, 1, 1], null);
    const br = new THREE.Group(); br.position.set(-.1, 1.0, -.08); br.rotation.set(-.12, 0, .28); head.add(br);
    add(br, new THREE.SphereGeometry(1.08, 40, 20), toon("#C2473F"), [0, 0, 0], [0, 0, 0], [1, .3, 1], "mid");
    add(br, new THREE.TorusGeometry(.86, .07, 10, 40), toon("#9E3530"), [0, -.24, 0], [Math.PI / 2, 0, 0], [1, 1, 1], null); // band where it grips the head
    add(br, new THREE.CylinderGeometry(.04, .025, .16, 8), toon("#C2473F"), [0, .38, 0], [0, 0, 0], [1, 1, 1], "thin");
  }
  if (act === "cocoa") {
    P.mug = new THREE.Group(); propRoot.add(P.mug);
    add(P.mug, new THREE.CylinderGeometry(.06, .054, .1, 24), toon("#F7B288"), [0, 0, 0], [0, 0, 0], [1, 1, 1], "thin");
    add(P.mug, new THREE.TorusGeometry(.028, .01, 8, 16), toon("#F7B288"), [.066, 0, 0], [0, 0, 0], [1, 1, 1], "thin");
    add(P.mug, new THREE.CylinderGeometry(.054, .054, .006, 24), toon("#6B4430"), [0, .046, 0], [0, 0, 0], [1, 1, 1], null);
    add(P.mug, new THREE.SphereGeometry(.018, 8, 6), toon("#FFF6EE"), [.015, .05, .01], [0, 0, 0], [1, .5, 1], null);
    P.steam = [0, 1, 2].map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(.018, 8, 6), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: .5 })); P.mug.add(m); return m; });
  }
  if (act === "sleepy") {
    const capPts = [new THREE.Vector3(0, .5, -.04), new THREE.Vector3(.04, .95, -.08), new THREE.Vector3(.3, 1.32, -.14), new THREE.Vector3(.72, 1.22, -.16), new THREE.Vector3(.92, .95, -.12)];
    add(head, taperTube(capPts, .97, .06, 28, 32), toon("#8E6CC9"), [0, 0, 0], [0, 0, 0], [1.06, 1, 1.02], "mid");
    add(head, new THREE.TorusGeometry(.95, .11, 14, 48), toon("#FFF6EE"), [0, .5, -.04], [Math.PI / 2 + .12, 0, 0], [1.08, 1.04, 1], "thin");
    add(head, new THREE.SphereGeometry(.17, 16, 12), toon("#FFF6EE"), [.94, .88, -.12], [0, 0, 0], [1, 1, 1], "thin");
  }
  // put body and head in an "actor" group so we can move the whole character (turn to the easel, climb into bed)
  const actor = new THREE.Group(); chibiRoot.add(actor); actor.add(body); actor.add(head);
  const stage = {};
  const popIn = (g) => { g.scale.setScalar(0.001); g.userData.pop = true; return g; };
  if (act === "art") { // easel with a canvas, turned to face her (and partly towards you)
    const easel = popIn(new THREE.Group()); easel.position.set(.66, -.6, .3); easel.rotation.y = -1.0; easel.scale.setScalar(1.15); chibiRoot.add(easel); stage.easel = easel;
    const wood = toon("#B07A4F");
    for (const [x, z, rz, rx] of [[-.17, .06, .12, -.1], [.17, .06, -.12, -.1], [0, -.18, 0, .32]]) add(easel, new THREE.CylinderGeometry(.018, .022, 1.1, 8), wood, [x, .52, z], [rx, 0, rz], [1, 1, 1], "thin");
    add(easel, new THREE.BoxGeometry(.5, .035, .08), wood, [0, .36, .1], [0, 0, 0], [1, 1, 1], "thin"); // ledge
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = 200; const cx = cv.getContext("2d"); cx.fillStyle = "#FFFDF7"; cx.fillRect(0, 0, 256, 200);
    const ctex = new THREE.CanvasTexture(cv); ctex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.BoxGeometry(.48, .38, .025), [toon("#E8DCC8"), toon("#E8DCC8"), toon("#E8DCC8"), toon("#E8DCC8"), new THREE.MeshBasicMaterial({ map: ctex }), toon("#E8DCC8")]);
    board.position.set(0, .58, .1); board.rotation.x = -.12; withOutline(board, "thin"); easel.add(board);
    stage.canvas = { cv, cx, ctex, board, step: 0, done: -1 };
  }
  if (act === "sleepy") { // a cosy bed across the stage; she climbs in, lies down, the blanket tucks over
    const bedOuter = popIn(new THREE.Group()); bedOuter.position.set(.05, -.6, -.05); chibiRoot.add(bedOuter); stage.bed = bedOuter;
    const bed = new THREE.Group(); bed.scale.set(1.4, 1.2, 1.2); bedOuter.add(bed);
    const frame = toon("#B07A4F");
    add(bed, new THREE.BoxGeometry(1.55, .2, .72), frame, [0, .13, 0], [0, 0, 0], [1, 1, 1], "mid");
    add(bed, new THREE.CapsuleGeometry(.16, 1.2, 8, 24), toon("#FFF6EE"), [0, .32, 0], [0, 0, Math.PI / 2], [1, .55, 2.05], "thin"); // mattress
    add(bed, new THREE.BoxGeometry(.1, .62, .76), frame, [-.8, .32, 0], [0, 0, 0], [1, 1, 1], "mid"); // headboard
    add(bed, new THREE.SphereGeometry(.4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), frame, [-.8, .62, 0], [0, 0, Math.PI / 2], [.22, 1, .95], "thin");
    add(bed, new THREE.BoxGeometry(.1, .4, .76), frame, [.8, .24, 0], [0, 0, 0], [1, 1, 1], "mid"); // footboard
    const pillow = add(bed, new THREE.SphereGeometry(.2, 24, 16), toon("#F4E9D8"), [-.48, .4, 0], [0, 0, 0], [1.15, .4, 1.5], "thin");
    const blanket = popIn(new THREE.Group()); blanket.position.set(.32, .47, .06); blanket.rotation.z = -.4; bed.add(blanket); stage.blanket = blanket;
    add(blanket, new THREE.CapsuleGeometry(.22, .5, 8, 24), toon("#8E6CC9"), [0, 0, 0], [0, 0, Math.PI / 2], [1, 1, 1.8], "mid");
    add(blanket, new THREE.CapsuleGeometry(.06, .6, 6, 16), toon("#CDA4E8"), [-.44, .03, 0], [Math.PI / 2, 0, 0], [1, 1.2, 1.25], "thin"); // folded edge at her chin
    for (let k = 0; k < 5; k++) add(blanket, new THREE.SphereGeometry(.03, 8, 6), toon("#F4C542"), [-.28 + k * .14, .2, (k % 2 ? .14 : -.06)], [0, 0, 0], [1, .4, 1], null); // little stars
    const zTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"); g.font = "bold 52px Nunito, sans-serif"; g.fillStyle = "#E7B4EE"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("Z", 32, 34); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    stage.zs = [0, 1, 2].map(() => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTex, transparent: true, depthWrite: false })); sp.scale.setScalar(.16); sp.visible = false; chibiRoot.add(sp); return sp; });
  }
  CH = { actor, stage, t0: performance.now() / 1000, body, head, hair, locks, ears, tail, arms, P, act, fang: e === "wolf" || e === "cat" || e === "fox", last: 0, hop: 0 };
  for (const a of arms) a.rest = a.hand.position.clone().normalize();
}

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
const PAINT = (() => { const st = [];
  const line = (c, w, pts) => { for (let i = 1; i < pts.length; i++) st.push({ c, w, a: pts[i - 1], b: pts[i] }); };
  line("#9FD8F5", 40, [[0, 40], [256, 40]]); line("#9FD8F5", 40, [[0, 80], [256, 80]]);
  for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; line("#F4C542", 6, [[200, 45], [200 + Math.cos(a) * 34, 45 + Math.sin(a) * 34]]); }
  line("#F7A055", 24, [[190, 45], [210, 45]]);
  line("#7CC48E", 46, [[0, 170], [60, 135], [130, 160], [200, 130], [256, 150]]); line("#4FB27A", 40, [[0, 195], [90, 170], [180, 190], [256, 175]]);
  line("#4FB27A", 5, [[70, 175], [72, 130]]); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; line("#F2A2C4", 12, [[72, 122], [72 + Math.cos(a) * 14, 122 + Math.sin(a) * 14]]); } line("#F4C542", 10, [[70, 122], [74, 122]]);
  return st; })();
const easeBack = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const clamp01 = x => Math.max(0, Math.min(1, x)); const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
function aimArm(a, target, k) { // point the arm from the shoulder at a target (body space), smoothly
  _v.copy(target).sub(a.pivot.position).normalize(); _q.setFromUnitVectors(a.rest, _v); a.pivot.quaternion.slerp(_q, k); }
function animateChibi(now, still, gaze, lid, mood, mouth) {
  if (!CH) return;
  const t = now / 1000, dt = Math.min(.05, CH.last ? t - CH.last : .016); CH.last = t;
  const k = still ? 1 : 1 - Math.exp(-dt * 9), kSlow = still ? 1 : 1 - Math.exp(-dt * 4);
  const act = CH.act, talking = mouth === "A" || mouth === "E" || mouth === "O" || mouth === "M";
  const sipCycle = (t % 6) / 6, sipping = act === "cocoa" && sipCycle > .72 && sipCycle < .95;
  if (CH.mood !== mood) { CH.mood = mood; CH.moodT = t; } const ms = t - (CH.moodT ?? 0);
  let faceMood = mood; if (sipping) faceMood = "happy";
  drawFace({ gx: sipping ? 0 : gaze.x, gy: sipping ? -.3 : gaze.y, lid, mood: faceMood, mouth: sipping ? "M" : mouth, iris: IRIS[state.eyesC], fang: CH.fang, skin: state.skin, hairHex: HAIR[state.hair] });
  // body: breathing; a little hop when excited, a bounce when happy, slower deeper breaths when sleepy
  const breathRate = mood === "sleepy" || act === "sleepy" ? .9 : 1.6, br = still ? 0 : Math.sin(t * breathRate * Math.PI / 1.6);
  const hopT = still ? 0 : mood === "excited" ? Math.abs(Math.sin(t * 5)) * 1.6 : mood === "surprised" ? Math.sin(Math.min(1, ms / .4) * Math.PI) * 2.2 : mood === "cheeky" ? Math.abs(Math.sin(t * 2.5)) * .25 : 0;
  CH.hop += ((hopT * .06) - CH.hop) * (mood === "surprised" ? 1 : k);
  const squash = mood === "excited" && !still ? (1 - Math.abs(Math.sin(t * 5))) * .04 : 0;
  CH.body.scale.set(1.2 * (1 + br * .012 + squash), 1.2 * (1 - br * .018 - squash), 1.2 * (1 + br * .012 + squash));
  chibiRoot.position.y = CH.hop; chibiRoot.rotation.y = yaw + (still ? 0 : mood === "shy" ? -.25 + Math.sin(t * 1.2) * .08 : 0);
  // whole-body sway: content and gentle when happy or loving, a cheeky lean, a slump when sad, chest out when proud
  const swayZ = still ? 0 : mood === "happy" || mood === "loving" ? Math.sin(t * 1.6) * .05 : 0;
  CH.actor.rotation.x = (CH.act === "none" || CH.act === "cocoa") ? (mood === "sad" ? .07 : mood === "proud" ? -.05 : mood === "surprised" ? -.06 * Math.max(0, 1 - ms / 1.2) : 0) : CH.actor.rotation.x;
  if (CH.act !== "sleepy") CH.actor.rotation.z = swayZ + (mood === "cheeky" ? -.06 : 0);
  // head: follows the gaze, tilts when listening, nods while talking, droops when sleepy, tips back to sip
  let hx = still ? 0 : -gaze.y * .12, hy = still ? 0 : gaze.x * .3, hz = still ? 0 : Math.sin(t * .7) * .025;
  if (mood === "listening" && !talking) hz += .08;
  if (mood === "thinking") { hz += .14; hx -= .06; }
  if (mood === "shy") { hx += .2; hz += .12; hy -= .15; }
  if (mood === "sad") { hx += .26; }
  if (mood === "proud") { hx -= .16; hz -= .05; }
  if (mood === "surprised") { hx -= .1 * Math.max(.4, 1 - ms); }
  if (mood === "cheeky") { hz -= .16; }
  if (state.wear.has("headphones") && !still && act !== "sleepy") { hx += Math.max(0, Math.sin(t * 6.4)) * .06; hz += Math.sin(t * 3.2) * .04; } // bopping along to the music
  if (mood === "loving") { hz += .14 + (still ? 0 : Math.sin(t * 1.6) * .04); }
  if (talking && !still) hx += Math.sin(t * 9) * .035;
  if ((mood === "sleepy" || act === "sleepy") && !(act === "sleepy" && t - CH.t0 > 1.3)) { hx += .16 + (still ? 0 : Math.max(0, Math.sin(t * .6)) * .12); hz += .18; }
  if (act === "study" || act === "writing") hx += .22; // looking down at the page
  if (act === "art") { hx += .1; hy += .12; } // eyes on the canvas
  if (sipping) hx -= .18;
  CH.head.rotation.x += (hx - CH.head.rotation.x) * kSlow; CH.head.rotation.y += (hy - CH.head.rotation.y) * kSlow; CH.head.rotation.z += (hz - CH.head.rotation.z) * kSlow;
  CH.head.position.y = C.headY - br * .006;
  // arms: aim at targets (body space)
  const [Lf, Rt] = CH.arms, T = (x, y, z) => new THREE.Vector3(x, y, z);
  const idle = (a) => T(a.sx * .26, -.26 + (still ? 0 : Math.sin(t * 1.6 + a.sx) * .01), .03);
  let tl = idle(Lf), tr = idle(Rt);
  const P = CH.P;
  if (act === "study" || act === "writing") {
    tl = T(-.13, -.15, .24);
    const wx = still ? 0 : Math.sin(t * 11) * .012 + Math.sin(t * 2.3) * .025, wy = still ? 0 : Math.abs(Math.sin(t * 11)) * .006;
    tr = T(.04 + wx, -.07 + wy, .27);
    P.tool.position.copy(tr).add(T(.0, .035, .0)); P.tool.rotation.set(.55, 0, -.45 + (still ? 0 : Math.sin(t * 11) * .08));
  }
  if (act === "art") {
    tl = T(-.15, -.13, .19);
    const dab = still ? 0 : Math.max(0, Math.sin(t * 3)) * .05;
    tr = T(.15, -.02 + Math.sin(t * 1.5) * (still ? 0 : .02), .25 + dab);
    P.tool.position.copy(tr).add(T(0, .02, .02)); P.tool.rotation.set(.5, 0, -.75); tr = null;
  }
  if (act === "cocoa") {
    const lift = sipping ? 1 : 0; CH.sip = (CH.sip ?? 0) + (lift - (CH.sip ?? 0)) * kSlow;
    const mugPos = T(0, -.05 + CH.sip * .16, .22 - CH.sip * .05); P.mug.position.copy(mugPos); P.mug.rotation.x = -CH.sip * .6;
    tl = mugPos.clone().add(T(-.07, -.01, 0)); tr = mugPos.clone().add(T(.08, -.01, 0));
    P.steam.forEach((m, i) => { const q = ((t * .45 + i / 3) % 1); m.position.set(Math.sin(q * 6 + i) * .02, .06 + q * .16, 0); m.material.opacity = .5 * (1 - q) * (1 - CH.sip); m.scale.setScalar(1 + q * 1.5); });
  }
  if (act === "sleepy") { tl = T(-.2, -.28, .08); tr = T(.2, -.28, .08); }
  // moods override the free arm(s)
  if (act === "none" || act === "cocoa" && false) {
    if (mood === "happy") { tl = T(-.06, -.17, .21); tr = T(.06, -.17, .21); } // calm: hands clasped in front
    if (mood === "excited") { const pump = still ? 0 : Math.abs(Math.sin(t * 5)) * .1; tl = T(-.3, .38 + pump, .08); tr = T(.3, .38 + pump, .08); } // both arms up, pumping
    if (mood === "surprised") { tl = T(-.34, .22, .16); tr = T(.34, .22, .16); }
    if (mood === "shy") { tl = T(-.05, -.22, .22); tr = T(.05, -.22, .22); }
    if (mood === "sad") { tl = T(-.14, -.32, .1); tr = T(.14, -.32, .1); }
    if (mood === "proud") { tl = T(-.3, -.17, -.06); tr = T(.3, -.17, -.06); } // hands on hips
    if (mood === "loving") { tl = T(-.2, .4, .3); tr = T(.2, .4, .3); } // hands to her cheeks
    if (mood === "cheeky") tr = T(.26, .4, .24); // a little peace sign by her face
    if (mood === "thinking") tr = T(.04, .14, .17);
    if (talking && !["excited", "happy", "thinking", "surprised", "loving", "cheeky", "proud", "shy"].includes(mood)) tr = T(.22 + (still ? 0 : Math.sin(t * 2.1) * .04), -.08 + (still ? 0 : Math.sin(t * 3.3) * .05), .17);
    if (mood === "sleepy") { tl = T(-.2, -.3, .05); tr = T(.2, -.3, .05); }
  } else if (mood === "excited" || mood === "happy") { if (act !== "cocoa" && act !== "sleepy") tl = T(-.26, .3 + (still ? 0 : Math.sin(t * 9) * .03), .05); }
  aimArm(Lf, tl, k); if (tr) aimArm(Rt, tr, k);
  // hands turn inward to grip when holding
  for (const a of CH.arms) { const hold = act !== "none"; a.hand.rotation.y += ((hold ? -a.sx * .9 : 0) - a.hand.rotation.y) * k; }
  // ears: a quick twitch now and then, perk up when excited, droop when sleepy
  CH.ears.children.forEach(ear => { const b = ear.userData.baseRot; if (!b) return; const tw = still ? 0 : Math.max(0, Math.sin(t * 2.7 + ear.userData.sx * 2.1) - .93) * 4;
    const droop = mood === "sleepy" || act === "sleepy" ? .35 : mood === "sad" ? .5 : mood === "shy" ? .3 : mood === "excited" || mood === "surprised" ? -.15 : mood === "proud" ? -.08 : 0;
    ear.rotation.x = b.x + tw * .3 + droop * .6; ear.rotation.z = b.z - ear.userData.sx * droop * .5; });
  // tail: wag speed and size follow the mood
  if (CH.tail) { const wag = { excited: 8, happy: 3, loving: 3.5, cheeky: 4.5, proud: 2.5, surprised: 0, shy: 1.4, sad: .8 }[mood] ?? (mood === "sleepy" || act === "sleepy" ? 1.1 : 2.2), amp = { excited: .65, happy: .35, loving: .4, cheeky: .45, shy: .18, sad: .1, sleepy: .15 }[mood] ?? .38;
    CH.tail.rotation.y = still ? 0 : Math.sin(t * wag) * amp; CH.tail.rotation.x = (still ? 0 : Math.sin(t * wag * 2) * .05) + (mood === "sleepy" || mood === "sad" ? .4 : mood === "surprised" ? -.3 : mood === "shy" ? .2 : 0); }
  // ── stage moments ──
  const since = t - CH.t0, S = CH.stage;
  for (const g of [S.easel, S.bed]) if (g && g.userData.pop) { const q = clamp01(since / .45); g.scale.setScalar(Math.max(.001, easeBack(q))); if (q >= 1) g.userData.pop = false; }
  if (act === "art" && S.canvas) {
    // she turns towards the easel and paints on it; strokes appear as the brush dabs
    CH.actor.rotation.y = 1.0 * smooth(since / .7); // turn to face the easel
    const c = S.canvas; c.board.updateWorldMatrix(true, false);
    const u = .25 + .5 * (.5 + .5 * Math.sin(t * .9)), v = .3 + .4 * (.5 + .5 * Math.sin(t * .63 + 1));
    _w.set((u - .5) * .44, (v - .5) * -.34, .02); c.board.localToWorld(_w); CH.body.worldToLocal(_w);
    const dab = still ? 0 : Math.max(0, Math.sin(t * 6)) ;
    const reach = _w.clone().add(new THREE.Vector3(-.03, 0, -.03).multiplyScalar(1 - dab));
    aimArm(Rt, reach, k); P.tool.position.copy(reach).add(new THREE.Vector3(-.02, .03, -.02)); P.tool.rotation.set(.3, -1.0, -1.1);
    if (since > .5 && !still && dab > .9 && c.step < PAINT.length) { for (let n = 0; n < 3 && c.step < PAINT.length; n++, c.step++) { const st = PAINT[c.step]; c.cx.strokeStyle = st.c; c.cx.lineWidth = st.w; c.cx.lineCap = "round"; c.cx.beginPath(); c.cx.moveTo(...st.a); c.cx.lineTo(...st.b); c.cx.stroke(); } c.ctex.needsUpdate = true; }
    if (c.step >= PAINT.length) { if (c.done < 0) c.done = t; if (t - c.done > 3) { c.cx.fillStyle = "#FFFDF7"; c.cx.fillRect(0, 0, 256, 200); c.ctex.needsUpdate = true; c.step = 0; c.done = -1; } }
  } else if (CH.actor.rotation.y) CH.actor.rotation.y += (0 - CH.actor.rotation.y) * kSlow;
  if (act === "sleepy" && S.bed) {
    // 0–0.5s bed pops in · 0.5–1.3s yawn and stretch · 1.3–2.2s hop in and lie down · 2.2s blanket tucks over · then sleep
    const stretch = smooth((since - .5) / .3) * (1 - smooth((since - 1.1) / .25));
    if (stretch > 0) { aimArm(Lf, T(-.18, .4, 0), .5); aimArm(Rt, T(.18, .4, 0), .5); }
    const lie = smooth((since - 1.3) / .9);
    CH.actor.rotation.z = lie * (Math.PI / 2 - .4); CH.actor.rotation.y = 0;
    CH.actor.position.set(.09 * lie, Math.sin(lie * Math.PI) * .35 + lie * .08, 0);
    if (lie > .99) { CH.head.rotation.set(0, .25, -.4); for (const a of CH.arms) a.pivot.quaternion.slerp(_q.setFromUnitVectors(a.rest, _v.set(0, -1, .2).normalize()), k); }
    if (S.blanket.userData.pop && since > 2.2) { const q = clamp01((since - 2.2) / .45); S.blanket.scale.setScalar(Math.max(.001, easeBack(q))); if (q >= 1) S.blanket.userData.pop = false; }
    if (!S.blanket.userData.pop) S.blanket.scale.set(1, 1 + (still ? 0 : Math.sin(t * 1.2) * .04), 1);
    S.zs.forEach((z, i) => { z.visible = since > 2.8 && !still; const q = ((t * .35 + i / 3) % 1); z.position.set(-.3 + q * .3 + Math.sin(q * 6) * .03, .85 + q * .5, .25); z.material.opacity = Math.sin(q * Math.PI); z.scale.setScalar(.1 + q * .12); });
    drawFace({ gx: 0, gy: 0, lid: 0, mood: "sleepy", mouth: since > 0.6 && since < 1.1 ? "O" : "O-small", iris: IRIS[state.eyesC], fang: CH.fang, skin: state.skin, hairHex: HAIR[state.hair] });
  }
  // hair: each lock sways and lags behind head turns
  for (const l of CH.locks) { const sw = still ? 0 : l.amp; l.pivot.rotation.z = sw * Math.sin(t * 1.7 + l.phase) * .035; l.pivot.rotation.x = sw * (Math.sin(t * 1.3 + l.phase * 1.3) * .025 - CH.head.rotation.x * .2) + (CH.hop * -1.2 * sw); l.pivot.rotation.y = sw * -CH.head.rotation.y * .2; }
}
// ── mood effects: Zs drift up when sleepy; a thought bubble fills with dots when thinking ──
const moodFxG = new THREE.Group(); root.add(moodFxG);
const fxZTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"); g.font = "900 54px Nunito, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 8; g.strokeStyle = "#3A2434"; g.strokeText("Z", 32, 34); g.fillStyle = "#E7B4EE"; g.fillText("Z", 32, 34); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const fxZs = [0, 1, 2].map(() => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fxZTex, transparent: true, depthWrite: false })); sp.visible = false; moodFxG.add(sp); return sp; });
const bubCv = document.createElement("canvas"); bubCv.width = 256; bubCv.height = 192; const bubCx = bubCv.getContext("2d"), bubTex = new THREE.CanvasTexture(bubCv); bubTex.colorSpace = THREE.SRGBColorSpace;
const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubTex, transparent: true, depthWrite: false })); bubble.visible = false; moodFxG.add(bubble); let bubDots = -1;
function drawBubble(n) { const g = bubCx; g.clearRect(0, 0, 256, 192); g.lineWidth = 7; g.strokeStyle = "#3A2434"; g.fillStyle = "#FFFDF7";
  const puff = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke(); };
  puff(34, 172, 9); puff(58, 146, 15); // the little trail of thought puffs, down towards the head
  g.beginPath(); g.ellipse(150, 78, 92, 60, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = "#3A2434"; for (let i = 0; i < n; i++) { g.beginPath(); g.arc(110 + i * 40, 80, 11, 0, Math.PI * 2); g.fill(); }
  bubTex.needsUpdate = true; }
const glyphTex = (draw) => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"); g.lineWidth = 6; g.strokeStyle = "#3A2434"; g.lineJoin = "round"; draw(g); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
const heartTex = glyphTex(g => { heartPath(g, 32, 34, 52); g.fillStyle = "#FF6F98"; g.fill(); g.stroke(); g.fillStyle = "#fff"; g.beginPath(); g.arc(22, 24, 4, 0, Math.PI * 2); g.fill(); });
const sparkTex = glyphTex(g => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2, r = i % 2 ? 9 : 27; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } g.closePath(); g.fillStyle = "#FFE27A"; g.fill(); g.stroke(); });
const bangTex = glyphTex(g => { g.font = "900 56px Nunito, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 8; g.strokeText("!", 32, 34); g.fillStyle = "#FF8A5C"; g.fillText("!", 32, 34); });
const tearTex = glyphTex(g => { g.lineWidth = 4; g.strokeStyle = "#5E9CD6"; g.beginPath(); g.moveTo(32, 6); g.quadraticCurveTo(52, 38, 32, 56); g.quadraticCurveTo(12, 38, 32, 6); g.fillStyle = "#A6DAFF"; g.fill(); g.stroke(); g.fillStyle = "#fff"; g.beginPath(); g.arc(27, 38, 5, 0, Math.PI * 2); g.fill(); });
const mkSprite = (tex) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })); sp.visible = false; moodFxG.add(sp); return sp; };
const noteTex = [["♪", "#8FD8CC"], ["♫", "#F2A2C4"], ["♪", "#FFE27A"]].map(([ch, col]) => glyphTex(g => { g.font = "900 50px Nunito, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 7; g.strokeText(ch, 32, 34); g.fillStyle = col; g.fillText(ch, 32, 34); }));
const fxNotes = [0, 1, 2, 3].map(i => mkSprite(noteTex[i % 3]));
const fxTear = mkSprite(tearTex), fxHearts = [0, 1, 2].map(() => mkSprite(heartTex)), fxSparks = [0, 1, 2, 3].map(() => mkSprite(sparkTex)), fxBang = mkSprite(bangTex);
const _fxv = new THREE.Vector3();
function moodFx(t, still, m, ms = 9) {
  { const chibi = state.kind === "chibi", cx = 0, cy = chibi ? .62 + (CH ? CH.hop : 0) : .2, rad = chibi ? .72 : 1.15;
    // loving: little hearts float up around the head
    fxHearts.forEach((h, i) => { h.visible = m === "loving"; if (!h.visible) return; const q = still ? (i + .5) / 3 : (t * .32 + i / 3) % 1, sx = i % 2 ? 1 : -1;
      h.position.set(cx + sx * (rad * .9 + q * .12) + (still ? 0 : Math.sin(q * 8 + i) * .04), cy + rad * .2 + q * .7, .45); h.material.opacity = still ? 1 : Math.sin(q * Math.PI); h.scale.setScalar(.14 + q * .08); });
    // excited and proud: sparkles twinkle around the head
    fxSparks.forEach((sp, i) => { sp.visible = m === "excited" || m === "proud"; if (!sp.visible) return; const a = [.5, 2.5, 1.2, 2.0][i] + (m === "proud" ? .1 : 0), tw = still ? 1 : Math.max(0, Math.sin(t * (m === "excited" ? 7 : 3) + i * 1.7));
      sp.position.set(cx + Math.cos(a) * rad * 1.15, cy + Math.sin(a) * rad * .95 + .1, .45); sp.scale.setScalar(.04 + tw * (m === "excited" ? .13 : .1)); sp.material.opacity = .3 + tw * .7; });
    // sad (blob): a tear rolls down from one eye, over and over
    fxTear.visible = m === "sad" && !chibi; if (fxTear.visible) { const q = still ? .3 : (t * .45) % 1; _fxv.set(-.24, -.14 - q * .22, .07); face.localToWorld(_fxv); moodFxG.worldToLocal(_fxv); fxTear.position.copy(_fxv); fxTear.scale.setScalar(.1 + Math.min(q, .2) * .3); fxTear.material.opacity = still ? 1 : 1 - Math.max(0, q - .7) / .3; }
    // headphones: music notes drift up from the ear cups
    fxNotes.forEach((n, i) => { n.visible = state.wear.has("headphones") && !(chibi && state.activity === "sleepy"); if (!n.visible) return;
      const sx = i % 2 ? 1 : -1, q = still ? (i + .5) / 4 : (t * .38 + i / 4) % 1;
      n.position.set(cx + sx * (rad * 1.02 + q * .28) + (still ? 0 : Math.sin(q * 9 + i) * .05), cy - rad * .05 + q * .75, .4); n.material.opacity = still ? 1 : Math.sin(q * Math.PI); n.scale.setScalar(.12 + q * .07); n.material.rotation = still ? 0 : Math.sin(t * 3 + i) * .25; });
    // surprised: a "!" pops above the head
    fxBang.visible = m === "surprised"; if (fxBang.visible) { const q = still ? 1 : easeBack(Math.min(1, ms / .35)); fxBang.position.set(cx + rad * .55, cy + rad * 1.1, .45); fxBang.scale.setScalar(Math.max(.001, q * .26)); }
  }
  const chibi = state.kind === "chibi", bedtime = chibi && state.activity === "sleepy";
  const hx = chibi ? .55 : .95, hy = chibi ? 1.22 + (CH ? CH.hop : 0) : 1.15; // just above and to the side of the head
  fxZs.forEach((z, i) => { z.visible = m === "sleepy" && !bedtime; if (!z.visible) return;
    const q = still ? (i + .5) / 3 : (t * .3 + i / 3) % 1;
    z.position.set(hx + q * .35 + (still ? 0 : Math.sin(q * 7 + i) * .04), hy - .1 + q * .6, .4); z.material.opacity = still ? .9 : Math.sin(q * Math.PI); z.scale.setScalar(.12 + q * .14); });
  bubble.visible = m === "thinking";
  if (bubble.visible) { const n = still ? 3 : Math.floor(t * 2.2) % 4; if (n !== bubDots) { bubDots = n; drawBubble(n); }
    bubble.position.set(hx + .32, hy + .18 + (still ? 0 : Math.sin(t * 1.4) * .03), .4); bubble.scale.set(.72, .54, 1); }
}

// ── state → scene ────────────────────────────────────────────────────────────────
function apply() {
  applyStyle();
  beanieMat.color.set(state.beanie);
  const isChibi = state.kind === "chibi";
  pip.visible = !isChibi; chibiRoot.visible = isChibi;
  renderer.toneMapping = isChibi ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  key.intensity = isChibi ? 2.2 : 1.6; rim.intensity = isChibi ? 0 : 1.2; if (hemi) { hemi.intensity = isChibi ? 1.1 : .5; hemi.groundColor.set(isChibi ? "#6a4a78" : "#2a1020"); }
  if (isChibi) buildChibi();
  chibi.visible = hair.visible = isChibi;
  head.position.y = isChibi ? .5 : 0; head.scale.setScalar(isChibi ? .62 : 1);
  shadow.position.y = isChibi ? -.6 : -.83;
  hairMat.color.set(HAIR[state.hair]); irisMat.color.set(isChibi ? IRIS[state.eyesC] : "#2A1C27"); outfitMat.color.set(OUTFIT[state.outfit]);
  longHair.visible = state.hairStyle === "long"; twin.visible = state.hairStyle === "twin"; bob.visible = state.hairStyle === "bob";
  for (const k in tails) tails[k].visible = isChibi && state.ears === k;
  parts.scarf.position.y = isChibi ? -.18 : 0;
  for (const e of ["wolf", "fox", "cat", "bunny", "bear"]) { parts[e].visible = state.ears === e; parts[e].traverse(o => { if (o.isMesh && o.material !== pinkInner) o.material = isChibi ? hairMat : bodyMat; }); }
  for (const w of ["beanie", "scarf", "glasses", "headphones"]) parts[w].visible = state.wear.has(w);
  if (opts.framing === "portrait") { portraitBox = framingBox("portrait"); resize(); }
  invalidate();
}

// ── pointer: drag turns (the eyes never follow the pointer) ───────────────────────────
const onDown = e => { dragging = true; lastX = e.clientX; try { canvas.setPointerCapture(e.pointerId); } catch { /* fine */ } canvas.style.cursor = "grabbing"; invalidate(); };
const onMove = e => { if (!dragging) return; yawV = (e.clientX - lastX) * 0.01; yaw += yawV; lastX = e.clientX; invalidate(); };
const onUp = () => { dragging = false; canvas.style.cursor = "grab"; invalidate(); };
canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onUp);
canvas.style.cursor = "grab"; canvas.style.touchAction = "pan-y";

// ── animation loop (renders only while needed; pauses when hidden or inactive) ──────────
function invalidate() { need = true; if (!running && !disposed) { running = true; raf = requestAnimationFrame(loop); } }
let nextBlink = performance.now() + 2500, blinkT = -1, nextLook = 0, lastMood = "", moodT = 0;
const gaze = new THREE.Vector2(), wander = new THREE.Vector2(), zero = new THREE.Vector2();

function loop(now) {
  running = false; if (disposed || document.hidden) return;
  if (!active && !need) return;
  // gaze: where it likes to look, mostly at you, sometimes a glance away or up
  if (now > nextLook) { const r = Math.random();
    if (r < .5) wander.set((Math.random() - .5) * .15, (Math.random() - .5) * .1); else if (r < .75) wander.set((Math.random() < .5 ? -1 : 1) * (.5 + Math.random() * .5), (Math.random() - .4) * .4); else wander.set((Math.random() - .5) * .8, .45 + Math.random() * .3);
    nextLook = now + (r < .5 ? 2200 : 900) + Math.random() * 2200; }
  gaze.lerp(still ? zero : wander, still ? 1 : 0.08);
  const gx = gaze.x * .055, gy = gaze.y * .04;
  for (const e of [eL, eR]) e.position.y = gy, e.children.forEach(c => c.position.x = (c.userData.ox ??= c.position.x) + gx);
  pip.rotation.y = yaw + (still ? 0 : gaze.x * .22); pip.rotation.x = still ? 0 : -gaze.y * .08;
  if (!dragging) { yaw += yawV; yawV *= .9; if (Math.abs(yawV) < 1e-4) yawV = 0; }
  // breathe + idle bob
  const t = now / 1000;
  const breathe = still ? 0 : Math.sin(t * 1.6) * .018;
  pip.scale.set(1 + breathe * .6, 1 - breathe, 1 + breathe * .6); pip.position.y = still ? 0 : Math.sin(t * 1.6) * .015;
  // blink
  if (!still && now > nextBlink) { blinkT = now; nextBlink = now + 2500 + Math.random() * 3500; }
  let lid = 1; if (blinkT > 0) { const k = (now - blinkT) / 160; lid = k < 1 ? Math.abs(1 - 2 * k) * .9 + .1 : 1; if (k >= 1) blinkT = -1; }
  // mood → face
  const m = state.mood;
  const closedUp = m === "happy", closedDown = m === "sleepy" || m === "proud";
  eyes.visible = !(closedUp || closedDown || m === "loving"); eR.visible = m !== "cheeky"; heartEyes.visible = m === "loving";
  happyEyes.visible = closedUp || m === "cheeky"; happyEyes.children[0].visible = m !== "cheeky"; sleepyEyes.visible = closedDown;
  if (m === "loving") heartEyes.children.forEach((h, i) => h.scale.setScalar(still ? 1 : 1 + Math.max(0, Math.sin(t * 6 + i * .3)) * .12)); // heartbeat
  const big = m === "excited" ? 1.18 : m === "surprised" ? 1.28 : 1, sq = m === "sad" ? .8 : m === "shy" ? .85 : 1;
  eL.scale.set(big, big * lid * sq, big); eR.scale.set(big, big * lid * sq, big);
  if (m === "shy") for (const e of [eL, eR]) { e.position.y = -.04; e.children.forEach(c => c.position.x = c.userData.ox + .045); }
  if (m === "sad") for (const e of [eL, eR]) { e.position.y = -.03; e.children.forEach(c => c.position.x = c.userData.ox); }
  for (const c of blobCheeks) { const b = m === "shy" || m === "loving" ? 1.45 : m === "excited" ? 1.15 : 1; c.scale.set(1.25 * b, .8 * b, 1); }
  if (m === "thinking") { eL.position.y = eR.position.y = .05; for (const e of [eL, eR]) e.children.forEach(c => c.position.x = c.userData.ox + .045); }
  smile.visible = open.visible = flat.visible = smirk.visible = tongueOut.visible = false; smile.rotation.z = Math.PI; smile.position.y = 0; flat.scale.set(1, 1, 1);
  const mouth = { happy: "smile", excited: "grin", thinking: "smirk", sleepy: "O-small", surprised: "O", shy: "wavy", sad: "frown", proud: "smirk", loving: "smile", cheeky: "tongue" }[m] || "smile-small";
  if (mouth === "smile") { smile.visible = true; smile.scale.set(1.25, 1.25, 1); }
  else if (mouth === "smile-small") { smile.visible = true; smile.scale.set(.85, .7, 1); }
  else if (mouth === "smirk") smirk.visible = true;
  else if (mouth === "frown") { smile.visible = true; smile.rotation.z = 0; smile.scale.set(.85, .75, 1.6); smile.position.y = -.03; }
  else if (mouth === "wavy") { flat.visible = true; flat.scale.set(1, .7, 1); }
  else if (mouth === "tongue") { smile.visible = true; smile.scale.set(.8, .7, 1); tongueOut.visible = true; }
  else if (mouth === "grin") { open.visible = true; open.scale.set(1.6, 1.3, 1); tongue.visible = true; }
  else { open.visible = true; const s = { O: [.75, 1.05], "O-small": [.55, .55] }[mouth] || [1, 1]; open.scale.set(s[0], s[1], 1); tongue.visible = false; }
  // gentle sway of the blob's ears and the chibi's tail
  const sway = still ? 0 : Math.sin(t * 2.2) * .04;
  for (const t2 of Object.values(tails)) if (t2.visible) t2.rotation.y = still ? 0 : Math.sin(t * 2.6) * .35;
  for (const e of ["wolf", "fox", "cat", "bunny", "bear"]) parts[e].children.forEach((c, i) => c.rotation.y = (i ? -1 : 1) * sway);
  if (state.kind === "chibi") animateChibi(now, still, gaze, lid, m, mouth);
  if (m !== lastMood) { lastMood = m; moodT = t; }
  const ms = t - moodT;
  if (state.kind !== "chibi" && !still) { // the blob moves with its mood too
    pip.rotation.z = m === "happy" || m === "loving" ? Math.sin(t * 1.6) * .07 : m === "shy" ? .1 + Math.sin(t * 1.1) * .03 : m === "cheeky" ? -.12 : 0;
    if (m === "excited") pip.position.y += Math.abs(Math.sin(t * 5)) * .14;
    if (m === "surprised") pip.position.y += Math.sin(Math.min(1, ms / .45) * Math.PI) * .22;
    if (m === "sad") { pip.rotation.x += .14; pip.position.y -= .03; }
    if (m === "proud") pip.rotation.x -= .12;
    if (m === "shy") pip.rotation.y -= .25;
  } else if (state.kind !== "chibi") pip.rotation.z = 0;
  moodFx(t, still, m, ms);
  renderer.render(scene, camera);
  const animating = active && (!still || blinkT > 0 || dragging || yawV !== 0);
  need = false;
  if (animating) { running = true; raf = requestAnimationFrame(loop); }
}
const onVisible = () => { if (!document.hidden) invalidate(); };
document.addEventListener("visibilitychange", onVisible);

// ── pictures: render into an image, framed on the head and shoulders or the whole character ──
function visBox(obj) { const b = new THREE.Box3(), tb = new THREE.Box3(); obj.updateWorldMatrix(true, true);
  (function walk(o) { if (!o.visible) return; if (o.isMesh && o.geometry) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); tb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); b.union(tb); } for (const c of o.children) walk(c); })(obj);
  return b; }
/** What a picture frames: the whole character, or the head and shoulders whatever the hair length. */
function framingBox(framing) {
  const chibiOn = state.kind === "chibi" && CH;
  if (framing === "full") return visBox(chibiOn ? chibiRoot : pip);
  if (!chibiOn) return visBox(pip);
  const box = visBox(CH.head), hc = CH.head.getWorldPosition(new THREE.Vector3());
  box.min.y = hc.y - .78; box.min.x = Math.max(box.min.x, hc.x - .75); box.max.x = Math.min(box.max.x, hc.x + .75);
  return box;
}
function aimAt(box, framing) {
  const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  const half = Math.max(sz.y / 2, sz.x / 2 / camera.aspect) * (framing === "full" ? 1.08 : 1.12);
  camera.position.set(c.x, c.y, c.z + half / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) + sz.z / 2); camera.lookAt(c);
  camera.updateProjectionMatrix();
}
function snapshot(framing = "portrait", px = 1024, clear = false) {
  const w = px, h = framing === "full" ? Math.round(px * 1.25) : px;
  const pr = renderer.getPixelRatio(), pos = camera.position.clone(), quat = camera.quaternion.clone();
  if (state.kind === "chibi" && !CH) buildChibi();
  // make sure the pose is current, even when nothing has animated yet
  loopOnce();
  const box = framingBox(framing);
  const shadowWas = shadow.visible; if (clear) shadow.visible = false; // no floor shadow on a see-through picture
  renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h;
  aimAt(box, framing);
  renderer.render(scene, camera);
  const out = document.createElement("canvas"); out.width = w; out.height = h; const g = out.getContext("2d");
  if (!clear) { g.fillStyle = "#211520"; g.fillRect(0, 0, w, h); const r = g.createRadialGradient(w / 2, h * .42, 0, w / 2, h * .42, Math.max(w, h) * .7); r.addColorStop(0, "rgba(231,180,238,.30)"); r.addColorStop(1, "rgba(231,180,238,0)"); g.fillStyle = r; g.fillRect(0, 0, w, h); }
  g.drawImage(renderer.domElement, 0, 0, w, h);
  shadow.visible = shadowWas; renderer.setPixelRatio(pr); camera.position.copy(pos); camera.quaternion.copy(quat); camera.aspect = 1; resize(); invalidate();
  return out;
}
/** One frame of the pose without scheduling another (for pictures taken before anything moved). */
function loopOnce() { const a = active, n = need; active = false; need = true; const r = running; running = false; loop(performance.now()); running = r; active = a; need = n; }

// ── tidy up ────────────────────────────────────────────────────────────────────────
function dispose() {
  if (disposed) return;
  disposed = true; cancelAnimationFrame(raf); ro.disconnect();
  document.removeEventListener("visibilitychange", onVisible);
  canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
  canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp);
  const mats = new Set(), texs = new Set();
  scene.traverse(o => { if (o.geometry) o.geometry.dispose(); const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of ms) mats.add(m); });
  for (const m of [bodyMat, dark, irisMat, pupilMat, hairMat, outfitMat, shoeMat, white, mouthMat, tongueMat, cheekMat, pinkInner, beanieMat, scarfMat, frameMat, lensMat, phoneMat, OL.thick, OL.mid, OL.thin]) mats.add(m);
  for (const m of mats) { for (const k of ["map", "normalMap", "gradientMap"]) if (m[k]) texs.add(m[k]); m.dispose(); }
  for (const t of [noiseNormal, shadowTex, faceTex, toonRamp, skinRamp, ...texs]) t.dispose();
  if (scene.environment) scene.environment.dispose();
  pmrem.dispose(); renderer.dispose();
  try { renderer.forceContextLoss(); } catch { /* fine */ }
}

resize(); apply();
return {
  setLook(l) { state = toState(l); apply(); },
  setMood(m) { state.mood = m; invalidate(); },
  setActivity(a) { if (state.activity === a) return; state.activity = a; apply(); },
  setStill(s) { still = !!s; invalidate(); },
  setActive(a) { active = !!a; invalidate(); },
  snapshot,
  dispose,
};
}
