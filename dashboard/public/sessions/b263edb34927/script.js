/* ===== City Time Machine — Script ===== */

// ---- Global references ----
let scene, camera, renderer, controls;
let clock = new THREE.Clock();
let audioCtx = null, audioStarted = false;
let musicNodes = [];
let animatingObjects = []; // { object, updateFn }
let movingVehicles = [];
let walkingPedestrians = [];
let flickerLights = [];
let particleSystem = null;

// ---- Color palette ----
const PALETTE = {
  warmLight:     0xffd080,
  windowGlow:    0xffe8a0,
  buildingA:     0x5a4a3a,
  buildingB:     0x4a3a2a,
  buildingC:     0x6a5a4a,
  buildingD:     0x3a3028,
  buildingE:     0x4a4040,
  roofA:         0x8a2a2a,
  roofB:         0x3a3030,
  sidewalk:      0x999090,
  road:          0x3a3a3a,
  treeTrunk:     0x4a3520,
  treeLeaf:      0x2a5a2a,
  carRed:        0xcc3333,
  carBlue:       0x3344aa,
  carGreen:      0x33aa55,
  carCream:      0xddccaa,
  neonRed:       0xff2020,
  neonBlue:      0x2080ff,
  neonPink:      0xff40a0,
  neonGreen:     0x40ff80,
  neonOrange:    0xff8020,
  neonYellow:    0xffdd20,
  pedestrianA:   0xcc4444,
  pedestrianB:   0x4466cc,
  pedestrianC:   0xcc8844,
  pedestrianD:   0x44aa88,
  pedestrianE:   0xaa44cc,
  white:         0xeeeeee,
  dark:          0x1a1a1a,
};

// ---- Initialization ----
function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a080f);
  scene.fog = new THREE.FogExp2(0x0a080f, 0.012);

  // Camera
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(22, 20, 22);

  // Renderer — use WebGL2 for environments without WebGL1
  const container = document.getElementById('canvas-container');
  const tmpCanvas = document.createElement('canvas');
  const preferWebGL2 = tmpCanvas.getContext('webgl2') || tmpCanvas.getContext('webgl');
  renderer = new THREE.WebGLRenderer({ 
    antialias: true, 
    alpha: false, 
    powerPreference: 'high-performance',
    context: preferWebGL2 || undefined
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  container.appendChild(renderer.domElement);
  renderer.domElement.id = 'canvas-container';

  // Verify WebGL context
  const glCtx = renderer.domElement.getContext('webgl2') || renderer.domElement.getContext('webgl');
  if (!glCtx) {
    console.error('WebGL not available');
    document.getElementById('loading-overlay').innerHTML = '<p style="color:#ff4444;">WebGL not supported in this environment.</p>';
    return;
  }
  console.log('WebGL context type:', glCtx instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1');

  // Controls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 - 0.1;
  controls.minDistance = 8;
  controls.maxDistance = 50;
  controls.target.set(0, 2, 0);
  controls.update();

  // Build scene
  createLighting();
  createGround();
  createRoads();
  createBuildings();
  createVehicles();
  createPedestrians();
  createTrees();
  createDetails();
  createParticles();

  // Events
  window.addEventListener('resize', onResize);
  window.addEventListener('DOMContentLoaded', initAudioUI);

  // Hide loading
  setTimeout(() => {
    document.getElementById('loading-overlay').classList.add('hidden');
    setTimeout(() => {
      document.getElementById('loading-overlay').remove();
      document.getElementById('info-panel').classList.add('fade');
    }, 600);
  }, 500);

  // Animate
  animate();
}

// ---- Lighting ----
function createLighting() {
  // Ambient — soft warm fill
  const ambient = new THREE.AmbientLight(0x3a2a1a, 0.35);
  scene.add(ambient);

  // Hemisphere — sky/ground gradient
  const hemi = new THREE.HemisphereLight(0x1a2a3a, 0x1a1a0a, 0.25);
  scene.add(hemi);

  // Moon-like directional
  const dir = new THREE.DirectionalLight(0x6688aa, 0.15);
  dir.position.set(-10, 15, -8);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.left = -25;
  dir.shadow.camera.right = 25;
  dir.shadow.camera.top = 25;
  dir.shadow.camera.bottom = -25;
  scene.add(dir);

  // Street lamps — warm point lights
  const lampPositions = [
    [-9, 0, -9], [9, 0, -9],
    [-9, 0, 9], [9, 0, 9],
    [0, 0, -14], [0, 0, 14],
  ];
  lampPositions.forEach(pos => {
    createStreetLamp(pos[0], pos[1], pos[2]);
  });
}

// ---- Ground ----
function createGround() {
  // Base ground
  const groundGeo = new THREE.PlaneGeometry(80, 80);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a1a0a, roughness: 0.9 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  // Diorama edge — raised border
  const borderGeo = new THREE.BoxGeometry(30, 0.4, 30);
  const borderMat = new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 0.8 });
  const border = new THREE.Mesh(borderGeo, borderMat);
  border.position.y = -0.2;
  border.receiveShadow = true;
  scene.add(border);

  // Glass dome (semi-transparent)
  const domeGeo = new THREE.SphereGeometry(14.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const domeMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.04,
    roughness: 0.0,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.position.y = 0;
  scene.add(dome);
}

// ---- Roads and Sidewalks ----
function createRoads() {
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: PALETTE.sidewalk, roughness: 0.85 });
  const roadMat = new THREE.MeshStandardMaterial({ color: PALETTE.road, roughness: 0.9 });

  // Horizontal road
  const roadHGeo = new THREE.PlaneGeometry(20, 4);
  const roadH = new THREE.Mesh(roadHGeo, roadMat);
  roadH.rotation.x = -Math.PI / 2;
  roadH.position.y = 0.01;
  roadH.position.z = 0;
  roadH.receiveShadow = true;
  scene.add(roadH);

  // Vertical road
  const roadVGeo = new THREE.PlaneGeometry(4, 20);
  const roadV = new THREE.Mesh(roadVGeo, roadMat);
  roadV.rotation.x = -Math.PI / 2;
  roadV.position.y = 0.01;
  roadV.position.x = 0;
  roadV.receiveShadow = true;
  scene.add(roadV);

  // Road center lines — horizontal
  for (let i = -9; i <= 9; i += 2) {
    const lineGeo = new THREE.PlaneGeometry(1, 0.12);
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xddcc66, roughness: 0.5 });
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.02;
    line.position.z = i;
    scene.add(line);
  }

  // Crosswalks
  for (let i = -1.8; i <= 1.8; i += 0.6) {
    const cwGeo = new THREE.PlaneGeometry(4, 0.3);
    const cwMat = new THREE.MeshStandardMaterial({ color: 0xddddcc, roughness: 0.8 });
    const cw = new THREE.Mesh(cwGeo, cwMat);
    cw.rotation.x = -Math.PI / 2;
    cw.position.y = 0.02;
    cw.position.x = i;
    cw.position.z = 0;
    scene.add(cw);
  }

  // Sidewalks (four corners)
  const swPositions = [
    [-7, 0.05, -7], [7, 0.05, -7],
    [-7, 0.05, 7], [7, 0.05, 7],
  ];
  swPositions.forEach(([x, y, z]) => {
    const swGeo = new THREE.BoxGeometry(5, 0.1, 5);
    const sw = new THREE.Mesh(swGeo, sidewalkMat);
    sw.position.set(x, y, z);
    sw.receiveShadow = true;
    scene.add(sw);
  });
}

// ---- Street Lamps ----
function createStreetLamp(x, y, z) {
  const group = new THREE.Group();
  group.position.set(x, y, z);

  // Pole
  const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 3.5, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.4 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 1.75;
  group.add(pole);

  // Arm
  const armGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.8, 8);
  const arm = new THREE.Mesh(armGeo, poleMat);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(0.35, 3.4, 0);
  group.add(arm);

  // Lamp shade
  const shadeGeo = new THREE.CylinderGeometry(0.25, 0.15, 0.3, 12);
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4 });
  const shade = new THREE.Mesh(shadeGeo, shadeMat);
  shade.position.set(0.7, 3.55, 0);
  group.add(shade);

  // Light bulb (emissive)
  const bulbGeo = new THREE.SphereGeometry(0.12, 8, 8);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffeedd, emissive: 0xffddaa, emissiveIntensity: 2 });
  const bulb = new THREE.Mesh(bulbGeo, bulbMat);
  bulb.position.set(0.7, 3.35, 0);
  group.add(bulb);
  flickerLights.push(bulb);

  // Point light
  const light = new THREE.PointLight(0xffd080, 1.2, 12, 2);
  light.position.set(0.7, 3.3, 0);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  group.add(light);

  scene.add(group);
}

// ---- Buildings ----
function createBuildings() {
  // --- Building 1: Apartment building (left, back) ---
  createBuilding({
    x: -7, z: -7,
    width: 5, height: 8, depth: 5,
    color: PALETTE.buildingA,
    roofColor: PALETTE.roofA,
    roofType: 'flat',
    hasWindows: true,
    windowRows: 3,
    windowCols: 2,
    hasDoor: true,
    hasAwning: false,
  });

  // --- Building 2: Shop with neon sign (right, front) ---
  createBuilding({
    x: 7, z: 7,
    width: 5, height: 5, depth: 5,
    color: PALETTE.buildingB,
    roofColor: PALETTE.roofB,
    roofType: 'flat',
    hasWindows: true,
    windowRows: 1,
    windowCols: 3,
    hasDoor: true,
    hasAwning: true,
    awningColor: PALETTE.neonRed,
    neonSign: { text: 'CAFÉ', color: PALETTE.neonYellow },
  });

  // --- Building 3: Tall apartment (left, front) ---
  createBuilding({
    x: -7, z: 7,
    width: 4, height: 10, depth: 4,
    color: PALETTE.buildingC,
    roofColor: PALETTE.roofB,
    roofType: 'flat',
    hasWindows: true,
    windowRows: 4,
    windowCols: 2,
    hasDoor: true,
    hasAwning: false,
  });

  // --- Building 4: Small house (right, back) ---
  createBuilding({
    x: 7, z: -7,
    width: 4, height: 4, depth: 4,
    color: PALETTE.buildingD,
    roofColor: PALETTE.roofA,
    roofType: 'pitched',
    hasWindows: true,
    windowRows: 1,
    windowCols: 2,
    hasDoor: true,
    hasAwning: false,
  });

  // --- Building 5: Storefront (center-right, slightly forward) ---
  createBuilding({
    x: 3, z: -2,
    width: 3, height: 3.5, depth: 3,
    color: PALETTE.buildingE,
    roofColor: PALETTE.roofB,
    roofType: 'flat',
    hasWindows: true,
    windowRows: 1,
    windowCols: 3,
    hasDoor: true,
    hasAwning: true,
    awningColor: PALETTE.neonBlue,
    neonSign: { text: 'BOOKS', color: PALETTE.neonPink },
  });

  // --- Building 6: Bakery (center-left, slightly forward) ---
  createBuilding({
    x: -3, z: 2,
    width: 3.5, height: 3, depth: 3,
    color: 0x6a5040,
    roofColor: PALETTE.roofA,
    roofType: 'pitched',
    hasWindows: true,
    windowRows: 1,
    windowCols: 2,
    hasDoor: true,
    hasAwning: false,
    neonSign: { text: 'BAKE', color: PALETTE.neonOrange },
  });
}

function createBuilding(opts) {
  const group = new THREE.Group();
  group.position.set(opts.x, 0, opts.z);

  // Main body
  const bodyGeo = new THREE.BoxGeometry(opts.width, opts.height, opts.depth);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: opts.color,
    roughness: 0.7,
    metalness: 0.1,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = opts.height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Roof
  if (opts.roofType === 'pitched') {
    const roofGeo = new THREE.ConeGeometry(Math.max(opts.width, opts.depth) / 2 + 0.5, 2, 4);
    const roofMat = new THREE.MeshStandardMaterial({ color: opts.roofColor, roughness: 0.8 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = opts.height + 1;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);
  } else {
    // Flat roof — parapet
    const parapetGeo = new THREE.BoxGeometry(opts.width + 0.4, 0.4, opts.depth + 0.4);
    const parapetMat = new THREE.MeshStandardMaterial({ color: opts.roofColor, roughness: 0.8 });
    const parapet = new THREE.Mesh(parapetGeo, parapetMat);
    parapet.position.y = opts.height + 0.2;
    group.add(parapet);

    // Chimney for apartment
    if (opts.height > 7) {
      const chimneyGeo = new THREE.BoxGeometry(0.6, 1.5, 0.6);
      const chimneyMat = new THREE.MeshStandardMaterial({ color: 0x554433, roughness: 0.9 });
      const chimney = new THREE.Mesh(chimneyGeo, chimneyMat);
      chimney.position.set(opts.width / 3, opts.height + 1, opts.depth / 3);
      group.add(chimney);
    }
  }

  // Windows
  if (opts.hasWindows) {
    const winW = Math.min(0.6, (opts.width - 1) / opts.windowCols);
    const winH = 0.8;
    const winSpacingX = (opts.width - winW * opts.windowCols) / (opts.windowCols + 1);
    const winSpacingY = (opts.height - 2) / opts.windowRows;

    for (let row = 0; row < opts.windowRows; row++) {
      for (let col = 0; col < opts.windowCols; col++) {
        const wx = -opts.width / 2 + winSpacingX + winW / 2 + col * (winW + winSpacingX);
        const wy = winSpacingY + row * (winH + winSpacingY);
        createWindow(group, wx, wy, 0, winW, winH, true); // front face
        createWindow(group, wx, wy, opts.depth / 2, winW, winH, true); // side face
      }
    }
  }

  // Door
  if (opts.hasDoor) {
    const doorGeo = new THREE.BoxGeometry(0.8, 1.6, 0.1);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.7 });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 0.8, opts.depth / 2 + 0.05);
    group.add(door);

    // Door light (warm glow)
    const doorLight = new THREE.PointLight(0xffaa55, 0.4, 4);
    doorLight.position.set(0, 1.5, opts.depth / 2 + 0.3);
    group.add(doorLight);
    flickerLights.push(doorLight);

    // Door knob
    const knobGeo = new THREE.SphereGeometry(0.05, 8, 8);
    const knobMat = new THREE.MeshStandardMaterial({ color: 0xddaa33, metalness: 0.8, roughness: 0.2 });
    const knob = new THREE.Mesh(knobGeo, knobMat);
    knob.position.set(0.2, 0.9, opts.depth / 2 + 0.15);
    group.add(knob);
  }

  // Awning
  if (opts.hasAwning) {
    const awningGeo = new THREE.BoxGeometry(opts.width + 0.6, 0.15, 1.2);
    const awningMat = new THREE.MeshStandardMaterial({
      color: opts.awningColor || 0xcc4444,
      roughness: 0.6,
      emissive: opts.awningColor || 0xcc4444,
      emissiveIntensity: 0.3,
    });
    const awning = new THREE.Mesh(awningGeo, awningMat);
    awning.position.set(0, 2.2, opts.depth / 2 + 0.6);
    group.add(awning);

    // Awning support poles
    const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8 });
    [[-opts.width / 2 - 0.2, 1.9], [opts.width / 2 + 0.2, 1.9]].forEach(([px, py]) => {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(px, py, opts.depth / 2 + 0.8);
      group.add(pole);
    });
  }

  // Neon sign
  if (opts.neonSign) {
    createNeonSign(group, opts.neonSign.text, opts.neonSign.color, opts.width, opts.height, opts.depth);
  }

  scene.add(group);
}

// ---- Window ----
function createWindow(parent, wx, wy, wz, w, h, glow) {
  const winGroup = new THREE.Group();
  winGroup.position.set(wx, wy, wz);

  // Window frame
  const frameGeo = new THREE.BoxGeometry(w + 0.15, h + 0.15, 0.08);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5 });
  const frame = new THREE.Mesh(frameGeo, frameMat);
  winGroup.add(frame);

  // Glass
  const glassGeo = new THREE.PlaneGeometry(w, h);
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x334455,
    emissive: glow ? 0xffd080 : 0x111111,
    emissiveIntensity: glow ? 0.8 : 0,
    roughness: 0.1,
    metalness: 0.3,
    side: THREE.DoubleSide,
  });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.position.z = 0.02;
  winGroup.add(glass);

  // Window cross (mullion)
  const crossGeo = new THREE.BoxGeometry(w * 0.8, 0.03, 0.06);
  const crossMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5 });
  const crossH = new THREE.Mesh(crossGeo, crossMat);
  crossH.position.z = 0.03;
  winGroup.add(crossH);

  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.03, h * 0.8, 0.06), crossMat);
  crossV.position.z = 0.03;
  winGroup.add(crossV);

  parent.add(winGroup);
}

// ---- Neon Sign ----
function createNeonSign(parent, text, color, buildingWidth, buildingHeight, buildingDepth) {
  const signGroup = new THREE.Group();

  // Sign backing
  const signGeo = new THREE.BoxGeometry(text.length * 0.5 + 0.4, 0.6, 0.15);
  const signMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  const sign = new THREE.Mesh(signGeo, signMat);
  signGroup.add(sign);

  // Neon tube (simplified — glowing box)
  const neonGeo = new THREE.BoxGeometry(text.length * 0.5, 0.25, 0.08);
  const neonMat = new THREE.MeshStandardMaterial({
    color: color,
    emissive: color,
    emissiveIntensity: 3,
    roughness: 0.2,
  });
  const neon = new THREE.Mesh(neonGeo, neonMat);
  neon.position.z = 0.1;
  signGroup.add(neon);
  flickerLights.push(neon);

  // Point light for glow
  const glowLight = new THREE.PointLight(color, 0.6, 8);
  glowLight.position.z = 0.5;
  signGroup.add(glowLight);
  flickerLights.push(glowLight);

  // Position on building face
  const side = buildingDepth / 2 + 0.3;
  const top = buildingHeight - 0.6;
  signGroup.position.set(0, top, side);

  parent.add(signGroup);
}

// ---- Vehicles ----
function createVehicles() {
  // Car on horizontal road
  const car1 = createCar(PALETTE.carRed, 3.5, 1.2);
  car1.position.set(5, 0.7, 0);
  car1.rotation.y = Math.PI / 2;
  scene.add(car1);

  // Car on vertical road
  const car2 = createCar(PALETTE.carBlue, 3, 1.2);
  car2.position.set(0, 0.7, -5);
  car2.rotation.y = Math.PI;
  scene.add(car2);

  // Parked cream car
  const car3 = createCar(PALETTE.carCream, 3.2, 1.3);
  car3.position.set(-6, 0.7, -10);
  scene.add(car3);

  // Green car parked
  const car4 = createCar(PALETTE.carGreen, 2.8, 1.1);
  car4.position.set(6, 0.7, -10);
  car4.rotation.y = -Math.PI / 2;
  scene.add(car4);

  // Bike on sidewalk
  const bike = createBike();
  bike.position.set(-4, 0.5, -10);
  scene.add(bike);
}

function createCar(color, length, height) {
  const group = new THREE.Group();

  // Body — main cabin
  const bodyGeo = new THREE.BoxGeometry(length, height * 0.4, 1.6);
  const bodyMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.3, metalness: 0.6 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = height;
  group.add(body);

  // Roof
  const roofGeo = new THREE.BoxGeometry(length * 0.55, height * 0.3, 1.4);
  const roof = new THREE.Mesh(roofGeo, bodyMat);
  roof.position.y = height + height * 0.35;
  roof.position.x = -0.15;
  group.add(roof);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.15, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  const hubGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.16, 8);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.3 });

  [[-length / 3, 0.25, 0.9], [-length / 3, 0.25, -0.9],
   [length / 3, 0.25, 0.9], [length / 3, 0.25, -0.9]].forEach(([x, y, z]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, y, z);
    group.add(wheel);

    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(x, y, z);
    group.add(hub);
  });

  // Headlights
  const hlGeo = new THREE.SphereGeometry(0.12, 8, 8);
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffffaa, emissiveIntensity: 1.5 });
  [[-0.05, 0.9, 0.85], [-0.05, 0.9, -0.85]].forEach(([x, y, z]) => {
    const hl = new THREE.Mesh(hlGeo, hlMat);
    hl.position.set(x, y, z);
    group.add(hl);
  });

  // Tail lights
  const tlGeo = new THREE.BoxGeometry(0.1, 0.15, 0.2);
  const tlMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 1 });
  [[length / 2 + 0.05, 0.9, 0.65], [length / 2 + 0.05, 0.9, -0.65]].forEach(([x, y, z]) => {
    const tl = new THREE.Mesh(tlGeo, tlMat);
    group.add(tl);
  });

  // Windshield (angled)
  const wsGeo = new THREE.PlaneGeometry(length * 0.5, height * 0.3);
  const wsMat = new THREE.MeshStandardMaterial({
    color: 0x88aacc,
    transparent: true,
    opacity: 0.6,
    metalness: 0.9,
    roughness: 0.1,
    side: THREE.DoubleSide,
  });
  const ws = new THREE.Mesh(wsGeo, wsMat);
  ws.rotation.x = Math.PI / 2;
  ws.rotation.y = 0;
  ws.rotation.z = Math.PI / 2;
  ws.position.set(length * 0.25, height + height * 0.35, 0);
  group.add(ws);

  return group;
}

function createBike() {
  const group = new THREE.Group();
  const bikeMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.3 });

  // Frame tubes
  const tubeGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.2, 6);
  const tube1 = new THREE.Mesh(tubeGeo, bikeMat);
  tube1.rotation.z = Math.PI / 3;
  group.add(tube1);

  const tube2 = new THREE.Mesh(tubeGeo, bikeMat);
  tube2.rotation.z = -Math.PI / 3;
  tube2.position.y = 0.5;
  group.add(tube2);

  // Seat post
  const seatPostGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6);
  const seatPost = new THREE.Mesh(seatPostGeo, bikeMat);
  seatPost.position.set(0, 0.9, 0);
  group.add(seatPost);

  // Seat
  const seatGeo = new THREE.BoxGeometry(0.3, 0.08, 0.2);
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
  const seat = new THREE.Mesh(seatGeo, seatMat);
  seat.position.set(0, 1.2, 0);
  group.add(seat);

  // Handlebars
  const barGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6);
  const bar = new THREE.Mesh(barGeo, bikeMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0.45, 1.0, 0);
  group.add(bar);

  // Wheels
  const wheelGeo = new THREE.TorusGeometry(0.35, 0.02, 6, 24);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
  const wheel1 = new THREE.Mesh(wheelGeo, wheelMat);
  wheel1.position.set(-0.4, 0.35, 0);
  group.add(wheel1);

  const wheel2 = new THREE.Mesh(wheelGeo, wheelMat);
  wheel2.position.set(0.4, 0.35, 0);
  group.add(wheel2);

  return group;
}

// ---- Pedestrians ----
function createPedestrians() {
  const p1 = createPedestrian(PALETTE.pedestrianA, PALETTE.pedestrianB, 0xccccaa);
  p1.position.set(-1, 0, 3);
  walkingPedestrians.push({ object: p1, path: [
    { x: -1, z: 3 }, { x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 3 },
    { x: -1, z: 3 },
  ], progress: 0, speed: 0.003 });
  scene.add(p1);

  const p2 = createPedestrian(PALETTE.pedestrianC, PALETTE.pedestrianD, 0xeeeecc);
  p2.position.set(3, 0, -1);
  walkingPedestrians.push({ object: p2, path: [
    { x: 3, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 3 }, { x: 3, z: 3 },
    { x: 3, z: -1 },
  ], progress: 0, speed: 0.0025 });
  scene.add(p2);

  const p3 = createPedestrian(PALETTE.pedestrianE, PALETTE.pedestrianA, 0xaacc88);
  p3.position.set(-3, 0, -3);
  walkingPedestrians.push({ object: p3, path: [
    { x: -3, z: -3 }, { x: 0, z: -3 }, { x: 0, z: 0 }, { x: -3, z: 0 },
    { x: -3, z: -3 },
  ], progress: 0, speed: 0.0035 });
  scene.add(p3);

  const p4 = createPedestrian(0xee8844, 0x44aa88, 0xddaa66);
  p4.position.set(0, 0, -3);
  walkingPedestrians.push({ object: p4, path: [
    { x: 0, z: -3 }, { x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: -3 },
    { x: 0, z: -3 },
  ], progress: 0, speed: 0.004 });
  scene.add(p4);
}

function createPedestrian(topColor, pantsColor, hatColor) {
  const group = new THREE.Group();

  const skinColor = 0xddbb99;
  const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.7 });
  const topMat = new THREE.MeshStandardMaterial({ color: topColor, roughness: 0.6 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.6 });
  const hatMat = new THREE.MeshStandardMaterial({ color: hatColor, roughness: 0.6 });

  // Body
  const bodyGeo = new THREE.BoxGeometry(0.4, 0.7, 0.3);
  const body = new THREE.Mesh(bodyGeo, topMat);
  body.position.y = 1.35;
  group.add(body);

  // Head
  const headGeo = new THREE.SphereGeometry(0.2, 8, 8);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.y = 1.95;
  group.add(head);

  // Hat
  const hatGeo = new THREE.CylinderGeometry(0.22, 0.25, 0.15, 8);
  const hat = new THREE.Mesh(hatGeo, hatMat);
  hat.position.y = 2.15;
  group.add(hat);

  // Hat brim
  const brimGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.03, 12);
  const brim = new THREE.Mesh(brimGeo, hatMat);
  brim.position.y = 2.08;
  group.add(brim);

  // Arms
  const armGeo = new THREE.BoxGeometry(0.12, 0.55, 0.12);
  const armL = new THREE.Mesh(armGeo, topMat);
  armL.position.set(-0.3, 1.3, 0);
  group.add(armL);

  const armR = new THREE.Mesh(armGeo, topMat);
  armR.position.set(0.3, 1.3, 0);
  group.add(armR);

  // Hands
  const handGeo = new THREE.SphereGeometry(0.06, 6, 6);
  const handL = new THREE.Mesh(handGeo, skinMat);
  handL.position.set(-0.3, 1.0, 0);
  group.add(handL);

  const handR = new THREE.Mesh(handGeo, skinMat);
  handR.position.set(0.3, 1.0, 0);
  group.add(handR);

  // Legs
  const legGeo = new THREE.BoxGeometry(0.15, 0.6, 0.15);
  const legL = new THREE.Mesh(legGeo, pantsMat);
  legL.position.set(-0.12, 0.6, 0);
  group.add(legL);

  const legR = new THREE.Mesh(legGeo, pantsMat);
  legR.position.set(0.12, 0.6, 0);
  group.add(legR);

  // Shoes
  const shoeGeo = new THREE.BoxGeometry(0.16, 0.08, 0.25);
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
  const shoeL = new THREE.Mesh(shoeGeo, shoeMat);
  shoeL.position.set(-0.12, 0.04, 0.05);
  group.add(shoeL);

  const shoeR = new THREE.Mesh(shoeGeo, shoeMat);
  shoeR.position.set(0.12, 0.04, 0.05);
  group.add(shoeR);

  // Slight forward lean
  group.rotation.x = -0.05;

  return group;
}

// ---- Trees ----
function createTrees() {
  const treePositions = [
    [-5, 0, -4], [5, 0, 4],
    [-4, 0, 5], [4, 0, -5],
    [0, 0, 10],
  ];

  treePositions.forEach(([x, y, z]) => {
    const tree = createTree();
    tree.position.set(x, y, z);
    scene.add(tree);
  });
}

function createTree() {
  const group = new THREE.Group();

  // Trunk
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1.5, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: PALETTE.treeTrunk, roughness: 0.9 });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 0.75;
  trunk.castShadow = true;
  group.add(trunk);

  // Foliage layers
  const foliageMat = new THREE.MeshStandardMaterial({ color: PALETTE.treeLeaf, roughness: 0.8 });
  const foliageSizes = [
    { r: 1.2, h: 1.2, y: 2.1 },
    { r: 0.9, h: 1.0, y: 2.8 },
    { r: 0.5, h: 0.8, y: 3.3 },
  ];
  foliageSizes.forEach(({ r, h, y }) => {
    const fGeo = new THREE.ConeGeometry(r, h, 8);
    const foliage = new THREE.Mesh(fGeo, foliageMat);
    foliage.position.y = y;
    foliage.castShadow = true;
    group.add(foliage);
  });

  return group;
}

// ---- Details ----
function createDetails() {
  // Mailboxes
  createMailbox(-4, 0, -6);
  createMailbox(4, 0, -6);

  // Benches
  createBench(-6, 0, 4);
  createBench(6, 0, -4);

  // Trash cans
  createTrashCan(3, 0, -5);
  createTrashCan(-3, 0, 5);

  // Fire hydrant
  createFireHydrant(2, 0, 2);

  // Lamp post near building 5
  createSmallLampPost(1.5, 0, -3.5);
  createSmallLampPost(-1.5, 0, 3.5);

  // Flower boxes under windows
  createFlowerBox(2.5, 0.8, -0.4);
  createFlowerBox(-2.5, 0.8, 0.4);

  // Potted plant on sidewalk
  createPottedPlant(-5, 0.05, 6);
}

function createMailbox(x, y, z) {
  const group = new THREE.Group();

  // Post
  const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8 });
  const post = new THREE.Mesh(postGeo, postMat);
  post.position.y = 0.5;
  group.add(post);

  // Box
  const boxGeo = new THREE.BoxGeometry(0.3, 0.25, 0.45);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x224488, roughness: 0.5 });
  const box = new THREE.Mesh(boxGeo, boxMat);
  box.position.y = 1.15;
  box.position.z = -0.05;
  group.add(box);

  // Flag
  const flagGeo = new THREE.BoxGeometry(0.02, 0.15, 0.15);
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.6 });
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.set(-0.2, 1.2, 0.2);
  flag.rotation.z = Math.PI / 4;
  group.add(flag);

  group.position.set(x, y, z);
  scene.add(group);
}

function createBench(x, y, z) {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.8 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.4 });

  // Seat
  const seatGeo = new THREE.BoxGeometry(1.2, 0.08, 0.4);
  const seat = new THREE.Mesh(seatGeo, woodMat);
  seat.position.y = 0.45;
  group.add(seat);

  // Back
  const backGeo = new THREE.BoxGeometry(1.2, 0.4, 0.05);
  const back = new THREE.Mesh(backGeo, woodMat);
  back.position.set(0, 0.7, -0.18);
  back.rotation.x = -0.1;
  group.add(back);

  // Legs
  const legGeo = new THREE.BoxGeometry(0.05, 0.45, 0.05);
  [[-0.5, 0.225, 0.15], [-0.5, 0.225, -0.15],
   [0.5, 0.225, 0.15], [0.5, 0.225, -0.15]].forEach(([lx, ly, lz]) => {
    const leg = new THREE.Mesh(legGeo, metalMat);
    leg.position.set(lx, ly, lz);
    group.add(leg);
  });

  group.position.set(x, y, z);
  scene.add(group);
}

function createTrashCan(x, y, z) {
  const group = new THREE.Group();
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.7, roughness: 0.4 });

  // Body
  const bodyGeo = new THREE.CylinderGeometry(0.2, 0.22, 0.7, 8);
  const body = new THREE.Mesh(bodyGeo, metalMat);
  body.position.y = 0.35;
  group.add(body);

  // Lid
  const lidGeo = new THREE.CylinderGeometry(0.23, 0.23, 0.03, 8);
  const lid = new THREE.Mesh(lidGeo, metalMat);
  lid.position.y = 0.72;
  group.add(lid);

  // Slot
  const slotGeo = new THREE.BoxGeometry(0.3, 0.05, 0.05);
  const slot = new THREE.Mesh(slotGeo, new THREE.MeshStandardMaterial({ color: 0x111111 }));
  slot.position.set(0, 0.55, 0.2);
  group.add(slot);

  group.position.set(x, y, z);
  scene.add(group);
}

function createFireHydrant(x, y, z) {
  const group = new THREE.Group();
  const hydrantMat = new THREE.MeshStandardMaterial({ color: 0xcc3333, metalness: 0.3, roughness: 0.6 });

  // Base
  const baseGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.3, 8);
  const base = new THREE.Mesh(baseGeo, hydrantMat);
  base.position.y = 0.15;
  group.add(base);

  // Body
  const bodyGeo = new THREE.CylinderGeometry(0.12, 0.15, 0.4, 8);
  const body = new THREE.Mesh(bodyGeo, hydrantMat);
  body.position.y = 0.5;
  group.add(body);

  // Top cap
  const topGeo = new THREE.SphereGeometry(0.12, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const top = new THREE.Mesh(topGeo, hydrantMat);
  top.position.y = 0.7;
  group.add(top);

  // Side nozzles
  const nozzleGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.15, 6);
  const nozzle1 = new THREE.Mesh(nozzleGeo, hydrantMat);
  nozzle1.rotation.z = Math.PI / 2;
  nozzle1.position.set(0.2, 0.5, 0);
  group.add(nozzle1);

  const nozzle2 = new THREE.Mesh(nozzleGeo, hydrantMat);
  nozzle2.rotation.z = Math.PI / 2;
  nozzle2.position.set(-0.2, 0.5, 0);
  group.add(nozzle2);

  group.position.set(x, y, z);
  scene.add(group);
}

function createSmallLampPost(x, y, z) {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7 });

  const poleGeo = new THREE.CylinderGeometry(0.03, 0.04, 2.0, 6);
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 1.0;
  group.add(pole);

  const headGeo = new THREE.SphereGeometry(0.1, 8, 8);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffeedd, emissive: 0xffcc88, emissiveIntensity: 1.5 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 2.0;
  group.add(head);

  const light = new THREE.PointLight(0xffcc88, 0.5, 6);
  light.position.y = 2.0;
  group.add(light);

  group.position.set(x, y, z);
  scene.add(group);
}

function createFlowerBox(x, y, z) {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.8 });

  // Box
  const boxGeo = new THREE.BoxGeometry(0.8, 0.2, 0.25);
  const box = new THREE.Mesh(boxGeo, woodMat);
  group.add(box);

  // Dirt
  const dirtGeo = new THREE.BoxGeometry(0.75, 0.12, 0.22);
  const dirtMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 });
  const dirt = new THREE.Mesh(dirtGeo, dirtMat);
  dirt.position.y = 0.06;
  group.add(dirt);

  // Flowers
  const flowerColors = [0xff4466, 0xff8844, 0xffaa22, 0xff44aa, 0x44aaff];
  for (let i = 0; i < 6; i++) {
    const fGeo = new THREE.SphereGeometry(0.05, 6, 6);
    const fMat = new THREE.MeshStandardMaterial({ color: flowerColors[i % flowerColors.length], emissive: 0x220011, emissiveIntensity: 0.1 });
    const flower = new THREE.Mesh(fGeo, fMat);
    flower.position.set(-0.3 + i * 0.12, 0.18, 0);
    group.add(flower);
  }

  group.position.set(x, y, z);
  scene.add(group);
}

function createPottedPlant(x, y, z) {
  const group = new THREE.Group();

  // Pot
  const potGeo = new THREE.CylinderGeometry(0.25, 0.2, 0.35, 8);
  const potMat = new THREE.MeshStandardMaterial({ color: 0x884422, roughness: 0.9 });
  const pot = new THREE.Mesh(potGeo, potMat);
  pot.position.y = 0.175;
  group.add(pot);

  // Soil
  const soilGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.05, 8);
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.9 });
  const soil = new THREE.Mesh(soilGeo, soilMat);
  soil.position.y = 0.35;
  group.add(soil);

  // Plant (stylized leaves)
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x338833, roughness: 0.7 });
  for (let i = 0; i < 7; i++) {
    const leafGeo = new THREE.PlaneGeometry(0.15, 0.4);
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    const angle = (i / 7) * Math.PI * 2;
    leaf.rotation.y = angle;
    leaf.rotation.z = 0.3;
    leaf.position.set(Math.cos(angle) * 0.1, 0.55, Math.sin(angle) * 0.1);
    group.add(leaf);
  }

  // Stem
  const stemGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.4, 4);
  const stem = new THREE.Mesh(stemGeo, leafMat);
  stem.position.y = 0.55;
  group.add(stem);

  group.position.set(x, y, z);
  scene.add(group);
}

// ---- Particles (gentle rain) ----
function createParticles() {
  const count = 500;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 20;
    positions[i * 3 + 1] = Math.random() * 12;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0x8899cc,
    size: 0.04,
    transparent: true,
    opacity: 0.3,
    sizeAttenuation: true,
  });

  particleSystem = new THREE.Points(geometry, material);
  scene.add(particleSystem);
}

// ---- Audio ----
function initAudioUI() {
  const btn = document.getElementById('audio-toggle');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioStarted = true;
      startLoFiMusic();
      btn.classList.add('playing');
    } else if (audioCtx.state === 'suspended') {
      audioCtx.resume();
      btn.classList.add('playing');
    } else {
      audioCtx.suspend();
      btn.classList.remove('playing');
    }
  });
}

function startLoFiMusic() {
  if (!audioCtx) return;
  const ctx = audioCtx;
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.3;
  masterGain.connect(ctx.destination);

  // === Chord pad (4-note chord, slowly shifting) ===
  const chordPads = [
    { notes: [130.81, 164.81, 196.00, 246.94], filter: 600, detune: 5 },  // Am7
    { notes: [130.81, 155.56, 196.00, 220.00], filter: 500, detune: 3 },  // Fm7
    { notes: [164.81, 220.00, 246.94, 293.66], filter: 700, detune: 4 },  // Dm7
    { notes: [174.61, 220.00, 261.63, 329.63], filter: 550, detune: 6 },  // Em7
  ];

  chordPads.forEach((chord, idx) => {
    const padGain = ctx.createGain();
    padGain.gain.value = 0;
    padGain.gain.setValueAtTime(0, ctx.currentTime);
    padGain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 4);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = chord.filter;
    filter.Q.value = 1;

    padGain.connect(filter);
    filter.connect(masterGain);

    // Create individual oscillators for each note
    const oscillators = chord.notes.map(freq => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = chord.detune + Math.random() * 4;

      const oscGain = ctx.createGain();
      oscGain.gain.value = 0.12;

      osc.connect(oscGain);
      oscGain.connect(padGain);
      osc.start();

      return { osc, gain: oscGain };
    });

    // Fade out before next chord
    setTimeout(() => {
      padGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 4);
      setTimeout(() => {
        oscillators.forEach(({ osc }) => { try { osc.stop(); } catch (e) {} });
      }, 4500);
    }, 8000);

    musicNodes.push({ oscillators, padGain, filter });
  });

  // === Drum loop (kick, snare, hi-hat) ===
  createDrumLoop(ctx, masterGain);
}

function createDrumLoop(ctx, output) {
  const bpm = 78;
  const beatDuration = 60 / bpm;
  const barDuration = beatDuration * 4;
  const loopDuration = barDuration * 4; // 4-bar loop
  const now = ctx.currentTime;

  function playSound(freq, freqEnd, duration, vol, filterFreq, filterType) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freqEnd, now + duration);

    filter.type = filterType || 'lowpass';
    filter.frequency.value = filterFreq || 2000;

    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(output);

    osc.start(now);
    osc.stop(now + duration + 0.1);
  }

  function playNoise(duration, vol, filterFreq, startTime) {
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    filter.type = 'highpass';
    filter.frequency.value = filterFreq || 5000;

    gain.gain.setValueAtTime(vol, startTime || now);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime ? startTime + duration : now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(output);

    source.start(startTime || now);
    source.stop(startTime ? startTime + duration : now + duration + 0.1);
  }

  // 4-bar pattern
  for (let bar = 0; bar < loopDuration / barDuration; bar++) {
    const barStart = now + bar * barDuration;

    // Kick on 1 and 3
    playSound(150, 30, 0.15, 0.5, 300, 'lowpass', barStart);
    playSound(150, 30, 0.15, 0.45, 300, 'lowpass', barStart + 2 * beatDuration);

    // Snare on 2 and 4
    playNoise(0.12, 0.2, 4000, barStart + beatDuration);
    playNoise(0.12, 0.2, 4000, barStart + 3 * beatDuration);

    // Hi-hat (off-beat)
    for (let i = 0; i < 4; i++) {
      playNoise(0.04, 0.06, 8000, barStart + i * beatDuration);
    }
  }

  musicNodes.push({ drumLoop: true, loopDuration });
}

// ---- Animation Loop ----
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  // Update controls
  controls.update();

  // Update walking pedestrians
  walkingPedestrians.forEach(p => {
    p.progress += p.speed;
    if (p.progress >= 1) {
      p.progress = 0;
      // Rotate path for variety
      const path = p.object.userData.path || p.path;
      if (p.path && p.path.length > 2) {
        // Shift path order
        const last = p.path.pop();
        p.path.unshift(last);
        p.object.userData.path = p.path;
      }
    }
    const path = p.path;
    const segmentProgress = p.progress * path.length;
    const segIdx = Math.floor(segmentProgress) % path.length;
    const segFrac = segmentProgress - segIdx;
    const from = path[segIdx];
    const to = path[(segIdx + 1) % path.length];
    p.object.position.x = from.x + (to.x - from.x) * segFrac;
    p.object.position.z = from.z + (to.z - from.z) * segFrac;
    // Face direction of travel
    p.object.rotation.y = Math.atan2(to.z - from.z, to.x - from.x);
    // Walk bob
    p.object.position.y = Math.abs(Math.sin(p.progress * Math.PI * 2)) * 0.05;
  });

  // Flicker lights
  flickerLights.forEach(light => {
    if (Math.random() < 0.02) {
      light.intensity = light === flickerLights[0] ? 0.5 + Math.random() * 0.5 : light.intensity;
      if (light.isPointLight) {
        light.intensity = 0.8 + Math.random() * 0.4;
      }
    }
  });

  // Animate rain particles
  if (particleSystem) {
    const positions = particleSystem.geometry.attributes.position.array;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 1] -= 0.05;
      if (positions[i + 1] < 0) {
        positions[i + 1] = 12;
        positions[i] = (Math.random() - 0.5) * 20;
        positions[i + 2] = (Math.random() - 0.5) * 20;
      }
    }
    particleSystem.geometry.attributes.position.needsUpdate = true;
  }

  // Move vehicles along roads
  movingVehicles.forEach(v => {
    v.object.position[v.axis] += v.speed;
    if (v.object.position[v.axis] > 10) v.object.position[v.axis] = -10;
    if (v.object.position[v.axis] < -10) v.object.position[v.axis] = 10;
  });

  // Render
  renderer.render(scene, camera);
}

// ---- Resize ----
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ---- Start ----
document.addEventListener('DOMContentLoaded', init);

// ---- Expose for testing ----
if (typeof window !== 'undefined') {
  // Update CITY_TIME_MACHINE after init runs
  const exposeCTM = () => {
    window.CITY_TIME_MACHINE = {
      scene,
      camera,
      renderer,
      controls,
      getPedestrians: () => walkingPedestrians,
      getVehicles: () => movingVehicles,
      getParticles: () => particleSystem,
    };
  };
  // Expose after init completes
  setTimeout(exposeCTM, 100);
}
