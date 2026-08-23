/* ============================================================
   City Time Machine — 3D Diorama
   A cozy city block with orbit/zoom + looping lo-fi soundtrack.

   Sections:
   1. Globals & config
   2. Utility helpers
   3. Camera controller (orbit + zoom)
   4. Scene / lighting / time-of-day
   5. Diorama builder (ground, roads, buildings...)
   6. Interactive objects registry
   7. WebAudio lo-fi soundtrack
   8. UI wiring
   9. Animation loop
   10. Self-test (dev)
   ============================================================ */

'use strict';

// ----------------------------------------------------------------
// 1. Globals & config
// ----------------------------------------------------------------
const CONFIG = {
  block: 24,          // diorama block size (world units)
  buildings: 9,       // grid of buildings
  fogColor: 0xf5c6a0,
  bgColor: 0x2a1c36,
};

const state = {
  started: false,
  musicOn: true,
  ambienceOn: true,
  timeOfDay: 0,       // 0 golden hour, 1 day, 2 evening, 3 night
  selectedObject: null,
};

// Three.js singletons (assigned after script loads)
let renderer, scene, camera, cameraTarget;
let clock;
let audioEngine;

// Registry of clickable/inspectable objects
const interactables = [];

// ----------------------------------------------------------------
// 2. Utility helpers
// ----------------------------------------------------------------
function rand(min, max) { return min + Math.random() * (max - min); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function lerp(a, b, t) { return a + (b - a) * t; }
function mixColors(c1, c2, t) {
  const a = new THREE.Color(c1), b = new THREE.Color(c2);
  return a.lerp(b, t);
}

// Materials reused across the scene for a cohesive palette.
const PALETTE = {
  cream: 0xfff4e6,
  warm: 0xffcf9e,
  terracotta: 0xd98b6f,
  sage: 0x9dc18c,
  teal: 0x7ecfb3,
  pink: 0xffb3c8,
  blue: 0x8fb6d9,
  lavender: 0xbfa6d9,
  slate: 0x6b6f76,
  road: 0x565060,
  grass: 0x7fae6b,
  trunk: 0x6b4a35,
  leaf: 0x6fa356,
};

// ----------------------------------------------------------------
// 3. Camera controller (orbit + zoom)
// ----------------------------------------------------------------
// ----------------------------------------------------------------
// 3. Camera controller (orbit + zoom)
// ----------------------------------------------------------------
// Spherical orbit controls with damping. Drag = orbit, wheel = zoom.
const cam = {
  theta: 0.9,        // yaw angle (radians)
  phi: 0.95,         // pitch angle (radians, from top)
  radius: 42,        // zoom distance
  minRadius: 12,
  maxRadius: 90,
  minPhi: 0.25,
  maxPhi: 1.45,
  // target we orbit around
  target: new THREE.Vector3(0, 2, 0),
  // smoothed values
  tTheta: 0.9,
  tPhi: 0.95,
  tRadius: 42,
  tTarget: new THREE.Vector3(0, 2, 0),
  // pointer state
  dragging: false,
  lastX: 0,
  lastY: 0,
};

function initCameraController() {
  const canvas = renderer.domElement;

  // Pointer (mouse / touch) handling
  canvas.addEventListener('pointerdown', (e) => {
    cam.dragging = true;
    cam.lastX = e.clientX;
    cam.lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!cam.dragging) return;
    const dx = e.clientX - cam.lastX;
    const dy = e.clientY - cam.lastY;
    cam.lastX = e.clientX;
    cam.lastY = e.clientY;
    cam.theta -= dx * 0.006;
    cam.phi = Math.max(cam.minPhi, Math.min(cam.maxPhi, cam.phi + dy * 0.006));
  });

  canvas.addEventListener('pointerup', (e) => {
    cam.dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  });

  canvas.addEventListener('pointercancel', (e) => { cam.dragging = false; });

  // Zoom with wheel
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.radius = Math.max(cam.minRadius, Math.min(cam.maxRadius, cam.radius + e.deltaY * 0.03));
  }, { passive: false });

  // Pinch-to-zoom on touch
  let lastDist = 0;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      lastDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      cam.radius = Math.max(cam.minRadius, Math.min(cam.maxRadius, cam.radius - (d - lastDist) * 0.08));
      lastDist = d;
      e.preventDefault();
    }
  }, { passive: false });

  // Reset camera button
  document.getElementById('reset-btn').addEventListener('click', () => {
    cam.theta = 0.9; cam.phi = 0.95; cam.radius = 42;
    cam.target.set(0, 2, 0);
  });
}

function updateCameraController() {
  // Smoothly damped toward target values (linear damping)
  const damp = 0.12;
  cam.tTheta = lerp(cam.tTheta, cam.theta, damp);
  cam.tPhi = lerp(cam.tPhi, cam.phi, damp);
  cam.tRadius = lerp(cam.tRadius, cam.radius, damp);
  cam.tTarget.lerp(cam.target, damp);

  const r = cam.tRadius;
  const phi = cam.tPhi;
  const theta = cam.tTheta;
  const x = r * Math.sin(phi) * Math.sin(theta);
  const y = r * Math.cos(phi);
  const z = r * Math.cos(phi) * Math.cos(theta);

  camera.position.set(
    cam.tTarget.x + x,
    cam.tTarget.y + y,
    cam.tTarget.z + z
  );
  camera.lookAt(cam.tTarget);
}

// ----------------------------------------------------------------
// 4. Scene / lighting / time-of-day
// ----------------------------------------------------------------
// Time-of-day presets: color, fog, light intensity, sky hue.
const TIME_PRESETS = [
  { // 0: Golden hour
    name: 'Golden Hour', time: '17:42',
    sky: 0xf5c6a0, fog: 0xf5c6a0, sun: 0xffd9a8, sunInt: 2.4,
    hemi: 0xffe4c4, hemiInt: 1.4, ambient: 0x6a4a6a, ambientInt: 0.75,
    windowGlow: 0.9, stars: 0.05,
  },
  { // 1: Bright day
    name: 'Sunny Morning', time: '09:15',
    sky: 0xbcd6f0, fog: 0xbcd6f0, sun: 0xfff4e0, sunInt: 2.8,
    hemi: 0xffffff, hemiInt: 1.7, ambient: 0x9fb0c8, ambientInt: 1.0,
    windowGlow: 0.1, stars: 0.0,
  },
  { // 2: Evening
    name: 'Blue Evening', time: '19:30',
    sky: 0x5a4a7a, fog: 0x5a4a7a, sun: 0xff9e7a, sunInt: 1.2,
    hemi: 0x6a5a8a, hemiInt: 0.9, ambient: 0x3a3050, ambientInt: 0.55,
    windowGlow: 0.85, stars: 0.25,
  },
  { // 3: Night
    name: 'Quiet Night', time: '22:45',
    sky: 0x1a1630, fog: 0x1a1630, sun: 0x8fa0d0, sunInt: 0.5,
    hemi: 0x2a2a50, hemiInt: 0.7, ambient: 0x141428, ambientInt: 0.45,
    windowGlow: 1.0, stars: 1.0,
  },
];

let sunLight, hemiLight, ambientLight, skyMesh, starField;

function initScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(CONFIG.fogColor, 120, 260);

  // Camera
  camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 600);
  camera.position.set(30, 28, 30);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(CONFIG.bgColor, 1);
  document.getElementById('app').appendChild(renderer.domElement);

  // Sky dome
  const skyGeo = new THREE.SphereGeometry(280, 32, 16);
  const skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false });
  skyMesh = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyMesh);

  // Star field (points) hidden initially
  const starGeo = new THREE.BufferGeometry();
  const starCount = 600;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    // r128 has no Vector3.randomDirection(); build a random hemisphere manually
    const u = Math.random() * 2 - 1;
    const phi = Math.random() * Math.PI * 2;
    const sinR = Math.sqrt(Math.max(0, 1 - u * u));
    const v = new THREE.Vector3(sinR * Math.cos(phi), Math.abs(u), sinR * Math.sin(phi));
    v.multiplyScalar(260);
    positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, fog: false, transparent: true, opacity: 0 });
  starField = new THREE.Points(starGeo, starMat);
  scene.add(starField);

  // Lights
  sunLight = new THREE.DirectionalLight(0xffd9a8, 2.4);
  sunLight.position.set(30, 45, 20);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 160;
  const s = 40;
  sunLight.shadow.camera.left = -s;
  sunLight.shadow.camera.right = s;
  sunLight.shadow.camera.top = s;
  sunLight.shadow.camera.bottom = -s;
  sunLight.shadow.bias = -0.0004;
  scene.add(sunLight);
  scene.add(sunLight.target);

  hemiLight = new THREE.HemisphereLight(0xffe4c4, 0x4a3a2a, 1.4);
  scene.add(hemiLight);

  ambientLight = new THREE.AmbientLight(0x6a4a6a, 0.75);
  scene.add(ambientLight);

  // A warm fill light from the opposite side
  const fill = new THREE.DirectionalLight(0xffb3c8, 0.25);
  fill.position.set(-25, 20, -20);
  scene.add(fill);

  setTimeOfDay(state.timeOfDay);
  buildDiorama();
}

function setTimeOfDay(t) {
  state.timeOfDay = ((t % TIME_PRESETS.length) + TIME_PRESETS.length) % TIME_PRESETS.length;
  const p = TIME_PRESETS[state.timeOfDay];

  scene.fog.color.set(p.fog);
  skyMesh.material.color.set(p.sky);
  sunLight.color.set(p.sun);
  sunLight.intensity = p.sunInt;
  hemiLight.color.set(p.hemi);
  hemiLight.intensity = p.hemiInt;
  ambientLight.color.set(p.ambient);
  ambientLight.intensity = p.ambientInt;

  // Position sun by time: golden low, day high, evening low-night up
  const angles = [0.25, 1.25, 0.4, 2.6]; // rough
  const ang = angles[state.timeOfDay];
  sunLight.position.set(Math.cos(ang) * 50, Math.sin(ang) * 55 + 5, Math.sin(ang * 1.3) * 40);

  // Window glow visibility
  const glowMat = scene.getObjectByName('window-glow-mat');
  // handled via material overrides below

  // Stars opacity
  starField.material.opacity = p.stars;

  // Update badge
  const badge = document.getElementById('time-badge');
  if (badge) {
    badge.textContent = p.name + ' · ' + p.time;
    badge.style.background = 'rgba(255, 207, 158, 0.18)';
  }
}

// ----------------------------------------------------------------
// 5. Diorama builder
// ----------------------------------------------------------------
// All objects are grouped under a single root so time-of-day and
// camera target stay simple.
let dioramaRoot;
const windowGlowMaterials = []; // materials that glow at night
const movingVehicles = [];      // vehicles animated along roads

function buildDiorama() {
  dioramaRoot = new THREE.Group();
  dioramaRoot.name = 'diorama';
  scene.add(dioramaRoot);

  buildGround();
  buildRoads();

  // Building grid: 3x3 blocks with roads between them
  const grid = [-1, 0, 1];
  const cell = 8;
  for (let gx = 0; gx < 3; gx++) {
    for (let gz = 0; gz < 3; gz++) {
      const bx = gx === 1 ? 0 : (gx === 0 ? -cell : cell);
      const bz = gz === 1 ? 0 : (gz === 0 ? -cell : cell);
      // Skip the center-ish spot for a little plaza/fountain
      if (gx === 1 && gz === 1) {
        buildPlaza(0, 0);
        continue;
      }
      const kind = pick(['store', 'cafe', 'apartment', 'shop']);
      makeBuilding(bx, bz, { kind });
    }
  }

  // Trees, street lights, vehicles scattered
  makeTree(-3.6, -3.6);
  makeTree(3.6, 3.6);
  makeTree(-3.6, 3.6);
  makeTree(3.6, -3.6);

  makeStreetLight(-3.6, 0);
  makeStreetLight(3.6, 0);
  makeStreetLight(0, -3.6);
  makeStreetLight(0, 3.6);

  makeVehicle(0, -4.8, { dir: 'x', color: PALETTE.pink, speed: 4, bodyLen: 2.2 });
  makeVehicle(0, 4.8, { dir: 'x', color: PALETTE.blue, speed: 3.5, bodyLen: 2.6 });
  makeVehicle(-4.8, 0, { dir: 'z', color: PALETTE.sage, speed: 3, bodyLen: 2.2 });

  setTimeOfDay(state.timeOfDay);
}

function buildGround() {
  // Soft rounded base block
  const baseShape = new THREE.Shape();
  const b = CONFIG.block / 2 + 2;
  const r = 3;
  baseShape.moveTo(-b + r, -b);
  baseShape.lineTo(b - r, -b);
  baseShape.quadraticCurveTo(b, -b, b, -b + r);
  baseShape.lineTo(b, b - r);
  baseShape.quadraticCurveTo(b, b, b - r, b);
  baseShape.lineTo(-b + r, b);
  baseShape.quadraticCurveTo(-b, b, -b, b - r);
  baseShape.lineTo(-b, -b + r);
  baseShape.quadraticCurveTo(-b, -b, -b + r, -b);
  const baseGeo = new THREE.ExtrudeGeometry(baseShape, { depth: 4, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 6 });
  baseGeo.rotateX(-Math.PI / 2);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x8a6f5a, roughness: 0.95 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = -4;
  base.receiveShadow = true;
  dioramaRoot.add(base);

  // Top grass plane (rounded)
  const topGeo = new THREE.CircleGeometry(CONFIG.block / 2 + 1.5, 48);
  const topMat = new THREE.MeshStandardMaterial({ color: PALETTE.grass, roughness: 1.0 });
  const top = new THREE.Mesh(topGeo, topMat);
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.02;
  top.receiveShadow = true;
  dioramaRoot.add(top);
}

function buildRoads() {
  // Crossroads forming a grid, leaving 4 corner blocks
  const roadMat = new THREE.MeshStandardMaterial({ color: PALETTE.road, roughness: 0.9 });
  const w = 2.6;
  // horizontal road
  const hRoad = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.block + 2, 0.05, w), roadMat);
  hRoad.position.set(0, 0.05, 0);
  hRoad.receiveShadow = true;
  dioramaRoot.add(hRoad);
  // vertical road
  const vRoad = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, CONFIG.block + 2), roadMat);
  vRoad.position.set(0, 0.05, 0);
  vRoad.receiveShadow = true;
  dioramaRoot.add(vRoad);

  // Dashed center lines
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xffe9c4, roughness: 0.8, emissive: 0x554422, emissiveIntensity: 0.2 });
  for (let i = -5; i <= 5; i++) {
    if (i === 0) continue;
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.18), lineMat);
    dash.position.set(i * 2, 0.08, 0);
    dioramaRoot.add(dash);
    const dash2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 1.2), lineMat);
    dash2.position.set(0, 0.08, i * 2);
    dioramaRoot.add(dash2);
  }
}
function buildPlaza(x, z) {
  // Little round plaza with a fountain in the center block
  const plazaMat = new THREE.MeshStandardMaterial({ color: 0xe8d3b8, roughness: 0.85 });
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(3, 40), plazaMat);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(x, 0.06, z);
  plaza.receiveShadow = true;
  dioramaRoot.add(plaza);

  // Fountain base
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xd5c6b0, roughness: 0.7 });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.6, 24), stoneMat);
  basin.position.set(x, 0.3, z);
  basin.castShadow = true;
  dioramaRoot.add(basin);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.5, 24),
    new THREE.MeshStandardMaterial({ color: 0x7ecfb3, roughness: 0.2, metalness: 0.1, emissive: 0x12332a, emissiveIntensity: 0.3 }));
  water.position.set(x, 0.32, z);
  dioramaRoot.add(water);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.2, 12), stoneMat);
  pillar.position.set(x, 0.9, z);
  pillar.castShadow = true;
  dioramaRoot.add(pillar);

  registerInteractable(basin, { icon: '⛲', title: 'Corner Plaza Fountain',
    desc: 'A quiet meeting spot in the heart of the block. Locals say if you drop a coin, your favorite lo-fi track will start playing.' });
}

function makeBuilding(x, z, opts) {
  opts = opts || {};
  const kind = opts.kind || 'apartment';
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  // Random-ish but stable dimensions
  const floors = pick([3, 4, 5]);
  const height = floors * 2.6;
  const w = rand(4.2, 5.4);
  const d = rand(4.2, 5.4);

  const wallColor = pick([PALETTE.cream, PALETTE.warm, PALETTE.lavender, PALETTE.teal, PALETTE.pink, PALETTE.blue, 0xf0d9b5]);
  const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), wallMat);
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Roof cap
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.8 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.4, d + 0.3), roofMat);
  roof.position.y = height + 0.2;
  roof.castShadow = true;
  group.add(roof);

  // Little rooftop water tank / AC unit for detail
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.7, 12),
    new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.6 }));
  tank.position.set(w * 0.2, height + 0.6, d * 0.2);
  tank.castShadow = true;
  group.add(tank);

  // Windows on the two visible faces (emissive for night glow)
  const winMat = new THREE.MeshStandardMaterial({
    color: 0x2a3340, roughness: 0.3, metalness: 0.2,
    emissive: 0xffcf8e, emissiveIntensity: 0.15,
  });
  windowGlowMaterials.push(winMat);
  const winCols = Math.floor(w / 1.5);
  const winRows = floors;
  for (let f = 0; f < winRows; f++) {
    for (let c = 0; c < winCols; c++) {
      const wl = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.12), winMat);
      wl.position.set(-w / 2 + 1.0 + c * 1.4, 1.2 + f * 2.4, d / 2 + 0.06);
      group.add(wl);
      const wr = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.12), winMat);
      wr.position.set(-w / 2 + 1.0 + c * 1.4, 1.2 + f * 2.4, -d / 2 - 0.06);
      group.add(wr);
    }
  }

  // Storefronts get a ground-floor shop front with awning + sign
  if (kind === 'store' || kind === 'cafe' || kind === 'shop') {
    const awningColor = pick([PALETTE.pink, PALETTE.teal, 0xe0677e, PALETTE.sage, 0xf5a661]);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.15, 0.9),
      new THREE.MeshStandardMaterial({ color: awningColor, roughness: 0.7 }));
    awning.position.set(0, 1.6, d / 2 + 0.45);
    awning.castShadow = true;
    group.add(awning);
    // striped awning detail
    for (let i = 0; i < 5; i++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9 / 5, 0.16, 0.92),
        new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? 0xffffff : 0x5a4636, roughness: 0.7 }));
      stripe.position.set(-w * 0.45 + (i + 0.5) * (w * 0.9 / 5), 1.6, d / 2 + 0.45);
      group.add(stripe);
    }
    // Glass door
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xbfe0ef, roughness: 0.2, metalness: 0.3, emissive: 0x334455, emissiveIntensity: 0.2 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 0.1), doorMat);
    door.position.set(0, 0.85, d / 2 + 0.08);
    group.add(door);

    // Neon open sign (emissive)
    const signColor = pick([0xff5d8f, 0x4dd0e1, 0xffcf66, 0x8affc1]);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.08),
      new THREE.MeshStandardMaterial({ color: signColor, emissive: signColor, emissiveIntensity: 0.8 }));
    sign.position.set(0, 2.7, d / 2 + 0.1);
    group.add(sign);
  }

  // Slight random rotation to feel hand-placed
  group.rotation.y = rand(-0.08, 0.08);
  dioramaRoot.add(group);

  const info = {
    icon: kind === 'cafe' ? '☕' : kind === 'shop' ? '🛍' : kind === 'store' ? '🏪' : '🏠',
    title: kind === 'cafe' ? 'Cozy Corner Cafe' : kind === 'shop' ? 'Boutique' : kind === 'store' ? 'Corner Store' : 'Apartment',
    desc: kind === 'cafe' ? 'Warm brew and soft jazz spill onto the sidewalk. The sign reads “Open Late.”' :
          kind === 'shop' ? 'A tiny boutique selling hand-painted posters and lo-fi vinyl.' :
          kind === 'store' ? 'A neighborhood general store. Milk, bread, and the daily gossip.' :
          'Coastal-apartment living. Every window glows warm once the sun goes down.',
  };
  registerInteractable(body, info);
}

function makeVehicle(x, z, opts) {
  opts = opts || {};
  const color = opts.color || PALETTE.pink;
  const bodyLen = opts.bodyLen || 2.2;
  const speed = opts.speed || 3;
  const dir = opts.dir || 'x';

  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(bodyLen, 0.5, 1.3), bodyMat);
  body.position.y = 0.5;
  body.castShadow = true;
  group.add(body);

  // Cabin
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(bodyLen * 0.5, 0.45, 1.15),
    new THREE.MeshStandardMaterial({ color: 0xdfeaf0, roughness: 0.2, metalness: 0.2 }));
  cabin.position.set(bodyLen * 0.05, 0.95, 0);
  cabin.castShadow = true;
  group.add(cabin);

  // Headlight glow
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xfff4c4, emissive: 0xfff4c4, emissiveIntensity: 0.6 }));
  light.position.set(bodyLen / 2, 0.5, 0.4);
  group.add(light);

  // Wheels
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.25, 14);
  const wpos = [[bodyLen * 0.3, 0.32], [-bodyLen * 0.3, 0.32], [bodyLen * 0.3, -0.32], [-bodyLen * 0.3, -0.32]];
  wpos.forEach((p) => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(p[0], p[1], p[2] > 0 ? 0.65 : -0.65);
    group.add(w);
  });

  group.position.set(x, 0.05, z);
  if (dir === 'z') group.rotation.y = Math.PI / 2;
  dioramaRoot.add(group);

  // Animate: move along a loop on its road
  const range = CONFIG.block / 2 - 1;
  const vehicle = { group, dir, range, speed, start: rand(0, Math.PI * 2) };
  movingVehicles.push(vehicle);

  registerInteractable(body, { icon: '🚗', title: 'Miniature Street Car',
    desc: 'Slowly cruising the block. These little cars hum a soft synth chord as they pass.' });
}

function makeTree(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.6, 8),
    new THREE.MeshStandardMaterial({ color: PALETTE.trunk, roughness: 0.9 }));
  trunk.position.y = 0.8;
  trunk.castShadow = true;
  group.add(trunk);

  // Foliage layers (a few stacked cones)
  const leafMat = new THREE.MeshStandardMaterial({ color: pick([PALETTE.leaf, 0x5f9b48, 0x76b35a]), roughness: 0.9 });
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.1 - i * 0.22, 1.2, 12), leafMat);
    cone.position.y = 1.8 + i * 0.7;
    cone.castShadow = true;
    group.add(cone);
  }
  dioramaRoot.add(group);

  registerInteractable(trunk, { icon: '🌳', title: 'Pocket Street Tree',
    desc: 'A hand-planted tree giving shade to the block. Its leaves rustle in the lo-fi breeze.' });
}

function makeStreetLight(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3a42, roughness: 0.6, metalness: 0.4 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.4, 10), poleMat);
  pole.position.y = 1.7;
  pole.castShadow = true;
  group.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.1), poleMat);
  arm.position.set(0.5, 3.3, 0);
  group.add(arm);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff0c4, emissive: 0xffe0a0, emissiveIntensity: 0.9 }));
  lamp.position.set(0.9, 3.35, 0);
  group.add(lamp);

  // Warm point light (mostly visible at night)
  const pl = new THREE.PointLight(0xffd9a0, 0.6, 10, 2);
  pl.position.set(0.9, 3.2, 0);
  group.add(pl);

  dioramaRoot.add(group);

  registerInteractable(pole, { icon: '💡', title: 'Warm Street Lamp',
    desc: 'Gentle sodium glow that flickers just enough to set the mood after dark.' });
}

// ----------------------------------------------------------------
// 6. Interactable registry
// ----------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let highlighted = null;

function registerInteractable(mesh, info) {
  mesh.userData.interactable = info;
  interactables.push(mesh);
}

function setupRaycaster() {
  const canvas = renderer.domElement;
  canvas.addEventListener('click', (e) => {
    // Ignore drags
    if (Math.abs(e.clientX - cam.lastX) + Math.abs(e.clientY - cam.lastY) > 4 && !cam.dragging) return;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(interactables, false);
    if (hits.length > 0) {
      const info = hits[0].object.userData.interactable;
      if (info) showInfo(info);
    }
  });

  // Hover highlight
  canvas.addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(interactables, false);
    // reset previous
    if (highlighted && (!hits.length || highlighted !== hits[0].object)) {
      if (highlighted.material.emissive) highlighted.material.emissiveIntensity = highlighted.userData.origEmissive;
      canvas.style.cursor = 'grab';
      highlighted = null;
    }
    if (hits.length > 0) {
      const obj = hits[0].object;
      if (obj.material.emissive) {
        obj.userData.origEmissive = obj.material.emissiveIntensity;
        obj.material.emissiveIntensity = 1.4;
      }
      canvas.style.cursor = 'pointer';
      highlighted = obj;
    }
  });
}

function showInfo(info) {
  document.getElementById('info-icon').textContent = info.icon;
  document.getElementById('info-title').textContent = info.title;
  document.getElementById('info-desc').textContent = info.desc;
  const card = document.getElementById('info-card');
  card.classList.remove('hidden');
  // retrigger animation
  card.style.animation = 'none';
  void card.offsetWidth;
  card.style.animation = '';
}

function hideInfo() {
  document.getElementById('info-card').classList.add('hidden');
}

// ----------------------------------------------------------------
// 7. WebAudio lo-fi soundtrack
// ----------------------------------------------------------------
// A gentle looping lo-fi loop: soft electric-piano chords (with a
// low-pass filter for that muffled vibe), a slow swing groove,
// and subtle vinyl/ambient texture.
let audioCtx = null;
let masterGain, musicGain, ambienceGain;
let musicTimer = null;
let noiseNode, vinylGain;
const SCALES = [0, 2, 3, 5, 7, 9, 10]; // minor pentatonic-ish for chill vibes
const ROOT = 220; // A3 as chord root reference

function initAudio() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;
    masterGain.connect(audioCtx.destination);

    musicGain = audioCtx.createGain();
    musicGain.gain.value = 0.55;
    musicGain.connect(masterGain);

    ambienceGain = audioCtx.createGain();
    ambienceGain.gain.value = 0.35;
    ambienceGain.connect(masterGain);

    // Vinyl / tape hiss (filtered noise)
    const bufferSize = 2 * audioCtx.sampleRate;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    noiseNode = audioCtx.createBufferSource();
    noiseNode.buffer = noiseBuffer;
    noiseNode.loop = true;
    const hissFilter = audioCtx.createBiquadFilter();
    hissFilter.type = 'highpass';
    hissFilter.frequency.value = 6000;
    vinylGain = audioCtx.createGain();
    vinylGain.gain.value = 0.04;
    noiseNode.connect(hissFilter);
    hissFilter.connect(vinylGain);
    vinylGain.connect(ambienceGain);
    noiseNode.start();
  } catch (err) {
    console.warn('Audio unavailable:', err);
    audioCtx = null;
  }
}

// Soft low-pass so everything sounds "inside a room"
let roomFilter = null;
function ensureRoomFilter() {
  if (!audioCtx || roomFilter) return;
  roomFilter = audioCtx.createBiquadFilter();
  roomFilter.type = 'lowpass';
  roomFilter.frequency.value = 2600;
  roomFilter.Q.value = 0.6;
  roomFilter.connect(musicGain);
}

// Play a soft electric-piano-ish tone using two detuned oscillators + env
function playNote(freq, when, dur, gainVal, dest) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  osc.type = 'sine'; osc2.type = 'triangle';
  osc.frequency.value = freq;
  osc2.frequency.value = freq * 1.005; // slight detune warmth
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gainVal, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(g); osc2.connect(g);
  g.connect(dest);
  osc.start(when); osc2.start(when);
  osc.stop(when + dur + 0.1); osc2.stop(when + dur + 0.1);
}

// A chord = root + minor 3rd + 5th + 9th for a jazzy lo-fi feel
function chordFreqs(root) {
  const semis = [0, 3, 7, 10]; // root, minor 3rd, 5th, 9th
  return semis.map((s) => root * Math.pow(2, s / 12));
}

// Sequencer: a slow, looping chord progression + sparse melody
const PROGRESSION = [0, 3, 5, 2]; // scale-degree indices for chords
let stepIndex = 0;

function startMusic() {
  ensureRoomFilter();
  if (!audioCtx) return;
  if (musicTimer) return; // already running

  const stepDur = 0.5; // seconds per step (half notes)
  const lookAhead = 0.2;

  function scheduleStep() {
    if (!audioCtx || !state.musicOn) return;
    const progStep = stepIndex % PROGRESSION.length;
    const deg = PROGRESSION[progStep];
    const root = ROOT * Math.pow(2, deg / 12);
    const chord = chordFreqs(root);
    // Pad the chord softly through the room filter
    chord.forEach((f, i) => playNote(f, audioCtx.currentTime + lookAhead, 2.2, 0.12 - i * 0.015, roomFilter));
    // Sparse melody note occasionally
    if (Math.random() < 0.5) {
      const melDeg = pick([7, 9, 10, 12]);
      const melFreq = root * Math.pow(2, (SCALES[0] + melDeg) / 12);
      playNote(melFreq, audioCtx.currentTime + lookAhead + rand(0, 0.3), 0.8, 0.14, roomFilter);
    }
    stepIndex++;
  }
  scheduleStep();
  musicTimer = setInterval(scheduleStep, stepDur * 500);
}

// Gentle ambient texture: slow filtered "wind" swells
function startAmbience() {
  if (!audioCtx) return;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 400;
  filter.Q.value = 0.5;
  const lfo = audioCtx.createOscillator();
  lfo.frequency.value = 0.12; // slow swell
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 300;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  const src = audioCtx.createBufferSource();
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1);
  src.buffer = buf;
  src.loop = true;
  const ambGain = audioCtx.createGain();
  ambGain.gain.value = 0.06;
  src.connect(filter);
  filter.connect(ambGain);
  ambGain.connect(ambienceGain);
  src.start();
  lfo.start();
}

function toggleMusic(on) {
  state.musicOn = on;
  const btn = document.getElementById('music-btn');
  btn.classList.toggle('active', on);
  if (on) startMusic();
  else if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
}

function toggleAmbience(on) {
  state.ambienceOn = on;
  const btn = document.getElementById('amb-btn');
  btn.classList.toggle('active', on);
  if (ambienceGain) ambienceGain.gain.value = on ? 0.35 : 0.0;
}

// ----------------------------------------------------------------
// 8. UI wiring
// ----------------------------------------------------------------
function initUI() {
  // Start button resumes audio context (user gesture) and hides overlay
  document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('start-overlay').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('legend').classList.remove('hidden');
    document.getElementById('loader').classList.add('hidden');
    state.started = true;
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    toggleMusic(true);
    toggleAmbience(true);
  });

  document.getElementById('music-btn').addEventListener('click', () => toggleMusic(!state.musicOn));
  document.getElementById('amb-btn').addEventListener('click', () => toggleAmbience(!state.ambienceOn));

  document.getElementById('time-btn').addEventListener('click', () => {
    setTimeOfDay(state.timeOfDay + 1);
  });

  document.getElementById('info-close').addEventListener('click', hideInfo);

  // Tab to cycle to next interactable object and show its info
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const idx = (interactables.indexOf(state.selectedObject) + 1) % interactables.length;
      state.selectedObject = interactables[idx];
      showInfo(state.selectedObject.userData.interactable);
      // Look toward the object
      const p = new THREE.Vector3();
      state.selectedObject.getWorldPosition(p);
      cam.target.copy(p);
    }
    if (e.key === 'Escape') hideInfo();
  });

  // Keyboard camera shortcuts
  window.addEventListener('keydown', (e) => {
    const pan = 1.5;
    if (e.key === 'ArrowLeft') cam.theta -= 0.05;
    if (e.key === 'ArrowRight') cam.theta += 0.05;
    if (e.key === 'ArrowUp') cam.phi = Math.max(cam.minPhi, cam.phi - 0.04);
    if (e.key === 'ArrowDown') cam.phi = Math.min(cam.maxPhi, cam.phi + 0.04);
    if (e.key === '+' || e.key === '=') cam.radius = Math.max(cam.minRadius, cam.radius - 3);
    if (e.key === '-') cam.radius = Math.min(cam.maxRadius, cam.radius + 3);
  });

  // Resize handling
  window.addEventListener('resize', onResize);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ----------------------------------------------------------------
// 9. Animation loop
// ----------------------------------------------------------------
let elapsed = 0;
function animate() {
  requestAnimationFrame(animate);
  if (!renderer) return;
  const dt = clock ? clock.getDelta() : 0.016;
  elapsed += dt;

  // Move vehicles along their roads
  movingVehicles.forEach((v) => {
    const pos = (Math.sin(elapsed * v.speed + v.start) * v.range);
    if (v.dir === 'x') v.group.position.x = pos;
    else v.group.position.z = pos;
    // face direction of travel
    const vel = v.dir === 'x'
      ? Math.cos(elapsed * v.speed + v.start)
      : Math.cos(elapsed * v.speed + v.start);
    if (v.dir === 'x') v.group.rotation.y = vel >= 0 ? 0 : Math.PI;
    else v.group.rotation.y = vel >= 0 ? Math.PI / 2 : -Math.PI / 2;
  });

  // Gentle breathing on the whole diorama
  if (dioramaRoot) {
    dioramaRoot.position.y = Math.sin(elapsed * 0.4) * 0.05;
  }

  updateCameraController();
  renderer.render(scene, camera);
}

// ----------------------------------------------------------------
// 10. Self-test (dev)
// ----------------------------------------------------------------
function selfTest() {
  const results = [];
  function check(name, fn) {
    try { fn(); results.push('PASS ' + name); } catch (e) { results.push('FAIL ' + name + ': ' + e.message); }
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  check('CONFIG has sane block size', () => assert(CONFIG.block > 0, 'block'));
  check('TIME_PRESETS has 4 entries', () => assert(TIME_PRESETS.length === 4, 'presets'));
  check('lerp interpolates', () => assert(Math.abs(lerp(0, 10, 0.5) - 5) < 1e-9, 'lerp'));
  check('mixColors blends', () => {
    const c = mixColors(0x000000, 0xffffff, 0.5);
    assert(c.r > 0.4 && c.r < 0.6, 'mix');
  });
  check('camera controller initializes target', () => assert(cam.target.x === 0 && cam.target.y === 2, 'target'));
  check('interactables registered', () => assert(interactables.length >= 12, 'count=' + interactables.length));
  check('window exposed for debugging', () => assert(typeof window.__city === 'object', 'window'));

  const pass = results.filter((r) => r.startsWith('PASS')).length;
  const total = results.length;
  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log('[self-test] ' + pass + '/' + total + ' passed');
  if (failed.length) console.log('[self-test] failures:', failed);
  return { pass, total, failed };
}

// Boot
window.__city = state; // expose for debugging
Object.defineProperty(window, '__cityScene', {
  get() { return { scene, camera, renderer, dioramaRoot, interactables, movingVehicles, state, cam }; },
  configurable: true,
});

// Initialize once DOM + Three.js are ready
function boot() {
  try {
    initScene();
    initCameraController();
    setupRaycaster();
    initAudio();
    initUI();
    clock = new THREE.Clock();
    animate();
    // Give a moment for the scene to build, then run self-test
    setTimeout(() => {
      try { selfTest(); } catch (e) { console.warn('self-test error', e); }
    }, 200);
  } catch (err) {
    console.error('Boot failed:', err);
    const loader = document.getElementById('loader');
    if (loader) {
      loader.querySelector('#load-text').textContent = 'Failed to load: ' + err.message;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
