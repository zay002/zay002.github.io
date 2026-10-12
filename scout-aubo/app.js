import { createMission } from "./mission.js?v=20261012";
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

let scene, camera, renderer, controls;
let scoutGroup;
let mission = null;
let missionTime = 0;
let missionPaused = matchMedia("(prefers-reduced-motion: reduce)").matches;
let missionTcp = null;
let auboJoints = null;
let ms42dcJoints = null;
let wheels = [];
let lastTime = 0;
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

window.exposeDemo = () => ({
    scene,
    camera,
    renderer,
    controls,
    wheels,
    scoutGroup,
    mission,
    missionTcp,
    restart: () => { missionTime = 0; },
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
    camera.position.set(3.6, 2.6, 3.8);

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
    controls.target.set(.25, .3, 0);
    controls.maxDistance = 10;
    controls.minDistance = 2;

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

    const ground = createMissionGround(isDarkMode);
    scene.add(ground);
    scene.add(new THREE.GridHelper(12, 40, 0x385873, 0x203044));

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

        mission = createMission({ scene, robot: scoutGroup, tcp: missionTcp,
            apply: values => Object.entries(values).forEach(([key, value]) => applyMjcfJoint(auboJoints[key], value)),
            fingers: ms42dcJoints,
        });
        const loading = document.getElementById('loading');
        if (loading) loading.style.display = 'none';
    } catch (e) {
        console.error(e);

        const loading = document.getElementById('loading');
        if (loading) {
            loading.innerText = `Error: ${e.message}\n${e.stack || ''}`;
        }
    }

    const pauseButton = document.querySelector('[data-mission-pause]');
    const syncPause = () => { pauseButton.textContent = missionPaused ? 'Play' : 'Pause'; pauseButton.setAttribute('aria-pressed', String(missionPaused)); };
    pauseButton.addEventListener('click', () => { missionPaused = !missionPaused; syncPause(); });
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => { if (event.matches) { missionPaused = true; syncPause(); } });
    syncPause();
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
        scene.getObjectByName("mission-floor")?.material.color.setHex(isDarkMode ? 0x111c29 : 0xe5edf3);
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

function createMissionGround(dark) {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), new THREE.MeshStandardMaterial({ color: dark ? 0x111c29 : 0xe5edf3, roughness: .9 }));
    ground.name = 'mission-floor';
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -.006;
    ground.receiveShadow = true;
    return ground;
}

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
    missionTcp = new THREE.Object3D();
    missionTcp.position.set(0, 0, .16);
    tool0.add(missionTcp);

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

function updateAuboIntegrationMotion() {
    if (!auboJoints) return;
    const home = { shoulder: 0, upper: -1.2, fore: 1.9, wrist1: .5, wrist2: 1.57, wrist3: 0 };
    Object.entries(home).forEach(([key, value]) => applyMjcfJoint(auboJoints[key], value));
}

function animate() {
    animationFrameId = 0;
    if (!isDemoVisible || document.visibilityState === 'hidden') return;
    const time = performance.now();
    const dt = Math.min((time - lastTime) / 1000, .06);
    lastTime = time;
    if (mission) {
        if (!missionPaused) missionTime += dt;
        const state = mission.update(missionTime);
        document.querySelector('[data-mission-status]').textContent = state.status;
        document.querySelector('[data-mission-progress]').style.width = `${state.progress * 100}%`;
        if (!missionPaused && state.moving) wheels.forEach(wheel => {
            wheel.userData.spinAngle -= state.distance / .165 * wheel.userData.spinSign * (missionTime % 32 < 6 ? -1 : 1);
            wheel.rotation.set(0, 0, 0);
            wheel.rotateOnAxis(wheel.userData.spinAxis, wheel.userData.spinAngle);
        });
    }
    controls.update();
    renderer.render(scene, camera);
    animationFrameId = requestAnimationFrame(animate);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);
}
