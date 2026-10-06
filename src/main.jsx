import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import './styles.css';

const WORLD_SIZE = 150;
const ROAD_W = 12;
const ROAD_CENTERS = [-42, 0, 42];
const MAX_FORWARD = 30;
const MAX_REVERSE = 9;
const MAX_WHEEL_DEG = 180;

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

function App() {
  const mountRef = useRef(null);
  const gameRef = useRef({});
  const controlsRef = useRef({
    keyLeft: false,
    keyRight: false,
    accel: false,
    brake: false,
    wheelSteer: 0,
    wheelDragging: false,
  });
  const wheelDragRef = useRef({ active: false, pointerId: null, lastAngle: 0, rotation: 0 });

  const [speedKmh, setSpeedKmh] = useState(0);
  const [gear, setGear] = useState('D');
  const [elapsed, setElapsed] = useState(0);
  const [wheelDeg, setWheelDeg] = useState(0);
  const [carPos, setCarPos] = useState({ x: 0, z: 30, heading: 0 });
  const [paused, setPaused] = useState(false);
  const [accelPressed, setAccelPressed] = useState(false);
  const [brakePressed, setBrakePressed] = useState(false);

  const mapRoads = useMemo(() => ROAD_CENTERS.map(v => (v / WORLD_SIZE) * 100 + 50), []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xa7cce2);
    scene.fog = new THREE.Fog(0xa7cce2, 72, 170);

    const camera = new THREE.PerspectiveCamera(61, 1, 0.1, 400);
    const rearCamera = new THREE.PerspectiveCamera(54, 3.05, 0.1, 220);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.autoClear = false;
    mount.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xe8f6ff, 0x55616d, 2.1);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.35);
    sun.position.set(34, 58, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
      new THREE.MeshStandardMaterial({ color: 0x76866f, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const roadMat = new THREE.MeshStandardMaterial({ color: 0x50575d, roughness: 0.97 });
    const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xb8bdc0, roughness: 1 });
    const curbMat = new THREE.MeshStandardMaterial({ color: 0xd2d4d3, roughness: 1 });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf6f2cf });

    function addRoad(horizontal, center) {
      const road = new THREE.Mesh(
        new THREE.PlaneGeometry(horizontal ? WORLD_SIZE : ROAD_W, horizontal ? ROAD_W : WORLD_SIZE), roadMat
      );
      road.rotation.x = -Math.PI / 2;
      road.position.set(horizontal ? 0 : center, 0.012, horizontal ? center : 0);
      road.receiveShadow = true;
      scene.add(road);

      [-1, 1].forEach(side => {
        const sw = new THREE.Mesh(
          new THREE.BoxGeometry(horizontal ? WORLD_SIZE : 2.2, 0.25, horizontal ? 2.2 : WORLD_SIZE), sidewalkMat
        );
        sw.position.set(
          horizontal ? 0 : center + side * (ROAD_W / 2 + 1.1),
          0.12,
          horizontal ? center + side * (ROAD_W / 2 + 1.1) : 0
        );
        sw.receiveShadow = true;
        scene.add(sw);

        const curb = new THREE.Mesh(
          new THREE.BoxGeometry(horizontal ? WORLD_SIZE : 0.22, 0.18, horizontal ? 0.22 : WORLD_SIZE), curbMat
        );
        curb.position.set(
          horizontal ? 0 : center + side * (ROAD_W / 2 + 0.12),
          0.12,
          horizontal ? center + side * (ROAD_W / 2 + 0.12) : 0
        );
        scene.add(curb);
      });

      for (let p = -WORLD_SIZE / 2 + 4; p < WORLD_SIZE / 2; p += 8) {
        const dash = new THREE.Mesh(
          new THREE.PlaneGeometry(horizontal ? 3.4 : 0.16, horizontal ? 0.16 : 3.4), lineMat
        );
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(horizontal ? p : center, 0.024, horizontal ? center : p);
        scene.add(dash);
      }
    }
    ROAD_CENTERS.forEach(c => { addRoad(true, c); addRoad(false, c); });

    const colliders = [];
    const palette = [0xd8dade, 0xcbd2d7, 0xdfd4c8, 0xc0ccc4, 0xcac6d5, 0xd8c8c0];
    const blocks = [-63, -21, 21, 63];
    let bi = 0;
    blocks.forEach(cx => {
      blocks.forEach(cz => {
        const w = 20 + ((bi * 7) % 10);
        const d = 19 + ((bi * 5) % 11);
        const h = 12 + ((bi * 13) % 26);
        bi += 1;
        const mat = new THREE.MeshStandardMaterial({ color: palette[bi % palette.length], roughness: 0.82, metalness: 0.04 });
        const building = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        building.position.set(cx, h / 2 + 0.25, cz);
        building.castShadow = true;
        building.receiveShadow = true;
        scene.add(building);
        colliders.push({ minX: cx - w / 2 - 1.2, maxX: cx + w / 2 + 1.2, minZ: cz - d / 2 - 1.2, maxZ: cz + d / 2 + 1.2 });

        const roof = new THREE.Mesh(
          new THREE.BoxGeometry(w * 0.45, 1.2, d * 0.35),
          new THREE.MeshStandardMaterial({ color: 0x7d878d })
        );
        roof.position.set(cx, h + 0.85, cz);
        roof.castShadow = true;
        scene.add(roof);
      });
    });

    const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4b2d });
    const treeLeafMat = new THREE.MeshStandardMaterial({ color: 0x4f8c50 });
    function addTree(x, z) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2.4, 8), treeTrunkMat);
      trunk.position.set(x, 1.2, z);
      trunk.castShadow = true;
      scene.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1.25, 10, 8), treeLeafMat);
      crown.position.set(x, 3.0, z);
      crown.castShadow = true;
      scene.add(crown);
    }
    [-58, -28, 28, 58].forEach(x => { addTree(x, -7.7); addTree(x, 7.7); });
    [-58, -28, 28, 58].forEach(z => { addTree(-7.7, z); addTree(7.7, z); });

    const car = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1c2735, metalness: 0.48, roughness: 0.32 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x17212c, metalness: 0.35, roughness: 0.12 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.75, 4.3), bodyMat);
    body.position.y = 0.75;
    body.castShadow = true;
    car.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.85, 2.15), glassMat);
    cabin.position.set(0, 1.3, -0.25);
    cabin.castShadow = true;
    car.add(cabin);

    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 1 });
    [[-1.1,0.45,-1.35],[1.1,0.45,-1.35],[-1.1,0.45,1.35],[1.1,0.45,1.35]].forEach(([x,y,z]) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38,0.38,0.35,16), wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x,y,z);
      wheel.castShadow = true;
      car.add(wheel);
    });

    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff5047 });
    [-0.7,0.7].forEach(x => {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.45,0.18,0.05), tailMat);
      tail.position.set(x,0.78,2.17);
      car.add(tail);
    });
    car.position.set(0, 0.02, 30);
    scene.add(car);

    const state = {
      speed: 0,
      heading: 0,
      steer: 0,
      gear: 'D',
      paused: false,
      lastUi: 0,
    };
    gameRef.current = { scene, camera, renderer, car, state, colliders };

    const clock = new THREE.Clock();
    const forward = new THREE.Vector3();
    const desiredCam = new THREE.Vector3();
    const lookAt = new THREE.Vector3();
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

    function hitsBuilding(x, z) {
      if (Math.abs(x) > WORLD_SIZE/2 - 2 || Math.abs(z) > WORLD_SIZE/2 - 2) return true;
      return colliders.some(b => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
    }

    function animate() {
      raf = requestAnimationFrame(animate);
      let dt = Math.min(clock.getDelta(), 0.033);
      if (state.paused) dt = 0;

      const ctl = controlsRef.current;
      const keyboardSteer = (ctl.keyLeft ? -1 : 0) + (ctl.keyRight ? 1 : 0);
      const steerTarget = (ctl.keyLeft || ctl.keyRight) ? keyboardSteer : ctl.wheelSteer;
      state.steer = damp(state.steer, steerTarget, ctl.wheelDragging ? 15 : 7.5, dt);

      const accelPower = 13.5;
      const reversePower = 8.5;
      const brakePower = 23;
      const rolling = 2.0;

      if (state.gear === 'D') {
        if (ctl.accel) state.speed += accelPower * dt;
        if (ctl.brake) {
          if (state.speed > 0) state.speed -= brakePower * dt;
          else state.speed += brakePower * 0.5 * dt;
        }
        state.speed = clamp(state.speed, -1.5, MAX_FORWARD);
      } else if (state.gear === 'R') {
        if (ctl.accel) state.speed -= reversePower * dt;
        if (ctl.brake) {
          if (state.speed < 0) state.speed += brakePower * dt;
          else state.speed -= brakePower * 0.5 * dt;
        }
        state.speed = clamp(state.speed, -MAX_REVERSE, 1.2);
      } else if (ctl.brake) {
        state.speed = damp(state.speed, 0, 10, dt);
      }

      if (!ctl.accel) {
        const s = Math.sign(state.speed);
        const mag = Math.max(0, Math.abs(state.speed) - rolling * dt);
        state.speed = mag * s;
      }
      if (Math.abs(state.speed) < 0.035) state.speed = 0;

      if (Math.abs(state.speed) > 0.08) {
        const speedRatio = clamp(Math.abs(state.speed) / MAX_FORWARD, 0, 1);
        const maxSteerRad = THREE.MathUtils.degToRad(29 - speedRatio * 17);
        const steerAngle = state.steer * maxSteerRad;
        const wheelbase = 2.72;
        const yawRate = clamp((state.speed / wheelbase) * Math.tan(steerAngle), -1.25, 1.25);
        state.heading += yawRate * dt;
      }

      const fwdX = Math.sin(state.heading);
      const fwdZ = -Math.cos(state.heading);
      const nextX = car.position.x + fwdX * state.speed * dt;
      const nextZ = car.position.z + fwdZ * state.speed * dt;

      if (!hitsBuilding(nextX, nextZ)) {
        car.position.x = nextX;
        car.position.z = nextZ;
      } else {
        state.speed *= -0.16;
      }
      car.rotation.y = -state.heading;

      forward.set(fwdX, 0, fwdZ);
      desiredCam.set(car.position.x, 4.65, car.position.z).addScaledVector(forward, -8.75);
      camera.position.lerp(desiredCam, 1 - Math.exp(-6 * dt));
      lookAt.set(car.position.x, 1.08, car.position.z).addScaledVector(forward, 4.25);
      camera.lookAt(lookAt);

      rearCamera.position.set(car.position.x, 2.28, car.position.z).addScaledVector(forward, 1.9);
      rearLook.set(car.position.x, 1.22, car.position.z).addScaledVector(forward, -18);
      rearCamera.lookAt(rearLook);

      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);

      const mirrorW = Math.min(w * 0.30, 430);
      const mirrorH = mirrorW * 0.245;
      const mx = (w - mirrorW) / 2;
      const my = h - mirrorH - 12;
      renderer.clearDepth();
      renderer.setScissorTest(true);
      renderer.setScissor(mx, my, mirrorW, mirrorH);
      renderer.setViewport(mx, my, mirrorW, mirrorH);
      renderer.render(scene, rearCamera);
      renderer.setScissorTest(false);

      state.lastUi += dt;
      if (state.lastUi > 0.055) {
        state.lastUi = 0;
        setSpeedKmh(Math.round(Math.abs(state.speed) * 3.6));
        if (!wheelDragRef.current.active) setWheelDeg(state.steer * MAX_WHEEL_DEG);
        setCarPos({ x: car.position.x, z: car.position.z, heading: state.heading });
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
    const key = (down) => (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d',' '].includes(k)) e.preventDefault();
      if (k === 'arrowleft' || k === 'a') controlsRef.current.keyLeft = down;
      if (k === 'arrowright' || k === 'd') controlsRef.current.keyRight = down;
      if (k === 'arrowup' || k === 'w') {
        controlsRef.current.accel = down;
        setAccelPressed(down);
      }
      if (k === 'arrowdown' || k === 's' || k === ' ') {
        controlsRef.current.brake = down;
        setBrakePressed(down);
      }
      if (down && k === 'r') changeGear('R');
      if (down && k === 'n') changeGear('N');
      if (down && k === 'e') changeGear('D');
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

  function changeGear(g) {
    setGear(g);
    const state = gameRef.current?.state;
    if (state) {
      state.gear = g;
      if (Math.abs(state.speed) < 2.5) state.speed = 0;
    }
  }

  function togglePause() {
    setPaused(p => {
      const next = !p;
      if (gameRef.current?.state) gameRef.current.state.paused = next;
      return next;
    });
  }

  function resetCar() {
    const g = gameRef.current;
    if (!g?.car) return;
    g.car.position.set(0, 0.02, 30);
    g.state.heading = 0;
    g.state.speed = 0;
    g.state.steer = 0;
    g.car.rotation.y = 0;
    controlsRef.current.wheelSteer = 0;
    wheelDragRef.current.rotation = 0;
    setWheelDeg(0);
  }

  function bindPedal(name, setter) {
    return {
      onPointerDown: (e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        controlsRef.current[name] = true;
        setter(true);
      },
      onPointerUp: (e) => {
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
      onContextMenu: (e) => e.preventDefault(),
    };
  }

  function pointerAngle(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
  }

  function onWheelDown(e) {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const angle = pointerAngle(e);
    wheelDragRef.current.active = true;
    wheelDragRef.current.pointerId = e.pointerId;
    wheelDragRef.current.lastAngle = angle;
    wheelDragRef.current.rotation = wheelDeg;
    controlsRef.current.wheelDragging = true;
  }

  function onWheelMove(e) {
    const drag = wheelDragRef.current;
    if (!drag.active || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    const angle = pointerAngle(e);
    const delta = normalizeDeg(angle - drag.lastAngle);
    drag.lastAngle = angle;
    drag.rotation = clamp(drag.rotation + delta, -MAX_WHEEL_DEG, MAX_WHEEL_DEG);
    controlsRef.current.wheelSteer = drag.rotation / MAX_WHEEL_DEG;
    setWheelDeg(drag.rotation);
  }

  function releaseWheel(e) {
    const drag = wheelDragRef.current;
    if (!drag.active) return;
    if (e?.pointerId != null && drag.pointerId !== e.pointerId) return;
    drag.active = false;
    drag.pointerId = null;
    controlsRef.current.wheelDragging = false;
    controlsRef.current.wheelSteer = 0;
  }

  const min = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const sec = (elapsed % 60).toString().padStart(2, '0');
  const mapX = clamp((carPos.x / WORLD_SIZE) * 100 + 50, 2, 98);
  const mapY = clamp((carPos.z / WORLD_SIZE) * 100 + 50, 2, 98);
  const steerPct = Math.round((wheelDeg / MAX_WHEEL_DEG) * 100);

  return (
    <div className="app">
      <div ref={mountRef} className="stage" />
      <div className="vignette" />

      <div className="topbar">
        <div className="driveChip">
          <span className="driveChipDot" />
          <div><small>FREE DRIVE</small><b>{min}:{sec}</b></div>
        </div>
        <div className="topActions">
          <button className="glassIconBtn" onClick={resetCar} aria-label="車をリセット">↻</button>
          <button className="glassIconBtn" onClick={togglePause} aria-label="一時停止">{paused ? '▶' : 'Ⅱ'}</button>
        </div>
      </div>

      <div className="mirrorFrame" aria-hidden="true"><span className="mirrorGlint" /></div>

      <div className="steerHud">
        <div className="steerCaption">
          <span>STEER</span>
          <b>{steerPct === 0 ? 'CENTER' : steerPct < 0 ? `${Math.abs(steerPct)}% L` : `${steerPct}% R`}</b>
        </div>
        <div
          className={`wheelTouchArea ${wheelDragRef.current.active ? 'dragging' : ''}`}
          onPointerDown={onWheelDown}
          onPointerMove={onWheelMove}
          onPointerUp={releaseWheel}
          onPointerCancel={releaseWheel}
          onLostPointerCapture={releaseWheel}
          onContextMenu={(e) => e.preventDefault()}
          role="slider"
          aria-label="ステアリング"
          aria-valuemin={-100}
          aria-valuemax={100}
          aria-valuenow={steerPct}
        >
          <div className="wheelShadow" />
          <div className="wheel" style={{ transform: `rotate(${wheelDeg}deg)` }}>
            <div className="rimGrip g1" /><div className="rimGrip g2" /><div className="rimGrip g3" /><div className="rimGrip g4" />
            <div className="spoke spokeTop" /><div className="spoke spokeLeft" /><div className="spoke spokeRight" />
            <div className="hub"><span>SD</span></div>
            <div className="wheelMarker" />
          </div>
        </div>
        <div className="steerHint">指でハンドルを回す</div>
      </div>

      <div className="speedDeck">
        <div className="speedMeta"><span>GEAR</span><b>{gear}</b></div>
        <div className="speedReadout">
          <strong>{String(speedKmh).padStart(3, '0')}</strong>
          <span>km/h</span>
        </div>
        <div className="speedBars" aria-hidden="true">
          {[0,1,2,3,4,5,6,7,8].map(i => <i key={i} className={speedKmh / 12 > i ? 'on' : ''} />)}
        </div>
      </div>

      <div className="minimapPhone">
        <div className="mapTop"><span>MAP</span><i /></div>
        <div className="mapInner">
          {mapRoads.map((p,i)=><div key={'h'+i} className="roadH" style={{ top: `${p}%` }} />)}
          {mapRoads.map((p,i)=><div key={'v'+i} className="roadV" style={{ left: `${p}%` }} />)}
          <div className="carDot" style={{ left: `${mapX}%`, top: `${mapY}%`, transform: `translate(-50%,-50%) rotate(${-carPos.heading}rad)` }}>▲</div>
        </div>
      </div>

      <div className="gearRail" aria-label="ギア選択">
        <div className="gearTrack" />
        {['R','N','D'].map(g => (
          <button key={g} className={gear === g ? 'active' : ''} onClick={()=>changeGear(g)}>
            <span>{g}</span>
          </button>
        ))}
      </div>

      <div className="pedals">
        <button className={`pedal brake ${brakePressed ? 'pressed' : ''}`} {...bindPedal('brake', setBrakePressed)}>
          <div className="pedalPlate">{[0,1,2,3,4].map(i => <i key={i} />)}</div>
          <b>BRAKE</b>
        </button>
        <button className={`pedal accel ${accelPressed ? 'pressed' : ''}`} {...bindPedal('accel', setAccelPressed)}>
          <div className="pedalPlate">{[0,1,2,3,4].map(i => <i key={i} />)}</div>
          <b>ACCEL</b>
        </button>
      </div>

      <div className="desktopHelp">WASD / 矢印キー · E / N / R</div>
      <div className="landscapeHint">横画面推奨</div>

      {paused && (
        <div className="pauseOverlay">
          <div className="pauseCard">
            <small>STREET DRIVE</small>
            <strong>PAUSED</strong>
            <button onClick={togglePause}>ドライブを再開</button>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
