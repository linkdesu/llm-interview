import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// =========================================================================
// SpaceX Raptor Engine — 3D viewer (three.js)
// White background theme; procedural geometry for all engine parts.
// =========================================================================

// ---- Global state (exposed for testing) ----
const state = {
  autoRotate: true,
  exhaustGlow: true,
  gimbalAngle: 0,
  parts: {}, // named groups for inspection
  fps: 0,
};
window.raptorState = state;

// ---- Renderer ----
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ---- Scene & white background ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

// ---- Camera ----
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(7, 6, 9);

// ---- Controls ----
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 3;
controls.maxDistance = 25;
controls.target.set(0.6, 2.6, 0);

// ---- Lighting (soft studio setup for a white theme) ----
function buildLighting() {
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(6, 10, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  key.shadow.camera.left = -10;
  key.shadow.camera.right = 10;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -10;
  key.shadow.bias = -0.0004;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.9);
  fill.position.set(-7, 5, -4);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.7);
  rim.position.set(-2, 3, -8);
  scene.add(rim);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xdedede, 0.6);
  scene.add(hemi);
}

// ---- Materials ----
function buildMaterials() {
  const steel = new THREE.MeshStandardMaterial({
    color: 0xbfc2c8,
    metalness: 0.85,
    roughness: 0.35,
  });
  const darkSteel = new THREE.MeshStandardMaterial({
    color: 0x3a3d44,
    metalness: 0.9,
    roughness: 0.4,
  });
  const nozzle = new THREE.MeshStandardMaterial({
    color: 0x2b2c30,
    metalness: 0.7,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  const copper = new THREE.MeshStandardMaterial({
    color: 0xb87333,
    metalness: 0.85,
    roughness: 0.3,
  });
  return { steel, darkSteel, nozzle, copper };
}

// ---- Engine assembly ----
let engineGroup;
let exhaustMesh;
let materials;

function buildEngine() {
  engineGroup = new THREE.Group();
  materials = buildMaterials();

  // Add sub-assemblies: nozzle, head, turbopump, gimbal, and piping.
  buildNozzle();
  buildEngineHead();
  buildTurbopump();
  buildGimbal();
  buildPiping();

  engineGroup.position.set(0, 0, 0);
  scene.add(engineGroup);
  state.parts.engine = engineGroup;
}

function buildNozzle() {
  // Main nozzle bell — a conical "bell" profile revolved around the Y axis.
  // The wide exit faces DOWN (exhaust direction); the narrow throat is up.
  const throatR = 0.72;
  const exitR = 1.75;
  const bellH = 2.4;
  const steps = 24;
  const pts = [];
  // From exit (bottom, wide) up to throat (top, narrow) with a contour curve.
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = exitR + (throatR - exitR) * Math.pow(t, 0.72);
    const y = bellH * t;
    pts.push(new THREE.Vector2(r, y));
  }
  const bellGeo = new THREE.LatheGeometry(pts, 48);
  const bell = new THREE.Mesh(bellGeo, materials.nozzle);
  bell.castShadow = true;
  bell.receiveShadow = true;
  engineGroup.add(bell);

  // Throat ring / engine dome cap just above the bell.
  const domeGeo = new THREE.CylinderGeometry(0.78, 0.72, 0.35, 48);
  const dome = new THREE.Mesh(domeGeo, materials.steel);
  dome.position.y = bellH + 0.17;
  dome.castShadow = true;
  engineGroup.add(dome);

  // Outer skirt ring at the nozzle exit for a defined rim (at the bottom).
  const rimGeo = new THREE.TorusGeometry(exitR, 0.06, 12, 48);
  const rim = new THREE.Mesh(rimGeo, materials.darkSteel);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0;
  engineGroup.add(rim);

  state.parts.nozzle = bell;
}

function buildEngineHead() {
  // Engine head / valve block — the top cylindrical assembly with the
  // injector dome, cooling jacket rings, and valve actuator housing.
  const baseY = 2.4 + 0.35 + 0.17; // top of the dome cap

  // Main engine body cylinder (cooling jacket).
  const bodyGeo = new THREE.CylinderGeometry(0.95, 0.85, 1.5, 48);
  const body = new THREE.Mesh(bodyGeo, materials.steel);
  body.position.y = baseY + 0.75;
  body.castShadow = true;
  body.receiveShadow = true;
  engineGroup.add(body);

  // Cooling jacket ridges around the body.
  for (let i = 0; i < 5; i++) {
    const ringGeo = new THREE.TorusGeometry(0.98, 0.05, 10, 48);
    const ring = new THREE.Mesh(ringGeo, materials.darkSteel);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = baseY + 0.15 + i * 0.3;
    engineGroup.add(ring);
  }

  // Upper engine dome (the rounded injector head).
  const domeGeo = new THREE.SphereGeometry(0.95, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  const dome = new THREE.Mesh(domeGeo, materials.steel);
  dome.position.y = baseY + 1.5;
  dome.castShadow = true;
  engineGroup.add(dome);

  // Central oxidizer valve actuator stack on top of the dome.
  const actuatorGeo = new THREE.CylinderGeometry(0.32, 0.4, 0.7, 32);
  const actuator = new THREE.Mesh(actuatorGeo, materials.darkSteel);
  actuator.position.y = baseY + 1.5 + 0.35;
  actuator.castShadow = true;
  engineGroup.add(actuator);

  const valveCapGeo = new THREE.CylinderGeometry(0.2, 0.22, 0.25, 32);
  const valveCap = new THREE.Mesh(valveCapGeo, materials.copper);
  valveCap.position.y = baseY + 1.5 + 0.75;
  engineGroup.add(valveCap);

  // Small injector port accents around the dome shoulder.
  const portCount = 8;
  for (let i = 0; i < portCount; i++) {
    const a = (i / portCount) * Math.PI * 2;
    const portGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.18, 12);
    const port = new THREE.Mesh(portGeo, materials.darkSteel);
    port.position.set(Math.cos(a) * 0.7, baseY + 1.52, Math.sin(a) * 0.7);
    engineGroup.add(port);
  }

  state.parts.head = body;
}

function buildTurbopump() {
  // Full-flow staged-combustion turbopump + preburner, mounted to the side
  // of the engine head and fed through a connecting duct.
  const baseY = 2.4 + 0.35 + 0.17;

  // Pump housing — a robust cylinder bolted to the engine side.
  const pumpGeo = new THREE.CylinderGeometry(0.62, 0.62, 1.4, 40);
  const pump = new THREE.Mesh(pumpGeo, materials.steel);
  pump.position.set(1.55, baseY + 0.9, 0);
  pump.castShadow = true;
  pump.receiveShadow = true;
  engineGroup.add(pump);

  // Pump end cap / turbine drive housing.
  const capGeo = new THREE.CylinderGeometry(0.5, 0.62, 0.35, 40);
  const cap = new THREE.Mesh(capGeo, materials.darkSteel);
  cap.position.set(1.55, baseY + 1.65, 0);
  cap.castShadow = true;
  engineGroup.add(cap);

  // Turbine exhaust outlet pointing up.
  const turbOutGeo = new THREE.CylinderGeometry(0.22, 0.28, 0.6, 24);
  const turbOut = new THREE.Mesh(turbOutGeo, materials.darkSteel);
  turbOut.position.set(1.55, baseY + 2.0, 0);
  engineGroup.add(turbOut);

  // Preburner canister (copper-tinted) beside the pump.
  const preGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.9, 28);
  const pre = new THREE.Mesh(preGeo, materials.copper);
  pre.position.set(2.2, baseY + 0.5, 0.3);
  pre.castShadow = true;
  engineGroup.add(pre);

  // Connecting duct from pump down to the engine dome.
  const ductPts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const x = 0.9 + t * (1.55 - 0.9);
    const y = baseY + 0.75 - t * 0.1;
    ductPts.push(new THREE.Vector3(x, y, 0));
  }
  const ductCurve = new THREE.CatmullRomCurve3(ductPts);
  const ductGeo = new THREE.TubeGeometry(ductCurve, 20, 0.14, 16, false);
  const duct = new THREE.Mesh(ductGeo, materials.steel);
  engineGroup.add(duct);

  // Bolted flange rings on the pump.
  for (let i = 0; i < 3; i++) {
    const flangeGeo = new THREE.TorusGeometry(0.64, 0.05, 10, 40);
    const flange = new THREE.Mesh(flangeGeo, materials.darkSteel);
    flange.position.set(1.55, baseY + 0.3 + i * 0.45, 0);
    engineGroup.add(flange);
  }

  state.parts.turbopump = pump;
}

function buildGimbal() {
  // Gimbal ring mount at the base — allows the engine to pivot for
  // vehicle steering. A heavy ring encircling the nozzle root with
  // truss links to a fixed mount plate.
  const baseY = -0.15;

  // Fixed mount plate (connects to the rocket structure).
  const plateGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.18, 48);
  const plate = new THREE.Mesh(plateGeo, materials.darkSteel);
  plate.position.y = baseY - 0.6;
  plate.castShadow = true;
  plate.receiveShadow = true;
  engineGroup.add(plate);

  // Gimbal ring encircling the nozzle root.
  const ringGeo = new THREE.TorusGeometry(1.15, 0.13, 16, 64);
  const gimbalRing = new THREE.Mesh(ringGeo, materials.steel);
  gimbalRing.rotation.x = Math.PI / 2;
  gimbalRing.position.y = baseY - 0.25;
  gimbalRing.castShadow = true;
  engineGroup.add(gimbalRing);

  // Pivot truss links from the ring down to the mount plate.
  const linkCount = 6;
  for (let i = 0; i < linkCount; i++) {
    const a = (i / linkCount) * Math.PI * 2;
    const linkGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.7, 12);
    const link = new THREE.Mesh(linkGeo, materials.darkSteel);
    const rad = 1.0;
    link.position.set(Math.cos(a) * rad, baseY - 0.42, Math.sin(a) * rad);
    link.rotation.z = Math.cos(a) * 0.25;
    link.rotation.x = -Math.sin(a) * 0.25;
    engineGroup.add(link);
  }

  // Central swivel joint at the gimbal pivot.
  const jointGeo = new THREE.SphereGeometry(0.28, 24, 24);
  const joint = new THREE.Mesh(jointGeo, materials.copper);
  joint.position.y = baseY - 0.25;
  engineGroup.add(joint);

  state.parts.gimbal = gimbalRing;
}

function buildPiping() {
  // Propellant feed & coolant lines — thin routed tubes wrapping the engine.
  const baseY = 2.4 + 0.35 + 0.17;
  const lineMat = materials.copper;

  // Helper: build a smooth tube along a set of 3D points.
  const makeTube = (pts, radius = 0.045) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const geo = new THREE.TubeGeometry(curve, 32, radius, 10, false);
    return new THREE.Mesh(geo, lineMat);
  };

  // Oxidizer line from the pump down toward the head.
  engineGroup.add(makeTube([
    [1.55, baseY + 1.65, 0.62],
    [1.55, baseY + 0.4, 0.7],
    [1.15, baseY - 0.2, 0.6],
    [0.95, baseY + 0.2, 0.4],
  ]));

  // Methane feed line wrapping around the body on the far side.
  engineGroup.add(makeTube([
    [1.55, baseY + 1.65, -0.62],
    [1.6, baseY + 0.5, -0.8],
    [1.1, baseY - 0.1, -0.7],
    [0.9, baseY + 0.3, -0.5],
  ], 0.05));

  // Coolant loop along the nozzle body.
  const coolPts = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const a = t * Math.PI * 1.4 - Math.PI * 0.2;
    const rr = 0.99;
    coolPts.push([Math.cos(a) * rr, 2.75 + t * 0.6, Math.sin(a) * rr]);
  }
  engineGroup.add(makeTube(coolPts, 0.035));

  // Small sensor/actuator wiring loom near the head.
  engineGroup.add(makeTube([
    [0.4, baseY + 1.55, 0.4],
    [0.6, baseY + 1.9, 0.3],
    [0.5, baseY + 2.3, 0.1],
    [0.2, baseY + 2.4, 0],
  ], 0.025));

  state.parts.piping = engineGroup;
}

// ---- Exhaust glow disc ----
function buildExhaust() {
  // Additive glow disc at the nozzle exit (bottom), simulating hot gas.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0.0, "rgba(255, 230, 180, 1.0)");
  grad.addColorStop(0.35, "rgba(255, 130, 60, 0.85)");
  grad.addColorStop(0.7, "rgba(255, 70, 30, 0.35)");
  grad.addColorStop(1.0, "rgba(255, 40, 20, 0.0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);

  const glowMat = new THREE.MeshBasicMaterial({
    map: tex,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
  });
  exhaustMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4.5), glowMat);
  exhaustMesh.position.set(0, -0.9, 0); // just below the nozzle exit
  exhaustMesh.rotation.x = Math.PI / 2; // face downward
  scene.add(exhaustMesh);
  state.parts.exhaust = exhaustMesh;
}

// ---- Resize handling ----
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ---- UI wiring ----
function bindUI() {
  const spinEl = document.getElementById("toggle-spin");
  const exhaustEl = document.getElementById("toggle-exhaust");
  const gimbalBtn = document.getElementById("btn-gimbal");
  const resetBtn = document.getElementById("btn-reset");

  spinEl.addEventListener("change", () => {
    state.autoRotate = spinEl.checked;
  });

  exhaustEl.addEventListener("change", () => {
    state.exhaustGlow = exhaustEl.checked;
  });

  let gimballed = false;
  gimbalBtn.addEventListener("click", () => {
    gimballed = !gimballed;
    state.gimbalAngle = gimballed ? 0.28 : 0;
  });

  resetBtn.addEventListener("click", () => {
    camera.position.set(7, 6, 9);
    controls.target.set(0.6, 2.6, 0);
    controls.update();
    state.gimbalAngle = 0;
    gimballed = false;
    spinEl.checked = true;
    exhaustEl.checked = true;
    state.autoRotate = true;
    state.exhaustGlow = true;
  });
}

// ---- Animation loop ----
let lastTime = performance.now();
function frame(now) {
  state.fps = Math.round(1000 / Math.max(1, now - lastTime));
  lastTime = now;

  // Auto-rotation.
  if (state.autoRotate && engineGroup) {
    engineGroup.rotation.y += 0.004;
  }

  // Gimbal pivot (rotate whole engine about a point near the base).
  if (engineGroup) {
    const target = state.gimbalAngle;
    engineGroup.rotation.x += (target - engineGroup.rotation.x) * 0.06;
  }

  // Exhaust glow flicker.
  if (exhaustMesh) {
    const on = state.exhaustGlow;
    const target = on ? 0.75 + Math.sin(now * 0.01) * 0.12 : 0.0;
    exhaustMesh.material.opacity += (target - exhaustMesh.material.opacity) * 0.1;
    const s = 1 + Math.sin(now * 0.02) * 0.05;
    exhaustMesh.scale.set(s, s, s);
  }

  controls.update();
  renderer.render(scene, camera);
}

function animate() {
  requestAnimationFrame(animate);
  frame(performance.now());
}

// ---- Init ----
function init() {
  buildLighting();
  buildEngine();
  buildExhaust();
  bindUI();
  window.addEventListener("resize", onResize);
  window.__scene = { scene, camera, renderer, controls, engineGroup, materials, state };
  animate();
}

init();
