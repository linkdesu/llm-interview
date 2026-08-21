/* ═══════════════════════════════════════════════════
   City Time Machine — 3D Cozy City Diorama
   ═══════════════════════════════════════════════════ */

// ─── Expose state for testing ───
window.DIORAMA = {};
window._stepCount = 0;
window._isStepMode = false;

(function main() {
  'use strict';

  // ─── Utility helpers ───
  function rand(min, max) { return Math.random() * (max - min) + min; }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ─── Palettes ───
  const PALETTE = {
    ground: 0x3a5a40, sidewalk: 0xd4c5a9, road: 0x444450, roadLine: 0xf5f5dc,
    brick: 0x8b5e3c, brick2: 0x7a4f3a, cream: 0xf0dcc0, white: 0xe8e0d4,
    gray: 0x6b7b8d, darkGray: 0x3d4f5f,
    windowLit: 0xffe4a1, windowOff: 0x2a3a4a, windowBlue: 0xa1c4fe,
    roofRed: 0x8b3a3a, roofBrown: 0x5c3a2a, roofGreen: 0x3a6b4a, roofGray: 0x555566,
    awning1: 0xe84545, awning2: 0x4585e8, awning3: 0x45e8a0, awning4: 0xe8a045,
    neonPink: 0xff6699, neonBlue: 0x66bbff, neonGreen: 0x66ff99,
    neonYellow: 0xffee66, neonOrange: 0xff9944,
    carRed: 0xcc3344, carBlue: 0x3366aa, carGreen: 0x44aa66,
    carYellow: 0xddcc44, carWhite: 0xe8e8e0, busColor: 0xcc8833,
    pedColors: [0xcc4455, 0x4466aa, 0x55aa55, 0xddaa44, 0xaa66cc, 0x66aacc, 0xdd8866, 0x8866dd],
    lampGlow: 0xffdd99,
    skyDay: 0x87ceeb, skySunset: 0xff8c42, skyDusk: 0x2d1b69, skyNight: 0x0a0a1e,
  };

  // ─── Globals ───
  let scene, camera, renderer, controls, clock;
  let ambientLight, dirLight;
  let windLights = [], vehicles = [], pedestrians = [], smokeParticles = [];
  let audioCtx = null, audioPlaying = false;

  // ─── Initialization ───
  function init() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x8899aa, 0.008);
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
    camera.position.set(35, 28, 35);
    camera.lookAt(0, 0, 0);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    document.body.appendChild(renderer.domElement);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2.15;
    controls.minDistance = 12;
    controls.maxDistance = 70;
    controls.target.set(0, 2, 0);
    clock = new THREE.Clock();
    buildSky();
    buildGround();
    buildRoads();
    buildSidewalks();
    buildStreetLamps();
    buildTrees();
    buildBuildings();
    buildVehicles();
    buildPedestrians();
    buildSmokeChimneys();
    buildDetails();
    setupLighting();
    window.addEventListener('resize', onResize);
    window.DIORAMA = { scene, camera, renderer, controls, vehicles, pedestrians };
    window._stepCount = 0;
    window._isStepMode = false;
    animate();
    setTimeout(() => {
      document.getElementById('loader').classList.add('hidden');
      document.getElementById('title-overlay').classList.remove('hidden');
    }, 2200);
  }

  function buildSky() {
    const skyGeo = new THREE.SphereGeometry(200, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTopColor: { value: new THREE.Color(PALETTE.skyDay) },
        uMidColor: { value: new THREE.Color(0xb8d4e8) },
        uBottomColor: { value: new THREE.Color(0xd4e8f0) },
        uSunColor: { value: new THREE.Color(0xffeedd) },
        uSunPos: { value: 0.3 },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uTopColor, uMidColor, uBottomColor, uSunColor;
        uniform float uSunPos;
        varying vec3 vWorldPos;
        void main() {
          float h = normalize(vWorldPos).y;
          vec3 col = h > 0.0 ? mix(uMidColor, uTopColor, pow(h, 0.6)) : mix(uMidColor, uBottomColor, pow(-h, 0.5));
          float sunAngle = uSunPos * 3.14159;
          vec3 sunDir = normalize(vec3(cos(sunAngle), sin(sunAngle), 0.0));
          float sunDot = max(dot(normalize(vWorldPos), sunDir), 0.0);
          col += uSunColor * pow(sunDot, 32.0) * 0.6;
          col += uSunColor * pow(sunDot, 4.0) * 0.12;
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.name = 'sky';
    scene.add(sky);
  }

  function buildGround() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120),
      new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  function buildRoads() {
    const roadMat = new THREE.MeshStandardMaterial({ color: PALETTE.road, roughness: 0.8 });
    const roadH = new THREE.Mesh(new THREE.PlaneGeometry(60, 8), roadMat);
    roadH.rotation.x = -Math.PI / 2;
    roadH.position.set(0, 0.01, 10);
    roadH.receiveShadow = true;
    scene.add(roadH);
    const roadV = new THREE.Mesh(new THREE.PlaneGeometry(8, 60), roadMat);
    roadV.rotation.x = -Math.PI / 2;
    roadV.position.set(10, 0.01, 0);
    roadV.receiveShadow = true;
    scene.add(roadV);
    const markMat = new THREE.MeshStandardMaterial({ color: PALETTE.roadLine, roughness: 0.7 });
    for (let x = -28; x <= 28; x += 4) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.2), markMat);
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, 10); scene.add(m);
    }
    for (let z = -28; z <= 28; z += 4) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 2), markMat);
      m.rotation.x = -Math.PI / 2; m.position.set(10, 0.02, z); scene.add(m);
    }
    for (let i = 0; i < 5; i++) {
      const s1 = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.5), markMat);
      s1.rotation.x = -Math.PI / 2; s1.position.set(8 + i * 1.2, 0.02, 10); scene.add(s1);
      const s2 = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.5), markMat);
      s2.rotation.x = -Math.PI / 2; s2.position.set(10, 0.02, 8 + i * 1.2); scene.add(s2);
    }
  }

  function buildSidewalks() {
    const swMat = new THREE.MeshStandardMaterial({ color: PALETTE.sidewalk, roughness: 0.85 });
    [{ x: -20, z: -10, w: 30, d: 16 }, { x: 20, z: -10, w: 30, d: 16 },
     { x: -20, z: 10, w: 30, d: 16 }, { x: 20, z: 10, w: 30, d: 16 }].forEach(p => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.15, p.d), swMat);
      mesh.position.set(p.x, 0.075, p.z);
      mesh.receiveShadow = true; mesh.castShadow = true;
      scene.add(mesh);
    });
  }

  function buildStreetLamps() {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.6, metalness: 0.5 });
    [[-5,10],[5,10],[-15,10],[15,10],[10,-5],[10,5],[10,-15],[10,15]].forEach(([x, z]) => {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 5, 8), poleMat);
      pole.position.y = 2.5; pole.castShadow = true; g.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.06), poleMat);
      arm.position.set(0.5, 5, 0); g.add(arm);
      const housing = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), poleMat);
      housing.position.set(1.0, 4.9, 0); g.add(housing);
      const glowMat = new THREE.MeshBasicMaterial({ color: PALETTE.lampGlow, transparent: true, opacity: 0 });
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), glowMat);
      glow.position.set(1.0, 4.85, 0); glow.name = 'glow'; g.add(glow);
      const light = new THREE.PointLight(PALETTE.lampGlow, 0, 12, 2);
      light.position.set(1.0, 4.8, 0); g.add(light);
      windLights.push({ light, glow, phase: rand(0, Math.PI * 2), speed: rand(1, 3) });
      g.position.set(x, 0.15, z);
      scene.add(g);
    });
  }

  function buildTrees() {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.9 });
    const leafColors = [0x3a7a3a, 0x4a8a4a, 0x2d6b2d, 0x559955, 0x3d8040];
    [[-12,14],[-8,14],[-28,-6],[28,-6],[28,6],[-12,-6],[26,14],[-28,14],[-28,-16],[28,-16],[-12,6],[22,-14]].forEach(([x, z]) => {
      const g = new THREE.Group();
      const th = rand(2, 3.5);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, th, 8), trunkMat);
      trunk.position.y = th / 2; trunk.castShadow = true; g.add(trunk);
      const lm = new THREE.MeshStandardMaterial({ color: leafColors[randInt(0, leafColors.length - 1)], roughness: 0.85 });
      for (let i = 0; i < randInt(2, 3); i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(rand(1.0, 1.6) - i * 0.25, 8, 8), lm);
        leaf.position.set(rand(-0.2, 0.2), th + i * 0.7, rand(-0.2, 0.2));
        leaf.castShadow = true; g.add(leaf);
      }
      g.position.set(x, 0.15, z);
      scene.add(g);
    });
  }

  // ─── Buildings ───
  function buildBuildings() {
    const defs = [
      { x: -15, z: -6, w: 7, d: 5, h: 8, body: PALETTE.brick, roof: PALETTE.roofRed, sign: 'BAKERY',    sc: PALETTE.neonPink,  ac: PALETTE.awning1 },
      { x: -5,  z: -6, w: 6, d: 5, h: 12, body: PALETTE.cream, roof: PALETTE.roofBrown, sign: 'OFFICE',    sc: PALETTE.neonBlue,  ac: PALETTE.awning2 },
      { x: 3,   z: -6, w: 5, d: 5, h: 6,  body: PALETTE.white, roof: PALETTE.roofGreen, sign: 'CAFE',      sc: PALETTE.neonGreen, ac: PALETTE.awning3 },
      { x: -15, z: 2,  w: 7, d: 5, h: 10, body: PALETTE.gray,  roof: PALETTE.roofGray,  sign: 'BOOKS',     sc: PALETTE.neonOrange,ac: PALETTE.awning4 },
      { x: -5,  z: 2,  w: 6, d: 5, h: 15, body: PALETTE.darkGray, roof: PALETTE.roofGray, sign: null,          sc: null, ac: 0x555566 },
      { x: 3,   z: 2,  w: 5, d: 5, h: 7,  body: PALETTE.brick2, roof: PALETTE.roofRed,   sign: 'GUITARS',   sc: PALETTE.neonPink,  ac: PALETTE.awning1 },
      { x: 14,  z: -6, w: 6, d: 5, h: 9,  body: PALETTE.cream, roof: PALETTE.roofBrown, sign: 'PHARMACY',  sc: PALETTE.neonGreen, ac: PALETTE.awning3 },
      { x: 22,  z: -6, w: 5, d: 5, h: 5,  body: PALETTE.white, roof: PALETTE.roofGreen, sign: 'FLOWERS',   sc: PALETTE.neonOrange,ac: PALETTE.awning4 },
      { x: 14,  z: 2,  w: 6, d: 5, h: 11, body: PALETTE.gray,  roof: PALETTE.roofGray,  sign: null,          sc: null, ac: 0x555566 },
      { x: 22,  z: 2,  w: 5, d: 5, h: 8,  body: PALETTE.brick, roof: PALETTE.roofRed,   sign: 'BARBER',    sc: PALETTE.neonBlue,  ac: PALETTE.awning2 },
      { x: -15, z: 10, w: 7, d: 5, h: 6,  body: PALETTE.darkGray, roof: PALETTE.roofBrown, sign: 'HARDWARE', sc: PALETTE.neonYellow,ac: PALETTE.awning4 },
      { x: 14,  z: 10, w: 6, d: 5, h: 7,  body: PALETTE.brick2, roof: PALETTE.roofGreen, sign: 'PIZZA',     sc: PALETTE.neonPink,  ac: PALETTE.awning1 },
    ];
    defs.forEach(def => scene.add(createBuilding(def)));
  }

  function createBuilding(def) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(def.w, def.h, def.d),
      new THREE.MeshStandardMaterial({ color: def.body, roughness: 0.75, metalness: 0.05 }));
    body.position.y = def.h / 2;
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(def.w + 0.4, 0.3, def.d + 0.4),
      new THREE.MeshStandardMaterial({ color: def.roof, roughness: 0.8 }));
    roof.position.y = def.h + 0.15; roof.castShadow = true;
    g.add(roof);

    const cornice = new THREE.Mesh(new THREE.BoxGeometry(def.w + 0.6, 0.2, def.d + 0.6),
      new THREE.MeshStandardMaterial({ color: def.body, roughness: 0.7 }));
    cornice.position.y = def.h + 0.3;
    g.add(cornice);

    // Windows
    const wLit = new THREE.MeshStandardMaterial({ color: PALETTE.windowLit, emissive: PALETTE.windowLit, emissiveIntensity: 0, roughness: 0.3 });
    const wOff = new THREE.MeshStandardMaterial({ color: PALETTE.windowOff, roughness: 0.4 });
    const wBlue = new THREE.MeshStandardMaterial({ color: PALETTE.windowBlue, emissive: PALETTE.windowBlue, emissiveIntensity: 0, roughness: 0.3 });
    const floors = Math.floor(def.h / 2.2);
    const wpx = Math.floor(def.w / 1.8);
    const wpz = Math.floor(def.d / 1.8);

    for (let f = 0; f < floors; f++) {
      const fy = 1.5 + f * 2.2;
      for (let i = 0; i < wpx; i++) {
        const wx = -def.w / 2 + 1.0 + i * (def.w - 1.5) / Math.max(wpx - 1, 1);
        const lit = Math.random() > 0.35;
        const wm = lit ? wLit.clone() : wOff;
        const winF = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.0), wm);
        winF.position.set(wx, fy, def.d / 2 + 0.01);
        g.add(winF);
        const winB = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.0), wm.clone());
        winB.position.set(wx, fy, -def.d / 2 - 0.01);
        winB.rotation.y = Math.PI;
        g.add(winB);
      }
      for (let i = 0; i < wpz; i++) {
        const wz = -def.d / 2 + 1.0 + i * (def.d - 1.5) / Math.max(wpz - 1, 1);
        const lit = Math.random() > 0.35;
        const wm = lit ? (Math.random() > 0.3 ? wLit.clone() : wBlue.clone()) : wOff;
        const winR = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.0), wm);
        winR.position.set(def.w / 2 + 0.01, fy, wz);
        winR.rotation.y = Math.PI / 2;
        g.add(winR);
        const winL = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.0), wm.clone());
        winL.position.set(-def.w / 2 - 0.01, fy, wz);
        winL.rotation.y = -Math.PI / 2;
        g.add(winL);
      }
    }

    // Door
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 0.8 }));
    door.position.set(0, 0.9, def.d / 2 + 0.02);
    g.add(door);
    const doorGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.0),
      new THREE.MeshBasicMaterial({ color: PALETTE.windowLit, transparent: true, opacity: 0 }));
    doorGlow.position.set(0, 1.0, def.d / 2 + 0.015);
    doorGlow.name = 'doorGlow';
    g.add(doorGlow);

    // Awning
    if (def.ac) {
      const awg = new THREE.BoxGeometry(def.w + 0.3, 0.05, 1.2);
      const aw = new THREE.Mesh(awg, new THREE.MeshStandardMaterial({ color: def.ac, roughness: 0.6 }));
      aw.position.set(0, 2.8, def.d / 2 + 0.5);
      aw.castShadow = true;
      g.add(aw);
      const sc2 = Math.floor((def.w + 0.3) / 0.4);
      for (let s = 0; s < sc2; s++) {
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 1.1),
          new THREE.MeshStandardMaterial({ color: s % 2 === 0 ? 0xffffff : def.ac, roughness: 0.6, transparent: true, opacity: 0.4 }));
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(-(def.w + 0.3) / 2 + 0.2 + s * 0.4, 2.83, def.d / 2 + 0.5);
        g.add(stripe);
      }
    }

    // Sign
    if (def.sign) {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, 256, 64);
      ctx.font = 'bold 28px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#' + new THREE.Color(def.sc).getHexString();
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 8;
      ctx.fillText(def.sign, 128, 32);
      const tex = new THREE.CanvasTexture(canvas);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55),
        new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0, roughness: 0.5 }));
      sign.position.set(0, def.h + 1.2, def.d / 2 + 0.02);
      sign.name = 'sign';
      g.add(sign);
    }

    // Chimney
    if (def.h > 7) {
      const chim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.5),
        new THREE.MeshStandardMaterial({ color: PALETTE.brick, roughness: 0.9 }));
      chim.position.set(def.w / 3, def.h + 0.9, -def.d / 4);
      chim.castShadow = true;
      g.add(chim);
    }

    g.position.set(def.x, 0.15, def.z);
    return g;
  }

  // ─── Vehicles ───
  function buildVehicles() {
    const carColors = [PALETTE.carRed, PALETTE.carBlue, PALETTE.carGreen, PALETTE.carYellow, PALETTE.carWhite];
    // Cars on horizontal road
    for (let i = 0; i < 5; i++) {
      const car = createCar(carColors[i % carColors.length]);
      car.position.set(-25 + i * 12, 0.2, 10 + rand(-1.5, 1.5));
      car.userData = { type: 'car', axis: 'x', speed: rand(0.008, 0.018), dir: i % 2 === 0 ? 1 : -1, bounds: 30 };
      scene.add(car); vehicles.push(car);
    }
    // Cars on vertical road
    for (let i = 0; i < 4; i++) {
      const car = createCar(carColors[(i + 2) % carColors.length]);
      car.position.set(10 + rand(-1.5, 1.5), 0.2, -25 + i * 14);
      car.rotation.y = Math.PI / 2;
      car.userData = { type: 'car', axis: 'z', speed: rand(0.008, 0.015), dir: i % 2 === 0 ? 1 : -1, bounds: 28 };
      scene.add(car); vehicles.push(car);
    }
    // Bus
    const bus = createBus();
    bus.position.set(0, 0.2, 10);
    bus.userData = { type: 'bus', axis: 'x', speed: 0.006, dir: 1, bounds: 30 };
    scene.add(bus); vehicles.push(bus);
    // Parked cars
    [{ x: -11, z: -2 }, { x: -3, z: -2 }, { x: 18, z: -2 }, { x: 26, z: -2 }, { x: 6, z: 6 }].forEach((p, i) => {
      const car = createCar(carColors[(i + 3) % carColors.length]);
      car.position.set(p.x, 0.2, p.z);
      car.rotation.y = (p.z === -2) ? Math.PI / 2 : 0;
      car.userData = { type: 'parked' };
      scene.add(car);
    });
  }

  function createCar(color) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.8),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 }));
    body.position.y = 0.35; body.castShadow = true; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.7),
      new THREE.MeshStandardMaterial({ color: 0xaaccee, roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.6 }));
    cab.position.set(-0.1, 0.8, 0); g.add(cab);
    const wg = new THREE.CylinderGeometry(0.18, 0.18, 0.1, 12);
    const wm = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
    [[-0.5,0.18,0.42],[-0.5,0.18,-0.42],[0.5,0.18,0.42],[0.5,0.18,-0.42]].forEach(p => {
      const w = new THREE.Mesh(wg, wm); w.rotation.x = Math.PI / 2; w.position.set(...p); g.add(w);
    });
    const hlm = new THREE.MeshBasicMaterial({ color: 0xffffcc });
    [-0.35, 0.35].forEach(z => { const h = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), hlm); h.position.set(0.82, 0.35, z); g.add(h); });
    const tlm = new THREE.MeshBasicMaterial({ color: 0xff3333 });
    [-0.35, 0.35].forEach(z => { const t = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), tlm); t.position.set(-0.82, 0.35, z); g.add(t); });
    return g;
  }

  function createBus() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.1, 0.9),
      new THREE.MeshStandardMaterial({ color: PALETTE.busColor, roughness: 0.5, metalness: 0.2 }));
    body.position.y = 0.6; body.castShadow = true; g.add(body);
    const wm = new THREE.MeshStandardMaterial({ color: 0xaaccee, roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.5 });
    for (let i = 0; i < 5; i++) {
      const wf = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), wm);
      wf.position.set(-1.0 + i * 0.55, 0.9, 0.46); g.add(wf);
      const wb = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), wm.clone());
      wb.position.set(-1.0 + i * 0.55, 0.9, -0.46); wb.rotation.y = Math.PI; g.add(wb);
    }
    const wg = new THREE.CylinderGeometry(0.22, 0.22, 0.12, 12);
    const wmm = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
    [[-1.1,0.22,0.5],[-1.1,0.22,-0.5],[1.1,0.22,0.5],[1.1,0.22,-0.5]].forEach(p => {
      const w = new THREE.Mesh(wg, wmm); w.rotation.x = Math.PI / 2; w.position.set(...p); g.add(w);
    });
    return g;
  }

  // ─── Pedestrians ───
  function buildPedestrians() {
    const spawns = [
      { x: -10, z: -4, tx: -20, tz: -4 }, { x: -18, z: -4, tx: -6, tz: -4 },
      { x: 0, z: -4, tx: 10, tz: -4 }, { x: 6, z: -4, tx: -4, tz: -4 },
      { x: -10, z: 4, tx: -20, tz: 4 }, { x: -18, z: 4, tx: -6, tz: 4 },
      { x: 0, z: 6, tx: 0, tz: 14 }, { x: 0, z: 12, tx: 0, tz: 4 },
      { x: 20, z: -4, tx: 26, tz: -4 }, { x: 24, z: -4, tx: 16, tz: -4 },
      { x: 6, z: 10, tx: 14, tz: 10 }, { x: 14, z: 10, tx: 6, tz: 10 },
    ];
    spawns.forEach((s, i) => {
      const ped = createPedestrian(PALETTE.pedColors[i % PALETTE.pedColors.length]);
      ped.position.set(s.x, 0.15, s.z);
      ped.userData = { type: 'ped', startPos: { x: s.x, z: s.z }, target: { x: s.tx, z: s.tz }, speed: rand(0.004, 0.01), phase: rand(0, Math.PI * 2) };
      scene.add(ped); pedestrians.push(ped);
    });
  }

  function createPedestrian(jacketColor) {
    const g = new THREE.Group();
    const skin = [0xffccaa, 0xd4a574, 0x8d5524, 0xc68642][randInt(0, 3)];
    const pants = [0x334466, 0x553322, 0x444455, 0x223344][randInt(0, 3)];
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.22),
      new THREE.MeshStandardMaterial({ color: jacketColor, roughness: 0.8 }));
    torso.position.y = 0.75; g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8),
      new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }));
    head.position.y = 1.15; g.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8),
      new THREE.MeshStandardMaterial({ color: [0x2a1a0a, 0x5a3a1a, 0x8a6a3a, 0x1a1a1a][randInt(0, 3)], roughness: 0.9 }));
    hair.position.y = 1.2; hair.scale.set(1, 0.6, 1); g.add(hair);
    const legG = new THREE.BoxGeometry(0.12, 0.45, 0.14);
    const legM = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.8 });
    const ll = new THREE.Mesh(legG, legM); ll.position.set(-0.08, 0.25, 0); ll.name = 'leftLeg'; g.add(ll);
    const rl = new THREE.Mesh(legG, legM); rl.position.set(0.08, 0.25, 0); rl.name = 'rightLeg'; g.add(rl);
    const armG = new THREE.BoxGeometry(0.1, 0.4, 0.1);
    const la = new THREE.Mesh(armG, torso.material); la.position.set(-0.23, 0.75, 0); la.name = 'leftArm'; g.add(la);
    const ra = new THREE.Mesh(armG, torso.material); ra.position.set(0.23, 0.75, 0); ra.name = 'rightArm'; g.add(ra);
    const shoeM = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
    [-0.08, 0.08].forEach(x => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.08, 0.2), shoeM);
      s.position.set(x, 0.04, 0.03); g.add(s);
    });
    return g;
  }

  // ─── Smoke ───
  function buildSmokeChimneys() {
    [{ x: -13, z: -4 }, { x: -3, z: -4 }, { x: 16, z: 4 }, { x: 16, z: 12 }].forEach(pos => {
      for (let i = 0; i < 6; i++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.12 + Math.random() * 0.1, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0xbbbbcc, transparent: true, opacity: 0.15 }));
        s.position.set(pos.x + rand(-0.3, 0.3), 14 + i * 1.2, pos.z + rand(-0.3, 0.3));
        s.userData = { baseX: pos.x, baseZ: pos.z, baseY: 14 + i * 1.2, phase: rand(0, Math.PI * 2), speed: rand(0.3, 0.6) };
        scene.add(s); smokeParticles.push(s);
      }
    });
  }

  // ─── Details ───
  function buildDetails() {
    // Mailboxes
    const mbMat = new THREE.MeshStandardMaterial({ color: 0x3355aa, roughness: 0.6 });
    [[-7,14.6],[-23,14.6],[16,14.6],[24,14.6]].forEach(([x, z]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.25), mbMat);
      m.position.set(x, 0.4, z); m.castShadow = true; scene.add(m);
    });
    // Fire hydrants
    const fhMat = new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.5, metalness: 0.3 });
    [[-9,14.6],[22,14.6]].forEach(([x, z]) => {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.45, 8), fhMat);
      f.position.set(x, 0.375, z); f.castShadow = true; scene.add(f);
    });
    // Benches
    const bMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.85 });
    const bMetal = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6, metalness: 0.5 });
    [[-25,14.6,0],[-25,-6,Math.PI]].forEach(([x, z, ry]) => {
      const b = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.35), bMat);
      seat.position.set(0, 0.45, 0);
      b.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.05), bMat);
      back.position.set(0, 0.7, -0.15);
      b.add(back);
      const legG = new THREE.BoxGeometry(0.06, 0.45, 0.3);
      [-0.5, 0.5].forEach(lx => { const leg = new THREE.Mesh(legG, bMetal); leg.position.set(lx, 0.225, 0); b.add(leg); });
      b.position.set(x, 0.15, z); b.rotation.y = ry; scene.add(b);
    });
    // Trash cans
    const tcMat = new THREE.MeshStandardMaterial({ color: 0x556655, roughness: 0.7 });
    [[-8,14.6],[12,14.6],[-22,-4]].forEach(([x, z]) => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.15, 0.55, 8), tcMat);
      t.position.set(x, 0.425, z); t.castShadow = true; scene.add(t);
    });
    // Potted plants
    const potM = new THREE.MeshStandardMaterial({ color: 0x9b5538, roughness: 0.9 });
    const plantM = new THREE.MeshStandardMaterial({ color: 0x3a7a3a, roughness: 0.85 });
    [[4,14.6],[5.5,14.6],[-2,14.6]].forEach(([x, z]) => {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.25, 8), potM);
      pot.position.set(x, 0.275, z); scene.add(pot);
      const plant = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), plantM);
      plant.position.set(x, 0.5, z); plant.scale.y = 0.8; scene.add(plant);
    });
    // Bike
    const bike = new THREE.Group();
    const metalM = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.7 });
    const tireM = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
    [-0.5, 0.5].forEach(wx => {
      const wh = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.025, 6, 16), tireM);
      wh.position.set(wx, 0.25, 0); bike.add(wh);
    });
    const tubes = [
      { p: [0, 0.45, 0], r: [0, 0, 0.3] }, { p: [0.1, 0.4, 0], r: [0, 0, -0.4] }, { p: [-0.15, 0.55, 0], r: [0, 0, 0.15] }
    ];
    tubes.forEach(t => {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 6), metalM);
      tube.position.set(...t.p); tube.rotation.set(...t.r); bike.add(tube);
    });
    const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 6), metalM);
    hb.position.set(0.45, 0.65, 0); hb.rotation.z = Math.PI / 2; bike.add(hb);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 }));
    seat.position.set(-0.2, 0.68, 0); bike.add(seat);
    bike.position.set(-27, 0.15, 6); scene.add(bike);
    // Outdoor cafe seating
    const tblM = new THREE.MeshStandardMaterial({ color: 0x887766, roughness: 0.7 });
    const chM = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.6, metalness: 0.3 });
    for (let i = 0; i < 3; i++) {
      const tbl = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.04, 8), tblM);
      tbl.position.set(4 + i * 1.5, 0.55, 15.5); scene.add(tbl);
      const tl = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6), chM);
      tl.position.set(4 + i * 1.5, 0.275, 15.5); scene.add(tl);
      for (let j = 0; j < 2; j++) {
        const angle = j === 0 ? -0.6 : 0.6;
        const ch = new THREE.Group();
        const cs = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.3), chM);
        cs.position.y = 0.42; ch.add(cs);
        const clG = new THREE.CylinderGeometry(0.015, 0.015, 0.42, 4);
        [[-0.12,0.21,-0.12],[0.12,0.21,-0.12],[-0.12,0.21,0.12],[0.12,0.21,0.12]].forEach(p => {
          const cl = new THREE.Mesh(clG, chM); cl.position.set(...p); ch.add(cl);
        });
        const cb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.03), chM);
        cb.position.set(0, 0.6, -0.14); ch.add(cb);
        ch.position.set(4 + i * 1.5 + Math.sin(angle) * 0.5, 0.15, 15.5 + Math.cos(angle) * 0.5);
        ch.rotation.y = angle + Math.PI;
        scene.add(ch);
      }
    }
  }

  // ─── Lighting ───
  function setupLighting() {
    ambientLight = new THREE.AmbientLight(0x404060, 0.3);
    scene.add(ambientLight);
    scene.add(new THREE.HemisphereLight(0x88aacc, 0x444433, 0.4));
    dirLight = new THREE.DirectionalLight(0xffeedd, 1.0);
    dirLight.position.set(20, 30, 15);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 80;
    dirLight.shadow.camera.left = -35;
    dirLight.shadow.camera.right = 35;
    dirLight.shadow.camera.top = 35;
    dirLight.shadow.camera.bottom = -35;
    dirLight.shadow.bias = -0.001;
    scene.add(dirLight);
  }

  // ─── Time of Day System ───
  function updateTimeOfDay(t) {
    const sky = scene.getObjectByName('sky');
    if (sky) {
      const u = sky.material.uniforms;
      u.uSunPos.value = t;
      if (t < 0.2 || t > 0.85) {
        u.uTopColor.value.set(PALETTE.skyNight);
        u.uMidColor.value.set(0x0a0a2e);
        u.uBottomColor.value.set(0x15152a);
        u.uSunColor.value.set(0x4466aa);
      } else if (t < 0.35) {
        const lt = (t - 0.2) / 0.15;
        u.uTopColor.value.lerpColors(new THREE.Color(PALETTE.skyNight), new THREE.Color(0x6688bb), lt);
        u.uMidColor.value.lerpColors(new THREE.Color(0x0a0a2e), new THREE.Color(0xcc8855), lt);
        u.uBottomColor.value.lerpColors(new THREE.Color(0x15152a), new THREE.Color(0xffaa66), lt);
        u.uSunColor.value.lerpColors(new THREE.Color(0x4466aa), new THREE.Color(0xffccaa), lt);
      } else if (t < 0.45) {
        const lt = (t - 0.35) / 0.1;
        u.uTopColor.value.lerpColors(new THREE.Color(0x6688bb), new THREE.Color(PALETTE.skyDay), lt);
        u.uMidColor.value.lerpColors(new THREE.Color(0xcc8855), new THREE.Color(0xb8d4e8), lt);
        u.uBottomColor.value.lerpColors(new THREE.Color(0xffaa66), new THREE.Color(0xd4e8f0), lt);
        u.uSunColor.value.lerpColors(new THREE.Color(0xffccaa), new THREE.Color(0xffeedd), lt);
      } else if (t < 0.65) {
        u.uTopColor.value.set(PALETTE.skyDay);
        u.uMidColor.value.set(0xb8d4e8);
        u.uBottomColor.value.set(0xd4e8f0);
        u.uSunColor.value.set(0xffeedd);
      } else if (t < 0.8) {
        const lt = (t - 0.65) / 0.15;
        u.uTopColor.value.lerpColors(new THREE.Color(PALETTE.skyDay), new THREE.Color(PALETTE.skySunset), lt);
        u.uMidColor.value.lerpColors(new THREE.Color(0xb8d4e8), new THREE.Color(0xcc6633), lt);
        u.uBottomColor.value.lerpColors(new THREE.Color(0xd4e8f0), new THREE.Color(0xff8844), lt);
        u.uSunColor.value.lerpColors(new THREE.Color(0xffeedd), new THREE.Color(0xff7733), lt);
      } else {
        u.uTopColor.value.set(PALETTE.skyNight);
        u.uMidColor.value.set(0x0a0a2e);
        u.uBottomColor.value.set(0x15152a);
        u.uSunColor.value.set(0x4466aa);
      }
    }
    const isNight = t < 0.22 || t > 0.82;
    const isDusk = (t > 0.35 && t < 0.45) || (t > 0.7 && t < 0.8);
    ambientLight.intensity = lerp(ambientLight.intensity, isNight ? 0.15 : 0.4, 0.05);
    dirLight.intensity = lerp(dirLight.intensity, isNight ? 0.15 : isDusk ? 0.6 : 1.0, 0.05);
    dirLight.color.set(isDusk ? 0xffaa77 : 0xffeedd);
    windLights.forEach(wl => {
      if (isNight) {
        const flicker = 0.85 + Math.sin(Date.now() * 0.003 + wl.phase) * 0.15;
        wl.light.intensity = lerp(wl.light.intensity, 1.5 * flicker, 0.05);
        wl.glow.material.opacity = lerp(wl.glow.material.opacity, 0.5, 0.05);
      } else {
        wl.light.intensity = lerp(wl.light.intensity, 0, 0.05);
        wl.glow.material.opacity = lerp(wl.glow.material.opacity, 0, 0.05);
      }
    });
    const wIntensity = isNight ? 0.8 : isDusk ? 0.4 : 0.0;
    scene.traverse(obj => {
      if (obj.material && obj.material.emissiveIntensity !== undefined && obj !== ambientLight && obj !== dirLight) {
        if (obj.material.emissiveIntensity > 0) obj.material.emissiveIntensity = lerp(obj.material.emissiveIntensity, wIntensity, 0.05);
      }
    });
    scene.traverse(obj => { if (obj.name === 'doorGlow') obj.material.opacity = lerp(obj.material.opacity, wIntensity * 0.6, 0.05); });
    scene.traverse(obj => { if (obj.name === 'sign') obj.material.emissiveIntensity = lerp(obj.material.emissiveIntensity, wIntensity * 0.8, 0.05); });
    if (isNight) { scene.fog.color.set(0x0a0a1e); scene.fog.density = 0.015; }
    else if (isDusk) { scene.fog.color.lerpColors(new THREE.Color(0x8899aa), new THREE.Color(0x332211), (t - 0.7) / 0.1); scene.fog.density = 0.008; }
    else { scene.fog.color.set(0x8899aa); scene.fog.density = 0.008; }
    renderer.toneMappingExposure = isNight ? 0.7 : isDusk ? 0.85 : 1.0;
    const tl = document.getElementById('time-label');
    if (tl) {
      if (t < 0.15) tl.textContent = 'Night';
      else if (t < 0.3) tl.textContent = 'Dawn';
      else if (t < 0.45) tl.textContent = 'Morning';
      else if (t < 0.55) tl.textContent = 'Noon';
      else if (t < 0.7) tl.textContent = 'Afternoon';
      else if (t < 0.85) tl.textContent = 'Dusk';
      else tl.textContent = 'Night';
    }
  }

  // ─── Lo-Fi Audio ───
  function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const master = audioCtx.createGain();
    master.gain.value = 0.3;
    master.connect(audioCtx.destination);
    audioNodes = [master];
    const chords = [
      [261.63, 329.63, 392.00, 493.88],
      [246.94, 311.13, 369.99, 466.16],
      [220.00, 277.18, 329.63, 415.30],
      [196.00, 246.94, 293.66, 369.99],
    ];
    const padGain = audioCtx.createGain();
    padGain.gain.value = 0.12;
    padGain.connect(master);
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    filter.Q.value = 0.5;
    filter.connect(padGain);
    let chordIdx = 0;
    function playChord() {
      chords[chordIdx % chords.length].forEach(freq => {
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.detune.value = rand(-8, 8);
        const g = audioCtx.createGain();
        g.gain.value = 0.08;
        osc.connect(g);
        g.connect(filter);
        const now = audioCtx.currentTime;
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.08, now + 1.5);
        const end = now + 4.5;
        g.gain.setValueAtTime(0.08, end - 0.3);
        g.gain.linearRampToValueAtTime(0, end);
        osc.start(now);
        osc.stop(end + 0.1);
      });
      chordIdx++;
      setTimeout(playChord, 4500 + rand(-300, 300));
    }
    // Vinyl crackle
    const bufSize = audioCtx.sampleRate * 2;
    const noiseBuf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      nd[i] = (Math.random() * 2 - 1) * 0.003;
      if (Math.random() < 0.0001) nd[i] = (Math.random() * 2 - 1) * 0.05;
    }
    const noiseSrc = audioCtx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;
    const ng = audioCtx.createGain();
    ng.gain.value = 0.15;
    const nf = audioCtx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 1200;
    nf.Q.value = 0.3;
    noiseSrc.connect(nf);
    nf.connect(ng);
    ng.connect(master);
    noiseSrc.start();
    // Bass
    const bassNotes = [130.81, 123.47, 110.00, 98.00];
    function playBass() {
      const freq = bassNotes[randInt(0, bassNotes.length - 1)];
      const osc = audioCtx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const bg = audioCtx.createGain();
      bg.gain.value = 0.06;
      const bf = audioCtx.createBiquadFilter();
      bf.type = 'lowpass';
      bf.frequency.value = 300;
      osc.connect(bf);
      bf.connect(bg);
      bg.connect(master);
      const now = audioCtx.currentTime;
      bg.gain.setValueAtTime(0, now);
      bg.gain.linearRampToValueAtTime(0.06, now + 0.1);
      bg.gain.linearRampToValueAtTime(0.04, now + 0.8);
      bg.gain.linearRampToValueAtTime(0, now + 1.2);
      osc.start(now);
      osc.stop(now + 1.3);
      setTimeout(playBass, 1800 + rand(0, 800));
    }
    // Melody
    const melodyNotes = [523.25, 587.33, 659.25, 783.99, 880.00, 698.46, 622.25];
    function playMelody() {
      const freq = melodyNotes[randInt(0, melodyNotes.length - 1)];
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const mg = audioCtx.createGain();
      mg.gain.value = 0.025;
      const conv = audioCtx.createConvolver();
      const rb = audioCtx.createBuffer(2, audioCtx.sampleRate * 2, audioCtx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = rb.getChannelData(ch);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.5);
      }
      conv.buffer = rb;
      const wg = audioCtx.createGain();
      wg.gain.value = 0.2;
      conv.connect(wg);
      osc.connect(mg);
      mg.connect(conv);
      mg.connect(master);
      const now = audioCtx.currentTime;
      mg.gain.setValueAtTime(0, now);
      mg.gain.linearRampToValueAtTime(0.025, now + 0.05);
      mg.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
      osc.start(now);
      osc.stop(now + 1.6);
      setTimeout(playMelody, 2500 + rand(500, 3000));
    }
    // Hi-hat
    function playHiHat() {
      const bs = audioCtx.sampleRate * 0.05;
      const buf = audioCtx.createBuffer(1, bs, audioCtx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bs; i++) d[i] = (Math.random() * 2 - 1);
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const hg = audioCtx.createGain();
      hg.gain.value = 0.02;
      const hf = audioCtx.createBiquadFilter();
      hf.type = 'highpass';
      hf.frequency.value = 8000;
      src.connect(hf);
      hf.connect(hg);
      hg.connect(master);
      src.start();
      setTimeout(playHiHat, 400 + rand(0, 200));
    }
    setTimeout(() => { playChord(); playBass(); playMelody(); playHiHat(); }, 300);
  }

  function toggleAudio() {
    if (!audioCtx) {
      initAudio();
      audioPlaying = true;
      document.getElementById('audio-btn').textContent = '🎵 Sound ON';
    } else if (audioPlaying) {
      audioCtx.suspend();
      audioPlaying = false;
      document.getElementById('audio-btn').textContent = '🔇 Sound OFF';
    } else {
      audioCtx.resume();
      audioPlaying = true;
      document.getElementById('audio-btn').textContent = '🎵 Sound ON';
    }
  }

  // ─── Animation Loop ───
  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    const t = clock.getElapsedTime();
    controls.update();
    // Vehicles
    vehicles.forEach(v => {
      if (v.userData.type === 'parked') return;
      const u = v.userData;
      if (u.axis === 'x') {
        v.position.x += u.speed * u.dir;
        if (v.position.x > u.bounds) v.position.x = -u.bounds;
        if (v.position.x < -u.bounds) v.position.x = u.bounds;
      } else {
        v.position.z += u.speed * u.dir;
        if (v.position.z > u.bounds) v.position.z = -u.bounds;
        if (v.position.z < -u.bounds) v.position.z = u.bounds;
      }
    });
    // Pedestrians
    pedestrians.forEach(p => {
      const u = p.userData;
      const dx = u.target.x - p.position.x;
      const dz = u.target.z - p.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 0.3) {
        const sws = [
          { x: rand(-28, -12), z: -4 }, { x: rand(-28, -12), z: 4 },
          { x: rand(12, 28), z: -4 },   { x: rand(12, 28), z: 4 },
          { x: -4, z: rand(-8, -2) },   { x: -4, z: rand(6, 14) },
          { x: 6, z: rand(-8, -2) },    { x: 6, z: rand(6, 14) },
          { x: rand(-28, -12), z: 14 }, { x: rand(12, 28), z: 14 },
        ];
        const tgt = sws[randInt(0, sws.length - 1)];
        u.target = { x: tgt.x, z: tgt.z };
        const ndx = tgt.x - p.position.x;
        const ndz = tgt.z - p.position.z;
        p.rotation.y = Math.abs(ndx) > Math.abs(ndz) ? (ndx > 0 ? Math.PI / 2 : -Math.PI / 2) : (ndz > 0 ? 0 : Math.PI);
      } else {
        const spd = u.speed * 30 * dt;
        p.position.x += (dx / dist) * spd;
        p.position.z += (dz / dist) * spd;
        const swing = Math.sin(t * 6 + u.phase) * 0.25;
        const ll = p.getObjectByName('leftLeg');
        const rl = p.getObjectByName('rightLeg');
        const la = p.getObjectByName('leftArm');
        const ra = p.getObjectByName('rightArm');
        if (ll) ll.rotation.x = swing;
        if (rl) rl.rotation.x = -swing;
        if (la) la.rotation.x = -swing * 0.5;
        if (ra) ra.rotation.x = swing * 0.5;
      }
    });
    // Smoke
    smokeParticles.forEach(sm => {
      const u = sm.userData;
      sm.position.y = u.baseY + Math.sin(t * u.speed + u.phase) * 0.5;
      sm.position.x = u.baseX + Math.sin(t * u.speed * 0.7 + u.phase) * 0.4;
      sm.position.z = u.baseZ + Math.cos(t * u.speed * 0.5 + u.phase) * 0.3;
      sm.material.opacity = 0.08 + Math.sin(t * u.speed + u.phase) * 0.04;
      const s = 1 + Math.sin(t * u.speed + u.phase) * 0.2;
      sm.scale.set(s, s, s);
    });
    // Time cycle
    // Slow auto cycle for ambient atmosphere
    const cycleT = (t * 0.0008) % 1.0;  // ~20 seconds per full day
    updateTimeOfDay(cycleT);
    // Step mode
    if (window._isStepMode) {
      window._stepCount++;
      vehicles.forEach(v => {
        if (v.userData.type === 'parked') return;
        const u = v.userData;
        if (u.axis === 'x') {
          v.position.x += u.speed * u.dir * 3;
          if (v.position.x > u.bounds) v.position.x = -u.bounds;
          if (v.position.x < -u.bounds) v.position.x = u.bounds;
        } else {
          v.position.z += u.speed * u.dir * 3;
          if (v.position.z > u.bounds) v.position.z = -u.bounds;
          if (v.position.z < -u.bounds) v.position.z = u.bounds;
        }
      });
      pedestrians.forEach(p => {
        const u = p.userData;
        const dx = u.target.x - p.position.x;
        const dz = u.target.z - p.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 0.5) {
          const sws = [{ x: rand(-28, -12), z: -4 }, { x: rand(-28, -12), z: 4 },
                        { x: rand(12, 28), z: -4 }, { x: rand(12, 28), z: 4 }];
          const tgt = sws[randInt(0, sws.length - 1)];
          u.target = { x: tgt.x, z: tgt.z };
        } else {
          p.position.x += (dx / dist) * u.speed * 15;
          p.position.z += (dz / dist) * u.speed * 15;
        }
      });
      window.DIORAMA._lastStep = {
        vehicles: vehicles.map(v => ({ x: +v.position.x.toFixed(2), z: +v.position.z.toFixed(2), type: v.userData.type })),
        pedestrians: pedestrians.map(p => ({ x: +p.position.x.toFixed(2), z: +p.position.z.toFixed(2) })),
        timeOfDay: +smoothT.toFixed(3),
        step: window._stepCount,
      };
    }
    renderer.render(scene, camera);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ─── Start ───
  window.addEventListener('DOMContentLoaded', () => {
    init();
    document.getElementById('start-btn').addEventListener('click', () => {
      document.getElementById('title-overlay').classList.add('hidden');
      document.getElementById('hud').classList.remove('hidden');
      document.getElementById('time-control').classList.remove('hidden');
      document.getElementById('audio-toggle').classList.remove('hidden');
      initAudio();
    });
    document.getElementById('time-slider').addEventListener('input', (e) => {
      updateTimeOfDay(parseFloat(e.target.value) / 100);
    });
    document.getElementById('audio-btn').addEventListener('click', toggleAudio);
  });

})();
