import * as THREE from "three";
import { OrbitControls } from "https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "https://unpkg.com/three@0.161.0/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "https://unpkg.com/three@0.161.0/examples/jsm/loaders/STLLoader.js";

const host = document.querySelector("#aubo-demo");

// Public scene slice from Autron's tuned tabletop layout. The private backend
// has richer scene/control state; the homepage keeps only display-safe geometry.
const AUTRON_SCENE = {
  surface: {
    minXY: [0.34, -0.1],
    maxXY: [0.7, 0.44],
    tableTopZ: 0.0625,
  },
  pickupCenter: [0.4, -0.02],
  dropCenter: [0.5, 0.22],
  cubes: {
    red: [0.36, -0.08, 0.018],
    blue: [0.44, -0.03, 0.012],
    yellow: [0.39, 0.07, 0.02],
  },
};

const AUBO_I5_MODEL = {
  scale: 0.68,
  shoulderHeight: 0.0435 + 0.0785,
  upperArm: 0.408,
  forearm: 0.376,
  wrist1Offset: 0.0175,
  wrist2Offset: 0.06056,
  wrist3Offset: 0.042,
  toolStandoff: 0.2,
};

const CUBE_SIZE = 0.055;
const TABLE_TOP_Z = AUTRON_SCENE.surface.tableTopZ;
const ROBOT_BASE = new THREE.Vector3(0, 0, TABLE_TOP_Z);
const REAL_MODEL_SCALE = AUBO_I5_MODEL.scale;
const SORT_HOME_TARGET = new THREE.Vector3(0.28, -0.04, 0.42);
const LOOP_ORDER = ["red", "blue", "yellow"];
const LOOP_RESTART_DELAY = 1.2;
const WRIST_2_NORMAL_OFFSET = Math.PI / 2;
const BAKED_ROBOT_ORIGIN = new THREE.Vector3(0.028, 0, 0);
const CAMERA_ORBIT_TARGET = new THREE.Vector3(0.28, 0.04, 0.22);
const CAMERA_ORBIT_RADIUS = 1.55;
const CAMERA_ORBIT_HEIGHT = 0.92;
const CAMERA_ORBIT_SPEED = 0.00008;

// TCP means gripper center. When the cube is attached, its center should be
// slightly below the TCP. We calibrate this so AG95 exactly touches the cube.
const TCP_TO_CUBE_CENTER = new THREE.Vector3(0, 0, -0.008);

// Keep the cube centered under the AG95 fingertips without shifting the scene.
const GRASP_VISUAL_TCP_BIAS = new THREE.Vector3(0, 0, 0);

// Generated from the public AUBO i5 kinematic dimensions above plus Autron's
// tuned main_table layout. This is a display pose table, not a robot controller.
const REAL_POSES = createAutronPoseTable();

if (host) {
  initRobotDemo(host);
}

function initRobotDemo(container) {
  let isDarkMode = document.documentElement.dataset.theme !== "light";
  const getWorldBackground = () => (isDarkMode ? 0x05070c : 0xffffff);
  const ui = {
    status: document.querySelector("[data-robot-status]"),
    mode: document.querySelector("[data-robot-mode]"),
    task: document.querySelector("[data-robot-active-task]"),
    progress: document.querySelector("[data-robot-progress]"),
    steps: Array.from(document.querySelectorAll("[data-robot-step]")),
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(getWorldBackground());

  const camera = new THREE.PerspectiveCamera(42, 1, 0.04, 20);
  camera.up.set(0, 0, 1);
  camera.position.set(1.35, -1.26, 0.92);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.setClearColor(getWorldBackground(), 1);
  container.style.background = isDarkMode ? "#05070c" : "#ffffff";
  renderer.domElement.style.background = isDarkMode ? "#05070c" : "#ffffff";

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.62;
  controls.maxDistance = 2.8;
  controls.target.copy(CAMERA_ORBIT_TARGET);
  controls.update();

  const palette = {
    ink: 0xdbe7f3,
    muted: 0x7f94a8,
    table: 0x0b111a,
    tableEdge: 0x1f3041,
    robotWhite: 0xd8e2eb,
    robotJoint: 0x0b1118,
    robotAccent: 0x2fd6ff,
    blue: 0x39a4ff,
    red: 0xff4f66,
    yellow: 0xffcc4d,
    tray: 0x172230,
  };

  const mats = {
    table: material(palette.table, 0.78, 0.08),
    tableEdge: material(palette.tableEdge, 0.68, 0.05),
    robot: material(palette.robotWhite, 0.46, 0.18),
    joint: material(palette.robotJoint, 0.34, 0.32),
    accent: material(palette.robotAccent, 0.42, 0.22),
    tray: material(palette.tray, 0.7, 0.1),
    red: material(palette.red, 0.62, 0.12),
    blue: material(palette.blue, 0.55, 0.18),
    yellow: material(palette.yellow, 0.64, 0.08),
    ghost: new THREE.MeshBasicMaterial({
      color: palette.blue,
      transparent: true,
      opacity: 0.16,
    }),
  };

  const applyTheme = (theme) => {
    isDarkMode = theme !== "light";
    const background = getWorldBackground();
    scene.background.set(background);
    renderer.setClearColor(background, 1);
    container.style.background = isDarkMode ? "#05070c" : "#ffffff";
    renderer.domElement.style.background = isDarkMode ? "#05070c" : "#ffffff";
  };

  window.addEventListener("site-theme-change", (event) => {
    applyTheme(event.detail?.theme);
  });

  const objects = createWorld(scene, mats, isDarkMode);
  const robot = createRobot(scene, mats, ui);
  robot.root.position.copy(BAKED_ROBOT_ORIGIN);

  const target = new THREE.Vector3(0.24, -0.18, 0.38);
  const targetOpen = { value: 0.1 };

  const active = {
    running: false,
    start: 0,
    selected: objects.cubes.red,
    attached: false,
    released: false,
    sequence: [],
    pose: REAL_POSES.home,
    dropPosition: new THREE.Vector3(),
    autoIndex: 0,
    nextStartAt: 0,
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  let animationFrameId = 0;
  let isDemoVisible = true;

  const visibilityObserver = new IntersectionObserver((entries) => {
    isDemoVisible = entries.some((entry) => entry.isIntersecting);
    updateAnimationLoop();
  }, {
    rootMargin: "120px 0px",
    threshold: 0.01,
  });
  visibilityObserver.observe(container);

  document.addEventListener("visibilitychange", updateAnimationLoop);

  window.addEventListener("pagehide", () => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
    visibilityObserver.disconnect();
    resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", updateAnimationLoop);
    renderer.dispose();
    controls.dispose();
  });

  resetSequence();
  resize();
  
  if (robot.loadPromise) {
    robot.loadPromise.finally(() => {
      startNextLoop(performance.now());
    });
  } else {
    startNextLoop(performance.now());
  }

  updateAnimationLoop();

  function updateAnimationLoop() {
    if (isDemoVisible && document.visibilityState !== "hidden") {
      if (!animationFrameId) {
        animationFrameId = requestAnimationFrame(animate);
      }
    } else if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }
  }

  function startNextLoop(now = performance.now()) {
    const label = LOOP_ORDER[active.autoIndex % LOOP_ORDER.length];
    const cube = objects.cubes[label] || objects.cubes.red;

    if (active.autoIndex === 0) {
      resetSceneObjects();
    }

    active.selected = cube;
    active.running = true;
    active.start = now;
    active.attached = false;
    active.released = false;
    active.pose = REAL_POSES.home;
    active.dropPosition.copy(getCubeDropPosition(cube, objects.trayDrop));
    active.sequence = buildSequence(cube, objects.trayDrop);
    active.nextStartAt = 0;

    objects.targetRing.visible = false;
    objects.targetRing.position.set(cube.home.x, cube.home.y, cube.home.z + 0.035);
    objects.targetRing.material.color.setHex(cube.hex);
    objects.ghostPath.visible = false;
    setStepState(0, 0);

    if (ui.status) ui.status.textContent = "Autoplay scene scan";
    if (ui.mode) ui.mode.textContent = "Fixed Three.js loop";
    if (ui.task) ui.task.textContent = `Loop ${active.autoIndex + 1}: ${cube.label} cube to tray`;
  }

  function resetSequence() {
    active.running = false;
    active.attached = false;
    active.released = false;

    target.copy(SORT_HOME_TARGET);
    targetOpen.value = 0.1;
    active.pose = REAL_POSES.home;

    resetSceneObjects();

    objects.targetRing.visible = false;
    objects.ghostPath.visible = false;

    setStepState(-1, 0);
    updateRobot(robot, target, targetOpen.value, active.pose);

    if (ui.status) ui.status.textContent = "Autoplay ready";
    if (ui.mode) ui.mode.textContent = "Fixed Three.js loop";
    if (ui.progress) ui.progress.style.width = "0%";
  }

  function resetSceneObjects() {
    Object.values(objects.cubes).forEach((cube) => {
      cube.mesh.position.copy(cube.home);
      cube.mesh.quaternion.identity();
    });
  }

  function animate(now = performance.now()) {
    animationFrameId = 0;

    if (!isDemoVisible || document.visibilityState === "hidden") {
      return;
    }

    updateCameraOrbit(camera, controls, now);
    controls.update();
    if (active.running) {
      updateSequence(now);
    } else if (active.nextStartAt && now >= active.nextStartAt) {
      startNextLoop(now);
    }

    updateRobot(robot, target, targetOpen.value, active.pose);
    renderer.render(scene, camera);
    animationFrameId = requestAnimationFrame(animate);
  }

  function updateSequence(now) {
    const elapsed = (now - active.start) / 1000;
    const sequence = active.sequence;
    const total = sequence.reduce((sum, step) => sum + step.duration, 0);

    let cursor = 0;
    let current = sequence[sequence.length - 1];
    let index = sequence.length - 1;

    for (let i = 0; i < sequence.length; i += 1) {
      if (elapsed <= cursor + sequence[i].duration || i === sequence.length - 1) {
        current = sequence[i];
        index = i;
        break;
      }
      cursor += sequence[i].duration;
    }

    const previous = sequence[Math.max(index - 1, 0)];
    const local = Math.min(Math.max((elapsed - cursor) / current.duration, 0), 1);
    const eased = smooth(local);

    let commandedTarget = interpolateTarget(
      previous.target,
      current.target,
      eased,
      current.arcHeight || 0
    );

    target.copy(commandedTarget);
    targetOpen.value = previous.open + (current.open - previous.open) * eased;
    active.pose = interpolatePose(
      previous.realPose || current.realPose || REAL_POSES.home,
      current.realPose || previous.realPose || REAL_POSES.home,
      eased
    );
    updateRobot(robot, target, targetOpen.value, active.pose);

    const cubeCenterUnderTcp = getRobotTcpWorldPosition(robot, target)
      .clone()
      .sub(GRASP_VISUAL_TCP_BIAS)
      .add(TCP_TO_CUBE_CENTER);

    // Do not attach the cube immediately. Wait until the gripper is nearly closed.
    if (current.attach && !active.attached) {
      const attachAt = current.attachAt ?? 0.82;
      if (local >= attachAt) {
        active.attached = true;
        active.selected.mesh.position.copy(cubeCenterUnderTcp);
      }
    }

    // Do not release the cube immediately. Wait until the gripper starts opening.
    if (current.release && !active.released) {
      const releaseAt = current.releaseAt ?? 0.75;
      if (local >= releaseAt) {
        active.attached = false;
        active.released = true;
        active.selected.mesh.position.copy(active.dropPosition);
        active.selected.mesh.quaternion.identity();
      }
    }

    if (active.attached) {
      active.selected.mesh.position.copy(cubeCenterUnderTcp);
      active.selected.mesh.quaternion.identity();
    }

    const highLevelStep = current.uiStep;
    setStepState(highLevelStep, Math.min(elapsed / total, 1));

    if (ui.status) {
      ui.status.textContent = current.status;
    }

    if (elapsed >= total) {
      active.attached = false;
      active.released = true;
      active.selected.mesh.position.copy(active.dropPosition);
      active.selected.mesh.quaternion.identity();
      active.running = false;
      active.autoIndex = (active.autoIndex + 1) % LOOP_ORDER.length;
      active.nextStartAt = now + LOOP_RESTART_DELAY * 1000;
      objects.targetRing.visible = false;
      objects.ghostPath.visible = false;

      setStepState(4, 1);

      if (ui.status) ui.status.textContent = "Verified mock placement";
      if (ui.mode) ui.mode.textContent = "Looping locally";
    }
  }

  function resize() {
    const rect = container.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function setStepState(activeIndex, progress) {
    ui.steps.forEach((step, idx) => {
      step.classList.toggle("is-active", idx === activeIndex);
      step.classList.toggle("is-complete", idx < activeIndex || progress >= 1);
    });

    if (ui.progress) {
      ui.progress.style.width = `${Math.round(progress * 100)}%`;
    }
  }
}

function createWorld(scene, mats, isDarkMode) {
  scene.add(new THREE.HemisphereLight(0xffffff, isDarkMode ? 0x182233 : 0xdce7f2, isDarkMode ? 1.25 : 1.8));

  const key = new THREE.DirectionalLight(0xffffff, isDarkMode ? 1.75 : 2.5);
  key.position.set(1.5, -1.2, 1.9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  scene.add(key);

  const fill = new THREE.DirectionalLight(isDarkMode ? 0x7aa7ff : 0xbfe7ff, isDarkMode ? 0.72 : 1.15);
  fill.position.set(-1.4, 0.8, 1.2);
  scene.add(fill);

  const table = mesh(
    new THREE.BoxGeometry(1.34, 0.82, 0.065),
    mats.table,
    [0.18, 0.02, 0.03]
  );
  scene.add(table);

  const tableBase = mesh(
    new THREE.BoxGeometry(1.26, 0.74, 0.04),
    mats.tableEdge,
    [0.18, 0.02, -0.035]
  );
  scene.add(tableBase);

  const tray = new THREE.Group();
  const trayCenter = demoSurfacePoint(AUTRON_SCENE.dropCenter[0], AUTRON_SCENE.dropCenter[1]);
  const trayWidth = 0.28;
  const trayDepth = 0.22;
  const trayWall = 0.014;
  const trayWallHeight = 0.052;
  tray.position.set(trayCenter.x, trayCenter.y, TABLE_TOP_Z + 0.012);
  tray.add(mesh(new THREE.BoxGeometry(trayWidth, trayDepth, 0.018), mats.tray, [0, 0, 0]));
  tray.add(mesh(new THREE.BoxGeometry(trayWidth + 0.01, trayWall, trayWallHeight), mats.tray, [0, -(trayDepth / 2 + trayWall / 2), 0.026]));
  tray.add(mesh(new THREE.BoxGeometry(trayWidth + 0.01, trayWall, trayWallHeight), mats.tray, [0, trayDepth / 2 + trayWall / 2, 0.026]));
  tray.add(mesh(new THREE.BoxGeometry(trayWall, trayDepth, trayWallHeight), mats.tray, [-(trayWidth / 2 + trayWall / 2), 0, 0.026]));
  scene.add(tray);

  const cubes = {
    red: createCube("red", 0xe5484d, mats.red, cubeCenter("red")),
    blue: createCube("blue", 0x2563eb, mats.blue, cubeCenter("blue")),
    yellow: createCube("yellow", 0xf2bf37, mats.yellow, cubeCenter("yellow")),
  };

  Object.values(cubes).forEach((cube) => {
    scene.add(cube.mesh);
  });

  const targetRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.07, 0.004, 8, 64),
    new THREE.MeshBasicMaterial({
      color: 0xe5484d,
      transparent: true,
      opacity: 0.82,
    })
  );
  targetRing.rotation.x = Math.PI / 2;
  targetRing.visible = false;

  const ghostPath = new THREE.Mesh(
    new THREE.TorusGeometry(0.36, 0.002, 8, 96),
    mats.ghost
  );
  ghostPath.position.set(0.5, 0.2, 0.31);
  ghostPath.scale.y = 0.45;
  ghostPath.rotation.x = Math.PI / 2;
  ghostPath.visible = false;

  return {
    trayDrop: trayCenter.clone().setZ(TABLE_TOP_Z + 0.072),
    cubes,
    targetRing,
    ghostPath,
  };
}

function createRobot(scene, mats, ui) {
  const root = new THREE.Group();
  scene.add(root);

  const fallback = new THREE.Group();
  fallback.visible = false;
  root.add(fallback);

  const baseBottom = ROBOT_BASE.clone();
  const baseTop = ROBOT_BASE.clone().add(new THREE.Vector3(0, 0, 0.11));

  const base = cylinderBetween(baseBottom, baseTop, 0.095, mats.joint);
  fallback.add(base);

  fallback.add(
    cylinderBetween(
      ROBOT_BASE.clone().add(new THREE.Vector3(0, 0, 0.108)),
      ROBOT_BASE.clone().add(new THREE.Vector3(0, 0, 0.145)),
      0.124,
      mats.robot
    )
  );

  const links = [
    cylinderBetween(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 0.04, mats.robot),
    cylinderBetween(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 0.035, mats.robot),
    cylinderBetween(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 0.027, mats.accent),
  ];

  links.forEach((link) => {
    fallback.add(link);
  });

  const joints = Array.from({ length: 4 }, () => {
    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.064, 32, 18), mats.joint);
    joint.castShadow = true;
    joint.receiveShadow = true;
    fallback.add(joint);
    return joint;
  });

  const gripper = new THREE.Group();
  const palm = mesh(new THREE.BoxGeometry(0.12, 0.052, 0.036), mats.joint, [0, 0, 0]);
  const leftFinger = mesh(
    new THREE.BoxGeometry(0.018, 0.032, 0.13),
    mats.accent,
    [-0.045, 0, -0.074]
  );
  const rightFinger = mesh(
    new THREE.BoxGeometry(0.018, 0.032, 0.13),
    mats.accent,
    [0.045, 0, -0.074]
  );

  gripper.add(palm, leftFinger, rightFinger);
  fallback.add(gripper);

  const robot = {
    root,
    fallback,
    links,
    joints,
    gripper,
    leftFinger,
    rightFinger,
    real: null,
    loadPromise: null,
  };

  robot.loadPromise = loadRealRobotModel(root, ui)
    .then((real) => {
      robot.real = real;
      real.root.visible = true;
      fallback.visible = false;

      if (ui.mode) {
        ui.mode.textContent = "AUBO i5 + AG95 model";
      }
    })
    .catch((error) => {
      console.warn("Falling back to geometric robot model", error);
      robot.fallback.visible = true;

      if (ui.mode) {
        ui.mode.textContent = "Model fallback render";
      }
    });

  return robot;
}

function updateRobot(robot, tcp, open, realPose = REAL_POSES.home) {
  const shoulder = ROBOT_BASE.clone().add(new THREE.Vector3(0, 0, 0.1575));
  const wristTarget = tcp.clone().add(new THREE.Vector3(0, 0, 0.16));
  const solution = solvePlanarArm(shoulder, wristTarget, 1.0);

  if (robot.real) {
    updateRealRobot(robot.real, open, realPose);
  }

  const points = [
    ROBOT_BASE.clone().add(new THREE.Vector3(0, 0, 0.1075)),
    shoulder,
    solution.elbow,
    solution.wrist,
    tcp,
  ];

  robot.links[0].userData.update(points[1], points[2]);
  robot.links[1].userData.update(points[2], points[3]);
  robot.links[2].userData.update(points[3], points[4]);

  robot.joints.forEach((joint, idx) => {
    joint.position.copy(points[idx + 1]);
  });

  const relTcp = tcp.clone().sub(ROBOT_BASE);
  const yaw = Math.atan2(relTcp.y, relTcp.x);

  robot.gripper.position.copy(tcp);
  robot.gripper.rotation.set(0, 0, yaw);

  robot.leftFinger.position.x = -Math.max(open, 0.026);
  robot.rightFinger.position.x = Math.max(open, 0.026);
}

async function loadRealRobotModel(root) {
  const baseUrl = "assets/robot/mjcf";
  const xmlUrl = `${baseUrl}/universal_robots_auboi5/aubo_i5_with_ag95.xml`;

  const xml = await fetch(xmlUrl).then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to load ${xmlUrl}: ${response.status}`);
    }
    return response.text();
  });

  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const materialMap = parseMjcfMaterials(doc);
  const meshMap = parseMjcfMeshes(doc, baseUrl);

  const model = new THREE.Group();
  model.name = "autron-public-mjcf-aubo-i5-ag95";
  model.visible = false;
  root.add(model);

  const bodyMap = new Map();
  const jointMap = new Map();
  const siteMap = new Map();
  const assetCache = new Map();

  const robotBody = doc.querySelector('worldbody > body[name="base_link"]');
  if (!robotBody) {
    throw new Error("AUBO base_link body not found in public MJCF");
  }

  await buildMjcfBody(robotBody, model, {
    materialMap,
    meshMap,
    bodyMap,
    jointMap,
    siteMap,
    assetCache,
  });

  const baseLink = bodyMap.get("base_link");
  const rootOffset = baseLink?.position || new THREE.Vector3();

  model.position.set(
    ROBOT_BASE.x - rootOffset.x * REAL_MODEL_SCALE,
    ROBOT_BASE.y - rootOffset.y * REAL_MODEL_SCALE,
    0
  );
  model.rotation.z = 0;
  model.scale.setScalar(REAL_MODEL_SCALE);

  // Align the lowest mesh point to the tabletop. This avoids floating or sinking.
  alignObjectBottomToZ(model, TABLE_TOP_Z);

  const real = {
    root: model,
    bodyMap,
    sites: {
      eef: siteMap.get("eef_site"),
      attachment: siteMap.get("attachment_site"),
    },
    joints: {
      shoulderPan: jointMap.get("shoulder_pan_joint"),
      shoulderLift: jointMap.get("shoulder_lift_joint"),
      elbow: jointMap.get("elbow_joint"),
      wrist1: jointMap.get("wrist_1_joint"),
      wrist2: jointMap.get("wrist_2_joint"),
      wrist3: jointMap.get("wrist_3_joint"),
      leftOuterKnuckle: jointMap.get("left_outer_knuckle_joint"),
      rightOuterKnuckle: jointMap.get("right_outer_knuckle_joint"),
      leftFinger: jointMap.get("left_finger_joint"),
      rightFinger: jointMap.get("right_finger_joint"),
      leftInnerKnuckle: jointMap.get("left_inner_knuckle_joint"),
      rightInnerKnuckle: jointMap.get("right_inner_knuckle_joint"),
    },
  };

  updateRealRobot(real, 0.1, REAL_POSES.home);

  return real;
}

function updateRealRobot(real, open, realPose) {
  applyMjcfJoint(real.joints.shoulderPan, realPose.shoulderPan);
  applyMjcfJoint(real.joints.shoulderLift, realPose.shoulderLift);
  applyMjcfJoint(real.joints.elbow, realPose.elbow);
  applyMjcfJoint(real.joints.wrist1, realPose.wrist1);
  applyMjcfJoint(real.joints.wrist2, realPose.wrist2);
  applyMjcfJoint(real.joints.wrist3, realPose.wrist3);

  const closed = clamp(1 - open / 0.1, 0, 1);
  const grip = 0.22 + closed * 0.42;

  applyMjcfJoint(real.joints.leftOuterKnuckle, -grip);
  applyMjcfJoint(real.joints.rightOuterKnuckle, -grip);
  applyMjcfJoint(real.joints.leftInnerKnuckle, grip * 1.08);
  applyMjcfJoint(real.joints.rightInnerKnuckle, grip * 1.08);
  applyMjcfJoint(real.joints.leftFinger, grip * 0.45);
  applyMjcfJoint(real.joints.rightFinger, grip * 0.45);
}

function getRobotTcpWorldPosition(robot, fallback) {
  const site = robot.real?.sites?.eef;

  if (!site) {
    return fallback.clone();
  }

  robot.root.updateWorldMatrix(true, true);
  site.updateWorldMatrix(true, false);

  const position = new THREE.Vector3();
  site.getWorldPosition(position);
  return position;
}

async function buildMjcfBody(bodyEl, parent, context) {
  const group = new THREE.Group();
  group.name = bodyEl.getAttribute("name") || "body";

  const pos = parseNumbers(bodyEl.getAttribute("pos"), [0, 0, 0]);
  group.position.set(pos[0], pos[1], pos[2]);

  group.quaternion.copy(parseOrientation(bodyEl));
  group.userData.baseQuaternion = group.quaternion.clone();

  parent.add(group);
  context.bodyMap.set(group.name, group);

  const jointEl = Array.from(bodyEl.children).find((child) => {
    return child.tagName.toLowerCase() === "joint";
  });

  if (jointEl) {
    const jointName = jointEl.getAttribute("name");
    const axis = parseNumbers(jointEl.getAttribute("axis"), [0, 0, 1]);

    group.userData.jointAxis = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
    group.userData.jointValue = 0;

    if (jointName) {
      context.jointMap.set(jointName, group);
    }
  }

  const geoms = Array.from(bodyEl.children).filter((child) => {
    return child.tagName.toLowerCase() === "geom";
  });

  const renderedGeoms = await Promise.all(geoms.map((geomEl) => {
    const visual =
      geomEl.getAttribute("class") === "visual" ||
      geomEl.getAttribute("class") === "aubo_visual";

    if (!visual) return null;

    return createMjcfGeom(geomEl, context);
  }));

  renderedGeoms.forEach((rendered) => {
    if (rendered) {
      group.add(rendered);
    }
  });

  const sites = Array.from(bodyEl.children).filter((child) => {
    return child.tagName.toLowerCase() === "site";
  });

  sites.forEach((siteEl) => {
    const site = new THREE.Group();
    site.name = siteEl.getAttribute("name") || "site";

    const sitePos = parseNumbers(siteEl.getAttribute("pos"), [0, 0, 0]);
    site.position.set(sitePos[0], sitePos[1], sitePos[2]);
    site.quaternion.copy(parseOrientation(siteEl));

    group.add(site);
    context.siteMap.set(site.name, site);
  });

  const childBodies = Array.from(bodyEl.children).filter((child) => {
    return child.tagName.toLowerCase() === "body";
  });

  await Promise.all(childBodies.map((childBody) => buildMjcfBody(childBody, group, context)));
}

async function createMjcfGeom(geomEl, context) {
  let object = null;

  const type = geomEl.getAttribute("type") || (geomEl.hasAttribute("mesh") ? "mesh" : "box");
  const material =
    context.materialMap.get(geomEl.getAttribute("material")) ||
    defaultMjcfMaterial(geomEl);

  if (type === "mesh") {
    const meshName = geomEl.getAttribute("mesh");
    const meshDef = context.meshMap.get(meshName);

    if (!meshDef) {
      return null;
    }

    object = await loadMeshObject(meshDef, material, context.assetCache);
  } else if (type === "box") {
    const size = parseNumbers(geomEl.getAttribute("size"), [0.03, 0.03, 0.03]);
    object = new THREE.Mesh(
      new THREE.BoxGeometry(size[0] * 2, size[1] * 2, size[2] * 2),
      material
    );
  } else if (type === "cylinder") {
    const size = parseNumbers(geomEl.getAttribute("size"), [0.03, 0.03]);
    object = new THREE.Mesh(
      new THREE.CylinderGeometry(size[0], size[0], size[1] * 2, 32),
      material
    );
    object.rotation.x = Math.PI / 2;
  } else if (type === "sphere") {
    const size = parseNumbers(geomEl.getAttribute("size"), [0.03]);
    object = new THREE.Mesh(new THREE.SphereGeometry(size[0], 32, 18), material);
  }

  if (!object) {
    return null;
  }

  const pos = parseNumbers(geomEl.getAttribute("pos"), [0, 0, 0]);
  object.position.set(pos[0], pos[1], pos[2]);
  object.quaternion.premultiply(parseOrientation(geomEl));

  object.traverse((child) => {
    if (!child.isMesh) return;

    child.castShadow = true;
    child.receiveShadow = true;
    child.material = material;
  });

  return object;
}

async function loadMeshObject(meshDef, material, assetCache) {
  const cacheKey = `${meshDef.url}|${meshDef.scale.join(",")}`;

  if (!assetCache.has(cacheKey)) {
    assetCache.set(cacheKey, loadMeshObjectFresh(meshDef, material));
  }

  const source = await assetCache.get(cacheKey);
  const clone = source.clone(true);

  clone.traverse((child) => {
    if (child.isMesh) {
      child.material = material;
    }
  });

  return clone;
}

function loadMeshObjectFresh(meshDef, material) {
  const ext = meshDef.url.split(".").pop().toLowerCase();

  if (ext === "obj") {
    const loader = new OBJLoader();

    return new Promise((resolve, reject) => {
      loader.load(
        meshDef.url,
        (object) => {
          object.scale.set(meshDef.scale[0], meshDef.scale[1], meshDef.scale[2]);

          object.traverse((child) => {
            if (!child.isMesh) return;

            child.material = material;
            child.castShadow = true;
            child.receiveShadow = true;
          });

          resolve(object);
        },
        undefined,
        reject
      );
    });
  }

  const loader = new STLLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      meshDef.url,
      (geometry) => {
        const object = new THREE.Mesh(geometry, material);
        object.scale.set(meshDef.scale[0], meshDef.scale[1], meshDef.scale[2]);
        object.castShadow = true;
        object.receiveShadow = true;
        resolve(object);
      },
      undefined,
      reject
    );
  });
}

function parseMjcfMaterials(doc) {
  const map = new Map();

  doc.querySelectorAll("asset > material").forEach((el) => {
    const name = el.getAttribute("name") || "";
    map.set(name, styledRobotMaterial(name, el.getAttribute("rgba")));
  });

  return map;
}

function parseMjcfMeshes(doc, baseUrl) {
  const map = new Map();

  doc.querySelectorAll("asset > mesh[file]").forEach((el) => {
    const file = el.getAttribute("file");
    const fallbackName = file.split("/").pop().replace(/\.[^.]+$/, "");
    const name = el.getAttribute("name") || fallbackName;
    const scale = parseNumbers(el.getAttribute("scale"), [1, 1, 1]);

    map.set(name, {
      url: normalizeAssetPath(`${baseUrl}/universal_robots_auboi5/${file}`),
      scale,
    });
  });

  return map;
}

function normalizeAssetPath(path) {
  const out = [];

  path.split("/").forEach((part) => {
    if (!part || part === ".") return;

    if (part === "..") {
      out.pop();
    } else {
      out.push(part);
    }
  });

  return out.join("/");
}

function defaultMjcfMaterial(geomEl) {
  return styledRobotMaterial("", geomEl.getAttribute("rgba"));
}

function styledRobotMaterial(name, rgbaAttr) {
  const lower = name.toLowerCase();

  let color = new THREE.Color(0xf8fafc);
  let roughness = 0.48;
  let metalness = 0.16;
  let opacity = 1;

  if (lower.includes("63,63,63") || lower.includes("black")) {
    color = new THREE.Color(0x1f2937);
    roughness = 0.34;
    metalness = 0.3;
  } else if (lower.includes("232,133,0")) {
    color = new THREE.Color(0xe98512);
    roughness = 0.44;
    metalness = 0.16;
  } else if (lower.includes("grey")) {
    color = new THREE.Color(0x0f766e);
    roughness = 0.46;
    metalness = 0.18;
  } else if (lower.includes("202,209,238")) {
    color = new THREE.Color(0xdce7f2);
  } else if (rgbaAttr) {
    const rgba = parseNumbers(rgbaAttr, [0.8, 0.84, 0.88, 1]);
    opacity = rgba[3];

    const source = new THREE.Color(rgba[0], rgba[1], rgba[2]);
    color = source.lerp(new THREE.Color(0xf8fafc), 0.45);
  }

  return new THREE.MeshStandardMaterial({
    color,
    opacity,
    transparent: opacity < 1,
    roughness,
    metalness,
  });
}

function applyMjcfJoint(group, value) {
  if (!group) return;

  const base = group.userData.baseQuaternion || new THREE.Quaternion();
  const axis = group.userData.jointAxis || new THREE.Vector3(0, 0, 1);

  group.quaternion
    .copy(base)
    .multiply(new THREE.Quaternion().setFromAxisAngle(axis, value));
}

function parseOrientation(el) {
  if (el.hasAttribute("quat")) {
    const q = parseNumbers(el.getAttribute("quat"), [1, 0, 0, 0]);
    return new THREE.Quaternion(q[1], q[2], q[3], q[0]);
  }

  if (el.hasAttribute("euler")) {
    const e = parseNumbers(el.getAttribute("euler"), [0, 0, 0]);
    return new THREE.Quaternion().setFromEuler(
      new THREE.Euler(e[0], e[1], e[2], "XYZ")
    );
  }

  return new THREE.Quaternion();
}

function parseNumbers(value, fallback) {
  if (!value) {
    return [...fallback];
  }

  const numbers = value
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter(Number.isFinite);

  return numbers.length ? numbers : [...fallback];
}

function solvePlanarArm(origin, wristTarget, scale = 1.0, radialOffset = 0, lateralOffset = 0) {
  const l1 = 0.408 * scale;
  const l2 = 0.376 * scale;

  const rel = wristTarget.clone().sub(origin);
  const xyDist = Math.hypot(rel.x, rel.y);
  
  // atan2(y, x) points directly at the target, but we need to yaw slightly
  // to bring the laterally-offset wrist to the target point.
  let yaw = Math.atan2(rel.y, rel.x);
  if (xyDist > Math.abs(lateralOffset)) {
    yaw -= Math.asin(clamp(lateralOffset / xyDist, -1, 1));
  }

  // The radial distance in the arm's rotated plane
  const radial = Math.sqrt(Math.max(xyDist ** 2 - lateralOffset ** 2, 0.001)) - radialOffset;
  const z = rel.z;

  const rawDistance = Math.max(Math.hypot(radial, z), 0.001);
  const reach = clamp(rawDistance, 0.12, l1 + l2 - 0.012);
  const ratio = reach / rawDistance;

  const safeRadial = Math.max(0.08, radial * ratio);
  const safeZ = z * ratio;

  const cosElbow = clamp(
    (safeRadial ** 2 + safeZ ** 2 - l1 ** 2 - l2 ** 2) / (2 * l1 * l2),
    -0.96,
    0.96
  );

  const elbow = -Math.acos(cosElbow);

  const shoulder =
    Math.atan2(safeZ, safeRadial) -
    Math.atan2(l2 * Math.sin(elbow), l1 + l2 * Math.cos(elbow));

  const dir = new THREE.Vector3(Math.cos(yaw), Math.sin(yaw), 0);

  const elbowPos = origin
    .clone()
    .add(dir.clone().multiplyScalar(l1 * Math.cos(shoulder)))
    .add(new THREE.Vector3(0, 0, l1 * Math.sin(shoulder)));

  const wrist = elbowPos
    .clone()
    .add(dir.clone().multiplyScalar(l2 * Math.cos(shoulder + elbow)))
    .add(new THREE.Vector3(0, 0, l2 * Math.sin(shoulder + elbow)));

  return {
    elbow: elbowPos,
    wrist,
    shoulder,
    elbowBend: elbow,
    yaw,
  };
}

function buildSequence(cube, trayDrop) {
  const cubePoses = REAL_POSES.tasks[cube.label] || REAL_POSES.tasks.red;
  const home = estimateTcpFromPose(REAL_POSES.home);
  const start = cube.home
    .clone()
    .add(GRASP_VISUAL_TCP_BIAS)
    .sub(TCP_TO_CUBE_CENTER);
  const mid = estimateTcpFromPose(REAL_POSES.carryMid);
  const end = getCubeDropPosition(cube, trayDrop)
    .add(GRASP_VISUAL_TCP_BIAS)
    .sub(TCP_TO_CUBE_CENTER);

  return [
    step("Scene scan", 0, 0.6, home, 0.1, {
      realPose: REAL_POSES.home,
    }),

    step("Moving from home to cube start", 1, 1.2, start, cubePoses.start.open, {
      realPose: cubePoses.start.pose,
    }),

    step("Closing gripper at start", 2, 0.55, start, cubePoses.end.open, {
      attach: true,
      attachAt: 0.72,
      realPose: cubePoses.start.pose,
    }),

    step("Carrying through fixed midpoint", 3, 1.25, mid, cubePoses.end.open, {
      realPose: REAL_POSES.carryMid,
    }),

    step("Moving from midpoint to task end", 3, 1.25, end, cubePoses.end.open, {
      realPose: cubePoses.end.pose,
    }),

    step("Opening gripper at end", 4, 0.55, end, 0.1, {
      release: true,
      releaseAt: 0.2,
      realPose: cubePoses.end.pose,
    }),

    step("Returning home", 4, 1.0, home, 0.1, {
      realPose: REAL_POSES.home,
    }),
  ];
}

function createAutronPoseTable() {
  return {
    home: pose(0, 0, 0, 0, 0, 0),
    carryMid: pose(0.42, 0.25, 1.57, 0.891, 1.541, 0),
    tasks: {
      red: {
        start: {
          pose: pose(-0.009, 0.0236, 2.141, 0.8166, 1.6004, 0.0461),
          open: 0.1,
        },
        end: {
          pose: pose(0.471, -0.5883, 1.2068, 0.2029, 1.8896, 0.041),
          open: 0.032,
        },
      },
      blue: {
        start: {
          pose: pose(0.1203, -0.1966, 2.0507, 1.1411, 1.5885, 0),
          open: 0.1,
        },
        end: {
          pose: pose(0.541, -0.6492, 1.2098, 0.6193, 1.4902, 0),
          open: 0.032,
        },
      },
      yellow: {
        start: {
          pose: pose(0.3868, -0.0304, 2.291, 1.3191, 1.6252, 0),
          open: 0.1,
        },
        end: {
          pose: pose(0.711, -0.6116, 1.2671, 0.6226, 1.4466, 0),
          open: 0.032,
        },
      },
    },
  };
}

function demoSurfacePoint(x, y, localZ = 0) {
  return new THREE.Vector3(x, y, TABLE_TOP_Z + localZ);
}

function estimateTcpFromPose(robotPose) {
  const base = new THREE.Group();
  base.position.copy(ROBOT_BASE).add(BAKED_ROBOT_ORIGIN);

  const shoulderPan = addKinematicNode(base, [0, 0, 0.0435], [0, 0, 1], robotPose.shoulderPan);
  const shoulderLift = addKinematicNode(shoulderPan, [0, -0.062, 0.0785], [0, -1, 0], robotPose.shoulderLift);
  const elbow = addKinematicNode(shoulderLift, [0, 0, 0.408], [0, 1, 0], robotPose.elbow);
  const wrist1 = addKinematicNode(elbow, [0, -0.0175, 0.376], [0, -1, 0], robotPose.wrist1);
  const wrist2 = addKinematicNode(wrist1, [0, -0.042, 0.06056], [0, 0, 1], robotPose.wrist2);
  const wrist3 = addKinematicNode(wrist2, [0, -0.06056, 0.042], [0, -1, 0], robotPose.wrist3);

  const tool0 = new THREE.Group();
  tool0.position.set(0, -0.0335, 0);
  tool0.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  wrist3.add(tool0);

  const eef = new THREE.Group();
  eef.position.set(0, 0, 0.2);
  eef.quaternion.set(0, -0.7071068, -0.7071068, 0);
  tool0.add(eef);

  base.scale.setScalar(REAL_MODEL_SCALE);
  base.updateWorldMatrix(true, true);

  const point = new THREE.Vector3();
  eef.getWorldPosition(point);
  return point;
}

function addKinematicNode(parent, position, axis, value) {
  const node = new THREE.Group();
  node.position.set(position[0], position[1], position[2]);
  node.quaternion.setFromAxisAngle(new THREE.Vector3(axis[0], axis[1], axis[2]).normalize(), value);
  parent.add(node);
  return node;
}

function cubeCenter(label) {
  const source = AUTRON_SCENE.cubes[label] || AUTRON_SCENE.cubes.red;
  const point = demoSurfacePoint(source[0], source[1], source[2] + CUBE_SIZE / 2);
  return [point.x, point.y, point.z];
}

function getCubeDropPosition(cube, trayDrop) {
  const offsets = {
    red: new THREE.Vector3(-0.045, -0.025, 0),
    blue: new THREE.Vector3(0.045, -0.025, 0),
    yellow: new THREE.Vector3(0, 0.045, 0),
  };

  return trayDrop
    .clone()
    .add(offsets[cube.label] || new THREE.Vector3())
    .setZ(TABLE_TOP_Z + CUBE_SIZE / 2 + 0.03);
}

function interpolateTarget(from, to, t, arcHeight = 0) {
  const point = from.clone().lerp(to, t);
  
  if (arcHeight > 0) {
    // Smoother arched trajectory using sine instead of a sharp quadratic bezier
    const maxZ = Math.max(from.z, to.z);
    const peakOffset = (maxZ + arcHeight) - ((from.z + to.z) / 2);
    point.z += Math.sin(t * Math.PI) * peakOffset;
  }

  return point;
}

function updateCameraOrbit(camera, controls, now) {
  const angle = -0.75 + now * CAMERA_ORBIT_SPEED;
  camera.position.set(
    CAMERA_ORBIT_TARGET.x + Math.cos(angle) * CAMERA_ORBIT_RADIUS,
    CAMERA_ORBIT_TARGET.y + Math.sin(angle) * CAMERA_ORBIT_RADIUS,
    CAMERA_ORBIT_HEIGHT
  );
  controls.target.copy(CAMERA_ORBIT_TARGET);
  camera.lookAt(CAMERA_ORBIT_TARGET);
}

function pose(shoulderPan, shoulderLift, elbow, wrist1, wrist2, wrist3) {
  return {
    shoulderPan,
    shoulderLift,
    elbow,
    wrist1,
    wrist2,
    wrist3,
  };
}

function interpolatePose(from, to, t) {
  return pose(
    lerpAngle(from.shoulderPan, to.shoulderPan, t),
    lerpAngle(from.shoulderLift, to.shoulderLift, t),
    lerpAngle(from.elbow, to.elbow, t),
    lerpAngle(from.wrist1, to.wrist1, t),
    lerpAngle(from.wrist2, to.wrist2, t),
    lerpAngle(from.wrist3, to.wrist3, t)
  );
}

function lerpAngle(from, to, t) {
  let delta = to - from;

  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;

  return from + delta * t;
}

function quadraticBezier(a, b, c, t) {
  const ab = a.clone().lerp(b, t);
  const bc = b.clone().lerp(c, t);
  return ab.lerp(bc, t);
}

function alignObjectBottomToZ(object, z) {
  object.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object);

  if (!Number.isFinite(box.min.z)) {
    return;
  }

  object.position.z += z - box.min.z;
  object.updateMatrixWorld(true);
}

function step(status, uiStep, duration, target, open, flags = {}) {
  return {
    status,
    uiStep,
    duration,
    target,
    open,
    ...flags,
  };
}

function createCube(label, hex, mat, position) {
  const meshObj = mesh(new THREE.BoxGeometry(0.055, 0.055, 0.055), mat, position);
  meshObj.quaternion.identity();

  return {
    label,
    hex,
    home: new THREE.Vector3(...position),
    mesh: meshObj,
  };
}

function cylinderBetween(start, end, radius, mat) {
  const geometry = new THREE.CylinderGeometry(radius, radius, 1, 32);
  const object = new THREE.Mesh(geometry, mat);

  object.castShadow = true;
  object.receiveShadow = true;

  object.userData.update = (from, to) => {
    const delta = to.clone().sub(from);
    const length = Math.max(delta.length(), 0.001);

    object.scale.set(1, length, 1);
    object.position.copy(from).addScaledVector(delta, 0.5);
    object.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      delta.normalize()
    );
  };

  object.userData.update(start, end);

  return object;
}

function mesh(geometry, mat, position) {
  const object = new THREE.Mesh(geometry, mat);

  object.position.set(...position);
  object.castShadow = true;
  object.receiveShadow = true;

  return object;
}

function material(color, roughness, metalness) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
  });
}

function smooth(t) {
  // Smootherstep interpolation for more natural arm movement
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
