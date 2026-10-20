// Nie Patrz Wstecz — leśny survival horror w stylu Roblox.
// Zwykły skrypt (nie moduł ES), żeby gra działała po dwukliku index.html, bez serwera.
(() => {
'use strict';
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ===================================================================
// Renderer / scene
// ===================================================================
// Phones/tablets: touch controls + lighter graphics. "?touch=1" forces it for testing on a computer.
const TOUCH = /[?&]touch=1/.test(location.search) || (('ontouchstart' in window) && matchMedia('(pointer: coarse)').matches);
const LOW = TOUCH;
document.documentElement.classList.toggle('touch', TOUCH);

const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, LOW ? 1.25 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !LOW;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
const NIGHT_FOG = new THREE.Color(0x06080d);
const DAWN_FOG = new THREE.Color(0x8a8f9c);
scene.background = NIGHT_FOG.clone();
scene.fog = new THREE.FogExp2(NIGHT_FOG.clone(), 0.05);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 500);

const ambient = new THREE.AmbientLight(0x7084c0, 0.7);
const moonLight = new THREE.DirectionalLight(0x8fa3d6, 0.35);
moonLight.position.set(-60, 90, -40);
scene.add(ambient, moonLight);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function makeTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

// ===================================================================
// World
// ===================================================================
const WORLD = 160;

const groundTex = makeTex(64, 64, (g, w, h) => {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Math.random();
    g.fillStyle = v < 0.08 ? '#4a3a26' : `rgb(${(62 + v * 22) | 0},${(98 + v * 34) | 0},${(48 + v * 16) | 0})`;
    g.fillRect(x, y, 1, 1);
  }
  // studs, Roblox-style
  g.fillStyle = 'rgba(0,0,0,.18)';
  for (let y = 4; y < h; y += 16) for (let x = 4; x < w; x += 16) g.fillRect(x, y, 8, 8);
});
groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
// Abandoned hospital footprint (the building is made further down); the forest keeps clear of it
const HOSP = { x: 60, z: -62, hw: 22, hd: 14 };
const inHospital = (x, z, m = 0) => Math.abs(x - HOSP.x) < HOSP.hw + m && Math.abs(z - HOSP.z) < HOSP.hd + m;

// ground in four pieces around the hospital, so the stairwell down to its basement stays open
const groundMat = new THREE.MeshLambertMaterial({ map: groundTex });
function groundPiece(x0, x1, z0, z1) {
  const w = x1 - x0, d = z1 - z0;
  const geo = new THREE.PlaneGeometry(w, d);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 5, uv.getY(i) * d / 5); // one texture tile per 5 m
  const m = new THREE.Mesh(geo, groundMat);
  m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); m.receiveShadow = true;
  scene.add(m);
}
{
  const G = 250, x0 = HOSP.x - HOSP.hw, x1 = HOSP.x + HOSP.hw, z0 = HOSP.z - HOSP.hd, z1 = HOSP.z + HOSP.hd;
  groundPiece(-G, G, -G, z0); groundPiece(-G, G, z1, G); groundPiece(-G, x0, z0, z1); groundPiece(x1, G, z0, z1);
}

// moon + stars (not affected by fog)
const moon = new THREE.Mesh(new THREE.SphereGeometry(12, 16, 16), new THREE.MeshBasicMaterial({ color: 0xdfe6ff, fog: false }));
moon.position.set(-180, 220, -260);
scene.add(moon);
{
  const pts = [];
  for (let i = 0; i < 900; i++) {
    const th = rand(0, Math.PI * 2), ph = rand(0.15, Math.PI / 2);
    pts.push(Math.cos(th) * Math.cos(ph) * 400, Math.sin(ph) * 400, Math.sin(th) * Math.cos(ph) * 400);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  var stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaab4d0, size: 1.2, fog: false, transparent: true, opacity: .8 }));
  scene.add(stars);
}

// --- Trees (instanced, choppable)
const N_TREES = 950;
const trunkGeo = new THREE.BoxGeometry(1, 6, 1); trunkGeo.translate(0, 3, 0);
const leafGeo1 = new THREE.BoxGeometry(4.4, 2.2, 4.4); leafGeo1.translate(0, 5.4, 0);
const leafGeo2 = new THREE.BoxGeometry(3.2, 2, 3.2); leafGeo2.translate(0, 7.3, 0);
const leafGeo3 = new THREE.BoxGeometry(1.8, 1.8, 1.8); leafGeo3.translate(0, 9, 0);
const trunkMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const treeMeshes = [
  new THREE.InstancedMesh(trunkGeo, trunkMat, N_TREES),
  new THREE.InstancedMesh(leafGeo1, leafMat, N_TREES),
  new THREE.InstancedMesh(leafGeo2, leafMat, N_TREES),
  new THREE.InstancedMesh(leafGeo3, leafMat, N_TREES),
];
treeMeshes.forEach(m => { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); });

const trees = [];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function setTreeMatrix(t) {
  const hidden = t.fall >= 1.8;
  const k = hidden ? 0 : t.s;
  _s.set(k, k, k);
  const shakeZ = t.shake > 0 ? Math.sin(t.shake * 70) * 0.07 * t.shake : 0;
  const tip = Math.pow(Math.min(1, t.fall), 2) * 1.5;
  _e.set(tip, t.rot, shakeZ, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(t.x, t.fall > 1 ? -(t.fall - 1) * 1.2 : 0, t.z);
  _m.compose(_p, _q, _s);
  for (const m of treeMeshes) m.setMatrixAt(t.i, _m);
}
for (let i = 0; i < N_TREES; i++) {
  let x, z;
  do { x = rand(-WORLD, WORLD); z = rand(-WORLD, WORLD); } while (Math.hypot(x, z) < 9 || Math.hypot(x, z) > WORLD + 8 || inHospital(x, z, 7));
  const t = { i, x, z, s: rand(0.8, 1.35), rot: rand(0, Math.PI * 2), hp: 3, alive: true, shake: 0, fall: 0 };
  trees.push(t);
  setTreeMatrix(t);
  const c = new THREE.Color().setHSL(0.31 + rand(-0.04, 0.04), 0.45, rand(0.22, 0.32));
  for (let k = 1; k < 4; k++) treeMeshes[k].setColorAt(i, c);
  treeMeshes[0].setColorAt(i, new THREE.Color().setHSL(0.07, 0.42, rand(0.26, 0.36)));
}
treeMeshes.forEach(m => { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; });

// --- Rocks
{
  const N = 180;
  const rocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), N);
  for (let i = 0; i < N; i++) {
    const s = rand(0.4, 1.6);
    _p.set(rand(-WORLD, WORLD), s * 0.2, rand(-WORLD, WORLD));
    if (inHospital(_p.x, _p.z, 2)) _p.y = -10;
    _q.setFromEuler(_e.set(rand(-.3, .3), rand(0, 6), rand(-.3, .3)));
    _s.set(s * rand(1, 1.6), s, s * rand(1, 1.4));
    rocks.setMatrixAt(i, _m.compose(_p, _q, _s));
    rocks.setColorAt(i, new THREE.Color().setHSL(0.6, 0.05, rand(0.32, 0.45)));
  }
  rocks.castShadow = rocks.receiveShadow = true;
  scene.add(rocks);
}

// --- Grass tufts
{
  const N = LOW ? 1800 : 5000;
  const g = new THREE.BoxGeometry(0.08, 0.5, 0.08); g.translate(0, 0.25, 0);
  const grass = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0xffffff }), N);
  for (let i = 0; i < N; i++) {
    _p.set(rand(-WORLD, WORLD), 0, rand(-WORLD, WORLD));
    if (inHospital(_p.x, _p.z, 1)) _p.y = -10;
    _q.setFromEuler(_e.set(rand(-.4, .4), rand(0, 6), rand(-.4, .4)));
    const s = rand(0.6, 1.5); _s.set(1, s, 1);
    grass.setMatrixAt(i, _m.compose(_p, _q, _s));
    grass.setColorAt(i, new THREE.Color().setHSL(0.27 + rand(-.03, .05), 0.45, rand(0.22, 0.32)));
  }
  grass.frustumCulled = false;
  scene.add(grass);
}

// --- Berry bushes
const bushes = [];
{
  const bushGeo = new THREE.BoxGeometry(1.5, 1.1, 1.5);
  const bushMat = new THREE.MeshLambertMaterial({ color: 0x3f6b35 });
  const berryGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  const berryMat = new THREE.MeshLambertMaterial({ color: 0x8a2be2, emissive: 0x2a0050 });
  for (let i = 0; i < 75; i++) {
    let x, z;
    do { x = rand(-WORLD + 5, WORLD - 5); z = rand(-WORLD + 5, WORLD - 5); } while (Math.hypot(x, z) < 6 || inHospital(x, z, 4));
    const g = new THREE.Group();
    const b = new THREE.Mesh(bushGeo, bushMat); b.position.y = 0.55; b.castShadow = true;
    const b2 = new THREE.Mesh(bushGeo, bushMat); b2.scale.set(.7, .7, .7); b2.position.set(.5, .9, -.3);
    g.add(b, b2);
    const berries = [];
    for (let k = 0; k < 3; k++) {
      const be = new THREE.Mesh(berryGeo, berryMat);
      const a = rand(0, Math.PI * 2);
      be.position.set(Math.cos(a) * 0.76, rand(0.4, 1.0), Math.sin(a) * 0.76);
      g.add(be); berries.push(be);
    }
    g.position.set(x, 0, z);
    g.rotation.y = rand(0, 6);
    scene.add(g);
    bushes.push({ g, x, z, berries });
  }
}

// --- Batteries
const batteries = [];
const batGeo = new THREE.BoxGeometry(0.3, 0.5, 0.3);
const batMat = new THREE.MeshLambertMaterial({ color: 0xfcc419, emissive: 0x6a4c00 });
const batCapGeo = new THREE.BoxGeometry(0.14, 0.1, 0.14);
const batCapMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
function addBattery(x, z, y = 0) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(batGeo, batMat); const c = new THREE.Mesh(batCapGeo, batCapMat); c.position.y = 0.3;
  g.add(b, c);
  g.position.set(x, y + 0.5, z);
  g.userData.phase = rand(0, 6);
  scene.add(g);
  batteries.push({ g, x, z, y, taken: false });
}
for (let i = 0; i < 26; i++) {
  let x, z;
  do { const r = rand(12, WORLD - 5), a = rand(0, Math.PI * 2); x = Math.cos(a) * r; z = Math.sin(a) * r; } while (inHospital(x, z, 3));
  addBattery(x, z);
}

// ===================================================================
// Player (Roblox "noob" avatar)
// ===================================================================
const lam = color => new THREE.MeshLambertMaterial({ color });
function limb(w, h, d, color, px, py) {
  const geo = new THREE.BoxGeometry(w, h, d); geo.translate(0, -h / 2, 0);
  const m = new THREE.Mesh(geo, lam(color)); m.position.set(px, py, 0);
  return m;
}
const faceTex = makeTex(64, 64, (g) => {
  g.fillStyle = '#f5cd30'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#111';
  g.fillRect(19, 20, 6, 10); g.fillRect(39, 20, 6, 10);
  g.fillRect(20, 42, 24, 3); g.fillRect(17, 38, 4, 5); g.fillRect(43, 38, 4, 5);
});
const yellow = 0xf5cd30;
const player = new THREE.Group();
const torso = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.5), lam(0x0d69ac)); torso.position.y = 1.5;
const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), [lam(yellow), lam(yellow), lam(yellow), lam(yellow), new THREE.MeshLambertMaterial({ map: faceTex }), lam(yellow)]);
head.position.y = 2.33;
const armL = limb(0.48, 1, 0.48, yellow, -0.75, 2);
const armR = limb(0.48, 1, 0.48, yellow, 0.75, 2);
const legL = limb(0.48, 1, 0.48, 0x4b974b, -0.25, 1);
const legR = limb(0.48, 1, 0.48, 0x4b974b, 0.25, 1);
const torch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.5), lam(0x222222));
torch.position.set(0, -0.95, 0.2); armR.add(torch);
const torchLens = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.04), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
torchLens.position.z = 0.26; torch.add(torchLens);
player.add(torso, head, armL, armR, legL, legR);
scene.add(player);

const flashlight = new THREE.SpotLight(0xfff1cc, 160, 60, 0.42, 0.45, 1.2);
flashlight.castShadow = true;
flashlight.shadow.mapSize.set(1024, 1024);
flashlight.shadow.camera.near = 0.5;
flashlight.shadow.camera.far = 50;
flashlight.shadow.bias = -0.0008;
scene.add(flashlight, flashlight.target);
// small light around the player so the avatar is readable
const selfLight = new THREE.PointLight(0x9fb4ff, 1.2, 6, 2);
scene.add(selfLight);

// --- Hand torch: crafted from 2 wood, lit at a campfire, burns for a while
const TORCH_TIME = 80, TORCH_MAX = 3;
const handTorch = new THREE.Group();
const torchStick = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), lam(0x5a3a1e)); torchStick.position.y = 0.1;
const torchFlames = [0xff5a00, 0xffb02a].map((c, k) => {
  const f = new THREE.Mesh(new THREE.BoxGeometry(0.24 - k * 0.09, 0.34, 0.24 - k * 0.09), new THREE.MeshBasicMaterial({ color: c }));
  f.position.y = 0.6; handTorch.add(f); return f;
});
handTorch.add(torchStick);
handTorch.position.set(0, -0.95, 0.15);
handTorch.rotation.x = Math.PI / 2; // stands upright while the left arm is raised
handTorch.visible = false;
armL.add(handTorch);
const torchLight = new THREE.PointLight(0xff8a3a, 0, 16, 1.6);
scene.add(torchLight);

// ===================================================================
// Abandoned hospital: basement, ground floor and first floor
// ===================================================================
const LV = 4.5;                 // floor-to-floor height
const LEVEL_Y = [-LV, 0, LV];   // 0 basement, 1 ground floor, 2 first floor
const levelOf = y => (y < -1.5 ? 0 : y < 3 ? 1 : 2);
const hospital = new THREE.Group();
scene.add(hospital);
const concreteTex = makeTex(64, 64, (g, w, h) => {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = (128 + Math.random() * 22) | 0;
    g.fillStyle = `rgb(${c},${c - 4},${c - 12})`; g.fillRect(x, y, 1, 1);
  }
  for (let i = 0; i < 7; i++) { g.fillStyle = `rgba(40,45,30,${rand(.15, .35)})`; g.fillRect(rand(0, w), rand(h * .3, h), rand(3, 10), rand(8, 30)); }
  g.fillStyle = 'rgba(20,20,20,.5)';
  for (let i = 0; i < 3; i++) { let x = rand(0, w), y = rand(0, h); for (let k = 0; k < 14; k++) { g.fillRect(x | 0, y | 0, 1, 1); x += rand(-1, 1.5); y += 1; } }
});
function makeTiles(a, b, grime) {
  const t = makeTex(64, 64, (g, w, h) => {
    for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
      const v = (tx + ty) % 2 ? a : b;
      g.fillStyle = `rgb(${v - 8},${v + 4},${v})`; g.fillRect(tx * 8, ty * 8, 8, 8);
    }
    g.fillStyle = 'rgba(30,30,25,.4)';
    for (let i = 0; i < 400; i++) g.fillRect(rand(0, w) | 0, rand(0, h) | 0, 1, 1);
    g.fillStyle = `rgba(60,50,35,${grime})`;
    for (let i = 0; i < 8; i++) g.fillRect(rand(0, w), rand(0, h), rand(6, 20), rand(4, 14));
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 4);
  return t;
}
const floorMat = new THREE.MeshLambertMaterial({ map: makeTiles(150, 120, 0.25) });
const cellarFloorMat = new THREE.MeshLambertMaterial({ map: makeTiles(95, 80, 0.5) });
const wallMat = new THREE.MeshLambertMaterial({ map: concreteTex });
const cellarWallMat = new THREE.MeshLambertMaterial({ map: concreteTex, color: 0x8f897d });
const walls = [];  // full-height colliders: block movement, sight and the camera
const props = [];  // furniture and railings: block movement only
const hx = lx => HOSP.x + lx, hz = lz => HOSP.z + lz;
const W = HOSP.hw, D = HOSP.hd;
// box centred at local (lx, lz) and world height y, optionally registered as a collider
function box(w, h, d, mat, lx, y, lz, collider) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(hx(lx), y, hz(lz));
  m.castShadow = m.receiveShadow = true;
  hospital.add(m);
  if (collider) collider.push({ x0: hx(lx) - w / 2, x1: hx(lx) + w / 2, z0: hz(lz) - d / 2, z1: hz(lz) + d / 2, y0: y - h / 2, y1: y + h / 2 });
  return m;
}
// one-storey wall between two local points (axis-aligned)
function wall(lvl, x0, z0, x1, z1) {
  const t = 0.4, w = Math.abs(x1 - x0) || t, d = Math.abs(z1 - z0) || t;
  box(w, LV, d, lvl === 0 ? cellarWallMat : wallMat, (x0 + x1) / 2, LEVEL_Y[lvl] + LV / 2, (z0 + z1) / 2, walls);
}
// wall running along x (at z = at) or along z (at x = at) from a to b, leaving the [g0, g1] gaps open
function wallGaps(lvl, along, at, a, b, gaps) {
  let s = a;
  for (const [g0, g1] of gaps.slice().sort((p, q) => p[0] - q[0])) {
    if (g0 > s) along === 'x' ? wall(lvl, s, at, g0, at) : wall(lvl, at, s, at, g0);
    s = Math.max(s, g1);
  }
  if (b > s) along === 'x' ? wall(lvl, s, at, b, at) : wall(lvl, at, s, at, b);
}
const door = c => [c - 0.8, c + 0.8];

// stairs (local coords): west ramp ground floor ↔ basement, east ramp ground floor ↔ first floor
const RAMP_W = { x0: -21.8, x1: -18.5, z0: -5, z1: 5, yA: 0, yB: -LV };
const RAMP_E = { x0: 18.5, x1: 21.8, z0: -5, z1: 5, yA: 0, yB: LV };
const inRamp = (r, x, z) => x > hx(r.x0) && x < hx(r.x1) && z > hz(r.z0) && z < hz(r.z1);
const rampY = (r, z) => r.yA + (r.yB - r.yA) * (z - hz(r.z0)) / (r.z1 - r.z0);

for (let lvl = 0; lvl < 3; lvl++) {
  // outer shell, front door only on the ground floor
  wall(lvl, -W, -D, W, -D); wall(lvl, -W, -D, -W, D); wall(lvl, W, -D, W, D);
  wallGaps(lvl, 'x', D, -W, W, lvl === 1 ? [[-1.6, 1.6]] : []);
  // central corridor (z -2..2) with ward doors; the ground floor has the lobby in the middle
  wallGaps(lvl, 'x', -2, -16, 16, [-12, -4, 4, 12].map(door));
  wallGaps(lvl, 'x', 2, -16, 16, lvl === 1 ? [door(-13), door(-7), [-4, 4], door(7), door(13)] : [-13, -7, 0, 7, 13].map(door));
  [-8, 0, 8].forEach(x => wall(lvl, x, -D, x, -2));
  [-10, -4, 4, 10].forEach(x => wall(lvl, x, 2, x, D));
  // stair halls at both ends (z -7..7) with a small room in each corner
  [-16, 16].forEach(x => { wall(lvl, x, -D, x, -2); wall(lvl, x, 2, x, D); });
  [-7, 7].forEach(z => { wallGaps(lvl, 'x', z, -W, -16, [[-18, -16.4]]); wallGaps(lvl, 'x', z, 16, W, [[16.4, 18]]); });
}
const railMat = lam(0x5c6066);
function rail(lvl, x0, z0, x1, z1) {
  const t = 0.15, w = Math.abs(x1 - x0) || t, d = Math.abs(z1 - z0) || t;
  box(w, 1.1, d, railMat, (x0 + x1) / 2, LEVEL_Y[lvl] + 0.55, (z0 + z1) / 2, props);
}
// railings round each stair hole, solid walls round the space under each ramp
rail(1, RAMP_W.x1, RAMP_W.z0, RAMP_W.x1, RAMP_W.z1); rail(1, RAMP_W.x0, RAMP_W.z1, RAMP_W.x1, RAMP_W.z1);
wall(0, RAMP_W.x1, RAMP_W.z0, RAMP_W.x1, RAMP_W.z1); wall(0, RAMP_W.x0, RAMP_W.z0, RAMP_W.x1, RAMP_W.z0);
rail(2, RAMP_E.x0, RAMP_E.z0, RAMP_E.x0, RAMP_E.z1); rail(2, RAMP_E.x0, RAMP_E.z0, RAMP_E.x1, RAMP_E.z0);
wall(1, RAMP_E.x0, RAMP_E.z0, RAMP_E.x0, RAMP_E.z1); wall(1, RAMP_E.x0, RAMP_E.z1, RAMP_E.x1, RAMP_E.z1);

// floors / ceilings, each with a hole for its staircase
function slab(yTop, thick, mat, hole) {
  const parts = hole
    ? [[-W, W, -D, hole.z0], [-W, W, hole.z1, D], [-W, hole.x0, hole.z0, hole.z1], [hole.x1, W, hole.z0, hole.z1]]
    : [[-W, W, -D, D]];
  for (const [x0, x1, z0, z1] of parts) {
    if (x1 - x0 > 0.01 && z1 - z0 > 0.01) box(x1 - x0, thick, z1 - z0, mat, (x0 + x1) / 2, yTop - thick / 2, (z0 + z1) / 2);
  }
}
slab(-LV, 0.3, cellarFloorMat);
slab(0.04, 0.34, floorMat, RAMP_W);
slab(LV, 0.3, floorMat, RAMP_E);
slab(2 * LV + 0.3, 0.3, lam(0x4a4a46)); // roof
const rampMat = lam(0x6e6a62);
for (const r of [RAMP_W, RAMP_E]) {
  const len = r.z1 - r.z0, rise = r.yB - r.yA;
  const m = box(r.x1 - r.x0, 0.3, Math.hypot(len, rise), rampMat, (r.x0 + r.x1) / 2, (r.yA + r.yB) / 2 - 0.15, (r.z0 + r.z1) / 2);
  m.rotation.x = -Math.atan2(rise, len);
  for (let k = 1; k < 12; k++) box(r.x1 - r.x0, 0.06, 0.12, railMat, (r.x0 + r.x1) / 2, r.yA + rise * k / 12 + 0.01, r.z0 + len * k / 12).castShadow = false;
}

// front: lintel over the door, step, sign
box(3.2, LV - 3, 0.4, wallMat, 0, 3 + (LV - 3) / 2, D);
box(4, 0.15, 2, lam(0x77746c), 0, 0.07, D + 1.2);
const signTex = makeTex(128, 32, g => {
  g.fillStyle = '#d8d3c4'; g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#8a1010'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('SZPITAL', 74, 17);
  g.fillRect(6, 13, 18, 6); g.fillRect(12, 7, 6, 18);
  g.fillStyle = 'rgba(60,50,30,.5)';
  for (let i = 0; i < 120; i++) g.fillRect(rand(0, 128) | 0, rand(0, 32) | 0, 2, 1);
});
const hSign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshLambertMaterial({ map: signTex }));
hSign.position.set(hx(0), 3.75, hz(D + 0.23)); hSign.rotation.z = 0.04;
hospital.add(hSign);
// red cross on a mast: glows through the fog so the hospital can be found
const roofTop = 2 * LV + 0.3;
box(0.25, 6, 0.25, lam(0x333333), 12, roofTop + 3, -6);
const beaconMat = new THREE.MeshBasicMaterial({ color: 0xc01010, fog: false });
box(2.4, 0.7, 0.7, beaconMat, 12, roofTop + 6.5, -6).castShadow = false;
box(0.7, 2.4, 0.7, beaconMat, 12, roofTop + 6.5, -6).castShadow = false;

// boarded-up windows on the two storeys above ground
const glassMat = new THREE.MeshBasicMaterial({ color: 0x05080c });
const plankMat = lam(0x4a3420);
function windowAt(lx, lz, rotY, y) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 0.06), glassMat));
  for (let k = 0; k < 2; k++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 0.08), plankMat);
    p.position.set(0, k ? 0.2 : -0.25, 0.05); p.rotation.z = k ? 0.5 : -0.35; g.add(p);
  }
  g.position.set(hx(lx), y, hz(lz)); g.rotation.y = rotY;
  hospital.add(g);
}
for (const y of [2.3, LV + 2.3]) {
  [-18, -12, -7, 7, 12, 18].forEach(x => { windowAt(x, D + 0.22, 0, y); windowAt(x, -D - 0.22, Math.PI, y); });
  [-10, -4, 4, 10].forEach(z => { windowAt(W + 0.22, z, Math.PI / 2, y); windowAt(-W - 0.22, z, -Math.PI / 2, y); });
}

// furniture
const metalMat = lam(0x6b7078), sheetMat = lam(0xb8b3a2), rustMat = lam(0x5a4636), woodMat = lam(0x5b4330);
function bed(lvl, lx, lz, along) {
  const b = LEVEL_Y[lvl], L = 2.1, B = 1, w = along === 'x' ? L : B, d = along === 'x' ? B : L;
  box(w, 0.5, d, metalMat, lx, b + 0.35, lz, props);
  box(w - 0.1, 0.15, d - 0.1, sheetMat, lx, b + 0.67, lz);
  if (along === 'x') box(0.08, 1.1, B, metalMat, lx - L / 2 + 0.05, b + 0.65, lz);
  else box(B, 1.1, 0.08, metalMat, lx, b + 0.65, lz - L / 2 + 0.05);
}
function gurney(lvl, lx, lz, body) {
  const b = LEVEL_Y[lvl];
  box(2, 0.12, 0.7, metalMat, lx, b + 0.9, lz, props);
  box(1.9, 0.1, 0.6, sheetMat, lx, b + 1.0, lz);
  if (body) { box(1.5, 0.26, 0.45, sheetMat, lx + 0.15, b + 1.17, lz); box(0.32, 0.3, 0.34, sheetMat, lx - 0.75, b + 1.2, lz); }
}
const cabinet = (lvl, lx, lz) => box(0.8, 2, 0.8, rustMat, lx, LEVEL_Y[lvl] + 1, lz, props);
// ground floor: wards, reception, a gurney in the corridor
[-12, -4, 4, 12].forEach((x, i) => bed(1, x + (i % 2 ? 1.5 : -1.5), -10.5, 'z'));
[-13, -7, 7, 13].forEach(x => bed(1, x, 10.5, 'z'));
box(2.6, 1.1, 0.8, woodMat, 2.3, 0.6, 8, props);
box(0.6, 0.5, 0.6, woodMat, -2.5, 0.3, 10, props);
gurney(1, 9, 1.2, false);
cabinet(1, -15.4, -12); cabinet(1, 15.4, 12);
// first floor: crowded wards and an operating theatre
[-12, -4, 4, 12].forEach(x => { bed(2, x - 1.8, -10.5, 'z'); bed(2, x + 1.8, -10.5, 'z'); });
[-13, -7, 7, 13].forEach(x => bed(2, x, 10.5, 'z'));
box(1, 0.9, 2.2, metalMat, 0, LV + 0.45, 9, props);
box(0.9, 0.1, 2, sheetMat, 0, LV + 0.95, 9);
box(0.8, 0.9, 0.5, metalMat, 2.2, LV + 0.45, 9, props);
box(1.2, 0.15, 1.2, new THREE.MeshBasicMaterial({ color: 0x9a9480 }), 0, 2 * LV - 0.6, 9).castShadow = false;
gurney(2, -9, -1.2, true);
cabinet(2, 15.4, -12);
// basement: morgue, bodies under sheets, boilers and pipes
const handleMat = lam(0xa0a6ad);
[-12, -4].forEach(x => {
  box(6.8, 2.4, 0.9, metalMat, x, -LV + 1.2, -13.3, props);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) box(0.4, 0.08, 0.06, handleMat, x - 2.4 + c * 1.6, -LV + 0.5 + r * 0.75, -12.83).castShadow = false;
});
gurney(0, 4, -8, true); gurney(0, 12, -9, true); gurney(0, -12, -6, true);
box(2.2, 3.2, 2.2, rustMat, -13, -LV + 1.6, 10, props);
box(2.2, 3.2, 2.2, rustMat, 13, -LV + 1.6, 10, props);
box(32, 0.25, 0.25, rustMat, 0, -0.7, 1.5).castShadow = false;
box(32, 0.25, 0.25, rustMat, 0, -0.95, -1.6).castShadow = false;
box(1, 1, 1, woodMat, 7, -LV + 0.5, 12, props); box(1, 1, 1, woodMat, 8.2, -LV + 0.5, 12.3, props); box(1, 1, 1, woodMat, 7.6, -LV + 1.5, 12.1);

const bloodTex = makeTex(32, 32, g => {
  g.fillStyle = 'rgba(90,0,0,.85)';
  for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(16 + rand(-9, 9), 16 + rand(-9, 9), rand(2, 7), 0, 7); g.fill(); }
});
const bloodMat = new THREE.MeshLambertMaterial({ map: bloodTex, transparent: true, depthWrite: false });
[[1, -6, 0, 2.5], [1, -13, 5, 1.6], [1, 3, -6, 2], [2, 12, 0.5, 1.4], [2, 0, 8, 1.6], [2, -9, -1, 2], [0, -3, 0, 3], [0, 12, -9, 2], [0, -12, 9, 1.8]].forEach(([lvl, x, z, sz]) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), bloodMat);
  m.rotation.set(-Math.PI / 2, 0, rand(0, 6));
  m.position.set(hx(x), (lvl === 1 ? 0.04 : LEVEL_Y[lvl]) + 0.02, hz(z));
  hospital.add(m);
});

// flickering ceiling lamps on every storey; only the storey you're on gets real lights
const LAMP_SPOTS = [[[-10, 0], [10, 0], [0, -8]], [[-10, 0], [10, 0], [0, 8]], [[-10, 0], [10, 0], [-19, 0]]];
const lampFix = LAMP_SPOTS.map((spots, lvl) => spots.map(([x, z]) => {
  const m = box(1.4, 0.1, 0.3, new THREE.MeshBasicMaterial({ color: 0xdff2ff }), x, LEVEL_Y[lvl] + LV - 0.4, z);
  m.castShadow = false;
  return { m, x, z, lvl, t: rand(0, 3), on: true };
}));
const lampLights = LAMP_SPOTS[0].map(() => { const l = new THREE.PointLight(0xcfe6ff, 0, 13, 1.8); scene.add(l); return l; });

addBattery(hx(19), hz(11), 0.04);
addBattery(hx(-19), hz(11), LV);
addBattery(hx(19), hz(-11), -LV);
addBattery(hx(-12), hz(-9), -LV);

// syringes: they all look the same, you only learn what's inside after picking one up
const syringes = [];
const SYR_SPOTS = [
  [0, -12, -9], [0, -4, -10], [0, 5, -11], [0, 14.5, -11], [0, -7, 9], [0, 11, 7], [0, 19, 10], [0, -19, -10],
  [1, -13, -8], [1, -4, -6], [1, 12, -10], [1, -14.5, 6], [1, 7, 7], [1, -1.5, 11], [1, 19, -11], [1, -19, 11],
  [2, -12, -10], [2, 4, -8], [2, 12, -6], [2, -8.5, 6], [2, -2.5, 6], [2, 14.5, 5], [2, -19, -11], [2, 19, 11],
];
const syrBodyMat = new THREE.MeshLambertMaterial({ color: 0xe6eef2, emissive: 0x223038 });
const syrLiquidMat = new THREE.MeshBasicMaterial({ color: 0x3fb7ff });
const syrMetalMat = lam(0x9aa0a6);
function makeSyringe(lvl, lx, lz) {
  const g = new THREE.Group();
  const liquid = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.1), syrLiquidMat); liquid.position.x = 0.05;
  const plunger = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.05), syrMetalMat); plunger.position.x = -0.26;
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.14), syrMetalMat); thumb.position.x = -0.33;
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.015, 0.015), syrMetalMat); needle.position.x = 0.29;
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.09, 0.09), syrBodyMat), liquid, plunger, thumb, needle);
  g.scale.setScalar(1.4);
  const y = lvl === 1 ? 0.04 : LEVEL_Y[lvl];
  g.position.set(hx(lx), y + 0.12, hz(lz)); g.rotation.y = rand(0, 6);
  hospital.add(g);
  return { g, x: g.position.x, z: g.position.z, y, taken: false };
}
function placeSyringes() {
  syringes.forEach(sy => hospital.remove(sy.g));
  syringes.length = 0;
  const spots = SYR_SPOTS.slice().sort(() => Math.random() - 0.5).slice(0, 14);
  for (const [lvl, x, z] of spots) syringes.push(makeSyringe(lvl, x, z));
}
placeSyringes();

// --- Hospital monsters: Patients (hunt by sight, fear fire), the Nurse (moves only when unseen)
//     and the Crawler in the basement (blind, hunts by sound)
const patients = [];
const PATIENT_HOME = [[1, -12, -8], [1, 7, 7], [2, -4, -8], [2, 13, 7], [2, -12, 0]];
function makePatient() {
  const g = new THREE.Group();
  const legL = limb(0.26, 0.95, 0.26, 0x6f6a5c, -0.18, 0.95), legR = limb(0.26, 0.95, 0.26, 0x6f6a5c, 0.18, 0.95);
  const body = new THREE.Group(); body.position.y = 0.95; body.rotation.x = 0.45;
  const gown = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 0.45), lam(0x7d8f97)); gown.position.y = 0.55;
  const headP = new THREE.Group(); headP.position.y = 1.15;
  const hd = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.5), lam(0xa9a48f)); hd.position.y = 0.27;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.52), lam(0xd8d2c0)); band.position.y = 0.4;
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.02), holeMat); e1.position.set(-0.11, 0.3, 0.26);
  const e2 = e1.clone(); e2.position.x = 0.11;
  const mo = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.02), holeMat); mo.position.set(0, 0.12, 0.26);
  headP.add(hd, band, e1, e2, mo);
  const armL = limb(0.2, 0.95, 0.2, 0xa9a48f, -0.5, 1.05), armR = limb(0.2, 0.95, 0.2, 0xa9a48f, 0.5, 1.05);
  body.add(gown, headP, armL, armR);
  g.add(legL, legR, body);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(g);
  return { g, legL, legR, armL, armR, headP, anim: 0 };
}
for (let i = 0; i < PATIENT_HOME.length; i++) patients.push(makePatient());

const NURSE = (() => {
  const g = new THREE.Group();
  const dress = lam(0xbdb7a8), black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const legL = limb(0.18, 1.3, 0.18, 0xcfc8b8, -0.15, 1.3), legR = limb(0.18, 1.3, 0.18, 0xcfc8b8, 0.15, 1.3);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.9, 0.5), dress); skirt.position.y = 1.15;
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.85, 0.38), dress); top.position.y = 2.0;
  const headP = new THREE.Group(); headP.position.y = 2.45;
  const hd = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.44), lam(0xd8d2c4)); hd.position.y = 0.3;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3), lam(0xeeeeee)); cap.position.y = 0.66;
  const crossMat = new THREE.MeshBasicMaterial({ color: 0xaa0000 });
  const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.02), crossMat); c1.position.set(0, 0.66, 0.16);
  const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.02), crossMat); c2.position.set(0, 0.66, 0.16);
  const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.02), black); e1.position.set(-0.1, 0.36, 0.23);
  const e2 = e1.clone(); e2.position.x = 0.1;
  const mo = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.02), black); mo.position.set(0, 0.12, 0.23);
  headP.add(hd, cap, c1, c2, e1, e2, mo);
  const aL = limb(0.14, 1.4, 0.14, 0xcfc8b8, -0.38, 2.35), aR = limb(0.14, 1.4, 0.14, 0xcfc8b8, 0.38, 2.35);
  g.add(legL, legR, skirt, top, headP, aL, aR);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(g);
  return { g, headP, aL, aR, level: 2, sx: hx(-19), sz: hz(0), stun: 0, moved: true, wake: 0, creakT: 0, seenOnce: false };
})();

const CRAWLER = (() => {
  const g = new THREE.Group();
  const skin = lam(0x9c9483), black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.35, 1.4), skin); body.position.y = 0.75;
  const head = new THREE.Group(); head.position.set(0, 0.8, 0.85);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.02), black); mouth.position.set(0, -0.05, 0.23);
  head.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 0.45), skin), mouth);
  const toothMat = lam(0xe8e2d0);
  for (let k = 0; k < 4; k++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.02), toothMat);
    t.position.set(-0.12 + k * 0.08, 0.03, 0.24); head.add(t);
  }
  const limbs = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => {
    const l = limb(0.1, 1.1, 0.1, 0x9c9483, sx * 0.3, 0.85);
    l.position.z = sz * 0.55; l.rotation.z = sx * 0.7; g.add(l); return l;
  });
  g.add(body, head);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(g);
  return { g, head, limbs, level: 0, home: [12, 0], anim: 0 };
})();

function resetHospital() {
  patients.forEach((p, i) => {
    const [lvl, x, z] = PATIENT_HOME[i];
    Object.assign(p, { level: lvl, state: 'wander', dead: 0, home: [hx(x), hz(z)], tx: hx(x), tz: hz(z), wt: 0, hitCD: 0, lost: 0, groanT: rand(2, 8) });
    p.g.position.set(hx(x), LEVEL_Y[lvl], hz(z)); p.g.rotation.set(0, rand(0, 6), 0); p.g.visible = true;
  });
  NURSE.g.position.set(NURSE.sx, LEVEL_Y[NURSE.level], NURSE.sz); NURSE.g.rotation.set(0, Math.PI / 2, 0);
  NURSE.stun = 0; NURSE.wake = 0; NURSE.moved = true;
  const c = CRAWLER;
  Object.assign(c, { state: 'idle', t: 0, dead: 0, hitCD: 0, clickT: 1, tx: hx(c.home[0]), tz: hz(c.home[1]) });
  c.g.position.set(hx(c.home[0]), LEVEL_Y[0], hz(c.home[1])); c.g.rotation.set(0, rand(0, 6), 0);
}
resetHospital();

// ===================================================================
// Campfires
// ===================================================================
const FIRE_R = 8;
const fires = [];
const fireLights = [];
for (let i = 0; i < 4; i++) {
  const l = new THREE.PointLight(0xff7a2a, 0, 30, 1.6);
  l.position.set(0, -50, 0);
  scene.add(l); fireLights.push(l);
}
let fireLightIdx = 0;
function createFire(x, z) {
  const g = new THREE.Group();
  const logMat = lam(0x3d2615);
  for (let k = 0; k < 4; k++) {
    const log = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 1.5), logMat);
    log.rotation.y = k * Math.PI / 4; log.position.y = 0.15 + (k % 2) * 0.12;
    log.castShadow = true; g.add(log);
  }
  for (let k = 0; k < 9; k++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), lam(0x55585e));
    const a = (k / 9) * Math.PI * 2;
    st.position.set(Math.cos(a) * 1.05, 0.15, Math.sin(a) * 1.05); st.rotation.y = a;
    g.add(st);
  }
  const flames = [0xff4a00, 0xff8c1a, 0xffd34d].map((c, k) => {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.7 - k * 0.18, 1, 0.7 - k * 0.18), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9 }));
    f.position.y = 0.6; g.add(f); return f;
  });
  const embers = [];
  for (let k = 0; k < 10; k++) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: 0xff8a2a }));
    e.userData = { t: rand(0, 2), x: rand(-.3, .3), z: rand(-.3, .3) };
    g.add(e); embers.push(e);
  }
  g.position.set(x, 0, z);
  scene.add(g);
  const light = fireLights[fireLightIdx % fireLights.length];
  fires.forEach(f => { if (f.light === light) f.light = null; });
  fireLightIdx++;
  light.position.set(x, 1.6, z);
  const fire = { g, x, z, flames, embers, light, fuel: 75 };
  fires.push(fire);
  return fire;
}
function nearestLitFire(x, z) {
  let best = null, bd = 1e9;
  for (const f of fires) {
    if (f.fuel <= 0 || !f.light) continue;
    const d = Math.hypot(f.x - x, f.z - z);
    if (d < bd) { bd = d; best = f; }
  }
  return best ? { fire: best, d: bd } : null;
}

// ===================================================================
// The Thing (monster)
// ===================================================================
const monster = new THREE.Group();
const dark = new THREE.MeshLambertMaterial({ color: 0x3a3a40 });
const mBody = new THREE.Mesh(new THREE.BoxGeometry(0.75, 2.4, 0.45), dark); mBody.position.y = 3.3;
const mHeadPivot = new THREE.Group(); mHeadPivot.position.y = 4.55;
const mHead = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.05, 0.58), dark); mHead.position.y = 0.5;
mHeadPivot.add(mHead);
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.08, 0.02), eyeMat); eyeL.position.set(-0.14, 0.62, 0.3);
const eyeR = eyeL.clone(); eyeR.position.x = 0.14;
const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.02), new THREE.MeshBasicMaterial({ color: 0x220000 }));
mouth.position.set(0, 0.25, 0.3);
mHeadPivot.add(eyeL, eyeR, mouth);
const mArmL = limb(0.17, 3.0, 0.17, 0x141416, -0.5, 4.4); mArmL.material = dark;
const mArmR = limb(0.17, 3.0, 0.17, 0x141416, 0.5, 4.4); mArmR.material = dark;
const mLegL = limb(0.22, 2.1, 0.22, 0x141416, -0.2, 2.1); mLegL.material = dark;
const mLegR = limb(0.22, 2.1, 0.22, 0x141416, 0.2, 2.1); mLegR.material = dark;
monster.add(mBody, mHeadPivot, mArmL, mArmR, mLegL, mLegR);
monster.traverse(o => { if (o.isMesh) o.castShadow = true; });
monster.visible = false;
scene.add(monster);

const M = { state: 'away', timer: 45, exposure: 0, hold: 0, huntT: 0, seen: false, stepT: 0, anim: 0 };

// Watcher eyes in the dark
const watchers = [];
for (let i = 0; i < 5; i++) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffd23a : 0xff2a2a, fog: false });
  const a = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.02), mat); a.position.x = -0.12;
  const b = a.clone(); b.position.x = 0.12;
  g.add(a, b); g.visible = false; scene.add(g);
  watchers.push({ g, life: 0, blink: 0 });
}

// ===================================================================
// Audio (all synthesized)
// ===================================================================
let AC = null, master, noiseBuf, windGain, fearGain, droneGain;
function initAudio() {
  if (AC) { AC.resume(); return; }
  AC = new (window.AudioContext || window.webkitAudioContext)();
  master = AC.createGain(); master.gain.value = muted ? 0 : 0.9;
  const comp = AC.createDynamicsCompressor();
  master.connect(comp); comp.connect(AC.destination);
  noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  const w = AC.createBufferSource(); w.buffer = noiseBuf; w.loop = true;
  const wf = AC.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 380; wf.Q.value = 0.8;
  const lfo = AC.createOscillator(); lfo.frequency.value = 0.07;
  const lg = AC.createGain(); lg.gain.value = 220; lfo.connect(lg); lg.connect(wf.frequency); lfo.start();
  windGain = AC.createGain(); windGain.gain.value = 0.16;
  w.connect(wf); wf.connect(windGain); windGain.connect(master); w.start();

  droneGain = AC.createGain(); droneGain.gain.value = 0.06; droneGain.connect(master);
  [55, 55.7, 82.4].forEach((f, i) => { const o = AC.createOscillator(); o.type = i === 2 ? 'triangle' : 'sine'; o.frequency.value = f; o.connect(droneGain); o.start(); });

  fearGain = AC.createGain(); fearGain.gain.value = 0;
  const ff = AC.createBiquadFilter(); ff.type = 'lowpass'; ff.frequency.value = 1100;
  ff.connect(fearGain); fearGain.connect(master);
  [233, 246.9, 261.6, 116.5].forEach(f => { const o = AC.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(ff); o.start(); });
}
function env(g, t, a, peak, dur) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}
function noise(dur, { type = 'lowpass', freq = 1000, freqEnd, q = 1, vol = 0.3, attack = 0.003, pan = 0, delay = 0 } = {}) {
  if (!AC) return;
  const t = AC.currentTime + delay;
  const s = AC.createBufferSource(); s.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  f.Q.value = q;
  const g = AC.createGain(); env(g, t, attack, vol, dur);
  const p = AC.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
  s.connect(f); f.connect(g); g.connect(p); p.connect(master);
  s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
function tone(freq, dur, { type = 'sine', vol = 0.2, attack = 0.005, to, pan = 0, delay = 0, vib = 0, vibRate = 6 } = {}) {
  if (!AC) return;
  const t = AC.currentTime + delay;
  const o = AC.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  if (vib) {
    const l = AC.createOscillator(); l.frequency.value = vibRate;
    const lg = AC.createGain(); lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency);
    l.start(t); l.stop(t + dur + 0.05);
  }
  const g = AC.createGain(); env(g, t, attack, vol, dur);
  const p = AC.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
  o.connect(g); g.connect(p); p.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}
const SFX = {
  step: () => noise(0.09, { freq: rand(350, 600), vol: 0.1 }),
  chop: () => { noise(0.14, { type: 'bandpass', freq: 850, q: 2, vol: 0.5 }); tone(120, 0.16, { to: 55, vol: 0.35 }); },
  fall: () => { noise(1.2, { freq: 900, freqEnd: 120, vol: 0.45, attack: 0.2 }); tone(70, 0.7, { to: 35, vol: 0.5, delay: 0.9 }); },
  pickup: () => { tone(660, 0.1, { type: 'square', vol: 0.06 }); tone(990, 0.14, { type: 'square', vol: 0.06, delay: 0.08 }); },
  eat: () => { noise(0.08, { type: 'bandpass', freq: 1500, vol: 0.15 }); noise(0.08, { type: 'bandpass', freq: 1300, vol: 0.15, delay: 0.15 }); },
  click: () => noise(0.03, { type: 'highpass', freq: 3000, vol: 0.2 }),
  heart: v => { tone(58, 0.2, { vol: 0.5 * v, to: 40 }); tone(52, 0.18, { vol: 0.35 * v, to: 38, delay: 0.24 }); },
  twig: pan => { noise(0.04, { type: 'highpass', freq: 2500, vol: 0.35, pan }); noise(0.05, { type: 'highpass', freq: 2000, vol: 0.25, pan, delay: 0.07 }); },
  owl: pan => { tone(410, 0.35, { to: 380, vol: 0.05, pan, attack: 0.05 }); tone(400, 0.6, { to: 340, vol: 0.05, pan, delay: 0.5, attack: 0.05 }); },
  howl: pan => tone(300, 3, { to: 520, vol: 0.05, vib: 8, vibRate: 5, pan, attack: 0.8 }),
  whisper: pan => { noise(1.8, { type: 'bandpass', freq: 2600, q: 5, vol: 0.09, attack: 0.7, pan }); noise(1.2, { type: 'bandpass', freq: 3400, q: 6, vol: 0.06, attack: 0.5, pan, delay: 0.6 }); },
  scream: pan => { tone(950, 1.4, { type: 'sawtooth', to: 280, vol: 0.12, vib: 40, vibRate: 11, pan, attack: 0.05 }); tone(1010, 1.4, { type: 'sawtooth', to: 300, vol: 0.08, vib: 50, vibRate: 13, pan, attack: 0.05 }); },
  sting: () => { tone(1180, 1.8, { type: 'sawtooth', vol: 0.05, attack: 0.01 }); tone(1250, 1.8, { type: 'sawtooth', vol: 0.05, attack: 0.01 }); tone(62, 1.8, { vol: 0.5, attack: 0.01, to: 45 }); },
  vanish: () => { noise(0.7, { type: 'bandpass', freq: 300, freqEnd: 3500, q: 2, vol: 0.25 }); tone(200, 0.6, { type: 'sawtooth', to: 900, vol: 0.05 }); },
  jumpscare: () => {
    noise(1.1, { type: 'bandpass', freq: 1800, q: 0.7, vol: 1 });
    tone(720, 1.1, { type: 'sawtooth', to: 90, vol: 0.6, vib: 60, vibRate: 17 });
    tone(745, 1.1, { type: 'square', to: 85, vol: 0.35 });
    tone(45, 1.2, { vol: 0.9, to: 30 });
  },
  mstep: v => { tone(65, 0.14, { to: 38, vol: 0.5 * v }); noise(0.1, { freq: 300, vol: 0.2 * v }); },
  crackle: v => noise(0.03, { type: 'highpass', freq: rand(1200, 3000), vol: 0.14 * v }),
  ignite: () => noise(1, { freq: 250, freqEnd: 1600, vol: 0.4, attack: 0.1 }),
  flick: () => noise(0.02, { type: 'highpass', freq: 4000, vol: 0.1 }),
  glass: () => { tone(2300, 0.09, { type: 'triangle', vol: 0.08 }); tone(3100, 0.12, { type: 'triangle', vol: 0.06, delay: 0.06 }); },
  inject: () => { noise(0.12, { type: 'highpass', freq: 3500, vol: 0.12 }); tone(523, 0.2, { vol: 0.08, delay: 0.1 }); tone(659, 0.2, { vol: 0.08, delay: 0.22 }); tone(784, 0.35, { vol: 0.08, delay: 0.34 }); },
  stab: () => { noise(0.12, { type: 'bandpass', freq: 1400, q: 2, vol: 0.45 }); tone(700, 1.0, { type: 'sawtooth', to: 110, vol: 0.14, vib: 30, vibRate: 12, delay: 0.1 }); },
  hit: () => { noise(0.2, { freq: 700, vol: 0.5 }); tone(95, 0.22, { to: 50, vol: 0.5 }); },
  patientScream: pan => { tone(520, 0.9, { type: 'sawtooth', to: 210, vol: 0.1, vib: 25, vibRate: 9, pan, attack: 0.03 }); noise(0.7, { type: 'bandpass', freq: 1200, q: 3, vol: 0.12, pan }); },
  groan: (pan, v) => tone(105, 1.4, { type: 'sawtooth', to: 80, vol: 0.06 * v, vib: 5, vibRate: 3, pan, attack: 0.3 }),
  creak: (pan, v) => noise(0.14, { type: 'bandpass', freq: rand(600, 1000), q: 9, vol: 0.22 * v, pan }),
  drip: () => tone(rand(1500, 2100), 0.06, { to: 900, vol: 0.05 }),
  clank: pan => { noise(0.5, { type: 'bandpass', freq: 380, q: 12, vol: 0.25, pan }); tone(170, 0.8, { type: 'square', vol: 0.025, pan }); },
  hiss: () => noise(0.6, { type: 'highpass', freq: 2000, vol: 0.15, attack: 0.02 }),
  crawlerShriek: pan => { tone(1400, 0.7, { type: 'square', to: 500, vol: 0.07, vib: 90, vibRate: 25, pan }); noise(0.5, { type: 'highpass', freq: 2500, vol: 0.2, pan }); },
  click2: (pan, v) => noise(0.02, { type: 'bandpass', freq: 2600, q: 10, vol: 0.3 * v, pan }),
};

// ===================================================================
// Game state
// ===================================================================
const S = {
  playing: false, started: false, over: false,
  night: 1, mins: 22 * 60,
  hp: 100, hunger: 100, warmth: 100, stamina: 100, battery: 100,
  wood: 0, berries: 2, flash: true,
  fear: 0, treesCut: 0, totalTime: 0, closeCalls: 0,
  torches: 0, torchLit: false, torchTime: 0, healSyr: 0, poisonSyr: 0,
  hurtAt: -9, hurtCause: '',
};
const NIGHT_END = 30 * 60; // 6:00
const GAME_MIN_PER_SEC = 1; // 8 h of night = 8 min real time

let yaw = Math.PI, pitch = -0.15, camDist = 6;
let velY = 0, onGround = true;
let interactCD = 0, armSwing = 0, walkPhase = 0, stepT = 0, shake = 0;
let target = null;
let ambT = 8, heartT = 0, crackleT = 0;
let flickerT = 0;
let boundaryWarned = false;
let insideK = 0;
let pMoving = false, pSprinting = false;
const keys = {};

// ===================================================================
// Lobby settings: difficulty + sound (remembered on this device)
// ===================================================================
const DIFFS = {
  easy: { name: 'Łatwy', aggr: 0.65, speed: 0.85, dmg: 0.6, drain: 0.7, battery: 0.7, wood: 5, berries: 4,
    desc: 'Na rozgrzewkę. Stwór rzadziej poluje i wolniej biega, potwory słabiej ranią, a głód i zimno działają wolniej. Na start: 5 drewna i 4 jagody.' },
  normal: { name: 'Normalny', aggr: 1, speed: 1, dmg: 1, drain: 1, battery: 1, wood: 0, berries: 2,
    desc: 'Las jest groźny, ale da się przetrwać. Tak, jak gra ma wyglądać.' },
  hard: { name: 'Trudny', aggr: 1.35, speed: 1.12, dmg: 1.3, drain: 1.25, battery: 1.25, wood: 0, berries: 1,
    desc: 'Stwór poluje częściej i biega szybciej, potwory mocniej ranią, a bateria, jedzenie i ciepło znikają szybciej.' },
  nightmare: { name: 'Koszmar', aggr: 1.7, speed: 1.22, dmg: 1.6, drain: 1.5, battery: 1.5, wood: 0, berries: 0,
    desc: 'Tylko dla najodważniejszych. Wszystko w lesie chce cię dopaść, a każdy błąd może być ostatni.' },
};
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};
let diffKey = DIFFS[store.get('npw-diff', 'normal')] ? store.get('npw-diff', 'normal') : 'normal';
let DF = DIFFS[diffKey];
function renderDiff() {
  document.querySelectorAll('.diff').forEach(b => {
    const on = b.dataset.d === diffKey;
    b.classList.toggle('sel', on); b.setAttribute('aria-checked', on);
  });
  $('diffDesc').textContent = DIFFS[diffKey].desc;
}
document.querySelectorAll('.diff').forEach(b => b.addEventListener('click', () => {
  diffKey = b.dataset.d; DF = DIFFS[diffKey];
  store.set('npw-diff', diffKey); renderDiff();
}));
renderDiff();

let muted = store.get('npw-muted', '0') === '1';
function applyMute() {
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, AC.currentTime, 0.05);
  document.querySelectorAll('.muteBtn').forEach(b => { b.textContent = muted ? '🔇 Dźwięk: wył.' : '🔊 Dźwięk: wł.'; });
  $('tMute').textContent = muted ? '🔇' : '🔊';
}
function toggleMute() {
  muted = !muted;
  store.set('npw-muted', muted ? '1' : '0');
  applyMute();
  showMsg(muted ? 'Dźwięk wyłączony (M)' : 'Dźwięk włączony (M)', '#ccc', 1200);
}
document.querySelectorAll('.muteBtn').forEach(b => b.addEventListener('click', toggleMute));
applyMute();
$('howtoBtn').onclick = () => { $('menu').classList.add('hidden'); $('howto').classList.remove('hidden'); };
$('howtoBack').onclick = () => { $('howto').classList.add('hidden'); $('menu').classList.remove('hidden'); };
$('toLobby').onclick = () => location.reload();

// ===================================================================
// Input
// ===================================================================
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyM' && !e.repeat) toggleMute();
  if (!S.playing) return;
  if (e.repeat) return;
  if (e.code === 'KeyF') toggleFlash();
  if (e.code === 'KeyB') tryBuildFire();
  if (e.code === 'KeyQ') eatBerry();
  if (e.code === 'KeyT') torchAction();
  if (e.code === 'KeyH') useHeal();
  if (e.code === 'KeyR') usePoison();
  if (e.code === 'Escape') pauseGame();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (S.playing) pauseGame(); });

function look(dx, dy) {
  yaw -= dx * 0.0026;
  pitch = clamp(pitch - dy * 0.0022, -1.1, 0.75);
}
addEventListener('mousemove', e => {
  if (!S.playing) return;
  if (document.pointerLockElement === canvas) look(e.movementX, e.movementY);
  else if (e.buttons & 1) look(e.movementX, e.movementY); // drag fallback
});
addEventListener('wheel', e => { camDist = clamp(camDist + e.deltaY * 0.005, 3, 11); });
canvas.addEventListener('click', () => { if (!TOUCH && S.playing && document.pointerLockElement !== canvas) canvas.requestPointerLock?.(); });
let hadLock = false;
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) hadLock = true;
  else if (hadLock && S.playing) pauseGame();
});

// --- Touch controls: floating joystick (left), swipe to look (right), on-screen buttons
const joy = { x: 0, y: 0, id: null, cx: 0, cy: 0 };
const KEY_E = TOUCH ? '✋ ' : '[E] ';
const KEY_T = TOUCH ? '🪔 ' : '[T] ', KEY_H = TOUCH ? '💉 ' : '[H] ', KEY_R = TOUCH ? '☠️ ' : '[R] ';
if (TOUCH) {
  const zone = $('joyZone'), base = $('joyBase'), knob = $('joyKnob');
  const R = 55;
  const cap = (el, id) => { try { el.setPointerCapture(id); } catch (e) {} };
  const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
  zone.addEventListener('pointerdown', e => {
    if (joy.id !== null) return;
    joy.id = e.pointerId; joy.cx = e.clientX; joy.cy = e.clientY;
    cap(zone, e.pointerId);
    base.style.left = e.clientX + 'px'; base.style.top = e.clientY + 'px';
    base.classList.add('active');
  });
  zone.addEventListener('pointermove', e => {
    if (e.pointerId !== joy.id) return;
    let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    joy.x = dx / R; joy.y = dy / R;
    setKnob(dx, dy);
  });
  const joyEnd = e => {
    if (e.pointerId !== joy.id) return;
    joy.id = null; joy.x = joy.y = 0; setKnob(0, 0);
    base.classList.remove('active');
    base.style.left = ''; base.style.top = '';
  };
  zone.addEventListener('pointerup', joyEnd);
  zone.addEventListener('pointercancel', joyEnd);

  const lookZone = $('lookZone');
  const lookers = new Map();
  lookZone.addEventListener('pointerdown', e => { cap(lookZone, e.pointerId); lookers.set(e.pointerId, [e.clientX, e.clientY]); });
  lookZone.addEventListener('pointermove', e => {
    const p = lookers.get(e.pointerId);
    if (!p || !S.playing) return;
    look((e.clientX - p[0]) * 1.8, (e.clientY - p[1]) * 1.8);
    p[0] = e.clientX; p[1] = e.clientY;
  });
  const lookEnd = e => lookers.delete(e.pointerId);
  lookZone.addEventListener('pointerup', lookEnd);
  lookZone.addEventListener('pointercancel', lookEnd);

  // hold buttons map onto the same keys as the keyboard
  const hold = (id, code) => {
    const b = $(id);
    const up = () => { keys[code] = false; b.classList.remove('down'); };
    b.addEventListener('pointerdown', e => { e.preventDefault(); cap(b, e.pointerId); keys[code] = true; b.classList.add('down'); });
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  };
  hold('tAct', 'KeyE');
  hold('tJump', 'Space');
  const tap = (id, fn) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); if (S.playing) fn(); });
  tap('tFire', tryBuildFire);
  tap('tFlash', toggleFlash);
  tap('tEat', eatBerry);
  tap('tTorch', torchAction);
  tap('tHeal', useHeal);
  tap('tStab', usePoison);
  tap('tPause', pauseGame);
  tap('tMute', toggleMute);

  // stop iOS Safari from scrolling, zooming or bouncing the page
  document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());
}
document.addEventListener('visibilitychange', () => { if (document.hidden && S.playing) pauseGame(); });

function startGame() {
  if (!S.started) {
    S.wood = DF.wood; S.berries = DF.berries;
    $('obj').textContent = `Przetrwaj do 6:00 · ${DF.name}`;
  }
  initAudio();
  $('menu').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('hud').classList.add('on');
  S.playing = true; S.started = true;
  if (!TOUCH) try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch (e) {}
  if (!S.introShown) {
    S.introShown = true;
    setTimeout(() => showMsg(TOUCH ? 'Zetnij drzewa (✋) i rozpal ognisko (🔥), zanim zrobi się zimno…' : 'Zetnij drzewa (E) i rozpal ognisko (B), zanim zrobi się zimno…', '#ffd9a0', 5000), 600);
    setTimeout(() => showMsg('Nad lasem świeci czerwony krzyż — stary szpital. Podobno zostały tam leki…', '#ff8787', 5000), 9000);
  }
}
function pauseGame() {
  if (!S.playing || S.over) return;
  S.playing = false;
  $('pause').classList.remove('hidden');
  if (AC) AC.suspend();
}
function resumeGame() {
  if (AC) AC.resume();
  startGame();
}
$('play').onclick = startGame;
$('resume').onclick = resumeGame;
$('retry').onclick = () => location.reload();
$('nextNight').onclick = () => {
  S.night++;
  S.mins = 22 * 60;
  S.hp = Math.min(100, S.hp + 40);
  S.warmth = Math.max(S.warmth, 60);
  M.state = 'away'; M.timer = 30; monster.visible = false;
  resetHospital(); placeSyringes();
  boundaryWarned = false;
  $('dawn').classList.add('hidden');
  $('night').textContent = 'NOC ' + S.night;
  startGame();
  showMsg(`Noc ${S.night}. Las jest coraz bardziej głodny…`, '#ff6b6b', 4000);
};

// ===================================================================
// Actions
// ===================================================================
let msgTimer = null;
function showMsg(text, color = '#fff', ms = 2600) {
  const el = $('msg');
  el.textContent = text; el.style.color = color; el.style.opacity = 1;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { el.style.opacity = 0; }, ms);
}
function toggleFlash() {
  if (S.battery <= 0) { showMsg('Bateria jest pusta.', '#fcc419'); SFX.click(); return; }
  S.flash = !S.flash; SFX.click();
}
function eatBerry() {
  if (S.berries <= 0) { showMsg('Nie masz jagód.', '#aaa'); return; }
  if (S.hunger > 97) { showMsg('Nie jesteś głodny/a.', '#aaa'); return; }
  S.berries--; S.hunger = Math.min(100, S.hunger + 22); S.hp = Math.min(100, S.hp + 4);
  SFX.eat();
}
function forward2() { return { x: Math.sin(yaw), z: Math.cos(yaw) }; }
function tryBuildFire() {
  if (S.wood < 5) { showMsg(`Potrzebujesz 5 drewna (masz ${S.wood}).`, '#ffb36b'); return; }
  const f = forward2();
  const x = player.position.x + f.x * 2.2, z = player.position.z + f.z * 2.2;
  for (const t of trees) if (t.alive && Math.hypot(t.x - x, t.z - z) < 1.6) { showMsg('Za blisko drzewa.', '#ffb36b'); return; }
  S.wood -= 5;
  createFire(x, z);
  SFX.ignite();
  showMsg('Ognisko płonie. Stwór boi się ognia.', '#ffb36b');
}
function torchAction() {
  const nf = nearestLitFire(player.position.x, player.position.z);
  if (nf && nf.d < 3.6 && S.torches > 0 && !S.torchLit) {
    S.torches--; S.torchLit = true; S.torchTime = TORCH_TIME;
    SFX.ignite();
    showMsg('Pochodnia płonie! Grzeje i trzyma potwory z daleka.', '#ffb36b');
    return;
  }
  if (S.torches >= TORCH_MAX) { showMsg(`Masz już ${TORCH_MAX} pochodnie.` + (S.torchLit ? '' : ' Odpal jedną przy ognisku.'), '#ffb36b'); return; }
  if (S.wood < 2) { showMsg(`Pochodnia kosztuje 2 drewna (masz ${S.wood}).`, '#ffb36b'); return; }
  S.wood -= 2; S.torches++;
  SFX.chop();
  showMsg(`+1 pochodnia (${S.torches}/${TORCH_MAX}). Odpal ją przy ognisku: ${KEY_T.trim()}`, '#ffb36b');
}
function useHeal() {
  if (S.healSyr <= 0) { showMsg('Nie masz strzykawki leczniczej.', '#aaa'); return; }
  if (S.hp >= 100) { showMsg('Masz pełne zdrowie.', '#aaa'); return; }
  S.healSyr--; S.hp = Math.min(100, S.hp + 40);
  SFX.inject(); showMsg('+40 zdrowia', '#8ce99a');
}
function usePoison() {
  if (S.poisonSyr <= 0) { showMsg('Nie masz trucizny.', '#aaa'); return; }
  const pp = player.position;
  let best = null, bd = 2.8;
  for (const p of patients) if (p.state !== 'dead') { const d = p.g.position.distanceTo(pp); if (d < bd) { bd = d; best = p; } }
  if (best) {
    S.poisonSyr--; armSwing = 1; best.state = 'dead'; best.dead = 0.001;
    SFX.stab(); showMsg('Pacjent osuwa się na podłogę…', '#b197fc');
    return;
  }
  if (CRAWLER.state !== 'dead' && CRAWLER.g.position.distanceTo(pp) < 2.8) {
    S.poisonSyr--; armSwing = 1; CRAWLER.state = 'dead'; CRAWLER.dead = 0.001;
    SFX.stab(); showMsg('Pełzacz wije się i nieruchomieje…', '#b197fc');
    return;
  }
  if (inHospital(pp.x, pp.z) && NURSE.g.position.distanceTo(pp) < 2.8) {
    S.poisonSyr--; armSwing = 1; NURSE.stun = 10;
    SFX.stab(); showMsg('Siostra zamarła… masz chwilę!', '#b197fc');
    return;
  }
  if (monster.visible && M.state === 'hunt' && monster.position.distanceTo(pp) < 3.5) {
    S.poisonSyr--; armSwing = 1;
    SFX.stab(); monsterVanish(); showMsg('Stwór ucieka z wrzaskiem!', '#b197fc');
    return;
  }
  showMsg('Nikogo w zasięgu ręki.', '#aaa');
}
function findTarget() {
  const px = player.position.x, pz = player.position.z;
  const f = forward2();
  let best = null, bs = 1e9;
  const consider = (type, obj, x, z, range, y = 0) => {
    if (Math.abs(y - player.position.y) > 1.8) return;
    const dx = x - px, dz = z - pz, d = Math.hypot(dx, dz);
    if (d > range) return;
    const dot = (dx * f.x + dz * f.z) / (d || 1);
    if (dot < -0.2 && d > 1.2) return;
    const score = d - dot * 0.9;
    if (score < bs) { bs = score; best = { type, obj }; }
  };
  for (const t of trees) if (t.alive && Math.abs(t.x - px) < 4 && Math.abs(t.z - pz) < 4) consider('tree', t, t.x, t.z, 1.9 + t.s * 0.5);
  for (const b of bushes) if (b.berries.some(x => x.visible)) consider('bush', b, b.x, b.z, 2.5);
  for (const b of batteries) if (!b.taken) consider('battery', b, b.x, b.z, 2.2, b.y);
  for (const fi of fires) consider('fire', fi, fi.x, fi.z, 3.2);
  for (const sy of syringes) if (!sy.taken) consider('syringe', sy, sy.x, sy.z, 2.0, sy.y);
  return best;
}
function interact() {
  if (!target || interactCD > 0) return;
  const o = target.obj;
  if (target.type === 'tree') {
    interactCD = 0.45; armSwing = 1;
    o.hp--; o.shake = 1;
    SFX.chop(); shake = Math.max(shake, 0.06);
    if (o.hp <= 0) {
      o.alive = false; o.fall = 0.001;
      SFX.fall();
      const got = 3;
      S.wood += got; S.treesCut++;
      showMsg(`+${got} drewna`, '#d9a066', 1400);
    }
  } else if (target.type === 'bush') {
    interactCD = 0.3; armSwing = 0.6;
    const b = o.berries.find(x => x.visible);
    if (b) { b.visible = false; S.berries++; SFX.pickup(); showMsg('+1 jagoda', '#c9a0ff', 1000); }
  } else if (target.type === 'battery') {
    interactCD = 0.3;
    o.taken = true; o.g.visible = false;
    S.battery = Math.min(100, S.battery + 45);
    SFX.pickup(); showMsg('+45% baterii', '#fcc419', 1400);
  } else if (target.type === 'syringe') {
    interactCD = 0.3; armSwing = 0.6;
    o.taken = true; o.g.visible = false;
    SFX.glass();
    if (Math.random() < 0.55) { S.healSyr++; showMsg(`💉 Lecznicza! Użyj, gdy trzeba: ${KEY_H.trim()}`, '#8ce99a', 3000); }
    else { S.poisonSyr++; showMsg(`☠️ Trucizna! Wbij ją potworowi z bliska: ${KEY_R.trim()}`, '#b197fc', 3000); }
  } else if (target.type === 'fire') {
    interactCD = 0.35;
    if (S.wood <= 0) { showMsg('Nie masz drewna.', '#aaa'); return; }
    if (o.fuel > 170) { showMsg('Ogień i tak mocno płonie.', '#ffb36b'); return; }
    S.wood--;
    if (o.fuel <= 0 || !o.light) {
      // relight: reclaim a light
      const light = fireLights[fireLightIdx % fireLights.length];
      fires.forEach(f => { if (f.light === light) f.light = null; });
      fireLightIdx++;
      light.position.set(o.x, 1.6, o.z); o.light = light;
      SFX.ignite();
    } else noise(0.4, { freq: 400, freqEnd: 1200, vol: 0.2 });
    o.fuel = Math.max(o.fuel, 0) + 35;
  }
}

// ===================================================================
// Effects: grain + jumpscare face
// ===================================================================
const grain = $('grain'), gctx = grain.getContext('2d');
const gimg = gctx.createImageData(160, 90);
function drawGrain() {
  const d = gimg.data;
  for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  gctx.putImageData(gimg, 0, 0);
}
function drawScare(kind = 'stwor') {
  const c = $('scare'); c.width = innerWidth; c.height = innerHeight;
  const g = c.getContext('2d'); const w = c.width, h = c.height, cx = w / 2, cy = h / 2, s = Math.min(w, h);
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  if (kind === 'crawler') {
    g.fillStyle = '#8f887a'; g.fillRect(cx - s * 0.32, cy - s * 0.4, s * 0.64, s * 0.7);
    g.fillStyle = '#000'; g.fillRect(cx - s * 0.26, cy - s * 0.12, s * 0.52, s * 0.36);
    g.fillStyle = '#e8e2d0';
    const n = 11, tw = (s * 0.52) / n;
    for (let i = 0; i < n; i++) {
      const x0 = cx - s * 0.26 + i * tw;
      g.beginPath(); g.moveTo(x0, cy - s * 0.12); g.lineTo(x0 + tw, cy - s * 0.12); g.lineTo(x0 + tw / 2, cy - s * 0.02); g.fill();
      g.beginPath(); g.moveTo(x0, cy + s * 0.24); g.lineTo(x0 + tw, cy + s * 0.24); g.lineTo(x0 + tw / 2, cy + s * 0.14); g.fill();
    }
    return;
  }
  if (kind === 'nurse') {
    g.fillStyle = '#cfc8b6'; g.fillRect(cx - s * 0.27, cy - s * 0.42, s * 0.54, s * 0.95);
    g.fillStyle = '#eeeeee'; g.fillRect(cx - s * 0.3, cy - s * 0.6, s * 0.6, s * 0.2);
    g.fillStyle = '#b00000'; g.fillRect(cx - s * 0.08, cy - s * 0.52, s * 0.16, s * 0.05); g.fillRect(cx - s * 0.025, cy - s * 0.575, s * 0.05, s * 0.16);
    g.fillStyle = '#000';
    for (const sx of [-1, 1]) g.fillRect(cx + sx * s * 0.11 - s * 0.07, cy - s * 0.2, s * 0.14, s * 0.17);
    g.fillRect(cx - s * 0.05, cy + s * 0.06, s * 0.1, s * 0.32);
    g.fillStyle = 'rgba(80,10,10,.55)';
    for (let i = 0; i < 40; i++) g.fillRect(cx + rand(-s * 0.27, s * 0.2), cy + rand(-s * 0.3, s * 0.5), rand(2, s * 0.03), rand(4, s * 0.08));
    return;
  }
  g.fillStyle = '#101012'; g.fillRect(cx - s * 0.3, cy - s * 0.55, s * 0.6, s * 1.2);
  g.fillStyle = '#18181b'; g.fillRect(cx - s * 0.26, cy - s * 0.5, s * 0.52, s * 0.2);
  for (const sx of [-1, 1]) {
    const ex = cx + sx * s * 0.12, ey = cy - s * 0.12;
    const grd = g.createRadialGradient(ex, ey, 2, ex, ey, s * 0.16);
    grd.addColorStop(0, 'rgba(255,255,255,.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(ex - s * 0.16, ey - s * 0.16, s * 0.32, s * 0.32);
    g.fillStyle = '#fff'; g.fillRect(ex - s * 0.06, ey - s * 0.035, s * 0.12, s * 0.07);
    g.fillStyle = '#c00'; g.fillRect(ex - s * 0.012, ey - s * 0.02, s * 0.024, s * 0.04);
  }
  g.fillStyle = '#2a0000'; g.fillRect(cx - s * 0.17, cy + s * 0.05, s * 0.34, s * 0.26);
  g.fillStyle = '#e8e2d0';
  const n = 9, tw = (s * 0.34) / n;
  for (let i = 0; i < n; i++) {
    g.beginPath(); g.moveTo(cx - s * 0.17 + i * tw, cy + s * 0.05); g.lineTo(cx - s * 0.17 + (i + 1) * tw, cy + s * 0.05); g.lineTo(cx - s * 0.17 + (i + 0.5) * tw, cy + s * 0.13); g.fill();
    g.beginPath(); g.moveTo(cx - s * 0.17 + i * tw, cy + s * 0.31); g.lineTo(cx - s * 0.17 + (i + 1) * tw, cy + s * 0.31); g.lineTo(cx - s * 0.17 + (i + 0.5) * tw, cy + s * 0.23); g.fill();
  }
}

// ===================================================================
// Monster logic
// ===================================================================
const _v = new THREE.Vector3();
function hourIndex() { return clamp((S.mins - 22 * 60) / 60, 0, 8); }
function aggression() { return (1 + hourIndex() * 0.12 + (S.night - 1) * 0.35) * DF.aggr; }
function playerSafe() {
  const pp = player.position;
  if (S.torchLit || inHospital(pp.x, pp.z)) return true;
  const n = nearestLitFire(pp.x, pp.z);
  return !!(n && n.d < FIRE_R);
}
function placeAround(dist, inView) {
  let x, z, tries = 0;
  do {
    const a = inView ? yaw + rand(-0.55, 0.55) : yaw + Math.PI + rand(-1.2, 1.2) + tries;
    x = player.position.x + Math.sin(a) * dist; z = player.position.z + Math.cos(a) * dist;
  } while (inHospital(x, z, 3) && ++tries < 8);
  monster.position.set(x, 0, z);
}
function monsterVanish(sound = true) {
  if (sound && monster.visible) SFX.vanish();
  monster.visible = false;
  M.state = 'away';
  M.timer = rand(14, 26) / aggression();
  M.exposure = 0; M.seen = false;
}
function startStalk() {
  M.state = 'stalk'; M.timer = rand(7, 13); M.seen = false; M.exposure = 0;
  placeAround(rand(20, 28), Math.random() < 0.6);
  monster.visible = true;
}
function startHunt(fromHere = false) {
  M.state = 'hunt'; M.huntT = 0; M.hold = 0; M.exposure = 0;
  if (!fromHere) placeAround(rand(30, 36), false);
  monster.visible = true;
  const dx = monster.position.x - player.position.x, dz = monster.position.z - player.position.z;
  SFX.scream(screenPan(dx, dz));
  showMsg('Coś biegnie w twoją stronę…', '#ff4d4d', 2500);
}
function screenPan(dx, dz) {
  const rx = -Math.cos(yaw), rz = Math.sin(yaw);
  return clamp((dx * rx + dz * rz) / (Math.hypot(dx, dz) || 1), -1, 1);
}
function isLit(pos) {
  if (!S.flash || S.battery <= 0) return false;
  _v.copy(pos).sub(flashlight.position);
  const d = _v.length();
  if (d > 34) return false;
  const dir = _p.copy(flashlight.target.position).sub(flashlight.position).normalize();
  return _v.normalize().dot(dir) > Math.cos(flashlight.angle * 0.9);
}
function onScreen(pos) {
  _v.copy(pos).project(camera);
  return _v.z < 1 && Math.abs(_v.x) < 0.95 && Math.abs(_v.y) < 0.95;
}
// any damage from a creature; `scare` shows a full-screen jumpscare face
function hurt(amount, cause, scare) {
  S.hp -= amount * DF.dmg;
  S.hurtAt = S.totalTime; S.hurtCause = cause;
  S.fear = Math.min(100, S.fear + (scare ? 100 : 30));
  shake = Math.max(shake, scare ? 0.6 : 0.35);
  const el = $('hurt');
  el.style.transition = 'none'; el.style.opacity = 0.75; void el.offsetWidth;
  el.style.transition = 'opacity .7s'; el.style.opacity = 0;
  if (scare) {
    drawScare(scare);
    $('scare').classList.add('on');
    SFX.jumpscare();
    setTimeout(() => $('scare').classList.remove('on'), 750);
  } else SFX.hit();
}
function attack() {
  S.closeCalls++;
  hurt(38, 'Stwór cię dopadł.', 'stwor');
  monster.visible = false;
  M.state = 'away'; M.timer = rand(25, 40) / aggression();
  if (S.hp > 0) setTimeout(() => showMsg('Uciekaj do ognia!', '#ff4d4d', 2500), 800);
}

function updateMonster(dt) {
  const dawn = S.mins > 29 * 60 + 20;
  const pp = player.position, mp = monster.position;
  const dx = pp.x - mp.x, dz = pp.z - mp.z, dist = Math.hypot(dx, dz);
  const chest = _p.set(mp.x, 4, mp.z).clone();
  const lit = monster.visible && isLit(chest);
  M.anim += dt;

  if (monster.visible) monster.rotation.y = Math.atan2(dx, dz);
  if (dawn && M.state !== 'away') { monsterVanish(); return; }

  switch (M.state) {
    case 'away':
      M.timer -= dt;
      if (M.timer <= 0 && !dawn && inHospital(pp.x, pp.z, 2)) { M.timer = rand(8, 15); break; }
      if (M.timer <= 0 && !dawn) {
        const safe = playerSafe();
        const p = (0.28 + hourIndex() * 0.06 + (S.night - 1) * 0.1) * DF.aggr;
        if (!safe && Math.random() < p) startHunt(); else startStalk();
      }
      break;
    case 'stalk': {
      M.timer -= dt;
      mHeadPivot.rotation.z = Math.sin(M.anim * 0.7) * 0.25 + (Math.random() < 0.02 ? rand(-.5, .5) : 0);
      mArmL.rotation.x = mArmR.rotation.x = 0; mLegL.rotation.x = mLegR.rotation.x = 0;
      if (!M.seen && dist < 32 && onScreen(_v.set(mp.x, 4.5, mp.z))) { M.seen = true; SFX.sting(); S.fear = Math.min(100, S.fear + 35); }
      if (lit) M.exposure += dt; else M.exposure = Math.max(0, M.exposure - dt * 0.5);
      if (inHospital(pp.x, pp.z)) { monsterVanish(false); break; }
      if (dist < 11 || M.exposure > 0.6) { flickerT = 0.5; monsterVanish(); break; }
      if (M.timer <= 0) {
        if (!playerSafe() && Math.random() < 0.45) startHunt(true); else monsterVanish(false);
      }
      break;
    }
    case 'hunt': {
      M.huntT += dt;
      let speed = (5.4 + hourIndex() * 0.18 + (S.night - 1) * 0.5) * DF.speed;
      if (lit) { M.exposure += dt; speed *= 0.2; } else M.exposure = Math.max(0, M.exposure - dt * 0.3);
      if (M.exposure > 1.3) { flickerT = 0.6; SFX.scream(screenPan(-dx, -dz)); monsterVanish(); showMsg('Odstraszone… na razie.', '#9fd3ff'); break; }
      // fire barrier
      const nf = nearestLitFire(pp.x, pp.z);
      let blocked = false;
      if (nf && nf.d < FIRE_R) {
        const step = speed * dt;
        const nx = mp.x + (dx / dist) * step, nz = mp.z + (dz / dist) * step;
        if (Math.hypot(nx - nf.fire.x, nz - nf.fire.z) < FIRE_R + 2) blocked = true;
      }
      // a burning torch keeps it at arm's length, and it never enters the hospital
      if (S.torchLit && dist < 7) blocked = true;
      if (inHospital(mp.x + (dx / dist) * 1.5, mp.z + (dz / dist) * 1.5, 1.5)) blocked = true;
      if (blocked) {
        M.hold += dt;
        mHeadPivot.rotation.z = Math.sin(M.anim * 9) * 0.35;
        if (M.hold > 3) { monsterVanish(); showMsg(inHospital(pp.x, pp.z, 2) ? 'Stwór nie wchodzi do szpitala…' : 'Ogień cię ocalił.', '#ffb36b'); }
      } else if (dist > 0.01) {
        mp.x += (dx / dist) * speed * dt; mp.z += (dz / dist) * speed * dt;
        const sw = Math.sin(M.anim * 14) * 0.9;
        mLegL.rotation.x = sw; mLegR.rotation.x = -sw;
        mArmL.rotation.x = -1.2 + Math.sin(M.anim * 20) * 0.3; mArmR.rotation.x = -1.2 - Math.sin(M.anim * 20) * 0.3;
        mHeadPivot.rotation.z = Math.sin(M.anim * 23) * 0.2;
        M.stepT -= dt;
        if (M.stepT <= 0) { M.stepT = 0.28; SFX.mstep(clamp(1 - dist / 35, 0.05, 1)); }
      }
      if (dist < 1.6) attack();
      else if (M.huntT > 32) monsterVanish();
      break;
    }
  }
}

function updateWatchers(dt) {
  const safe = playerSafe();
  for (const w of watchers) {
    if (w.g.visible) {
      w.life -= dt;
      w.blink -= dt;
      w.g.children.forEach(c => c.visible = w.blink > 0 || w.blink < -0.12);
      if (w.blink < -0.12) w.blink = rand(1.5, 4);
      const d = w.g.position.distanceTo(player.position);
      if (w.life <= 0 || d < 9 || isLit(w.g.position) || S.mins > 29 * 60) {
        if (d < 9 || isLit(w.g.position)) SFX.twig(screenPan(w.g.position.x - player.position.x, w.g.position.z - player.position.z));
        w.g.visible = false;
      }
      w.g.lookAt(player.position.x, w.g.position.y, player.position.z);
    } else if (!safe && S.mins < 29 * 60 && Math.random() < dt * 0.025 * aggression()) {
      const a = rand(0, Math.PI * 2), r = rand(16, 28);
      w.g.position.set(player.position.x + Math.sin(a) * r, rand(0.6, 2.2), player.position.z + Math.cos(a) * r);
      w.g.visible = true; w.life = rand(6, 14); w.blink = rand(1, 3);
    }
  }
}

// ===================================================================
// Main update
// ===================================================================
function gameOver(cause) {
  S.over = true; S.playing = false;
  document.exitPointerLock?.();
  $('hud').classList.remove('on');
  $('cause').textContent = cause;
  const hrs = Math.floor(hourIndex()), mm = Math.floor((S.mins - 22 * 60) % 60);
  $('overStats').innerHTML = `Poziom: <b>${DF.name}</b> • Noc: <b>${S.night}</b> • godzina śmierci: <b>${fmtClock(S.mins)}</b><br>Przetrwany czas tej nocy: <b>${hrs} h ${mm} min</b><br>Ścięte drzewa: <b>${S.treesCut}</b>`;
  $('over').classList.remove('hidden');
}
function winNight() {
  S.playing = false;
  document.exitPointerLock?.();
  $('dawnSub').textContent = `Noc ${S.night} przetrwana. Stwór odszedł… na razie.`;
  $('dawnStats').innerHTML = `Poziom: <b>${DF.name}</b> • Ścięte drzewa: <b>${S.treesCut}</b> • Spotkania ze Stworem: <b>${S.closeCalls}</b><br>Kolejna noc będzie trudniejsza.`;
  $('dawn').classList.remove('hidden');
}
function fmtClock(mins) {
  const h = Math.floor(mins / 60) % 24, m = Math.floor(mins % 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// circle vs axis-aligned boxes, only those overlapping the storey at height y
function pushOut(x, z, r, list, y) {
  for (const w of list) {
    if (w.y0 > y + 1.8 || w.y1 < y + 0.2) continue;
    const cx = clamp(x, w.x0, w.x1), cz = clamp(z, w.z0, w.z1);
    const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) { const d = Math.sqrt(d2); x = cx + dx / d * r; z = cz + dz / d * r; }
    else {
      const l = x - w.x0, ri = w.x1 - x, b = z - w.z0, f = w.z1 - z, mn = Math.min(l, ri, b, f);
      if (mn === l) x = w.x0 - r; else if (mn === ri) x = w.x1 + r; else if (mn === b) z = w.z0 - r; else z = w.z1 + r;
    }
  }
  return [x, z];
}
function collideWalls(x, z, r, y) {
  if (!inHospital(x, z, 2)) return [x, z];
  [x, z] = pushOut(x, z, r, walls, y);
  return pushOut(x, z, r, props, y);
}
// fraction (0..1) of the segment a→b, at height y, before it hits a hospital wall
function rayT(ax, az, bx, bz, m, y) {
  let best = 1;
  const dx = bx - ax, dz = bz - az;
  for (const w of walls) {
    if (w.y0 > y || w.y1 < y) continue;
    let t0 = 0, t1 = 1, miss = false;
    for (const [a, d, lo, hi] of [[ax, dx, w.x0 - m, w.x1 + m], [az, dz, w.z0 - m, w.z1 + m]]) {
      if (Math.abs(d) < 1e-9) { if (a < lo || a > hi) { miss = true; break; } continue; }
      let ta = (lo - a) / d, tb = (hi - a) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) { miss = true; break; }
    }
    if (!miss && t0 < best) best = t0;
  }
  return best;
}
const losClear = (ax, az, bx, bz, y) => rayT(ax, az, bx, bz, 0, y) >= 1;
// floor height under (x, z) for someone standing at height y: hospital storeys and stairs
function groundAt(x, z, y) {
  if (!inHospital(x, z)) return 0;
  let best = -LV;
  const cand = h => { if (h <= y + 0.75 && h > best) best = h; };
  if (inRamp(RAMP_W, x, z)) cand(rampY(RAMP_W, z)); else cand(0.04);
  if (inRamp(RAMP_E, x, z)) cand(rampY(RAMP_E, z)); else cand(LV);
  return best;
}
const playerLevel = () => levelOf(player.position.y + 0.5);

function updatePatients(dt, inside) {
  const pp = player.position;
  for (const p of patients) {
    const g = p.g;
    if (p.state === 'dead') {
      if (p.dead > 0 && p.dead < 1) { p.dead += dt; g.rotation.x = -Math.min(1, p.dead * 2) * Math.PI / 2 * 0.95; }
      continue;
    }
    const ly = LEVEL_Y[p.level];
    const onLevel = inside && playerLevel() === p.level;
    const dx = pp.x - g.position.x, dz = pp.z - g.position.z, d = Math.hypot(dx, dz);
    const sees = onLevel && d < 13 && losClear(g.position.x, g.position.z, pp.x, pp.z, ly + 1.5);
    if (sees) {
      if (p.state !== 'chase') { p.state = 'chase'; SFX.patientScream(screenPan(-dx, -dz)); S.fear = Math.min(100, S.fear + 20); }
      p.tx = pp.x; p.tz = pp.z; p.lost = 0;
    } else if (p.state === 'chase') { p.lost += dt; if (p.lost > 6 || !onLevel) p.state = 'wander'; }
    let speed = 1.1;
    if (p.state === 'chase') speed = (4.3 + (S.night - 1) * 0.3) * DF.speed;
    else {
      p.wt -= dt;
      if (p.wt <= 0 || Math.hypot(p.tx - g.position.x, p.tz - g.position.z) < 0.5) {
        p.wt = rand(3, 7);
        p.tx = clamp(p.home[0] + rand(-3, 3), hx(-W + 1), hx(W - 1));
        p.tz = clamp(p.home[1] + rand(-3, 3), hz(-D + 1), hz(D - 1));
      }
    }
    let mx = p.tx - g.position.x, mz = p.tz - g.position.z;
    const torchNear = onLevel && S.torchLit && d < 3.4;
    if (torchNear) { mx = -dx; mz = -dz; speed = 2; } // flinch away from the flame
    const ml = Math.hypot(mx, mz);
    if (ml > 0.05 && (torchNear || !onLevel || d > 0.95)) {
      let nx = g.position.x + mx / ml * speed * dt, nz = g.position.z + mz / ml * speed * dt;
      [nx, nz] = collideWalls(nx, nz, 0.4, ly);
      g.position.set(clamp(nx, hx(-W + 0.6), hx(W - 0.6)), ly, clamp(nz, hz(-D + 0.6), hz(D - 0.6)));
      const want = torchNear ? Math.atan2(dx, dz) : Math.atan2(mx, mz);
      let dr = want - g.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      g.rotation.y += dr * Math.min(1, dt * 6);
    }
    p.anim += dt * speed * 2.2;
    const sw = Math.sin(p.anim) * 0.6;
    p.legL.rotation.x = sw; p.legR.rotation.x = -sw;
    p.armL.rotation.x = -1.3 + Math.sin(p.anim * 1.3) * 0.15;
    p.armR.rotation.x = -1.2 - Math.sin(p.anim * 1.1) * 0.15;
    p.headP.rotation.z = Math.sin(p.anim * 0.7) * 0.3 + (Math.random() < 0.03 ? rand(-0.4, 0.4) : 0);
    p.hitCD -= dt;
    if (onLevel && d < 1.25 && p.hitCD <= 0 && !torchNear) { p.hitCD = 1.4; hurt(18, 'Pacjenci szpitala cię dopadli.'); SFX.patientScream(0); }
    p.groanT -= dt;
    if (p.groanT <= 0) { p.groanT = rand(4, 9); if (onLevel && d < 18) SFX.groan(screenPan(-dx, -dz), clamp(1 - d / 18, 0.1, 1)); }
  }
}

const NV1 = new THREE.Vector3(), NV2 = new THREE.Vector3();
function updateNurse(dt, inside) {
  const n = NURSE, g = n.g, pp = player.position, ly = LEVEL_Y[n.level];
  if (!inside || playerLevel() !== n.level) {
    n.wake = 0;
    // while you're away she quietly goes back to her end of the corridor
    if (!onScreen(NV1.set(g.position.x, ly + 2, g.position.z)) || g.position.distanceTo(pp) > 25) { g.position.set(n.sx, ly, n.sz); n.moved = true; }
    return;
  }
  n.wake += dt;
  if (n.stun > 0) { n.stun -= dt; g.rotation.z = Math.sin(S.totalTime * 30) * 0.03; return; }
  g.rotation.z = 0;
  const dx = pp.x - g.position.x, dz = pp.z - g.position.z, d = Math.hypot(dx, dz);
  NV1.set(g.position.x, ly + 2.7, g.position.z); NV2.set(g.position.x, ly + 1.3, g.position.z);
  // she only freezes when you can actually see her: flashlight, torch or a working ceiling lamp
  const underLamp = lampFix[n.level].some(L => L.on && Math.hypot(hx(L.x) - g.position.x, hz(L.z) - g.position.z) < 3.5);
  const lit = isLit(NV1) || isLit(NV2) || (S.torchLit && d < 9) || underLamp;
  const visible = lit && (onScreen(NV1) || onScreen(NV2)) && losClear(camera.position.x, camera.position.z, g.position.x, g.position.z, ly + 1.5);
  if (!visible && n.wake > 5) {
    n.moved = true;
    const sp = (3.4 + (S.night - 1) * 0.4) * DF.speed;
    if (d > 0.01) {
      let nx = clamp(g.position.x + dx / d * sp * dt, hx(-W + 0.5), hx(W - 0.5));
      const nz = clamp(g.position.z + dz / d * sp * dt, hz(-D + 0.5), hz(D - 0.5));
      if (inRamp(RAMP_E, nx, nz)) nx = hx(RAMP_E.x0) - 0.3; // never over the stair hole
      g.position.set(nx, ly, nz);
    }
    g.rotation.y = Math.atan2(dx, dz);
    n.creakT -= dt;
    if (n.creakT <= 0 && d < 16) { n.creakT = 0.32; SFX.creak(screenPan(-dx, -dz), clamp(1 - d / 16, 0.15, 1)); }
  } else if (visible && n.moved) {
    // every time you look back she is frozen in a new, wrong pose
    n.moved = false;
    n.headP.rotation.set(rand(-0.3, 0.4), rand(-0.6, 0.6), rand(-0.9, 0.9));
    n.aL.rotation.set(rand(-2.6, 0.2), 0, rand(-0.5, 0.2));
    n.aR.rotation.set(rand(-2.6, 0.2), 0, rand(-0.2, 0.5));
    if (d < 10) { SFX.sting(); S.fear = Math.min(100, S.fear + 25); }
    if (!n.seenOnce) { n.seenOnce = true; showMsg('Siostra rusza się tylko, gdy na nią nie patrzysz…', '#ff8787', 4500); }
  }
  if (d < 1.15) {
    hurt(45, 'Siostra cię dopadła.', 'nurse');
    g.position.set(n.sx, ly, n.sz); n.stun = 5; n.moved = true;
  }
}

// the Crawler is blind: sprinting carries far, walking only close by, standing still is safe
function updateCrawler(dt, inside) {
  const c = CRAWLER, g = c.g, pp = player.position, ly = LEVEL_Y[c.level];
  if (c.state === 'dead') {
    if (c.dead < 1) { c.dead += dt; g.rotation.z = Math.min(1, c.dead * 2) * Math.PI * 0.9; }
    return;
  }
  const onLevel = inside && playerLevel() === c.level;
  const dx = pp.x - g.position.x, dz = pp.z - g.position.z, d = Math.hypot(dx, dz);
  const heardFrom = !onLevel ? 0 : pSprinting ? 18 : pMoving ? 6 : 0;
  if (d < heardFrom) {
    if (c.state !== 'hunt') { SFX.crawlerShriek(screenPan(-dx, -dz)); S.fear = Math.min(100, S.fear + 25); }
    c.state = 'hunt'; c.tx = pp.x; c.tz = pp.z; c.t = 2.5;
  }
  const torchNear = onLevel && S.torchLit && d < 4;
  let speed = 0, tx = c.tx, tz = c.tz;
  if (torchNear) { tx = g.position.x - dx; tz = g.position.z - dz; speed = 3; }
  else if (c.state === 'hunt') {
    speed = 7 * DF.speed; c.t -= dt;
    if (c.t <= 0 || Math.hypot(c.tx - g.position.x, c.tz - g.position.z) < 0.6) { c.state = 'listen'; c.t = rand(1.5, 3); }
  } else if (c.state === 'listen') {
    c.t -= dt; if (c.t <= 0) { c.state = 'idle'; c.t = 0; }
  } else {
    c.t -= dt; speed = 0.9;
    if (c.t <= 0) {
      c.t = rand(3, 6);
      c.tx = hx(clamp(c.home[0] + rand(-6, 6), -W + 1, W - 1));
      c.tz = hz(clamp(c.home[1] + rand(-6, 6), -D + 1, D - 1));
    }
    tx = c.tx; tz = c.tz;
  }
  const mx = tx - g.position.x, mz = tz - g.position.z, ml = Math.hypot(mx, mz);
  if (speed > 0 && ml > 0.1 && (torchNear || !onLevel || d > 0.9)) {
    let nx = g.position.x + mx / ml * speed * dt, nz = g.position.z + mz / ml * speed * dt;
    [nx, nz] = collideWalls(nx, nz, 0.45, ly);
    g.position.set(clamp(nx, hx(-W + 0.6), hx(W - 0.6)), ly, clamp(nz, hz(-D + 0.6), hz(D - 0.6)));
    let dr = Math.atan2(mx, mz) - g.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    g.rotation.y += dr * Math.min(1, dt * 8);
  }
  c.anim += dt * (speed + 0.5) * 2.5;
  c.limbs.forEach((l, i) => { l.rotation.x = Math.sin(c.anim + i * 1.6) * 0.5; });
  c.head.rotation.z = Math.sin(c.anim * 0.5) * 0.3;
  c.head.rotation.y = c.state === 'listen' ? Math.sin(S.totalTime * 3) * 0.6 : 0;
  c.hitCD -= dt;
  if (onLevel && d < 1.3 && c.hitCD <= 0 && !torchNear) {
    c.hitCD = 1.6; c.state = 'listen'; c.t = 2;
    hurt(30, 'Coś w piwnicy usłyszało twoje kroki.', 'crawler');
  }
  c.clickT -= dt;
  if (c.clickT <= 0) {
    c.clickT = c.state === 'hunt' ? 0.12 : rand(0.6, 1.4);
    if (onLevel && d < 16) SFX.click2(screenPan(-dx, -dz), clamp(1 - d / 16, 0.1, 1));
  }
}

function collide(x, z, r) {
  for (const t of trees) {
    if (!t.alive && t.fall > 0.2) continue;
    const dx = x - t.x, dz = z - t.z;
    if (Math.abs(dx) > 2 || Math.abs(dz) > 2) continue;
    const rr = 0.5 * t.s + r, d = Math.hypot(dx, dz);
    if (d < rr && d > 0.0001) { x = t.x + dx / d * rr; z = t.z + dz / d * rr; }
  }
  for (const b of bushes) {
    const dx = x - b.x, dz = z - b.z, d = Math.hypot(dx, dz), rr = 0.75 + r;
    if (d < rr && d > 0.0001) { x = b.x + dx / d * rr; z = b.z + dz / d * rr; }
  }
  return collideWalls(x, z, r, player.position.y);
}

const fearEl = $('fear'), flashEl = $('flash');
const barEls = {};
for (const k of ['hp', 'hunger', 'warmth', 'stamina', 'battery']) {
  const el = $('b-' + k);
  barEls[k] = { el, fill: el.querySelector('.fill'), val: el.querySelector('.val') };
}
function updateHUD() {
  for (const k in barEls) {
    const v = clamp(S[k], 0, 100), b = barEls[k];
    b.fill.style.width = v + '%';
    b.val.textContent = Math.round(v);
    b.el.classList.toggle('low', v < 20 && k !== 'stamina');
  }
  $('wood').textContent = S.wood;
  $('berries').textContent = S.berries;
  $('torches').textContent = S.torches;
  $('torchTime').textContent = S.torchLit ? ` 🔥${Math.ceil(S.torchTime)}s` : '';
  $('healS').textContent = S.healSyr;
  $('poisonS').textContent = S.poisonSyr;
  if (TOUCH) { $('tHeal').classList.toggle('off', S.healSyr <= 0); $('tStab').classList.toggle('off', S.poisonSyr <= 0); }
  $('clock').textContent = fmtClock(S.mins);
  const hint = $('hint');
  let txt = '';
  if (target) {
    const o = target.obj;
    if (target.type === 'tree') txt = `${KEY_E}Zetnij drzewo  ${'▮'.repeat(o.hp)}${'▯'.repeat(3 - o.hp)}`;
    else if (target.type === 'bush') txt = KEY_E + 'Zbierz jagody';
    else if (target.type === 'battery') txt = KEY_E + 'Podnieś baterię';
    else if (target.type === 'syringe') txt = KEY_E + 'Podnieś strzykawkę — co w niej jest?';
    else if (target.type === 'fire') {
      txt = S.wood > 0 ? `${KEY_E}Dorzuć drewno (ogień: ${Math.max(0, Math.ceil(o.fuel))} s)` : `Ogień: ${Math.max(0, Math.ceil(o.fuel))} s — potrzebujesz drewna`;
      if (S.torches > 0 && !S.torchLit && o.fuel > 0) txt += `  ·  ${KEY_T}odpal pochodnię`;
    }
  }
  hint.style.display = txt ? 'block' : 'none';
  hint.textContent = txt;
}

function update(dt) {
  S.totalTime += dt;
  S.mins += dt * GAME_MIN_PER_SEC;
  if (S.mins >= NIGHT_END) { winNight(); return; }
  const hrs = hourIndex();

  // --- movement
  const f = forward2();
  const rx = -Math.cos(yaw), rz = Math.sin(yaw);
  let mx = 0, mz = 0;
  const fw = clamp((keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - joy.y, -1, 1);
  const st = clamp((keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x, -1, 1);
  mx = f.x * fw + rx * st; mz = f.z * fw + rz * st;
  const ml = Math.hypot(mx, mz);
  const moving = ml > 0.01;
  let sprinting = moving && (keys.ShiftLeft || keys.ShiftRight || Math.hypot(joy.x, joy.y) > 0.92) && S.stamina > 1;
  if (sprinting) S.stamina = Math.max(0, S.stamina - 24 * dt);
  else S.stamina = Math.min(100, S.stamina + (moving ? 10 : 18) * dt);
  const speed = sprinting ? 8.6 : 5;
  pMoving = moving; pSprinting = sprinting;
  if (moving) {
    mx /= ml; mz /= ml;
    let nx = player.position.x + mx * speed * dt, nz = player.position.z + mz * speed * dt;
    [nx, nz] = collide(nx, nz, 0.45);
    const r = Math.hypot(nx, nz);
    if (r > WORLD - 2) {
      nx *= (WORLD - 2) / r; nz *= (WORLD - 2) / r;
      if (!boundaryWarned) { boundaryWarned = true; showMsg('Mgła jest tu zbyt gęsta. Lepiej zawrócić…', '#9aa'); SFX.whisper(0); }
    }
    player.position.x = nx; player.position.z = nz;
    const targetRot = Math.atan2(mx, mz);
    let dr = targetRot - player.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    player.rotation.y += dr * Math.min(1, dt * 12);
    walkPhase += dt * (sprinting ? 13 : 9);
    stepT -= dt * (sprinting ? 1.7 : 1);
    if (stepT <= 0 && onGround) { stepT = 0.42; SFX.step(); }
  } else {
    walkPhase *= 0.85;
  }
  const gy = groundAt(player.position.x, player.position.z, player.position.y);
  if (keys.Space && onGround) { velY = 9.5; onGround = false; }
  if (onGround && player.position.y - gy < 0.6) { player.position.y = gy; velY = 0; } // follow floors and stairs
  else {
    velY -= 28 * dt;
    player.position.y += velY * dt;
    if (player.position.y <= gy) { player.position.y = gy; velY = 0; onGround = true; } else onGround = false;
  }
  const inside = inHospital(player.position.x, player.position.z, -0.2);
  if (inside && !S.enteredHosp) { S.enteredHosp = true; showMsg('Opuszczony szpital. Coś tu chodzi po korytarzach…', '#ff8787', 4000); }
  const lvlNow = inside ? playerLevel() : 1;
  if (lvlNow === 0 && !S.enteredCellar) { S.enteredCellar = true; showMsg('Piwnica. Coś tu nasłuchuje… nie biegaj.', '#ff8787', 4500); }
  if (lvlNow === 2 && !S.enteredUpper) { S.enteredUpper = true; showMsg('Pierwsze piętro. Ciii…', '#ff8787', 3500); }

  // limbs
  const sw = moving ? Math.sin(walkPhase) * (sprinting ? 1.0 : 0.7) : 0;
  legL.rotation.x = sw; legR.rotation.x = -sw;
  armL.rotation.x = S.torchLit ? -1.45 + sw * 0.1 : -sw * 0.8;
  armSwing = Math.max(0, armSwing - dt * 3.5);
  // right arm: holds flashlight forward, chop swing overrides
  const aimPitch = clamp(-pitch, -0.6, 0.9);
  armR.rotation.x = armSwing > 0 ? -2.6 * Math.sin(armSwing * Math.PI) : -1.35 + aimPitch * 0.5 + sw * 0.1;
  // face the look direction while standing still
  if (!moving) {
    let dr = yaw - player.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    if (Math.abs(dr) > 0.6) player.rotation.y += dr * Math.min(1, dt * 5);
  }

  // --- interaction
  interactCD -= dt;
  target = findTarget();
  if (keys.KeyE) interact();

  // --- stats
  S.hunger = Math.max(0, S.hunger - dt * 100 / 300 * (sprinting ? 1.5 : 1) * DF.drain);
  const nf = nearestLitFire(player.position.x, player.position.z);
  const nearFire = nf && nf.d < 6;
  if (nearFire) S.warmth = Math.min(100, S.warmth + 14 * dt);
  else if (S.torchLit) S.warmth = Math.min(100, S.warmth + 2.5 * dt);
  else S.warmth = Math.max(0, S.warmth - dt * 100 / (150 - hrs * 6) * (sprinting ? 0.7 : 1) * (inside ? 0.5 : 1) * DF.drain);
  if (S.hunger <= 0) S.hp -= 1.6 * dt;
  if (S.warmth <= 0) S.hp -= 2.2 * dt;
  if (S.hunger > 40 && S.warmth > 40) S.hp = Math.min(100, S.hp + 0.6 * dt);
  if (S.flash && S.battery > 0) S.battery = Math.max(0, S.battery - dt * 100 / 110 * DF.battery);
  if (S.battery <= 0 && S.flash) { S.flash = false; showMsg('Latarka zgasła…', '#fcc419'); SFX.click(); }
  if (S.hp <= 0 && !S.over) { gameOver(S.totalTime - S.hurtAt < 2 ? S.hurtCause : S.warmth <= 0 ? 'Zamarzłeś/aś w ciemności.' : S.hunger <= 0 ? 'Głód cię pokonał.' : 'Las cię pochłonął.'); return; }

  // --- trees animation
  for (const t of trees) {
    if (t.shake <= 0 && (t.fall <= 0 || t.fall >= 1.8)) continue;
    if (t.shake > 0) t.shake = Math.max(0, t.shake - dt * 3);
    if (t.fall > 0 && t.fall < 1.8) t.fall = Math.min(1.8, t.fall + dt * (t.fall < 1 ? 1.1 : 0.7));
    setTreeMatrix(t);
    treeMeshes.forEach(m => m.instanceMatrix.needsUpdate = true);
  }

  // --- fires
  crackleT -= dt;
  for (const fi of fires) {
    const lit = fi.fuel > 0;
    if (lit) fi.fuel -= dt;
    const k = clamp(fi.fuel / 30, 0.35, 1);
    fi.flames.forEach((fl, i) => {
      fl.visible = lit;
      const s = (1 + Math.sin(S.totalTime * (8 + i * 3) + i) * 0.15 + Math.random() * 0.12) * k;
      fl.scale.set(1, s * (1.2 - i * 0.1), 1);
      fl.position.y = 0.1 + s * 0.6;
      fl.rotation.y = S.totalTime * (i % 2 ? 1.5 : -1.2);
    });
    fi.embers.forEach(e => {
      e.visible = lit;
      e.userData.t += dt;
      if (e.userData.t > 2) { e.userData.t = 0; e.userData.x = rand(-.3, .3); e.userData.z = rand(-.3, .3); }
      e.position.set(e.userData.x + Math.sin(e.userData.t * 3) * 0.2, 0.4 + e.userData.t * 1.6, e.userData.z);
    });
    if (fi.light) fi.light.intensity = lit ? (32 + Math.sin(S.totalTime * 13) * 4 + Math.random() * 6) * k : 0;
    if (lit && crackleT <= 0) {
      const d = Math.hypot(fi.x - player.position.x, fi.z - player.position.z);
      if (d < 14) SFX.crackle(1 - d / 14);
    }
  }
  if (crackleT <= 0) crackleT = rand(0.05, 0.25);

  // --- batteries bob
  for (const b of batteries) if (!b.taken) {
    b.g.rotation.y += dt * 1.5;
    b.g.position.y = b.y + 0.55 + Math.sin(S.totalTime * 2 + b.g.userData.phase) * 0.12;
  }

  // --- torch
  if (S.torchLit) {
    S.torchTime -= dt;
    if (S.torchTime <= 0) {
      S.torchLit = false; SFX.hiss();
      showMsg(S.torches > 0 ? 'Pochodnia zgasła. Odpal kolejną przy ognisku.' : 'Pochodnia zgasła.', '#ffb36b');
    }
  }
  handTorch.visible = S.torchLit;
  if (S.torchLit) {
    const fade = S.torchTime < 10 ? 0.4 + S.torchTime / 16 : 1;
    torchFlames.forEach((fl, i) => fl.scale.set(1, (0.8 + Math.random() * 0.4 + Math.sin(S.totalTime * 15 + i) * 0.15) * fade, 1));
    torchFlames[0].getWorldPosition(torchLight.position);
    torchLight.intensity = (18 + Math.random() * 5) * fade;
    if (Math.random() < dt * 4) SFX.crackle(0.5);
  } else torchLight.intensity = 0;

  // --- hospital lamps (real lights only on your storey) + beacon
  if (Math.abs(player.position.x - HOSP.x) < 60 && Math.abs(player.position.z - HOSP.z) < 60) {
    for (const row of lampFix) for (const L of row) {
      L.t -= dt;
      if (L.t <= 0) {
        L.on = !L.on;
        L.t = L.on ? rand(0.5, L.lvl === 0 ? 1.5 : 4) : rand(0.03, L.lvl === 0 ? 2 : 0.5);
        if (inside && L.lvl === lvlNow && Math.random() < 0.5) SFX.flick();
      }
      L.m.material.color.setHex(L.on ? (L.lvl === 0 ? 0xff4030 : 0xdff2ff) : 0x222222);
    }
    lampFix[lvlNow].forEach((L, i) => {
      const l = lampLights[i];
      l.position.set(hx(L.x), LEVEL_Y[lvlNow] + LV - 0.9, hz(L.z));
      l.color.setHex(lvlNow === 0 ? 0xff3a2a : 0xcfe6ff);
      l.intensity = L.on ? (lvlNow === 0 ? 9 : 14) + Math.random() * 3 : 0;
    });
  }
  beaconMat.color.setHex(Math.random() < 0.015 ? 0x300000 : 0xc01010);

  // --- camera
  const cp = Math.cos(pitch);
  const fx = Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = Math.cos(yaw) * cp;
  const tgt = _v.set(player.position.x + rx * 0.9, player.position.y + 2.5, player.position.z + rz * 0.9);
  camera.position.set(tgt.x - fx * camDist, Math.max(player.position.y + 0.4, tgt.y - fy * camDist), tgt.z - fz * camDist);
  if (inHospital(player.position.x, player.position.z, 8)) {
    // keep the camera on the player's side of hospital walls and under the ceiling of this storey
    const px = player.position.x, pz = player.position.z, py = tgt.y;
    const t = rayT(px, pz, camera.position.x, camera.position.z, 0.25, player.position.y + 1.5);
    if (t < 1) {
      const k = Math.max(0.02, t - 0.03);
      camera.position.set(px + (camera.position.x - px) * k, py + (camera.position.y - py) * k, pz + (camera.position.z - pz) * k);
    }
    if (inside || inHospital(camera.position.x, camera.position.z)) {
      const lb = LEVEL_Y[playerLevel()];
      camera.position.y = clamp(camera.position.y, lb + 0.5, lb + LV - 0.45);
    }
  }
  if (shake > 0) {
    camera.position.x += rand(-1, 1) * shake; camera.position.y += rand(-1, 1) * shake;
    shake = Math.max(0, shake - dt * 1.2);
  }
  camera.lookAt(tgt.x + fx * 4, tgt.y + fy * 4, tgt.z + fz * 4);
  const wantFov = 70 + (sprinting ? 8 : 0) + S.fear * 0.06;
  camera.fov = lerp(camera.fov, wantFov, dt * 5); camera.updateProjectionMatrix();

  // --- flashlight
  const hand = new THREE.Vector3(0, -0.95, 0.4);
  armR.localToWorld(hand);
  flashlight.position.copy(hand);
  flashlight.target.position.set(camera.position.x + fx * 30, camera.position.y + fy * 30 + 0.5, camera.position.z + fz * 30);
  let fi = S.flash && S.battery > 0 ? 160 : 0;
  if (S.battery < 15 && Math.random() < 0.08) { fi *= 0.15; }
  if (flickerT > 0) { flickerT -= dt; if (Math.random() < 0.5) fi *= 0.05; if (Math.random() < 0.1) SFX.flick(); }
  flashlight.intensity = fi;
  torchLens.material.color.setHex(fi > 0 ? 0xfff3c4 : 0x333333);
  if (TOUCH) $('tFlash').classList.toggle('off', !(S.flash && S.battery > 0));
  selfLight.position.set(player.position.x, player.position.y + 2.6, player.position.z);

  // --- monster & horror
  updateMonster(dt);
  updateWatchers(dt);
  updatePatients(dt, inside);
  updateNurse(dt, inside);
  updateCrawler(dt, inside);

  // fear
  let fearT = 8;
  if (!(S.flash && S.battery > 0)) fearT += 25;
  if (nf && nf.d < FIRE_R) fearT -= 20;
  const md = monster.position.distanceTo(player.position);
  if (M.state === 'hunt') fearT += clamp(90 - md * 2, 30, 90);
  if (M.state === 'stalk' && M.seen) fearT += 30;
  if (S.hp < 30) fearT += 15;
  if (inside) fearT += 12;
  if (patients.some(p => p.state === 'chase')) fearT += 25;
  if (inside && NURSE.g.position.distanceTo(player.position) < 8) fearT += 25;
  if (CRAWLER.state === 'hunt') fearT += 30;
  if (lvlNow === 0) fearT += 8;
  if (S.torchLit) fearT -= 10;
  S.fear = lerp(S.fear, clamp(fearT, 0, 100), dt * (fearT > S.fear ? 1.5 : 0.35));
  fearEl.style.opacity = (S.fear / 100) * 0.85;
  if (fearGain) fearGain.gain.setTargetAtTime(Math.max(0, S.fear - 45) / 55 * 0.035, AC.currentTime, 0.3);
  heartT -= dt;
  if (heartT <= 0 && S.fear > 30) { SFX.heart(clamp(S.fear / 100, 0.3, 1)); heartT = lerp(1.3, 0.38, S.fear / 100); }

  // ambience
  ambT -= dt;
  if (ambT <= 0) {
    ambT = rand(7, 16) / Math.sqrt(aggression());
    const r = Math.random(), pan = rand(-1, 1);
    if (inside) {
      ambT = rand(3, 8);
      if (r < 0.35) SFX.drip(); else if (r < 0.6) SFX.clank(pan); else if (r < 0.8) SFX.whisper(pan); else SFX.creak(pan, 0.4);
    }
    else if (r < 0.3) SFX.twig(pan);
    else if (r < 0.5) SFX.owl(pan);
    else if (r < 0.72) SFX.whisper(pan);
    else if (r < 0.85) SFX.howl(pan);
    else SFX.scream(pan * 0.3), (M.state === 'away' && (M.timer = Math.min(M.timer, 6)));
  }

  // --- sky / dawn
  const dawnK = clamp((S.mins - 29 * 60) / 60, 0, 1);
  scene.fog.color.copy(NIGHT_FOG).lerp(DAWN_FOG, dawnK);
  scene.background.copy(scene.fog.color);
  scene.fog.density = lerp(0.05, 0.022, dawnK);
  ambient.intensity = lerp(0.7, 1.8, dawnK);
  moonLight.intensity = lerp(0.35, 1.3, dawnK);
  moonLight.color.setHex(0x8fa3d6).lerp(new THREE.Color(0xffc49a), dawnK);
  stars.material.opacity = 0.8 * (1 - dawnK);
  // the hospital is much darker inside: only lamps, flashlight and torch
  insideK = lerp(insideK, inside ? 1 : 0, Math.min(1, dt * 3));
  ambient.intensity *= 1 - 0.65 * insideK;
  moonLight.intensity *= 1 - 0.9 * insideK;
  if (lvlNow === 0) ambient.intensity *= 0.55; // the basement is darker still
  if (windGain) windGain.gain.setTargetAtTime(0.16 + S.fear * 0.0012, AC.currentTime, 0.5);
  if (dawnK > 0 && S.dawnMsg !== S.night) { S.dawnMsg = S.night; showMsg('Niebo zaczyna szarzeć… jeszcze trochę.', '#ffd9a0', 4000); }

  // hour announcements
  const h = Math.floor(S.mins / 60);
  if (S.lastHour !== h) {
    if (S.lastHour !== undefined && h % 24 === 0) showMsg('Północ. Las budzi się.', '#ff6b6b', 3500);
    if (S.lastHour !== undefined && h % 24 === 3) showMsg('3:00 — godzina Stwora.', '#ff4d4d', 3500);
    S.lastHour = h;
  }
}

// ===================================================================
// Loop
// ===================================================================
let last = performance.now(), grainT = 0;
player.position.set(0, 0, 0);
camera.position.set(0, 3, -6);
camera.lookAt(0, 2, 0);
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.playing) {
    update(dt);
    updateHUD();
  } else if (!S.started) {
    // menu: slow orbit
    const t = now * 0.00006;
    camera.position.set(Math.sin(t) * 14, 4, Math.cos(t) * 14);
    camera.lookAt(0, 2.5, 0);
    flashlight.position.set(0, 2, 0); flashlight.target.position.set(Math.sin(t * 3) * 10, 1, Math.cos(t * 3) * 10);
  }
  grainT -= dt;
  if (grainT <= 0) { drawGrain(); grainT = 0.05; }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

})();
