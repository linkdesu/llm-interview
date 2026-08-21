/**
 * City Time Machine - 3D Diorama
 * A cozy miniature city with orbit/zoom controls and lo-fi soundtrack
 */

// ============================================================
// GLOBALS
// ============================================================
let scene, camera, renderer, controls;
let clock = new THREE.Clock();
let autoRotate = true;
let timeOfDay = 0; // 0=day, 0.5=dusk, 1=night, cycles
let musicPlaying = false;
let audioContext = null;
let musicNodes = [];

// Animation arrays
let pedestrians = [];
let vehicles = [];
let windowLights = [];
let lampposts = [];
let particles = [];

// ============================================================
// INITIALIZATION
// ============================================================
function init() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.FogExp2(0x87CEEB, 0.008);

    // Camera
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(35, 30, 35);

    // Renderer
    const canvas = document.getElementById('city-canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Orbit Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.minDistance = 10;
    controls.maxDistance = 80;
    controls.target.set(0, 2, 0);

    // Lighting
    setupLighting();

    // Build the city
    createGround();
    createRoads();
    createBuildings();
    createStorefronts();
    createVehicles();
    createPedestrians();
    createStreetFurniture();
    createTrees();
    createParticles();
    createSky();

    // Events
    window.addEventListener('resize', onWindowResize);
    setupUI();

    // Hide loading
    setTimeout(() => {
        document.getElementById('loading').classList.add('hidden');
    }, 1500);

    // Start animation loop
    animate();
}

// ============================================================
// LIGHTING
// ============================================================
function setupLighting() {
    // Ambient light (warm base)
    const ambient = new THREE.AmbientLight(0xffeedd, 0.4);
    scene.add(ambient);

    // Main directional light (sun)
    const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.0);
    sunLight.position.set(20, 30, 15);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 100;
    sunLight.shadow.camera.left = -40;
    sunLight.shadow.camera.right = 40;
    sunLight.shadow.camera.top = 40;
    sunLight.shadow.camera.bottom = -40;
    sunLight.shadow.bias = -0.001;
    scene.add(sunLight);

    // Fill light
    const fillLight = new THREE.DirectionalLight(0xc8d8f0, 0.3);
    fillLight.position.set(-15, 10, -10);
    scene.add(fillLight);

    // Hemisphere light for sky/ground color
    const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x8B7355, 0.3);
    scene.add(hemiLight);
}

// ============================================================
// GROUND
// ============================================================
function createGround() {
    // Main ground plane
    const groundGeo = new THREE.PlaneGeometry(100, 100);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x5a7247 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    scene.add(ground);

    // Sidewalks
    const sidewalkMat = new THREE.MeshLambertMaterial({ color: 0xb8a99a });
    
    // Horizontal sidewalks
    const hSidewalkGeo = new THREE.BoxGeometry(50, 0.02, 3);
    const hSidewalk1 = new THREE.Mesh(hSidewalkGeo, sidewalkMat);
    hSidewalk1.position.set(0, 0.01, 8);
    hSidewalk1.receiveShadow = true;
    scene.add(hSidewalk1);
    const hSidewalk2 = new THREE.Mesh(hSidewalkGeo, sidewalkMat);
    hSidewalk2.position.set(0, 0.01, -8);
    hSidewalk2.receiveShadow = true;
    scene.add(hSidewalk2);
    
    // Vertical sidewalks
    const vSidewalkGeo = new THREE.BoxGeometry(3, 0.02, 50);
    const vSidewalk1 = new THREE.Mesh(vSidewalkGeo, sidewalkMat);
    vSidewalk1.position.set(8, 0.01, 0);
    vSidewalk1.receiveShadow = true;
    scene.add(vSidewalk1);
    const vSidewalk2 = new THREE.Mesh(vSidewalkGeo, sidewalkMat);
    vSidewalk2.position.set(-8, 0.01, 0);
    vSidewalk2.receiveShadow = true;
    scene.add(vSidewalk2);
}

// ============================================================
// ROADS
// ============================================================
function createRoads() {
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });

    // Horizontal road
    const hRoad = new THREE.Mesh(new THREE.BoxGeometry(50, 0.02, 6), roadMat);
    hRoad.position.set(0, 0.02, 0);
    hRoad.receiveShadow = true;
    scene.add(hRoad);

    // Vertical road
    const vRoad = new THREE.Mesh(new THREE.BoxGeometry(6, 0.02, 50), roadMat);
    vRoad.position.set(0, 0.02, 0);
    vRoad.receiveShadow = true;
    scene.add(vRoad);

    // Road markings (dashed center lines)
    for (let i = -22; i < 22; i += 3) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 0.15), lineMat);
        line.position.set(i, 0.04, 0);
        scene.add(line);
    }
    for (let i = -22; i < 22; i += 3) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 1.5), lineMat);
        line.position.set(0, 0.04, i);
        scene.add(line);
    }
}

// ============================================================
// BUILDINGS
// ============================================================
function createBuildings() {
    // Building definitions - varied architecture
    const buildingDefs = [
        // Row 1 - North side
        { x: -18, z: -15, w: 6, h: 12, d: 6, style: 'brick', color: 0x8B4513, roof: 0x654321 },
        { x: -9, z: -15, w: 5, h: 8, d: 5, style: 'modern', color: 0x708090, roof: 0x2F4F4F },
        { x: -2, z: -15, w: 7, h: 15, d: 6, style: 'artdeco', color: 0xD2B48C, roof: 0x8B7355 },
        { x: 7, z: -15, w: 5, h: 10, d: 5, style: 'brick', color: 0xA0522D, roof: 0x654321 },
        { x: 15, z: -15, w: 6, h: 7, d: 6, style: 'modern', color: 0x808080, roof: 0x404040 },
        // Row 2 - South side
        { x: -18, z: 15, w: 6, h: 9, d: 6, style: 'victorian', color: 0xCD853F, roof: 0x8B0000 },
        { x: -9, z: 15, w: 5, h: 13, d: 5, style: 'brick', color: 0xB22222, roof: 0x654321 },
        { x: -2, z: 15, w: 6, h: 6, d: 6, style: 'modern', color: 0x4682B4, roof: 0x2F4F4F },
        { x: 7, z: 15, w: 7, h: 11, d: 5, style: 'artdeco', color: 0xDEB887, roof: 0x8B7355 },
        { x: 15, z: 15, w: 5, h: 8, d: 6, style: 'brick', color: 0x8B4513, roof: 0x654321 },
        // Extra buildings for depth
        { x: -22, z: -5, w: 5, h: 14, d: 5, style: 'modern', color: 0x696969, roof: 0x2F4F4F },
        { x: 22, z: -5, w: 6, h: 9, d: 5, style: 'brick', color: 0xA0522D, roof: 0x654321 },
        { x: -22, z: 5, w: 5, h: 7, d: 6, style: 'victorian', color: 0xD2691E, roof: 0x8B0000 },
        { x: 22, z: 5, w: 5, h: 12, d: 5, style: 'artdeco', color: 0xDAA520, roof: 0x8B7355 },
    ];

    buildingDefs.forEach(def => {
        createBuilding(def);
    });
}

function createBuilding(def) {
    const group = new THREE.Group();

    // Main structure
    const bodyGeo = new THREE.BoxGeometry(def.w, def.h, def.d);
    const bodyMat = new THREE.MeshLambertMaterial({ color: def.color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = def.h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Roof
    if (def.style === 'victorian') {
        const roofGeo = new THREE.ConeGeometry(Math.max(def.w, def.d) * 0.75, 3, 4);
        const roofMat = new THREE.MeshLambertMaterial({ color: def.roof });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.y = def.h + 1.5;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        group.add(roof);
    } else if (def.style === 'artdeco') {
        // Stepped roof
        for (let i = 0; i < 3; i++) {
            const stepW = def.w * (1 - i * 0.25);
            const stepD = def.d * (1 - i * 0.25);
            const stepGeo = new THREE.BoxGeometry(stepW, 1.5, stepD);
            const stepMat = new THREE.MeshLambertMaterial({ color: def.roof });
            const step = new THREE.Mesh(stepGeo, stepMat);
            step.position.y = def.h + 0.75 + i * 1.5;
            step.castShadow = true;
            group.add(step);
        }
    } else {
        // Flat roof with parapet
        const parapetGeo = new THREE.BoxGeometry(def.w + 0.4, 1, def.d + 0.4);
        const parapetMat = new THREE.MeshLambertMaterial({ color: def.roof });
        const parapet = new THREE.Mesh(parapetGeo, parapetMat);
        parapet.position.y = def.h + 0.5;
        parapet.castShadow = true;
        group.add(parapet);
    }

    // Windows
    createWindows(group, def);

    // Position
    group.position.set(def.x, 0, def.z);
    scene.add(group);
}

function createWindows(group, def) {
    const windowMat = new THREE.MeshBasicMaterial({ color: 0x87CEEB });
    const windowFrameMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const litWindowMat = new THREE.MeshBasicMaterial({ color: 0xffeeaa });

    const floors = Math.floor(def.h / 3);
    const windowsPerSide = Math.floor(def.w / 2.2);
    const winSize = 0.8;

    // Front and back faces
    [1, -1].forEach(zDir => {
        for (let floor = 0; floor < floors; floor++) {
            for (let w = 0; w < windowsPerSide; w++) {
                const xOff = -def.w / 2 + 1.2 + w * 2.2;
                const yOff = 2 + floor * 3;

                // Window glass only (skip frames for performance)
                const winGeo = new THREE.BoxGeometry(winSize, winSize, 0.05);
                const isLit = Math.random() > 0.4;
                const win = new THREE.Mesh(winGeo, isLit ? litWindowMat : windowMat);
                win.position.set(xOff, yOff, zDir * (def.d / 2 + 0.1));
                group.add(win);

                if (isLit) {
                    windowLights.push({ mesh: win, baseColor: 0xffeeaa, phase: Math.random() * Math.PI * 2 });
                }
            }
        }
    });

    // Side faces
    const windowsPerSide2 = Math.floor(def.d / 2.2);
    [1, -1].forEach(xDir => {
        for (let floor = 0; floor < floors; floor++) {
            for (let w = 0; w < windowsPerSide2; w++) {
                const zOff = -def.d / 2 + 1.2 + w * 2.2;
                const yOff = 2 + floor * 3;

                const winGeo = new THREE.BoxGeometry(0.05, winSize, winSize);
                const isLit = Math.random() > 0.4;
                const win = new THREE.Mesh(winGeo, isLit ? litWindowMat : windowMat);
                win.position.set(xDir * (def.w / 2 + 0.1), yOff, zOff);
                group.add(win);

                if (isLit) {
                    windowLights.push({ mesh: win, baseColor: 0xffeeaa, phase: Math.random() * Math.PI * 2 });
                }
            }
        }
    });
}

// ============================================================
// STOREFRONTS
// ============================================================
function createStorefronts() {
    // Ground floor shop fronts on select buildings
    const shops = [
        { x: -18, z: -11.9, rot: 0, type: 'bakery', name: 'Sweet Rolls', color: 0xFFB6C1 },
        { x: -9, z: -11.9, rot: 0, type: 'bookstore', name: 'Page Turners', color: 0x8FBC8F },
        { x: 7, z: -11.9, rot: 0, type: 'cafe', name: 'Warm Cup', color: 0xDEB887 },
        { x: -18, z: 11.9, rot: Math.PI, type: 'flower', name: 'Bloom', color: 0xDDA0DD },
        { x: -9, z: 11.9, rot: Math.PI, type: 'cafe', name: 'Morning Brew', color: 0xD2B48C },
        { x: 7, z: 11.9, rot: Math.PI, type: 'bakery', name: 'Crust & Crumb', color: 0xFFB6C1 },
    ];

    shops.forEach(shop => {
        createShop(shop);
    });
}

function createShop(shop) {
    const group = new THREE.Group();

    // Awning (single mesh)
    const awningGeo = new THREE.BoxGeometry(4, 0.15, 1.5);
    const awningMat = new THREE.MeshLambertMaterial({ color: shop.color });
    const awning = new THREE.Mesh(awningGeo, awningMat);
    awning.position.set(0, 3.5, 0.5);
    awning.castShadow = true;
    group.add(awning);

    // Sign board
    const signGeo = new THREE.BoxGeometry(3, 0.8, 0.1);
    const signMat = new THREE.MeshLambertMaterial({ color: 0x2F4F4F });
    const sign = new THREE.Mesh(signGeo, signMat);
    sign.position.set(0, 4.2, 0.05);
    group.add(sign);

    // Door
    const doorGeo = new THREE.BoxGeometry(1, 2.5, 0.1);
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x654321 });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 1.25, 0.05);
    group.add(door);

    // Door handle
    const handleGeo = new THREE.SphereGeometry(0.08, 6, 6);
    const handleMat = new THREE.MeshBasicMaterial({ color: 0xFFD700 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.set(0.3, 1.3, 0.12);
    group.add(handle);

    // Display window
    const displayGeo = new THREE.BoxGeometry(1.2, 1.5, 0.05);
    const displayMat = new THREE.MeshBasicMaterial({ color: 0x87CEEB, transparent: true, opacity: 0.4 });
    const display = new THREE.Mesh(displayGeo, displayMat);
    display.position.set(-0.9, 1.5, 0.05);
    group.add(display);

    // Item in display
    if (shop.type === 'bakery') {
        const itemGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.3, 6);
        const itemMat = new THREE.MeshLambertMaterial({ color: 0xDEB887 });
        const item = new THREE.Mesh(itemGeo, itemMat);
        item.position.set(-0.9, 1.0, 0.15);
        group.add(item);
    } else if (shop.type === 'flower') {
        const potGeo = new THREE.CylinderGeometry(0.2, 0.15, 0.3, 6);
        const potMat = new THREE.MeshLambertMaterial({ color: 0xCD853F });
        const pot = new THREE.Mesh(potGeo, potMat);
        pot.position.set(-0.9, 1.0, 0.15);
        group.add(pot);
        
        const flowerGeo = new THREE.SphereGeometry(0.15, 6, 6);
        const flowerMat = new THREE.MeshLambertMaterial({ color: 0xFF69B4 });
        const flower = new THREE.Mesh(flowerGeo, flowerMat);
        flower.position.set(-0.9, 1.3, 0.15);
        group.add(flower);
    }

    group.position.set(shop.x, 0, shop.z);
    group.rotation.y = shop.rot;
    scene.add(group);
}

// ============================================================
// VEHICLES
// ============================================================
function createVehicles() {
    const carColors = [0xCC3333, 0x3366CC, 0x33CC33, 0xFFCC00, 0x9933FF, 0xFF9933, 0xCCCCCC];
    
    // Cars on horizontal road
    for (let i = 0; i < 5; i++) {
        const car = createCar(carColors[i % carColors.length]);
        car.position.set(-18 + i * 9, 0.3, -1.5 + (i % 2) * 3);
        car.rotation.y = Math.PI / 2;
        scene.add(car);
        vehicles.push({
            mesh: car,
            speed: 0.01 + Math.random() * 0.01,
            axis: 'x',
            direction: i % 2 === 0 ? 1 : -1,
            min: -22,
            max: 22
        });
    }

    // Cars on vertical road
    for (let i = 0; i < 3; i++) {
        const car = createCar(carColors[(i + 3) % carColors.length]);
        car.position.set(-1.5 + (i % 2) * 3, 0.3, -15 + i * 10);
        scene.add(car);
        vehicles.push({
            mesh: car,
            speed: 0.008 + Math.random() * 0.008,
            axis: 'z',
            direction: i % 2 === 0 ? 1 : -1,
            min: -20,
            max: 20
        });
    }

    // Bus
    const bus = createBus();
    bus.position.set(5, 0.4, 1.5);
    bus.rotation.y = Math.PI / 2;
    scene.add(bus);
    vehicles.push({
        mesh: bus,
        speed: 0.006,
        axis: 'x',
        direction: 1,
        min: -20,
        max: 20
    });
}

function createCar(color) {
    const group = new THREE.Group();

    // Body (single mesh for performance)
    const bodyGeo = new THREE.BoxGeometry(2, 0.8, 1);
    const bodyMat = new THREE.MeshLambertMaterial({ color: color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.4;
    body.castShadow = true;
    group.add(body);

    // Roof
    const roofGeo = new THREE.BoxGeometry(1.2, 0.6, 0.9);
    const roof = new THREE.Mesh(roofGeo, bodyMat);
    roof.position.set(-0.1, 1.0, 0);
    roof.castShadow = true;
    group.add(roof);

    // Windshield
    const windGeo = new THREE.BoxGeometry(0.05, 0.5, 0.85);
    const windMat = new THREE.MeshBasicMaterial({ color: 0x87CEEB, transparent: true, opacity: 0.5 });
    const wind = new THREE.Mesh(windGeo, windMat);
    wind.position.set(0.55, 0.9, 0);
    wind.rotation.z = -0.2;
    group.add(wind);

    // Wheels (shared geometry)
    const wheelGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.1, 8);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    [[-0.6, 0.2, 0.5], [-0.6, 0.2, -0.5], [0.6, 0.2, 0.5], [0.6, 0.2, -0.5]].forEach(pos => {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.position.set(...pos);
        wheel.rotation.x = Math.PI / 2;
        group.add(wheel);
    });

    // Headlights & taillights (single mesh each)
    const hlGeo = new THREE.BoxGeometry(0.1, 0.15, 0.6);
    const hlMat = new THREE.MeshBasicMaterial({ color: 0xFFFFCC });
    const hl = new THREE.Mesh(hlGeo, hlMat);
    hl.position.set(1.0, 0.5, 0);
    group.add(hl);
    
    const tlMat = new THREE.MeshBasicMaterial({ color: 0xFF3333 });
    const tl = new THREE.Mesh(hlGeo, tlMat);
    tl.position.set(-1.0, 0.5, 0);
    group.add(tl);

    return group;
}

function createBus() {
    const group = new THREE.Group();

    // Body
    const bodyGeo = new THREE.BoxGeometry(3.5, 1.4, 1.2);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xFFCC00 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.7;
    body.castShadow = true;
    group.add(body);

    // Windows row (single mesh)
    const winGeo = new THREE.BoxGeometry(3.3, 0.5, 1.25);
    const winMat = new THREE.MeshBasicMaterial({ color: 0x87CEEB, transparent: true, opacity: 0.5 });
    const win = new THREE.Mesh(winGeo, winMat);
    win.position.set(0, 1.1, 0);
    group.add(win);

    // Wheels (shared)
    const wheelGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.15, 8);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    [[-1.2, 0.25, 0.65], [-1.2, 0.25, -0.65], [1.2, 0.25, 0.65], [1.2, 0.25, -0.65]].forEach(pos => {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.position.set(...pos);
        wheel.rotation.x = Math.PI / 2;
        group.add(wheel);
    });

    return group;
}

// ============================================================
// PEDESTRIANS
// ============================================================
function createPedestrians() {
    const outfitColors = [
        { top: 0xCC4444, bottom: 0x333366, skin: 0xFFDBAC },
        { top: 0x4466CC, bottom: 0x444444, skin: 0xF5CBA7 },
        { top: 0x44AA44, bottom: 0x8B7355, skin: 0xFFDBAC },
        { top: 0xFF8844, bottom: 0x333333, skin: 0xE8C39E },
        { top: 0x8844AA, bottom: 0x555555, skin: 0xFFDBAC },
        { top: 0x2288AA, bottom: 0x444466, skin: 0xF5CBA7 },
        { top: 0xDD6688, bottom: 0x666666, skin: 0xE8C39E },
        { top: 0xAA8844, bottom: 0x334433, skin: 0xFFDBAC },
    ];

    for (let i = 0; i < 8; i++) {
        const ped = createPedestrian(outfitColors[i % outfitColors.length]);
        const side = Math.floor(Math.random() * 4);
        let x, z, rot;
        
        switch (side) {
            case 0: // North sidewalk
                x = -15 + Math.random() * 30;
                z = 9.5 + Math.random() * 1.5;
                rot = Math.random() > 0.5 ? 0 : Math.PI;
                break;
            case 1: // South sidewalk
                x = -15 + Math.random() * 30;
                z = -9.5 - Math.random() * 1.5;
                rot = Math.random() > 0.5 ? Math.PI : 0;
                break;
            case 2: // East sidewalk
                x = 9.5 + Math.random() * 1.5;
                z = -15 + Math.random() * 30;
                rot = Math.random() > 0.5 ? -Math.PI / 2 : Math.PI / 2;
                break;
            case 3: // West sidewalk
                x = -9.5 - Math.random() * 1.5;
                z = -15 + Math.random() * 30;
                rot = Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2;
                break;
        }

        ped.position.set(x, 0, z);
        ped.rotation.y = rot;
        scene.add(ped);
        
        pedestrians.push({
            mesh: ped,
            speed: 0.003 + Math.random() * 0.005,
            direction: rot,
            turnTimer: Math.random() * 200,
            turnInterval: 100 + Math.random() * 200,
            sidewalk: side,
            range: { min: -18, max: 18 }
        });
    }
}

function createPedestrian(colors) {
    const group = new THREE.Group();

    // Body (torso + head as single group)
    const bodyGeo = new THREE.BoxGeometry(0.5, 0.7, 0.3);
    const bodyMat = new THREE.MeshLambertMaterial({ color: colors.top });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.1;
    body.castShadow = true;
    body.name = 'body';
    group.add(body);

    // Head
    const headGeo = new THREE.SphereGeometry(0.22, 8, 8);
    const headMat = new THREE.MeshLambertMaterial({ color: colors.skin });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.65;
    head.castShadow = true;
    head.name = 'head';
    group.add(head);

    // Legs (combined into single mesh for performance)
    const legGeo = new THREE.BoxGeometry(0.4, 0.7, 0.25);
    const legMat = new THREE.MeshLambertMaterial({ color: colors.bottom });
    const legs = new THREE.Mesh(legGeo, legMat);
    legs.position.y = 0.35;
    legs.name = 'legs';
    group.add(legs);

    // Arms (combined)
    const armGeo = new THREE.BoxGeometry(0.7, 0.6, 0.15);
    const arms = new THREE.Mesh(armGeo, bodyMat);
    arms.position.set(0, 1.0, 0);
    arms.name = 'arms';
    group.add(arms);

    return group;
}

// ============================================================
// STREET FURNITURE
// ============================================================
function createStreetFurniture() {
    // Lampposts
    const lamppostPositions = [
        [-5, 9.5], [5, 9.5], [-5, -9.5], [5, -9.5],
        [-15, 9.5], [15, 9.5], [-15, -9.5], [15, -9.5],
    ];

    lamppostPositions.forEach(pos => {
        createLamppost(pos[0], pos[1]);
    });

    // Benches
    const benchPositions = [
        [-12, 10.5], [12, 10.5], [-12, -10.5], [12, -10.5],
    ];
    benchPositions.forEach(pos => {
        createBench(pos[0], pos[1]);
    });

    // Fire hydrants
    const hydrantPositions = [
        [-7, 10.5], [7, 10.5], [-7, -10.5], [7, -10.5],
    ];
    hydrantPositions.forEach(pos => {
        createFireHydrant(pos[0], pos[1]);
    });

    // Mailboxes
    createMailbox(-3, 10.5);
    createMailbox(3, -10.5);
}

function createLamppost(x, z) {
    const group = new THREE.Group();

    // Pole
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 4, 6);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 2;
    pole.castShadow = true;
    group.add(pole);

    // Arm
    const armGeo = new THREE.BoxGeometry(1.2, 0.06, 0.06);
    const arm = new THREE.Mesh(armGeo, poleMat);
    arm.position.set(0.5, 3.9, 0);
    group.add(arm);

    // Lamp head (emissive, no actual light)
    const lampGeo = new THREE.SphereGeometry(0.2, 6, 6);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xFFFFAA });
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(1, 3.85, 0);
    group.add(lamp);

    // Glow
    const glowGeo = new THREE.SphereGeometry(0.3, 6, 6);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xFFFFAA, transparent: true, opacity: 0.2 });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.set(1, 3.85, 0);
    group.add(glow);

    group.position.set(x, 0, z);
    scene.add(group);
    lampposts.push({ group, lamp, glow });
}

function createBench(x, z) {
    const group = new THREE.Group();
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
    const metalMat = new THREE.MeshLambertMaterial({ color: 0x333333 });

    // Seat
    const seatGeo = new THREE.BoxGeometry(1.5, 0.08, 0.5);
    const seat = new THREE.Mesh(seatGeo, woodMat);
    seat.position.y = 0.5;
    group.add(seat);

    // Back
    const backGeo = new THREE.BoxGeometry(1.5, 0.5, 0.06);
    const back = new THREE.Mesh(backGeo, woodMat);
    back.position.set(0, 0.8, -0.22);
    group.add(back);

    // Legs
    [[-0.6, 0.25, 0.15], [-0.6, 0.25, -0.15], [0.6, 0.25, 0.15], [0.6, 0.25, -0.15]].forEach(pos => {
        const legGeo = new THREE.BoxGeometry(0.06, 0.5, 0.06);
        const leg = new THREE.Mesh(legGeo, metalMat);
        leg.position.set(...pos);
        group.add(leg);
    });

    group.position.set(x, 0, z);
    group.rotation.y = Math.random() * Math.PI;
    scene.add(group);
}

function createFireHydrant(x, z) {
    const group = new THREE.Group();
    const hydrantMat = new THREE.MeshLambertMaterial({ color: 0xCC2200 });

    const bodyGeo = new THREE.CylinderGeometry(0.15, 0.18, 0.6, 8);
    const body = new THREE.Mesh(bodyGeo, hydrantMat);
    body.position.y = 0.3;
    group.add(body);

    const topGeo = new THREE.SphereGeometry(0.12, 8, 8);
    const top = new THREE.Mesh(topGeo, hydrantMat);
    top.position.y = 0.65;
    group.add(top);

    group.position.set(x, 0, z);
    scene.add(group);
}

function createMailbox(x, z) {
    const group = new THREE.Group();
    const mbMat = new THREE.MeshLambertMaterial({ color: 0x0044AA });

    const bodyGeo = new THREE.BoxGeometry(0.5, 0.7, 0.3);
    const body = new THREE.Mesh(bodyGeo, mbMat);
    body.position.y = 0.55;
    group.add(body);

    const topGeo = new THREE.CylinderGeometry(0.25, 0.3, 0.15, 8);
    const top = new THREE.Mesh(topGeo, mbMat);
    top.position.y = 0.95;
    group.add(top);

    const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6);
    const pole = new THREE.Mesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x666666 }));
    pole.position.y = 0.15;
    group.add(pole);

    group.position.set(x, 0, z);
    scene.add(group);
}

// ============================================================
// TREES
// ============================================================
function createTrees() {
    const treePositions = [
        [-14, 11], [-6, 11], [6, 11], [14, 11],
        [-14, -11], [-6, -11], [6, -11], [14, -11],
        [11, -14], [11, 14], [-11, -14], [-11, 14],
    ];

    treePositions.forEach(pos => {
        createTree(pos[0], pos[1]);
    });
}

function createTree(x, z) {
    const group = new THREE.Group();

    // Trunk
    const trunkH = 1.5 + Math.random() * 1;
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, trunkH, 8);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);

    // Foliage layers
    const foliageColors = [0x228B22, 0x2E8B57, 0x32CD32, 0x006400];
    const layers = 2 + Math.floor(Math.random() * 2);
    
    for (let i = 0; i < layers; i++) {
        const radius = 1.2 - i * 0.25 + Math.random() * 0.3;
        const foliageGeo = new THREE.SphereGeometry(radius, 8, 8);
        const foliageMat = new THREE.MeshLambertMaterial({ 
            color: foliageColors[Math.floor(Math.random() * foliageColors.length)] 
        });
        const foliage = new THREE.Mesh(foliageGeo, foliageMat);
        foliage.position.y = trunkH + 0.5 + i * 0.8;
        foliage.castShadow = true;
        group.add(foliage);
    }

    group.position.set(x, 0, z);
    scene.add(group);
}

// ============================================================
// PARTICLES (floating dust/pollen)
// ============================================================
function createParticles() {
    const count = 100;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 50;
        positions[i * 3 + 1] = Math.random() * 15;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 50;

        const warmth = 0.8 + Math.random() * 0.2;
        colors[i * 3] = warmth;
        colors[i * 3 + 1] = warmth * 0.9;
        colors[i * 3 + 2] = warmth * 0.6;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
        size: 0.1,
        vertexColors: true,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
    });

    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    particles.push(pts);
}

// ============================================================
// SKY
// ============================================================
function createSky() {
    // Sun sphere
    const sunGeo = new THREE.SphereGeometry(2, 16, 16);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xFFDD44 });
    const sun = new THREE.Mesh(sunGeo, sunMat);
    sun.position.set(25, 35, 20);
    scene.add(sun);

    // Clouds
    for (let i = 0; i < 8; i++) {
        createCloud(
            (Math.random() - 0.5) * 60,
            20 + Math.random() * 10,
            (Math.random() - 0.5) * 60
        );
    }
}

function createCloud(x, y, z) {
    const group = new THREE.Group();
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.85 });

    const blobCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < blobCount; i++) {
        const r = 1 + Math.random() * 1.5;
        const geo = new THREE.SphereGeometry(r, 8, 8);
        const blob = new THREE.Mesh(geo, cloudMat);
        blob.position.set(i * 1.2 - blobCount * 0.6, Math.random() * 0.5, Math.random() * 0.8);
        blob.scale.y = 0.6;
        group.add(blob);
    }

    group.position.set(x, y, z);
    scene.add(group);
}

// ============================================================
// ANIMATION LOOP
// ============================================================
function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    const elapsed = clock.getElapsedTime();

    // Update controls
    controls.update();

    // Auto-rotate
    if (autoRotate) {
        scene.rotation.y += 0.0005;
    }

    // Time of day cycle
    timeOfDay = (Math.sin(elapsed * 0.05) + 1) / 2; // 0 to 1
    updateTimeOfDay(elapsed);

    // Animate pedestrians
    animatePedestrians(elapsed);

    // Animate vehicles
    animateVehicles(elapsed);

    // Animate window lights
    animateWindowLights(elapsed);

    // Animate lampposts
    animateLampposts(elapsed);

    // Animate particles
    animateParticles(elapsed);

    // Render
    renderer.render(scene, camera);
}

function updateTimeOfDay(elapsed) {
    const t = timeOfDay;
    
    // Sky color interpolation
    const dayColor = new THREE.Color(0x87CEEB);
    const duskColor = new THREE.Color(0xFF8C42);
    const nightColor = new THREE.Color(0x0a0a2e);
    
    let skyColor;
    if (t < 0.5) {
        skyColor = dayColor.clone().lerp(duskColor, t * 2);
    } else {
        skyColor = duskColor.clone().lerp(nightColor, (t - 0.5) * 2);
    }
    
    scene.background = skyColor;
    scene.fog.color = skyColor;

    // Adjust lighting
    const sunLight = scene.children.find(c => c.isDirectionalLight && c.castShadow);
    if (sunLight) {
        sunLight.intensity = Math.max(0.1, 1.0 - t * 1.5);
    }

    const ambient = scene.children.find(c => c.isAmbientLight);
    if (ambient) {
        ambient.intensity = 0.4 - t * 0.2;
    }

    // Lamppost glow
    lampposts.forEach(lp => {
        lp.lamp.material.color.setHex(t > 0.3 ? 0xFFFFAA : 0xAAAAAA);
        lp.glow.material.opacity = t > 0.3 ? 0.3 : 0.05;
    });
}

function animatePedestrians(elapsed) {
    pedestrians.forEach(ped => {
        ped.turnTimer += 1;
        
        if (ped.turnTimer > ped.turnInterval) {
            ped.turnTimer = 0;
            ped.turnInterval = 100 + Math.random() * 200;
            
            // Occasionally change direction
            if (Math.random() > 0.7) {
                ped.direction += (Math.random() > 0.5 ? 1 : -1) * Math.PI / 2;
                ped.mesh.rotation.y = ped.direction;
            }
        }

        // Walk forward
        const moveX = Math.sin(ped.direction) * ped.speed;
        const moveZ = Math.cos(ped.direction) * ped.speed;
        
        ped.mesh.position.x += moveX;
        ped.mesh.position.z += moveZ;

        // Keep on sidewalk
        const pos = ped.mesh.position;
        if (pos.x < ped.range.min) { pos.x = ped.range.min; ped.direction = Math.PI - ped.direction; }
        if (pos.x > ped.range.max) { pos.x = ped.range.max; ped.direction = Math.PI - ped.direction; }
        if (pos.z < ped.range.min) { pos.z = ped.range.min; ped.direction = -ped.direction; }
        if (pos.z > ped.range.max) { pos.z = ped.range.max; ped.direction = -ped.direction; }

        // Walking animation (subtle bob)
        const walkCycle = Math.sin(elapsed * 5 + ped.mesh.id) * 0.05;
        const body = ped.mesh.getObjectByName('body');
        const head = ped.mesh.getObjectByName('head');
        if (body) body.position.y = 1.1 + walkCycle;
        if (head) head.position.y = 1.65 + walkCycle * 1.5;
    });
}

function animateVehicles(elapsed) {
    vehicles.forEach(veh => {
        veh.mesh.position[veh.axis] += veh.speed * veh.direction;
        
        if (veh.mesh.position[veh.axis] > veh.max) {
            veh.mesh.position[veh.axis] = veh.min;
        } else if (veh.mesh.position[veh.axis] < veh.min) {
            veh.mesh.position[veh.axis] = veh.max;
        }
    });
}

function animateWindowLights(elapsed) {
    windowLights.forEach(wl => {
        const flicker = Math.sin(elapsed * 2 + wl.phase) * 0.1 + 0.9;
        wl.mesh.material.color.setHex(wl.baseColor);
        wl.mesh.material.opacity = flicker;
    });
}

function animateLampposts(elapsed) {
    lampposts.forEach(lp => {
        lp.glow.scale.setScalar(1 + Math.sin(elapsed * 3) * 0.1);
    });
}

function animateParticles(elapsed) {
    particles.forEach(pts => {
        const positions = pts.geometry.attributes.position.array;
        for (let i = 0; i < positions.length; i += 3) {
            positions[i + 1] += Math.sin(elapsed + i) * 0.002;
            positions[i] += Math.cos(elapsed * 0.5 + i * 0.1) * 0.001;
            
            if (positions[i + 1] > 15) positions[i + 1] = 0;
        }
        pts.geometry.attributes.position.needsUpdate = true;
    });
}

// ============================================================
// LO-FI MUSIC (Web Audio API)
// ============================================================
function initAudio() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
}

function startMusic() {
    if (!audioContext) initAudio();
    if (audioContext.state === 'suspended') audioContext.resume();
    if (musicPlaying) return;
    musicPlaying = true;

    // Lo-fi chord progression (jazz-ish)
    const chords = [
        [261.63, 329.63, 392.00, 466.16],  // Cmaj7
        [220.00, 277.18, 329.63, 415.30],  // Am7
        [196.00, 246.94, 293.66, 369.99],  // G7
        [174.61, 220.00, 261.63, 329.63],  // Fmaj7
    ];

    const tempo = 0.8; // Slow, relaxed
    let chordIndex = 0;

    function playChord() {
        if (!musicPlaying) return;

        const chord = chords[chordIndex % chords.length];
        const now = audioContext.currentTime;

        // Pad sound (warm, filtered)
        chord.forEach(freq => {
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            const filter = audioContext.createBiquadFilter();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now);
            
            // Slight detune for warmth
            osc.detune.setValueAtTime((Math.random() - 0.5) * 10, now);

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(800, now);
            filter.Q.setValueAtTime(1, now);

            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.06, now + 1);
            gain.gain.linearRampToValueAtTime(0.04, now + 3);
            gain.gain.linearRampToValueAtTime(0, now + 4);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(audioContext.destination);

            osc.start(now);
            osc.stop(now + 4.5);

            musicNodes.push(osc);
        });

        // Melody note (pentatonic)
        const melodyNotes = [523.25, 587.33, 659.25, 783.99, 880.00, 783.99, 659.25, 587.33];
        const melodyFreq = melodyNotes[Math.floor(Math.random() * melodyNotes.length)];
        
        const melOsc = audioContext.createOscillator();
        const melGain = audioContext.createGain();
        const melFilter = audioContext.createBiquadFilter();

        melOsc.type = 'triangle';
        melOsc.frequency.setValueAtTime(melodyFreq, now);
        
        melFilter.type = 'lowpass';
        melFilter.frequency.setValueAtTime(1200, now);

        melGain.gain.setValueAtTime(0, now + 0.5);
        melGain.gain.linearRampToValueAtTime(0.04, now + 0.8);
        melGain.gain.linearRampToValueAtTime(0, now + 2.5);

        melOsc.connect(melFilter);
        melFilter.connect(melGain);
        melGain.connect(audioContext.destination);

        melOsc.start(now + 0.5);
        melOsc.stop(now + 3);

        musicNodes.push(melOsc);

        // Soft percussion (brushed snare simulation)
        if (Math.random() > 0.3) {
            playNoiseHit(now, 0.02);
        }

        chordIndex++;
        setTimeout(playChord, 4000 * tempo);
    }

    function playNoiseHit(time, volume) {
        const bufferSize = audioContext.sampleRate * 0.05;
        const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * volume;
        }

        const noise = audioContext.createBufferSource();
        noise.buffer = buffer;

        const noiseGain = audioContext.createGain();
        noiseGain.gain.setValueAtTime(volume, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

        const noiseFilter = audioContext.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.setValueAtTime(3000, time);
        noiseFilter.Q.setValueAtTime(2, time);

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(audioContext.destination);

        noise.start(time);
        musicNodes.push(noise);
    }

    // Bass line
    function playBass() {
        if (!musicPlaying) return;
        
        const bassNotes = [130.81, 110.00, 98.00, 87.31];
        const now = audioContext.currentTime;
        const freq = bassNotes[chordIndex % bassNotes.length];

        const bassOsc = audioContext.createOscillator();
        const bassGain = audioContext.createGain();
        const bassFilter = audioContext.createBiquadFilter();

        bassOsc.type = 'sine';
        bassOsc.frequency.setValueAtTime(freq, now);

        bassFilter.type = 'lowpass';
        bassFilter.frequency.setValueAtTime(300, now);

        bassGain.gain.setValueAtTime(0, now);
        bassGain.gain.linearRampToValueAtTime(0.08, now + 0.3);
        bassGain.gain.linearRampToValueAtTime(0, now + 3.5);

        bassOsc.connect(bassFilter);
        bassFilter.connect(bassGain);
        bassGain.connect(audioContext.destination);

        bassOsc.start(now);
        bassOsc.stop(now + 4);

        musicNodes.push(bassOsc);
        chordIndex++;
        setTimeout(playBass, 4000 * tempo);
    }

    playChord();
    setTimeout(playBass, 500);
}

function stopMusic() {
    musicPlaying = false;
    musicNodes.forEach(node => {
        try { node.stop(); } catch(e) {}
    });
    musicNodes = [];
}

// ============================================================
// UI
// ============================================================
function setupUI() {
    // Play/Pause music
    document.getElementById('play-btn').addEventListener('click', () => {
        if (musicPlaying) {
            stopMusic();
            document.getElementById('play-btn').querySelector('.text').textContent = 'Play Music';
            document.getElementById('play-btn').classList.remove('active');
        } else {
            startMusic();
            document.getElementById('play-btn').querySelector('.text').textContent = 'Pause Music';
            document.getElementById('play-btn').classList.add('active');
        }
    });

    // Auto-rotate toggle
    document.getElementById('auto-rotate-btn').addEventListener('click', () => {
        autoRotate = !autoRotate;
        document.getElementById('auto-rotate-btn').classList.toggle('active');
    });

    // Time of day cycle
    document.getElementById('time-btn').addEventListener('click', () => {
        // Snap to next time of day
        const times = [0, 0.5, 1.0, 0.25];
        const labels = ['Morning', 'Dusk', 'Night', 'Afternoon'];
        const icons = ['🌅', '🌇', '🌙', '☀️'];
        
        // Find current index
        const currentIdx = times.findIndex((t, i) => {
            const nextT = times[(i + 1) % times.length];
            return timeOfDay >= t && timeOfDay < nextT;
        });
        const nextIdx = (currentIdx + 1) % times.length;
        
        // Quick transition
        document.getElementById('time-btn').querySelector('.icon').textContent = icons[nextIdx];
    });

    // Reset view
    document.getElementById('reset-btn').addEventListener('click', () => {
        camera.position.set(35, 30, 35);
        controls.target.set(0, 2, 0);
        controls.update();
    });
}

// ============================================================
// RESIZE
// ============================================================
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ============================================================
// START
// ============================================================
window.addEventListener('DOMContentLoaded', init);
