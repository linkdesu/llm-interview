// ============================================================================
//  Cozy City Block — a tiny evening diorama
//  Three.js scene with orbit/zoom, procedural city, and a lo-fi soundtrack.
// ============================================================================
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ============================================================================
//  Global runtime state (exposed on window for debugging / self-test)
// ============================================================================
const State = {
  timeOfDay: 0, // 0..1 where 0.5 = deep night; drives sky & light warmth
  musicOn: false,
  trafficOn: true,
  running: false,
  buildings: [], // { mesh, name, ... }
  windowMats: [], // window materials for night brightness control
  cars: [], // { group, path, speed, dir }
  peds: [], // { group, path, speed }
  lamps: [], // { light, group, on }
};

// ============================================================================
//  Small helpers
// ============================================================================
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Collected window materials so night-time brightness can modulate them.
const windowMats = [];

// Deterministic simulation clock advanced by dt each step.
let simTime = 0;

// ============================================================================
//  Renderer, scene, camera
// ============================================================================
let renderer, scene, camera, controls, clock;
let skyDome, sunLight, moonLight, ambientLight, hemiLight;
const cameraHome = { pos: new THREE.Vector3(16, 14, 18), target: new THREE.Vector3(0, 1, 0) };

function initRenderer() {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.getElementById("app").appendChild(renderer.domElement);
}

function initScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1a1420, 0.012);

  camera = new THREE.PerspectiveCamera(
    42,
    window.innerWidth / window.innerHeight,
    0.1,
    400
  );
  camera.position.copy(cameraHome.pos);

  clock = new THREE.Clock();

  // Build the world layers.
  buildBase();
  buildRoads();
  buildBuildings();
  buildStorefronts();
  buildProps();
  buildVehicles();
  buildPedestrians();
  buildAtmosphere();
}

// ============================================================================
//  Lighting (sky + sun/moon + ambient + hemisphere)
// ============================================================================
function initLighting() {
  ambientLight = new THREE.AmbientLight(0x3a3350, 0.55);
  scene.add(ambientLight);

  hemiLight = new THREE.HemisphereLight(0x6a5f8a, 0x2a2030, 0.6);
  scene.add(hemiLight);

  // Cool moon light (key light for the evening scene).
  moonLight = new THREE.DirectionalLight(0x9fb4ff, 0.7);
  moonLight.position.set(-14, 22, -8);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(2048, 2048);
  moonLight.shadow.camera.near = 1;
  moonLight.shadow.camera.far = 80;
  const s = 24;
  moonLight.shadow.camera.left = -s;
  moonLight.shadow.camera.right = s;
  moonLight.shadow.camera.top = s;
  moonLight.shadow.camera.bottom = -s;
  moonLight.shadow.bias = -0.0004;
  moonLight.shadow.normalBias = 0.02;
  scene.add(moonLight);
  scene.add(moonLight.target);

  // Warm "last glow" sun low on the horizon.
  sunLight = new THREE.DirectionalLight(0xffb066, 0.5);
  sunLight.position.set(20, 6, 12);
  scene.add(sunLight);
}

// ============================================================================
//  Diorama base + ground
// ============================================================================
function buildBase() {
  const baseGroup = new THREE.Group();
  scene.add(baseGroup);

  // Pedestal (the wooden table the diorama sits on).
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(17, 18, 1.4, 64),
    new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.95, metalness: 0.05 })
  );
  pedestal.position.y = -0.7;
  pedestal.receiveShadow = true;
  baseGroup.add(pedestal);

  // Subtle rim highlight.
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(17, 17, 0.12, 64),
    new THREE.MeshStandardMaterial({ color: 0x3a2c20, roughness: 0.8 })
  );
  rim.position.y = 0.01;
  baseGroup.add(rim);

  // Grass top slab.
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0x3f5a3a,
    roughness: 1.0,
  });
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 0.2, 64), grassMat);
  grass.position.y = 0.76;
  grass.receiveShadow = true;
  baseGroup.add(grass);

  // Add a little texture variation to the grass with scattered darker patches.
  const patchMat = new THREE.MeshStandardMaterial({ color: 0x365030, roughness: 1.0 });
  for (let i = 0; i < 90; i++) {
    const r = rand(1.5, 14.5);
    const a = rand(0, Math.PI * 2);
    const patch = new THREE.Mesh(new THREE.CircleGeometry(rand(0.4, 1.1), 8), patchMat);
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(Math.cos(a) * r, 0.87, Math.sin(a) * r);
    patch.receiveShadow = true;
    baseGroup.add(patch);
  }
}

// ============================================================================
//  Roads (a gentle grid of streets)
// ============================================================================
function buildRoads() {
  const roadGroup = new THREE.Group();
  scene.add(roadGroup);

  const asphaltMat = new THREE.MeshStandardMaterial({
    color: 0x242028,
    roughness: 0.85,
    metalness: 0.05,
  });

  const roadW = 3.2;
  const half = roadW / 2;
  // Two intersecting roads divide the block into four quadrants.
  const roads = [
    { x: 0, z: 0, len: 30, horizontal: false }, // vertical road (along z)
    { x: 0, z: 0, len: 30, horizontal: true }, // horizontal road (along x)
  ];

  roads.forEach((r) => {
    const geo = new THREE.BoxGeometry(
      r.horizontal ? r.len : roadW,
      0.14,
      r.horizontal ? roadW : r.len
    );
    const road = new THREE.Mesh(geo, asphaltMat);
    road.position.set(r.x, 0.88, r.z);
    road.receiveShadow = true;
    roadGroup.add(road);

    // Center lane dashes.
    const dashMat = new THREE.MeshStandardMaterial({
      color: 0xd9cfa0,
      emissive: 0x4a4420,
      emissiveIntensity: 0.4,
      roughness: 0.7,
    });
    const dashCount = 12;
    for (let i = 0; i < dashCount; i++) {
      const off = lerp(-13, 13, (i + 0.5) / dashCount);
      const dash = new THREE.Mesh(
        new THREE.BoxGeometry(r.horizontal ? 1.4 : 0.18, 0.05, r.horizontal ? 0.18 : 1.4),
        dashMat
      );
      dash.position.set(
        r.horizontal ? off : 0,
        0.96,
        r.horizontal ? 0 : off
      );
      roadGroup.add(dash);
    }

    // Sidewalk curbs on both sides.
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x6b6560, roughness: 0.9 });
    [-1, 1].forEach((side) => {
      const offset = half + 0.25;
      const curb = new THREE.Mesh(
        new THREE.BoxGeometry(
          r.horizontal ? r.len : 0.5,
          0.3,
          r.horizontal ? 0.5 : r.len
        ),
        curbMat
      );
      curb.position.set(
        r.horizontal ? 0 : side * offset,
        0.92,
        r.horizontal ? side * offset : 0
      );
      curb.receiveShadow = true;
      roadGroup.add(curb);
    });
  });
}

// ============================================================================
//  Buildings (with windows, rooftops, storefronts)
// ============================================================================
function buildBuildings() {
  const q = [
    // [x, z, w, d, h, name, style]
    [4.6, 4.6, 4.4, 4.4, 10.5, "The Cozy Cat Café", "brick"],
    [9.4, 9.4, 3.6, 3.6, 7.0, "Maple Apartments", "stucco"],
    [-4.6, 4.6, 3.8, 3.8, 13.0, "Vinyl & Tape Records", "brick"],
    [-9.4, 9.4, 4.2, 4.2, 8.5, "Corner Drugstore", "concrete"],
    [-4.6, -4.6, 3.6, 3.6, 9.5, "Mochi Ramen Bar", "stucco"],
    [9.4, -9.4, 4.0, 4.0, 6.5, "Habitat Plant Shop", "wood"],
    [4.6, -4.6, 3.4, 3.4, 11.5, "Nook Bookshop", "brick"],
    [-9.4, -9.4, 4.4, 4.4, 8.0, "Lantern Diner", "concrete"],
  ];

  q.forEach((b) => {
    const [x, z, w, d, h, name, style] = b;
    const building = makeBuilding(w, d, h, style);
    building.position.set(x, 0.86, z);
    building.rotation.y = (Math.random() < 0.5 ? 1 : -1) * 0.12;
    scene.add(building);
    State.buildings.push({ mesh: building, name, style });
  });
}

// ---------------------------------------------------------------------------
//  Facade texture: draws a wall with a grid of lit / dark windows.
//  Returns { colorMap, emissiveMap } so windows glow at night.
// ---------------------------------------------------------------------------
function createFacadeTexture(faceW, faceH, cols, rows, litProb, wallHex, litHex, darkHex) {
  const scale = 32;
  const cw = Math.max(1, Math.round(faceW * scale));
  const ch = Math.max(1, Math.round(faceH * scale));
  const wall = new THREE.Color(wallHex);
  const lit = new THREE.Color(litHex);
  const dark = new THREE.Color(darkHex);

  const make = (glow) => {
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext("2d");

    // Wall base with a soft vertical gradient (lighter at ground level).
    const g = ctx.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, shade(wall, 0.08));
    g.addColorStop(1, shade(wall, -0.12));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);

    const padX = cw * 0.06;
    const padY = ch * 0.06;
    const gapX = (cw - padX * 2) / cols;
    const gapY = (ch - padY * 2) / rows;
    const winW = gapX * 0.62;
    const winH = gapY * 0.66;

    for (let r = 0; r < rows; r++) {
      for (let cc = 0; cc < cols; cc++) {
        const x = padX + cc * gapX + (gapX - winW) / 2;
        const y = padY + r * gapY + (gapY - winH) / 2;
        const on = Math.random() < litProb;
        const col = on ? lit : dark;
        ctx.fillStyle = "#" + col.getHexString();
        if (glow && on) {
          ctx.shadowColor = "#" + lit.getHexString();
          ctx.shadowBlur = 22;
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.fillRect(x, y, winW, winH);
        // window frame / mullion
        ctx.shadowBlur = 0;
        ctx.strokeStyle = shade(col, -0.25);
        ctx.lineWidth = Math.max(1, winW * 0.06);
        ctx.strokeRect(x, y, winW, winH);
        ctx.beginPath();
        ctx.moveTo(x + winW / 2, y);
        ctx.lineTo(x + winW / 2, y + winH);
        ctx.moveTo(x, y + winH / 2);
        ctx.lineTo(x + winW, y + winH / 2);
        ctx.stroke();
      }
    }
    return c;
  };

  const colorMap = new THREE.CanvasTexture(make(false));
  colorMap.wrapS = colorMap.wrapT = THREE.RepeatWrapping;
  colorMap.anisotropy = 4;
  const emissiveMap = new THREE.CanvasTexture(make(true));
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.anisotropy = 4;
  return { colorMap, emissiveMap };
}

// Lighten/darken a THREE.Color by a relative amount; returns a CSS hex string.
function shade(color, amt) {
  const r = clamp(color.r + amt, 0, 1);
  const g = clamp(color.g + amt, 0, 1);
  const b = clamp(color.b + amt, 0, 1);
  const hex = (v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// ---------------------------------------------------------------------------
//  Building maker: body + four window facades + rooftop details.
// ---------------------------------------------------------------------------
function makeBuilding(width, depth, height, style) {
  const g = new THREE.Group();

  const wallPalette = {
    brick: { wall: 0x8a4a3f, lit: 0xffcf8e, dark: 0x1c2030 },
    stucco: { wall: 0xc7a878, lit: 0xffe3b0, dark: 0x232028 },
    concrete: { wall: 0x7d8189, lit: 0xa9c7ff, dark: 0x1b2028 },
    wood: { wall: 0x7a5230, lit: 0xffd28a, dark: 0x201a14 },
  }[style] || { wall: 0x8a6a5a, lit: 0xffcf8e, dark: 0x1c2030 };

  const cols = Math.max(2, Math.round(width / 1.5));
  const rows = Math.max(2, Math.round(height / 1.7));

  // Body (solid wall) — windows are separate planes to avoid z-fighting.
  const bodyMat = new THREE.MeshStandardMaterial({
    color: wallPalette.wall,
    roughness: 0.9,
    metalness: 0.02,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), bodyMat);
  body.position.y = height / 2 + 0.86;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Window facades on all four sides.
  const { colorMap, emissiveMap } = createFacadeTexture(
    width,
    height,
    cols,
    rows,
    0.55,
    wallPalette.wall,
    wallPalette.lit,
    wallPalette.dark
  );
  const winMat = new THREE.MeshStandardMaterial({
    map: colorMap,
    emissiveMap: emissiveMap,
    emissive: 0xffd9a8,
    emissiveIntensity: 1.1,
    roughness: 0.5,
    metalness: 0.1,
    transparent: true,
  });
  windowMats.push(winMat);
  State.windowMats.push(winMat);

  const faceOffset = 0.03;
  const makeFace = (wx, wz, ry) => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), winMat);
    plane.position.set(wx, height / 2 + 0.86, wz);
    plane.rotation.y = ry;
    g.add(plane);
  };
  makeFace(0, depth / 2 + faceOffset, 0);
  makeFace(0, -(depth / 2 + faceOffset), Math.PI);
  makeFace(width / 2 + faceOffset, 0, Math.PI / 2);
  makeFace(-(width / 2 + faceOffset), 0, -Math.PI / 2);

  // Rooftop parapet + mechanical units for silhouette interest.
  const roofY = height + 0.86;
  const parapet = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.2, 0.5, depth + 0.2),
    new THREE.MeshStandardMaterial({ color: shade(new THREE.Color(wallPalette.wall), -0.2), roughness: 0.9 })
  );
  parapet.position.y = roofY - 0.25;
  parapet.castShadow = true;
  g.add(parapet);

  const acMat = new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.8, metalness: 0.4 });
  const ac1 = new THREE.Mesh(new THREE.BoxGeometry(width * 0.4, 0.7, depth * 0.35), acMat);
  ac1.position.set(width * 0.2, roofY - 0.1, depth * 0.2);
  ac1.castShadow = true;
  g.add(ac1);
  const ac2 = new THREE.Mesh(new THREE.BoxGeometry(width * 0.25, 0.5, depth * 0.25), acMat);
  ac2.position.set(-(width * 0.28), roofY - 0.05, -(depth * 0.25));
  ac2.castShadow = true;
  g.add(ac2);

  // A warm rooftop beacon that twinkles.
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff5533 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), beaconMat);
  beacon.position.set(0, roofY + 0.1, 0);
  g.add(beacon);

  g.userData.beacon = beacon;
  g.userData.beaconMat = beaconMat;
  g.userData.height = height;
  g.userData.width = width;
  g.userData.depth = depth;
  return g;
}

// ============================================================================
//  Storefronts, awnings, neon signs / advertisements
// ============================================================================
function buildStorefronts() {
  // Ground-floor shops: glass front, warm interior glow, striped awning, neon sign.
  const groundY = 0.96; // walkable surface

  State.buildings.forEach((b) => {
    const { mesh, style } = b;
    const w = mesh.userData.width;
    const bx = mesh.position.x;
    const bz = mesh.position.z;

    // Choose the inward-facing side (toward the intersection / road).
    const xDominant = Math.abs(bx) >= Math.abs(bz);
    const faceCenter = new THREE.Vector3();
    if (xDominant) {
      faceCenter.set(bx - Math.sign(bx) * (w / 2 + 0.05), groundY + 1.5, bz);
    } else {
      const d = mesh.userData.depth;
      faceCenter.set(bx, groundY + 1.5, bz - Math.sign(bz) * (d / 2 + 0.05));
    }

    const shop = makeStorefront(style);
    shop.position.copy(faceCenter);
    // Orient the shop front toward the center of the block.
    const towardCenter = new THREE.Vector3(bx * 0.25, groundY + 1.5, bz * 0.25);
    shop.lookAt(towardCenter);
    mesh.add(shop);
  });
}

function makeStorefront(style) {
  const g = new THREE.Group();
  const groundY = 0.96;
  const shopH = 2.2;

  // Warm interior glow panel (behind the glass).
  const interiorMat = new THREE.MeshStandardMaterial({
    color: 0x2a1e14,
    emissive: 0xffb870,
    emissiveIntensity: 0.9,
    roughness: 0.9,
  });
  const interior = new THREE.Mesh(new THREE.PlaneGeometry(2.6, shopH - 0.4), interiorMat);
  interior.position.set(0, shopH / 2, -0.12);
  g.add(interior);

  // Slightly tinted glass in front.
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9fc4d0,
    emissive: 0x2a3a44,
    emissiveIntensity: 0.3,
    roughness: 0.15,
    metalness: 0.6,
    transparent: true,
    opacity: 0.55,
  });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.6, shopH - 0.4), glassMat);
  glass.position.set(0, shopH / 2, 0.02);
  g.add(glass);

  // Frame pillars.
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a322c, roughness: 0.8, metalness: 0.3 });
  [-1.35, 1.35].forEach((x) => {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.12, shopH, 0.14), frameMat);
    pillar.position.set(x, shopH / 2, 0.05);
    pillar.castShadow = true;
    g.add(pillar);
  });
  // Transom above glass.
  const transom = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.28, 0.18), frameMat);
  transom.position.set(0, shopH - 0.14, 0.05);
  g.add(transom);

  // Striped awning sloping forward.
  const awning = makeAwning();
  awning.position.set(0, shopH - 0.02, 0.28);
  awning.rotation.x = -0.35;
  g.add(awning);

  return g;
}

function makeAwning() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d");
  const stripes = 10;
  const w = c.width / stripes;
  // Warm cream base with deeper accent stripes.
  ctx.fillStyle = "#f3e4c8";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#b8442f";
  for (let i = 0; i < stripes; i += 2) {
    ctx.fillRect(i * w, 0, w, c.height);
  }
  const tex = new THREE.CanvasTexture(c);
  const awningMat = new THREE.MeshStandardMaterial({
    map: tex,
    side: THREE.DoubleSide,
    roughness: 0.95,
    emissive: 0x3a1a10,
    emissiveIntensity: 0.25,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.12, 0.7), awningMat);
  box.castShadow = true;
  const g = new THREE.Group();
  g.add(box);
  return g;
}

function makeSign(text, color) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  const col = new THREE.Color(color);
  ctx.font = "bold 54px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "#" + col.getHexString();
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#" + col.getHexString();
  ctx.fillText(text.slice(0, 12), c.width / 2, c.height / 2);
  ctx.shadowBlur = 0;
  ctx.fillText(text.slice(0, 12), c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  const signMat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: 1.4,
    roughness: 0.4,
  });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.62, 0.08), signMat);
  sign.castShadow = true;
  return sign;
}

// ============================================================================
//  Props: street lamps + trees
// ============================================================================
function buildProps() {
  const propGroup = new THREE.Group();
  scene.add(propGroup);

  // --- Street lamps (clickable, warm glow) ---
  const lampSpots = [
    [2.7, 3.2], [-2.7, 3.2], [2.7, -3.2], [-2.7, -3.2],
    [2.7, 9.5], [-2.7, 9.5], [2.7, -9.5], [-2.7, -9.5],
    [3.2, 2.7], [3.2, -2.7], [9.5, 2.7], [9.5, -2.7],
  ];
  lampSpots.forEach(([x, z]) => {
    const lamp = makeLamp();
    lamp.position.set(x, 0.96, z);
    lamp.rotation.y = Math.random() * Math.PI;
    propGroup.add(lamp);
  });

  // --- Trees on the grass blocks ---
  const treeSpots = [
    [6.5, 2.6], [10.5, 2.6], [-6.5, 2.6], [-10.5, 2.6],
    [6.5, -2.6], [10.5, -2.6], [-6.5, -2.6], [-10.5, -2.6],
    [2.6, 6.5], [2.6, 10.5], [-2.6, 6.5], [-2.6, 10.5],
    [2.6, -6.5], [2.6, -10.5], [-2.6, -6.5], [-2.6, -10.5],
  ];
  treeSpots.forEach(([x, z]) => {
    const tree = makeTree();
    tree.position.set(x, 0.96, z);
    tree.scale.setScalar(rand(0.8, 1.25));
    propGroup.add(tree);
  });

  // --- Benches + fire hydrants along the sidewalks ---
  const benchSpots = [
    [4.2, 2.1], [-4.2, 2.1], [4.2, -2.1], [-4.2, -2.1],
  ];
  benchSpots.forEach(([x, z]) => {
    const bench = makeBench();
    bench.position.set(x, 0.96, z);
    bench.rotation.y = x > 0 ? -Math.PI / 2 : Math.PI / 2;
    propGroup.add(bench);
  });

  const hydrantSpots = [
    [2.1, 5.5], [-2.1, 5.5], [2.1, -5.5], [-2.1, -5.5],
  ];
  hydrantSpots.forEach(([x, z]) => {
    const h = makeHydrant();
    h.position.set(x, 0.96, z);
    propGroup.add(h);
  });
}

function makeLamp() {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2a30, roughness: 0.6, metalness: 0.6 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 3.2, 10), poleMat);
  pole.position.y = 1.6;
  pole.castShadow = true;
  g.add(pole);

  // Curved arm.
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 8), poleMat);
  arm.position.set(0.45, 3.1, 0);
  arm.rotation.z = Math.PI / 2.4;
  g.add(arm);

  // Lamp head (glowing globe).
  const globeMat = new THREE.MeshStandardMaterial({
    color: 0xffd9a0,
    emissive: 0xffcf8e,
    emissiveIntensity: 2.2,
    roughness: 0.3,
  });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), globeMat);
  globe.position.set(0.8, 3.25, 0);
  g.add(globe);

  // Warm point light.
  const light = new THREE.PointLight(0xffcf8e, 14, 11, 1.8);
  light.position.set(0.8, 3.2, 0);
  light.castShadow = false; // perf: few lights cast shadows
  g.add(light);

  g.userData.isLamp = true;
  g.userData.globeMat = globeMat;
  g.userData.light = light;
  g.userData.baseIntensity = 14;
  State.lamps.push({ group: g, light, globeMat, on: true });
  return g;
}

function makeTree() {
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3f2c, roughness: 0.95 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.4, 8), trunkMat);
  trunk.position.y = 0.7;
  trunk.castShadow = true;
  g.add(trunk);

  const leafColors = [0x3f6b3a, 0x4a7a3f, 0x356033, 0x5a8a4a];
  const leafMat = new THREE.MeshStandardMaterial({
    color: pick(leafColors),
    roughness: 0.95,
    flatShading: true,
  });
  // Clustered spheres for a soft, cozy canopy.
  const clusters = [
    [0, 1.9, 0, 0.9],
    [0.5, 1.6, 0.3, 0.6],
    [-0.5, 1.6, -0.3, 0.6],
    [0.2, 2.35, -0.2, 0.55],
  ];
  clusters.forEach(([x, y, z, r]) => {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leafMat);
    s.position.set(x, y, z);
    s.castShadow = true;
    s.receiveShadow = true;
    g.add(s);
  });
  return g;
}

function makeBench() {
  const g = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.9 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.6, metalness: 0.5 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.4), woodMat);
  seat.position.set(0, 0.5, 0);
  seat.castShadow = true;
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.1), woodMat);
  back.position.set(0, 0.75, -0.16);
  back.rotation.x = -0.15;
  g.add(back);
  [-0.5, 0.5].forEach((x) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.35), ironMat);
    leg.position.set(x, 0.25, 0.02);
    g.add(leg);
  });
  return g;
}

function makeHydrant() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb33028, roughness: 0.7, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.55, 10), mat);
  body.position.y = 0.28;
  body.castShadow = true;
  g.add(body);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  top.position.y = 0.55;
  g.add(top);
  return g;
}

// ============================================================================
//  Vehicles (cars driving along the roads)
// ============================================================================
function buildVehicles() {
  // A couple of cars per lane, each travelling along a road axis.
  const lanes = [
    { axis: "x", lane: 1.05, dir: 1, z: 1.05 },
    { axis: "x", lane: -1.05, dir: -1, z: -1.05 },
    { axis: "z", lane: 1.05, dir: 1, x: 1.05 },
    { axis: "z", lane: -1.05, dir: -1, x: -1.05 },
    { axis: "x", lane: 1.05, dir: 1, z: 7.5 },
    { axis: "x", lane: -1.05, dir: -1, z: -7.5 },
  ];

  const colors = [0xc0403a, 0x3f6ab0, 0xd8b23a, 0x3faa6a, 0x9a5ab0, 0xd97a3a, 0x3a6a7a];

  lanes.forEach((lane, i) => {
    const car = makeCar(pick(colors));
    const start = rand(-11, 11);
    if (lane.axis === "x") {
      car.position.set(start, 0.96, lane.z);
    } else {
      car.position.set(lane.x, 0.96, start);
    }
    // Face the car in its direction of travel.
    car.rotation.y = lane.dir > 0 ? 0 : Math.PI;
    scene.add(car);
    State.cars.push({
      group: car,
      axis: lane.axis,
      speed: rand(1.4, 2.8) * lane.dir,
      range: 12,
      start,
      lanePos: start,
    });
  });
}

function makeCar(color) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.5, metalness: 0.2 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9fc4d0,
    emissive: 0x223340,
    roughness: 0.1,
    metalness: 0.4,
    transparent: true,
    opacity: 0.6,
  });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3020 });

  // Chassis.
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.45, 0.95), bodyMat);
  chassis.position.y = 0.42;
  chassis.castShadow = true;
  g.add(chassis);

  // Cabin.
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.42, 0.85), bodyMat);
  cabin.position.set(-0.05, 0.82, 0);
  cabin.castShadow = true;
  g.add(cabin);

  // Windshield.
  const wind = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.34, 0.8), glassMat);
  wind.position.set(0.18, 0.82, 0);
  g.add(wind);

  // Wheels.
  const wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.16, 14);
  [[0.62, 0.5], [0.62, -0.5], [-0.62, 0.5], [-0.62, -0.5]].forEach(([x, z]) => {
    const wheel = new THREE.Mesh(wheelGeo, darkMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.28, z);
    g.add(wheel);
  });

  // Head- and tail-lights.
  const headL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.2), lightMat);
  headL.position.set(1.02, 0.4, 0.32);
  g.add(headL);
  const headR = headL.clone();
  headR.position.set(1.02, 0.4, -0.32);
  g.add(headR);
  const tailL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.2), tailMat);
  tailL.position.set(-1.02, 0.4, 0.32);
  g.add(tailL);
  const tailR = tailL.clone();
  tailR.position.set(-1.02, 0.4, -0.32);
  g.add(tailR);

  return g;
}

// ============================================================================
//  Pedestrians (tiny figures with outfits, walking)
// ============================================================================
function buildPedestrians() {
  const groundY = 0.96;
  const walkSpots = [
    { axis: "x", pos: 2.6, range: 11, dir: 1 },
    { axis: "x", pos: -2.6, range: 11, dir: -1 },
    { axis: "x", pos: 6.5, range: 6, dir: 1 },
    { axis: "x", pos: -6.5, range: 6, dir: -1 },
    { axis: "x", pos: 10.5, range: 5, dir: 1 },
    { axis: "z", pos: 2.6, range: 11, dir: 1 },
    { axis: "z", pos: -2.6, range: 11, dir: -1 },
    { axis: "z", pos: 9.5, range: 6, dir: 1 },
  ];

  walkSpots.forEach((s) => {
    const ped = makePedestrian();
    const start = rand(-s.range, s.range);
    if (s.axis === "x") {
      ped.position.set(start, groundY, s.pos);
    } else {
      ped.position.set(s.pos, groundY, start);
    }
    ped.rotation.y = s.dir > 0 ? 0 : Math.PI;
    scene.add(ped);
    State.peds.push({
      group: ped,
      axis: s.axis,
      speed: rand(0.5, 1.0) * s.dir,
      range: s.range,
      pos: start,
    });
  });
}

function makePedestrian() {
  const g = new THREE.Group();

  const skinTones = [0xf1c8a0, 0xd9a066, 0xb0703a, 0x6b4423, 0xffdbb0];
  const shirtColors = [
    0xc9506, 0xe05a52, 0x4f7cc0, 0x3f9a6a, 0xd8a030, 0x8a5ab0, 0xe08a40, 0x3a8aa0, 0xd0d0d0, 0x8a3a5a,
  ];
  const pantColors = [0x33404f, 0x2a2a30, 0x5a4632, 0x3a4a5a, 0x202028, 0x6a5030];
  const hairColors = [0x1a1210, 0x3a2a1a, 0x6a4a2a, 0x8a5a30, 0x202020, 0xb04020];

  const skin = new THREE.Color(pick(skinTones));
  const shirt = new THREE.Color(pick(shirtColors));
  const pants = new THREE.Color(pick(pantColors));
  const hair = new THREE.Color(pick(hairColors));

  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.85 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const pantMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.95 });

  // Legs (animated). Two boxes pivoting from the hip.
  const legGeo = new THREE.BoxGeometry(0.14, 0.45, 0.14);
  const leftLeg = new THREE.Mesh(legGeo, pantMat);
  leftLeg.geometry.translate(0, -0.225, 0);
  leftLeg.position.set(-0.1, 0.45, 0);
  g.add(leftLeg);
  const rightLeg = new THREE.Mesh(legGeo, pantMat);
  rightLeg.geometry.translate(0, -0.225, 0);
  rightLeg.position.set(0.1, 0.45, 0);
  g.add(rightLeg);

  // Torso.
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.45, 0.18), shirtMat);
  torso.position.set(0, 0.82, 0);
  torso.castShadow = true;
  g.add(torso);

  // Arms.
  const armGeo = new THREE.BoxGeometry(0.09, 0.4, 0.09);
  const leftArm = new THREE.Mesh(armGeo, shirtMat);
  leftArm.position.set(-0.18, 0.82, 0);
  leftArm.geometry.translate(0, -0.2, 0);
  g.add(leftArm);
  const rightArm = new THREE.Mesh(armGeo, shirtMat);
  rightArm.position.set(0.18, 0.82, 0);
  rightArm.geometry.translate(0, -0.2, 0);
  g.add(rightArm);

  // Head + hair.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), skinMat);
  head.position.set(0, 1.12, 0);
  head.castShadow = true;
  g.add(head);
  const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 12, 0, Math.PI * 2, 0, Math.PI / 2), hairMat);
  hairMesh.position.set(0, 1.13, 0);
  g.add(hairMesh);

  g.userData.legs = [leftLeg, rightLeg];
  g.userData.arms = [leftArm, rightArm];
  g.userData.phase = rand(0, Math.PI * 2);
  return g;
}

// ============================================================================
//  Atmosphere: particles (fireflies / gentle drift) + sky dome
// ============================================================================
function buildAtmosphere() {
  // --- Sky dome: a warm-to-deep gradient ---
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 256;
  const ctx = c.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, "#0a0a1a");
  grad.addColorStop(0.35, "#1a1638");
  grad.addColorStop(0.65, "#3a2a4a");
  grad.addColorStop(0.85, "#6a4a4a");
  grad.addColorStop(1.0, "#8a5a3a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 256);
  const skyTex = new THREE.CanvasTexture(c);
  skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(180, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
  );
  scene.add(skyDome);

  // --- Stars ---
  const starCount = 400;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const v = new THREE.Vector3().randomDirection();
    // Only on the upper hemisphere.
    if (v.y < 0.1) v.y = 0.1;
    v.multiplyScalar(170);
    starPos[i * 3] = v.x;
    starPos[i * 3 + 1] = v.y;
    starPos[i * 3 + 2] = v.z;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xfff4e0, size: 0.7, sizeAttenuation: true, fog: false })
  );
  scene.add(stars);

  // --- Drifting warm dust / fireflies ---
  const pCount = 220;
  const pPos = new Float32Array(pCount * 3);
  const pSeed = [];
  for (let i = 0; i < pCount; i++) {
    const x = rand(-15, 15);
    const y = rand(1.2, 12);
    const z = rand(-15, 15);
    pPos[i * 3] = x;
    pPos[i * 3 + 1] = y;
    pPos[i * 3 + 2] = z;
    pSeed.push({ x: rand(0.1, 0.4), y: rand(0.05, 0.2), z: rand(0.1, 0.4), phase: rand(0, 6.28) });
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  const particles = new THREE.Points(
    pGeo,
    new THREE.PointsMaterial({
      color: 0xffe0a0,
      size: 0.14,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  particles.userData.seed = pSeed;
  scene.add(particles);
  State.particles = particles;
}
// ============================================================================
let audioCtx = null;
let musicNodes = {};

// Lo-fi chord progression (root Hz + quality). Each chord lasts 4 beats.
const CHORDS = [
  { root: 220.00, offsets: [0, 4, 7, 11] }, // Amaj7
  { root: 196.00, offsets: [0, 3, 7, 10] }, // Gm7
  { root: 164.81, offsets: [0, 3, 7, 10] }, // Em7
  { root: 146.83, offsets: [0, 4, 7, 11] }, // Dmaj7
  { root: 130.81, offsets: [0, 4, 7, 11] }, // Cmaj7
];
const BEATS_PER_CHORD = 4;
const TOTAL_BEATS = CHORDS.length * BEATS_PER_CHORD; // 20-beat loop
const TEMPO = 70;
const SECONDS_PER_BEAT = 60 / TEMPO;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.15;

let schedulerTimer = null;
let beatIndex = 0;
let nextNoteTime = 0;
let musicPlaying = false;

function initAudio() {
  if (audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AC();

  // Master chain: -> lowpass (lo-fi warmth) -> reverb send -> master gain -> out.
  const master = audioCtx.createGain();
  master.gain.value = 0.0;

  const lowpass = audioCtx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 3200;
  lowpass.Q.value = 0.6;

  const reverb = audioCtx.createConvolver();
  reverb.buffer = makeImpulse(2.4, 3.0);

  const reverbGain = audioCtx.createGain();
  reverbGain.gain.value = 0.32;

  const dryGain = audioCtx.createGain();
  dryGain.gain.value = 0.85;

  master.connect(lowpass);
  lowpass.connect(dryGain).connect(audioCtx.destination);
  lowpass.connect(reverb).connect(reverbGain).connect(audioCtx.destination);

  // Master fade envelope (ramped in startMusic / stopMusic).
  const masterGain = audioCtx.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(master);

  // A tape/vinyl hiss for that lo-fi texture.
  const hissGain = audioCtx.createGain();
  hissGain.gain.value = 0.012;
  const hissFilter = audioCtx.createBiquadFilter();
  hissFilter.type = "bandpass";
  hissFilter.frequency.value = 1800;
  hissFilter.Q.value = 0.4;
  const hissBuf = makeNoiseBuffer(2.0);
  const hissSrc = audioCtx.createBufferSource();
  hissSrc.buffer = hissBuf;
  hissSrc.loop = true;
  hissSrc.connect(hissFilter).connect(hissGain).connect(master);
  hissSrc.start();

  musicNodes = {
    master,
    lowpass,
    reverb,
    reverbGain,
    dryGain,
    masterGain,
    hissGain,
  };
}

function makeNoiseBuffer(seconds) {
  const len = Math.floor(audioCtx.sampleRate * seconds);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function makeImpulse(seconds, decay) {
  const len = Math.floor(audioCtx.sampleRate * seconds);
  const buf = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function playOsc(freq, time, dur, type, gainVal, dest) {
  const osc = audioCtx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(gainVal, time + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  osc.connect(g).connect(dest);
  osc.start(time);
  osc.stop(time + dur + 0.05);
}

function playNoise(time, dur, type, freq, q, gainVal, dest) {
  const src = audioCtx.createBufferSource();
  src.buffer = makeNoiseBuffer(dur);
  src.start(time);
  src.stop(time + dur + 0.02);
  const filt = audioCtx.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = freq;
  filt.Q.value = q;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(gainVal, time);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  src.connect(filt).connect(g).connect(dest);
}

function scheduleBeat(beat, time) {
  const chordIdx = Math.floor((beat % TOTAL_BEATS) / BEATS_PER_CHORD);
  const beatInChord = beat % BEATS_PER_CHORD;
  const chord = CHORDS[chordIdx];
  const dest = musicNodes.masterGain;

  // Chord pad (soft triangle voices) on the first beat of each chord.
  if (beatInChord === 0) {
    chord.offsets.forEach((off, i) => {
      const freq = chord.root * Math.pow(2, off / 12);
      playOsc(freq, time, SECONDS_PER_BEAT * 4.2, "triangle", 0.12 / (i + 1), dest);
    });
    // Bass note an octave below the root.
    playOsc(chord.root / 2, time, SECONDS_PER_BEAT * 3.6, "sine", 0.28, dest);
  }

  // Occasional lo-fi piano single note (top of the chord) for melody.
  if (beatInChord % 2 === 0 && Math.random() < 0.55) {
    const topOff = chord.offsets[chord.offsets.length - 1];
    const freq = chord.root * Math.pow(2, topOff / 12);
    playOsc(freq * 2, time, SECONDS_PER_BEAT * 1.6, "sine", 0.06, dest);
  }

  // Drums.
  if (beatInChord === 0 || beatInChord === 2) {
    playOsc(150, time, 0.12, "sine", 0.5, dest); // kick body
    playOsc(80, time, 0.18, "sine", 0.35, dest); // kick sub
  }
  if (beatInChord === 1 || beatInChord === 3) {
    playNoise(time, 0.18, "bandpass", 1800, 0.7, 0.14, dest); // snare
  }
  // 8th-note hi-hats (schedule at half-beat offsets).
  playNoise(time, 0.05, "highpass", 7000, 0.5, 0.05, dest);
  playNoise(time + SECONDS_PER_BEAT / 2, 0.04, "highpass", 7500, 0.4, 0.035, dest);
}

function schedulerTick() {
  while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD) {
    scheduleBeat(beatIndex, nextNoteTime);
    nextNoteTime += SECONDS_PER_BEAT;
    beatIndex = (beatIndex + 1) % TOTAL_BEATS;
  }
  schedulerTimer = setTimeout(schedulerTick, LOOKAHEAD_MS);
}

function startMusic() {
  if (musicPlaying) return;
  initAudio();
  if (audioCtx.state === "suspended") audioCtx.resume();
  musicPlaying = true;
  beatIndex = 0;
  nextNoteTime = audioCtx.currentTime + 0.1;
  schedulerTick();
  // Fade master in.
  musicNodes.masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
  musicNodes.masterGain.gain.setValueAtTime(musicNodes.masterGain.gain.value, audioCtx.currentTime);
  musicNodes.masterGain.gain.linearRampToValueAtTime(1.0, audioCtx.currentTime + 1.5);
}

function stopMusic() {
  musicPlaying = false;
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  musicNodes.masterGain.gain.cancelScheduledValues(t);
  musicNodes.masterGain.gain.setValueAtTime(musicNodes.masterGain.gain.value, t);
  musicNodes.masterGain.gain.linearRampToValueAtTime(0.0, t + 0.6);
}
// ============================================================================
function initControls() {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.6;
  controls.minDistance = 6;
  controls.maxDistance = 45;
  controls.maxPolarAngle = Math.PI / 2.05; // keep above ground
  controls.target.copy(cameraHome.target);
  controls.update();
  controls.addEventListener("start", () => { userInteracting = true; });
  controls.addEventListener("end", () => { userInteracting = false; });
}

function onResize() {
  if (!renderer) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

// ============================================================================
//  UI wiring (buttons, overlay, captions)
// ============================================================================
function initUI() {
  const overlay = document.getElementById("start-overlay");
  const enterBtn = document.getElementById("enter-btn");
  const hud = document.getElementById("hud");
  const controlsEl = document.getElementById("controls");
  const caption = document.getElementById("caption");
  const captionText = document.getElementById("caption-text");
  const audioBtn = document.getElementById("audio-btn");
  const trafficBtn = document.getElementById("traffic-btn");
  const timeBtn = document.getElementById("time-btn");
  const resetBtn = document.getElementById("reset-btn");
  const clockEl = document.getElementById("clock");

  // --- Enter the diorama ---
  enterBtn.addEventListener("click", () => {
    overlay.classList.add("hidden");
    hud.classList.remove("hidden");
    controlsEl.classList.remove("hidden");
    State.musicOn = true;
    audioBtn.classList.add("active");
    startMusic();
  });

  // --- Music toggle ---
  audioBtn.addEventListener("click", () => {
    State.musicOn = !State.musicOn;
    audioBtn.classList.toggle("active", State.musicOn);
    if (State.musicOn) {
      startMusic();
    } else {
      stopMusic();
    }
  });

  // --- Traffic toggle ---
  trafficBtn.addEventListener("click", () => {
    State.trafficOn = !State.trafficOn;
    trafficBtn.classList.toggle("active", State.trafficOn);
  });
  trafficBtn.classList.add("active");

  // --- Time of day shift ---
  const timeLabels = ["Dawn", "Morning", "Noon", "Dusk", "Night"];
  let timeIndex = 0; // matches initial State.timeOfDay (0 = Dawn)
  timeBtn.addEventListener("click", () => {
    timeIndex = (timeIndex + 1) % timeLabels.length;
    State.timeOfDay = timeIndex / (timeLabels.length - 1); // 0..1
    updateSkyAndLight(State.timeOfDay);
    clockEl.textContent = timeLabels[timeIndex];
    showCaption(`Time of day: ${timeLabels[timeIndex]}`);
  });

  // --- Reset view ---
  resetBtn.addEventListener("click", () => {
    cameraReset = { active: true, t: 0 };
    showCaption("Resetting view");
  });

  // --- Caption ticker: gentle ambient messages ---
  const captions = [
    "Smoke curls from a rooftop chimney…",
    "The diner sign hums softly in the dark…",
    "A cat crosses the quiet street…",
    "Somewhere, a doorbell chimes…",
    "Warm light spills from the windows…",
  ];
  let captionIdx = 0;
  setInterval(() => {
    if (!State.musicOn) return;
    const msg = captions[captionIdx % captions.length];
    captionIdx++;
    showCaption(msg);
  }, 9000);

  // Start with a caption.
  showCaption(captions[0]);
}

// Camera reset animation state.
let cameraReset = null;

// ============================================================================
//  Interaction (raycasting on lamps / buildings)
// ============================================================================
let raycaster = new THREE.Raycaster();
let pointer = new THREE.Vector2();
let userInteracting = false;
let cameraIdleT = 0;

let captionTimer = null;
function showCaption(text) {
  const caption = document.getElementById("caption");
  const captionText = document.getElementById("caption-text");
  if (!caption || !captionText) return;
  captionText.textContent = text;
  caption.classList.add("show");
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => caption.classList.remove("show"), 3200);
}

function onPointerDown(event) {
  if (!renderer || !renderer.domElement) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  if (hits.length === 0) return;

  // Walk up to find a tagged interactive object (lamp or building).
  let obj = hits[0].object;
  while (obj && !obj.userData.isLamp && obj !== raycaster.target) {
    if (obj.userData.isBuilding) break;
    obj = obj.parent;
  }
  if (!obj) return;

  if (obj.userData.isLamp) {
    const lamp = State.lamps.find((l) => l.group === obj);
    if (lamp) {
      lamp.on = !lamp.on;
      lamp.light.intensity = lamp.on ? lamp.userData.baseIntensity : 1.5;
      lamp.globeMat.emissiveIntensity = lamp.on ? 2.2 : 0.35;
      showCaption(lamp.on ? "Lamp lit" : "Lamp dimmed");
    }
    return;
  }

  // Building click -> caption.
  const hit = State.buildings.find((b) => b.mesh === obj);
  if (hit) showCaption(`${hit.name} — warm lights on`);
}

// ============================================================================
//  Animation loop
// ============================================================================
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.elapsedTime;

  // Advance the world (shared with the steppable self-test).
  stepSimulation(dt);

  // Idle camera drift when the user isn't interacting.
  if (!userInteracting) {
    cameraIdleT += dt;
    camera.position.x = cameraHome.pos.x + Math.sin(cameraIdleT * 0.08) * 1.2;
    camera.position.z = cameraHome.pos.z + Math.cos(cameraIdleT * 0.06) * 1.0;
  }

  // Smooth camera reset.
  if (cameraReset && cameraReset.active) {
    cameraReset.t += dt * 1.5;
    const k = clamp(cameraReset.t, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    camera.position.lerpVectors(
      camera.position,
      cameraHome.pos,
      e
    );
    controls.target.lerpVectors(controls.target, cameraHome.target, e);
    if (k >= 1) cameraReset.active = false;
  }

  if (controls) controls.update();
  renderer.render(scene, camera);
}

// ============================================================================
//  Self-test hook (steppable loop, runs scripted assertions)
// ============================================================================
function registerSelfTest() {
  // In-page self-test: steps the simulation with scripted inputs and asserts
  // the core rules. Prints a single PASS/FAIL summary to the console.
  const results = [];
  const check = (name, cond) => results.push([name, !!cond]);

  // 1. World is populated.
  check("buildings placed", State.buildings.length >= 4);
  check("cars spawned", State.cars.length >= 2);
  check("pedestrians spawned", State.peds.length >= 2);
  check("lamps placed", State.lamps.length >= 2);
  check("window materials collected", windowMats.length >= 2);

  // 2. Each building has a beacon + named entry.
  check("all buildings named", State.buildings.every((b) => b.name));
  check("all buildings have beacon", State.buildings.every((b) => b.mesh.userData.beacon));

  // 3. Stepping the simulation advances cars and bobbing peds.
  const car0 = State.cars[0].group.position.x;
  const ped0y = State.peds[0].group.position.y;
  stepSimulation(0.05);
  const car0b = State.cars[0].group.position.x;
  const ped0yb = State.peds[0].group.position.y;
  check("car advances when stepped", Math.abs(car0b - car0) > 0.0001);
  check("pedestrian bobs when stepped", Math.abs(ped0yb - ped0y) > 0.00001);

  // 4. Time-of-day mapping: night is darker & windows glow brighter.
  const prevT = State.timeOfDay;
  window.__cozy.setTimeOfDay(1.0);
  const nightWindow = windowMats[0].emissiveIntensity;
  const nightFog = window.__cozy.scene.fog.color;
  window.__cozy.setTimeOfDay(0.4);
  const noonWindow = windowMats[0].emissiveIntensity;
  window.__cozy.setTimeOfDay(prevT);
  check("windows glow brighter at night", nightWindow > noonWindow);
  // Fog luminance (0..1) via RGB channels — portable across three versions.
  const lum = (c) => (c.r + c.g + c.b) / 3;
  check("fog is darker at night", lum(nightFog) < 0.4);

  // 5. Traffic toggle halts cars.
  State.trafficOn = false;
  const car1 = State.cars[1].group.position.x;
  stepSimulation(0.05);
  check("traffic halt stops cars", Math.abs(State.cars[1].group.position.x - car1) < 0.0001);
  State.trafficOn = true;

  // --- Summary ---
  const failed = results.filter(([, ok]) => !ok);
  const summary = document.createElement("div");
  summary.id = "selftest";
  summary.style.display = "block";
  summary.innerHTML =
    results.map(([n, ok]) => `${ok ? "✓" : "✗"} ${n}`).join("<br>") +
    `<br><b>${failed.length === 0 ? "PASS" : "FAIL"} (${results.length - failed.length}/${results.length})</b>`;
  document.body.appendChild(summary);
  console.log("%cCozy City Self-test: " + (failed.length === 0 ? "PASS" : "FAIL"),
    `color:${failed.length === 0 ? "#9e9" : "#e88"};font-weight:bold`);
  results.forEach(([n, ok]) => console.log(ok ? "  ✓" : "  ✗", n));

  // Keep the summary visible a moment, then hide it.
  setTimeout(() => { summary.style.display = "none"; }, 6000);
}

// ============================================================================
//  Boot
// ============================================================================
function boot() {
  initRenderer();
  initScene(); // builds the whole world
  initLighting();
  initControls();
  initUI();
  initAudio();

  window.addEventListener("resize", onResize);
  window.addEventListener("pointerdown", onPointerDown);

  clock = new THREE.Clock();
  State.running = true;
  animate();
  onResize();
  registerSelfTest();
}

window.__cozy = {
  State,
  get scene() {
    return scene;
  },
  get camera() {
    return camera;
  },
  get renderer() {
    return renderer;
  },
  get audioCtx() {
    return audioCtx;
  },
  get musicPlaying() {
    return musicPlaying;
  },
  boot,
  setTimeOfDay: (v) => {
    State.timeOfDay = v;
    updateSkyAndLight(v);
  },
  step: (dt) => {
    // single deterministic step for the self-test
    stepSimulation(dt || 0.016);
  },
};

// Exposed so both animate() and the self-test can share logic
function updateSkyAndLight(t) {
  // Keyframes across the day. `t` is 0..1 (0 = dawn, 1 = deep night).
  const KF = [
    { t: 0.00, sky: 0x2a1a2a, fog: 0x3a2a3a, amb: 0x5a4050, ambI: 0.5, sun: 0xffb066, sunI: 0.7, moon: 0x6a6a9a, moonI: 0.3, hemiS: 0x6a5a7a, hemiG: 0x201820, window: 0.6 },
    { t: 0.20, sky: 0x5a5a6a, fog: 0x5a5050, amb: 0x6a6070, ambI: 0.6, sun: 0xffe0b0, sunI: 1.1, moon: 0x4a4a6a, moonI: 0.1, hemiS: 0x8a8aa0, hemiG: 0x282028, window: 0.3 },
    { t: 0.40, sky: 0x7a7a80, fog: 0x6a6060, amb: 0x808090, ambI: 0.75, sun: 0xffffff, sunI: 1.4, moon: 0x3a3a5a, moonI: 0.0, hemiS: 0xa0a0c0, hemiG: 0x302830, window: 0.15 },
    { t: 0.60, sky: 0x4a2a2a, fog: 0x4a3030, amb: 0x4a3a4a, ambI: 0.45, sun: 0xff9050, sunI: 1.2, moon: 0x5a5a8a, moonI: 0.25, hemiS: 0x6a5a6a, hemiG: 0x1c1820, window: 0.7 },
    { t: 1.00, sky: 0x06060f, fog: 0x14101c, amb: 0x2a2a4a, ambI: 0.35, sun: 0x22223a, sunI: 0.15, moon: 0x9fb4ff, moonI: 0.9, hemiS: 0x3a3a6a, hemiG: 0x101018, window: 1.4 },
  ];

  // Bracket t between two keyframes.
  let a = KF[0], b = KF[KF.length - 1];
  for (let i = 0; i < KF.length - 1; i++) {
    if (t >= KF[i].t && t <= KF[i + 1].t) {
      a = KF[i];
      b = KF[i + 1];
      break;
    }
  }
  const span = b.t - a.t || 1;
  const f = clamp((t - a.t) / span, 0, 1);

  const sky = new THREE.Color(a.sky).lerp(new THREE.Color(b.sky), f);
  const fog = new THREE.Color(a.fog).lerp(new THREE.Color(b.fog), f);
  const amb = new THREE.Color(a.amb).lerp(new THREE.Color(b.amb), f);
  const sun = new THREE.Color(a.sun).lerp(new THREE.Color(b.sun), f);
  const moon = new THREE.Color(a.moon).lerp(new THREE.Color(b.moon), f);
  const hemiS = new THREE.Color(a.hemiS).lerp(new THREE.Color(b.hemiS), f);
  const hemiG = new THREE.Color(a.hemiG).lerp(new THREE.Color(b.hemiG), f);
  const windowI = lerp(a.window, b.window, f);

  if (skyDome) {
    // MeshBasicMaterial tints its map via .color; use it to shift the sky hue.
    skyDome.material.color.copy(sky);
  }
  scene.fog.color.copy(fog);

  ambientLight.color.copy(amb);
  ambientLight.intensity = lerp(a.ambI, b.ambI, f);
  sunLight.color.copy(sun);
  sunLight.intensity = lerp(a.sunI, b.sunI, f);
  moonLight.color.copy(moon);
  moonLight.intensity = lerp(a.moonI, b.moonI, f);
  hemiLight.color.copy(hemiS);
  hemiLight.groundColor.copy(hemiG);

  // Window glow scales with darkness (warmer & brighter at night).
  const nightFactor = clamp(t, 0, 1);
  const targetI = lerp(0.3, 1.6, nightFactor);
  windowMats.forEach((m) => {
    m.emissiveIntensity = targetI;
  });

  // Lamps glow stronger as it gets dark.
  const lampOn = clamp(t, 0, 1);
  State.lamps.forEach((l) => {
    if (!l.on) return;
    l.light.intensity = lerp(1.5, 16, lampOn);
    l.globeMat.emissiveIntensity = lerp(0.3, 2.4, lampOn);
  });
}

function stepSimulation(dt) {
  // Deterministic simulation clock, advances by dt each step (shared by the
  // animation loop and the steppable self-test).
  simTime += dt;
  const t = simTime;

  // --- Cars travel along their lanes and wrap around ---
  if (State.trafficOn) {
    State.cars.forEach((c) => {
      c.lanePos += c.speed * dt;
      if (c.lanePos > c.range) c.lanePos = -c.range;
      if (c.lanePos < -c.range) c.lanePos = c.range;
      if (c.axis === "x") {
        c.group.position.x = c.lanePos;
      } else {
        c.group.position.z = c.lanePos;
      }
    });
  }

  // --- Pedestrians wander along their paths ---
  State.peds.forEach((p) => {
    p.pos += p.speed * dt;
    if (p.pos > p.range) { p.pos = p.range; p.speed *= -1; }
    if (p.pos < -p.range) { p.pos = -p.range; p.speed *= -1; }
    if (p.axis === "x") {
      p.group.position.x = p.pos;
    } else {
      p.group.position.z = p.pos;
    }
    // Gentle walking bob + leg swing.
    const ph = p.group.userData.phase + t * 6;
    p.group.position.y = 0.96 + Math.abs(Math.sin(ph)) * 0.04;
    p.group.userData.legs.forEach((leg, i) => {
      leg.rotation.x = Math.sin(ph + (i ? Math.PI : 0)) * 0.5;
    });
    p.group.userData.arms.forEach((arm, i) => {
      arm.rotation.x = -Math.sin(ph + (i ? Math.PI : 0)) * 0.35;
    });
  });

  // --- Beacon twinkle ---
  State.buildings.forEach((b) => {
    if (b.mesh.userData.beaconMat) {
      const tw = 0.5 + 0.5 * Math.sin(t * 2 + b.mesh.position.x);
      b.mesh.userData.beaconMat.opacity = 0.4 + tw * 0.6;
    }
  });

  // --- Drifting particles ---
  if (State.particles) {
    const pos = State.particles.geometry.attributes.position;
    const seed = State.particles.userData.seed;
    for (let i = 0; i < pos.count; i++) {
      const s = seed[i];
      pos.array[i * 3] += Math.sin(t + s.phase) * s.x * dt;
      pos.array[i * 3 + 1] += Math.cos(t * 0.7 + s.phase) * s.y * dt;
      pos.array[i * 3 + 2] += Math.sin(t * 0.5 + s.phase + 1) * s.z * dt;
    }
    pos.needsUpdate = true;
  }
}

// Kick things off when the DOM is ready.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
