/* ============================================================
   City Time Machine — a cozy 3D diorama of one city block.
   Always 9 PM. Windows glow, cars loop, tiny people stroll,
   a lo-fi tape hums in the background.

   Sections:
     0. globals & helpers
     1. renderer / scene / camera / controls
     2. palette & canvas-texture helpers
     3. ground: base island, streets, sidewalks, plaza
     4. buildings: facades, roofs, awnings, signs, neon
     5. street furniture: lamps, trees, benches, crosswalks
     6. vehicles
     7. pedestrians
     8. ambience: stars, moon, string lights, birds
     9. lo-fi soundtrack (Web Audio, generative 16-bar loop)
    10. UI wiring
    11. animation loop
   ============================================================ */
'use strict';

/* ---------------- 0. globals & helpers ---------------- */

const TAU = Math.PI * 2;
const rand  = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick  = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp  = (a, b, t) => a + (b - a) * t;

// World layout (top view, +x east, +z south):
//   3x3 grid of 21x21 blocks; central block is the plaza.
//   streets (width 9) centered at x = 0 / ±15 and z = 0 / ±15
//   block centers at 0 / ±30; world extent ±40.5
const LANE = 2.4;          // lane center offset from street centerline
const V_STREETS = [-15, 0, 15];
const H_STREETS = [-15, 0, 15];
const BLOCK_CENTERS = [-30, 0, 30];

const state = {
  t: 0,                    // world clock (seconds), steppable
  step: 0.016,             // fixed step used by the self-test
  paused: false,
  soundOn: true,           // user preference; audio starts after a gesture
  audioStarted: false,
  autoSpin: true,
  cars: [],                // { group, speed, axis, dir, pos, kind }
  people: [],              // { group, path, perim, t, speed, phase }
  birds: [],               // { group, r, speed, phase, height }
  twinkle: [],             // star sprites { sprite, phase, speed }
  lampFlicker: [],         // { light, base, phase }
  signFlicker: [],         // { mat, base, phase, kind }
  stringLights: [],        // { light, base, phase }
  fountainDrops: [],       // { mesh, phase }
};

// Shared materials & textures (created in section 1/2)
let renderer, scene, camera, controls;
let MAT = {};              // shared materials
let TEX = {};              // shared canvas textures

// Diagnostics exposed for the in-page self-test
window.__city = {
  state,
  scene: null,               // set in boot, used by diagnostics/self-test
  step(dt) { state.t += dt; updateWorld(state.t, dt); },
  snapshot() {
    return {
      t: state.t,
      cars: state.cars.length,
      people: state.people.length,
      birds: state.birds.length,
      lamps: state.lampFlicker.length,
      signs: state.signFlicker.length,
      audio: {
        started: state.audioStarted,
        on: state.soundOn,
        time: audio ? audio.ctx.currentTime : 0,
        playing: !!(audio && audio.ctx && audio.ctx.state === 'running'),
      },
      camera: { pos: camera.position.toArray(), target: controls.target.toArray() },
    };
  },
};

/* ---------------- 1. renderer / scene / camera / controls ---------------- */

function initRenderer() {
  const stage = document.getElementById('stage');
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  stage.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141026);
  scene.fog = new THREE.FogExp2(0x191230, 0.0085);

  camera = new THREE.PerspectiveCamera(
    42, window.innerWidth / window.innerHeight, 0.1, 500
  );
  camera.position.set(36, 27, 42);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 4.5, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 16;
  controls.maxDistance = 110;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.38;
  controls.autoRotate = state.autoSpin;
  controls.autoRotateSpeed = 0.4;

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function initLights() {
  // Cool moonlight from the west-north, warm fill from below.
  const hemi = new THREE.HemisphereLight(0x4a4370, 0x2a1c14, 0.7);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0x33241c, 0.6);
  scene.add(ambient);

  const moon = new THREE.DirectionalLight(0x93a7ff, 0.65);
  moon.position.set(-42, 58, -34);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -48;
  moon.shadow.camera.right = 48;
  moon.shadow.camera.top = 48;
  moon.shadow.camera.bottom = -48;
  moon.shadow.camera.near = 10;
  moon.shadow.camera.far = 140;
  moon.shadow.bias = -0.0006;
  scene.add(moon);
}

function initSky() {
  buildStars();
  buildMoon();
}

/* ---------------- 2. palette & canvas-texture helpers ---------------- */

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function roundedRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function canvasTexture(w, h, draw) {
  const canvas = makeCanvas(w, h);
  draw(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.encoding = THREE.sRGBEncoding;
  tex.anisotropy = 8;
  return tex;
}

// Warm window glow colors, cool dark glass, and misc.
const WARM_WINDOWS = ['#ffd9a0', '#ffc07a', '#ffe9c9', '#f7b96b', '#ffd28f'];
const DARK_GLASS = '#232a45';

function buildMaterials() {
  MAT.metalDark = new THREE.MeshStandardMaterial({ color: 0x2b2733, roughness: 0.45, metalness: 0.65 });
  MAT.metalMid  = new THREE.MeshStandardMaterial({ color: 0x4a4258, roughness: 0.5, metalness: 0.5 });
  MAT.wood      = new THREE.MeshStandardMaterial({ color: 0x8a5a3b, roughness: 0.85, metalness: 0 });
  MAT.woodDark  = new THREE.MeshStandardMaterial({ color: 0x5e3c26, roughness: 0.9, metalness: 0 });
  MAT.concrete  = new THREE.MeshStandardMaterial({ color: 0x8d8794, roughness: 0.95, metalness: 0 });
  MAT.grass     = new THREE.MeshStandardMaterial({ color: 0x3f5e3a, roughness: 1, metalness: 0 });
  MAT.lampHead  = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  MAT.glassWarm = new THREE.MeshStandardMaterial({
    color: 0x1c1526, emissive: 0xffb877, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.2,
  });
  MAT.glassCool = new THREE.MeshStandardMaterial({
    color: 0x141a2e, emissive: 0x9fb4e8, emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.2,
  });
  MAT.neonPink  = new THREE.MeshBasicMaterial({ color: 0xff77c8, transparent: true });
  MAT.neonBlue  = new THREE.MeshBasicMaterial({ color: 0x74d4ff, transparent: true });
  MAT.neonAmber = new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true });
}

/* ---------------- 3. ground: base island, streets, sidewalks, plaza ---------------- */

function buildStreetTexture() {
  const S = 2048;                 // px for the full 91x91 ground
  const px = (u) => (u + 45.5) * (S / 91);
  const u = (n) => n * S / 91;    // meters -> px

  return canvasTexture(S, S, (c) => {
    // --- sidewalks everywhere first ---
    c.fillStyle = '#57525f';
    c.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) {
      c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
      c.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }

    // --- asphalt strips (3 vertical + 3 horizontal streets) ---
    for (const x of V_STREETS) {
      c.fillStyle = '#2f2d38';
      c.fillRect(px(x - 4.5), 0, u(9), S);          // vertical street
    }
    for (const z of H_STREETS) {
      c.fillStyle = '#2f2d38';
      c.fillRect(0, px(z - 4.5), S, u(9));          // horizontal street
    }
    for (let i = 0; i < 7000; i++) {
      c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)';
      c.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }

    // --- curbs around each outer block ---
    c.strokeStyle = '#1f1d26';
    c.lineWidth = u(0.35);
    for (const bx of BLOCK_CENTERS) {
      for (const bz of BLOCK_CENTERS) {
        if (bx === 0 && bz === 0) continue;         // plaza handled separately
        c.strokeRect(px(bx - 10.5), px(bz - 10.5), u(21), u(21));
      }
    }

    // --- center dashed lane lines ---
    c.strokeStyle = '#c9a35e';
    c.lineWidth = u(0.22);
    c.setLineDash([u(2.2), u(2.4)]);
    for (const x of V_STREETS) {
      c.beginPath(); c.moveTo(px(x), 0); c.lineTo(px(x), S); c.stroke();
    }
    for (const z of H_STREETS) {
      c.beginPath(); c.moveTo(0, px(z)); c.lineTo(S, px(z)); c.stroke();
    }
    c.setLineDash([]);

    // --- crosswalks on every approach to every intersection ---
    const stripe = (x0, z0, horiz) => {
      c.save();
      c.translate(px(x0), px(z0));
      if (horiz) c.rotate(Math.PI / 2);
      const n = 7, gap = u(0.55), len = u(3.1);
      const total = n * gap * 2 - gap;
      c.fillStyle = 'rgba(235, 230, 220, 0.85)';
      for (let i = 0; i < n; i++) c.fillRect(-total / 2 + i * gap * 2, -len / 2, gap, len);
      c.restore();
    };
    for (const x of V_STREETS) {
      for (const z of H_STREETS) {
        stripe(x, z - 5.4, false);   // cross the vertical street, north side
        stripe(x, z + 5.4, false);   // south side
        stripe(x - 5.4, z, true);    // cross the horizontal street, west side
        stripe(x + 5.4, z, true);    // east side
      }
    }

    // --- central plaza: warm cobblestones + ring path ---
    c.save();
    c.beginPath();
    c.rect(px(-10.5), px(-10.5), u(21), u(21));
    c.clip();
    c.fillStyle = '#4a4453';
    c.fillRect(px(-10.5), px(-10.5), u(21), u(21));
    const stone = 21 / 26;
    for (let gy = 0; gy < 26; gy++) {
      for (let gx = 0; gx < 26; gx++) {
        const shade = 58 + Math.floor(Math.random() * 26);
        c.fillStyle = `rgb(${shade + 14}, ${shade + 6}, ${shade - 4})`;
        const jx = (gx + (gy % 2 ? 0.5 : 0)) * stone - 10.5;
        const jz = gy * stone - 10.5;
        roundedRect(c, px(jx) + 1.5, px(jz) + 1.5, u(stone) - 3, u(stone) - 3, 4);
        c.fill();
      }
    }
    c.strokeStyle = '#6b6272';
    c.lineWidth = u(2.6);
    c.beginPath();
    c.arc(px(0), px(0), u(5.6), 0, TAU);
    c.stroke();
    c.fillStyle = 'rgba(120, 100, 130, 0.25)';
    c.beginPath();
    c.arc(px(0), px(0), u(1.4), 0, TAU);
    c.fill();
    c.restore();

    // --- faint wear stains ---
    for (let i = 0; i < 26; i++) {
      const vertical = Math.random() < 0.5;
      const x = vertical ? pick(V_STREETS) + rand(-3, 3) : rand(-40, 40);
      const z = vertical ? rand(-40, 40) : pick(H_STREETS) + rand(-3, 3);
      c.fillStyle = `rgba(0,0,0,${rand(0.03, 0.09)})`;
      c.beginPath();
      c.ellipse(px(x), px(z), rand(1, 4) * u(1), rand(0.6, 2.4) * u(1), rand(0, TAU), 0, TAU);
      c.fill();
    }
  });
}

function buildBase() {
  const base = new THREE.Group();

  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(90, 4.6, 90),
    new THREE.MeshStandardMaterial({ color: 0x241c33, roughness: 0.95 })
  );
  slab.position.y = -2.3;
  base.add(slab);

  const rim = new THREE.Mesh(
    new THREE.BoxGeometry(92.4, 1.1, 92.4),
    new THREE.MeshStandardMaterial({ color: 0x171226, roughness: 1 })
  );
  rim.position.y = -4.55;
  base.add(rim);

  // soft glow beneath the island
  const glowTex = canvasTexture(256, 256, (c) => {
    const g = c.createRadialGradient(128, 128, 10, 128, 128, 128);
    g.addColorStop(0, 'rgba(122, 96, 190, 0.5)');
    g.addColorStop(0.55, 'rgba(90, 66, 140, 0.18)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 256);
  });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, transparent: true, depthWrite: false, opacity: 0.8,
  }));
  glow.scale.set(130, 130, 1);
  glow.position.y = -6.5;
  base.add(glow);

  scene.add(base);
}

function buildGround() {
  buildBase();
  TEX.streets = buildStreetTexture();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(91, 91),
    new THREE.MeshStandardMaterial({ map: TEX.streets, roughness: 0.94, metalness: 0.02 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

/* ---------------- 4. buildings: facades, roofs, awnings, signs, neon ---------------- */

const WALL_PALETTES = [
  { wall: '#c9a97e', trim: '#8a6a4a', roof: '#5a4636' }, // warm sand
  { wall: '#b0765c', trim: '#7c4a38', roof: '#4e3630' }, // terracotta
  { wall: '#9aa3a8', trim: '#6f777d', roof: '#494f55' }, // slate grey
  { wall: '#c7b48f', trim: '#93805f', roof: '#5c5138' }, // cream
  { wall: '#a86a52', trim: '#75463a', roof: '#463029' }, // brick red
  { wall: '#8f7d6b', trim: '#64564a', roof: '#3f352d' }, // taupe
  { wall: '#b58a8f', trim: '#82606a', roof: '#4e3a40' }, // dusty rose
  { wall: '#7e8f76', trim: '#5a6852', roof: '#3c463a' }, // sage
];

// Draw one facade onto canvas c (W x H px) for a face `faceMeters` wide.
function drawFacade(c, W, H, spec, face) {
  const s = H / spec.h;               // px per meter
  const wM = face.w;
  const top = (y) => H - y * s;       // meters from ground -> canvas y

  // wall with subtle vertical shading
  const grad = c.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, spec.wall);
  grad.addColorStop(1, shade(spec.wall, -14));
  c.fillStyle = grad;
  c.fillRect(0, 0, W, H);

  const groundH = 4.3;                // storefront band height (m)
  const corniceH = 0.55;
  const floorH = (spec.h - groundH - corniceH) / spec.floors;

  // cornice
  c.fillStyle = spec.trim;
  c.fillRect(0, 0, W, corniceH * s);
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.fillRect(0, corniceH * s, W, 2);

  // upper windows
  const cols = Math.max(2, Math.round(wM / 2.6));
  const winW = 0.95, winH = 1.2;
  for (let i = 0; i < spec.floors; i++) {
    const yC = groundH + (i + 0.55) * floorH;
    // floor band line
    c.fillStyle = 'rgba(0,0,0,0.14)';
    c.fillRect(0, top(groundH + (i + 1) * floorH) , W, 2);
    for (let j = 0; j < cols; j++) {
      const xC = (j + 0.5) * (wM / cols);
      drawWindow(c, xC * s, top(yC), winW * s, winH * s);
    }
  }

  // ground floor
  if (face.isFront && spec.ground === 'shop') {
    drawStorefront(c, W, s, spec, groundH);
  } else {
    // plain wall band + optional door / windows
    c.fillStyle = shade(spec.wall, -10);
    c.fillRect(0, top(groundH), W, groundH * s);
    c.fillStyle = spec.trim;
    c.fillRect(0, top(groundH), W, 0.12 * s);
    if (face.isFront && spec.ground === 'door') {
      const dw = 1.15 * s, dh = 2.3 * s;
      c.fillStyle = spec.trim;
      c.fillRect(W / 2 - dw / 2 - 3, top(2.35), dw + 6, dh + 4);
      c.fillStyle = '#241c22';
      c.fillRect(W / 2 - dw / 2, top(2.35), dw, dh);
      c.fillStyle = '#d8b47a';
      c.beginPath();
      c.arc(W / 2 + dw / 2 - 8, top(1.15), 3, 0, TAU);
      c.fill();
    } else {
      const nWin = Math.max(1, Math.round(wM / 3.2));
      for (let j = 0; j < nWin; j++) {
        const xC = (j + 0.5) * (wM / nWin);
        drawWindow(c, xC * s, top(1.8), 1.4 * s, 1.5 * s);
      }
    }
  }

  // sidewalk kick
  c.fillStyle = '#57525f';
  c.fillRect(0, H - 0.35 * s, W, 0.35 * s);
}

function drawWindow(c, cx, cy, w, h) {
  const lit = Math.random() < 0.62;
  // frame
  c.fillStyle = 'rgba(20,16,26,0.9)';
  c.fillRect(cx - w / 2 - 3, cy - h / 2 - 3, w + 6, h + 6);
  if (lit) {
    const color = pick(WARM_WINDOWS);
    const g = c.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
    g.addColorStop(0, shade(color, -18));
    g.addColorStop(0.45, color);
    g.addColorStop(1, shade(color, -26));
    c.fillStyle = g;
    c.fillRect(cx - w / 2, cy - h / 2, w, h);
    // curtain band
    c.fillStyle = 'rgba(30,20,30,0.35)';
    c.fillRect(cx - w / 2, cy - h / 2, w, h * 0.28);
    if (Math.random() < 0.2) { // mullion cross
      c.fillStyle = 'rgba(20,16,26,0.7)';
      c.fillRect(cx - 1.5, cy - h / 2, 3, h);
      c.fillRect(cx - w / 2, cy - 1.5, w, 3);
    }
  } else {
    const g = c.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
    g.addColorStop(0, '#39415f');
    g.addColorStop(1, DARK_GLASS);
    c.fillStyle = g;
    c.fillRect(cx - w / 2, cy - h / 2, w, h);
  }
  // sill
  c.fillStyle = 'rgba(255,255,255,0.16)';
  c.fillRect(cx - w / 2 - 4, cy + h / 2 + 3, w + 8, 3);
}

function drawStorefront(c, W, s, spec, groundH) {
  const top = (y) => (512 / spec.h) * (spec.h - y); // note: s passed but recompute for safety
  const glassTop = 3.0, glassBot = 0.55;
  const gx0 = 0.55, gx1 = W - 0.55;

  // sign band
  const signTop = groundH, signBot = glassTop + 0.15;
  c.fillStyle = spec.sign ? spec.sign.bg : shade(spec.trim, -10);
  c.fillRect(0, top(signTop), W, (signTop - signBot) * s);
  if (spec.sign) {
    c.save();
    c.font = `700 ${Math.floor((signTop - signBot) * s * 0.52)}px "Trebuchet MS", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (spec.sign.glow) {
      c.shadowColor = spec.sign.color;
      c.shadowBlur = 22;
    }
    c.fillStyle = spec.sign.color;
    const ty = top((signTop + signBot) / 2) + 2;
    c.fillText(spec.sign.text, W / 2, ty);
    if (spec.sign.glow) c.fillText(spec.sign.text, W / 2, ty); // double pass = stronger glow
    c.restore();
  }

  // glass
  const g = c.createLinearGradient(0, top(glassTop), 0, top(glassBot));
  g.addColorStop(0, '#151020');
  g.addColorStop(0.5, '#2b1f2a');
  g.addColorStop(1, '#573a26');
  c.fillStyle = g;
  c.fillRect(gx0, top(glassTop), W - gx0 * 2, (glassTop - glassBot) * s);
  // mullions
  c.fillStyle = spec.trim;
  const nPanels = Math.max(3, Math.round((W / s) / 1.9));
  for (let i = 0; i <= nPanels; i++) {
    const x = gx0 + (i * (W - gx0 * 2)) / nPanels;
    c.fillRect(x - 2, top(glassTop), 4, (glassTop - glassBot) * s);
  }
  c.fillRect(gx0, top(glassTop), W - gx0 * 2, 4);
  // door
  const dw = 1.1 * s;
  const dx = W * 0.62;
  c.fillStyle = '#6b4a2e';
  c.fillRect(dx, top(2.6), dw, (2.6 - glassBot) * s);
  c.fillStyle = 'rgba(255,215,160,0.85)';
  c.fillRect(dx + 4, top(2.45), dw - 8, 1.5 * s);
  c.fillStyle = '#e8d8b0';
  c.beginPath();
  c.arc(dx + dw - 8, top(1.5), 3, 0, TAU);
  c.fill();
  // kick band
  c.fillStyle = spec.trim;
  c.fillRect(gx0 - 4, top(glassBot), W - gx0 * 2 + 8, (glassBot - 0.35) * s);
  // warm light spill onto sidewalk
  c.fillStyle = 'rgba(255,190,120,0.16)';
  c.fillRect(gx0, top(0.35), W - gx0 * 2, 0.35 * s);
}

function makeFacadeTexture(spec, faceW, isFront) {
  const H = 512;
  const W = clamp(Math.round((faceW / spec.h) * H), 96, 512);
  return canvasTexture(W, H, (c) => drawFacade(c, W, H, spec, { w: faceW, isFront }));
}

function addRoofUnit(group, w, d, h) {
  const y = h;
  // AC boxes
  const acCount = randi(1, 2);
  for (let i = 0; i < acCount; i++) {
    const ac = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.65, 0.9), MAT.metalDark);
    ac.position.set(rand(-w / 2 + 1.2, w / 2 - 1.2), y + 0.33, rand(-d / 2 + 1.2, d / 2 - 1.2));
    ac.castShadow = true;
    group.add(ac);
  }
  if (Math.random() < 0.45) {
    // water tower
    const tower = new THREE.Group();
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 1.1, 8), MAT.woodDark);
    legs.position.y = 0.55;
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.3, 12), MAT.wood);
    tank.position.y = 1.85;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.55, 12), MAT.woodDark);
    cap.position.y = 2.75;
    tower.add(legs, tank, cap);
    tower.position.set(w / 2 - 1.6, y, d / 2 - 1.6);
    tower.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    group.add(tower);
  }
}

function addAwning(group, w, d, spec) {
  const tex = canvasTexture(256, 64, (c) => {
    const n = 8;
    for (let i = 0; i < n; i++) {
      c.fillStyle = i % 2 ? spec.awning.c2 : spec.awning.c1;
      c.fillRect((i * 256) / n, 0, 256 / n, 64);
    }
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.fillRect(0, 56, 256, 8);
  });
  const aw = new THREE.Group();
  const slope = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.86, 0.09, 1.8),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })
  );
  slope.rotation.x = 0.21;
  slope.position.set(0, 3.02, d / 2 + 0.85);
  slope.castShadow = true;
  aw.add(slope);
  const fascia = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.86, 0.26, 0.07),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.awning.c2), roughness: 0.85 })
  );
  fascia.position.set(0, 2.92, d / 2 + 1.68);
  aw.add(fascia);
  group.add(aw);
}

// Vertical neon blade sign on a building corner (both faces).
function addNeonSign(group, spec) {
  const H = 512, W = 128;
  const tex = canvasTexture(W, H, (c) => {
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(10,8,16,0.9)';
    roundedRect(c, 8, 8, W - 16, H - 16, 18);
    c.fill();
    c.strokeStyle = spec.neon.color;
    c.lineWidth = 4;
    roundedRect(c, 10, 10, W - 20, H - 20, 16);
    c.stroke();
    c.save();
    c.translate(W / 2, H / 2);
    c.rotate(-Math.PI / 2);
    c.font = '700 64px "Trebuchet MS", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = spec.neon.color;
    c.shadowBlur = 26;
    c.fillStyle = spec.neon.color;
    c.fillText(spec.neon.text, 0, 0);
    c.fillText(spec.neon.text, 0, 0);
    c.restore();
  });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 3.4), mat);
  plane.position.set(spec.w / 2 + 0.08, 4.6, spec.d / 2 - 0.4);
  group.add(plane);

  // glow halo
  const haloTex = canvasTexture(128, 256, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, hexToRgba(spec.neon.color, 0.30));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 256);
  });
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, transparent: true, depthWrite: false }));
  halo.scale.set(2.6, 6, 1);
  halo.position.copy(plane.position);
  group.add(halo);

  state.signFlicker.push({ mat, base: 1, phase: rand(0, TAU), kind: 'neon' });
}

function buildBuilding(spec) {
  const group = new THREE.Group();
  group.position.set(spec.x, 0, spec.z);
  group.rotation.y = spec.rot || 0;
  group.userData.building = true;

  const frontTex = makeFacadeTexture(spec, spec.w, true);
  const backTex = makeFacadeTexture(spec, spec.w, false);
  const sideTex = makeFacadeTexture(spec, spec.d, false);

  // The same canvas doubles as an emissive map: lit windows, signs and
  // storefront glass genuinely glow against the night.
  const frontMat = new THREE.MeshStandardMaterial({ map: frontTex, emissive: 0xffffff, emissiveMap: frontTex, emissiveIntensity: 0.5, roughness: 0.92 });
  const backMat = new THREE.MeshStandardMaterial({ map: backTex, emissive: 0xffffff, emissiveMap: backTex, emissiveIntensity: 0.5, roughness: 0.92 });
  const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, emissive: 0xffffff, emissiveMap: sideTex, emissiveIntensity: 0.5, roughness: 0.92 });
  const roofMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.roof), roughness: 1 });
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x1c1622, roughness: 1 });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(spec.w, spec.h, spec.d),
    [sideMat, sideMat, roofMat, baseMat, frontMat, backMat]
  );
  body.position.y = spec.h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  if (spec.roofStyle === 'pyramid') {
    const rH = spec.roofH || 1.2;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0, 1, rH, 4), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(spec.w / 1.42, 1, spec.d / 1.42);
    roof.position.y = spec.h + rH / 2;
    roof.castShadow = true;
    group.add(roof);
  } else {
    const parapet = new THREE.Mesh(
      new THREE.BoxGeometry(spec.w + 0.16, 0.38, spec.d + 0.16),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.trim), roughness: 0.95 })
    );
    parapet.position.y = spec.h + 0.17;
    parapet.castShadow = true;
    group.add(parapet);
    addRoofUnit(group, spec.w, spec.d, spec.h + 0.36);
  }

  if (spec.awning) addAwning(group, spec.w, spec.d, spec);
  if (spec.neon) addNeonSign(group, spec);

  scene.add(group);
  return group;
}

// Small color helper: lighten/darken a hex color by amt (−100..100).
function shade(hex, amt) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, clamp(hsl.l + amt / 255, 0, 1));
  return '#' + c.getHexString();
}

function hexToRgba(hex, a) {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${a})`;
}

function buildCity() {
  // rot: front (+z local) direction in world:  0 -> +z (S)   PI/2 -> +x (E)
  //                                            PI   -> -z (N)  -PI/2 -> -x (W)
  // Block centers: (±30, ±30) edge blocks; (0, ±30) and (±30, 0) edge blocks.
  // Only streets at x,z = 0 / ±15 have traffic; outer faces look at the diorama rim.
  const P = WALL_PALETTES;
  const specs = [
    // --- north-west block (-30, -30) ---
    { x: -35.8, z: -26, rot: 0, w: 9, d: 8, h: 15, floors: 4, ...P[0], ground: 'shop',
      sign: { text: 'CAFÉ LUMEN', color: '#ffd9a0', bg: '#33261e', glow: true },
      awning: { c1: '#d96f4e', c2: '#f2e6d0' } },
    { x: -24.5, z: -33, rot: Math.PI / 2, w: 8, d: 7, h: 11, floors: 3, ...P[2], ground: 'door',
      sign: { text: 'BOOKS', color: '#9fd8ff', bg: '#232a3a', glow: false } },
    { x: -33, z: -25.5, rot: 0, w: 7, d: 7, h: 13, floors: 4, ...P[4], ground: 'shop',
      sign: { text: 'NOODLE', color: '#ff77a8', bg: '#2a1620', glow: true },
      awning: { c1: '#31567c', c2: '#f2e6d0' } },
    { x: -35, z: -31, rot: -Math.PI / 2, w: 7, d: 8, h: 9, floors: 2, ...P[5], ground: 'door',
      sign: { text: 'TAILOR', color: '#e8d8b0', bg: '#2c2418', glow: false }, roofStyle: 'pyramid' },

    // --- north-east block (30, -30) ---
    { x: 25, z: -25.5, rot: 0, w: 9, d: 8, h: 17, floors: 5, ...P[3], ground: 'shop',
      sign: { text: 'HOTEL LUNA', color: '#b9e6ff', bg: '#1f2433', glow: true },
      awning: { c1: '#7a4e8c', c2: '#f2e6d0' }, neon: { text: 'LUNA', color: '#74d4ff' } },
    { x: 35.5, z: -25.5, rot: 0, w: 9, d: 7, h: 12, floors: 3, ...P[6], ground: 'shop',
      sign: { text: 'FLOWERS', color: '#ff9ec4', bg: '#2a1a22', glow: true },
      awning: { c1: '#c85a7a', c2: '#f6e8ee' } },
    { x: 35.5, z: -33, rot: Math.PI / 2, w: 8, d: 8, h: 14, floors: 4, ...P[1], ground: 'shop',
      sign: { text: 'LIQUOR', color: '#ffd27a', bg: '#2c2012', glow: false } },

    // --- south-west block (-30, 30) ---
    { x: -26, z: 34, rot: 0, w: 9, d: 8, h: 12, floors: 3, ...P[7], ground: 'shop',
      sign: { text: 'BAKERY', color: '#ffdfae', bg: '#332317', glow: true },
      awning: { c1: '#e0a13e', c2: '#f6ead2' } },
    { x: -34, z: 26, rot: Math.PI, w: 8, d: 7, h: 10, floors: 3, ...P[2], ground: 'shop',
      sign: { text: 'TEA HOUSE', color: '#a8e6b0', bg: '#1c2a20', glow: false } },
    { x: -35, z: 31, rot: -Math.PI / 2, w: 8, d: 8, h: 16, floors: 5, ...P[4], ground: 'door',
      sign: { text: '24H MART', color: '#ffe08a', bg: '#2a2210', glow: true } },

    // --- south-east block (30, 30) ---
    { x: 26, z: 34, rot: 0, w: 9, d: 8, h: 13, floors: 4, ...P[0], ground: 'shop',
      sign: { text: 'PIZZA', color: '#ff8a5c', bg: '#2c1a12', glow: true },
      awning: { c1: '#b8442e', c2: '#f2e6d0' } },
    { x: 34, z: 26, rot: Math.PI, w: 9, d: 7, h: 11, floors: 3, ...P[3], ground: 'shop',
      sign: { text: 'RECORDS', color: '#c9a8ff', bg: '#241a30', glow: true },
      awning: { c1: '#4e3a6e', c2: '#e8e0f0' } },
    { x: 35, z: 31, rot: Math.PI / 2, w: 8, d: 8, h: 9, floors: 2, ...P[5], ground: 'door',
      sign: { text: 'PHARMACY', color: '#9effb0', bg: '#152818', glow: false }, roofStyle: 'pyramid' },

    // --- west edge block (-30, 0) ---
    { x: -24, z: -5.5, rot: Math.PI / 2, w: 9, d: 7, h: 12, floors: 3, ...P[6], ground: 'door',
      sign: { text: 'GALLERY', color: '#d8d0e8', bg: '#241f2c', glow: false } },
    { x: -24, z: 5, rot: Math.PI / 2, w: 9, d: 7, h: 14, floors: 4, ...P[1], ground: 'shop',
      sign: { text: 'SUDS & STEAM', color: '#9fd8ff', bg: '#1c2430', glow: true },
      awning: { c1: '#31567c', c2: '#e6eef6' } },

    // --- east edge block (30, 0) ---
    { x: 24, z: -5.5, rot: -Math.PI / 2, w: 9, d: 7, h: 13, floors: 4, ...P[7], ground: 'shop',
      sign: { text: 'COFFEE', color: '#ffd9a0', bg: '#2c2014', glow: true },
      awning: { c1: '#8c5a3c', c2: '#f2e6d0' } },
    { x: 24, z: 5, rot: -Math.PI / 2, w: 9, d: 7, h: 11, floors: 3, ...P[2], ground: 'door',
      sign: { text: 'PHOTO', color: '#f0e0d0', bg: '#26211d', glow: false } },

    // --- north edge block (0, -30) ---
    { x: -5, z: -34.5, rot: Math.PI, w: 8, d: 7, h: 15, floors: 4, ...P[4], ground: 'shop',
      sign: { text: 'WAX & WANE', color: '#c9a8ff', bg: '#221a2e', glow: true },
      awning: { c1: '#5a4680', c2: '#efe8f6' } },
    { x: 5, z: -34.5, rot: Math.PI, w: 8, d: 7, h: 12, floors: 3, ...P[0], ground: 'shop',
      sign: { text: 'SUSHI', color: '#ff9ec4', bg: '#2a1a20', glow: true },
      awning: { c1: '#a03a52', c2: '#f2e6d0' } },

    // --- south edge block (0, 30) ---
    { x: -5, z: 34.5, rot: 0, w: 8, d: 7, h: 13, floors: 4, ...P[3], ground: 'door',
      sign: { text: 'MARKET', color: '#ffdfae', bg: '#2c2314', glow: false } },
    { x: 5, z: 34.5, rot: 0, w: 8, d: 7, h: 16, floors: 5, ...P[6], ground: 'shop',
      sign: { text: 'MOTEL', color: '#74d4ff', bg: '#16222e', glow: true },
      awning: { c1: '#2e6e8c', c2: '#e0ecf2' } },
  ];
  for (const spec of specs) buildBuilding(spec);
}

/* ---------------- 5. street furniture: lamps, trees, benches, fountain ---------------- */

const LAMP_GLOW_TEX = () => {
  if (TEX.lampGlow) return TEX.lampGlow;
  TEX.lampGlow = canvasTexture(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(255, 214, 150, 0.9)');
    g.addColorStop(0.35, 'rgba(255, 190, 110, 0.32)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
  return TEX.lampGlow;
};

function buildLamp(x, z, faceX, faceZ, hasLight) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.3, 10), MAT.metalDark);
  base.position.y = 0.15;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.3, 8), MAT.metalDark);
  pole.position.y = 2.3;
  pole.castShadow = true;
  g.add(base, pole);

  // arm points toward the street
  const arm = new THREE.Group();
  const armBar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.07, 0.07), MAT.metalDark);
  armBar.position.x = 0.4;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), MAT.lampHead);
  head.position.set(0.78, -0.1, 0);
  arm.add(armBar, head);
  arm.position.y = 4.45;
  arm.rotation.y = Math.atan2(faceX, faceZ);
  g.add(arm);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: LAMP_GLOW_TEX(), transparent: true, depthWrite: false, opacity: 0.75,
  }));
  glow.scale.set(2.4, 2.4, 1);
  glow.position.set(Math.sin(arm.rotation.y) * 0.78, 4.32, Math.cos(arm.rotation.y) * 0.78);
  g.add(glow);

  if (hasLight) {
    const light = new THREE.PointLight(0xffc07a, 0.62, 14, 2);
    light.position.copy(glow.position);
    g.add(light);
    state.lampFlicker.push({ light, base: 0.62, phase: rand(0, TAU) });
  }
  scene.add(g);
}

function buildTrees() {
  const spots = [
    // plaza
    [7.2, 7.2, 1.15, true], [-7.2, 7.2, 1.05, true], [7.2, -7.2, 1.0, true], [-7.2, -7.2, 1.2, false],
    // diagonal block corners
    [-37.5, -22.5, 1.0, false], [22.5, -37.5, 0.9, true], [37.5, 22.5, 1.0, false], [-22.5, 37.5, 0.95, true],
    // edge streets
    [12, 12, 0.85, false], [-12, -12, 0.9, true], [12, -12, 0.8, false], [-12, 12, 0.9, false],
    // outer rim accents
    [-42, 0, 1.3, false], [42, 0, 1.25, true], [0, 42, 1.3, false], [0, -42, 1.2, false],
  ];
  for (const [x, z, s, lit] of spots) buildTree(x, z, s, lit);
}

function buildTree(x, z, scale, lit) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  g.rotation.y = rand(0, TAU);

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 1.5, 7), MAT.woodDark);
  trunk.position.y = 0.75;
  trunk.castShadow = true;
  g.add(trunk);

  const folColors = [0x3a5a3e, 0x44684a, 0x365441];
  const blobs = [
    [0, 2.1, 0, 1.05], [0.55, 1.75, 0.3, 0.7], [-0.5, 1.8, -0.35, 0.65], [0.1, 1.5, 0.5, 0.6],
  ];
  for (const [bx, by, bz, br] of blobs) {
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(br, 1),
      new THREE.MeshStandardMaterial({ color: pick(folColors), roughness: 1, flatShading: true })
    );
    m.position.set(bx, by, bz);
    m.scale.y = 0.85;
    m.castShadow = true;
    g.add(m);
  }

  if (lit) {
    // tiny warm fairy lights nestled in the foliage
    for (let i = 0; i < 5; i++) {
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0xffd9a0 })
      );
      bulb.position.set(rand(-0.7, 0.7), rand(1.5, 2.4), rand(-0.7, 0.7));
      g.add(bulb);
    }
  }
  scene.add(g);
}

function buildBench(x, z, rotY) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 0.55), MAT.wood);
  seat.position.y = 0.55;
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 0.08), MAT.wood);
  back.position.set(0, 0.95, -0.24);
  back.rotation.x = -0.12;
  g.add(seat, back);
  for (const lx of [-0.7, 0.7]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.5), MAT.metalDark);
    leg.position.set(lx, 0.27, 0);
    g.add(leg);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g);
}

function buildFountain() {
  const g = new THREE.Group();

  const basin = new THREE.Mesh(
    new THREE.CylinderGeometry(2.3, 2.5, 0.55, 24),
    new THREE.MeshStandardMaterial({ color: 0x6d6678, roughness: 0.9 })
  );
  basin.position.y = 0.27;
  basin.castShadow = true;
  basin.receiveShadow = true;
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(2.05, 2.05, 0.1, 24),
    new THREE.MeshStandardMaterial({
      color: 0x27455c, roughness: 0.15, metalness: 0.4, emissive: 0x112233, emissiveIntensity: 0.5,
    })
  );
  water.position.y = 0.5;
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.0, 10), MAT.concrete);
  pedestal.position.y = 1.0;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.45, 0.28, 14), MAT.concrete);
  bowl.position.y = 1.62;
  g.add(basin, water, pedestal, bowl);

  // animated water droplets
  for (let i = 0; i < 8; i++) {
    const drop = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xa8d4e8, transparent: true, opacity: 0.85 })
    );
    g.add(drop);
    state.fountainDrops.push({ mesh: drop, phase: i / 8 });
  }

  scene.add(g);

  // benches around the plaza, facing the fountain
  for (const a of [0.7854, 2.356, 3.927, 5.498]) {
    buildBench(Math.cos(a) * 6.6, Math.sin(a) * 6.6, -a + Math.PI / 2);
  }
}

function buildLamps() {
  // plaza corners: real point lights
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    buildLamp(sx * 9.7, sz * 9.7, sx, sz, true);
  }
  // street midpoints (lamp on the sidewalk, head toward the street), emissive only
  for (const x of V_STREETS) {
    buildLamp(x - 4.9, -7.5, 1, 0, false);
    buildLamp(x - 4.9, 7.5, 1, 0, false);
  }
  for (const z of H_STREETS) {
    buildLamp(-7.5, z - 4.9, 0, 1, false);
    buildLamp(7.5, z - 4.9, 0, 1, false);
  }
}

/* ---------------- 6. vehicles ---------------- */

function buildCar(kind, bodyColor) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.35, metalness: 0.55 });
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  const addWheel = (x, z) => {
    const w = new THREE.Mesh(wheelGeo, MAT.metalDark);
    w.position.set(x, 0.34, z);
    g.add(w);
    wheels.push(w);
  };
  const lightGeo = new THREE.SphereGeometry(0.09, 8, 6);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffe2b0 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xd84a3a });

  if (kind === 'bus') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.5, 8.6), bodyMat);
    body.position.y = 1.05;
    const winBand = new THREE.Mesh(new THREE.BoxGeometry(2.34, 0.55, 7.6), MAT.glassWarm);
    winBand.position.y = 1.35;
    g.add(body, winBand);
    addWheel(-1.05, 3.0); addWheel(1.05, 3.0);
    addWheel(-1.05, -3.0); addWheel(1.05, -3.0);
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(lightGeo, headMat);
      h.position.set(s * 0.8, 0.62, 4.32);
      const t = new THREE.Mesh(lightGeo, tailMat);
      t.position.set(s * 0.8, 0.62, -4.32);
      g.add(h, t);
    }
  } else if (kind === 'van') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.05, 4.0), bodyMat);
    body.position.y = 0.87;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.55, 1.1), MAT.glassCool);
    cab.position.set(0, 1.45, 1.3);
    g.add(body, cab);
    addWheel(-1.0, 1.35); addWheel(1.0, 1.35);
    addWheel(-1.0, -1.35); addWheel(1.0, -1.35);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 4.2), bodyMat);
    body.position.y = 0.62;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.52, 2.1), MAT.glassCool);
    cabin.position.set(0, 1.12, -0.2);
    g.add(body, cabin);
    addWheel(-0.95, 1.45); addWheel(0.95, 1.45);
    addWheel(-0.95, -1.45); addWheel(0.95, -1.45);
    if (kind === 'taxi') {
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.28, 0.4),
        new THREE.MeshStandardMaterial({ color: 0xf6f0e0, emissive: 0xd8c070, emissiveIntensity: 0.7 })
      );
      sign.position.set(0, 1.48, -0.2);
      g.add(sign);
    }
  }

  // head + tail lights on cars
  if (kind !== 'bus') {
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(lightGeo, headMat);
      h.position.set(s * 0.6, 0.62, 2.12);
      const t = new THREE.Mesh(lightGeo, tailMat);
      t.position.set(s * 0.6, 0.62, -2.12);
      g.add(h, t);
    }
  }

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.wheels = wheels;
  return g;
}

function spawnCar(axis, dir, street, speed, kind, color) {
  // axis 'x': street at z = street, travel along x. axis 'z': street at x = street.
  const group = buildCar(kind, color);
  // lane & heading: right-hand traffic
  let rot, lane;
  if (axis === 'x') {
    lane = street + dir * LANE;      // +x (east) travel -> south lane
    rot = dir === 1 ? Math.PI / 2 : -Math.PI / 2;
  } else {
    lane = street - dir * LANE;      // +z (south) travel -> west lane
    rot = dir === 1 ? 0 : Math.PI;
  }
  group.rotation.y = rot;
  const pos = rand(-40, 40);
  const car = { group, speed, axis, dir, pos, lane, kind };
  const place = () => {
    if (axis === 'x') group.position.set(pos, 0, lane);
    else group.position.set(lane, 0, pos);
  };
  place();
  car.place = place;
  scene.add(group);
  state.cars.push(car);
}

function updateCars(dt) {
  for (const car of state.cars) {
    car.pos += car.dir * car.speed * dt;
    if (car.pos > 43) car.pos = -43;
    if (car.pos < -43) car.pos = 43;
    car.place();
    const spin = (car.speed * dt) / 0.34;
    for (const w of car.group.userData.wheels) w.rotation.x += spin;
  }
}

function buildVehicles() {
  // [axis, dir, street, speed, kind, color]
  const fleet = [
    ['z', 1, -15, 5.2, 'taxi', 0xffc93c],
    ['z', -1, -15, 4.6, 'car', 0xc05a4a],
    ['z', 1, 0, 3.6, 'bus', 0x3e7a72],
    ['z', -1, 0, 5.0, 'taxi', 0xffc93c],
    ['z', 1, 15, 4.8, 'car', 0x8c6a8c],
    ['z', -1, 15, 5.4, 'car', 0x5a6a52],
    ['x', 1, -15, 5.0, 'van', 0xd8d2c4],
    ['x', -1, -15, 4.4, 'car', 0x7a5a4a],
    ['x', 1, 0, 4.7, 'car', 0x4a5a8c],
    ['x', -1, 0, 5.3, 'van', 0xb8a888],
    ['x', 1, 15, 5.1, 'car', 0x6a7a5a],
    ['x', -1, 15, 4.9, 'car', 0x9c4a4a],
    ['z', 1, -15, 4.2, 'car', 0x4f7a7a],
    ['x', 1, 0, 3.4, 'bus', 0x8c5a6e],
  ];
  for (const [axis, dir, street, speed, kind, color] of fleet) {
    spawnCar(axis, dir, street, speed, kind, color);
  }
}

/* ---------------- 7. pedestrians ---------------- */

const OUTFITS = {
  coats: ['#b8543f', '#3f6a8a', '#8a3f6a', '#5a8a4f', '#c08a3f', '#5a5a8a',
          '#8a4a3f', '#4f7a7a', '#a8863c', '#6a5a8a', '#b87a6a', '#4a6a5a'],
  skin:  ['#f0c8a0', '#d8a878', '#b8865a', '#8a5a3a', '#f4d4b0'],
  hair:  ['#2a2018', '#4a3222', '#6a4a2a', '#1a1a22', '#7a5a3a', '#3a2a3a'],
  scarf: ['#d8a04a', '#a04a5a', '#4a8a8a', '#c06a9a', '#7a9a4a'],
  pants: ['#2c2c38', '#3a3442', '#26262e', '#403848'],
};

function buildPerson() {
  const g = new THREE.Group();
  const coat = new THREE.Color(pick(OUTFITS.coats));
  const coatMat = new THREE.MeshStandardMaterial({ color: coat, roughness: 0.9 });
  const coatDark = new THREE.MeshStandardMaterial({ color: coat.clone().multiplyScalar(0.75), roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: pick(OUTFITS.pants), roughness: 1 });
  const skin = new THREE.MeshStandardMaterial({ color: pick(OUTFITS.skin), roughness: 0.8 });

  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.52, 0.15), pants);
    leg.position.set(s * 0.11, 0.26, 0);
    leg.castShadow = true;
    g.add(leg);
    legs.push(leg);
  }
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.48, 4, 8), coatMat);
  body.position.y = 0.78;
  body.castShadow = true;
  g.add(body);

  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.34, 4, 6), coatDark);
    arm.position.set(s * 0.31, 0.82, 0);
    arm.rotation.z = s * 0.12;
    g.add(arm);
  }

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), skin);
  head.position.y = 1.38;
  head.castShadow = true;
  g.add(head);

  // hair or beanie
  if (Math.random() < 0.4) {
    const hat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.18, 0.12, 10),
      new THREE.MeshStandardMaterial({ color: pick(OUTFITS.scarf), roughness: 1 })
    );
    hat.position.y = 1.5;
    g.add(hat);
  } else {
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.165, 10, 8),
      new THREE.MeshStandardMaterial({ color: pick(OUTFITS.hair), roughness: 1 })
    );
    hair.scale.set(1, 0.75, 1);
    hair.position.y = 1.45;
    g.add(hair);
  }

  // scarf on chilly nights
  if (Math.random() < 0.55) {
    const scarf = new THREE.Mesh(
      new THREE.TorusGeometry(0.19, 0.055, 8, 14),
      new THREE.MeshStandardMaterial({ color: pick(OUTFITS.scarf), roughness: 1 })
    );
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 1.16;
    g.add(scarf);
  }

  g.userData.legs = legs;
  return g;
}

// Closed square loop along the sidewalk of a block (or the plaza).
function walkLoop(cx, cz, half) {
  return [
    new THREE.Vector3(cx - half, 0, cz - half),
    new THREE.Vector3(cx + half, 0, cz - half),
    new THREE.Vector3(cx + half, 0, cz + half),
    new THREE.Vector3(cx - half, 0, cz + half),
  ];
}

function spawnPerson(cx, cz, half, speed) {
  const group = buildPerson();
  const path = walkLoop(cx, cz, half);
  const perim = half * 8;
  const p = { group, path, perim, t: rand(0, perim), speed, phase: rand(0, TAU) };
  scene.add(group);
  state.people.push(p);
}

function updatePeople(dt) {
  for (const p of state.people) {
    p.t = (p.t + p.speed * dt) % p.perim;
    const seg = Math.floor(p.t / (p.perim / 4));
    const f = (p.t % (p.perim / 4)) / (p.perim / 4);
    const a = p.path[seg];
    const b = p.path[(seg + 1) % 4];
    const x = lerp(a.x, b.x, f);
    const z = lerp(a.z, b.z, f);
    p.group.position.set(x, 0, z);
    p.group.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    // walking bob + leg swing
    const swing = Math.sin(state.t * 6 + p.phase);
    p.group.position.y = Math.abs(swing) * 0.045;
    p.group.userData.legs[0].rotation.x = swing * 0.55;
    p.group.userData.legs[1].rotation.x = -swing * 0.55;
  }
}

function buildPeople() {
  // two wanderers on the plaza, one or two per outer block
  for (let i = 0; i < 2; i++) spawnPerson(0, 0, 8.8, rand(0.7, 1.1));
  const blocks = [[-30, -30], [30, -30], [-30, 30], [30, 30], [-30, 0], [30, 0], [0, -30], [0, 30]];
  for (const [cx, cz] of blocks) {
    spawnPerson(cx, cz, 9.5, rand(0.6, 1.2));
    if (Math.random() < 0.5) spawnPerson(cx, cz, 9.5, rand(0.6, 1.0));
  }
}

/* ---------------- 8. ambience: stars, moon, string lights, birds ---------------- */

const STAR_TEX = () => {
  if (TEX.star) return TEX.star;
  TEX.star = canvasTexture(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,244,220,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  });
  return TEX.star;
};

function buildStars() {
  for (let i = 0; i < 300; i++) {
    const theta = rand(0, TAU);
    const phi = rand(0.05, 1.25);            // upper hemisphere
    const r = rand(150, 210);
    const p = new THREE.Vector3(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta)
    );
    const m = new THREE.SpriteMaterial({
      map: STAR_TEX(), transparent: true, depthWrite: false,
      opacity: rand(0.35, 1),
      color: pick([0xffffff, 0xd8e4ff, 0xffe8c8]),
    });
    const s = new THREE.Sprite(m);
    s.position.copy(p);
    s.scale.setScalar(rand(0.7, 2.2));
    scene.add(s);
    state.twinkle.push({ sprite: s, base: m.opacity, phase: rand(0, TAU), speed: rand(0.4, 1.6) });
  }
}

function buildMoon() {
  const tex = canvasTexture(256, 256, (c) => {
    const glow = c.createRadialGradient(128, 128, 30, 128, 128, 128);
    glow.addColorStop(0, 'rgba(244, 236, 216, 0.55)');
    glow.addColorStop(0.4, 'rgba(200, 190, 220, 0.16)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, 256, 256);
    const disc = c.createRadialGradient(118, 116, 8, 128, 128, 52);
    disc.addColorStop(0, '#f8f2dc');
    disc.addColorStop(1, '#d8cfb8');
    c.fillStyle = disc;
    c.beginPath();
    c.arc(128, 128, 50, 0, TAU);
    c.fill();
    c.fillStyle = 'rgba(160,150,130,0.35)';
    for (const [cx, cy, cr] of [[112, 118, 8], [140, 138, 6], [124, 146, 5], [146, 116, 4]]) {
      c.beginPath(); c.arc(cx, cy, cr, 0, TAU); c.fill();
    }
  });
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  }));
  moon.scale.set(34, 34, 1);
  moon.position.set(-105, 130, -85);
  scene.add(moon);
}

function buildStringLights() {
  // catenary strings between the four plaza lamps, warm bulbs
  const corners = [
    [-9.7, -9.7], [9.7, -9.7], [9.7, 9.7], [-9.7, 9.7],
  ];
  const bulbColors = [0xffd9a0, 0xffb8a0, 0xfff2d8];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = corners[i];
    const [x1, z1] = corners[(i + 1) % 4];
    const n = 13;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const x = lerp(x0, x1, t);
      const z = lerp(z0, z1, t);
      const y = 4.3 - Math.sin(Math.PI * t) * 1.05;
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 8, 6),
        new THREE.MeshBasicMaterial({ color: pick(bulbColors) })
      );
      bulb.position.set(x, y, z);
      scene.add(bulb);
    }
    // thin wire
    const pts = [];
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      pts.push(new THREE.Vector3(lerp(x0, x1, t), 4.3 - Math.sin(Math.PI * t) * 1.0, lerp(z0, z1, t)));
    }
    const wire = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x1a1622, transparent: true, opacity: 0.8 })
    );
    scene.add(wire);
  }
  // one cozy light over the plaza
  const plazaLight = new THREE.PointLight(0xffc98a, 0.5, 20, 2);
  plazaLight.position.set(0, 4.6, 0);
  scene.add(plazaLight);
  state.stringLights.push({ light: plazaLight, base: 0.5, phase: 0 });
}

function buildBirds() {
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x171422 })
    );
    body.scale.set(1.4, 0.9, 1.8);
    const wingGeo = new THREE.PlaneGeometry(0.62, 0.24);
    wingGeo.translate(0.31, 0, 0);
    const wingMat = new THREE.MeshBasicMaterial({ color: 0x171422, side: THREE.DoubleSide });
    const wl = new THREE.Mesh(wingGeo, wingMat);
    const wr = new THREE.Mesh(wingGeo, wingMat);
    wr.rotation.y = Math.PI;
    g.add(body, wl, wr);
    g.scale.setScalar(rand(0.8, 1.2));
    scene.add(g);
    state.birds.push({
      group: g, wings: [wl, wr],
      r: rand(9, 14), speed: rand(0.12, 0.2), phase: rand(0, TAU), height: rand(14, 19),
    });
  }
}

function updateAmbience(t, dt) {
  for (const s of state.twinkle) {
    s.sprite.material.opacity = s.base * (0.72 + 0.28 * Math.sin(t * s.speed + s.phase));
  }
  for (const f of state.lampFlicker) {
    f.light.intensity = f.base * (0.94 + 0.05 * Math.sin(t * 9 + f.phase) + 0.02 * Math.sin(t * 23 + f.phase * 2));
  }
  for (const s of state.stringLights) {
    s.light.intensity = s.base * (1 + 0.08 * Math.sin(t * 1.8 + s.phase));
  }
  for (const f of state.signFlicker) {
    let v = 1;
    if (Math.sin(t * 0.9 + f.phase) > 0.992) v = 0.25 + 0.2 * Math.sin(t * 42);
    f.mat.opacity = v;
  }
  // fountain droplets
  for (const d of state.fountainDrops) {
    const u = (t * 0.9 + d.phase) % 1;
    const r = 0.15 + 0.42 * u;
    const y = 1.75 + 2.62 * u - 3.82 * u * u;
    const a = d.phase * TAU + t * 0.4;
    d.mesh.position.set(Math.cos(a) * r, Math.max(y, 0.55), Math.sin(a) * r);
    d.mesh.material.opacity = 0.85 * (1 - u * 0.55);
  }
  // birds circling overhead
  for (const b of state.birds) {
    const a = b.phase + t * b.speed;
    b.group.position.set(
      Math.cos(a) * b.r,
      b.height + Math.sin(t * 1.7 + b.phase) * 0.9,
      Math.sin(a) * b.r
    );
    b.group.rotation.y = -a - Math.PI / 2;
    const flap = Math.sin(t * 7 + b.phase) * 0.55 + 0.25;
    b.wings[0].rotation.z = flap;
    b.wings[1].rotation.z = -flap;
  }
}

/* ---------------- 9. lo-fi soundtrack (Web Audio, generative 16-bar loop) ---------------- */

let audio = null;
let audioStartedAt = 0;

const TEMPO = 76;                    // gentle
const SPB = 60 / TEMPO;              // seconds per beat
const BAR = SPB * 4;                 // seconds per bar
const LOOP = BAR * 16;               // 16 bars

// i – VI – III – VII in C: warm, wistful, looping
const CHORDS = [
  { root: 130.81, notes: [261.63, 329.63, 392.0] },   // Cmaj7
  { root: 87.31,  notes: [220.0, 261.63, 329.63] },   // Am7
  { root: 110.0,  notes: [246.94, 293.66, 349.23] },  // Fmaj7
  { root: 98.0,   notes: [293.66, 349.23, 440.0] },   // G6
];

function noiseBuffer(ctx, seconds, density) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    if (density >= 1) d[i] = (Math.random() * 2 - 1) * 0.5;
    else if (Math.random() < density) d[i] = (Math.random() * 2 - 1) * (0.4 + Math.random() * 0.6);
  }
  return buf;
}

function playKick(t, gain) {
  if (!audio) return;
  const ctx = audio.ctx;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(118, t);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
  o.connect(g); g.connect(audio.dark);
  o.start(t); o.stop(t + 0.3);
}

function playSnare(t, gain) {
  if (!audio) return;
  const ctx = audio.ctx;
  const s = ctx.createBufferSource();
  s.buffer = audio.scratch;          // short shared noise burst
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  s.connect(g); g.connect(audio.sFilter);
  s.start(t); s.stop(t + 0.2);
  const body = ctx.createOscillator();
  const bg = ctx.createGain();
  body.frequency.setValueAtTime(190, t);
  bg.gain.setValueAtTime(gain * 0.4, t);
  bg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  body.connect(bg); bg.connect(audio.dark);
  body.start(t); body.stop(t + 0.1);
}

function playHat(t, gain, open) {
  if (!audio) return;
  const ctx = audio.ctx;
  const s = ctx.createBufferSource();
  s.buffer = audio.scratch;
  const g = ctx.createGain();
  const dur = open ? 0.22 : 0.05;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(g); g.connect(audio.hatFilter);
  s.start(t); s.stop(t + dur + 0.02);
}

// soft rhodes-ish pad note: triangle + detuned sine through a lowpass
function playPadNote(t, freq, dur, gain) {
  if (!audio) return;
  const ctx = audio.ctx;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 1400;
  f.Q.value = 0.3;
  f.connect(audio.warm);
  const o1 = ctx.createOscillator();
  o1.type = 'triangle';
  o1.frequency.value = freq;
  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = freq * 2.003;
  const g = ctx.createGain();
  const g2 = ctx.createGain();
  g2.gain.value = 0.4;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.05);
  g.gain.setValueAtTime(gain, t + dur * 0.55);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(f);
  o1.start(t); o2.start(t);
  o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
}

function playChord(t, freqs, dur, gain) {
  for (const f of freqs) playPadNote(t, f, dur, gain);
}

function playBass(t, freq, dur) {
  if (!audio) return;
  const ctx = audio.ctx;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const o2 = ctx.createOscillator();
  o2.type = 'triangle';
  o2.frequency.value = freq;
  const g = ctx.createGain();
  const g2 = ctx.createGain();
  g2.gain.value = 0.3;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.16, t + 0.04);
  g.gain.setValueAtTime(0.14, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); o2.connect(g2); g2.connect(g); g.connect(audio.dark);
  o.start(t); o2.start(t);
  o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
}

// twinkling bell for the melody (pentatonic, sparse, humanized)
function playBell(t, freq, gain) {
  if (!audio) return;
  const ctx = audio.ctx;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 3000;
  f.connect(audio.warm);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
  const o1 = ctx.createOscillator();
  o1.type = 'sine';
  o1.frequency.value = freq;
  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = freq * 2.76;
  const g2 = ctx.createGain();
  g2.gain.value = 0.25;
  o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(f);
  o1.start(t); o2.start(t);
  o1.stop(t + 0.75); o2.stop(t + 0.75);
}

// melody: pentatonic seed over 16 bars (null = rest); index = beat position
const PENT = [523.25, 587.33, 659.25, 783.99, 880.0];
const MELODY = {
  3: 2, 6: 3, 9: 2, 11: 4,          // bar 1
  15: 3, 18: 2, 21: 1, 23: 0,        // bar 2
  27: 1, 30: 2, 33: 3,               // bar 3
  39: 2, 42: 1, 45: 0,               // bar 4
  48: 3, 51: 4, 54: 3, 57: 2,        // bar 5
  63: 1, 66: 0,                      // bar 6
  71: 1, 74: 2, 77: 3, 79: 4,        // bar 7
  83: 3, 87: 2, 90: 1, 93: 0,        // bar 8
  96: 2, 99: 3, 102: 4, 105: 3,      // bar 9
  108: 2, 111: 1,                    // bar 10
  115: 0, 118: 1, 121: 2,            // bar 11
  127: 1, 130: 0, 133: -1,           // bar 12 (-1 = octave down)
  138: 2, 141: 1, 144: 0, 147: 1,    // bar 13
  150: 2, 153: 4, 156: 3, 159: 2,    // bar 14
  162: 1, 165: 0, 168: -1,           // bar 15 (resolve down)
  171: 0,                            // bar 16 (soft landing)
};

function scheduleBar(bar) {
  if (!audio) return;
  const t0 = audio.nextBar;
  const chord = CHORDS[(bar % 4) * 1];
  // pad: whole bar, slight overlap handled by envelope
  playChord(t0, chord.notes, BAR * 1.02, 0.055);

  // drums: relaxed swing, kicks on 1 & 3 (sometimes 2.5)
  playKick(t0 + 0 * SPB, 0.5);
  playKick(t0 + 2 * SPB, 0.42);
  if (bar % 2 === 1) playKick(t0 + 2.5 * SPB, 0.3);
  playSnare(t0 + 1 * SPB, 0.32);
  playSnare(t0 + 3 * SPB, 0.3);
  // hats: eighths with a lazy swing, open hat on 3.5 sometimes
  for (let e = 0; e < 8; e++) {
    const swing = (e % 2 === 1) ? 0.16 : 0;
    const t = t0 + (e / 2) * SPB + swing * SPB;
    const open = e === 7 && bar % 4 === 3;
    playHat(t, e % 2 ? 0.1 : 0.16, open);
  }

  // bass: root on 1 and 3, fifth on 2.5 sometimes
  playBass(t0 + 0 * SPB, chord.root / 2, SPB * 1.9);
  playBass(t0 + 2 * SPB, chord.root / 2, SPB * 1.2);
  if (bar % 2 === 1) playBass(t0 + 2.5 * SPB, chord.root * 1.5 / 2, SPB * 0.9);

  // sparse melody notes (beat index within the 64-beat loop)
  const base = bar * 4;
  for (const key of Object.keys(MELODY)) {
    const beat = Number(key);
    if (Math.floor(beat / 4) !== bar) continue;
    const noteIdx = MELODY[beat];
    const freq = noteIdx < 0 ? PENT[0] * 0.5 : PENT[noteIdx];
    const t = t0 + (beat - base) * SPB + rand(-0.012, 0.012);
    playBell(t, freq, 0.05 + Math.random() * 0.03);
  }
}

function startAudio() {
  if (audio) {
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) { state.soundOn = false; updateSoundUI(); return; }

  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = state.soundOn ? 0.8 : 0;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 20;
  comp.ratio.value = 6;
  comp.attack.value = 0.01;
  comp.release.value = 0.25;
  master.connect(comp);
  comp.connect(ctx.destination);

  // shared buses
  const warm = ctx.createBiquadFilter();
  warm.type = 'lowpass'; warm.frequency.value = 3200; warm.Q.value = 0.4;
  warm.connect(master);
  const dark = ctx.createBiquadFilter();
  dark.type = 'lowpass'; dark.frequency.value = 900;
  dark.connect(master);
  const sFilter = ctx.createBiquadFilter();
  sFilter.type = 'bandpass'; sFilter.frequency.value = 1800; sFilter.Q.value = 0.8;
  sFilter.connect(master);
  const hatFilter = ctx.createBiquadFilter();
  hatFilter.type = 'highpass'; hatFilter.frequency.value = 6000;
  hatFilter.connect(master);

  // shared short noise burst for snare/hat
  const scratch = noiseBuffer(ctx, 0.2, 1);

  // vinyl crackle: sparse pops, looping
  const crackle = ctx.createBufferSource();
  crackle.buffer = noiseBuffer(ctx, 2.5, 0.0004);
  crackle.loop = true;
  const crackleGain = ctx.createGain();
  crackleGain.gain.value = 0.55;
  const crackleFilter = ctx.createBiquadFilter();
  crackleFilter.type = 'bandpass'; crackleFilter.frequency.value = 2600; crackleFilter.Q.value = 0.4;
  crackle.connect(crackleFilter); crackleFilter.connect(crackleGain); crackleGain.connect(master);
  crackle.start();

  // gentle tape hiss
  const hiss = ctx.createBufferSource();
  hiss.buffer = noiseBuffer(ctx, 1.0, 1);
  hiss.loop = true;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0.011;
  const hissFilter = ctx.createBiquadFilter();
  hissFilter.type = 'highpass'; hissFilter.frequency.value = 2600;
  hiss.connect(hissFilter); hissFilter.connect(hissGain); hissGain.connect(master);
  hiss.start();

  audio = { ctx, master, warm, dark, sFilter, hatFilter, scratch, nextBar: 0, bar: 0 };
  state.audioStarted = true;
  audioStartedAt = performance.now();
  audio.nextBar = ctx.currentTime + 0.2;

  // lookahead scheduler: keeps ~1s of bars queued
  const tick = () => {
    if (!audio) return;
    while (audio.nextBar < audio.ctx.currentTime + 1.0) {
      scheduleBar(audio.bar);
      audio.bar = (audio.bar + 1) % 16;
      audio.nextBar += BAR;
    }
  };
  tick();
  setInterval(tick, 250);
}

function setSound(on) {
  state.soundOn = on;
  if (audio) {
    audio.master.gain.setTargetAtTime(on ? 0.8 : 0, audio.ctx.currentTime, 0.15);
  }
  updateSoundUI();
}

/* ---------------- 10. UI wiring ---------------- */

function wireUI() { /* TODO */ }

/* ---------------- 10. UI wiring ---------------- */

function updateSoundUI() {
  const btn = document.getElementById('soundBtn');
  btn.setAttribute('aria-pressed', String(state.soundOn));
  document.getElementById('soundLabel').textContent = state.soundOn ? 'sound\u00a0on' : 'sound\u00a0off';
}

function wireUI() {
  const soundBtn = document.getElementById('soundBtn');
  const spinBtn = document.getElementById('spinBtn');
  const resetBtn = document.getElementById('resetBtn');
  const nudge = document.getElementById('nudge');

  soundBtn.addEventListener('click', () => {
    if (!state.audioStarted) {
      startAudio();
      setSound(state.soundOn);
      return;
    }
    // this click's own pointerdown just started the audio: keep the preference
    if (performance.now() - audioStartedAt < 400) {
      setSound(state.soundOn);
      return;
    }
    setSound(!state.soundOn);
  });
  spinBtn.addEventListener('click', () => {
    state.autoSpin = !state.autoSpin;
    controls.autoRotate = state.autoSpin;
    spinBtn.setAttribute('aria-pressed', String(state.autoSpin));
  });
  resetBtn.addEventListener('click', () => {
    camera.position.set(36, 27, 42);
    controls.target.set(0, 4.5, 0);
    controls.update();
  });

  // browsers require a gesture before audio may start
  const unlock = () => {
    nudge.hidden = true;
    startAudio();
    window.removeEventListener('pointerdown', unlock);
  };
  if (state.soundOn) {
    window.setTimeout(() => {
      if (!state.audioStarted) nudge.hidden = false;
    }, 1200);
    nudge.addEventListener('pointerdown', unlock);
    window.addEventListener('pointerdown', unlock, { once: true });
  }
  updateSoundUI();
}

/* ---------------- 11. animation loop ---------------- */

function updateWorld(t, dt) {
  updateCars(dt);
  updatePeople(dt);
  updateAmbience(t, dt);
}

let lastTime = 0;

function animate(now) {
  requestAnimationFrame(animate);
  const t = now * 0.001;
  const dt = Math.min(t - (lastTime || t), 0.05);
  lastTime = t;
  if (!state.paused) {
    state.t += dt;
    updateWorld(state.t, dt);
  }
  controls.update();
  renderer.render(scene, camera);
}

function boot() {
  initRenderer();
  buildMaterials();
  window.__city.scene = scene;
  initLights();
  initSky();
  buildGround();
  buildCity();
  buildLamps();
  buildTrees();
  buildFountain();
  buildStringLights();
  buildVehicles();
  buildPeople();
  buildBirds();
  wireUI();
  requestAnimationFrame(animate);
}

boot();

