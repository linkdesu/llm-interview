/* ============================================================
   City Time Machine — 3D diorama + lo-fi soundtrack
   ------------------------------------------------------------
   Sections:
     1. Imports & bootstrap
     2. Utility helpers (colors, noise, rng)
     3. Scene / camera / renderer setup
     4. Orbit controls (custom, no external addon dependency)
     5. The diorama world (ground, roads, buildings, props)
     6. Materials & emissive windows
     7. Lighting + day/night sky system
     8. Animated props (cars, people, clouds, steam)
     9. Raycasting / building info
     10. Web Audio lo-fi soundtrack engine
     11. UI wiring + clock
     12. Animation loop
   ============================================================ */

import * as THREE from "three";

/* ---------- 1. Bootstrap ---------- */

const container = document.getElementById("scene-container");
const startOverlay = document.getElementById("start-overlay");
const enterBtn = document.getElementById("enter-btn");

// Public state (exposed for debugging / self-test)
const AppState = {
  audioPlaying: false,
  orbitEnabled: true,
  timeOfDay: 0.65, // 0 = midnight, 0.5 = noon, 1 = midnight
  isStarted: false,
  selectedBuilding: null,
};
window.__cityTimeMachine = AppState;

// Core objects (filled in setup)
let scene, camera, renderer, controls;
let worldGroup;          // holds all diorama content, rotates for orbit
let skyDome, stars;
let sunLight, moonLight, ambientLight, hemiLight;
let emissiveWindows = []; // {mesh, baseIntensity, targetIntensity}
let animatedProps = [];   // {update(dt)}
let audioCtx = null;
let audioNodes = {};
const clock = new THREE.Clock();

/* ---------- 2. Utility helpers ---------- */

// Deterministic-ish random for varied but stable props
function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// Smooth interpolation helper
const lerp = (a, b, t) => a + (b - a) * t;

// Convert hex color to three color
function hex(h) {
  return new THREE.Color(h);
}

// Light warm/cool tone based on time of day (see 7)
function warmTint(t) {
  return new THREE.Color().setHSL(0.09, 0.7, 0.55 + t * 0.1);
}

/* ---------- 3. Scene / camera / renderer ---------- */

function setupRenderer() {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
}

function setupScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x2a2135, 0.012);

  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    500
  );
  camera.position.set(22, 18, 26);

  worldGroup = new THREE.Group();
  scene.add(worldGroup);
}

/* ---------- 4. Orbit controls (custom) ---------- */
// Lightweight orbit + zoom with damping. See orbitControls.js logic inline.

function initControls() {
  controls = new OrbitController(camera, renderer.domElement);
  controls.target.set(0, 2, 0);
  controls.minDistance = 8;
  controls.maxDistance = 60;
  controls.maxPolarAngle = Math.PI * 0.49; // don't go below ground
  controls.enableDamping = true;
  controls.damping = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;
}

/* ---------- 5. Build the world ---------- */

function buildWorld() {
  buildGround();
  buildRoads();
  buildBlockBase();
  buildBuildings();
  buildStorefronts();
  buildProps();
  buildTrees();
  buildStreetLights();
  buildCars();
  buildPeople();
  buildClouds();
  buildSteam();
}

function buildGround() {
  // Soft grassy base platform (the diorama "ground")
  const geo = new THREE.CircleGeometry(40, 96);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3a5a3a,
    roughness: 0.95,
    metalness: 0.0,
  });
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  worldGroup.add(ground);
}

function buildBlockBase() {
  // Raised platform edge so it reads as a "miniature diorama"
  const baseGeo = new THREE.CylinderGeometry(38, 39, 2, 96);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x4a3f52, roughness: 0.9 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = -1;
  base.receiveShadow = true;
  base.castShadow = true;
  worldGroup.add(base);
}

function buildRoads() {
  // A simple grid of roads cutting through the block
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.85 });

  const road = (x, z, w, d) => {
    const g = new THREE.BoxGeometry(w, 0.06, d);
    const m = new THREE.Mesh(g, roadMat);
    m.position.set(x, 0.03, z);
    m.receiveShadow = true;
    worldGroup.add(m);
  };
  // Horizontal and vertical roads forming a grid
  road(0, 0, 80, 6);
  road(0, 0, 6, 80);
  road(16, 12, 30, 6);
  road(12, 16, 6, 30);

  // Sidewalk curbs alongside roads (subtle raised edges)
  const curbMat = new THREE.MeshStandardMaterial({ color: 0x6b6458, roughness: 0.9 });
  const curb = (x, z, w, d) => {
    const g = new THREE.BoxGeometry(w, 0.14, d);
    const m = new THREE.Mesh(g, curbMat);
    m.position.set(x, 0.07, z);
    m.receiveShadow = true;
    worldGroup.add(m);
  };
  curb(0, 3.3, 80, 0.4);
  curb(0, -3.3, 80, 0.4);
  curb(3.3, 0, 0.4, 80);
  curb(-3.3, 0, 0.4, 80);
}

/* ---------- 5b. Buildings ---------- */

// Palettes for cozy building facades
const FACADE_COLORS = [
  0xd9a87c, // warm sand
  0xc97f6a, // terracotta
  0xbfa07a, // taupe
  0x9d7c6a, // brown
  0xcaa48c, // pale clay
  0xb05a4a, // rust
  0x8f9c86, // sage
  0xb8896b, // tan
];

// Per-building info for the info card
const BUILDING_INFO = [
  { name: "Corner Cafe", desc: "Warm espresso and fresh pastries. The best window seat in town." },
  { name: "The Book Nook", desc: "A tiny used bookstore with a sleeping cat by the door." },
  { name: "Sunflower Bakery", desc: "Fresh bread at dawn. The bell above the ring is always cheerful." },
  { name: "Vintage Records", desc: "Crackling vinyl and fuzzy lamp light. Listen before you buy." },
  { name: "Little Florist", desc: "Bouquets for every mood. Peonies arrive every Tuesday." },
  { name: "Moonlight Studio", desc: "An artist's loft above a quiet gallery. Open on rainy days." },
  { name: "The Cozy Den", desc: "A knitwear shop. Sweaters that smell like woodsmoke." },
  { name: "Harvest Kitchen", desc: "Soups of the day. The regulars know the schedule." },
];

function buildBuildings() {
  const infoRng = rng(99);

  // Building footprint layout: [x, z, width, depth, floors]
  // Roads are at x=0, z=0, x=16, z=12. Place buildings in the 4 quadrants.
  const layout = [
    { x: -12, z: -12, w: 9, d: 9, floors: 5 },
    { x: -12, z: 20, w: 9, d: 9, floors: 4 },
    { x: -12, z: -30, w: 9, d: 9, floors: 6 },
    { x: 24, z: -12, w: 9, d: 10, floors: 4 },
    { x: 24, z: 20, w: 9, d: 9, floors: 5 },
    { x: 24, z: -30, w: 10, d: 9, floors: 3 },
    { x: -30, z: -12, w: 9, d: 9, floors: 4 },
    { x: -30, z: 20, w: 9, d: 9, floors: 3 },
  ];

  layout.forEach((b, i) => {
    const info = BUILDING_INFO[i % BUILDING_INFO.length];
    const building = createShop(b, FACADE_COLORS[i % FACADE_COLORS.length], info, i);
    worldGroup.add(building);
  });
}

// Build a single cozy shop with body, roof, windows, door, sign
function createShop(b, facadeColor, info, idx) {
  const group = new THREE.Group();
  group.position.set(b.x, 0, b.z);

  const floors = b.floors;
  const floorH = 2.0;
  const height = floors * floorH;
  const overhang = 0.5; // roof overhang

  // Body
  const bodyMat = new THREE.MeshStandardMaterial({
    color: facadeColor,
    roughness: 0.85,
    metalness: 0.02,
  });
  const bodyGeo = new THREE.BoxGeometry(b.w, height, b.d);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Roof cap (slightly larger, darker)
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x5a463a, roughness: 0.9 });
  const roofGeo = new THREE.BoxGeometry(b.w + overhang * 2, 0.5, b.d + overhang * 2);
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.y = height + 0.25;
  roof.castShadow = true;
  group.add(roof);

  // A little chimney
  if (idx % 2 === 0) {
    const chimGeo = new THREE.BoxGeometry(0.8, 1.6, 0.8);
    const chimney = new THREE.Mesh(chimGeo, roofMat);
    chimney.position.set(b.w * 0.25, height + 1.0, b.d * 0.25);
    chimney.castShadow = true;
    group.add(chimney);
  }

  // Windows grid on each visible face (emissive at night)
  addWindows(group, b, height, floorH, facadeColor);

  // Ground-floor storefront (glass front) with warm glow
  addStorefront(group, b, facadeColor);

  // Awning over the storefront
  addAwning(group, b);

  // Signboard
  addSign(group, b, info.name);

  // Mark for raycasting
  group.userData = { isBuilding: true, info };
  return group;
}

// Emissive windows across all floors and both front/back and sides
function addWindows(group, b, height, floorH, facadeColor) {
  const winMat = new THREE.MeshStandardMaterial({
    color: 0x222233,
    emissive: 0x000000,
    emissiveIntensity: 1,
    roughness: 0.3,
    metalness: 0.2,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.7 });

  const winW = 1.1, winH = 1.1;
  const inset = 0.06;

  // Place windows on each of the four faces
  const placeFace = (face, countX, baseY) => {
    const spacingX = (face === "front" || face === "back") ? b.w : b.d;
    const n = countX;
    for (let i = 0; i < n; i++) {
      const x = -spacingX / 2 + (spacingX / (n + 1)) * (i + 1);
      const win = new THREE.Mesh(new THREE.BoxGeometry(winW, winH, 0.1), winMat.clone());
      const frame = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.25, winH + 0.25, 0.06), frameMat);
      frame.position.y = 0;
      win.add(frame);
      win.position.y = baseY;
      if (face === "front") win.position.set(x, baseY, b.d / 2 + inset);
      else if (face === "back") win.position.set(x, baseY, -b.d / 2 - inset);
      else if (face === "left") {
        win.rotation.y = Math.PI / 2;
        win.position.set(-b.w / 2 - inset, baseY, x);
        frame.rotation.y = Math.PI / 2;
      } else {
        win.rotation.y = -Math.PI / 2;
        win.position.set(b.w / 2 + inset, baseY, x);
        frame.rotation.y = Math.PI / 2;
      }
      group.add(win);
      emissiveWindows.push({ mesh: win, baseIntensity: 0.05, targetIntensity: 1.4 });
    }
  };

  for (let f = 0; f < floors; f++) {
    const baseY = floorH * f + floorH * 0.55 + 0.6;
    placeFace("front", 3, baseY);
    placeFace("back", 3, baseY);
    placeFace("left", 2, baseY);
    placeFace("right", 2, baseY);
  }
}

// Warm glass storefront on the ground floor front
function addStorefront(group, b, facadeColor) {
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a24,
    emissive: 0x000000,
    emissiveIntensity: 1,
    roughness: 0.15,
    metalness: 0.4,
  });
  const glassH = 1.6;
  const glass = new THREE.Mesh(new THREE.BoxGeometry(b.w - 1.2, glassH, 0.1), glassMat);
  glass.position.set(0, 0.9, b.d / 2 + 0.02);
  group.add(glass);
  emissiveWindows.push({ mesh: glass, baseIntensity: 0.1, targetIntensity: 1.8 });

  // Door
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.7 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 0.1), doorMat);
  door.position.set(0, 0.8, b.d / 2 + 0.04);
  group.add(door);

  // A small warm point light inside the store (glow)
  const glow = new THREE.PointLight(0xffcf99, 0.6, 8, 2);
  glow.position.set(0, 1.3, b.d / 2 + 1);
  group.add(glow);
}

// Striped awning over the storefront
function addAwning(group, b) {
  const awningMat = new THREE.MeshStandardMaterial({ color: 0x9b3b2f, roughness: 0.8 });
  const awning = new THREE.Mesh(new THREE.BoxGeometry(b.w - 0.6, 0.15, 1.3), awningMat);
  awning.position.set(0, 1.85, b.d / 2 + 0.65);
  awning.rotation.x = -0.18;
  awning.castShadow = true;
  group.add(awning);

  // Scalloped front edge (simple boxes)
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xd9a06b, roughness: 0.8 });
  const n = Math.max(3, Math.floor((b.w - 0.6) / 0.9));
  const step = (b.w - 0.6) / n;
  for (let i = 0; i < n; i++) {
    const tri = new THREE.Mesh(new THREE.BoxGeometry(step, 0.25, 0.12), edgeMat);
    tri.position.set(-(b.w - 0.6) / 2 + step * (i + 0.5), 1.72, b.d / 2 + 1.28);
    tri.rotation.x = -0.18;
    group.add(tri);
  }
}

// Simple signboard above the door
function addSign(group, b, name) {
  const signMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(b.w - 1.6, 0.6, 0.15), signMat);
  sign.position.set(0, 2.35, b.d / 2 + 0.08);
  group.add(sign);
  // Small warm marker light on the sign
  const mkMat = new THREE.MeshBasicMaterial({ color: 0xffd9a8 });
  const mk = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.02), mkMat);
  mk.position.set(b.w / 2 - 1.2, 2.35, b.d / 2 + 0.17);
  group.add(mk);
}

/* ---------- 5c. Storefront props ---------- */
function buildStorefronts() {
  // Planters on the sidewalks
  const planterMat = new THREE.MeshStandardMaterial({ color: 0x5a463a, roughness: 0.9 });
  const plantMat = new THREE.MeshStandardMaterial({ color: 0x4a7a4a, roughness: 0.9 });

  const addPlanter = (x, z) => {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), planterMat);
    pot.position.y = 0.3;
    pot.castShadow = true;
    g.add(pot);
    const bush = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), plantMat);
    bush.position.y = 0.95;
    bush.scale.y = 0.8;
    bush.castShadow = true;
    g.add(bush);
    g.position.set(x, 0, z);
    worldGroup.add(g);
  };

  addPlanter(-7, 6);
  addPlanter(-7, -6);
  addPlanter(7, 6);
  addPlanter(7, -6);
  addPlanter(20, 6);
  addPlanter(20, -6);
}

/* ---------- 5d. Trees ---------- */
function buildTrees() {
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4126, roughness: 0.95 });
  const leafMats = [0x4f7a3f, 0x5c8a47, 0x3f6f35];

  const addTree = (x, z, scale) => {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 2, 7), trunkMat);
    trunk.position.y = 1;
    trunk.castShadow = true;
    g.add(trunk);
    const r = 1.4 * scale;
    for (let i = 0; i < 3; i++) {
      const leaf = new THREE.Mesh(
        new THREE.IcosahedronGeometry(r * (1 - i * 0.18), 0),
        leafMats[i % leafMats.length]
      );
      leaf.position.set((Math.random() - 0.5) * 0.6, 2.2 + i * 0.7 * scale, (Math.random() - 0.5) * 0.6);
      leaf.scale.y = 0.85;
      leaf.castShadow = true;
      g.add(leaf);
    }
    g.position.set(x, 0, z);
    g.scale.setScalar(scale);
    worldGroup.add(g);
  };

  addTree(8.5, 8.5, 1.1);
  addTree(-8.5, 8.5, 0.9);
  addTree(8.5, -8.5, 1.0);
  addTree(-8.5, -8.5, 1.2);
  addTree(28, 8, 0.95);
  addTree(-28, 8, 1.05);
}

/* ---------- 5e. Street lights ---------- */
function buildStreetLights() {
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6, metalness: 0.5 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x30281a, emissive: 0x000000, emissiveIntensity: 1 });

  const addLamp = (x, z) => {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 4, 8), poleMat);
    pole.position.y = 2;
    pole.castShadow = true;
    g.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.12), poleMat);
    arm.position.set(0.6, 3.9, 0);
    g.add(arm);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), lampMat);
    lamp.position.set(1.1, 3.8, 0);
    g.add(lamp);
    const light = new THREE.PointLight(0xffd9a0, 0.0, 10, 2);
    light.position.set(1.1, 3.7, 0);
    g.add(light);
    g.position.set(x, 0, z);
    // store refs for night lighting
    g.userData = { lamp, light };
    animatedProps.push({ type: "lamp", lamp, light });
    worldGroup.add(g);
  };

  addLamp(3.6, 3.6);
  addLamp(-3.6, -3.6);
  addLamp(3.6, 15);
  addLamp(-3.6, 15);
  addLamp(15, 3.6);
  addLamp(15, -3.6);
}

/* ---------- 7. Lighting ---------- */
function setupLighting() {
  // Ambient + hemisphere for soft base illumination
  ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(ambientLight);

  hemiLight = new THREE.HemisphereLight(0xbfd4ff, 0x3a2f2a, 0.5);
  scene.add(hemiLight);

  // Sun / main directional light
  sunLight = new THREE.DirectionalLight(0xffe9c0, 1.4);
  sunLight.position.set(20, 30, 15);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 120;
  const sc = 45;
  sunLight.shadow.camera.left = -sc;
  sunLight.shadow.camera.right = sc;
  sunLight.shadow.camera.top = sc;
  sunLight.shadow.camera.bottom = -sc;
  sunLight.shadow.bias = -0.0004;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // Moon fill light (opposite side, cooler)
  moonLight = new THREE.DirectionalLight(0x8faee0, 0.25);
  moonLight.position.set(-18, 20, -12);
  scene.add(moonLight);
}

/* ---------- Day/night color system ---------- */
// Sky/light keyframes keyed on time-of-day (0=midnight, 0.5=noon)
const SKY_KEYS = [
  { t: 0.0, top: 0x0a0a1e, bot: 0x141428, sun: 0x8faee0, sunI: 0.05, amb: 0x22223a, hemiSky: 0x2a3a5a, hemiGround: 0x1a1420, fog: 0x0c0c1a, ambientI: 0.28 },
  { t: 0.2, top: 0x1a1a3a, bot: 0x3a2a4a, sun: 0xd9a06b, sunI: 0.3, amb: 0x3a3050, hemiSky: 0x4a4a6a, hemiGround: 0x2a2030, fog: 0x241a2e, ambientI: 0.32 },
  { t: 0.35, top: 0x5a6a9a, bot: 0xd99a6a, sun: 0xffcf99, sunI: 0.9, amb: 0x6a5a60, hemiSky: 0x8a9ab0, hemiGround: 0x3a2a2a, fog: 0x5a4a55, ambientI: 0.36 },
  { t: 0.5, top: 0x89b4e0, bot: 0xf0d0a0, sun: 0xfff2d0, sunI: 1.5, amb: 0x8a8070, hemiSky: 0xb0c8e8, hemiGround: 0x4a3a2a, fog: 0x9fb4d0, ambientI: 0.42 },
  { t: 0.65, top: 0x6a8ac0, bot: 0xffb476, sun: 0xffb460, sunI: 1.1, amb: 0x6a5a55, hemiSky: 0x90a8c8, hemiGround: 0x3a2a25, fog: 0x7a6055, ambientI: 0.38 },
  { t: 0.8, top: 0x2a2a50, bot: 0xc96a4a, sun: 0xd96a3f, sunI: 0.4, amb: 0x3a2a40, hemiSky: 0x5a4a6a, hemiGround: 0x2a1a25, fog: 0x3a2530, ambientI: 0.33 },
  { t: 1.0, top: 0x0a0a1e, bot: 0x141428, sun: 0x8faee0, sunI: 0.05, amb: 0x22223a, hemiSky: 0x2a3a5a, hemiGround: 0x1a1420, fog: 0x0c0c1a, ambientI: 0.28 },
];

function lerpColor(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

function interpKeys(keyA, keyB, t) {
  const span = keyB.t - keyA.t;
  const local = (t - keyA.t) / span;
  const sm = local * local * (3 - 2 * local); // smoothstep
  return {
    top: lerpColor(keyA.top, keyB.top, sm),
    bot: lerpColor(keyA.bot, keyB.bot, sm),
    sun: lerpColor(keyA.sun, keyB.sun, sm),
    sunI: lerp(keyA.sunI, keyB.sunI, sm),
    amb: lerpColor(keyA.amb, keyB.amb, sm),
    hemiSky: lerpColor(keyA.hemiSky, keyB.hemiSky, sm),
    hemiGround: lerpColor(keyA.hemiGround, keyB.hemiGround, sm),
    fog: lerpColor(keyA.fog, keyB.fog, sm),
    ambientI: lerp(keyA.ambientI, keyB.ambientI, sm),
  };
}

function dayFactor(t) {
  // peak at 0.5
  return Math.max(0, Math.sin(Math.PI * t));
}

function updateDayNight(t) {
  let i = 0;
  for (let k = 0; k < SKY_KEYS.length - 1; k++) {
    if (t >= SKY_KEYS[k].t && t < SKY_KEYS[k + 1].t) { i = k; break; }
  }
  const keys = interpKeys(SKY_KEYS[i], SKY_KEYS[i + 1], t);
  const df = dayFactor(t);

  // Sky dome gradient (custom shader uniforms)
  if (skyDome) {
    skyDome.material.uniforms.topColor.value.copy(keys.top);
    skyDome.material.uniforms.bottomColor.value.copy(keys.bot);
  }

  // Fog
  scene.fog.color.copy(keys.fog);

  // Lights
  sunLight.color.copy(keys.sun);
  sunLight.intensity = keys.sunI;
  moonLight.intensity = 0.35 - df * 0.3;
  ambientLight.color.copy(keys.amb);
  ambientLight.intensity = keys.ambientI;
  hemiLight.color.copy(keys.hemiSky);
  hemiLight.groundColor.copy(keys.hemiGround);

  // Position sun along an arc based on time of day
  const ang = (t - 0.25) * Math.PI * 2; // sun rises ~0.25, sets ~0.75
  sunLight.position.set(Math.cos(ang) * 35, Math.sin(ang) * 35 + 3, 12);
  sunLight.target.position.set(0, 0, 0);
  moonLight.position.set(-sunLight.position.x, Math.sin(ang) * 25 + 3, -sunLight.position.z);

  // Tone mapping exposure shifts with day brightness
  renderer.toneMappingExposure = 0.9 + df * 0.25;

  // Emissive windows target: bright at night, dim by day
  const nightAmount = 1 - df; // 1 = full night
  for (const w of emissiveWindows) {
    w.targetIntensity = w.baseIntensity + (1.4 - w.baseIntensity) * nightAmount;
  }

  // Street lights + car headlights turn on at night
  const lightsOn = nightAmount > 0.25;
  for (const prop of animatedProps) {
    if (prop.type === "lamp") {
      prop.lamp.material.emissive.setHex(0xffd9a0);
      prop.lamp.material.emissiveIntensity = lightsOn ? 1.4 : 0.05;
      prop.light.intensity = lightsOn ? 1.4 : 0.0;
    }
    if (prop.type === "car") {
      for (const hl of prop.group.userData.headlights) {
        hl.material.color.set(lightsOn ? 0xfff2c0 : 0x444444);
      }
    }
  }

  // Cloud tint with sky
  for (const prop of animatedProps) {
    if (prop.type === "cloud") {
      prop.group.children.forEach((c) => {
        c.material.color.copy(keys.bot).lerp(new THREE.Color(0xffffff), 0.7);
      });
    }
  }
}

/* ---------- Sky dome ---------- */
function buildSky() {
  // Custom gradient sky shader dome
  const skyGeo = new THREE.SphereGeometry(200, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x89b4e0) },
      bottomColor: { value: new THREE.Color(0xf0d0a0) },
      offset: { value: 10 },
      exponent: { value: 0.6 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        float t = max(pow(max(h, 0.0), exponent), 0.0);
        gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
      }`,
  });
  skyDome = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyDome);

  // Star field (visible at night)
  const starCount = 600;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const v = new THREE.Vector3().randomDirection();
    v.y = Math.abs(v.y); // bias upward
    starPos[i * 3] = v.x * 180;
    starPos[i * 3 + 1] = v.y * 180;
    starPos[i * 3 + 2] = v.z * 180;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.7, sizeAttenuation: true, transparent: true, opacity: 0.0 });
  stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);
  window.__stars = starMat;
}

/* ---------- 5f. Animated props ---------- */
function buildProps() {
  // (cars, people, clouds, steam handled in their own functions)
}

/* ---------- 5g. Cars ---------- */
function buildCars() {
  const carColors = [0xc9563f, 0x3f6fb0, 0xd9b44a, 0x4a9d6f, 0xb05a8f, 0x6b5aa0];
  const roadPaths = [
    { axis: "x", pos: 1.6, z: 0, dir: 1, speed: 3 },
    { axis: "x", pos: -1.6, z: 0, dir: -1, speed: 2.6 },
    { axis: "z", pos: 1.6, x: 0, dir: 1, speed: 3.2 },
    { axis: "z", pos: -1.6, x: 0, dir: -1, speed: 2.4 },
    { axis: "x", pos: 13.6, z: 12, dir: 1, speed: 2.8 },
    { axis: "z", pos: 13.6, x: 12, dir: 1, speed: 2.9 },
  ];

  roadPaths.forEach((p, i) => {
    const g = createCar(carColors[i % carColors.length]);
    const range = 34;
    g.userData = {
      axis: p.axis,
      pos: p.pos,
      dir: p.dir,
      speed: p.speed,
      t: Math.random() * range * 2 - range,
      range,
      x0: p.x,
      z0: p.z,
    };
    worldGroup.add(g);
    animatedProps.push({ type: "car", group: g });
  });
}

function createCar(color) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 1.0), bodyMat);
  body.position.y = 0.45;
  body.castShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.42, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x223, roughness: 0.2, metalness: 0.3 })
  );
  cabin.position.set(-0.05, 0.82, 0);
  cabin.castShadow = true;
  g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.16, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 });
  const wheelPos = [[0.7, 0.2, 0.5], [0.7, 0.2, -0.5], [-0.7, 0.2, 0.5], [-0.7, 0.2, -0.5]];
  wheelPos.forEach((wp) => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wp[0], wp[1], wp[2]);
    g.add(w);
  });
  // Headlights (warm glow at night)
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
  const hl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.2), lightMat);
  hl.position.set(1.12, 0.45, 0.35);
  g.add(hl);
  const hl2 = hl.clone();
  hl2.position.z = -0.35;
  g.add(hl2);
  g.userData.headlights = [hl, hl2];
  return g;
}

/* ---------- 5h. People ---------- */
function buildPeople() {
  const outfitColors = [
    [0xb05a4a, 0x3a4a6a], // rust top, denim
    [0x3f6fb0, 0x4a3a2a], // blue top, brown
    [0x4a9d6f, 0x2a2a3a], // green top, dark
    [0xd9b44a, 0x5a3a4a], // gold top, maroon
    [0xb05a8f, 0x2a3a4a], // pink top, teal
    [0x6b5aa0, 0x4a4a2a], // purple top, olive
  ];
  const walkPaths = [
    { x0: -20, x1: 20, z: 5, y: 0.6 },
    { x0: -20, x1: 20, z: -5, y: 0.6 },
    { z0: -20, z1: 20, x: 5, y: 0.6 },
    { z0: -20, z1: 20, x: -5, y: 0.6 },
    { x0: 5, x1: -5, z0: -20, z1: 20, y: 0.6 },
  ];

  walkPaths.forEach((p, i) => {
    const person = createPerson(outfitColors[i % outfitColors.length]);
    person.userData = {
      speed: 0.6 + Math.random() * 0.5,
      dir: Math.random() < 0.5 ? 1 : -1,
      t: Math.random() * 40,
      axis: p.x0 !== undefined ? "x" : "z",
      a: p.x0 !== undefined ? p.x0 : p.z0,
      b: p.x0 !== undefined ? p.x1 : p.z1,
      fixed: p.x0 === undefined ? p.x : p.z,
      y: p.y,
    };
    worldGroup.add(person);
    animatedProps.push({ type: "person", group: person });
  });
}

function createPerson(colors) {
  const g = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe8b98f, roughness: 0.8 });
  const topMat = new THREE.MeshStandardMaterial({ color: colors[0], roughness: 0.85 });
  const botMat = new THREE.MeshStandardMaterial({ color: colors[1], roughness: 0.85 });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), skinMat);
  head.position.y = 1.6;
  head.castShadow = true;
  g.add(head);

  // Hair (a small cap)
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.23, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6),
    new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.9 })
  );
  hair.position.y = 1.63;
  g.add(hair);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.55, 0.2), topMat);
  torso.position.y = 1.15;
  torso.castShadow = true;
  g.add(torso);

  // Legs grouped for walking animation
  const legs = new THREE.Group();
  legs.position.set(0, 0.85, 0);
  const legGeo = new THREE.BoxGeometry(0.12, 0.7, 0.12);
  const legL = new THREE.Mesh(legGeo, botMat);
  legL.position.set(-0.1, -0.35, 0);
  const legR = new THREE.Mesh(legGeo, botMat);
  legR.position.set(0.1, -0.35, 0);
  legs.add(legL, legR);
  g.add(legs);
  g.userData.legs = legs;
  g.userData.legL = legL;
  g.userData.legR = legR;
  return g;
}

/* ---------- 5i. Clouds ---------- */
function buildClouds() {
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x000000,
    roughness: 1.0,
    transparent: true,
    opacity: 0.9,
  });
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    const puffs = 3 + Math.floor(Math.random() * 3);
    for (let p = 0; p < puffs; p++) {
      const r = 1.2 + Math.random() * 1.6;
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), cloudMat.clone());
      puff.position.set((Math.random() - 0.5) * 5, Math.random() * 0.6, (Math.random() - 0.5) * 3);
      puff.scale.y = 0.7;
      g.add(puff);
    }
    const radius = 30 + Math.random() * 20;
    const ang = Math.random() * Math.PI * 2;
    g.position.set(Math.cos(ang) * radius, 16 + Math.random() * 8, Math.sin(ang) * radius);
    g.userData = { speed: 0.15 + Math.random() * 0.1, radius, ang };
    worldGroup.add(g);
    animatedProps.push({ type: "cloud", group: g });
  }
}

/* ---------- 5j. Steam / smoke ---------- */
function buildSteam() {
  const smokeMat = new THREE.MeshStandardMaterial({
    color: 0xbbbbbb,
    emissive: 0x000000,
    roughness: 1,
    transparent: true,
    opacity: 0.5,
  });
  const smokePoints = [
    new THREE.Vector3(-10, 13, -10),
    new THREE.Vector3(26, 9, -28),
    new THREE.Vector3(-28, 9, 22),
  ];
  smokePoints.forEach((sp) => {
    const g = new THREE.Group();
    const puffs = [];
    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.4 + i * 0.12, 8, 6), smokeMat.clone());
      puff.userData.phase = (i / 5) * Math.PI * 2;
      puffs.push(puff);
      g.add(puff);
    }
    g.position.copy(sp);
    g.userData = { puffs };
    worldGroup.add(g);
    animatedProps.push({ type: "steam", group: g });
  });
}

/* ---------- 9. Raycasting / building info ---------- */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const infoCard = document.getElementById("info-card");
const infoTitle = document.getElementById("info-title");
const infoDesc = document.getElementById("info-desc");
const clockDay = document.getElementById("clock-day");
const clockTime = document.getElementById("clock-time");
let pointerDown = new THREE.Vector2();

// Update the HUD clock + period label from time-of-day
function tickClock() {
  const t = AppState.timeOfDay;
  const totalMin = Math.round(t * 1440);
  const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
  const mm = String(totalMin % 60).padStart(2, "0");
  clockTime.textContent = `${hh}:${mm}`;

  let day = "Night";
  if (t > 0.28 && t < 0.4) day = "Morning";
  else if (t >= 0.4 && t < 0.55) day = "Midday";
  else if (t >= 0.55 && t < 0.72) day = "Dusk";
  else if (t >= 0.72 && t < 0.82) day = "Evening";
  else day = "Night";
  clockDay.textContent = day;
}

function onCanvasClick(e) {
  // Ignore if it was a drag
  const dx = e.clientX - pointerDown.x;
  const dy = e.clientY - pointerDown.y;
  if (Math.sqrt(dx * dx + dy * dy) > 5) return; // was a drag

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(worldGroup.children, true);

  if (intersects.length > 0) {
    // Walk up to find a building group
    let obj = intersects[0].object;
    while (obj && !obj.userData.isBuilding) obj = obj.parent;
    if (obj && obj.userData.isBuilding) {
      const info = obj.userData.info;
      infoTitle.textContent = info.name;
      infoDesc.textContent = info.desc;
      infoCard.hidden = false;
      requestAnimationFrame(() => infoCard.classList.add("is-visible"));
      AppState.selectedBuilding = obj;
      // gentle camera nudge toward building
      const dir = obj.position.clone();
      controls.target.lerp(dir.multiplyScalar(1), 0.15);
      return;
    }
  }
  // Hide info card if nothing hit
  infoCard.classList.remove("is-visible");
  setTimeout(() => { infoCard.hidden = true; }, 300);
  AppState.selectedBuilding = null;
}

/* ---------- 10. Web Audio lo-fi soundtrack ---------- */
// Gentle looping lo-fi: soft pad chords, muted kick, hushed hi-hats,
// a relaxed melody with gentle detune, plus vinyl crackle ambience.
function initAudio() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (err) {
    console.warn("Audio not available", err);
    return;
  }

  // Master chain with a lowpass for that "lo-fi" warmth
  const master = audioCtx.createGain();
  master.gain.value = 0.0;
  const masterLP = audioCtx.createBiquadFilter();
  masterLP.type = "lowpass";
  masterLP.frequency.value = 2200;
  masterLP.RFS.value = 0.7;
  master.connect(masterLP);
  masterLP.connect(audioCtx.destination);

  // Reverb-ish via feedback delay for cozy space
  const reverb = audioCtx.createDelay(1.0);
  reverb.delayTime.value = 0.38;
  const reverbGain = audioCtx.createGain();
  reverbGain.gain.value = 0.22;
  const reverbLP = audioCtx.createBiquadFilter();
  reverbLP.type = "lowpass";
  reverbLP.frequency.value = 1800;
  master.connect(reverb);
  reverb.connect(reverbGain);
  reverbGain.connect(reverbLP);
  reverbLP.connect(master);

  audioNodes.master = master;
  audioNodes.masterLP = masterLP;
  audioNodes.reverb = reverb;
  audioNodes.reverbGain = reverbGain;

  // Fade in before starting the loop
  master.gain.setValueAtTime(0, audioCtx.currentTime);
  master.gain.linearRampToValueAtTime(0.9, audioCtx.currentTime + 2.5);

  // Start the loop
  startLoFiLoop();

  AppState.audioPlaying = true;
}

// Chord progression (minor 7th / warm jazz-ish) in A minor-ish mood
const CHORDS = [
  [0, 3, 7, 10], // A m7
  [5, 8, 12, 15], // D m7 (as fifths of scale)
  [7, 11, 14, 18], // E7 (dominant)
  [0, 3, 7, 10], // A m7
  [2, 5, 9, 12], // C maj7
  [3, 7, 10, 14], // D maj7
  [5, 9, 12, 16], // E maj7
  [0, 4, 7, 11], // F maj7
];
const SCALE = [0, 2, 3, 5, 7, 8, 10]; // A minor pentatonic-ish

function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

let loopTimer = null;
let stepIndex = 0;
const BEAT_MS = 520; // relaxed tempo (~115 bpm half-notes feel)

function startLoFiLoop() {
  stepIndex = 0;
  scheduleStep();
}

function scheduleStep() {
  if (!audioCtx || !AppState.audioPlaying) return;
  playStep(stepIndex);
  stepIndex = (stepIndex + 1) % 8;
  loopTimer = setTimeout(scheduleStep, BEAT_MS);
}

function playStep(idx) {
  const now = audioCtx.currentTime;
  // Chord on downbeat of every 4 steps
  if (idx % 4 === 0) {
    const chord = CHORDS[Math.floor(idx / 4) % CHORDS.length];
    chord.forEach((m) => playNote(m, "sawtooth", 0.06, now, 1.6, 0.4));
  }
  // Melody occasional note (pentatonic)
  if (Math.random() < 0.5) {
    const degree = Math.floor(Math.random() * SCALE.length);
    const oct = Math.random() < 0.5 ? 0 : 12;
    const m = 72 + SCALE[degree] + oct; // around A4
    playNote(m, "sine", 0.05, now, 0.5, 0.6);
  }
  // Muted kick on beats 0 and 4
  if (idx % 2 === 0) playKick(now);
  // Hi-hats on offbeats
  if (idx % 2 === 1 && Math.random() < 0.7) playHat(now);
}

// A soft filtered pluck/note
function playNote(m, type, gainVal, when, dur, filterF) {
  const osc = audioCtx.createOscillator();
  osc.type = type;
  osc.frequency.value = midiToFreq(m);
  // subtle detune for warmth
  osc.detune.value = (Math.random() - 0.5) * 8;

  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gainVal, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);

  const lp = audioCtx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = filterF;
  lp.RFS.value = 0.9;

  osc.connect(lp);
  lp.connect(g);
  g.connect(audioNodes.master);
  g.connect(audioNodes.reverb);

  osc.start(when);
  osc.stop(when + dur + 0.1);
}

function playKick(when) {
  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(140, when);
  osc.frequency.exponentialRampToValueAtTime(55, when + 0.12);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.25, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
  osc.connect(g);
  g.connect(audioNodes.master);
  osc.start(when);
  osc.stop(when + 0.2);
}

function playHat(when) {
  const bufferSize = audioCtx.sampleRate * 0.05;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const lp = audioCtx.createBiquadFilter();
  lp.type = "highpass";
  lp.frequency.value = 7000;
  const g = audioCtx.createGain();
  g.gain.value = 0.03;
  src.connect(lp);
  lp.connect(g);
  g.connect(audioNodes.master);
  src.start(when);
}

// Vinyl / room crackle ambience (subtle)
function startCrackle() {
  if (!audioCtx) return;
  const bufferSize = audioCtx.sampleRate * 2;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    let s = 0;
    if (Math.random() < 0.02) s += (Math.random() - 0.5) * 0.6;
    if (Math.random() < 0.002) s += (Math.random() < 0.5 ? 1 : -1) * 0.9; // pop
    data[i] = s;
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const bp = audioCtx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 3000;
  bp.RFS.value = 0.5;
  const g = audioCtx.createGain();
  g.gain.value = 0.015;
  src.connect(bp);
  bp.connect(g);
  g.connect(audioNodes.master);
  src.start();
  audioCtx._crackle = src;
}

function setAudio(on) {
  if (!audioCtx) return;
  AppState.audioPlaying = on;
  const now = audioCtx.currentTime;
  if (on) {
    if (audioCtx.state === "suspended") audioCtx.resume();
    audioNodes.master.gain.cancelScheduledValues(now);
    audioNodes.master.gain.setValueAtTime(audioNodes.master.gain.value, now);
    audioNodes.master.gain.linearRampToValueAtTime(0.9, now + 0.4);
    if (!audioCtx._crackle) startCrackle();
    if (loopTimer === null) scheduleStep();
  } else {
    audioNodes.master.gain.cancelScheduledValues(now);
    audioNodes.master.gain.setValueAtTime(audioNodes.master.gain.value, now);
    audioNodes.master.gain.linearRampToValueAtTime(0.0, now + 0.6);
    if (loopTimer !== null) { clearTimeout(loopTimer); loopTimer = null; }
  }
}

/* ---------- 10. Web Audio lo-fi soundtrack ---------- */
function wireUI() {
  const audioToggle = document.getElementById("audio-toggle");
  const timeRange = document.getElementById("time-range");
  const dayBtn = document.getElementById("day-btn");
  const duskBtn = document.getElementById("dusk-btn");
  const nightBtn = document.getElementById("night-btn");
  const orbitToggle = document.getElementById("orbit-toggle");
  const clockDay = document.getElementById("clock-day");
  const clockTime = document.getElementById("clock-time");

  audioToggle.addEventListener("click", () => {
    const on = !AppState.audioPlaying;
    setAudio(on);
    audioToggle.setAttribute("aria-pressed", String(on));
    const glyph = audioToggle.querySelector(".toggle-btn__glyph");
    const label = audioToggle.querySelector(".toggle-btn__label");
    glyph.textContent = on ? "♪" : "♪̣";
    label.textContent = on ? "Lo-fi" : "Muted";
  });

  const setTime = (t) => {
    AppState.timeOfDay = t;
    timeRange.value = Math.round(t * 100);
    updateDayNight(t);
  };

  timeRange.addEventListener("input", () => {
    setTime(parseInt(timeRange.value, 10) / 100);
  });
  dayBtn.addEventListener("click", () => setTime(0.5));
  duskBtn.addEventListener("click", () => setTime(0.65));
  nightBtn.addEventListener("click", () => setTime(0.92));

  orbitToggle.addEventListener("click", () => {
    AppState.orbitEnabled = !AppState.orbitEnabled;
    controls.autoRotate = AppState.orbitEnabled;
    orbitToggle.setAttribute("aria-pressed", String(AppState.orbitEnabled));
    const label = orbitToggle.querySelector(".toggle-btn__label");
    label.textContent = AppState.orbitEnabled ? "On" : "Off";
  });

  renderer.domElement.addEventListener("mousedown", (e) => {
    pointerDown.set(e.clientX, e.clientY);
  });
  renderer.domElement.addEventListener("click", onCanvasClick);
}

/* ---------- 12. Animation loop ---------- */
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (controls) controls.update();

  // Update animated props
  for (const prop of animatedProps) {
    updateProp(prop, dt, t);
  }

  // Update day/night based on time-of-day target
  updateDayNight(AppState.timeOfDay);
  tickClock();

  renderer.render(scene, camera);
}

// Per-prop animation updates
function updateProp(prop, dt, t) {
  switch (prop.type) {
    case "car": {
      const u = prop.group.userData;
      u.t += u.dir * u.speed * dt;
      if (u.t > u.range) { u.t = u.range; u.dir = -u.dir; }
      if (u.t < -u.range) { u.t = -u.range; u.dir = -u.dir; }
      if (u.axis === "x") {
        prop.group.position.set(u.t, 0.02, u.pos);
        prop.group.rotation.y = u.dir > 0 ? 0 : Math.PI;
      } else {
        prop.group.position.set(u.x0, 0.02, u.t);
        prop.group.rotation.y = u.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      break;
    }
    case "person": {
      const u = prop.group.userData;
      u.t += u.speed * dt * u.dir;
      let pos = u.a + (u.t % (Math.abs(u.b - u.a)));
      if (pos < u.a) pos = u.a + (u.a - pos);
      if (prop.axis === "x") {
        prop.group.position.set(pos, u.y, u.fixed);
        prop.group.rotation.y = u.dir > 0 ? 0 : Math.PI;
      } else {
        prop.group.position.set(u.fixed, u.y, pos);
        prop.group.rotation.y = u.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      // walk bob
      const swing = Math.sin(t * 8 * u.dir) * 0.15;
      if (u.legL) u.legL.rotation.x = swing;
      if (u.legR) u.legR.rotation.x = -swing;
      break;
    }
    case "cloud": {
      const u = prop.group.userData;
      u.ang += u.speed * dt * 0.02;
      prop.group.position.x = Math.cos(u.ang) * u.radius;
      prop.group.position.z = Math.sin(u.ang) * u.radius;
      break;
    }
    case "steam": {
      const u = prop.group.userData;
      u.puffs.forEach((puff, i) => {
        const p = (t * 0.4 + i / u.puffs.length);
        puff.position.y = (t * 0.6 + i * 0.5) % 3;
        puff.position.x = Math.sin(p * 2 + u.puffs[i].userData.phase) * 0.4;
        const s = 0.6 + (puff.position.y / 3) * 1.2;
        puff.scale.setScalar(s);
        puff.material.opacity = 0.5 * (1 - puff.position.y / 3);
      });
      break;
    }
  }
}

/* ---------- Start / run ---------- */

function startApp() {
  if (AppState.isStarted) return;
  AppState.isStarted = true;
  startOverlay.classList.add("is-hidden");

  setupRenderer();
  setupScene();
  initControls();
  buildWorld();
  setupLighting();
  buildSky();
  initAudio();
  wireUI();

  // Expose debug state for self-test / inspection
  window.__ew = emissiveWindows;
  window.__ap = animatedProps;
  window.__wc = worldGroup.children.length;
  window.__scene = scene;
  window.__controls = controls;

  window.addEventListener("resize", onResize);
  animate();
}

function onResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* ---------- OrbitController class ---------- */
// A self-contained orbit control implementation.

class OrbitController {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.target = new THREE.Vector3();
    this.minDistance = 8;
    this.maxDistance = 60;
    this.minPolarAngle = 0.1;
    this.maxPolarAngle = Math.PI * 0.49;
    this.enableDamping = true;
    this.damping = 0.1;
    this.autoRotate = false;
    this.autoRotateSpeed = 1.0;
    this.rotateSpeed = 0.0025;
    this.zoomSpeed = 1.1;

    // Spherical coordinates
    this.spherical = new THREE.Spherical();
    this.sphericalTarget = new THREE.Spherical();
    this._initSpherical();
    this._cloneTarget = this.target.clone();

    this._bindEvents();
  }

  _initSpherical() {
    const offset = this.camera.position.clone().sub(this.target);
    this.spherical.setFromVector3(offset);
    this.sphericalTarget.copy(this.spherical);
  }

  _bindEvents() {
    this._onDown = null;
    this._lastX = 0;
    this._lastY = 0;

    this.domElement.addEventListener("mousedown", (e) => this._onMouseDown(e));
    this.domElement.addEventListener("mousemove", (e) => this._onMouseMove(e));
    window.addEventListener("mouseup", () => this._onMouseUp());
    this.domElement.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });
    this.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

    // Touch
    this.domElement.addEventListener("touchstart", (e) => this._onTouchStart(e), { passive: false });
    this.domElement.addEventListener("touchmove", (e) => this._onTouchMove(e), { passive: false });
    this.domElement.addEventListener("touchend", () => this._onTouchEnd());

    this._dragging = false;
  }

  _onMouseDown(e) {
    this._dragging = true;
    this._lastX = e.clientX;
    this._lastY = e.clientY;
    document.body.classList.add("is-interacting");
  }
  _onMouseUp() {
    this._dragging = false;
    document.body.classList.remove("is-interacting");
  }
  _onMouseMove(e) {
    if (!this._dragging) return;
    const dx = e.clientX - this._lastX;
    const dy = e.clientY - this._lastY;
    this._lastX = e.clientX;
    this._lastY = e.clientY;
    this.sphericalTarget.theta -= dx * this.rotateSpeed;
    this.sphericalTarget.phi -= dy * this.rotateSpeed;
    this._clamp();
  }
  _onWheel(e) {
    e.preventDefault();
    if (e.deltaY > 0) this.sphericalTarget.radius *= this.zoomSpeed;
    else this.sphericalTarget.radius /= this.zoomSpeed;
    this._clamp();
  }

  _onTouchStart(e) {
    if (e.touches.length === 1) {
      this._dragging = true;
      this._lastX = e.touches[0].clientX;
      this._lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      this._pinchDist = this._touchDist(e.touches);
      this._dragging = true;
    }
    document.body.classList.add("is-interacting");
  }
  _onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1 && this._dragging) {
      const dx = e.touches[0].clientX - this._lastX;
      const dy = e.touches[0].clientY - this._lastY;
      this._lastX = e.touches[0].clientX;
      this._lastY = e.touches[0].clientY;
      this.sphericalTarget.theta -= dx * this.rotateSpeed;
      this.sphericalTarget.phi -= dy * this.rotateSpeed;
      this._clamp();
    } else if (e.touches.length === 2) {
      const d = this._touchDist(e.touches);
      if (this._pinchDist) {
        const r = this.sphericalTarget.radius;
        if (d > this._pinchDist) r *= this.zoomSpeed;
        else r /= this.zoomSpeed;
        this.sphericalTarget.radius = Math.max(this.minDistance, Math.min(this.maxDistance, r));
      }
      this._pinchDist = d;
    }
  }
  _onTouchEnd() {
    this._dragging = false;
    document.body.classList.remove("is-interacting");
  }
  _touchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _clamp() {
    this.sphericalTarget.phi = Math.max(
      this.minPolarAngle,
      Math.min(this.maxPolarAngle, this.sphericalTarget.phi)
    );
    this.sphericalTarget.radius = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this.sphericalTarget.radius)
    );
  }

  update() {
    if (this.autoRotate) {
      this.sphericalTarget.theta += 0.001 * this.autoRotateSpeed;
    }
    // Damping
    this.spherical.theta += (this.sphericalTarget.theta - this.spherical.theta) * this.damping;
    this.spherical.phi += (this.sphericalTarget.phi - this.spherical.phi) * this.damping;
    this.spherical.radius += (this.sphericalTarget.radius - this.spherical.radius) * this.damping;

    const offset = new THREE.Spherical().copy(this.spherical);
    this.camera.position.copy(this.target).add(new THREE.Vector3().setFromSpherical(offset));
    this.camera.lookAt(this.target);
  }

  dispose() {
    // listeners are on window/dom; kept simple for this app
  }
}

/* ---------- Start / run ---------- */

/* Wire the enter button */
enterBtn.addEventListener("click", () => {
  startApp();
});

// Kick off rendering pipeline only after user gesture (audio requirement)
// Nothing else runs until startApp().
