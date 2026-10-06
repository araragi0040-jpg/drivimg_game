import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import './styles.css';

const WORLD_SIZE = 150;
const ROAD_W = 12;
const ROAD_CENTERS = [-42, 0, 42];
const MAX_FORWARD = 30; // m/s-ish, displayed as km/h after conversion
const MAX_REVERSE = 9;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function App() {
  const mountRef = useRef(null);
  const gameRef = useRef({});
  const controlsRef = useRef({ left: false, right: false, accel: false, brake: false });
  const [speedKmh, setSpeedKmh] = useState(0);
  const [gear, setGear] = useState('D');
  const [elapsed, setElapsed] = useState(0);
  const [steerVisual, setSteerVisual] = useState(0);
  const [carPos, setCarPos] = useState({ x: 0, z: 30, heading: 0 });
  const [paused, setPaused] = useState(false);

  const mapRoads = useMemo(() => ROAD_CENTERS.map(v => (v / WORLD_SIZE) * 100 + 50), []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9dc7df);
    scene.fog = new THREE.Fog(0x9dc7df, 70, 165);

    const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
    const rearCamera = new THREE.PerspectiveCamera(52, 2.8, 0.1, 220);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.autoClear = false;
    mount.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xd9efff, 0x4a5560, 2.0);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(30, 55, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
      new THREE.MeshStandardMaterial({ color: 0x6e7e67, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Roads
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x4e555b, roughness: 0.95 });
    const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xb6babd, roughness: 1 });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf4f0c6 });

    function addRoad(horizontal, center) {
      const road = new THREE.Mesh(
        new THREE.PlaneGeometry(horizontal ? WORLD_SIZE : ROAD_W, horizontal ? ROAD_W : WORLD_SIZE), roadMat
      );
      road.rotation.x = -Math.PI / 2;
      road.position.set(horizontal ? 0 : center, 0.012, horizontal ? center : 0);
      road.receiveShadow = true;
      scene.add(road);

      // sidewalks
      [-1, 1].forEach(side => {
        const sw = new THREE.Mesh(
          new THREE.BoxGeometry(horizontal ? WORLD_SIZE : 2.2, 0.25, horizontal ? 2.2 : WORLD_SIZE), sidewalkMat
        );
        sw.position.set(horizontal ? 0 : center + side * (ROAD_W / 2 + 1.1), 0.12, horizontal ? center + side * (ROAD_W / 2 + 1.1) : 0);
        sw.receiveShadow = true;
        scene.add(sw);
      });

      // dashed center line
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

    // Buildings + collision boxes
    const colliders = [];
    const palette = [0xd7d8dc, 0xc8d0d5, 0xe0d3c5, 0xbcc9c1, 0xc5c2d3, 0xd5c5bd];
    const blocks = [-63, -21, 21, 63];
    let bi = 0;
    blocks.forEach(cx => {
      blocks.forEach(cz => {
        const w = 20 + ((bi * 7) % 10);
        const d = 19 + ((bi * 5) % 11);
        const h = 12 + ((bi * 13) % 26);
        bi++;
        const mat = new THREE.MeshStandardMaterial({ color: palette[bi % palette.length], roughness: 0.8, metalness: 0.05 });
        const building = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        building.position.set(cx, h / 2 + 0.25, cz);
        building.castShadow = true;
        building.receiveShadow = true;
        scene.add(building);
        colliders.push({ minX: cx - w / 2 - 1.2, maxX: cx + w / 2 + 1.2, minZ: cz - d / 2 - 1.2, maxZ: cz + d / 2 + 1.2 });

        // rooftop detail
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.45, 1.2, d * 0.35), new THREE.MeshStandardMaterial({ color: 0x7b858b }));
        roof.position.set(cx, h + 0.85, cz);
        roof.castShadow = true;
        scene.add(roof);
      });
    });

    // trees / street furniture
    const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2b });
    const treeLeafMat = new THREE.MeshStandardMaterial({ color: 0x4f8a4d });
    function addTree(x, z) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2.4, 8), treeTrunkMat);
      trunk.position.set(x, 1.2, z); trunk.castShadow = true; scene.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1.25, 10, 8), treeLeafMat);
      crown.position.set(x, 3.0, z); crown.castShadow = true; scene.add(crown);
    }
    [-58, -28, 28, 58].forEach(x => { addTree(x, -7.7); addTree(x, 7.7); });
    [-58, -28, 28, 58].forEach(z => { addTree(-7.7, z); addTree(7.7, z); });

    // Car
    const car = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1d2635, metalness: 0.45, roughness: 0.35 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x19222d, metalness: 0.4, roughness: 0.15 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.75, 4.3), bodyMat);
    body.position.y = 0.75; body.castShadow = true; car.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.85, 2.15), glassMat);
    cabin.position.set(0, 1.3, -0.25); cabin.castShadow = true; car.add(cabin);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 1 });
    [[-1.1,0.45,-1.35],[1.1,0.45,-1.35],[-1.1,0.45,1.35],[1.1,0.45,1.35]].forEach(([x,y,z]) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38,0.38,0.35,16), wheelMat);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(x,y,z); wheel.castShadow = true; car.add(wheel);
    });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff493f });
    [-0.7,0.7].forEach(x => {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.45,0.18,0.05), tailMat);
      tail.position.set(x,0.78,2.17); car.add(tail);
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
      const steerTarget = (ctl.left ? -1 : 0) + (ctl.right ? 1 : 0);
      state.steer = damp(state.steer, steerTarget, 8, dt);

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
      } else {
        if (ctl.brake) state.speed = damp(state.speed, 0, 10, dt);
      }

      if (!ctl.accel) {
        const s = Math.sign(state.speed);
        const mag = Math.max(0, Math.abs(state.speed) - rolling * dt);
        state.speed = mag * s;
      }
      if (Math.abs(state.speed) < 0.035) state.speed = 0;

      const turnFactor = clamp(Math.abs(state.speed) / 6, 0, 1);
      if (Math.abs(state.speed) > 0.08) {
        state.heading += state.steer * 1.15 * turnFactor * dt * Math.sign(state.speed);
      }

      const fwdX = Math.sin(state.heading);
      const fwdZ = -Math.cos(state.heading);
      const nextX = car.position.x + fwdX * state.speed * dt;
      const nextZ = car.position.z + fwdZ * state.speed * dt;

      if (!hitsBuilding(nextX, nextZ)) {
        car.position.x = nextX;
        car.position.z = nextZ;
      } else {
        state.speed *= -0.18;
      }
      car.rotation.y = -state.heading;

      // Chase camera
      const forward = new THREE.Vector3(fwdX, 0, fwdZ);
      const desiredCam = new THREE.Vector3(car.position.x, 4.6, car.position.z).addScaledVector(forward, -8.6);
      camera.position.lerp(desiredCam, 1 - Math.exp(-6 * dt));
      const lookAt = new THREE.Vector3(car.position.x, 1.1, car.position.z).addScaledVector(forward, 4.2);
      camera.lookAt(lookAt);

      // Rear camera
      rearCamera.position.set(car.position.x, 2.3, car.position.z).addScaledVector(forward, 1.9);
      const rearLook = new THREE.Vector3(car.position.x, 1.25, car.position.z).addScaledVector(forward, -18);
      rearCamera.lookAt(rearLook);

      // Main render
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);

      // Rear-view render in scissor
      const mirrorW = Math.min(w * 0.28, 420);
      const mirrorH = mirrorW * 0.27;
      const mx = (w - mirrorW) / 2;
      const my = h - mirrorH - 14;
      renderer.clearDepth();
      renderer.setScissorTest(true);
      renderer.setScissor(mx, my, mirrorW, mirrorH);
      renderer.setViewport(mx, my, mirrorW, mirrorH);
      renderer.render(scene, rearCamera);
      renderer.setScissorTest(false);

      state.lastUi += dt;
      if (state.lastUi > 0.08) {
        state.lastUi = 0;
        setSpeedKmh(Math.round(Math.abs(state.speed) * 3.6));
        setSteerVisual(state.steer);
        setCarPos({ x: car.position.x, z: car.position.z, heading: state.heading });
      }
    }
    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const key = (down) => (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d',' '].includes(k)) e.preventDefault();
      if (k === 'arrowleft' || k === 'a') controlsRef.current.left = down;
      if (k === 'arrowright' || k === 'd') controlsRef.current.right = down;
      if (k === 'arrowup' || k === 'w') controlsRef.current.accel = down;
      if (k === 'arrowdown' || k === 's' || k === ' ') controlsRef.current.brake = down;
      if (down && k === 'r') changeGear('R');
      if (down && k === 'n') changeGear('N');
      if (down && k === 'e') changeGear('D');
    };
    const kd = key(true), ku = key(false);
    window.addEventListener('keydown', kd, { passive: false });
    window.addEventListener('keyup', ku, { passive: false });
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
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
    g.car.rotation.y = 0;
  }

  function bindHold(name) {
    return {
      onPointerDown: (e) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); controlsRef.current[name] = true; },
      onPointerUp: (e) => { e.preventDefault(); controlsRef.current[name] = false; },
      onPointerCancel: () => { controlsRef.current[name] = false; },
      onPointerLeave: (e) => { if (e.buttons === 0) controlsRef.current[name] = false; },
      onContextMenu: (e) => e.preventDefault(),
    };
  }

  const min = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const sec = (elapsed % 60).toString().padStart(2, '0');
  const mapX = clamp((carPos.x / WORLD_SIZE) * 100 + 50, 2, 98);
  const mapY = clamp((carPos.z / WORLD_SIZE) * 100 + 50, 2, 98);

  return (
    <div className="app">
      <div ref={mountRef} className="stage" />
      <div className="vignette" />

      <div className="topbar">
        <div className="timer pill"><span>◷</span><b>{min}:{sec}</b></div>
        <button className="iconBtn" onClick={togglePause} aria-label="Pause">{paused ? '▶' : 'Ⅱ'}</button>
      </div>

      <div className="mirrorFrame" aria-hidden="true" />

      <div className="leftHud">
        <button className="resetBtn" onClick={resetCar}>↻</button>
        <div className="missionCard"><div className="star">★</div><div>FREE</div><small>DRIVE</small></div>
      </div>

      <div className="wheelCluster">
        <div className="wheel" style={{ transform: `rotate(${steerVisual * 110}deg)` }}>
          <div className="spoke s1" /><div className="spoke s2" /><div className="spoke s3" />
          <div className="hub">DRIVE</div>
        </div>
        <div className="steerTouch steerLeft" {...bindHold('left')}>‹</div>
        <div className="steerTouch steerRight" {...bindHold('right')}>›</div>
      </div>

      <div className="speedPanel">
        <div className="turnArrow">◀</div>
        <div className="speedValue">{String(speedKmh).padStart(3, '0')}</div>
        <div className="speedUnit">KM/H</div>
        <div className="turnArrow">▶</div>
      </div>

      <div className="minimap">
        <div className="mapInner">
          {mapRoads.map((p,i)=><div key={'h'+i} className="roadH" style={{ top: `${p}%` }} />)}
          {mapRoads.map((p,i)=><div key={'v'+i} className="roadV" style={{ left: `${p}%` }} />)}
          <div className="carDot" style={{ left: `${mapX}%`, top: `${mapY}%`, transform: `translate(-50%,-50%) rotate(${-carPos.heading}rad)` }}>▲</div>
        </div>
        <div className="mapLabel">MAP</div>
      </div>

      <div className="gearBox">
        {['R','N','D'].map(g => <button key={g} className={gear === g ? 'active' : ''} onClick={()=>changeGear(g)}>{g}</button>)}
      </div>

      <div className="pedals">
        <button className="pedal brake" {...bindHold('brake')}><span>▥</span><b>BRAKE</b></button>
        <button className="pedal accel" {...bindHold('accel')}><span>▥</span><b>PEDAL</b></button>
      </div>

      <div className="help">PC: WASD / 矢印キー　　R/N/E: ギア</div>
      <div className="landscapeHint">横画面にすると遊びやすくなります</div>
      {paused && <div className="pauseOverlay"><div>PAUSED</div><button onClick={togglePause}>再開</button></div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
