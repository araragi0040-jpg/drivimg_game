import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import './styles.css';

const WORLD_SIZE = 168;
const ROAD_W = 13;
const ROAD_CENTERS = [-48, 0, 48];
const CAR_WHEEL_MAX = 450; // steering wheel: ±450° = 900° lock-to-lock
const SCOOTER_BAR_MAX = 55;
const CAMERA_MODES = ['CHASE', 'HOOD', 'COCKPIT'];

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}
function normalizeDeg(delta) {
  let d = delta;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}
function dist2D(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

function makeRoundedBox(w, h, d, color, roughness = .65, metalness = .08) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createCarModel(color = 0x17283a, npc = false) {
  const root = new THREE.Group();
  const body = makeRoundedBox(2.12, .7, 4.15, color, .32, .52);
  body.position.y = .74;
  root.add(body);

  const hood = makeRoundedBox(1.92, .22, 1.08, color, .32, .5);
  hood.position.set(0, 1.0, -1.46);
  root.add(hood);

  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x17202a, roughness: .13, metalness: .28 });
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.72, .82, 2.03), cabinMat);
  cabin.position.set(0, 1.28, -.12);
  cabin.castShadow = true;
  root.add(cabin);

  const bumper = makeRoundedBox(2.08, .18, .16, 0x12171d, .7, .35);
  bumper.position.set(0, .58, 2.08);
  root.add(bumper);

  const frontWheelPivots = [];
  const wheelMeshes = [];
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x101214, roughness: .9, metalness: .05 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x777d84, roughness: .35, metalness: .65 });
  const positions = [
    [-1.08, .46, -1.33, true], [1.08, .46, -1.33, true],
    [-1.08, .46, 1.34, false], [1.08, .46, 1.34, false],
  ];
  positions.forEach(([x, y, z, front]) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(.38, .38, .34, 18), wheelMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(.21, .21, .355, 14), rimMat);
    rim.rotation.z = Math.PI / 2;
    pivot.add(tire, rim);
    root.add(pivot);
    wheelMeshes.push({ tire, rim });
    if (front) frontWheelPivots.push(pivot);
  });

  const lightFront = new THREE.MeshBasicMaterial({ color: 0xdbefff });
  const lightRear = new THREE.MeshBasicMaterial({ color: 0xff3b35 });
  [-.7, .7].forEach(x => {
    const h = new THREE.Mesh(new THREE.BoxGeometry(.42, .17, .06), lightFront);
    h.position.set(x, .8, -2.09);
    root.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(.44, .18, .055), lightRear);
    t.position.set(x, .79, 2.09);
    root.add(t);
  });

  if (!npc) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(.78, .24, .04), new THREE.MeshBasicMaterial({ color: 0xe8ebed }));
    plate.position.set(0, .59, 2.18);
    root.add(plate);
  }

  root.userData.frontWheelPivots = frontWheelPivots;
  root.userData.wheelMeshes = wheelMeshes;
  return root;
}

function createScooterModel() {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x253b55, roughness: .34, metalness: .42 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x11161b, roughness: .82 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0x9ca6af, roughness: .28, metalness: .8 });

  const lower = new THREE.Mesh(new THREE.BoxGeometry(.72, .64, 1.45), bodyMat);
  lower.position.set(0, .72, .15);
  lower.castShadow = true;
  root.add(lower);

  const frontFairing = new THREE.Mesh(new THREE.BoxGeometry(.56, 1.1, .5), bodyMat);
  frontFairing.position.set(0, 1.16, -.7);
  frontFairing.castShadow = true;
  root.add(frontFairing);

  const seat = new THREE.Mesh(new THREE.BoxGeometry(.62, .22, .92), dark);
  seat.position.set(0, 1.18, .46);
  seat.castShadow = true;
  root.add(seat);

  const frontPivot = new THREE.Group();
  frontPivot.position.set(0, .42, -.92);
  const frontWheel = new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, .16, 18), dark);
  frontWheel.rotation.z = Math.PI / 2;
  frontWheel.castShadow = true;
  frontPivot.add(frontWheel);
  root.add(frontPivot);

  const rearWheel = new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, .18, 18), dark);
  rearWheel.rotation.z = Math.PI / 2;
  rearWheel.position.set(0, .42, .86);
  rearWheel.castShadow = true;
  root.add(rearWheel);

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(.045, .055, 1.05, 8), chrome);
  stem.position.set(0, 1.22, -.76);
  stem.rotation.x = -.12;
  root.add(stem);

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .82, 8), chrome);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0, 1.72, -.81);
  root.add(handle);

  const lamp = new THREE.Mesh(new THREE.SphereGeometry(.16, 12, 10), new THREE.MeshBasicMaterial({ color: 0xeaf6ff }));
  lamp.scale.z = .4;
  lamp.position.set(0, 1.48, -1.0);
  root.add(lamp);

  root.userData.frontPivot = frontPivot;
  root.userData.wheels = [frontWheel, rearWheel];
  return root;
}

function createTrafficLight(scene, x, z, rotationY = 0) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  root.rotation.y = rotationY;
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a4249, roughness: .58, metalness: .55 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.1, .13, 4.5, 9), poleMat);
  pole.position.y = 2.25;
  root.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, .12, .12), poleMat);
  arm.position.set(.95, 4.28, 0);
  root.add(arm);
  const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(.66, 1.82, .46), new THREE.MeshStandardMaterial({ color: 0x151a1f, roughness: .75 }));
  caseMesh.position.set(1.85, 3.75, 0);
  root.add(caseMesh);
  const lamps = {};
  [['red', 4.24], ['yellow', 3.75], ['green', 3.26]].forEach(([name, y]) => {
    const mat = new THREE.MeshBasicMaterial({ color: 0x24282b });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.19, 14, 10), mat);
    bulb.scale.z = .45;
    bulb.position.set(1.85, y, -.25);
    root.add(bulb);
    lamps[name] = mat;
  });
  scene.add(root);
  return { root, lamps };
}

function setLamp(signal, phase) {
  const off = 0x23272a;
  signal.lamps.red.color.setHex(phase === 'RED' ? 0xff4038 : off);
  signal.lamps.yellow.color.setHex(phase === 'YELLOW' ? 0xffc53d : off);
  signal.lamps.green.color.setHex(phase === 'GREEN' ? 0x50e37a : off);
}

function signalPhases(totalSeconds) {
  const t = totalSeconds % 30;
  if (t < 12) return { ns: 'GREEN', ew: 'RED' };
  if (t < 15) return { ns: 'YELLOW', ew: 'RED' };
  if (t < 27) return { ns: 'RED', ew: 'GREEN' };
  return { ns: 'RED', ew: 'YELLOW' };
}

function App() {
  const mountRef = useRef(null);
  const gameRef = useRef({});
  const controlsRef = useRef({
    keyLeft: false,
    keyRight: false,
    accel: false,
    brake: false,
    steerInput: 0,
    steeringDragging: false,
  });
  const wheelDragRef = useRef({ active: false, pointerId: null, lastAngle: 0, rotation: 0 });
  const audioRef = useRef(null);

  const [speedKmh, setSpeedKmh] = useState(0);
  const [gear, setGear] = useState('D');
  const [elapsed, setElapsed] = useState(0);
  const [wheelDeg, setWheelDeg] = useState(0);
  const [roadWheelDeg, setRoadWheelDeg] = useState(0);
  const [carPos, setCarPos] = useState({ x: 0, z: 30, heading: 0 });
  const [npcDots, setNpcDots] = useState([]);
  const [paused, setPaused] = useState(false);
  const [accelPressed, setAccelPressed] = useState(false);
  const [brakePressed, setBrakePressed] = useState(false);
  const [cameraMode, setCameraMode] = useState('CHASE');
  const [vehicleMode, setVehicleMode] = useState('CAR');
  const [soundOn, setSoundOn] = useState(false);
  const [signalState, setSignalState] = useState({ ns: 'GREEN', ew: 'RED' });

  const mapRoads = useMemo(() => ROAD_CENTERS.map(v => (v / WORLD_SIZE) * 100 + 50), []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xa4cae2);
    scene.fog = new THREE.Fog(0xa4cae2, 80, 188);

    const camera = new THREE.PerspectiveCamera(62, 1, .1, 420);
    const rearCamera = new THREE.PerspectiveCamera(56, 4.1, .1, 240);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.autoClear = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xecf8ff, 0x4b5964, 2.12);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.3);
    sun.position.set(38, 62, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -92;
    sun.shadow.camera.right = 92;
    sun.shadow.camera.top = 92;
    sun.shadow.camera.bottom = -92;
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
      new THREE.MeshStandardMaterial({ color: 0x73836e, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const roadMat = new THREE.MeshStandardMaterial({ color: 0x4b5359, roughness: .98 });
    const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xb9bec1, roughness: .96 });
    const curbMat = new THREE.MeshStandardMaterial({ color: 0xd8d9d7, roughness: .9 });
    const lineWhite = new THREE.MeshBasicMaterial({ color: 0xf8f7e8 });
    const lineYellow = new THREE.MeshBasicMaterial({ color: 0xf1cf58 });

    function addRoad(horizontal, center) {
      const road = new THREE.Mesh(
        new THREE.PlaneGeometry(horizontal ? WORLD_SIZE : ROAD_W, horizontal ? ROAD_W : WORLD_SIZE),
        roadMat
      );
      road.rotation.x = -Math.PI / 2;
      road.position.set(horizontal ? 0 : center, .012, horizontal ? center : 0);
      road.receiveShadow = true;
      scene.add(road);

      [-1, 1].forEach(side => {
        const sw = new THREE.Mesh(
          new THREE.BoxGeometry(horizontal ? WORLD_SIZE : 2.15, .24, horizontal ? 2.15 : WORLD_SIZE),
          sidewalkMat
        );
        sw.position.set(
          horizontal ? 0 : center + side * (ROAD_W / 2 + 1.08),
          .12,
          horizontal ? center + side * (ROAD_W / 2 + 1.08) : 0
        );
        sw.receiveShadow = true;
        scene.add(sw);
        const curb = new THREE.Mesh(
          new THREE.BoxGeometry(horizontal ? WORLD_SIZE : .2, .18, horizontal ? .2 : WORLD_SIZE),
          curbMat
        );
        curb.position.set(
          horizontal ? 0 : center + side * (ROAD_W / 2 + .1),
          .12,
          horizontal ? center + side * (ROAD_W / 2 + .1) : 0
        );
        scene.add(curb);
      });

      for (let p = -WORLD_SIZE / 2 + 3.8; p < WORLD_SIZE / 2; p += 8.2) {
        const dash = new THREE.Mesh(
          new THREE.PlaneGeometry(horizontal ? 3.4 : .13, horizontal ? .13 : 3.4),
          lineWhite
        );
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(horizontal ? p : center, .024, horizontal ? center : p);
        scene.add(dash);
      }

      [-3.1, 3.1].forEach(offset => {
        const edge = new THREE.Mesh(
          new THREE.PlaneGeometry(horizontal ? WORLD_SIZE : .08, horizontal ? .08 : WORLD_SIZE),
          lineYellow
        );
        edge.rotation.x = -Math.PI / 2;
        edge.position.set(horizontal ? 0 : center + offset, .025, horizontal ? center + offset : 0);
        edge.material = new THREE.MeshBasicMaterial({ color: 0xf2f1e8, transparent: true, opacity: .35 });
        scene.add(edge);
      });
    }
    ROAD_CENTERS.forEach(c => { addRoad(true, c); addRoad(false, c); });

    // crosswalk at center intersection
    for (let i = -4; i <= 4; i++) {
      const stripeA = new THREE.Mesh(new THREE.PlaneGeometry(.7, 3.7), lineWhite);
      stripeA.rotation.x = -Math.PI / 2;
      stripeA.position.set(i * 1.15, .03, 7.4);
      scene.add(stripeA);
      const stripeB = stripeA.clone();
      stripeB.position.z = -7.4;
      scene.add(stripeB);
      const stripeC = new THREE.Mesh(new THREE.PlaneGeometry(3.7, .7), lineWhite);
      stripeC.rotation.x = -Math.PI / 2;
      stripeC.position.set(7.4, .03, i * 1.15);
      scene.add(stripeC);
      const stripeD = stripeC.clone();
      stripeD.position.x = -7.4;
      scene.add(stripeD);
    }

    const colliders = [];
    const palette = [0xd9dcdf, 0xcbd4db, 0xdfd5c9, 0xc2cdc5, 0xcac7d6, 0xd8c9c1, 0xc1d1dc];
    const blocks = [-70, -24, 24, 70];
    let bi = 0;
    blocks.forEach(cx => {
      blocks.forEach(cz => {
        const w = 19 + ((bi * 7) % 6);
        const d = 19 + ((bi * 5) % 6);
        const h = 12 + ((bi * 13) % 28);
        bi += 1;
        const building = makeRoundedBox(w, h, d, palette[bi % palette.length], .82, .04);
        building.position.set(cx, h / 2 + .25, cz);
        scene.add(building);
        colliders.push({ minX: cx - w / 2 - 1.1, maxX: cx + w / 2 + 1.1, minZ: cz - d / 2 - 1.1, maxZ: cz + d / 2 + 1.1 });

        // windows
        const windowMat = new THREE.MeshBasicMaterial({ color: 0x7294a7, transparent: true, opacity: .58 });
        for (let y = 4.0; y < h - 1.8; y += 5.8) {
          for (let x = -w / 2 + 2.2; x < w / 2 - 1.2; x += 4.4) {
            const win = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25), windowMat);
            win.position.set(cx + x, y, cz - d / 2 - .011);
            win.rotation.y = Math.PI;
            scene.add(win);
          }
        }
      });
    });

    const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x684b30, roughness: 1 });
    const treeLeafMat = new THREE.MeshStandardMaterial({ color: 0x4f8b52, roughness: .92 });
    function addTree(x, z) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.24, .32, 2.35, 8), treeTrunkMat);
      trunk.position.set(x, 1.17, z);
      trunk.castShadow = true;
      scene.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8), treeLeafMat);
      crown.position.set(x, 2.85, z);
      crown.castShadow = true;
      scene.add(crown);
    }
    [-62, -34, 34, 62].forEach(x => { addTree(x, -8.5); addTree(x, 8.5); });
    [-62, -34, 34, 62].forEach(z => { addTree(-8.5, z); addTree(8.5, z); });

    // traffic signals at center
    const signals = {
      ns: [
        createTrafficLight(scene, -8.9, 8.9, Math.PI),
        createTrafficLight(scene, 8.9, -8.9, 0),
      ],
      ew: [
        createTrafficLight(scene, -8.9, -8.9, Math.PI / 2),
        createTrafficLight(scene, 8.9, 8.9, -Math.PI / 2),
      ],
    };

    // player models
    const car = createCarModel(0x172b40, false);
    car.position.set(2.55, .02, 31);
    scene.add(car);
    const scooter = createScooterModel();
    scooter.position.copy(car.position);
    scooter.visible = false;
    scene.add(scooter);

    // NPC routes are loops around road lanes
    const npcSpecs = [
      { color: 0xbd4c43, speed: 9.0, route: [[-45.4, -2.6], [50.6, -2.6], [50.6, 45.4], [-45.4, 45.4]] },
      { color: 0xe3e5e6, speed: 7.2, route: [[2.6, 45.4], [2.6, -50.6], [-45.4, -50.6], [-45.4, 45.4]] },
      { color: 0x4a6e93, speed: 8.0, route: [[-2.6, -50.6], [-2.6, 50.6], [45.4, 50.6], [45.4, -50.6]] },
      { color: 0xc4a34a, speed: 6.7, route: [[50.6, 2.6], [-50.6, 2.6], [-50.6, -45.4], [50.6, -45.4]] },
      { color: 0x667e5c, speed: 7.6, route: [[-45.4, 50.6], [-45.4, -50.6], [2.6, -50.6], [2.6, 50.6]] },
    ];
    const npcs = npcSpecs.map((spec, idx) => {
      const model = createCarModel(spec.color, true);
      model.scale.setScalar(.9);
      model.position.set(spec.route[0][0], .02, spec.route[0][1]);
      scene.add(model);
      return { ...spec, model, index: 1, radius: 1.2, wait: 0, id: idx };
    });

    const state = {
      speed: 0,
      heading: 0,
      steeringRack: 0,
      gear: 'D',
      paused: false,
      vehicle: 'CAR',
      cameraMode: 'CHASE',
      soundOn: false,
      elapsedFloat: 0,
      lastUi: 0,
      currentSignal: { ns: 'GREEN', ew: 'RED' },
    };
    gameRef.current = { scene, camera, rearCamera, renderer, car, scooter, state, colliders, npcs, signals };

    const clock = new THREE.Clock();
    const forward = new THREE.Vector3();
    const desiredCam = new THREE.Vector3();
    const desiredLook = new THREE.Vector3();
    const rearLook = new THREE.Vector3();
    let raf = 0;

    function resize() {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    function hitsBuilding(x, z, radius) {
      if (Math.abs(x) > WORLD_SIZE / 2 - radius - .8 || Math.abs(z) > WORLD_SIZE / 2 - radius - .8) return true;
      return colliders.some(b => x + radius > b.minX && x - radius < b.maxX && z + radius > b.minZ && z - radius < b.maxZ);
    }

    function axisForMovement(from, to) {
      const dx = to[0] - from[0];
      const dz = to[1] - from[1];
      if (Math.abs(dx) > Math.abs(dz)) return { axis: 'EW', dir: Math.sign(dx) };
      return { axis: 'NS', dir: Math.sign(dz) };
    }

    function npcShouldStop(npc, target, phases) {
      const [tx, tz] = target;
      const { axis, dir } = axisForMovement([npc.model.position.x, npc.model.position.z], target);
      if (axis === 'EW') {
        if (phases.ew === 'GREEN') return false;
        if (Math.abs(npc.model.position.z) > 7) return false;
        if (dir > 0) return npc.model.position.x < -7 && npc.model.position.x > -15;
        return npc.model.position.x > 7 && npc.model.position.x < 15;
      }
      if (phases.ns === 'GREEN') return false;
      if (Math.abs(npc.model.position.x) > 7) return false;
      if (dir > 0) return npc.model.position.z < -7 && npc.model.position.z > -15;
      return npc.model.position.z > 7 && npc.model.position.z < 15;
    }

    function updateNpc(npc, dt, phases) {
      if (npc.wait > 0) npc.wait -= dt;
      const target = npc.route[npc.index];
      const px = npc.model.position.x;
      const pz = npc.model.position.z;
      const dx = target[0] - px;
      const dz = target[1] - pz;
      const distance = Math.hypot(dx, dz);
      if (distance < 1.1) {
        npc.index = (npc.index + 1) % npc.route.length;
        return;
      }
      if (npcShouldStop(npc, target, phases)) return;

      const ux = dx / distance;
      const uz = dz / distance;
      const travel = Math.min(distance, npc.speed * dt);
      npc.model.position.x += ux * travel;
      npc.model.position.z += uz * travel;
      const heading = Math.atan2(ux, -uz);
      npc.model.rotation.y = -heading;
      npc.model.userData.wheelMeshes?.forEach(({ tire, rim }) => {
        tire.rotation.x -= travel / .38;
        rim.rotation.x -= travel / .38;
      });
    }

    function updateTraffic(phases) {
      signals.ns.forEach(s => setLamp(s, phases.ns));
      signals.ew.forEach(s => setLamp(s, phases.ew));
    }

    function updateAudio() {
      const a = audioRef.current;
      if (!a || !a.ctx) return;
      const targetGain = state.soundOn && !state.paused ? .055 : 0.0001;
      const speedRatio = clamp(Math.abs(state.speed) / (state.vehicle === 'CAR' ? 32 : 18), 0, 1);
      const throttle = controlsRef.current.accel ? 1 : 0;
      const rpmLike = state.vehicle === 'CAR'
        ? 58 + speedRatio * 105 + throttle * 34
        : 82 + speedRatio * 170 + throttle * 52;
      const now = a.ctx.currentTime;
      a.osc.frequency.setTargetAtTime(rpmLike, now, .06);
      a.osc2.frequency.setTargetAtTime(rpmLike * 2.02, now, .07);
      a.filter.frequency.setTargetAtTime(480 + speedRatio * 1200 + throttle * 320, now, .08);
      a.gain.gain.setTargetAtTime(targetGain * (.65 + speedRatio * .55 + throttle * .18), now, .06);
    }

    function animate() {
      raf = requestAnimationFrame(animate);
      let dt = Math.min(clock.getDelta(), .033);
      if (state.paused) dt = 0;
      state.elapsedFloat += dt;

      const phases = signalPhases(state.elapsedFloat);
      state.currentSignal = phases;
      updateTraffic(phases);
      npcs.forEach(npc => updateNpc(npc, dt, phases));

      const ctl = controlsRef.current;
      const player = state.vehicle === 'CAR' ? car : scooter;
      const other = state.vehicle === 'CAR' ? scooter : car;
      other.position.copy(player.position);
      other.rotation.copy(player.rotation);

      // Keyboard behaves like a real wheel being turned, not an instant digital steer.
      if (!ctl.steeringDragging && (ctl.keyLeft || ctl.keyRight)) {
        const direction = (ctl.keyLeft ? -1 : 0) + (ctl.keyRight ? 1 : 0);
        const turnRate = state.vehicle === 'CAR' ? 1.2 : 2.4; // normalized range per second
        ctl.steerInput = clamp(ctl.steerInput + direction * turnRate * dt, -1, 1);
      } else if (!ctl.steeringDragging && !ctl.keyLeft && !ctl.keyRight) {
        // Quick self-centering after release. It still eases instead of snapping,
        // but returns close to 0 in roughly 0.3–0.6 s depending on speed.
        const kph = Math.abs(state.speed) * 3.6;
        const returnRate = state.vehicle === 'CAR'
          ? 4.4 + clamp(kph / 80, 0, 1) * 3.0
          : 6.2 + clamp(kph / 65, 0, 1) * 3.4;
        ctl.steerInput = damp(ctl.steerInput, 0, returnRate, dt);
        if (Math.abs(ctl.steerInput) < .004) ctl.steerInput = 0;
      }

      const maxInputDeg = state.vehicle === 'CAR' ? CAR_WHEEL_MAX : SCOOTER_BAR_MAX;
      const wheelVisual = ctl.steerInput * maxInputDeg;

      const accelPower = state.vehicle === 'CAR' ? 9.6 : 7.2;
      const reversePower = state.vehicle === 'CAR' ? 6.4 : 0;
      const brakePower = state.vehicle === 'CAR' ? 19.5 : 15.5;
      const rolling = state.vehicle === 'CAR' ? 1.25 : 1.6;
      const maxForward = state.vehicle === 'CAR' ? 32 : 18;
      const maxReverse = state.vehicle === 'CAR' ? 8.5 : 0;

      if (state.vehicle === 'SCOOTER') state.gear = 'D';

      if (state.gear === 'D') {
        if (ctl.accel) state.speed += accelPower * dt * (1 - clamp(Math.max(state.speed, 0) / maxForward, 0, .9) * .42);
        if (ctl.brake) {
          if (state.speed > 0) state.speed -= brakePower * dt;
          else state.speed += brakePower * .5 * dt;
        }
        state.speed = clamp(state.speed, state.vehicle === 'CAR' ? -1.0 : 0, maxForward);
      } else if (state.gear === 'R') {
        if (ctl.accel) state.speed -= reversePower * dt;
        if (ctl.brake) {
          if (state.speed < 0) state.speed += brakePower * dt;
          else state.speed -= brakePower * .4 * dt;
        }
        state.speed = clamp(state.speed, -maxReverse, .8);
      } else if (ctl.brake) {
        state.speed = damp(state.speed, 0, 9, dt);
      }

      if (!ctl.accel) {
        const s = Math.sign(state.speed);
        const mag = Math.max(0, Math.abs(state.speed) - rolling * dt);
        state.speed = mag * s;
      }
      if (Math.abs(state.speed) < .025) state.speed = 0;

      // Steering rack: actual road-wheel angle from steering-wheel position.
      const roadWheelMaxDeg = state.vehicle === 'CAR' ? 34 : 34;
      const rackTarget = ctl.steerInput;
      state.steeringRack = damp(state.steeringRack, rackTarget, state.vehicle === 'CAR' ? 12 : 16, dt);
      const roadWheelAngle = THREE.MathUtils.degToRad(state.steeringRack * roadWheelMaxDeg);

      if (Math.abs(state.speed) > .05) {
        const wheelbase = state.vehicle === 'CAR' ? 2.72 : 1.38;
        let yawRate = (state.speed / wheelbase) * Math.tan(roadWheelAngle);
        // lateral acceleration cap makes high-speed steering less arcade-like without changing steering ratio.
        const maxLatAccel = state.vehicle === 'CAR' ? 7.2 : 8.8;
        const maxYawByGrip = maxLatAccel / Math.max(Math.abs(state.speed), 2.2);
        yawRate = clamp(yawRate, -maxYawByGrip, maxYawByGrip);
        state.heading += yawRate * dt;
      }

      const fwdX = Math.sin(state.heading);
      const fwdZ = -Math.cos(state.heading);
      const radius = state.vehicle === 'CAR' ? 1.16 : .52;
      const nextX = player.position.x + fwdX * state.speed * dt;
      const nextZ = player.position.z + fwdZ * state.speed * dt;

      let npcCollision = false;
      for (const npc of npcs) {
        if (dist2D(nextX, nextZ, npc.model.position.x, npc.model.position.z) < radius + npc.radius) {
          npcCollision = true;
          break;
        }
      }
      if (!hitsBuilding(nextX, nextZ, radius) && !npcCollision) {
        player.position.x = nextX;
        player.position.z = nextZ;
      } else {
        state.speed *= state.vehicle === 'CAR' ? -.12 : -.05;
      }
      player.rotation.y = -state.heading;

      if (state.vehicle === 'CAR') {
        const frontAngle = -roadWheelAngle;
        car.userData.frontWheelPivots.forEach(p => { p.rotation.y = frontAngle; });
        const travel = state.speed * dt;
        car.userData.wheelMeshes.forEach(({ tire, rim }) => {
          tire.rotation.x -= travel / .38;
          rim.rotation.x -= travel / .38;
        });
      } else {
        scooter.userData.frontPivot.rotation.y = -roadWheelAngle;
        const travel = state.speed * dt;
        scooter.userData.wheels.forEach(w => { w.rotation.x -= travel / .35; });
        // gentle lean for scooter only
        scooter.rotation.z = damp(scooter.rotation.z, -state.steeringRack * clamp(Math.abs(state.speed) / 18, 0, 1) * .22, 6, dt);
      }

      forward.set(fwdX, 0, fwdZ);
      const vehHeight = state.vehicle === 'CAR' ? 1.0 : 1.05;
      if (state.cameraMode === 'CHASE') {
        const back = state.vehicle === 'CAR' ? 8.8 : 6.9;
        const height = state.vehicle === 'CAR' ? 4.65 : 3.9;
        desiredCam.set(player.position.x, height, player.position.z).addScaledVector(forward, -back);
        camera.position.lerp(desiredCam, 1 - Math.exp(-6 * dt));
        desiredLook.set(player.position.x, vehHeight, player.position.z).addScaledVector(forward, 4.5);
        camera.lookAt(desiredLook);
        camera.fov = damp(camera.fov, 62, 7, dt);
      } else if (state.cameraMode === 'HOOD') {
        const h = state.vehicle === 'CAR' ? 1.4 : 1.62;
        const ahead = state.vehicle === 'CAR' ? 1.25 : .45;
        desiredCam.set(player.position.x, h, player.position.z).addScaledVector(forward, ahead);
        camera.position.lerp(desiredCam, 1 - Math.exp(-15 * dt));
        desiredLook.set(player.position.x, h - .08, player.position.z).addScaledVector(forward, 18);
        camera.lookAt(desiredLook);
        camera.fov = damp(camera.fov, 67, 7, dt);
      } else {
        const h = state.vehicle === 'CAR' ? 1.56 : 1.68;
        const backOffset = state.vehicle === 'CAR' ? .25 : .12;
        desiredCam.set(player.position.x, h, player.position.z).addScaledVector(forward, -backOffset);
        camera.position.lerp(desiredCam, 1 - Math.exp(-16 * dt));
        desiredLook.set(player.position.x, h - .12, player.position.z).addScaledVector(forward, 19);
        camera.lookAt(desiredLook);
        camera.fov = damp(camera.fov, 72, 7, dt);
      }
      camera.updateProjectionMatrix();

      rearCamera.position.set(player.position.x, state.vehicle === 'CAR' ? 2.24 : 2.05, player.position.z).addScaledVector(forward, 1.65);
      rearLook.set(player.position.x, 1.1, player.position.z).addScaledVector(forward, -18);
      rearCamera.lookAt(rearLook);

      updateAudio();

      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);

      const mirrorW = Math.min(w * .27, 390);
      const mirrorH = mirrorW * .235;
      const mx = (w - mirrorW) / 2;
      const my = h - mirrorH - 10;
      renderer.clearDepth();
      renderer.setScissorTest(true);
      renderer.setScissor(mx, my, mirrorW, mirrorH);
      renderer.setViewport(mx, my, mirrorW, mirrorH);
      renderer.render(scene, rearCamera);
      renderer.setScissorTest(false);

      state.lastUi += dt;
      if (state.lastUi > .055) {
        state.lastUi = 0;
        setSpeedKmh(Math.round(Math.abs(state.speed) * 3.6));
        setRoadWheelDeg(Math.round(THREE.MathUtils.radToDeg(roadWheelAngle)));
        if (!wheelDragRef.current.active) setWheelDeg(wheelVisual);
        setCarPos({ x: player.position.x, z: player.position.z, heading: state.heading });
        setNpcDots(npcs.map(n => ({ id: n.id, x: n.model.position.x, z: n.model.position.z })));
        setSignalState(phases);
      }
    }
    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const key = down => e => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ' '].includes(k)) e.preventDefault();
      if (k === 'arrowleft' || k === 'a') controlsRef.current.keyLeft = down;
      if (k === 'arrowright' || k === 'd') controlsRef.current.keyRight = down;
      if (k === 'arrowup' || k === 'w') {
        controlsRef.current.accel = down;
        setAccelPressed(down);
        if (down) ensureAudio();
      }
      if (k === 'arrowdown' || k === 's' || k === ' ') {
        controlsRef.current.brake = down;
        setBrakePressed(down);
      }
      if (down && k === 'r') changeGear('R');
      if (down && k === 'n') changeGear('N');
      if (down && k === 'e') changeGear('D');
      if (down && k === 'c') cycleCamera();
      if (down && k === 'v') toggleVehicle();
      if (down && k === 'm') toggleSound();
    };
    const kd = key(true);
    const ku = key(false);
    window.addEventListener('keydown', kd, { passive: false });
    window.addEventListener('keyup', ku, { passive: false });
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => { if (!paused) setElapsed(v => v + 1); }, 1000);
    return () => clearInterval(id);
  }, [paused]);

  function ensureAudio() {
    if (audioRef.current?.ctx) {
      if (audioRef.current.ctx.state === 'suspended') audioRef.current.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc2.type = 'triangle';
    osc.frequency.value = 62;
    osc2.frequency.value = 124;
    filter.type = 'lowpass';
    filter.frequency.value = 650;
    filter.Q.value = .9;
    gain.gain.value = .0001;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc2.start();
    audioRef.current = { ctx, osc, osc2, filter, gain };
  }

  function changeGear(g) {
    const state = gameRef.current?.state;
    if (!state || state.vehicle !== 'CAR') return;
    if (Math.abs(state.speed) > 1.8 && ((g === 'R' && state.speed > 0) || (g === 'D' && state.speed < 0))) return;
    setGear(g);
    state.gear = g;
    if (Math.abs(state.speed) < 1.2) state.speed = 0;
  }

  function togglePause() {
    setPaused(p => {
      const next = !p;
      if (gameRef.current?.state) gameRef.current.state.paused = next;
      return next;
    });
  }

  function resetPlayer() {
    const g = gameRef.current;
    if (!g?.state) return;
    const active = g.state.vehicle === 'CAR' ? g.car : g.scooter;
    active.position.set(2.55, .02, 31);
    active.rotation.set(0, 0, 0);
    g.car.position.copy(active.position);
    g.scooter.position.copy(active.position);
    g.state.heading = 0;
    g.state.speed = 0;
    g.state.steeringRack = 0;
    controlsRef.current.steerInput = 0;
    wheelDragRef.current.rotation = 0;
    setWheelDeg(0);
    setRoadWheelDeg(0);
  }

  function cycleCamera() {
    const state = gameRef.current?.state;
    if (!state) return;
    const idx = CAMERA_MODES.indexOf(state.cameraMode);
    const next = CAMERA_MODES[(idx + 1) % CAMERA_MODES.length];
    state.cameraMode = next;
    setCameraMode(next);
  }

  function toggleVehicle() {
    const g = gameRef.current;
    if (!g?.state) return;
    const current = g.state.vehicle;
    const next = current === 'CAR' ? 'SCOOTER' : 'CAR';
    const from = current === 'CAR' ? g.car : g.scooter;
    const to = next === 'CAR' ? g.car : g.scooter;
    to.position.copy(from.position);
    to.rotation.set(0, -g.state.heading, 0);
    from.visible = false;
    to.visible = true;
    g.state.vehicle = next;
    g.state.speed = clamp(g.state.speed, 0, next === 'CAR' ? 32 : 18);
    g.state.gear = 'D';
    controlsRef.current.steerInput = 0;
    controlsRef.current.steeringDragging = false;
    wheelDragRef.current.rotation = 0;
    setWheelDeg(0);
    setGear('D');
    setVehicleMode(next);
  }

  function toggleSound() {
    ensureAudio();
    setSoundOn(prev => {
      const next = !prev;
      if (gameRef.current?.state) gameRef.current.state.soundOn = next;
      return next;
    });
  }

  function bindPedal(name, setter) {
    return {
      onPointerDown: e => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        if (name === 'accel') ensureAudio();
        controlsRef.current[name] = true;
        setter(true);
      },
      onPointerUp: e => {
        e.preventDefault();
        controlsRef.current[name] = false;
        setter(false);
      },
      onPointerCancel: () => {
        controlsRef.current[name] = false;
        setter(false);
      },
      onLostPointerCapture: () => {
        controlsRef.current[name] = false;
        setter(false);
      },
      onContextMenu: e => e.preventDefault(),
    };
  }

  function pointerAngle(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
  }

  function onSteerDown(e) {
    e.preventDefault();
    ensureAudio();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const angle = pointerAngle(e);
    wheelDragRef.current.active = true;
    wheelDragRef.current.pointerId = e.pointerId;
    wheelDragRef.current.lastAngle = angle;
    wheelDragRef.current.rotation = wheelDeg;
    controlsRef.current.steeringDragging = true;
  }

  function onSteerMove(e) {
    const drag = wheelDragRef.current;
    if (!drag.active || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    const angle = pointerAngle(e);
    const delta = normalizeDeg(angle - drag.lastAngle);
    drag.lastAngle = angle;
    const maxDeg = vehicleMode === 'CAR' ? CAR_WHEEL_MAX : SCOOTER_BAR_MAX;
    // Scooter uses a quicker ratio so a small finger arc can reach the handlebar limit.
    const multiplier = vehicleMode === 'CAR' ? 1 : 1.7;
    drag.rotation = clamp(drag.rotation + delta * multiplier, -maxDeg, maxDeg);
    controlsRef.current.steerInput = drag.rotation / maxDeg;
    setWheelDeg(drag.rotation);
  }

  function releaseSteer(e) {
    const drag = wheelDragRef.current;
    if (!drag.active) return;
    if (e?.pointerId != null && drag.pointerId !== e.pointerId) return;
    drag.active = false;
    drag.pointerId = null;
    controlsRef.current.steeringDragging = false;
    // Crucially: do not force input to zero. Physics loop returns it naturally.
  }

  const min = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const sec = (elapsed % 60).toString().padStart(2, '0');
  const mapX = clamp((carPos.x / WORLD_SIZE) * 100 + 50, 2, 98);
  const mapY = clamp((carPos.z / WORLD_SIZE) * 100 + 50, 2, 98);
  const maxControlDeg = vehicleMode === 'CAR' ? CAR_WHEEL_MAX : SCOOTER_BAR_MAX;
  const steerPct = Math.round((wheelDeg / maxControlDeg) * 100);
  const turns = Math.abs(wheelDeg) / 360;
  const signalForFacing = Math.abs(Math.sin(carPos.heading)) > .707 ? signalState.ew : signalState.ns;
  const signalClass = signalForFacing.toLowerCase();

  return (
    <div className="app">
      <div ref={mountRef} className="stage" />
      <div className="vignette" />

      <div className="topbar">
        <div className="driveChip">
          <span className={`vehicleBadge ${vehicleMode === 'SCOOTER' ? 'scooter' : ''}`}>{vehicleMode === 'CAR' ? 'CAR' : 'BIKE'}</span>
          <div><small>FREE DRIVE · V003</small><b>{min}:{sec}</b></div>
        </div>
        <div className="topActions">
          <button className="glassTextBtn vehicleSwitch" onClick={toggleVehicle} aria-label="車種切替"><span className="wideLabel">{vehicleMode === 'CAR' ? '🚗 CAR' : '🛵 BIKE'}</span><span className="compactLabel">🚗↔🛵</span></button>
          <button className="glassTextBtn cameraSwitch" onClick={cycleCamera} aria-label="カメラ切替"><span className="wideLabel">◉ {cameraMode}</span><span className="compactLabel">◉</span></button>
          <button className={`glassIconBtn ${soundOn ? 'active' : ''}`} onClick={toggleSound} aria-label="サウンド">{soundOn ? '♪' : '×♪'}</button>
          <button className="glassIconBtn" onClick={resetPlayer} aria-label="車両リセット">↻</button>
          <button className="glassIconBtn" onClick={togglePause} aria-label="一時停止">{paused ? '▶' : 'Ⅱ'}</button>
        </div>
      </div>

      <div className="mirrorFrame" aria-hidden="true"><span className="mirrorGlint" /></div>

      <div className={`signalHud ${signalClass}`}>
        <div className="miniSignal"><i className="r"/><i className="y"/><i className="g"/></div>
        <div><small>TRAFFIC</small><b>{signalForFacing}</b></div>
      </div>

      <div className={`steerHud ${vehicleMode === 'SCOOTER' ? 'scooterMode' : ''}`}>
        <div className="steerCaption">
          <span>{vehicleMode === 'CAR' ? 'STEERING' : 'HANDLE'}</span>
          <b>{steerPct === 0 ? 'CENTER' : steerPct < 0 ? `${Math.abs(steerPct)}% L` : `${steerPct}% R`}</b>
          {vehicleMode === 'CAR' && <em>{turns.toFixed(2)} turn</em>}
        </div>
        <div
          className="wheelTouchArea"
          onPointerDown={onSteerDown}
          onPointerMove={onSteerMove}
          onPointerUp={releaseSteer}
          onPointerCancel={releaseSteer}
          onLostPointerCapture={releaseSteer}
          onContextMenu={e => e.preventDefault()}
          role="slider"
          aria-label={vehicleMode === 'CAR' ? 'ステアリング' : '原付ハンドル'}
          aria-valuemin={-100}
          aria-valuemax={100}
          aria-valuenow={steerPct}
        >
          <div className="wheelShadow" />
          {vehicleMode === 'CAR' ? (
            <div className="wheel" style={{ transform: `rotate(${wheelDeg}deg)` }}>
              <div className="rimGrip g1"/><div className="rimGrip g2"/><div className="rimGrip g3"/><div className="rimGrip g4"/>
              <div className="spoke spokeTop"/><div className="spoke spokeLeft"/><div className="spoke spokeRight"/>
              <div className="hub"><span>SD</span></div>
              <div className="wheelMarker" />
            </div>
          ) : (
            <div className="bikeHandle" style={{ transform: `rotate(${wheelDeg}deg)` }}>
              <div className="handleBar"/><div className="grip leftGrip"/><div className="grip rightGrip"/>
              <div className="bikeStem"><span>SD</span></div>
            </div>
          )}
        </div>
        <div className="steerHint">{vehicleMode === 'CAR' ? '指で回す · 900° lock-to-lock' : '指で左右へ傾ける'}</div>
      </div>

      <div className="speedDeck">
        <div className="speedMeta"><span>GEAR</span><b>{gear}</b></div>
        <div className="speedReadout"><strong>{String(speedKmh).padStart(3, '0')}</strong><span>km/h</span></div>
        <div className="rackReadout"><span>ROAD WHEEL</span><b>{Math.abs(roadWheelDeg)}° {roadWheelDeg < 0 ? 'L' : roadWheelDeg > 0 ? 'R' : ''}</b></div>
        <div className="speedBars" aria-hidden="true">{[0,1,2,3,4,5,6,7,8].map(i => <i key={i} className={speedKmh / 13 > i ? 'on' : ''}/>)}</div>
      </div>

      <div className="minimapPhone">
        <div className="mapTop"><span>NAV</span><i/></div>
        <div className="mapInner">
          {mapRoads.map((p, i) => <div key={`h${i}`} className="roadH" style={{ top: `${p}%` }}/>) }
          {mapRoads.map((p, i) => <div key={`v${i}`} className="roadV" style={{ left: `${p}%` }}/>) }
          <div className="intersectionMark" />
          {npcDots.map(n => {
            const x = clamp((n.x / WORLD_SIZE) * 100 + 50, 1, 99);
            const y = clamp((n.z / WORLD_SIZE) * 100 + 50, 1, 99);
            return <div key={n.id} className="npcDot" style={{ left: `${x}%`, top: `${y}%` }}/>;
          })}
          <div className="carDot" style={{ left: `${mapX}%`, top: `${mapY}%`, transform: `translate(-50%,-50%) rotate(${-carPos.heading}rad)` }}>▲</div>
        </div>
      </div>

      {vehicleMode === 'CAR' && (
        <div className="gearRail" aria-label="ギア選択">
          <div className="gearTrack" />
          {['R','N','D'].map(g => <button key={g} className={gear === g ? 'active' : ''} onClick={() => changeGear(g)}><span>{g}</span></button>)}
        </div>
      )}

      <div className="pedals">
        <button className={`pedal brake ${brakePressed ? 'pressed' : ''}`} {...bindPedal('brake', setBrakePressed)}>
          <div className="pedalPlate">{[0,1,2,3,4].map(i => <i key={i}/>)}</div><b>BRAKE</b>
        </button>
        <button className={`pedal accel ${accelPressed ? 'pressed' : ''}`} {...bindPedal('accel', setAccelPressed)}>
          <div className="pedalPlate">{[0,1,2,3,4].map(i => <i key={i}/>)}</div><b>ACCEL</b>
        </button>
      </div>

      <div className="desktopHelp">WASD / 矢印 · C camera · V vehicle · M sound · E/N/R gear</div>
      <div className="landscapeHint">横画面推奨</div>

      {paused && (
        <div className="pauseOverlay">
          <div className="pauseCard"><small>STREET DRIVE V003</small><strong>PAUSED</strong><button onClick={togglePause}>ドライブを再開</button></div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App/>);
