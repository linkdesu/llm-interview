/**
 * City Time Machine - 3D Diorama
 * A cozy city block that transforms across four eras: 1965, 2005, 2025, 2055
 */

// ============================================================
// GLOBAL STATE
// ============================================================

const YEARS = [1965, 2005, 2025, 2055];
let currentYearIndex = 0;
let targetYearIndex = 0;
let transitionProgress = 1; // 0 = start of transition, 1 = complete

// Three.js core
let scene, camera, renderer, controls;
let clock = new THREE.Clock();

// Scene groups
let cityGroup = null;
let buildingsGroup = null;
let vehiclesGroup = null;
let pedestriansGroup = null;
let propsGroup = null;
let particlesGroup = null;

// Era-specific object references (for morphing)
let eraObjects = {};

// Audio
let audioContext = null;
let isPlaying = false;
let audioNodes = [];

// ============================================================
// INITIALIZATION
// ============================================================

function init() {
  createScene();
  createCamera();
  createRenderer();
  createControls();
  createLights();
  buildCity();
  setupUI();
  startAnimationLoop();
  hideLoading();
}

function createScene() {
  scene = new THREE.Scene();
  // Warm fog for depth and coziness
  scene.fog = new THREE.Fog(0x87CEEB, 30, 90);
  scene.background = new THREE.Color(0x87CEEB);
}

function createCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 200);
  camera.position.set(25, 18, 25);
  camera.lookAt(0, 3, 0);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function createRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  document.getElementById('canvas-container').appendChild(renderer.domElement);
}

function createControls() {
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 12;
  controls.maxDistance = 50;
  controls.maxPolarAngle = Math.PI / 2.15;
  controls.minPolarAngle = Math.PI / 8;
  controls.target.set(0, 3, 0);
  controls.enablePan = false;
}

function createLights() {
  // Warm ambient light
  const ambient = new THREE.AmbientLight(0xffeedd, 0.6);
  scene.add(ambient);
  eraObjects.ambientLight = ambient;

  // Main directional light (sun)
  const sun = new THREE.DirectionalLight(0xfff5e6, 0.9);
  sun.position.set(15, 25, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 60;
  sun.shadow.camera.left = -25;
  sun.shadow.camera.right = 25;
  sun.shadow.camera.top = 25;
  sun.shadow.camera.bottom = -25;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  eraObjects.sunLight = sun;

  // Warm fill light
  const fill = new THREE.DirectionalLight(0xffe0c0, 0.3);
  fill.position.set(-10, 10, -5);
  scene.add(fill);

  // Point lights for street lamps (added later)
  eraObjects.streetLights = [];
}

// ============================================================
// CITY BUILDING
// ============================================================

function buildCity() {
  cityGroup = new THREE.Group();
  buildingsGroup = new THREE.Group();
  vehiclesGroup = new THREE.Group();
  pedestriansGroup = new THREE.Group();
  propsGroup = new THREE.Group();
  particlesGroup = new THREE.Group();

  cityGroup.add(buildingsGroup);
  cityGroup.add(vehiclesGroup);
  cityGroup.add(pedestriansGroup);
  cityGroup.add(propsGroup);
  cityGroup.add(particlesGroup);
  scene.add(cityGroup);

  createGround();
  createBuildings();
  createStorefronts();
  createVehicles();
  createPedestrians();
  createStreetProps();
  createAtmosphericParticles();
  initializeEraObjects();
}

function createGround() {
  // Main street
  const streetGeo = new THREE.PlaneGeometry(10, 40);
  const streetMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a3a,
    roughness: 0.9,
    metalness: 0.0
  });
  const street = new THREE.Mesh(streetGeo, streetMat);
  street.rotation.x = -Math.PI / 2;
  street.receiveShadow = true;
  buildingsGroup.add(street);

  // Road markings (dashed center line)
  for (let z = -18; z < 18; z += 3) {
    const markGeo = new THREE.PlaneGeometry(0.2, 1.2);
    const markMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, roughness: 0.7 });
    const mark = new THREE.Mesh(markGeo, markMat);
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(0, 0.01, z);
    buildingsGroup.add(mark);
  }

  // Sidewalks
  const sidewalkGeo = new THREE.PlaneGeometry(4, 40);
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xc4b5a0, roughness: 0.95 });

  const leftSidewalk = new THREE.Mesh(sidewalkGeo, sidewalkMat);
  leftSidewalk.rotation.x = -Math.PI / 2;
  leftSidewalk.position.set(-7, 0.05, 0);
  leftSidewalk.receiveShadow = true;
  buildingsGroup.add(leftSidewalk);

  const rightSidewalk = new THREE.Mesh(sidewalkGeo, sidewalkMat);
  rightSidewalk.rotation.x = -Math.PI / 2;
  rightSidewalk.position.set(7, 0.05, 0);
  rightSidewalk.receiveShadow = true;
  buildingsGroup.add(rightSidewalk);

  // Grass patches at edges
  const grassGeo = new THREE.PlaneGeometry(6, 40);
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x4a7c3f, roughness: 1.0 });

  const leftGrass = new THREE.Mesh(grassGeo, grassMat);
  leftGrass.rotation.x = -Math.PI / 2;
  leftGrass.position.set(-13, 0.02, 0);
  leftGrass.receiveShadow = true;
  buildingsGroup.add(leftGrass);

  const rightGrass = new THREE.Mesh(grassGeo, grassMat);
  rightGrass.rotation.x = -Math.PI / 2;
  rightGrass.position.set(13, 0.02, 0);
  rightGrass.receiveShadow = true;
  buildingsGroup.add(rightGrass);

  eraObjects.grass = grassMat;
}

function createBuildings() {
  // Left side buildings (3 buildings)
  createBuilding(-10, -12, 8, 10, 14, 'left', 0);
  createBuilding(-10, -2, 7, 9, 12, 'left', 1);
  createBuilding(-10, 8, 9, 11, 15, 'left', 2);

  // Right side buildings (3 buildings)
  createBuilding(10, -11, 7, 10, 13, 'right', 0);
  createBuilding(10, -1, 8, 9, 11, 'right', 1);
  createBuilding(10, 9, 6, 10, 14, 'right', 2);
}

function createBuilding(x, z, width, height, depth, side, index) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  // Main structure
  const buildingColors = [0xd4a574, 0xc9b896, 0xb8a082, 0xd9c2a4, 0xa68b6b];
  const bodyColor = buildingColors[index % buildingColors.length];
  const bodyGeo = new THREE.BoxGeometry(width, height, depth);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.8,
    metalness: 0.05
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Cornice detail at top
  const corniceGeo = new THREE.BoxGeometry(width + 0.3, 0.25, depth + 0.3);
  const corniceMat = new THREE.MeshStandardMaterial({
    color: 0xf5f0e8,
    roughness: 0.7
  });
  const cornice = new THREE.Mesh(corniceGeo, corniceMat);
  cornice.position.y = height;
  cornice.castShadow = true;
  group.add(cornice);

  // Foundation detail at bottom
  const foundationGeo = new THREE.BoxGeometry(width + 0.1, 0.3, depth + 0.1);
  const foundationMat = new THREE.MeshStandardMaterial({
    color: 0x5a5a5a,
    roughness: 0.9
  });
  const foundation = new THREE.Mesh(foundationGeo, foundationMat);
  foundation.position.y = 0.15;
  group.add(foundation);

  // Roof
  const roofType = index % 2 === 0 ? 'pitched' : 'flat';
  if (roofType === 'pitched') {
    const roofGeo = new THREE.ConeGeometry(width * 0.75, 3.2, 4);
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.9
    });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = height + 1.6;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);
    eraObjects.roofs = eraObjects.roofs || [];
    eraObjects.roofs.push(roofMat);

    // Chimney
    const chimneyGeo = new THREE.BoxGeometry(0.6, 2, 0.6);
    const chimneyMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.95 });
    const chimney = new THREE.Mesh(chimneyGeo, chimneyMat);
    chimney.position.set(width * 0.3, height + 2.5, 0);
    chimney.castShadow = true;
    group.add(chimney);
  } else {
    const roofGeo = new THREE.BoxGeometry(width + 0.5, 0.4, depth + 0.5);
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x6b4423,
      roughness: 0.85
    });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = height + 0.2;
    roof.castShadow = true;
    group.add(roof);
    eraObjects.roofs = eraObjects.roofs || [];
    eraObjects.roofs.push(roofMat);

    // Roof vent/AC unit
    const ventGeo = new THREE.BoxGeometry(0.8, 0.6, 0.8);
    const ventMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.6 });
    const vent = new THREE.Mesh(ventGeo, ventMat);
    vent.position.set(width * 0.25, height + 0.7, 0);
    group.add(vent);
  }

  // Windows with frames
  const windowRows = Math.floor(height / 3.5);
  const windowCols = Math.floor(width / 2.5);
  const windowGeo = new THREE.PlaneGeometry(0.8, 1.2);
  const frameGeo = new THREE.PlaneGeometry(1.0, 1.4);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e8, roughness: 0.6 });

  for (let row = 0; row < windowRows; row++) {
    for (let col = 0; col < windowCols; col++) {
      const wx = (col - (windowCols - 1) / 2) * 2.2;
      const wy = 2.2 + row * 3.5;
      const wz = side === 'left' ? depth / 2 + 0.01 : -depth / 2 - 0.01;

      // Window frame
      const frame = new THREE.Mesh(frameGeo, frameMat.clone());
      frame.position.set(wx, wy, wz);
      if (side === 'right') frame.rotation.y = Math.PI;
      group.add(frame);

      // Window glass
      const isLit = Math.random() > 0.35;
      const winColor = isLit ? 0xffeebb : 0x445566;
      const winMat = new THREE.MeshStandardMaterial({
        color: winColor,
        emissive: isLit ? 0xffddaa : 0x000000,
        emissiveIntensity: isLit ? 0.5 : 0,
        roughness: 0.1,
        metalness: 0.6
      });
      const win = new THREE.Mesh(windowGeo, winMat);
      win.position.set(wx, wy, wz + (side === 'left' ? 0.01 : -0.01));
      if (side === 'right') win.rotation.y = Math.PI;
      group.add(win);

      eraObjects.windows = eraObjects.windows || [];
      eraObjects.windows.push(winMat);

      // Window sill
      if (row > 0) {
        const sillGeo = new THREE.BoxGeometry(1.1, 0.08, 0.15);
        const sillMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e8, roughness: 0.7 });
        const sill = new THREE.Mesh(sillGeo, sillMat);
        sill.position.set(wx, wy - 0.7, wz + (side === 'left' ? 0.05 : -0.05));
        group.add(sill);
      }
    }
  }

  // Side windows
  const sideWinCount = Math.floor(depth / 3);
  for (let i = 0; i < sideWinCount; i++) {
    const sz = (i - (sideWinCount - 1) / 2) * 2.8;
    const swMat = new THREE.MeshStandardMaterial({
      color: 0x556677,
      emissive: 0x000000,
      roughness: 0.1,
      metalness: 0.6
    });
    const sideWin = new THREE.Mesh(windowGeo, swMat);
    sideWin.position.set(side === 'left' ? -width / 2 - 0.01 : width / 2 + 0.01, 3, sz);
    sideWin.rotation.y = side === 'left' ? -Math.PI / 2 : Math.PI / 2;
    group.add(sideWin);
    eraObjects.windows.push(swMat);
  }

  // Door on ground floor
  const doorGeo = new THREE.PlaneGeometry(1.2, 2.2);
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x5c3a1e,
    roughness: 0.7
  });
  const door = new THREE.Mesh(doorGeo, doorMat);
  const doorZ = side === 'left' ? depth / 2 + 0.02 : -depth / 2 - 0.02;
  door.position.set(0, 1.1, doorZ);
  if (side === 'right') door.rotation.y = Math.PI;
  group.add(door);

  // Door frame
  const doorFrameGeo = new THREE.PlaneGeometry(1.5, 2.5);
  const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e8, roughness: 0.6 });
  const doorFrame = new THREE.Mesh(doorFrameGeo, doorFrameMat);
  doorFrame.position.set(0, 1.1, doorZ - 0.01);
  if (side === 'right') doorFrame.rotation.y = Math.PI;
  group.add(doorFrame);

  buildingsGroup.add(group);
}

function createStorefronts() {
  // Storefront awnings and signs for each building
  const storeConfigs = [
    { x: -10, z: -12, side: 'left', name: 'Joe\'s Cafe', color: 0xcc3333 },
    { x: -10, z: -2, side: 'left', name: 'Book Nook', color: 0x3366cc },
    { x: -10, z: 8, side: 'left', name: 'Green Market', color: 0x33aa55 },
    { x: 10, z: -11, side: 'right', name: 'Pizza Place', color: 0xdd4422 },
    { x: 10, z: -1, side: 'right', name: 'Record Shop', color: 0x8844aa },
    { x: 10, z: 9, side: 'right', name: 'Flower Shop', color: 0xdd6688 }
  ];

  eraObjects.awnings = [];
  eraObjects.signs = [];

  storeConfigs.forEach(config => {
    const awningWidth = config.side === 'left' ? 5 : 5;
    const awningDepth = 2;

    // Awnings (striped)
    const awningGeo = new THREE.BoxGeometry(awningWidth, 0.15, awningDepth);
    const awningMat = new THREE.MeshStandardMaterial({
      color: config.color,
      roughness: 0.6
    });
    const awning = new THREE.Mesh(awningGeo, awningMat);
    const awningZ = config.side === 'left' ? 6.5 : -6.5;
    awning.position.set(config.x, 2.8, config.z);
    awning.castShadow = true;
    buildingsGroup.add(awning);
    eraObjects.awnings.push(awningMat);

    // Sign board
    const signGeo = new THREE.PlaneGeometry(3.5, 1);
    const signMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      emissive: config.color,
      emissiveIntensity: 0.3,
      roughness: 0.4
    });
    const sign = new THREE.Mesh(signGeo, signMat);
    const signZ = config.side === 'left' ? 6.6 : -6.6;
    sign.position.set(config.x, 4.2, config.z);
    if (config.side === 'right') sign.rotation.y = Math.PI;
    buildingsGroup.add(sign);
    eraObjects.signs.push({ mesh: sign, material: signMat });

    // Display window
    const displayGeo = new THREE.PlaneGeometry(2.5, 1.8);
    const displayMat = new THREE.MeshStandardMaterial({
      color: 0xffeedd,
      emissive: 0xffddaa,
      emissiveIntensity: 0.4,
      roughness: 0.1,
      metalness: 0.6
    });
    const display = new THREE.Mesh(displayGeo, displayMat);
    const dispZ = config.side === 'left' ? 6.55 : -6.55;
    display.position.set(config.x, 1.5, config.z);
    if (config.side === 'right') display.rotation.y = Math.PI;
    buildingsGroup.add(display);
    eraObjects.windows.push(displayMat);
  });
}

function createVehicles() {
  eraObjects.vehicles = [];
  eraObjects.vehiclePositions = [];
  eraObjects.flyingVehicles = [];

  // Ground vehicles
  const vehicleConfigs = [
    { x: -2, z: -8, dir: 1, type: 'sedan' },
    { x: 2, z: 3, dir: -1, type: 'compact' },
    { x: -1.5, z: 14, dir: 1, type: 'truck' },
    { x: 1.5, z: -16, dir: -1, type: 'sedan' }
  ];

  vehicleConfigs.forEach(config => {
    const vehicle = createVehicle(config.type);
    vehicle.position.set(config.x, 0.35, config.z);
    if (config.dir === -1) vehicle.rotation.y = Math.PI;
    vehiclesGroup.add(vehicle);
    eraObjects.vehicles.push(vehicle);
    eraObjects.vehiclePositions.push({
      baseZ: config.z,
      dir: config.dir,
      speed: 0.5 + Math.random() * 0.5,
      offset: Math.random() * Math.PI * 2
    });
  });

  // Flying vehicles (visible only in 2055)
  const flyingConfigs = [
    { x: -3, z: -10, y: 12, dir: 1 },
    { x: 3, z: 5, y: 15, dir: -1 },
    { x: -1, z: 16, y: 10, dir: 1 }
  ];

  flyingConfigs.forEach(config => {
    const flyer = createFlyingVehicle();
    flyer.position.set(config.x, config.y, config.z);
    flyer.visible = false; // Hidden until 2055
    if (config.dir === -1) flyer.rotation.y = Math.PI;
    vehiclesGroup.add(flyer);
    eraObjects.flyingVehicles.push(flyer);
    eraObjects.vehiclePositions.push({
      baseZ: config.z,
      baseY: config.y,
      dir: config.dir,
      speed: 0.8 + Math.random() * 0.4,
      offset: Math.random() * Math.PI * 2
    });
  });
}

function createVehicle(type) {
  const group = new THREE.Group();

  if (type === 'sedan') {
    // Classic sedan shape
    const bodyGeo = new THREE.BoxGeometry(1.8, 0.7, 3.8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x228b22,
      roughness: 0.3,
      metalness: 0.6
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.45;
    body.castShadow = true;
    group.add(body);

    // Cabin
    const cabinGeo = new THREE.BoxGeometry(1.5, 0.6, 2);
    const cabinMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.1,
      metalness: 0.8
    });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 1.05, -0.2);
    cabin.castShadow = true;
    group.add(cabin);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.2, 12);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const wheelPositions = [
      [-0.9, 0.25, 1.2], [0.9, 0.25, 1.2],
      [-0.9, 0.25, -1.2], [0.9, 0.25, -1.2]
    ];
    wheelPositions.forEach(pos => {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(...pos);
      group.add(wheel);
    });

    eraObjects.vehicleBodies = eraObjects.vehicleBodies || [];
    eraObjects.vehicleBodies.push(bodyMat);
    eraObjects.vehicleCabins = eraObjects.vehicleCabins || [];
    eraObjects.vehicleCabins.push(cabinMat);

  } else if (type === 'compact') {
    // Compact car
    const bodyGeo = new THREE.BoxGeometry(1.6, 0.6, 3);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.3,
      metalness: 0.6
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.4;
    body.castShadow = true;
    group.add(body);

    const cabinGeo = new THREE.BoxGeometry(1.3, 0.5, 1.5);
    const cabinMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.1,
      metalness: 0.8
    });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 0.95, -0.1);
    cabin.castShadow = true;
    group.add(cabin);

    eraObjects.vehicleBodies = eraObjects.vehicleBodies || [];
    eraObjects.vehicleBodies.push(bodyMat);
    eraObjects.vehicleCabins = eraObjects.vehicleCabins || [];
    eraObjects.vehicleCabins.push(cabinMat);

  } else if (type === 'truck') {
    // Pickup truck
    const bodyGeo = new THREE.BoxGeometry(1.9, 0.8, 4.2);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.4,
      metalness: 0.5
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.5;
    body.castShadow = true;
    group.add(body);

    const cabinGeo = new THREE.BoxGeometry(1.6, 0.7, 1.8);
    const cabinMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.1,
      metalness: 0.8
    });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 1.15, -0.8);
    cabin.castShadow = true;
    group.add(cabin);

    eraObjects.vehicleBodies = eraObjects.vehicleBodies || [];
    eraObjects.vehicleBodies.push(bodyMat);
    eraObjects.vehicleCabins = eraObjects.vehicleCabins || [];
    eraObjects.vehicleCabins.push(cabinMat);
  }

  return group;
}

function createFlyingVehicle() {
  const group = new THREE.Group();

  // Sleek pod shape (cylinder + hemispheres)
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xeeeeee,
    roughness: 0.1,
    metalness: 0.9,
    emissive: 0x0044aa,
    emissiveIntensity: 0.2
  });

  // Main body (cylinder)
  const bodyGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.5, 8);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.rotation.z = Math.PI / 2;
  body.castShadow = true;
  group.add(body);

  // Nose cone
  const noseGeo = new THREE.ConeGeometry(0.5, 0.6, 8);
  const nose = new THREE.Mesh(noseGeo, bodyMat);
  nose.rotation.z = -Math.PI / 2;
  nose.position.x = 1.05;
  group.add(nose);

  // Tail cone
  const tailGeo = new THREE.ConeGeometry(0.5, 0.6, 8);
  const tail = new THREE.Mesh(tailGeo, bodyMat);
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -1.05;
  group.add(tail);

  // Glowing underside
  const glowGeo = new THREE.CylinderGeometry(0.4, 0.4, 1.4, 8);
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x00ffff,
    emissive: 0x00ffff,
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 0.6
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.rotation.z = Math.PI / 2;
  glow.position.y = -0.3;
  group.add(glow);

  // Side lights
  const lightGeo = new THREE.SphereGeometry(0.08, 6, 6);
  const lightMat = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0xff0000,
    emissiveIntensity: 1
  });
  const rearLight = new THREE.Mesh(lightGeo, lightMat);
  rearLight.position.set(0, 0, -1);
  group.add(rearLight);

  const frontLightMat = new THREE.MeshStandardMaterial({
    color: 0x00ff00,
    emissive: 0x00ff00,
    emissiveIntensity: 1
  });
  const frontLight = new THREE.Mesh(lightGeo, frontLightMat);
  frontLight.position.set(0, 0, 1);
  group.add(frontLight);

  eraObjects.vehicleBodies = eraObjects.vehicleBodies || [];
  eraObjects.vehicleBodies.push(bodyMat);

  return group;
}

function createPedestrians() {
  eraObjects.pedestrians = [];
  eraObjects.pedestrianMaterials = [];
  eraObjects.pedestrianPaths = [];

  const pedestrianConfigs = [
    { x: -6, z: -10, side: 'left' },
    { x: 6, z: -5, side: 'right' },
    { x: -6, z: 2, side: 'left' },
    { x: 6, z: 8, side: 'right' },
    { x: -6, z: 14, side: 'left' },
    { x: 6, z: -14, side: 'right' }
  ];

  pedestrianConfigs.forEach(config => {
    const ped = createPedestrian();
    ped.position.set(config.x, 0, config.z);
    pedestriansGroup.add(ped);
    eraObjects.pedestrians.push(ped);
    eraObjects.pedestrianPaths.push({
      baseZ: config.z,
      side: config.side,
      speed: 0.2 + Math.random() * 0.3,
      offset: Math.random() * Math.PI * 2,
      range: 4
    });
  });
}

function createPedestrian() {
  const group = new THREE.Group();

  // Body
  const bodyGeo = new THREE.CylinderGeometry(0.25, 0.3, 0.9, 8);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xcc3333,
    roughness: 0.8
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.95;
  body.castShadow = true;
  group.add(body);

  // Head
  const headGeo = new THREE.SphereGeometry(0.2, 8, 8);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xffdbac,
    roughness: 0.7
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.6;
  head.castShadow = true;
  group.add(head);

  // Legs
  const legGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.6, 6);
  const legMat = new THREE.MeshStandardMaterial({
    color: 0x333366,
    roughness: 0.8
  });

  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(-0.12, 0.3, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.set(0.12, 0.3, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);

  eraObjects.pedestrianMaterials.push({ body: bodyMat, legs: legMat });

  return group;
}

function createStreetProps() {
  eraObjects.lampHeads = [];
  eraObjects.treeCanopies = [];

  // Street lamps
  const lampPositions = [
    { x: -5.5, z: -14 }, { x: -5.5, z: -4 }, { x: -5.5, z: 6 }, { x: -5.5, z: 16 },
    { x: 5.5, z: -14 }, { x: 5.5, z: -4 }, { x: 5.5, z: 6 }, { x: 5.5, z: 16 }
  ];

  lampPositions.forEach(pos => {
    const lamp = createStreetLamp();
    lamp.position.set(pos.x, 0, pos.z);
    propsGroup.add(lamp);
  });

  // Trees
  const treePositions = [
    { x: -11, z: -16 }, { x: -11, z: -6 }, { x: -11, z: 4 }, { x: -11, z: 18 },
    { x: 11, z: -16 }, { x: 11, z: -6 }, { x: 11, z: 4 }, { x: 11, z: 18 },
    { x: -15, z: -10 }, { x: -15, z: 10 },
    { x: 15, z: -10 }, { x: 15, z: 10 }
  ];

  treePositions.forEach(pos => {
    const tree = createTree();
    tree.position.set(pos.x, 0, pos.z);
    propsGroup.add(tree);
  });

  // Benches
  createBench(-5.5, -8);
  createBench(5.5, 4);
  createBench(-5.5, 12);
  createBench(5.5, -12);

  // Mailboxes
  createMailbox(-5.5, -12);
  createMailbox(-5.5, 8);
  createMailbox(5.5, -6);
  createMailbox(5.5, 14);

  // Fire hydrant
  createFireHydrant(-5.5, 2);

  // Planters with flowers
  createPlanter(-5.5, -16);
  createPlanter(5.5, 18);
  createPlanter(-5.5, 18);
  createPlanter(5.5, -16);

  // Trash cans
  createTrashCan(-5.5, -2);
  createTrashCan(5.5, 10);

  // Crosswalk markings
  createCrosswalk(-4);
  createCrosswalk(10);
}

function createStreetLamp() {
  const group = new THREE.Group();

  // Pole
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 4.5, 8);
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.5,
    metalness: 0.8
  });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 2.25;
  pole.castShadow = true;
  group.add(pole);

  // Arm
  const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6);
  const arm = new THREE.Mesh(armGeo, poleMat);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(0.5, 4.3, 0);
  group.add(arm);

  // Lamp head
  const headGeo = new THREE.SphereGeometry(0.2, 8, 8);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xffeebb,
    emissive: 0xffddaa,
    emissiveIntensity: 0.8,
    roughness: 0.2
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.set(1.1, 4.3, 0);
  group.add(head);
  eraObjects.lampHeads.push(headMat);

  // Point light
  const light = new THREE.PointLight(0xffddaa, 0.6, 8);
  light.position.set(1.1, 4.2, 0);
  group.add(light);
  eraObjects.streetLights.push(light);

  return group;
}

function createTree() {
  const group = new THREE.Group();

  // Trunk with slight curve
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.22, 2.8, 8);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x5c3a1e,
    roughness: 0.95
  });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 1.4;
  trunk.castShadow = true;
  group.add(trunk);

  // Branches
  const branchGeo = new THREE.CylinderGeometry(0.04, 0.08, 1.2, 6);
  const branchPositions = [
    { x: -0.3, y: 2.2, z: 0, rx: 0.3, rz: -0.5 },
    { x: 0.25, y: 2.4, z: 0.1, rx: -0.2, rz: 0.4 }
  ];
  branchPositions.forEach(b => {
    const branch = new THREE.Mesh(branchGeo, trunkMat);
    branch.position.set(b.x, b.y, b.z);
    branch.rotation.set(b.rx, 0, b.rz);
    branch.castShadow = true;
    group.add(branch);
  });

  // Canopy (multiple spheres for organic look)
  const canopyMat = new THREE.MeshStandardMaterial({
    color: 0x4a7c3f,
    roughness: 0.9
  });

  const canopyPositions = [
    [0, 3.5, 0, 1.3],
    [-0.7, 3.8, 0.4, 0.9],
    [0.6, 3.6, -0.5, 1.0],
    [0, 4.2, 0, 0.8],
    [-0.4, 4.0, -0.3, 0.7],
    [0.3, 3.9, 0.5, 0.75]
  ];

  canopyPositions.forEach(([x, y, z, r]) => {
    const canopyGeo = new THREE.SphereGeometry(r, 8, 8);
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(x, y, z);
    canopy.castShadow = true;
    group.add(canopy);
  });

  eraObjects.treeCanopies.push(canopyMat);

  return group;
}

function createBench(x, z) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x5c3a1e,
    roughness: 0.85
  });

  // Seat
  const seatGeo = new THREE.BoxGeometry(1.8, 0.08, 0.5);
  const seat = new THREE.Mesh(seatGeo, mat);
  seat.position.y = 0.5;
  seat.castShadow = true;
  group.add(seat);

  // Back
  const backGeo = new THREE.BoxGeometry(1.8, 0.6, 0.08);
  const back = new THREE.Mesh(backGeo, mat);
  back.position.set(0, 0.85, -0.2);
  back.castShadow = true;
  group.add(back);

  // Legs
  const legGeo = new THREE.BoxGeometry(0.08, 0.5, 0.4);
  const legPositions = [
    [-0.75, 0.25, 0], [0.75, 0.25, 0],
    [-0.75, 0.25, -0.15], [0.75, 0.25, -0.15]
  ];
  legPositions.forEach(([lx, ly, lz]) => {
    const leg = new THREE.Mesh(legGeo, mat);
    leg.position.set(lx, ly, lz);
    group.add(leg);
  });

  group.position.set(x, 0, z);
  group.rotation.y = x > 0 ? Math.PI : 0;
  propsGroup.add(group);
}

function createMailbox(x, z) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a1a8e,
    roughness: 0.4,
    metalness: 0.6
  });

  // Post
  const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 1, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8 });
  const post = new THREE.Mesh(postGeo, postMat);
  post.position.y = 0.5;
  group.add(post);

  // Box
  const boxGeo = new THREE.BoxGeometry(0.35, 0.3, 0.2);
  const box = new THREE.Mesh(boxGeo, mat);
  box.position.y = 1.05;
  box.castShadow = true;
  group.add(box);

  group.position.set(x, 0, z);
  propsGroup.add(group);
}

function createFireHydrant(x, z) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xcc0000,
    roughness: 0.3,
    metalness: 0.5
  });

  // Body
  const bodyGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.6, 8);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = 0.3;
  body.castShadow = true;
  group.add(body);

  // Top
  const topGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.15, 8);
  const top = new THREE.Mesh(topGeo, mat);
  top.position.y = 0.68;
  group.add(top);

  group.position.set(x, 0, z);
  propsGroup.add(group);
}

function createPlanter(x, z) {
  const group = new THREE.Group();

  // Planter box
  const boxGeo = new THREE.BoxGeometry(0.8, 0.6, 0.8);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.9 });
  const box = new THREE.Mesh(boxGeo, boxMat);
  box.position.y = 0.3;
  box.castShadow = true;
  group.add(box);

  // Soil
  const soilGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.05, 8);
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 1.0 });
  const soil = new THREE.Mesh(soilGeo, soilMat);
  soil.position.y = 0.6;
  group.add(soil);

  // Flowers (small spheres)
  const flowerColors = [0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff];
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const r = 0.15;
    const flowerGeo = new THREE.SphereGeometry(0.08, 6, 6);
    const flowerMat = new THREE.MeshStandardMaterial({
      color: flowerColors[i % flowerColors.length],
      roughness: 0.7
    });
    const flower = new THREE.Mesh(flowerGeo, flowerMat);
    flower.position.set(Math.cos(angle) * r, 0.75, Math.sin(angle) * r);
    group.add(flower);
  }

  group.position.set(x, 0, z);
  propsGroup.add(group);
}

function createTrashCan(x, z) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x4a4a4a,
    roughness: 0.4,
    metalness: 0.7
  });

  // Body
  const bodyGeo = new THREE.CylinderGeometry(0.22, 0.25, 0.9, 8);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = 0.45;
  body.castShadow = true;
  group.add(body);

  // Lid
  const lidGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.06, 8);
  const lid = new THREE.Mesh(lidGeo, mat);
  lid.position.y = 0.93;
  group.add(lid);

  group.position.set(x, 0, z);
  propsGroup.add(group);
}

function createCrosswalk(z) {
  const markGeo = new THREE.PlaneGeometry(0.3, 2);
  const markMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8
  });

  for (let x = -4.5; x <= 4.5; x += 0.8) {
    const mark = new THREE.Mesh(markGeo, markMat);
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(x, 0.015, z);
    buildingsGroup.add(mark);
  }
}

function createAtmosphericParticles() {
  const particleCount = 200;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);

  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 40;
    positions[i * 3 + 1] = Math.random() * 20;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 50;
    sizes[i] = Math.random() * 0.15 + 0.05;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    color: 0xffeedd,
    size: 0.1,
    transparent: true,
    opacity: 0.6,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending
  });

  const particles = new THREE.Points(geometry, material);
  particlesGroup.add(particles);

  eraObjects.particles = {
    mesh: particles,
    positions: positions,
    material: material
  };
}

// ============================================================
// ERA SYSTEM
// ============================================================

function initializeEraObjects() {
  // All mutable objects are already stored in eraObjects during creation
  // This function ensures we have defaults
  if (!eraObjects.windows) eraObjects.windows = [];
  if (!eraObjects.awnings) eraObjects.awnings = [];
  if (!eraObjects.signs) eraObjects.signs = [];
  if (!eraObjects.roofs) eraObjects.roofs = [];
  if (!eraObjects.lampHeads) eraObjects.lampHeads = [];
  if (!eraObjects.treeCanopies) eraObjects.treeCanopies = [];
  if (!eraObjects.vehicleBodies) eraObjects.vehicleBodies = [];
  if (!eraObjects.vehicleCabins) eraObjects.vehicleCabins = [];
  if (!eraObjects.pedestrianMaterials) eraObjects.pedestrianMaterials = [];
}

function setYear(yearIndex) {
  if (yearIndex < 0 || yearIndex >= YEARS.length) return;
  if (yearIndex === currentYearIndex && transitionProgress >= 1) return;

  targetYearIndex = yearIndex;
  transitionProgress = 0;

  // Update UI immediately
  updateTimelineUI(yearIndex);
  updateInfoPanel(YEARS[yearIndex]);
}

function updateEraTransition(delta) {
  if (transitionProgress >= 1) return;

  const speed = 1.5;
  transitionProgress = Math.min(1, transitionProgress + delta * speed);
  const eased = easeInOutCubic(transitionProgress);

  applyEraProperties(eased);

  if (transitionProgress >= 1) {
    currentYearIndex = targetYearIndex;
  }
}

function applyEraProperties(progress) {
  const fromYear = YEARS[currentYearIndex];
  const toYear = YEARS[targetYearIndex];
  const from = ERA_PALETTES[fromYear];
  const to = ERA_PALETTES[toYear];

  // Interpolate scene colors
  scene.background.setHex(lerpColor(from.sky, to.sky, progress));
  scene.fog.color.setHex(lerpColor(from.sky, to.sky, progress));

  // Lights
  eraObjects.ambientLight.color.setHex(lerpColor(from.ambient, to.ambient, progress));
  eraObjects.sunLight.color.setHex(lerpColor(0xfff5e6, to.sky > 0x500050 ? 0x8866cc : 0xfff5e6, progress));

  // Street lights intensity (brighter at night for future eras)
  const targetIntensity = toYear === 2055 ? 1.2 : toYear === 2025 ? 0.9 : 0.6;
  eraObjects.streetLights.forEach(light => {
    light.intensity = THREE.MathUtils.lerp(0.6, targetIntensity, progress);
    light.color.setHex(lerpColor(0xffddaa, toYear === 2055 ? 0x00ffff : 0xffeebb, progress));
  });

  // Building materials
  const buildingColor = lerpColor(from.buildingBase, to.buildingBase, progress);
  buildingsGroup.children.forEach(child => {
    if (child.isMesh && child.material && child.geometry && child.geometry.type === 'BoxGeometry') {
      if (child.material.color) {
        const originalR = child.material.color.r;
        if (originalR > 0.5) { // Building-like colors
          child.material.color.setHex(buildingColor);
        }
      }
    }
  });

  // Windows
  const winEmissive = toYear === 2055 ? 0x00ffff : toYear === 2025 ? 0x00aaff : 0xffddaa;
  eraObjects.windows.forEach(mat => {
    mat.emissive.setHex(lerpColor(mat.emissive.getHex(), winEmissive, progress * 0.5));
    mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, toYear === 2055 ? 0.8 : 0.4, progress * 0.5);
  });

  // Awnings
  eraObjects.awnings.forEach(mat => {
    mat.color.setHex(lerpColor(mat.color.getHex(), to.awning, progress));
  });

  // Signs
  eraObjects.signs.forEach(sign => {
    sign.material.emissive.setHex(lerpColor(sign.material.emissive.getHex(), to.signGlow, progress));
    sign.material.emissiveIntensity = THREE.MathUtils.lerp(sign.material.emissiveIntensity, toYear === 2055 ? 1.0 : 0.4, progress);
  });

  // Roofs
  eraObjects.roofs.forEach(mat => {
    mat.color.setHex(lerpColor(mat.color.getHex(), to.buildingAccent, progress));
  });

  // Lamp heads
  eraObjects.lampHeads.forEach(mat => {
    mat.emissive.setHex(lerpColor(mat.emissive.getHex(), toYear === 2055 ? 0x00ffff : 0xffddaa, progress));
    mat.color.setHex(lerpColor(mat.color.getHex(), toYear === 2055 ? 0x00ffff : 0xffeebb, progress));
  });

  // Tree canopies
  const treeColor = toYear === 2055 ? 0x00ff88 : toYear === 2025 ? 0x2d8a4e : 0x4a7c3f;
  eraObjects.treeCanopies.forEach(mat => {
    mat.color.setHex(lerpColor(mat.color.getHex(), treeColor, progress));
  });

  // Vehicle bodies
  eraObjects.vehicleBodies.forEach(mat => {
    mat.color.setHex(lerpColor(mat.color.getHex(), to.vehicle, progress));
    mat.metalness = THREE.MathUtils.lerp(mat.metalness, toYear === 2055 ? 0.9 : 0.6, progress);
  });

  // Vehicle cabins
  eraObjects.vehicleCabins.forEach(mat => {
    if (toYear === 2055) {
      mat.emissive.setHex(lerpColor(mat.emissive.getHex(), 0x0044aa, progress));
      mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, 0.3, progress);
    }
  });

  // Pedestrian materials
  const pedBodyColor = toYear === 1965 ? 0xcc3333 : toYear === 2005 ? 0x3366cc : toYear === 2025 ? 0x2ecc71 : 0x00ffff;
  const pedLegColor = toYear === 1965 ? 0x333366 : toYear === 2005 ? 0x222222 : toYear === 2025 ? 0x333333 : 0x111111;
  eraObjects.pedestrianMaterials.forEach(ped => {
    ped.body.color.setHex(lerpColor(ped.body.color.getHex(), pedBodyColor, progress));
    ped.legs.color.setHex(lerpColor(ped.legs.color.getHex(), pedLegColor, progress));
  });

  // Grass
  if (eraObjects.grass) {
    const grassColor = toYear === 2055 ? 0x00ff44 : toYear === 2025 ? 0x2d8a4e : 0x4a7c3f;
    eraObjects.grass.color.setHex(lerpColor(eraObjects.grass.color.getHex(), grassColor, progress));
  }

  // Particles
  if (eraObjects.particles) {
    const particleColor = toYear === 2055 ? 0x00ffff : toYear === 2025 ? 0xaaddff : 0xffeedd;
    eraObjects.particles.material.color.setHex(lerpColor(eraObjects.particles.material.color.getHex(), particleColor, progress));
    eraObjects.particles.material.opacity = THREE.MathUtils.lerp(eraObjects.particles.material.opacity, toYear === 2055 ? 0.8 : 0.6, progress);
  }

  // Tone mapping exposure
  renderer.toneMappingExposure = THREE.MathUtils.lerp(renderer.toneMappingExposure, toYear === 2055 ? 0.8 : 1.1, progress);

  // Flying vehicles visibility (2055 only)
  if (eraObjects.flyingVehicles) {
    const showFlying = toYear === 2055;
    eraObjects.flyingVehicles.forEach((flyer, i) => {
      // Fade in/out with delay
      const flyProgress = showFlying ? Math.max(0, (progress - 0.3) / 0.7) : 1 - progress;
      flyer.visible = flyProgress > 0.05;
      flyer.children.forEach(child => {
        if (child.material) {
          child.material.opacity = flyProgress;
          child.material.transparent = true;
        }
      });
    });
  }

  // Neon sign glow effect for 2055
  const neonIntensity = toYear === 2055 ? 1.5 : toYear === 2025 ? 0.8 : 0.4;
  eraObjects.signs.forEach(sign => {
    sign.material.emissiveIntensity = THREE.MathUtils.lerp(
      sign.material.emissiveIntensity,
      neonIntensity,
      progress * 0.3
    );
  });

  // Storefront display windows glow
  eraObjects.windows.forEach(mat => {
    if (mat.emissiveIntensity > 0.3) {
      mat.emissiveIntensity = THREE.MathUtils.lerp(
        mat.emissiveIntensity,
        toYear === 2055 ? 1.0 : 0.5,
        progress * 0.2
      );
    }
  });
}

// Era color palettes
const ERA_PALETTES = {
  1965: {
    sky: 0x87CEEB,
    ambient: 0xffeedd,
    buildingBase: 0xd4a574,
    buildingAccent: 0x8b4513,
    awning: 0xcc3333,
    vehicle: 0x228b22,
    signGlow: 0xff6b6b,
    description: "A nostalgic neighborhood with vintage charm and warm storefronts."
  },
  2005: {
    sky: 0x5b9bd5,
    ambient: 0xe8e8f0,
    buildingBase: 0xb0b0b0,
    buildingAccent: 0x4a4a4a,
    awning: 0x1e90ff,
    vehicle: 0x1a1a2e,
    signGlow: 0x00ff88,
    description: "A modernizing street corner with digital signs and contemporary life."
  },
  2025: {
    sky: 0x4a6fa5,
    ambient: 0xddeeff,
    buildingBase: 0x8899aa,
    buildingAccent: 0x2c3e50,
    awning: 0x2ecc71,
    vehicle: 0x1abc9c,
    signGlow: 0x00ffff,
    description: "A sustainable future with electric vehicles and smart city technology."
  },
  2055: {
    sky: 0x1a0a2e,
    ambient: 0x8866cc,
    buildingBase: 0x2d1b4e,
    buildingAccent: 0x00ffff,
    awning: 0xff00ff,
    vehicle: 0x00ffcc,
    signGlow: 0xff00ff,
    description: "A neon-lit futuristic block with holographic displays and flying vehicles."
  }
};

// ============================================================
// UI SYSTEM
// ============================================================

function setupUI() {
  setupTimeline();
  setupAudio();
  updateInfoPanel(YEARS[currentYearIndex]);
}

function setupTimeline() {
  const track = document.getElementById('timeline-track');
  const handle = document.getElementById('timeline-handle');
  const progress = document.getElementById('timeline-progress');
  const labels = document.querySelectorAll('.year-label');
  let isDragging = false;

  function snapToYear(clientX) {
    const rect = track.getBoundingClientRect();
    let ratio = (clientX - rect.left) / rect.width;
    ratio = Math.max(0, Math.min(1, ratio));

    const yearPositions = [0, 1/3, 2/3, 1];
    let closestIndex = 0;
    let closestDist = Infinity;

    yearPositions.forEach((pos, i) => {
      const dist = Math.abs(ratio - pos);
      if (dist < closestDist) {
        closestDist = dist;
        closestIndex = i;
      }
    });

    return closestIndex;
  }

  function updateTimelineUI(index) {
    const ratio = index / (YEARS.length - 1);
    handle.style.left = (ratio * 100) + '%';
    progress.style.width = (ratio * 100) + '%';
    document.getElementById('current-year-display').textContent = YEARS[index];

    labels.forEach(label => {
      const labelYear = parseInt(label.dataset.year);
      label.classList.toggle('active', labelYear === YEARS[index]);
    });
  }

  window.updateTimelineUI = updateTimelineUI;

  function handleStart(e) {
    isDragging = true;
    handle.style.transition = 'none';
    progress.style.transition = 'none';
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const index = snapToYear(clientX);
    setYear(index);
  }

  function handleMove(e) {
    if (!isDragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const index = snapToYear(clientX);
    if (YEARS[index] !== YEARS[targetYearIndex]) {
      setYear(index);
    }
  }

  function handleEnd() {
    isDragging = false;
    handle.style.transition = '';
    progress.style.transition = '';
  }

  // Mouse events
  handle.addEventListener('mousedown', handleStart);
  track.addEventListener('mousedown', handleStart);
  window.addEventListener('mousemove', handleMove);
  window.addEventListener('mouseup', handleEnd);

  // Touch events
  handle.addEventListener('touchstart', handleStart, { passive: true });
  track.addEventListener('touchstart', handleStart, { passive: true });
  window.addEventListener('touchmove', handleMove, { passive: true });
  window.addEventListener('touchend', handleEnd);

  // Click on year labels
  labels.forEach(label => {
    label.addEventListener('click', () => {
      const year = parseInt(label.dataset.year);
      const index = YEARS.indexOf(year);
      if (index >= 0) setYear(index);
    });
  });
}

function setupAudio() {
  const toggle = document.getElementById('audio-toggle');

  toggle.addEventListener('click', () => {
    if (!isPlaying) {
      initAudio();
      startLoFiMusic();
      isPlaying = true;
      toggle.classList.add('playing');
      toggle.querySelector('.label').textContent = 'Lo-Fi Beats ✓';
    } else {
      stopLoFiMusic();
      isPlaying = false;
      toggle.classList.remove('playing');
      toggle.querySelector('.label').textContent = 'Lo-Fi Beats';
    }
  });
}

function updateInfoPanel(year) {
  const title = document.getElementById('era-title');
  const desc = document.getElementById('era-description');
  const palette = ERA_PALETTES[year];

  title.textContent = `Cozy Corner, ${year}`;
  desc.textContent = palette.description;
}

// ============================================================
// AUDIO SYSTEM (Procedural Lo-Fi)
// ============================================================

function initAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

function startLoFiMusic() {
  if (!audioContext) initAudio();

  const masterGain = audioContext.createGain();
  masterGain.gain.value = 0.35;
  masterGain.connect(audioContext.destination);
  audioNodes.push({ node: masterGain, type: 'master' });

  // Low-pass filter for lo-fi warmth
  const lpFilter = audioContext.createBiquadFilter();
  lpFilter.type = 'lowpass';
  lpFilter.frequency.value = 1800;
  lpFilter.Q.value = 0.5;
  lpFilter.connect(masterGain);
  audioNodes.push({ node: lpFilter, type: 'filter' });

  createChordProgression(lpFilter);
  createDrumPattern(lpFilter);
  createAmbientTexture(masterGain);
}

function stopLoFiMusic() {
  audioNodes.forEach(({ node }) => {
    try {
      if (node.stop) node.stop();
      if (node.disconnect) node.disconnect();
    } catch (e) {}
  });
  audioNodes = [];
}

function createChordProgression(dest) {
  // Lo-fi jazz chord progression: Am7 - Fmaj7 - Dm7 - G7
  const chords = [
    [220, 261.63, 329.63, 392],    // Am7
    [174.61, 220, 261.63, 349.23], // Fmaj7
    [146.83, 174.61, 220, 261.63], // Dm7
    [196, 246.94, 293.66, 370]     // G7
  ];

  const tempo = 75; // BPM
  const chordLength = 60 / tempo * 4; // bars in seconds
  const now = audioContext.currentTime;

  function playChordSequence(startTime) {
    chords.forEach((chord, i) => {
      const chordStart = startTime + i * chordLength;

      chord.forEach((freq, j) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();

        osc.type = 'sine';
        osc.frequency.value = freq;

        // Slight detune for warmth
        osc.detune.value = (Math.random() - 0.5) * 8;

        gain.gain.setValueAtTime(0, chordStart);
        gain.gain.linearRampToValueAtTime(0.08, chordStart + 0.15);
        gain.gain.setValueAtTime(0.08, chordStart + chordLength - 0.3);
        gain.gain.linearRampToValueAtTime(0, chordStart + chordLength);

        osc.connect(gain);
        gain.connect(dest);

        osc.start(chordStart);
        osc.stop(chordStart + chordLength + 0.1);

        audioNodes.push({ node: osc, type: 'chord' });
      });
    });

    // Schedule next sequence
    const nextTime = startTime + chords.length * chordLength;
    const timeoutId = setTimeout(() => {
      playChordSequence(audioContext.currentTime);
    }, (nextTime - now) * 1000);
    audioNodes.push({ node: { stop: () => clearTimeout(timeoutId) }, type: 'timeout' });
  }

  playChordSequence(now);
}

function createDrumPattern(dest) {
  const tempo = 75;
  const beatLength = 60 / tempo;
  const now = audioContext.currentTime;

  function createKick(time) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(30, time + 0.15);

    gain.gain.setValueAtTime(0.25, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(time);
    osc.stop(time + 0.25);
    audioNodes.push({ node: osc, type: 'drum' });
  }

  function createSnare(time) {
    // Noise burst
    const bufferSize = audioContext.sampleRate * 0.1;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.3;
    }

    const noise = audioContext.createBufferSource();
    noise.buffer = buffer;

    const noiseGain = audioContext.createGain();
    noiseGain.gain.setValueAtTime(0.12, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

    const noiseFilter = audioContext.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1000;

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(dest);
    noise.start(time);
    noise.stop(time + 0.15);
    audioNodes.push({ node: noise, type: 'drum' });
  }

  function createHiHat(time) {
    const bufferSize = audioContext.sampleRate * 0.05;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.15;
    }

    const noise = audioContext.createBufferSource();
    noise.buffer = buffer;

    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.06, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

    const filter = audioContext.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 5000;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    noise.start(time);
    noise.stop(time + 0.06);
    audioNodes.push({ node: noise, type: 'drum' });
  }

  function playBeatSequence(startTime) {
    const beatsPerBar = 16;
    const sixteenth = beatLength / 4;

    // Pattern: kick on 0,4,8,12; snare on 4,12; hihat on every other
    const kickPattern = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    const snarePattern = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
    const hihatPattern = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1];

    for (let i = 0; i < beatsPerBar; i++) {
      const time = startTime + i * sixteenth;
      if (kickPattern[i]) createKick(time);
      if (snarePattern[i]) createSnare(time);
      if (hihatPattern[i]) createHiHat(time);
    }

    const barLength = beatLength * 4;
    const nextTime = startTime + barLength;
    const timeoutId = setTimeout(() => {
      playBeatSequence(audioContext.currentTime);
    }, (nextTime - now) * 1000);
    audioNodes.push({ node: { stop: () => clearTimeout(timeoutId) }, type: 'timeout' });
  }

  playBeatSequence(now);
}

function createAmbientTexture(dest) {
  // Vinyl crackle
  const bufferSize = audioContext.sampleRate * 2;
  const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    // Mostly quiet with occasional pops
    const r = Math.random();
    if (r < 0.001) {
      data[i] = (Math.random() - 0.5) * 0.3;
    } else if (r < 0.02) {
      data[i] = (Math.random() - 0.5) * 0.02;
    } else {
      data[i] = (Math.random() - 0.5) * 0.003;
    }
  }

  const crackle = audioContext.createBufferSource();
  crackle.buffer = buffer;
  crackle.loop = true;

  const crackleGain = audioContext.createGain();
  crackleGain.gain.value = 0.15;

  const crackleFilter = audioContext.createBiquadFilter();
  crackleFilter.type = 'bandpass';
  crackleFilter.frequency.value = 3000;
  crackleFilter.Q.value = 0.5;

  crackle.connect(crackleFilter);
  crackleFilter.connect(crackleGain);
  crackleGain.connect(dest);
  crackle.start();
  audioNodes.push({ node: crackle, type: 'ambient' });

  // Warm pad
  const padOsc1 = audioContext.createOscillator();
  const padOsc2 = audioContext.createOscillator();
  const padGain = audioContext.createGain();

  padOsc1.type = 'sine';
  padOsc1.frequency.value = 110; // A2
  padOsc1.detune.value = -3;

  padOsc2.type = 'sine';
  padOsc2.frequency.value = 110.5;
  padOsc2.detune.value = 3;

  padGain.gain.value = 0.03;

  padOsc1.connect(padGain);
  padOsc2.connect(padGain);
  padGain.connect(dest);

  padOsc1.start();
  padOsc2.start();
  audioNodes.push({ node: padOsc1, type: 'ambient' });
  audioNodes.push({ node: padOsc2, type: 'ambient' });
}

// ============================================================
// ANIMATION LOOP
// ============================================================

function startAnimationLoop() {
  animate();
}

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.getElapsedTime();

  controls.update();
  updateEraTransition(delta);
  updateAnimations(delta, elapsed);

  renderer.render(scene, camera);
}

function updateAnimations(delta, elapsed) {
  // Animate vehicles (slow movement along street)
  if (eraObjects.vehicles && eraObjects.vehiclePositions) {
    eraObjects.vehicles.forEach((vehicle, i) => {
      const pos = eraObjects.vehiclePositions[i];
      const moveAmount = Math.sin(elapsed * pos.speed + pos.offset) * 0.3;
      vehicle.position.z = pos.baseZ + moveAmount;

      // Subtle bob
      vehicle.position.y = 0.35 + Math.sin(elapsed * 2 + i) * 0.005;
    });
  }

  // Animate flying vehicles (2055)
  if (eraObjects.flyingVehicles && eraObjects.vehiclePositions) {
    const baseIndex = eraObjects.vehicles ? eraObjects.vehicles.length : 0;
    eraObjects.flyingVehicles.forEach((flyer, i) => {
      if (!flyer.visible) return;
      const pos = eraObjects.vehiclePositions[baseIndex + i];
      const moveAmount = Math.sin(elapsed * pos.speed + pos.offset) * 5;
      flyer.position.z = pos.baseZ + moveAmount;
      flyer.position.y = pos.baseY + Math.sin(elapsed * 0.8 + i) * 1.5;

      // Slight tilt when moving
      flyer.rotation.z = Math.cos(elapsed * pos.speed + pos.offset) * 0.1;
      flyer.rotation.x = Math.sin(elapsed * 1.2 + i) * 0.05;
    });
  }

  // Animate pedestrians (walking back and forth)
  if (eraObjects.pedestrians && eraObjects.pedestrianPaths) {
    eraObjects.pedestrians.forEach((ped, i) => {
      const path = eraObjects.pedestrianPaths[i];
      const walkAmount = Math.sin(elapsed * path.speed + path.offset) * path.range;
      ped.position.z = path.baseZ + walkAmount;

      // Face direction of movement
      const dir = Math.cos(elapsed * path.speed + path.offset);
      ped.rotation.y = dir > 0 ? 0 : Math.PI;

      // Subtle bob while walking
      ped.position.y = Math.abs(Math.sin(elapsed * 3 + i * 0.7)) * 0.05;
    });
  }

  // Animate particles (floating)
  if (eraObjects.particles) {
    const positions = eraObjects.particles.positions;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 1] -= delta * 0.3; // Float downward
      positions[i] += Math.sin(elapsed + i) * delta * 0.1; // Drift

      // Reset if below ground
      if (positions[i + 1] < 0) {
        positions[i + 1] = 15 + Math.random() * 5;
        positions[i] = (Math.random() - 0.5) * 40;
        positions[i + 2] = (Math.random() - 0.5) * 50;
      }
    }
    eraObjects.particles.mesh.geometry.attributes.position.needsUpdate = true;
  }

  // Subtle sign glow pulsing
  if (eraObjects.signs) {
    eraObjects.signs.forEach((sign, i) => {
      const pulse = 0.3 + Math.sin(elapsed * 1.5 + i * 0.8) * 0.1;
      sign.material.emissiveIntensity = THREE.MathUtils.lerp(
        sign.material.emissiveIntensity,
        pulse,
        delta * 2
      );
    });
  }

  // Gentle city group rotation for diorama feel
  if (cityGroup) {
    cityGroup.rotation.y = Math.sin(elapsed * 0.05) * 0.02;
  }
}

// ============================================================
// UTILITIES
// ============================================================

function hideLoading() {
  setTimeout(() => {
    const loading = document.getElementById('loading-screen');
    if (loading) loading.classList.add('hidden');
  }, 800);
}

function lerpColor(color1, color2, t) {
  const r1 = (color1 >> 16) & 0xff;
  const g1 = (color1 >> 8) & 0xff;
  const b1 = color1 & 0xff;

  const r2 = (color2 >> 16) & 0xff;
  const g2 = (color2 >> 8) & 0xff;
  const b2 = color2 & 0xff;

  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);

  return (r << 16) | (g << 8) | b;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ============================================================
// BOOT
// ============================================================

window.addEventListener('DOMContentLoaded', init);

// Expose state for testing
window.CityTimeMachine = {
  getYearIndex: () => currentYearIndex,
  setYearIndex: (i) => setYear(i),
  getTransitionProgress: () => transitionProgress,
  getEra: () => YEARS[currentYearIndex],
  isAudioPlaying: () => isPlaying,
  getAudioContext: () => audioContext
};
