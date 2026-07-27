/**
 * =============================================
 * City Time Machine — Main Script
 * =============================================
 *
 * 3D diorama of a cozy city block with:
 * - Multiple buildings (apartments, shops, cafes)
 * - Vehicles (cars, bus)
 * - Storefronts with signage
 * - Advertisements
 * - Pedestrians with varied outfits
 * - Lo-fi music soundtrack (Web Audio API)
 * - Day/night cycle
 * - Orbit and zoom camera controls
 */

// ─── Application State ────────────────────────
const STATE = {
  isNight: false,
  musicPlaying: false,
  animTime: 0,
  pedestrianCount: 8,
};

// ─── Three.js Globals ─────────────────────────
let scene, camera, renderer, controls;
let ambientLight, directionalLight, pointLights = [];
let buildings = [];
let vehicles = [];
let pedestrians = [];
let streetLights = [];
let trees = [];
let smokeParticles = [];
let audioContext, musicNodes = [];

// ─── Color Palette ────────────────────────────
const COLORS = {
  // Day palette
  day: {
    sky: 0x87CEEB,
    ambient: 0xffeedd,
    directional: 0xfff4e0,
    ambientIntensity: 0.5,
    directionalIntensity: 0.7,
    fog: 0x87CEEB,
  },
  // Night palette
  night: {
    sky: 0x0a0a1e,
    ambient: 0x1a1a3a,
    directional: 0x334466,
    ambientIntensity: 0.15,
    directionalIntensity: 0.1,
    fog: 0x0a0a1e,
  },
  // Building colors
  buildings: [
    0x8B7355, // warm brown
    0xA0522D, // sienna
    0xCD853F, // peru
    0xD2B48C, // tan
    0x9B7653, // darker brown
    0xB8860B, // dark goldenrod
    0x704214, // very dark brown
  ],
  // Roof colors
  roofs: [0x8B4513, 0x654321, 0x4A2810, 0x5C3317],
  // Window light colors (warm glow)
  windowLight: 0xffe4a0,
  // Ground
  ground: 0x5a5a4a,
  // Sidewalk
  sidewalk: 0x999999,
  // Road
  road: 0x3a3a3a,
  // Street lamp glow
  streetLightGlow: 0xffe4a0,
};

// ─── Initialization ───────────────────────────
function init() {
  // Create scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.day.sky);
  scene.fog = new THREE.Fog(COLORS.day.fog, 40, 80);

  // Create camera — higher angle for diorama feel
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(14, 16, 14);
  camera.lookAt(0, 2, 0);

  // Create renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  // OrbitControls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 2, 0);
  controls.maxPolarAngle = Math.PI / 2.1; // don't go below ground
  controls.minDistance = 8;
  controls.maxDistance = 50;

  // Lights
  setupLights();

  // Build scene
  createGround();
  createRoads();
  createSidewalks();
  createBuildings();
  createVehicles();
  createPedestrians();
  createStreetLights();
  createTrees();
  createSignsAndAdvertisements();
  smokeParticles = createChimneySmoke();

  // UI Events
  setupUI();

  // Start render loop
  animate();

  // Expose state for debugging
  window.dioramaState = STATE;
}

// ─── Lights ───────────────────────────────────
function setupLights() {
  // Ambient light (base illumination)
  ambientLight = new THREE.AmbientLight(COLORS.day.ambient, COLORS.day.ambientIntensity);
  scene.add(ambientLight);

  // Directional light (sun/moon)
  directionalLight = new THREE.DirectionalLight(COLORS.day.directional, COLORS.day.directionalIntensity);
  directionalLight.position.set(10, 20, 10);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 50;
  directionalLight.shadow.camera.left = -25;
  directionalLight.shadow.camera.right = 25;
  directionalLight.shadow.camera.top = 25;
  directionalLight.shadow.camera.bottom = -25;
  scene.add(directionalLight);

  // Warm hemisphere light for ambient sky/ground bounce
  const hemiLight = new THREE.HemisphereLight(0xfff0dd, 0x443322, 0.3);
  scene.add(hemiLight);
}

// ─── Ground ───────────────────────────────────
function createGround() {
  const groundGeo = new THREE.PlaneGeometry(60, 60);
  const groundMat = new THREE.MeshLambertMaterial({ color: COLORS.ground });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);
}

// ─── Roads ────────────────────────────────────
function createRoads() {
  const roadMat = new THREE.MeshLambertMaterial({ color: COLORS.road });
  
  // Main road (horizontal)
  const roadH = new THREE.Mesh(new THREE.PlaneGeometry(30, 6), roadMat);
  roadH.rotation.x = -Math.PI / 2;
  roadH.position.set(0, 0.01, 0);
  roadH.receiveShadow = true;
  scene.add(roadH);

  // Cross road (vertical)
  const roadV = new THREE.Mesh(new THREE.PlaneGeometry(6, 30), roadMat);
  roadV.rotation.x = -Math.PI / 2;
  roadV.position.set(0, 0.02, 0);
  roadV.receiveShadow = true;
  scene.add(roadV);

  // Road markings (dashed center lines)
  const markMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
  for (let i = -12; i < 13; i += 3) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.1), markMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(i, 0.03, 0);
    scene.add(dash);

    const dashV = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 1.2), markMat);
    dashV.rotation.x = -Math.PI / 2;
    dashV.position.set(0, 0.03, i);
    scene.add(dashV);
  }
}

// ─── Sidewalks ────────────────────────────────
function createSidewalks() {
  const sidewalkMat = new THREE.MeshLambertMaterial({ color: COLORS.sidewalk });
  
  // Four sidewalk segments around the intersection
  const positions = [
    { x: 0, z: -5 },    // top
    { x: 0, z: 5 },     // bottom
    { x: -5, z: 0 },    // left
    { x: 5, z: 0 },     // right
  ];

  // Sidewalk segments + curb edges
  const curbMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
  const sidewalkHPositions = [
    { x: 0, z: -5, w: 10, d: 2.5 },  // top
    { x: 0, z: 5, w: 10, d: 2.5 },   // bottom
  ];
  const sidewalkVPositions = [
    { x: -5, z: 0, w: 2.5, d: 10 },  // left
    { x: 5, z: 0, w: 2.5, d: 10 },   // right
  ];

  // Horizontal sidewalks
  sidewalkHPositions.forEach(pos => {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(pos.w, pos.d), sidewalkMat);
    side.rotation.x = -Math.PI / 2;
    side.position.set(pos.x, 0.04, pos.z);
    side.receiveShadow = true;
    scene.add(side);

    // Curb edge
    const curb = new THREE.Mesh(
      new THREE.BoxGeometry(pos.w, 0.08, 0.15),
      curbMat
    );
    curb.position.set(pos.x, 0.08, pos.z + (pos.z > 0 ? -pos.d/2 + 0.075 : pos.d/2 - 0.075));
    scene.add(curb);
  });

  // Vertical sidewalks
  sidewalkVPositions.forEach(pos => {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(pos.w, pos.d), sidewalkMat);
    side.rotation.x = -Math.PI / 2;
    side.position.set(pos.x, 0.04, pos.z);
    side.receiveShadow = true;
    scene.add(side);

    // Curb edge
    const curb = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.08, pos.d),
      curbMat
    );
    curb.position.set(pos.x + (pos.x > 0 ? -pos.w/2 + 0.075 : pos.w/2 - 0.075), 0.08, pos.z);
    scene.add(curb);
  });
}

// ─── Buildings ────────────────────────────────
function createBuildings() {
  // Building definitions: [x, z, width, depth, height, color, hasRoof, roofType]
  const buildingDefs = [
    // Row A — south side of street (z positive)
    { x: -9,  z: -8, w: 4, d: 4, h: 6,  col: 0, roof: true, roofType: 'flat' },
    { x: -3,  z: -8, w: 5, d: 4, h: 9,  col: 1, roof: true, roofType: 'gable' },
    { x: 3,   z: -8, w: 4, d: 4, h: 7,  col: 2, roof: true, roofType: 'flat' },
    { x: 9,   z: -8, w: 5, d: 4, h: 8,  col: 3, roof: true, roofType: 'hip' },

    // Row B — north side of street (z negative)
    { x: -9,  z: 8,  w: 5, d: 4, h: 7,  col: 4, roof: true, roofType: 'gable' },
    { x: -3,  z: 8,  w: 4, d: 4, h: 5,  col: 5, roof: true, roofType: 'flat' },
    { x: 3,   z: 8,  w: 6, d: 4, h: 10, col: 0, roof: true, roofType: 'gable' },
    { x: 9,   z: 8,  w: 4, d: 4, h: 6,  col: 1, roof: true, roofType: 'hip' },

    // Additional corner buildings
    { x: -12, z: -12, w: 3, d: 3, h: 5, col: 2, roof: true, roofType: 'flat' },
    { x: 12,  z: -12, w: 3, d: 3, h: 7, col: 3, roof: true, roofType: 'gable' },
    { x: -12, z: 12,  w: 4, d: 3, h: 8, col: 4, roof: true, roofType: 'gable' },
    { x: 12,  z: 12,  w: 3, d: 3, h: 5, col: 5, roof: true, roofType: 'flat' },
  ];

  buildingDefs.forEach(def => {
    const building = createBuilding(def);
    buildings.push(building);
  });
}

function createBuilding(def) {
  const group = new THREE.Group();
  
  // Main building body
  const bodyGeo = new THREE.BoxGeometry(def.w, def.h, def.d);
  const bodyMat = new THREE.MeshLambertMaterial({ color: COLORS.buildings[def.col] });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = def.h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Roof
  if (def.roof) {
    const roof = createRoof(def);
    group.add(roof);
  }

  // Chimney on tall buildings
  if (def.h >= 7 && def.x < 0) {
    const chimney = createChimney(def);
    group.add(chimney);
  }

  // Windows
  addWindows(group, def);

  // Awning on some storefronts (ground floor commercial)
  if (def.h >= 6 && (def.col === 1 || def.col === 3 || def.col === 5)) {
    const awning = createAwning(def);
    group.add(awning);
  }

  // Door
  addDoor(group, def);

  // Window lights (glow from inside)
  addWindowLights(group, def);

  // Window flower boxes (on some windows)
  addFlowerBoxes(group, def);

  group.position.set(def.x, 0, def.z);
  scene.add(group);

  return { group, def };
}

function createChimney(def) {
  const chimneyMat = new THREE.MeshLambertMaterial({ color: 0x553322 });
  const chimney = new THREE.Group();

  const chimneyBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 1.2, 0.3),
    chimneyMat
  );
  chimneyBody.position.set(def.w / 3, def.h + 0.7, def.d / 3);
  chimneyBody.castShadow = true;
  chimney.add(chimneyBody);

  const chimneyTop = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.15, 0.35),
    chimneyMat
  );
  chimneyTop.position.set(def.w / 3, def.h + 1.35, def.d / 3);
  chimney.add(chimneyTop);

  return chimney;
}

function createAwning(def) {
  const awningColors = [0xcc3333, 0x2255aa, 0x33aa33, 0xddaa33];
  const awningCol = awningColors[def.col % awningColors.length];

  const awning = new THREE.Group();

  // Main awning (slanted)
  const awningGeo = new THREE.PlaneGeometry(def.w - 0.2, 0.8);
  const awningMat = new THREE.MeshLambertMaterial({ 
    color: awningCol, 
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85
  });
  const awningMesh = new THREE.Mesh(awningGeo, awningMat);
  awningMesh.position.set(0, 2.8, def.d / 2 + 0.15);
  awningMesh.rotation.x = -0.3;
  awning.add(awningMesh);

  // Awning stripes
  const stripeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const stripes = Math.floor((def.w - 0.2) / 0.4);
  for (let i = 0; i < stripes; i++) {
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(0.08, 0.8),
      stripeMat
    );
    stripe.position.set(
      -def.w / 2 + 0.2 + i * 0.4 + 0.2,
      2.8, def.d / 2 + 0.16
    );
    stripe.rotation.x = -0.3;
    awning.add(stripe);
  }

  // Awning edges (stripes at bottom)
  const edgeMat = new THREE.MeshLambertMaterial({ color: awningCol });
  const edgeGeo = new THREE.BoxGeometry(def.w - 0.15, 0.04, 0.1);
  const edge = new THREE.Mesh(edgeGeo, edgeMat);
  edge.position.set(0, 2.45, def.d / 2 + 0.3);
  awning.add(edge);

  return awning;
}

function addFlowerBoxes(group, def) {
  // Add flower boxes under some ground-floor windows
  const boxMat = new THREE.MeshLambertMaterial({ color: 0x553311 });
  const plantMat = new THREE.MeshLambertMaterial({ color: 0x22aa22 });
  const flowerColors = [0xff4444, 0xff8800, 0xffff00, 0xff00ff];
  
  const windowsPerRow = Math.floor(def.w / 1.3);

  for (let win = 0; win < Math.min(windowsPerRow, 3); win++) {
    // Only ground floor, random selection
    if (Math.random() > 0.5) continue;
    
    const x = -def.w / 2 + 0.5 + win * (0.5 + 0.4);
    const y = 1.2;

    // Box
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.15), boxMat);
    box.position.set(x, y - 0.4, def.d / 2 + 0.1);
    group.add(box);

    // Plants
    const plantGeo = new THREE.SphereGeometry(0.06, 4, 4);
    for (let p = 0; p < 3; p++) {
      const plant = new THREE.Mesh(plantGeo, plantMat);
      plant.position.set(x - 0.08 + p * 0.08, y - 0.3, def.d / 2 + 0.1);
      group.add(plant);
    }

    // Flowers
    const flowerGeo = new THREE.SphereGeometry(0.03, 4, 4);
    const flowerMat = new THREE.MeshLambertMaterial({ color: flowerColors[win % flowerColors.length] });
    for (let p = 0; p < 2; p++) {
      const flower = new THREE.Mesh(flowerGeo, flowerMat);
      flower.position.set(x - 0.05 + p * 0.1, y - 0.25, def.d / 2 + 0.1);
      group.add(flower);
    }
  }
}

function createRoof(def) {
  const roofCol = COLORS.roofs[def.col % COLORS.roofs.length];
  
  switch (def.roofType) {
    case 'flat': {
      const roofGeo = new THREE.BoxGeometry(def.w + 0.4, 0.2, def.d + 0.4);
      const roofMat = new THREE.MeshLambertMaterial({ color: roofCol });
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.position.y = def.h + 0.1;
      roof.castShadow = true;
      return roof;
    }
    case 'gable': {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(def.w / 2, 1.5);
      shape.lineTo(-def.w / 2, 1.5);
      shape.lineTo(0, 0);
      
      const extrudeSettings = { depth: def.d, bevelEnabled: false };
      const roofGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      const roofMat = new THREE.MeshLambertMaterial({ color: roofCol });
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.position.set(0, def.h, -def.d / 2);
      roof.castShadow = true;
      return roof;
    }
    case 'hip': {
      const roofGeo = new THREE.ConeGeometry(
        Math.max(def.w, def.d) / 1.4,
        1.2,
        4
      );
      const roofMat = new THREE.MeshLambertMaterial({ color: roofCol });
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.position.y = def.h + 0.6;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      return roof;
    }
    default:
      return null;
  }
}

function addWindows(group, def) {
  const windowMat = new THREE.MeshLambertMaterial({ color: 0x2a2a3a });
  const frameMat = new THREE.MeshLambertMaterial({ color: 0xf5f0e0 });
  const winW = 0.5;
  const winH = 0.7;
  const frameW = 0.08;

  const floors = Math.floor(def.h / 2.5);
  const windowsPerRow = Math.floor(def.w / 1.3);

  for (let floor = 0; floor < floors; floor++) {
    for (let win = 0; win < windowsPerRow; win++) {
      const x = -def.w / 2 + 0.5 + win * (winW + 0.4);
      const y = 1.2 + floor * 2.2;
      
      // Front face
      createWindow(group, x, y, def.d / 2 + 0.01, windowMat, frameMat, winW, winH, frameW);
      // Back face
      createWindow(group, x, y, -def.d / 2 - 0.01, windowMat, frameMat, winW, winH, frameW, true);
    }
  }

  // Side windows
  const sideWindows = Math.floor(def.d / 1.5);
  for (let floor = 0; floor < floors; floor++) {
    for (let win = 0; win < sideWindows; win++) {
      const z = -def.d / 2 + 0.5 + win * (winW + 0.5);
      const y = 1.2 + floor * 2.2;
      
      // Left face
      createWindow(group, -def.w / 2 - 0.01, y, z, windowMat, frameMat, winH, winW, frameW, false, true);
      // Right face
      createWindow(group, def.w / 2 + 0.01, y, z, windowMat, frameMat, winH, winW, frameW, false, true);
    }
  }
}

function createWindow(group, x, y, z, windowMat, frameMat, w, h, fw, flipZ, flipX) {
  // Window glass
  const winGeo = new THREE.PlaneGeometry(w, h);
  const winMesh = new THREE.Mesh(winGeo, windowMat);
  winMesh.position.set(x, y, z);
  if (flipZ) winMesh.rotation.y = Math.PI;
  group.add(winMesh);

  // Window frame
  const frameGeo = new THREE.PlaneGeometry(w + fw * 2, h + fw * 2);
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.position.set(x, y, z + 0.005);
  if (flipZ) frame.rotation.y = Math.PI;
  group.add(frame);

  // Window cross
  const crossH = new THREE.Mesh(
    new THREE.PlaneGeometry(w + fw * 2, 0.04),
    frameMat
  );
  crossH.position.set(x, y, z + 0.006);
  if (flipZ) crossH.rotation.y = Math.PI;
  group.add(crossH);

  const crossV = new THREE.Mesh(
    new THREE.PlaneGeometry(0.04, h + fw * 2),
    frameMat
  );
  crossV.position.set(x, y, z + 0.007);
  if (flipZ) crossV.rotation.y = Math.PI;
  group.add(crossV);
}

function addDoor(group, def) {
  const doorMat = new THREE.MeshLambertMaterial({ color: 0x4a2a1a });
  const doorGeo = new THREE.BoxGeometry(0.7, 1.5, 0.1);
  const door = new THREE.Mesh(doorGeo, doorMat);
  door.position.set(0, 0.75, def.d / 2 + 0.05);
  door.castShadow = true;
  group.add(door);

  // Door frame
  const frameMat = new THREE.MeshLambertMaterial({ color: 0xf5f0e0 });
  const frameGeo = new THREE.BoxGeometry(0.9, 1.7, 0.05);
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.position.set(0, 0.85, def.d / 2 + 0.02);
  group.add(frame);
}

function addWindowLights(group, def) {
  // Some windows glow warmly (especially at night)
  const floors = Math.floor(def.h / 2.5);
  const windowsPerRow = Math.floor(def.w / 1.3);
  
  // Randomly select some windows to have lights
  const litWindows = [];
  for (let f = 0; f < floors; f++) {
    for (let w = 0; w < windowsPerRow; w++) {
      if (Math.random() > 0.4) {
        litWindows.push({ floor: f, window: w });
      }
    }
  }

  const glowMat = new THREE.MeshBasicMaterial({ 
    color: COLORS.windowLight,
    transparent: true,
    opacity: 0.6
  });

  litWindows.forEach(lw => {
    const x = -def.w / 2 + 0.5 + lw.window * (0.5 + 0.4);
    const y = 1.2 + lw.floor * 2.2;
    
    const glowGeo = new THREE.PlaneGeometry(0.45, 0.65);
    const glow = new THREE.Mesh(glowGeo, glowMat.clone());
    glow.position.set(x, y, def.d / 2 + 0.02);
    glow.userData.isWindowLight = true;
    group.add(glow);
  });
}

// ─── Vehicles ────────────────────────────────
function createVehicles() {
  // Cars on the road
  const carPositions = [
    { x: -8, z: -2, rotY: 0, type: 'car' },
    { x: 5,  z: 2, rotY: Math.PI, type: 'car' },
    { x: -3, z: 4, rotY: Math.PI / 2, type: 'car' },
    // Bus on main road
    { x: 7, z: -3, rotY: 0, type: 'bus' },
  ];

  carPositions.forEach(pos => {
    if (pos.type === 'car') {
      const car = createCar();
      car.group.position.set(pos.x, 0.25, pos.z);
      car.group.rotation.y = pos.rotY;
      scene.add(car.group);
      vehicles.push(car);
    } else {
      const bus = createBus();
      bus.group.position.set(pos.x, 0.35, pos.z);
      bus.group.rotation.y = pos.rotY;
      scene.add(bus.group);
      vehicles.push(bus);
    }
  });

  // Parked cars along the street
  const parkedCarDefs = [
    { x: -6, z: -3, rotY: 0, color: 0x2244aa },
    { x: -6, z: -1, rotY: 0, color: 0xddcc33 },
    { x: 6, z: 2, rotY: Math.PI, color: 0xcc3333 },
    { x: 6, z: 4, rotY: Math.PI, color: 0x226644 },
    { x: -2, z: 6, rotY: Math.PI / 2, color: 0x886644 },
    { x: -2, z: -5, rotY: -Math.PI / 2, color: 0x444466 },
  ];

  parkedCarDefs.forEach(def => {
    const car = createParkedCar(def.color);
    car.group.position.set(def.x, 0.25, def.z);
    car.group.rotation.y = def.rotY;
    scene.add(car.group);
    vehicles.push(car);
  });
}

function createCar() {
  const group = new THREE.Group();
  
  // Body
  const bodyMat = new THREE.MeshLambertMaterial({ 
    color: [0xcc3333, 0x2244aa, 0x22aa44, 0xeeeeee, 0x333333][Math.floor(Math.random() * 5)] 
  });
  const bodyGeo = new THREE.BoxGeometry(1.2, 0.5, 0.6);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.25;
  body.castShadow = true;
  group.add(body);

  // Cabin
  const cabinGeo = new THREE.BoxGeometry(0.8, 0.45, 0.5);
  const cabinMat = new THREE.MeshLambertMaterial({ color: 0x2a2a3a });
  const cabin = new THREE.Mesh(cabinGeo, cabinMat);
  cabin.position.set(-0.05, 0.5, 0);
  group.add(cabin);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.08, 8);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const wheelPositions = [
    { x: 0.4, z: 0.3 }, { x: 0.4, z: -0.3 },
    { x: -0.4, z: 0.3 }, { x: -0.4, z: -0.3 },
  ];
  wheelPositions.forEach(wp => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wp.x, 0.1, wp.z);
    group.add(wheel);
  });

  return { group, speed: 0.005 + Math.random() * 0.005, direction: 1 };
}

function createParkedCar(color) {
  const group = new THREE.Group();
  
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const bodyGeo = new THREE.BoxGeometry(1.4, 0.5, 0.6);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.25;
  body.castShadow = true;
  group.add(body);

  // Cabin
  const cabinGeo = new THREE.BoxGeometry(0.9, 0.45, 0.5);
  const cabinMat = new THREE.MeshLambertMaterial({ color: 0x2a2a3a });
  const cabin = new THREE.Mesh(cabinGeo, cabinMat);
  cabin.position.set(-0.05, 0.5, 0);
  group.add(cabin);

  // Headlights
  const headlightMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
  [[-0.65, 0.15, 0.2], [-0.65, 0.15, -0.2]].forEach(([x, y, z]) => {
    const headlight = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), headlightMat);
    headlight.position.set(x, y, z);
    group.add(headlight);
  });

  // Tail lights
  const taillightMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  [[0.7, 0.15, 0.2], [0.7, 0.15, -0.2]].forEach(([x, y, z]) => {
    const taillight = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), taillightMat);
    taillight.position.set(x, y, z);
    group.add(taillight);
  });

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.08, 8);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const wheelPositions = [
    { x: 0.45, z: 0.3 }, { x: 0.45, z: -0.3 },
    { x: -0.45, z: 0.3 }, { x: -0.45, z: -0.3 },
  ];
  wheelPositions.forEach(wp => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wp.x, 0.1, wp.z);
    group.add(wheel);
  });

  return { group, speed: 0, direction: 0 };
}

function createBus() {
  const group = new THREE.Group();
  
  // Body
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xddcc66 });
  const bodyGeo = new THREE.BoxGeometry(2.5, 0.8, 0.9);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.4;
  body.castShadow = true;
  group.add(body);

  // Windows
  const busWindowMat = new THREE.MeshLambertMaterial({ color: 0x2a2a3a });
  for (let i = -1; i <= 1; i += 0.667) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35), busWindowMat);
    win.position.set(i, 0.55, 0.46);
    group.add(win);
    
    const winBack = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35), busWindowMat);
    winBack.position.set(i, 0.55, -0.46);
    winBack.rotation.y = Math.PI;
    group.add(winBack);
  }

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.08, 8);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const bp = [
    { x: 1, z: 0.5 }, { x: 1, z: -0.5 },
    { x: -1, z: 0.5 }, { x: -1, z: -0.5 },
  ];
  bp.forEach(wp => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wp.x, 0.15, wp.z);
    group.add(wheel);
  });

  return { group, speed: 0.003, direction: 1 };
}

// ─── Pedestrians ────────────────────────────
function createPedestrians() {
  const outfits = [
    { body: 0xcc3333, pants: 0x333366, hat: null },
    { body: 0x2266aa, pants: 0x444444, hat: 0x222222 },
    { body: 0x44aa44, pants: 0x333333, hat: null },
    { body: 0xddaa33, pants: 0x664422, hat: 0xddaa33 },
    { body: 0x883366, pants: 0x333333, hat: null },
    { body: 0x336688, pants: 0x222244, hat: 0x336688 },
    { body: 0x996633, pants: 0x444422, hat: null },
    { body: 0x663399, pants: 0x222222, hat: 0x663399 },
  ];

  const positions = [
    { x: -7, z: -3.5 }, { x: 6, z: 3.5 },
    { x: -4, z: -1 }, { x: 3, z: 1 },
    { x: -10, z: -7 }, { x: 8, z: -7 },
    { x: -1, z: 6 }, { x: 10, z: 6 },
  ];

  positions.forEach((pos, i) => {
    const outfit = outfits[i % outfits.length];
    const pedestrian = createPedestrian(outfit);
    pedestrian.group.position.set(pos.x, 0.05, pos.z);
    pedestrian.targetX = pos.x;
    pedestrian.targetZ = pos.z;
    scene.add(pedestrian.group);
    pedestrians.push(pedestrian);
  });
}

function createPedestrian(outfit) {
  const group = new THREE.Group();
  
  // Body
  const bodyMat = new THREE.MeshLambertMaterial({ color: outfit.body });
  const bodyGeo = new THREE.BoxGeometry(0.25, 0.5, 0.15);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.6;
  body.castShadow = true;
  group.add(body);

  // Head
  const headMat = new THREE.MeshLambertMaterial({ color: 0xddbb99 });
  const headGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 0.95;
  head.castShadow = true;
  group.add(head);

  // Hat (if applicable)
  if (outfit.hat) {
    const hatMat = new THREE.MeshLambertMaterial({ color: outfit.hat });
    const hatGeo = new THREE.CylinderGeometry(0.12, 0.1, 0.06, 8);
    const hat = new THREE.Mesh(hatGeo, hatMat);
    hat.position.y = 1.07;
    group.add(hat);
  }

  // Arms
  const armMat = new THREE.MeshLambertMaterial({ color: outfit.body });
  const armGeo = new THREE.BoxGeometry(0.08, 0.35, 0.08);
  const leftArm = new THREE.Mesh(armGeo, armMat);
  leftArm.position.set(-0.18, 0.55, 0);
  leftArm.castShadow = true;
  group.add(leftArm);

  const rightArm = new THREE.Mesh(armGeo, armMat);
  rightArm.position.set(0.18, 0.55, 0);
  rightArm.castShadow = true;
  group.add(rightArm);

  // Legs
  const legMat = new THREE.MeshLambertMaterial({ color: outfit.pants });
  const legGeo = new THREE.BoxGeometry(0.08, 0.3, 0.08);
  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(-0.06, 0.2, 0);
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.set(0.06, 0.2, 0);
  group.add(rightLeg);

  // Walking animation data (positions set externally)
  return {
    group,
    bodyMesh: body,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    walkSpeed: 0.003 + Math.random() * 0.003,
    walkTime: Math.random() * Math.PI * 2,
    targetX: 0,
    targetZ: 0,
  };
}

// ─── Street Lights ───────────────────────────
function createStreetLights() {
  const positions = [
    { x: -5.5, z: -5.5 }, { x: 5.5, z: -5.5 },
    { x: -5.5, z: 5.5 }, { x: 5.5, z: 5.5 },
    { x: -2, z: -5.5 }, { x: 2, z: 5.5 },
  ];

  positions.forEach(pos => {
    const light = createStreetLight();
    light.group.position.set(pos.x, 0, pos.z);
    scene.add(light.group);
    streetLights.push(light);
  });

  // Street furniture
  createStreetFurniture();
}

function createStreetLight() {
  const group = new THREE.Group();
  
  // Pole
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 3.5, 8);
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 1.75;
  pole.castShadow = true;
  group.add(pole);

  // Lamp arm
  const armGeo = new THREE.BoxGeometry(0.6, 0.05, 0.05);
  const arm = new THREE.Mesh(armGeo, poleMat);
  arm.position.set(0.3, 3.4, 0);
  group.add(arm);

  // Lamp housing
  const housingMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const housingGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.25, 8);
  const housing = new THREE.Mesh(housingGeo, housingMat);
  housing.position.set(0.6, 3.3, 0);
  group.add(housing);

  // Lamp glow
  const glowMat = new THREE.MeshBasicMaterial({ 
    color: COLORS.streetLightGlow,
    transparent: true,
    opacity: 0.7
  });
  const glowGeo = new THREE.SphereGeometry(0.08, 8, 8);
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(0.6, 3.2, 0);
  glow.userData.isStreetLight = true;
  group.add(glow);

  // Actual point light for the street lamp
  const pointLight = new THREE.PointLight(COLORS.streetLightGlow, 0.3, 6);
  pointLight.position.set(0.6, 3.15, 0);
  pointLight.userData.isStreetLight = true;
  group.add(pointLight);

  return { group, glow, pointLight };
}

// ─── Street Furniture ─────────────────────────
function createStreetFurniture() {
  // Benches
  const benchMat = new THREE.MeshLambertMaterial({ color: 0x8B6914 });
  const benchMetalMat = new THREE.MeshLambertMaterial({ color: 0x333333 });

  const benchPositions = [
    { x: -3, z: -6.5 }, { x: 3, z: 6.5 },
    { x: 6.5, z: -3 }, { x: -6.5, z: 3 },
  ];

  benchPositions.forEach(pos => {
    const bench = new THREE.Group();
    
    // Seat
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.35), benchMat);
    seat.position.y = 0.45;
    bench.add(seat);
    
    // Back
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.06), benchMat);
    back.position.set(0, 0.7, -0.14);
    bench.add(back);
    
    // Metal legs
    [[-0.5, -0.1], [0.5, -0.1], [-0.5, 0.1], [0.5, 0.1]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.04), benchMetalMat);
      leg.position.set(x, 0.225, z);
      bench.add(leg);
    });

    bench.position.set(pos.x, 0, pos.z);
    bench.rotation.y = Math.atan2(pos.x, pos.z);
    scene.add(bench);
  });

  // Fire hydrants
  const hydrantMat = new THREE.MeshLambertMaterial({ color: 0xcc2222 });
  const hydrantPositions = [
    { x: -5.5, z: -5.5 }, { x: 5.5, z: 5.5 },
    { x: -10, z: 6 }, { x: 10, z: -6 },
  ];

  hydrantPositions.forEach(pos => {
    const hydrant = new THREE.Group();
    
    // Body
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.4, 8), hydrantMat);
    body.position.y = 0.2;
    hydrant.add(body);
    
    // Top dome
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), hydrantMat);
    top.position.y = 0.42;
    hydrant.add(top);
    
    // Side nozzles
    const nozzle1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 8), hydrantMat);
    nozzle1.rotation.z = Math.PI / 2;
    nozzle1.position.set(0.08, 0.2, 0);
    hydrant.add(nozzle1);
    
    const nozzle2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 8), hydrantMat);
    nozzle2.rotation.z = Math.PI / 2;
    nozzle2.position.set(-0.08, 0.2, 0);
    nozzle2.rotation.y = Math.PI;
    hydrant.add(nozzle2);

    hydrant.position.set(pos.x, 0, pos.z);
    scene.add(hydrant);
  });

  // Mailbox
  const mailboxMat = new THREE.MeshLambertMaterial({ color: 0x1144aa });
  const mailboxPost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), mailboxMat);
  mailboxPost.position.set(4, 0.35, -5.5);
  scene.add(mailboxPost);
  
  const mailboxBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.15, 0.2),
    mailboxMat
  );
  mailboxBox.position.set(4, 0.85, -5.5);
  scene.add(mailboxBox);

  // Trash can
  const trashMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const trashCan = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.5, 8), trashMat);
  trashCan.position.set(-4, 0.25, 5.5);
  scene.add(trashCan);
}


// ─── Chimney Smoke ───────────────────────────
function createChimneySmoke() {
  const smokePositions = [
    { x: -3, z: -8 },   // on building at (-3, -8)
    { x: 3, z: 8 },     // on building at (3, 8)
    { x: -12, z: -12 }, // on building at (-12, -12)
  ];

  const allSmokeParticles = [];

  smokePositions.forEach(pos => {
    const smokeGroup = new THREE.Group();
    const localParticles = [];

    for (let i = 0; i < 6; i++) {
      const smokeMat = new THREE.MeshBasicMaterial({
        color: 0xcccccc,
        transparent: true,
        opacity: 0.3 - i * 0.04,
      });
      const smokeGeo = new THREE.SphereGeometry(0.12 + i * 0.04, 6, 6);
      const smokeParticle = new THREE.Mesh(smokeGeo, smokeMat);
      smokeParticle.position.set(
        pos.x + (Math.random() - 0.5) * 0.3,
        10 + i * 0.5,
        pos.z + (Math.random() - 0.5) * 0.3
      );
      smokeGroup.add(smokeParticle);
      localParticles.push({
        mesh: smokeParticle,
        baseY: 10 + i * 0.5,
        phase: Math.random() * Math.PI * 2,
        speed: 0.2 + Math.random() * 0.3,
      });
    }

    scene.add(smokeGroup);
    localParticles.forEach(sp => {
      sp.group = smokeGroup;
    });
    allSmokeParticles.push(...localParticles);
  });

  return allSmokeParticles;
}

// ─── Trees ───────────────────────────────────
function createTrees() {
  const treePositions = [
    { x: -7, z: -6 }, { x: 7, z: 6 },
    { x: -8, z: 7 }, { x: 8, z: -7 },
    { x: 0, z: -10 },
  ];

  treePositions.forEach(pos => {
    const tree = createTree();
    tree.group.position.set(pos.x, 0, pos.z);
    scene.add(tree.group);
    trees.push(tree);
  });
}

function createTree() {
  const group = new THREE.Group();
  
  // Trunk
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3520 });
  const trunkGeo = new THREE.CylinderGeometry(0.08, 0.12, 1.2, 8);
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 0.6;
  trunk.castShadow = true;
  group.add(trunk);

  // Foliage layers
  const foliageMat = new THREE.MeshLambertMaterial({ color: 0x226633 });
  
  const sizes = [
    { r: 0.6, h: 0.8, y: 1.4 },
    { r: 0.5, h: 0.7, y: 1.9 },
    { r: 0.35, h: 0.6, y: 2.3 },
  ];

  sizes.forEach(s => {
    const foliageGeo = new THREE.ConeGeometry(s.r, s.h, 8);
    const foliage = new THREE.Mesh(foliageGeo, foliageMat);
    foliage.position.y = s.y;
    foliage.castShadow = true;
    group.add(foliage);
  });

  return { group };
}

// ─── Signs & Advertisements ──────────────────
function createSignsAndAdvertisements() {
  // Cafe sign
  const cafeSign = createSign(
    "CAFE",
    0xff6633,
    0xffeedd,
    0.8,
    0.25,
    { x: -3, z: -8, rotY: 0 }
  );
  scene.add(cafeSign);

  // Bakery sign
  const bakerySign = createSign(
    "BAKERY",
    0xdd8844,
    0xfff0e0,
    0.6,
    0.2,
    { x: 3, z: 8, rotY: Math.PI }
  );
  scene.add(bakerySign);

  // Store sign
  const storeSign = createSign(
    "SHOP",
    0x4488cc,
    0xeeeeff,
    0.5,
    0.2,
    { x: 9, z: -8, rotY: 0 }
  );
  scene.add(storeSign);

  // Billboard (larger advertisement)
  createBillboard(
    "CITY TIME MACHINE",
    0x224488,
    0xffffff,
    { x: 0, z: -12 }
  );

  // Window display (warm interior glow)
  createWindowDisplay(
    { x: -3, z: -7.5, rotY: 0 },
    [0xff6633, 0xddaa33, 0xcc4444]
  );
}

function createSign(text, bgColor, textColor, w, h, pos) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  
  // Background
  ctx.fillStyle = '#' + bgColor.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Border
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  
  // Text
  ctx.fillStyle = '#' + textColor.toString(16).padStart(6, '0');
  ctx.font = 'bold 36px Georgia';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  
  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({ map: texture });
  const geo = new THREE.PlaneGeometry(w, h);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(pos.x, 3.2, pos.z);
  mesh.rotation.y = pos.rotY;
  
  // Sign backing
  const backing = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 0.05, h + 0.05),
    new THREE.MeshLambertMaterial({ color: 0x222222 })
  );
  backing.position.set(pos.x, 3.2, pos.z - 0.01);
  backing.rotation.y = pos.rotY;
  
  return mesh;
}

function createBillboard(text, bgColor, textColor, pos) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle = '#' + bgColor.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
  
  ctx.fillStyle = '#' + textColor.toString(16).padStart(6, '0');
  ctx.font = 'bold 48px Georgia';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  
  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  const geo = new THREE.PlaneGeometry(3, 0.75);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(pos.x, 4, pos.z);
  mesh.rotation.y = Math.PI;
  
  // Billboard poles
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
  [-1.2, 1.2].forEach(dx => {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 4, 8),
      poleMat
    );
    pole.position.set(pos.x + dx, 2, pos.z - 0.05);
    scene.add(pole);
  });
  
  return mesh;
}

function createWindowDisplay(pos, colors) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  
  // Warm interior
  ctx.fillStyle = '#ffe8cc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Display items (abstract shapes)
  colors.forEach((color, i) => {
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    const cx = 40 + i * 80;
    const cy = 40 + Math.sin(i * 2) * 15;
    ctx.fillRect(cx - 20, cy - 15, 40, 30);
    
    // Item highlight
    ctx.fillStyle = '#ffffff44';
    ctx.fillRect(cx - 20, cy - 15, 40, 8);
  });
  
  // Window frame
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 8;
  ctx.strokeRect(0, 0, canvas.width, canvas.height);
  
  // Cross frame
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 0);
  ctx.lineTo(canvas.width / 2, canvas.height);
  ctx.moveTo(0, canvas.height / 2);
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();
  
  // "OPEN" text
  ctx.fillStyle = '#cc3333';
  ctx.font = 'bold 28px Georgia';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('OPEN', canvas.width / 2, canvas.height - 20);
  
  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  const geo = new THREE.PlaneGeometry(1.2, 0.6);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(pos.x, 1.5, pos.z);
  mesh.rotation.y = pos.rotY;
  
  return mesh;
}

// ─── Music System ─────────────────────────────
function createMusic() {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  
  // Create lo-fi music using oscillators and noise
  // Main chord progression: Am - F - C - G (classic lo-fi progression)
  const chords = [
    [220, 261.63, 329.63],    // Am
    [174.61, 220, 261.63],    // F
    [130.81, 164.81, 196],    // C
    [196, 246.94, 293.66],    // G
  ];

  const bpm = 80;
  const beatDuration = 60 / bpm;
  const chordDuration = beatDuration * 4; // 4 beats per chord
  
  // Pad sounds (soft, warm)
  const padGain = audioContext.createGain();
  padGain.gain.value = 0.08;
  padGain.connect(audioContext.destination);

  // Create oscillators for each chord
  const chordIndex = 0;
  const currentChord = chords[chordIndex];
  const oscillators = currentChord.map(freq => {
    const osc = audioContext.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    
    // Add slight detune for warmth
    const osc2 = audioContext.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq + 0.5;
    
    const gain = audioContext.createGain();
    gain.gain.value = 0.3;
    
    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(padGain);
    
    osc.start();
    osc2.start();
    
    return { osc, osc2, gain };
  });

  // Lo-fi filter (low-pass)
  const filter = audioContext.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 800;
  filter.Q.value = 0.5;
  padGain.connect(filter);

  // Noise for vinyl crackle
  const bufferSize = audioContext.sampleRate * 2;
  const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 0.15 - 0.075;
  }
  
  const noiseSource = audioContext.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  noiseSource.loop = true;
  
  const noiseGain = audioContext.createGain();
  noiseGain.gain.value = 0.015;
  
  const noiseFilter = audioContext.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 2000;
  noiseFilter.Q.value = 0.3;
  
  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(audioContext.destination);
  noiseSource.start();

  // Simple beat (kick + hat)
  const kickGain = audioContext.createGain();
  kickGain.gain.value = 0.15;
  kickGain.connect(audioContext.destination);
  
  const hatGain = audioContext.createGain();
  hatGain.gain.value = 0.05;
  hatGain.connect(audioContext.destination);
  
  let lastBeatTime = audioContext.currentTime;
  
  function scheduleBeat(time) {
    // Kick on every beat
    const kickOsc = audioContext.createOscillator();
    const kickOscGain = audioContext.createGain();
    kickOsc.frequency.setValueAtTime(150, time);
    kickOsc.frequency.exponentialRampToValueAtTime(30, time + 0.15);
    kickOscGain.gain.setValueAtTime(0.5, time);
    kickOscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
    kickOsc.connect(kickOscGain);
    kickOscGain.connect(kickGain);
    kickOsc.start(time);
    kickOsc.stop(time + 0.25);
    
    // Hi-hat on off-beats
    const hatBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const hatData = hatBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      hatData[i] = Math.random() * 0.1;
    }
    const hatSrc = audioContext.createBufferSource();
    hatSrc.buffer = hatBuffer;
    hatSrc.start(time + beatDuration / 2);
    hatSrc.stop(time + beatDuration / 2 + 0.05);
    hatSrc.connect(hatGain);
    
    lastBeatTime = time;
  }

  function scheduleLoop() {
    const nextChordIndex = (chordIndex + 1) % chords.length;
    
    // Change chord after chordDuration
    const nextTime = audioContext.currentTime + chordDuration;
    
    // Schedule beats in advance
    for (let i = 0; i < 8; i++) {
      scheduleBeat(audioContext.currentTime + i * beatDuration);
    }
    
    setTimeout(() => {
      // Update chord
      if (audioContext.state === 'running') {
        oscillators.forEach((o, i) => {
          const newFreq = chords[nextChordIndex][i];
          o.osc.frequency.setValueAtTime(newFreq, audioContext.currentTime);
          o.osc2.frequency.setValueAtTime(newFreq + 0.5, audioContext.currentTime);
        });
      }
      scheduleLoop();
    }, chordDuration * 1000);
  }

  scheduleLoop();
  
  musicNodes = { oscillators, noiseSource, kickGain, hatGain, padGain };
}

function stopMusic() {
  if (!audioContext) return;
  
  if (musicNodes.noiseSource) {
    musicNodes.noiseSource.stop();
  }
  musicNodes.oscillators.forEach(o => {
    o.osc.stop();
    o.osc2.stop();
  });
  audioContext.close();
  audioContext = null;
  musicNodes = [];
}

// ─── Day/Night Transition ─────────────────────
function toggleDayNight() {
  STATE.isNight = !STATE.isNight;
  const target = STATE.isNight ? COLORS.night : COLORS.day;

  // Animate transition
  const start = {
    sky: scene.background.getHex(),
    ambient: ambientLight.color.getHex(),
    ambientIntensity: ambientLight.intensity,
    directional: directionalLight.color.getHex(),
    directionalIntensity: directionalLight.intensity,
    fog: scene.fog.color.getHex(),
    exposure: renderer.toneMappingExposure,
  };

  const duration = 2000;
  const startTime = Date.now();

  function animateTransition() {
    const elapsed = Date.now() - startTime;
    const t = Math.min(elapsed / duration, 1);
    // Smooth easing
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    scene.background.setHex(lerpColor(start.sky, target.sky, ease));
    ambientLight.color.setHex(lerpColor(start.ambient, target.ambient, ease));
    ambientLight.intensity = start.ambientIntensity + (target.ambientIntensity - start.ambientIntensity) * ease;
    directionalLight.color.setHex(lerpColor(start.directional, target.directional, ease));
    directionalLight.intensity = start.directionalIntensity + (target.directionalIntensity - start.directionalIntensity) * ease;
    scene.fog.color.setHex(lerpColor(start.fog, target.fog, ease));
    renderer.toneMappingExposure = lerp(start.exposure, STATE.isNight ? 0.6 : 1.0, ease);

    // Update window lights
    buildings.forEach(b => {
      b.group.traverse(child => {
        if (child.userData.isWindowLight) {
          child.material.opacity = STATE.isNight 
            ? 0.3 + ease * 0.4 
            : 0.6 * (1 - ease);
        }
      });
    });

    // Update street lights
    streetLights.forEach(sl => {
      if (sl.pointLight) {
        sl.pointLight.intensity = STATE.isNight
          ? 0.1 + ease * 0.5
          : 0.3 * (1 - ease);
      }
      if (sl.glow) {
        sl.glow.material.opacity = STATE.isNight
          ? 0.2 + ease * 0.8
          : 0.7 * (1 - ease);
      }
    });

    if (t < 1) {
      requestAnimationFrame(animateTransition);
    }
  }

  animateTransition();
}

function lerpColor(hex1, hex2, t) {
  const r1 = (hex1 >> 16) & 0xff, g1 = (hex1 >> 8) & 0xff, b1 = hex1 & 0xff;
  const r2 = (hex2 >> 16) & 0xff, g2 = (hex2 >> 8) & 0xff, b2 = hex2 & 0xff;
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return (r << 16) | (g << 8) | b;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ─── UI Setup ─────────────────────────────────
function setupUI() {
  const btnMusic = document.getElementById('btn-music');
  const btnTime = document.getElementById('btn-time');
  const btnReset = document.getElementById('btn-reset');

  btnMusic.addEventListener('click', () => {
    STATE.musicPlaying = !STATE.musicPlaying;
    btnMusic.classList.toggle('active', STATE.musicPlaying);
    if (STATE.musicPlaying) {
      createMusic();
    } else {
      stopMusic();
    }
  });

  btnTime.addEventListener('click', () => {
    toggleDayNight();
  });

  btnReset.addEventListener('click', () => {
    camera.position.set(20, 18, 20);
    controls.target.set(0, 2, 0);
    controls.update();
  });
}

// ─── Animation Loop ───────────────────────────
function animate() {
  requestAnimationFrame(animate);
  
  const delta = 0.016; // ~60fps
  STATE.animTime += delta;

  // Update controls
  controls.update();

  // Animate pedestrians walking
  pedestrians.forEach(p => {
    p.walkTime += p.walkSpeed;
    
    // Swing arms and legs
    const swing = Math.sin(p.walkTime * 4) * 0.3;
    p.leftArm.rotation.x = swing;
    p.rightArm.rotation.x = -swing;
    p.leftLeg.rotation.x = -swing * 0.7;
    p.rightLeg.rotation.x = swing * 0.7;

    // Gentle wander movement
    if (p.group.position.y < 10) { // bounds check
      const wanderAngle = Math.sin(p.walkTime * 0.1) * 0.5;
      p.group.rotation.y = wanderAngle;
      
      const step = p.walkSpeed * 0.5;
      const newX = p.group.position.x + Math.sin(wanderAngle) * step;
      const newZ = p.group.position.z + Math.cos(wanderAngle) * step;
      
      // Keep on sidewalk/road (not inside buildings)
      if (Math.abs(newX) < 14 && Math.abs(newZ) < 14) {
        p.group.position.x = newX;
        p.group.position.z = newZ;
      }
    }
  });

  // Animate vehicles moving slowly
  vehicles.forEach(v => {
    const roadZ = Math.abs(v.group.position.z) < 1;
    const roadX = Math.abs(v.group.position.x) < 1;
    
    if (roadZ) {
      // Moving along x-axis (horizontal road)
      v.group.position.x += v.speed * v.direction;
      if (Math.abs(v.group.position.x) > 14) {
        v.group.position.x = v.group.position.x > 0 ? -14 : 14;
      }
    } else if (roadX) {
      // Moving along z-axis (vertical road)
      v.group.position.z += v.speed * v.direction;
      if (Math.abs(v.group.position.z) > 14) {
        v.group.position.z = v.group.position.z > 0 ? -14 : 14;
      }
    }
  });

  // Subtle tree sway
  trees.forEach(t => {
    const sway = Math.sin(STATE.animTime * 0.5) * 0.005;
    t.group.rotation.z = sway;
  });

  // Chimney smoke animation
  if (smokeParticles) {
    smokeParticles.forEach(sp => {
      const t = (STATE.animTime * sp.speed + sp.phase) % 4;
      sp.mesh.position.y = sp.baseY + t;
      sp.mesh.position.x += Math.sin(STATE.animTime * 2 + sp.phase) * 0.002;
      sp.mesh.position.z += Math.cos(STATE.animTime * 1.5 + sp.phase) * 0.002;
      sp.mesh.material.opacity = Math.max(0, 0.3 - (t - sp.baseY) * 0.06);
      sp.mesh.scale.setScalar(1 + t * 0.15);
    });
  }

  renderer.render(scene, camera);
}

// ─── Window Resize ────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── Start ────────────────────────────────────
init();
