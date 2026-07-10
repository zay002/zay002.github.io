import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

let scene, camera, renderer, controls;
let scoutGroup;
let auboJoints = null;
let ms42dcJoints = null;
let wheels = [];
let scatterProps = [];
let lastTime = 0;
let groundTexture = null;
let animationFrameId = 0;
let isDemoVisible = true;
let isDarkMode = true;
let worldBackground = 0x05070c;

// 只要你是从项目根目录启动：python -m http.server 8000
// 并且 assets 文件夹在项目根目录下，就用这个。
// 这样可以避免 ../assets 在不同页面层级下产生歧义。
const ASSET_ROOT = '/assets';
const ARACHNE_ASSET_ROOT = `${ASSET_ROOT}/arachne`;
const AUBO_DESCRIPTION_ROOT = `${ASSET_ROOT}/aubo_description/meshes/aubo_i5`;
const ARACHNE_MATERIAL_COLORS = {
    dark: 0x0d1214,
    body: 0x384247,
    arm: 0xebf0ed,
    joint: 0x2e383d,
    gripper: 0x1f5e94,
    sensor: 0x050506,
};
const GROUND_SIZE = 36;
const GROUND_TEXTURE_REPEAT = 8;
const GROUND_TEXTURE_SPEED = 0.42;
const SCATTER_WORLD_SPEED = GROUND_TEXTURE_SPEED * (GROUND_SIZE / GROUND_TEXTURE_REPEAT);

window.exposeDemo = () => ({
    scene,
    camera,
    renderer,
    controls,
    wheels,
    scoutGroup,
});

init();

async function init() {
    const container = document.getElementById('demo-container');
    const params = new URLSearchParams(window.location.search);
    isDarkMode = params.get('theme') !== 'light';
    worldBackground = isDarkMode ? 0x05070c : 0xffffff;
    document.documentElement.dataset.theme = isDarkMode ? 'dark' : 'light';

    scene = new THREE.Scene();
    scene.background = new THREE.Color(worldBackground);

    camera = new THREE.PerspectiveCamera(
        45,
        window.innerWidth / window.innerHeight,
        0.1,
        100
    );
    camera.position.set(1.75, 1.05, -1.85);

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(worldBackground, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    if ('outputColorSpace' in renderer) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    container.appendChild(renderer.domElement);
    applyTheme(isDarkMode ? 'dark' : 'light');

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0;
    controls.target.set(0.24, 0.48, -0.18);

    const hemiLight = new THREE.HemisphereLight(0xffffff, isDarkMode ? 0x182233 : 0xdce7f2, isDarkMode ? 1.25 : 1.8);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, isDarkMode ? 1.75 : 2.5);
    dirLight.position.set(2, 3, 2);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.top = 2;
    dirLight.shadow.camera.bottom = -2;
    dirLight.shadow.camera.left = -2;
    dirLight.shadow.camera.right = 2;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(isDarkMode ? 0x7aa7ff : 0xbfe7ff, isDarkMode ? 0.72 : 1.15);
    fillLight.position.set(-2.4, 1.8, -2.2);
    scene.add(fillLight);

    const ground = createMovingGround(isDarkMode);
    scene.add(ground);
    scene.add(createManipulationProps());

    scoutGroup = new THREE.Group();
    scoutGroup.name = 'scout_plus_aubo_group';

    // 机器人装配仍按 ROS/URDF 坐标理解：
    // X 向前，Y 向左，Z 向上。
    // Three.js 是 Y-up，因此在总装配根节点做一次 Z-up -> Y-up 转换。
    const urdfRoot = new THREE.Group();
    urdfRoot.name = 'urdf_root_z_up_to_three_y_up';
    urdfRoot.rotation.x = -Math.PI / 2;
    scoutGroup.add(urdfRoot);

    // 整车抬高，让轮子接近地面。
    // 如果整车悬空或陷入网格，微调这里。
    scoutGroup.position.y = 0.16;

    scene.add(scoutGroup);

    const visibilityObserver = new IntersectionObserver((entries) => {
        isDemoVisible = entries.some((entry) => entry.isIntersecting);
        updateAnimationLoop();
    }, {
        rootMargin: '120px 0px',
        threshold: 0.01,
    });
    visibilityObserver.observe(container);

    document.addEventListener('visibilitychange', updateAnimationLoop);
    window.addEventListener('pagehide', () => {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        visibilityObserver.disconnect();
        document.removeEventListener('visibilitychange', updateAnimationLoop);
        renderer.dispose();
        controls.dispose();
    });

    updateAnimationLoop();

    try {
        await Promise.all([
            loadScout(urdfRoot),
            loadAubo(urdfRoot),
            loadArachneBaseAccessories(urdfRoot),
        ]);

        const loading = document.getElementById('loading');
        if (loading) loading.style.display = 'none';
    } catch (e) {
        console.error(e);

        const loading = document.getElementById('loading');
        if (loading) {
            loading.innerText = `Error: ${e.message}\n${e.stack || ''}`;
        }
    }

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('message', (event) => {
        if (event.origin !== window.location.origin) {
            return;
        }

        if (event.data?.type === 'site-theme-change') {
            applyTheme(event.data.theme);
        }
    });
}

function applyTheme(theme) {
    isDarkMode = theme !== 'light';
    worldBackground = isDarkMode ? 0x05070c : 0xffffff;
    document.documentElement.dataset.theme = isDarkMode ? 'dark' : 'light';

    if (scene) {
        scene.background = new THREE.Color(worldBackground);
    }

    if (renderer) {
        renderer.setClearColor(worldBackground, 1);
        renderer.domElement.style.background = isDarkMode ? '#05070c' : '#ffffff';
    }

    const container = document.getElementById('demo-container');
    if (container) {
        container.style.background = isDarkMode ? '#05070c' : '#ffffff';
    }
}

function updateAnimationLoop() {
    if (isDemoVisible && document.visibilityState !== 'hidden') {
        if (!animationFrameId) {
            lastTime = performance.now();
            animationFrameId = requestAnimationFrame(animate);
        }
    } else if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = 0;
    }
}

async function loadScout(parent) {
    wheels = [];

    const baseUrl = `${ASSET_ROOT}/ugv_gazebo_sim/scout/scout_description/meshes`;

    const [base, wheelType1, wheelType2] = await Promise.all([
        loadColladaSafe(`${baseUrl}/base_link.dae`),
        loadColladaSafe(`${baseUrl}/wheel_type1.dae`),
        loadColladaSafe(`${baseUrl}/wheel_type2.dae`),
    ]);

    const baseMesh = base.scene.clone(true);
    baseMesh.name = 'scout_base_link_visual';
    prepareColladaVisual(baseMesh);

    // 注意：
    // ColladaLoader 有时会根据 DAE 的 up_axis 自动加旋转。
    // 我们这里把底盘自身旋转清零，所有坐标转换统一交给 urdfRoot。
    // 这样可以避免 double rotation。
    baseMesh.rotation.set(0, 0, 0);
    baseMesh.position.set(0, 0, 0);

    parent.add(baseMesh);

    // Scout 近似几何参数。
    // X 前后方向，Y 左右方向，Z 上下方向。
    const wheelbase = 0.49;
    const track = 0.58;

    // 轮子相对于 base_link 的高度。
    // 如果轮子太靠上或太靠下，优先调这个。
    const wheelZ = -0.02;

    // 如果轮子太贴近车体或太外侧，调这个。
    const wheelYExtra = 0.0;

    function setupWheel({
        collada,
        name,
        x,
        y,
        z,
        side,
        visualYaw = 0,
    }) {
        const mount = new THREE.Group();
        mount.name = `${name}_mount`;
        mount.position.set(x, y, z);

        // mount 只负责安装位置。
        // spinJoint 只负责滚动动画。
        const spinJoint = new THREE.Group();
        spinJoint.name = `${name}_spin_joint`;
        spinJoint.userData.spinAngle = 0;

        // Scout 轮子关节通常绕局部 Y 轴滚动。
        // 这里用局部 -Y 轴作为默认滚动轴。
        spinJoint.userData.spinAxis = new THREE.Vector3(0, -1, 0);

        // 四个轮子使用同一个滚动方向。
        // 左右轮的“内外侧朝向”由 visualYaw 处理，不要用 spinSign 反转滚动方向。
        spinJoint.userData.spinSign = 1;

        const mesh = collada.scene.clone(true);
        mesh.name = `${name}_visual`;
        prepareColladaVisual(mesh);

        // 右侧轮子翻转，让轮子外侧朝外。
        // 如果发现右侧轮子内外反了，只需要把右侧 visualYaw 从 Math.PI 改成 0。
        mesh.rotation.set(0, 0, visualYaw);
        mesh.position.set(0, 0, 0);

        spinJoint.add(mesh);
        mount.add(spinJoint);
        parent.add(mount);

        wheels.push(spinJoint);
    }

    // URDF 坐标：
    // 前：+X，后：-X，左：+Y，右：-Y。
    setupWheel({
        collada: wheelType1,
        name: 'front_right_wheel',
        x: +wheelbase / 2,
        y: -track / 2 - wheelYExtra,
        z: wheelZ,
        side: 'right',
        visualYaw: Math.PI,
    });

    setupWheel({
        collada: wheelType2,
        name: 'front_left_wheel',
        x: +wheelbase / 2,
        y: +track / 2 + wheelYExtra,
        z: wheelZ,
        side: 'left',
        visualYaw: 0,
    });

    setupWheel({
        collada: wheelType1,
        name: 'rear_left_wheel',
        x: -wheelbase / 2,
        y: +track / 2 + wheelYExtra,
        z: wheelZ,
        side: 'left',
        visualYaw: 0,
    });

    setupWheel({
        collada: wheelType2,
        name: 'rear_right_wheel',
        x: -wheelbase / 2,
        y: -track / 2 - wheelYExtra,
        z: wheelZ,
        side: 'right',
        visualYaw: Math.PI,
    });
}

// 关键修复：
// 不再使用 LoadingManager.setURLModifier。
// 当前 404 的根因就是 URLModifier 把 DAE 本体路径也重新拼接了。
// 先保证 DAE 模型本体能正确加载，贴图问题后续再单独处理。
function loadColladaSafe(url) {
    const loader = new ColladaLoader();

    return new Promise((resolve, reject) => {
        loader.load(
            url,
            (collada) => {
                resolve(collada);
            },
            undefined,
            (error) => {
                console.error('Failed to load Collada:', url, error);
                reject(error);
            }
        );
    });
}

function prepareColladaVisual(root) {
    root.traverse((child) => {
        if (!child.isMesh) return;

        child.castShadow = true;
        child.receiveShadow = true;

        if (!child.material) return;

        const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];

        materials.forEach((mat) => {
            if (mat.map) {
                mat.map.colorSpace = THREE.SRGBColorSpace;
                mat.map.needsUpdate = true;
            }

            mat.needsUpdate = true;
        });
    });
}

function createMovingGround(isDarkMode) {
    groundTexture = createProceduralLunarTexture(isDarkMode);

    const material = new THREE.MeshStandardMaterial({
        map: groundTexture,
        color: isDarkMode ? 0x8e969f : 0xf0f2f4,
        roughness: 0.94,
        metalness: 0.0,
    });

    const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 96, 96);
    const positions = geometry.attributes.position;

    for (let i = 0; i < positions.count; i += 1) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const flatPath = Math.abs(x) < 3.2 && Math.abs(y) < 5.4;
        const edgeRamp = Math.max(0, Math.hypot(x * 0.58, y * 0.42) - 3.0) / 6.6;
        const ripple =
            Math.sin(x * 0.68 + y * 0.2) * 0.13 +
            Math.cos(y * 0.54 - x * 0.24) * 0.1 +
            Math.sin((x + y) * 1.04) * 0.055;
        const height = flatPath ? 0 : Math.min(edgeRamp, 1) * ripple;

        positions.setZ(i, height);
    }

    geometry.computeVertexNormals();

    const ground = new THREE.Mesh(geometry, material);

    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;

    return ground;
}

function createManipulationProps() {
    const group = new THREE.Group();
    group.name = 'moving_scatter_props';
    scatterProps = [];

    const mats = {
        crateBlue: new THREE.MeshStandardMaterial({ color: 0x2f9bff, roughness: 0.58, metalness: 0.08 }),
        crateMint: new THREE.MeshStandardMaterial({ color: 0x58e0bb, roughness: 0.62, metalness: 0.04 }),
        crateRed: new THREE.MeshStandardMaterial({ color: 0xff5269, roughness: 0.6, metalness: 0.04 }),
        crateViolet: new THREE.MeshStandardMaterial({ color: 0x8aa4ff, roughness: 0.6, metalness: 0.04 }),
        crateDark: new THREE.MeshStandardMaterial({ color: 0x203246, roughness: 0.7, metalness: 0.08 }),
    };
    const materials = [mats.crateBlue, mats.crateMint, mats.crateRed, mats.crateViolet, mats.crateDark];

    const geometries = [
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.CylinderGeometry(0.5, 0.5, 1, 18),
        new THREE.DodecahedronGeometry(0.58, 0),
    ];

    for (let i = 0; i < 6; i += 1) {
        const geometry = geometries[Math.floor(Math.random() * geometries.length)];
        const material = materials[Math.floor(Math.random() * materials.length)];
        const prop = new THREE.Mesh(geometry, material);
        prop.name = `moving_pickup_candidate_${i + 1}`;
        prop.castShadow = true;
        prop.receiveShadow = true;
        prop.userData.phaseOffset = Math.random() * Math.PI * 2;
        resetScatterProp(prop, randomBetween(-4.2, 6.2));
        group.add(prop);
        scatterProps.push(prop);
    }

    return group;
}

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function resetScatterProp(prop, x = randomBetween(5.4, 7.0)) {
    const width = randomBetween(0.08, 0.17);
    const height = randomBetween(0.05, 0.13);
    const depth = randomBetween(0.08, 0.18);
    const lane = Math.random() < 0.5
        ? randomBetween(-1.28, -0.86)
        : randomBetween(0.86, 1.28);

    prop.scale.set(width, height, depth);
    prop.position.set(
        x,
        height * 0.5,
        lane
    );
    prop.rotation.set(
        randomBetween(-0.05, 0.05),
        randomBetween(0, Math.PI * 2),
        randomBetween(-0.05, 0.05)
    );
    prop.userData.lane = lane;
    prop.userData.drift = randomBetween(-0.012, 0.012);
    prop.userData.spin = randomBetween(-0.16, 0.16);
}

function updateScatterProps(dt, seconds) {
    scatterProps.forEach((prop) => {
        prop.position.x -= SCATTER_WORLD_SPEED * dt;
        prop.position.z = prop.userData.lane + Math.sin(seconds * 0.7 + prop.userData.phaseOffset) * prop.userData.drift;
        prop.rotation.y += prop.userData.spin * dt;

        if (prop.position.x < -5.2) {
            resetScatterProp(prop);
        }
    });
}

function createProceduralLunarTexture(isDarkMode) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;

    const ctx = canvas.getContext('2d');

    const image = ctx.createImageData(canvas.width, canvas.height);
    const data = image.data;

    for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
            const nx = x / canvas.width;
            const ny = y / canvas.height;
            const broad =
                Math.sin(Math.PI * 2 * nx) * 0.045 +
                Math.cos(Math.PI * 2 * ny) * 0.05 +
                Math.sin(Math.PI * 2 * (nx + ny)) * 0.035 +
                Math.cos(Math.PI * 2 * (nx - ny)) * 0.028;
            const mid =
                Math.sin(Math.PI * 4 * nx + Math.cos(Math.PI * 2 * ny) * 0.55) * 0.018 +
                Math.cos(Math.PI * 4 * ny + Math.sin(Math.PI * 2 * nx) * 0.4) * 0.015;
            const grain =
                Math.sin(Math.PI * 2 * (nx * 12 + ny * 7)) * 0.006 +
                Math.cos(Math.PI * 2 * (nx * 15 - ny * 9)) * 0.005;
            const shade = clamp((isDarkMode ? 0.46 : 0.7) + broad + mid + grain, isDarkMode ? 0.34 : 0.52, isDarkMode ? 0.62 : 0.86);
            const idx = (y * canvas.width + x) * 4;

            data[idx] = Math.round((isDarkMode ? 180 : 218) * shade);
            data[idx + 1] = Math.round((isDarkMode ? 187 : 220) * shade);
            data[idx + 2] = Math.round((isDarkMode ? 196 : 219) * shade);
            data[idx + 3] = 255;
        }
    }

    ctx.putImageData(image, 0, 0);

    const craters = [
        [112, 132, 42, 0.82],
        [326, 96, 26, 0.62],
        [404, 326, 50, 0.76],
        [178, 372, 32, 0.58],
        [274, 244, 18, 0.46],
    ];

    craters.forEach(([x, y, r, opacity]) => drawLunarCrater(ctx, x, y, r, opacity));

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(GROUND_TEXTURE_REPEAT, GROUND_TEXTURE_REPEAT);
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);

    return texture;
}

function drawLunarCrater(ctx, x, y, radius, opacity) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.24);
    ctx.scale(1.18, 0.78);

    const shadow = ctx.createRadialGradient(-radius * 0.16, -radius * 0.2, radius * 0.12, 0, 0, radius);
    shadow.addColorStop(0, `rgba(236, 238, 237, ${0.1 * opacity})`);
    shadow.addColorStop(0.42, `rgba(137, 140, 140, ${0.1 * opacity})`);
    shadow.addColorStop(0.76, `rgba(68, 70, 72, ${0.18 * opacity})`);
    shadow.addColorStop(1, 'rgba(68, 70, 72, 0)');

    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(246, 248, 248, ${0.16 * opacity})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(-radius * 0.05, -radius * 0.05, radius * 0.78, Math.PI * 0.95, Math.PI * 1.65);
    ctx.stroke();

    ctx.strokeStyle = `rgba(72, 74, 76, ${0.09 * opacity})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(radius * 0.04, radius * 0.05, radius * 0.72, Math.PI * 0.08, Math.PI * 0.72);
    ctx.stroke();

    ctx.restore();
}

// ==== AUBO MJCF Loader logic ====

async function loadAubo(parent) {
    const [
        link0,
        link1,
        link2,
        link3,
        link4,
        link5,
        link6,
    ] = await Promise.all([0, 1, 2, 3, 4, 5, 6].map((index) => (
        loadColladaVisualObject(`${AUBO_DESCRIPTION_ROOT}/visual/link${index}.DAE`)
    )));

    const armMount = new THREE.Group();
    armMount.name = 'arm_mount_link';
    armMount.position.set(0.22, 0, 0.105);
    armMount.rotation.set(0, 0, 0);
    parent.add(armMount);

    link0.name = 'aubo_base_link_visual';
    keepDaeColorsVisible(link0);
    armMount.add(link0);

    const shoulder = makeUrdfJoint('aubo_shoulder_joint', [0, 0, 0.122], [0, 0, Math.PI], armMount);
    link1.name = 'aubo_shoulder_Link_visual';
    keepDaeColorsVisible(link1);
    shoulder.add(link1);

    const upper = makeUrdfJoint('aubo_upperArm_joint', [0, 0.1215, 0], [-Math.PI / 2, -Math.PI / 2, 0], shoulder);
    link2.name = 'aubo_upperArm_Link_visual';
    keepDaeColorsVisible(link2);
    upper.add(link2);

    const fore = makeUrdfJoint('aubo_foreArm_joint', [0.408, 0, 0], [-Math.PI, 0, 0], upper);
    link3.name = 'aubo_foreArm_Link_visual';
    keepDaeColorsVisible(link3);
    fore.add(link3);

    const wrist1 = makeUrdfJoint('aubo_wrist1_joint', [0.376, 0, 0], [Math.PI, 0, Math.PI / 2], fore);
    link4.name = 'aubo_wrist1_Link_visual';
    keepDaeColorsVisible(link4);
    wrist1.add(link4);

    const wrist2 = makeUrdfJoint('aubo_wrist2_joint', [0, 0.1025, 0], [-Math.PI / 2, 0, 0], wrist1);
    link5.name = 'aubo_wrist2_Link_visual';
    keepDaeColorsVisible(link5);
    wrist2.add(link5);

    const wrist3 = makeUrdfJoint('aubo_wrist3_joint', [0, -0.094, 0], [Math.PI / 2, 0, 0], wrist2);
    link6.name = 'aubo_wrist3_Link_visual';
    keepDaeColorsVisible(link6);
    wrist3.add(link6);

    const tool0 = makeUrdfJoint('tool0', [0, 0, 0], [0, 0, Math.PI / 2], wrist3);
    await loadArachneEndEffector(tool0);

    auboJoints = {
        shoulder,
        upper,
        fore,
        wrist1,
        wrist2,
        wrist3,
        tool0,
    };

    updateAuboIntegrationMotion(0);
}

async function loadArachneBaseAccessories(parent) {
    const [frontBasket, rearRack] = await Promise.all([
        loadColladaVisualObject(`${ARACHNE_ASSET_ROOT}/accessories/front_basket/scout_front_basket_180x180x60mm_colored.dae`),
        loadColladaVisualObject(`${ARACHNE_ASSET_ROOT}/homemade/quanb_colored.dae`),
    ]);
    applyReadableSilverMaterial(frontBasket);
    applyReadableSilverMaterial(rearRack);

    const basketGroup = new THREE.Group();
    basketGroup.name = 'arachne_front_basket';
    basketGroup.position.set(0.4655, 0, -0.0735);
    basketGroup.add(frontBasket);
    parent.add(basketGroup);

    const rearRackGroup = new THREE.Group();
    rearRackGroup.name = 'arachne_rear_sensor_rack';
    rearRackGroup.position.set(-0.16, 0, 0.105);
    rearRackGroup.rotation.z = Math.PI / 2;

    rearRack.position.set(-0.137, 0.164499191, -0.242736588);
    rearRack.rotation.x = Math.PI / 2;
    rearRackGroup.add(rearRack);
    rearRackGroup.add(createArachneLidar());
    parent.add(rearRackGroup);
}

function createArachneLidar() {
    const group = new THREE.Group();
    group.name = 'arachne_lidar';
    group.position.set(0, 0.035, 0.6223);

    const bodyMaterial = createSilverMetalMaterial();
    const capMaterial = createSilverMetalMaterial();

    const body = createZCylinder(0.051, 0.0779, bodyMaterial);
    body.name = 'lidar_body';
    body.position.z = 0.03895;

    const cap = createZCylinder(0.035, 0.012, capMaterial);
    cap.name = 'lidar_top_cap';
    cap.position.z = 0.085;

    group.add(body, cap);
    return group;
}

async function loadArachneEndEffector(tool0) {
    const [base, mid, leftFinger, rightFinger, cameraSupport, cameraBody] = await Promise.all([
        loadStlMesh(`${ARACHNE_ASSET_ROOT}/gripper/ms42dc/split/ms42dc_base.stl`, ARACHNE_MATERIAL_COLORS.gripper),
        loadStlMesh(`${ARACHNE_ASSET_ROOT}/gripper/ms42dc/split/ms42dc_mid.stl`, ARACHNE_MATERIAL_COLORS.gripper),
        loadStlMesh(`${ARACHNE_ASSET_ROOT}/gripper/ms42dc/split/ms42dc_left_finger.stl`, ARACHNE_MATERIAL_COLORS.gripper),
        loadStlMesh(`${ARACHNE_ASSET_ROOT}/gripper/ms42dc/split/ms42dc_right_finger.stl`, ARACHNE_MATERIAL_COLORS.gripper),
        loadColladaVisualObject(`${ARACHNE_ASSET_ROOT}/homemade/camera_support_colored.dae`),
        loadColladaVisualObject(`${ARACHNE_ASSET_ROOT}/sensors/orbbec/gemini335_336/camera_link_colored.dae`),
    ]);
    applySilverMaterial(cameraSupport);
    applySilverMaterial(cameraBody);

    const adapter = new THREE.Group();
    adapter.name = 'arachne_gripper_adapter_link';
    adapter.rotation.z = Math.PI / 4;

    const adapterPlate = createZCylinder(
        0.055,
        0.025,
        createSilverMetalMaterial()
    );
    adapterPlate.name = 'arachne_ms42dc_adapter_plate';
    adapterPlate.position.z = 0.0125;
    adapter.add(adapterPlate);

    const gripper = new THREE.Group();
    gripper.name = 'arachne_ms42dc_gripper';
    gripper.position.set(-0.049334103, 0.04987407, 0.016816675);
    gripper.rotation.x = Math.PI / 2;

    base.name = 'ms42dc_base_link_visual';
    mid.name = 'ms42dc_mid_link_visual';

    const leftJoint = new THREE.Group();
    leftJoint.name = 'ms42dc_left_finger_joint';
    leftJoint.position.set(0.0133341030359, 0.0576833250744, 0.0610740704713);
    leftFinger.name = 'ms42dc_left_finger_visual';
    leftFinger.position.set(-0.0133341030359, -0.0576833250744, -0.0610740704713);
    leftJoint.add(leftFinger);

    const rightJoint = new THREE.Group();
    rightJoint.name = 'ms42dc_right_finger_joint';
    rightJoint.position.set(0.0853341030359, 0.0576833250744, 0.0610740704713);
    rightFinger.name = 'ms42dc_right_finger_visual';
    rightFinger.position.set(-0.0853341030359, -0.0576833250744, -0.0610740704713);
    rightJoint.add(rightFinger);

    gripper.add(base, mid, leftJoint, rightJoint);
    adapter.add(gripper);
    adapter.add(createArachneEeCamera(cameraSupport, cameraBody));
    tool0.add(adapter);

    ms42dcJoints = {
        left: leftJoint,
        right: rightJoint,
    };
}

function makeUrdfJoint(name, xyz, rpy, parent) {
    const joint = new THREE.Group();
    joint.name = name;
    joint.position.set(xyz[0], xyz[1], xyz[2]);
    joint.quaternion.copy(urdfRpyToQuaternion(rpy[0], rpy[1], rpy[2]));
    joint.userData.baseQuaternion = joint.quaternion.clone();
    joint.userData.jointAxis = new THREE.Vector3(0, 0, 1);
    parent.add(joint);
    return joint;
}

function urdfRpyToQuaternion(roll, pitch, yaw) {
    const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll);
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pitch);
    const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw);

    return qz.multiply(qy).multiply(qx);
}

function createSilverMetalMaterial() {
    return new THREE.MeshStandardMaterial({
        color: 0x9aa0a6,
        emissive: 0x4d5257,
        emissiveIntensity: 0.55,
        roughness: 0.46,
        metalness: 0.18,
        side: THREE.DoubleSide,
    });
}

function applySilverMaterial(root) {
    const material = createSilverMetalMaterial();

    root.traverse((child) => {
        if (child.isMesh) {
            child.material = material;
            child.castShadow = true;
            child.receiveShadow = false;
        }
    });
}

function applyReadableSilverMaterial(root) {
    root.traverse((child) => {
        if (child.isMesh) {
            applyChassisPaintVertexColors(child.geometry);
            child.material = createChassisPaintMaterial();
            child.castShadow = true;
            child.receiveShadow = false;
        }
    });
}

function createChassisPaintMaterial() {
    return new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.58,
        metalness: 0.10,
        clearcoat: 0.18,
        clearcoatRoughness: 0.72,
        emissive: 0x222426,
        emissiveIntensity: 0.08,
        vertexColors: true,
        side: THREE.DoubleSide,
    });
}

function applyChassisPaintVertexColors(geometry) {
    if (!geometry?.attributes?.position) return;

    if (!geometry.attributes.normal) {
        geometry.computeVertexNormals();
    }

    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const base = new THREE.Color(0xe4e8e7);
    const edgeTint = new THREE.Color(0xbcc4c7);

    for (let i = 0; i < positions.count; i += 1) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        const n = pseudoNoise(x * 37.1, y * 23.7, z * 19.3);
        const shade = 0.88 + n * 0.12;
        const color = base.clone().lerp(edgeTint, n * 0.18).multiplyScalar(shade);

        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.attributes.color.needsUpdate = true;
}

function pseudoNoise(x, y, z) {
    const value = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    return value - Math.floor(value);
}

function keepDaeColorsVisible(root) {
    root.traverse((child) => {
        if (!child.isMesh || !child.material) return;

        const sourceMaterials = Array.isArray(child.material)
            ? child.material
            : [child.material];

        const visibleMaterials = sourceMaterials.map((material) => (
            new THREE.MeshStandardMaterial({
                color: resolveAuboDisplayColor(material.color),
                map: material.map || null,
                roughness: resolveAuboRoughness(material.color),
                metalness: resolveAuboMetalness(material.color),
                side: THREE.DoubleSide,
                transparent: false,
                opacity: 1,
            })
        ));

        child.material = Array.isArray(child.material)
            ? visibleMaterials
            : visibleMaterials[0];
        child.castShadow = true;
        child.receiveShadow = true;
    });
}

function resolveAuboDisplayColor(sourceColor) {
    if (!sourceColor) {
        return new THREE.Color(0xd8dcdd);
    }

    const color = sourceColor.clone();
    const max = Math.max(color.r, color.g, color.b);
    const min = Math.min(color.r, color.g, color.b);
    const isOrange = color.r > 0.55 && color.g > 0.22 && color.b < 0.16;

    if (isOrange) {
        return new THREE.Color(0xe98512);
    }

    const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;

    if (max - min < 0.08 && luminance < 0.38) {
        return new THREE.Color(0x252b2f);
    }

    return new THREE.Color(0xd8dcdd);
}

function resolveAuboRoughness(sourceColor) {
    if (!sourceColor) return 0.46;
    const isOrange = sourceColor.r > 0.55 && sourceColor.g > 0.22 && sourceColor.b < 0.16;
    return isOrange ? 0.44 : 0.46;
}

function resolveAuboMetalness(sourceColor) {
    if (!sourceColor) return 0.18;
    const max = Math.max(sourceColor.r, sourceColor.g, sourceColor.b);
    const min = Math.min(sourceColor.r, sourceColor.g, sourceColor.b);
    const luminance = sourceColor.r * 0.2126 + sourceColor.g * 0.7152 + sourceColor.b * 0.0722;
    const isDarkGrey = max - min < 0.08 && luminance < 0.38;
    return isDarkGrey ? 0.3 : 0.18;
}

function createArachneEeCamera(cameraSupport, cameraBody) {
    const supportJoint = new THREE.Group();
    supportJoint.name = 'ee_camera_support_joint';

    const supportLink = new THREE.Group();
    supportLink.name = 'ee_camera_support_link';
    supportJoint.add(supportLink);

    cameraSupport.name = 'ee_camera_support_visual';
    cameraSupport.position.set(-0.031499998, -0.0815, -0.122628235);
    supportLink.add(cameraSupport);

    const cameraJoint = new THREE.Group();
    cameraJoint.name = 'ee_camera_joint';
    cameraJoint.position.set(0.025, -0.069, 0.03077);
    cameraJoint.quaternion.copy(urdfRpyToQuaternion(0, -Math.PI / 2, -Math.PI / 2));
    supportLink.add(cameraJoint);

    const cameraLink = new THREE.Group();
    cameraLink.name = 'ee_camera_link';
    cameraJoint.add(cameraLink);

    cameraBody.name = 'gemini335_camera_visual';
    cameraBody.position.set(-0.01587, -0.025, -0.0125);
    cameraLink.add(cameraBody);

    return supportJoint;
}

function createZCylinder(radius, length, material) {
    const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, length, 36),
        material
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    return mesh;
}

async function loadColladaVisualObject(url) {
    const collada = await loadColladaSafe(url);
    const object = collada.scene.clone(true);
    object.rotation.set(0, 0, 0);
    prepareColladaVisual(object);
    return object;
}

function loadStlMesh(url, color) {
    const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.54,
        metalness: 0.18,
    });

    return new Promise((resolve, reject) => {
        new STLLoader().load(
            url,
            (geometry) => {
                const mesh = new THREE.Mesh(geometry, material);
                mesh.scale.setScalar(0.001);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                resolve(mesh);
            },
            undefined,
            reject
        );
    });
}

function findObjectByName(root, name) {
    let result = null;

    root.traverse((child) => {
        if (!result && child.name === name) {
            result = child;
        }
    });

    return result;
}

function findJoint(root, name) {
    let result = null;

    root.traverse((child) => {
        if (child.userData && child.userData.jointName === name) {
            result = child;
        }
    });

    return result;
}

async function buildMjcfBody(bodyEl, parent, context) {
    const group = new THREE.Group();

    const bodyName = bodyEl.getAttribute('name');
    if (bodyName === 'base' && bodyEl.querySelector('geom[mesh="gripper_body"]')) {
        return;
    }

    if (bodyName) {
        group.name = bodyName;
    }

    const pos = parseNumbers(bodyEl.getAttribute('pos'), [0, 0, 0]);
    group.position.set(pos[0], pos[1], pos[2]);

    group.quaternion.copy(parseOrientation(bodyEl));
    group.userData.baseQuaternion = group.quaternion.clone();

    parent.add(group);

    const jointEl = Array.from(bodyEl.children).find(
        (c) => c.tagName.toLowerCase() === 'joint'
    );

    if (jointEl) {
        const jointName = jointEl.getAttribute('name');
        const axis = parseNumbers(jointEl.getAttribute('axis'), [0, 0, 1]);

        group.userData.jointName = jointName;
        group.userData.jointAxis = new THREE.Vector3(
            axis[0],
            axis[1],
            axis[2]
        ).normalize();
    }

    const geoms = Array.from(bodyEl.children).filter(
        (c) => c.tagName.toLowerCase() === 'geom'
    );

    const renderedGeoms = await Promise.all(geoms.map((geomEl) => {
        const visual =
            geomEl.getAttribute('class') === 'visual' ||
            geomEl.getAttribute('class') === 'aubo_visual';

        if (!visual) return null;

        return createMjcfGeom(geomEl, context);
    }));

    renderedGeoms.forEach((rendered) => {
        if (rendered) {
            group.add(rendered);
        }
    });

    const childBodies = Array.from(bodyEl.children).filter(
        (c) => c.tagName.toLowerCase() === 'body'
    );

    await Promise.all(childBodies.map((childBody) => buildMjcfBody(childBody, group, context)));
}

async function createMjcfGeom(geomEl, context) {
    const type =
        geomEl.getAttribute('type') ||
        (geomEl.hasAttribute('mesh') ? 'mesh' : 'box');

    const matAttr = geomEl.getAttribute('material');
    const rgbaAttr = geomEl.getAttribute('rgba');

    let material = context.materialMap.get(matAttr);

    if (!material) {
        material = new THREE.MeshStandardMaterial({
            color: rgbaAttr ? parseColor(rgbaAttr) : 0xcccccc,
            roughness: 0.5,
            metalness: 0.2,
        });
    }

    if (type === 'mesh') {
        const meshName = geomEl.getAttribute('mesh');
        const meshDef = context.meshMap.get(meshName);

        if (!meshDef) {
            console.warn('MJCF mesh not found:', meshName);
            return null;
        }

        const object = await loadMeshObject(
            meshDef,
            material,
            context.assetCache
        );

        if (!object) return null;

        const pos = parseNumbers(geomEl.getAttribute('pos'), [0, 0, 0]);
        object.position.set(pos[0], pos[1], pos[2]);

        object.quaternion.premultiply(parseOrientation(geomEl));

        return object;
    }

    return null;
}

function parseColor(rgbaStr) {
    const rgba = parseNumbers(rgbaStr, [0.8, 0.8, 0.8, 1]);
    return new THREE.Color(rgba[0], rgba[1], rgba[2]);
}

async function loadMeshObject(meshDef, material, assetCache) {
    const cacheKey = `${meshDef.url}|${meshDef.scale.join(',')}`;

    if (!assetCache.has(cacheKey)) {
        assetCache.set(cacheKey, loadMeshObjectFresh(meshDef, material));
    }

    const source = await assetCache.get(cacheKey);
    const clone = source.clone(true);

    clone.traverse((child) => {
        if (child.isMesh) {
            child.material = material;
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    return clone;
}

function warmMeshCache(meshMap, assetCache) {
    meshMap.forEach((meshDef) => {
        const cacheKey = `${meshDef.url}|${meshDef.scale.join(',')}`;

        if (!assetCache.has(cacheKey)) {
            assetCache.set(cacheKey, loadMeshObjectFresh(meshDef, new THREE.MeshStandardMaterial()));
        }
    });
}

function loadMeshObjectFresh(meshDef, material) {
    const ext = meshDef.url.split('.').pop().toLowerCase();

    return new Promise((resolve) => {
        const onError = (e) => {
            console.error(`Failed to load mesh: ${meshDef.url}`, e);

            // 不中断整个页面，返回空对象。
            // 这样某个 mesh 丢失时，至少其他部分仍能显示。
            resolve(new THREE.Group());
        };

        if (ext === 'obj') {
            new OBJLoader().load(
                meshDef.url,
                (obj) => handleMesh(obj, meshDef, material, resolve),
                undefined,
                onError
            );
        } else if (ext === 'stl') {
            new STLLoader().load(
                meshDef.url,
                (geo) => {
                    const obj = new THREE.Mesh(geo, material);
                    handleMesh(obj, meshDef, material, resolve);
                },
                undefined,
                onError
            );
        } else {
            console.warn('Unsupported mesh format:', meshDef.url);
            resolve(new THREE.Group());
        }
    });
}

function handleMesh(object, meshDef, material, resolve) {
    object.scale.set(
        meshDef.scale[0],
        meshDef.scale[1],
        meshDef.scale[2]
    );

    object.traverse((child) => {
        if (child.isMesh) {
            child.material = material;
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    resolve(object);
}

function parseMjcfMaterials(doc) {
    const map = new Map();

    doc.querySelectorAll('asset > material').forEach((el) => {
        const name = el.getAttribute('name') || '';
        const lower = name.toLowerCase();

        let color = new THREE.Color(0xf8fafc);
        let roughness = 0.48;
        let metalness = 0.16;
        let opacity = 1;

        if (lower.includes('63,63,63') || lower.includes('black')) {
            color = new THREE.Color(0x1f2937);
        } else if (lower.includes('232,133,0')) {
            color = new THREE.Color(0xe98512);
        } else if (lower.includes('grey')) {
            color = new THREE.Color(0x0f766e);
        } else {
            const rgbaAttr = el.getAttribute('rgba');

            if (rgbaAttr) {
                const rgba = parseNumbers(rgbaAttr, [0.8, 0.84, 0.88, 1]);
                opacity = rgba[3];

                const source = new THREE.Color(rgba[0], rgba[1], rgba[2]);
                color = source.lerp(new THREE.Color(0xf8fafc), 0.45);
            }
        }

        map.set(
            name,
            new THREE.MeshStandardMaterial({
                color,
                roughness,
                metalness,
                transparent: opacity < 1,
                opacity,
            })
        );
    });

    return map;
}

function parseMjcfMeshes(doc, baseUrl) {
    const map = new Map();

    doc.querySelectorAll('asset > mesh[file]').forEach((el) => {
        const file = el.getAttribute('file');
        const fallbackName = file
            .split('/')
            .pop()
            .replace(/\.[^.]+$/, '');

        const name = el.getAttribute('name') || fallbackName;
        const scale = parseNumbers(el.getAttribute('scale'), [1, 1, 1]);

        // baseUrl 是 /assets/robot/mjcf
        // file 可能是相对路径，因此用 URL 正规化，避免 ../ 搞乱。
        const url = new URL(
            `${baseUrl}/universal_robots_auboi5/${file}`,
            window.location.origin
        );

        map.set(name, {
            url: url.pathname,
            scale,
        });
    });

    return map;
}

function parseOrientation(el) {
    if (el.hasAttribute('quat')) {
        const q = parseNumbers(el.getAttribute('quat'), [1, 0, 0, 0]);

        // MJCF quat: w x y z
        // THREE quat: x y z w
        return new THREE.Quaternion(q[1], q[2], q[3], q[0]);
    }

    if (el.hasAttribute('euler')) {
        const e = parseNumbers(el.getAttribute('euler'), [0, 0, 0]);

        return new THREE.Quaternion().setFromEuler(
            new THREE.Euler(e[0], e[1], e[2], 'XYZ')
        );
    }

    return new THREE.Quaternion();
}

function parseNumbers(value, fallback) {
    if (!value) return [...fallback];

    const n = value
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter(Number.isFinite);

    return n.length ? n : [...fallback];
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function applyMjcfJoint(group, value) {
    if (!group) return;

    const base = group.userData.baseQuaternion || new THREE.Quaternion();
    const axis =
        group.userData.jointAxis || new THREE.Vector3(0, 0, 1);

    group.quaternion.copy(base).multiply(
        new THREE.Quaternion().setFromAxisAngle(axis, value)
    );
}

function updateAuboIntegrationMotion(seconds) {
    if (!auboJoints) return;

    const scan = Math.sin(seconds * 0.48);
    const reach = Math.sin(seconds * 0.5 + 1.15);
    const fold = Math.sin(seconds * 0.54 + 2.35);
    const wristPitch = Math.sin(seconds * 0.74 + 2.8);
    const wristRoll = Math.sin(seconds * 1.18 + 0.4) + Math.sin(seconds * 2.05 + 1.1) * 0.32;
    const toolTwist = Math.sin(seconds * 1.46 + 0.85);

    applyMjcfJoint(auboJoints.shoulder, 0.35 - scan * 0.68);
    applyMjcfJoint(auboJoints.upper, -0.82 + reach * 0.28);
    applyMjcfJoint(auboJoints.fore, 1.18 + fold * 0.32);
    applyMjcfJoint(auboJoints.wrist1, 0.32 + Math.cos(seconds * 0.64) * 0.62);
    applyMjcfJoint(auboJoints.wrist2, 0.74 + wristPitch * 0.56 + Math.sin(seconds * 1.33) * 0.12);
    applyMjcfJoint(auboJoints.wrist3, wristRoll * 1.05);
    applyMjcfJoint(auboJoints.tool0, toolTwist * 0.52);

    if (ms42dcJoints) {
        const finger = 0.18 + (Math.sin(seconds * 1.35) + 1) * 0.12;
        ms42dcJoints.left.rotation.z = -finger;
        ms42dcJoints.right.rotation.z = finger;
    }
}

function animate() {
    animationFrameId = 0;

    if (!isDemoVisible || document.visibilityState === 'hidden') {
        return;
    }

    const time = performance.now();
    const seconds = time * 0.001;
    const dt = (time - lastTime) / 1000;
    lastTime = time;

    // 轮子滚动速度。
    // 如果视觉方向反了，把 wheelSpeed 改成 -3.0。
    const wheelSpeed = -3.0;

    if (groundTexture) {
        groundTexture.offset.x = (groundTexture.offset.x + dt * GROUND_TEXTURE_SPEED) % 1;
    }

    updateScatterProps(dt, seconds);

    wheels.forEach((wheel) => {
        wheel.userData.spinAngle +=
            wheelSpeed * dt * wheel.userData.spinSign;

        wheel.rotation.set(0, 0, 0);
        wheel.rotateOnAxis(
            wheel.userData.spinAxis,
            wheel.userData.spinAngle
        );
    });

    updateAuboIntegrationMotion(seconds);
    controls.update();
    renderer.render(scene, camera);
    animationFrameId = requestAnimationFrame(animate);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);
}
