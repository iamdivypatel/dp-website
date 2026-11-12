// The 3D stage: a simplified, live model of the platform Divya runs at Refy9.
// Every node comes from a CV bullet. Data packets travel along the links; the
// story section lifts the layers apart and lights up one layer per step.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const BG = 0x0a0a0f;
const GLOW = new THREE.Color(0x7ce7ff);
const DIM = new THREE.Color(0x2a3345);

// layer: 0 edge & auth, 1 compute, 2 data, 3 async, 4 ops & AI. steps: which story cards light it up.
// logos: files in assets/logos (official AWS Architecture Icons, Simple Icons brand marks, three plain glyphs).
const NODES = [
  { id: 'clients', label: 'Mobile & web apps', p: [-6.7, 0], s: [1.3, 0.5, 2.2], layer: 0, steps: [0], logos: ['devices'] },
  { id: 'google', label: 'Google APIs · Gmail, Calendar', p: [-6.7, -2.7], s: [1.1, 0.45, 1.1], layer: 0, steps: [0], logos: ['gmail', 'googlecalendar'] },
  { id: 'cicd', label: 'GitHub Actions CI/CD', p: [-6.7, -5.0], s: [1.1, 0.4, 1.1], layer: 1, steps: [1], logos: ['githubactions'] },
  { id: 'apigw', label: 'API Gateway · REST + WebSocket', p: [-4.1, 0], s: [1.5, 0.9, 1.5], layer: 0, steps: [0, 4], logos: ['aws-api-gateway'] },
  { id: 'auth', label: 'Lambda authorizer · JWT + Google OAuth', p: [-4.1, -2.7], s: [1.0, 0.55, 1.0], layer: 0, steps: [0, 3], logos: ['jsonwebtokens', 'google'] },
  { id: 'community', label: 'Communities · WebSocket chat', p: [-4.1, 2.9], s: [1.1, 0.6, 1.1], layer: 0, steps: [4], logos: ['chat'] },
  { id: 'api', label: 'Core API · Node.js + TypeScript', p: [-1.3, 0], s: [1.7, 1.25, 1.7], layer: 1, steps: [0, 1, 2, 3], logos: ['nodedotjs', 'typescript'] },
  { id: 'lambdas', label: '45+ Lambda functions', p: [-1.3, -3.1], s: [2.6, 0.22, 1.5], layer: 1, steps: [1], cluster: true, logos: ['aws-lambda'] },
  { id: 'redis', label: 'Redis · L0 / L1 / L2 caching', p: [-1.3, -1.65], s: [1.1, 0.5, 0.75], layer: 2, steps: [2], logos: ['redis'] },
  { id: 'sqs', label: 'SQS FIFO queues', p: [-1.3, 2.9], s: [2.0, 0.35, 0.8], layer: 3, steps: [4], logos: ['aws-sqs'] },
  { id: 'pgb', label: 'PgBouncer · shared pool', p: [1.4, 0], s: [1.0, 0.7, 1.0], layer: 2, steps: [1, 2], logos: ['pool'] },
  { id: 'notify', label: 'Notifications · FCM + WhatsApp OTP', p: [1.4, 2.9], s: [1.3, 0.8, 1.3], layer: 3, steps: [4], logos: ['firebase', 'whatsapp'] },
  { id: 'events', label: 'EventBridge scheduling', p: [1.4, 5.1], s: [1.0, 0.45, 1.0], layer: 3, steps: [4], logos: ['aws-eventbridge'] },
  { id: 'ec2', label: 'EC2 · AI team services', p: [1.4, -3.1], s: [1.2, 0.9, 1.2], layer: 4, steps: [5], logos: ['aws-ec2', 'docker'] },
  { id: 'aurora', label: 'Aurora PostgreSQL · private', p: [4.1, 0], s: [1.6, 1.6, 1.6], layer: 2, steps: [1, 2, 3], logos: ['aws-aurora'] },
  { id: 'bastion', label: 'SSM bastion', p: [4.1, 2.7], s: [0.9, 0.45, 0.9], layer: 2, steps: [3], logos: ['aws-systems-manager'] },
  { id: 'grafana', label: 'Grafana · Prometheus + Loki', p: [4.1, -3.1], s: [1.2, 0.6, 1.2], layer: 4, steps: [5], logos: ['grafana', 'prometheus'] },
  { id: 'gpu', label: 'RunPod GPU · Gemma on vLLM', p: [6.8, -3.1], s: [1.3, 1.0, 1.3], layer: 4, steps: [5], logos: ['vllm'] },
];
const LINKS = [
  ['clients', 'apigw', [0]], ['apigw', 'auth', [0, 3]], ['auth', 'google', [0]], ['apigw', 'api', [0, 1]],
  ['cicd', 'lambdas', [1]], ['api', 'redis', [2]], ['api', 'pgb', [1, 2]], ['pgb', 'aurora', [1, 2, 3]], ['bastion', 'aurora', [3]],
  ['api', 'sqs', [4]], ['apigw', 'community', [4]], ['community', 'sqs', [4]], ['sqs', 'notify', [4]],
  ['events', 'notify', [4]], ['ec2', 'grafana', [5]], ['ec2', 'gpu', [5]],
];
const TERRAFORM_STEP = 3;
const AWS_BOUNDS = { x0: -5.25, x1: 5.25, z0: -4.75, z1: 6.15 }; // the Terraform-managed account
const SEG = 24; // samples per link curve
const PACKETS_PER_LINK = 2;
const STEP_COUNT = 6;

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

export async function createStage({ canvas, labelsEl, reducedMotion, onLost, logoBase = 'assets/logos/' }) {
  const small = window.matchMedia('(max-width: 767px)').matches;
  const weak = (navigator.hardwareConcurrency || 8) <= 4;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      outputBufferType: THREE.HalfFloatType,
    });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.5 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.FogExp2(BG, 0.026);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentIntensity = 0.32;
  room.dispose();
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0x9fb7ff, 0x0a0a0f, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(6, 10, 4);
  const rim = new THREE.DirectionalLight(0x4d8dff, 1.3);
  rim.position.set(-6, 4, -8);
  scene.add(key, rim);

  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 200);
  const target = new THREE.Vector3(0, 0.4, 0.2);

  /* ---------- Floor ---------- */
  const grid = new THREE.GridHelper(44, 88, 0x22304a, 0x151b28);
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  grid.material.depthWrite = false;
  scene.add(grid);

  const glowTex = radialTexture();
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 26),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.01;
  scene.add(glow);

  /* ---------- Terraform boundary ---------- */
  const tfPoints = roundedRect(AWS_BOUNDS, 0.6).map((p) => new THREE.Vector3(p.x, 0.02, p.y));
  const tfMat = new THREE.LineBasicMaterial({ color: 0x3a4a68, transparent: true, opacity: 0.9 });
  const tf = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(tfPoints), tfMat);
  scene.add(tf);

  /* ---------- Nodes ---------- */
  const raycastLayer = 1;
  const boxGeoCache = new Map();
  const nodes = NODES.map((def) => {
    const [w, h, d] = def.s;
    const keyStr = def.s.join('x');
    if (!boxGeoCache.has(keyStr)) boxGeoCache.set(keyStr, new RoundedBoxGeometry(w, h, d, 3, Math.min(0.1, h * 0.3)));
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1b2130, roughness: 0.38, metalness: 0.55, emissive: 0x4d8dff, emissiveIntensity: 0,
      visible: !def.cluster,
    });
    const mesh = new THREE.Mesh(boxGeoCache.get(keyStr), mat);
    mesh.layers.enable(raycastLayer);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w * 1.004, h * 1.004, d * 1.004)), edgeMat);
    if (!def.cluster) mesh.add(edges);
    scene.add(mesh);
    const label = document.createElement('span');
    label.className = 'node-label';
    label.textContent = def.label;
    labelsEl.append(label);
    return { ...def, mesh, mat, edgeMat, label, lift: 0, glow: 0, glowTarget: 0, labelOn: false, top: new THREE.Vector3() };
  });
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  /* ---------- Service logos on the top faces: dim at rest, bright on hover ---------- */
  const tfLogo = {};
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const logoTextures = new Map();
  function loadLogo(name) {
    if (!logoTextures.has(name)) {
      logoTextures.set(name, new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = c.height = 256;
          c.getContext('2d').drawImage(img, 0, 0, 256, 256);
          const tex = new THREE.CanvasTexture(c);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = anisotropy;
          resolve(tex);
        };
        img.onerror = () => resolve(null);
        img.src = `${logoBase}${name}.svg`;
      }));
    }
    return logoTextures.get(name);
  }
  const logoGeo = new THREE.PlaneGeometry(1, 1);
  const logoGroups = [];
  async function addLogos(owner, names, size) {
    const textures = await Promise.all(names.map(loadLogo));
    const group = new THREE.Group();
    const gap = size * 0.16;
    textures.forEach((map, i) => {
      if (!map) return;
      const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.2 });
      const mesh = new THREE.Mesh(logoGeo, mat);
      mesh.scale.setScalar(size);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.x = (i - (names.length - 1) / 2) * (size + gap);
      mesh.renderOrder = 2;
      group.add(mesh);
    });
    scene.add(group);
    logoGroups.push(group);
    owner.logoGroup = group;
    owner.logoMats = group.children.map((m) => m.material);
    owner.logoLevel = 0.2;
  }

  const tfLabel = document.createElement('span');
  tfLabel.className = 'node-label';
  tfLabel.textContent = 'Terraform · whole AWS account';
  labelsEl.append(tfLabel);

  // "45+ Lambda functions": 45 small cells that light up in a wave.
  const lambdaNode = byId.lambdas;
  const CELLS = 45;
  const cellGeo = new RoundedBoxGeometry(0.2, 0.2, 0.2, 2, 0.035);
  const cells = new THREE.InstancedMesh(cellGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), CELLS);
  cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(cells);
  const cellColor = new THREE.Color();

  /* ---------- Links and packets ---------- */
  const links = LINKS.map(([a, b, steps]) => ({
    a: byId[a], b: byId[b], steps,
    curve: new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]),
    speed: 0.16 + Math.random() * 0.12,
  }));
  const linePos = new Float32Array(links.length * SEG * 2 * 3);
  const lineCol = new Float32Array(links.length * SEG * 2 * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
  lines.frustumCulled = false;
  scene.add(lines);

  const packetCount = links.length * PACKETS_PER_LINK;
  const packets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), packetCount);
  packets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  packets.frustumCulled = false;
  scene.add(packets);

  /* ---------- State ---------- */
  const state = {
    mode: 'hero', step: -1, progress: 0, active: false, paused: false,
    explode: 0, explodeTarget: 0, lastExplode: -1,
    hovered: null, pointer: new THREE.Vector2(9, 9), pointerDirty: false, w: 1, h: 1,
  };
  const rig = { az: 0.78, el: 0.6, dist: 40, ox: -0.2, oy: 0.1 };
  const rigTarget = { ...rig };
  const timer = new THREE.Timer();
  timer.connect(document);
  const raycaster = new THREE.Raycaster();
  raycaster.layers.set(raycastLayer);
  const _p = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _c = new THREE.Color();

  /* ---------- Bloom (skipped on small or low-power devices) ---------- */
  let bloom = null;
  if (!small && !weak) {
    try {
      bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.82);
      renderer.setEffects([bloom]);
    } catch {
      bloom = null;
    }
  }

  function isLit(steps) {
    return state.mode === 'hero' ? true : steps.includes(state.step);
  }

  function framing() {
    const aspect = state.w / state.h;
    const narrow = aspect < 1;
    // Portrait screens have a narrow horizontal field of view: pull back in proportion.
    const fit = narrow ? 0.9 / Math.max(aspect, 0.4) : Math.max(1, 1.5 / aspect);
    if (state.mode === 'hero') {
      Object.assign(rigTarget, { az: 0.78, el: 0.6, dist: 38 * fit, ox: narrow ? 0 : -0.19, oy: narrow ? 0.22 : 0.08 });
    } else {
      const p = state.progress;
      Object.assign(rigTarget, { az: 0.55 + p * 0.75, el: 0.7 - p * 0.1, dist: (narrow ? 40 : 33) * fit, ox: narrow ? 0 : -0.21, oy: narrow ? 0.12 : -0.01 });
    }
    state.explodeTarget = state.mode === 'story' ? Math.min(1, state.progress * 6) : 0;
  }

  function placeNodes() {
    const ex = state.explode;
    for (const n of nodes) {
      n.lift = ex * n.layer * 0.62;
      n.mesh.position.set(n.p[0], n.s[1] / 2 + n.lift, n.p[1]);
      n.top.set(n.p[0], n.s[1] + n.lift, n.p[1]);
    }
    // cells sit on the lambdas footprint
    const ln = lambdaNode;
    let i = 0;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 9; c++, i++) {
        _p.set(ln.p[0] - 1.12 + c * 0.28, 0.1 + ln.lift, ln.p[1] - 0.56 + r * 0.28);
        cells.setMatrixAt(i, _m.makeTranslation(_p.x, _p.y, _p.z));
      }
    }
    cells.instanceMatrix.needsUpdate = true;
    for (const n of nodes) {
      if (n.logoGroup) n.logoGroup.position.set(n.p[0], (n.cluster ? 0.22 : n.s[1]) + n.lift + 0.008, n.p[1]);
    }
    if (tfLogo.logoGroup) tfLogo.logoGroup.position.set(AWS_BOUNDS.x0 + 0.85, 0.03, AWS_BOUNDS.z1 - 0.85);
    // link curves arc between node tops
    let k = 0;
    for (const L of links) {
      const [a, m, b] = L.curve.points;
      a.copy(L.a.top).y += 0.04;
      b.copy(L.b.top).y += 0.04;
      m.addVectors(a, b).multiplyScalar(0.5);
      m.y += 0.5 + a.distanceTo(b) * 0.09;
      L.curve.updateArcLengths();
      for (let s = 0; s < SEG; s++) {
        L.curve.getPoint(s / SEG, _p);
        linePos[k] = _p.x; linePos[k + 1] = _p.y; linePos[k + 2] = _p.z;
        L.curve.getPoint((s + 1) / SEG, _p);
        linePos[k + 3] = _p.x; linePos[k + 4] = _p.y; linePos[k + 5] = _p.z;
        k += 6;
      }
    }
    lineGeo.attributes.position.needsUpdate = true;
    state.lastExplode = ex;
  }

  function paintLinks() {
    let k = 0;
    for (const L of links) {
      const lit = isLit(L.steps);
      const col = lit ? (state.mode === 'hero' ? _c.copy(GLOW).multiplyScalar(0.55) : _c.copy(GLOW).multiplyScalar(1.6)) : _c.copy(DIM);
      for (let s = 0; s < SEG * 2; s++, k += 3) { lineCol[k] = col.r; lineCol[k + 1] = col.g; lineCol[k + 2] = col.b; }
    }
    lineGeo.attributes.color.needsUpdate = true;
    let i = 0;
    for (const L of links) {
      const lit = isLit(L.steps);
      const col = lit ? _c.copy(GLOW).multiplyScalar(state.mode === 'hero' ? 2.6 : 4) : _c.copy(DIM);
      for (let j = 0; j < PACKETS_PER_LINK; j++, i++) packets.setColorAt(i, col);
    }
    packets.instanceColor.needsUpdate = true;
    tfMat.color.set(state.mode === 'story' && state.step === TERRAFORM_STEP ? 0x7ce7ff : 0x3a4a68);
    if (state.mode === 'story' && state.step === TERRAFORM_STEP) tfMat.color.multiplyScalar(2.2);
    for (const n of nodes) n.glowTarget = state.mode === 'story' && n.steps.includes(state.step) ? 1 : 0;
  }

  function updatePackets(t) {
    let i = 0;
    for (const L of links) {
      const lit = isLit(L.steps);
      const scale = lit ? 1 : 0.55;
      for (let j = 0; j < PACKETS_PER_LINK; j++, i++) {
        const u = (j / PACKETS_PER_LINK + t * L.speed) % 1;
        L.curve.getPointAt(u, _p);
        _s.setScalar(scale);
        _m.compose(_p, _q, _s);
        packets.setMatrixAt(i, _m);
      }
    }
    packets.instanceMatrix.needsUpdate = true;
  }

  function updateCells(t) {
    const lit = (state.mode === 'story' && state.step === 1) || state.hovered === lambdaNode;
    for (let i = 0; i < CELLS; i++) {
      const wave = Math.max(0, Math.sin(t * 2.4 - i * 0.33));
      if (lit) cellColor.copy(GLOW).multiplyScalar(0.25 + wave * wave * 2.6);
      else cellColor.setRGB(0.09, 0.11, 0.16).lerp(_c.copy(GLOW).multiplyScalar(0.35), wave * 0.25);
      cells.setColorAt(i, cellColor);
    }
    cells.instanceColor.needsUpdate = true;
  }

  function updateNodes(dt) {
    for (const n of nodes) {
      const target = Math.max(n.glowTarget, state.hovered === n ? 1 : 0);
      n.glow = THREE.MathUtils.damp(n.glow, target, 6, dt);
      n.mat.emissiveIntensity = (state.mode === 'hero' ? 0.07 : 0) + n.glow * 0.45;
      const e = 0.3 + n.glow * 0.7;
      n.edgeMat.opacity = e;
      n.edgeMat.color.copy(GLOW).multiplyScalar(n.glow > 0.05 ? 1 + n.glow * 1.4 : 1);
      if (n.glow <= 0.05) n.edgeMat.color.set(0xffffff);
      n.labelOn = n.glow > 0.5 || state.hovered === n;
      if (n.logoMats) {
        const hot = state.hovered === n;
        n.logoLevel = THREE.MathUtils.damp(n.logoLevel, hot ? 1 : n.glowTarget ? 0.62 : 0.2, 7, dt);
        const boost = hot ? 1 + (n.logoLevel - 0.62) * 1.4 : 1;
        for (const m of n.logoMats) {
          m.opacity = n.logoLevel;
          m.color.setScalar(Math.max(1, boost));
        }
      }
    }
    if (tfLogo.logoMats) {
      tfLogo.logoLevel = THREE.MathUtils.damp(tfLogo.logoLevel, state.mode === 'story' && state.step === TERRAFORM_STEP ? 1 : 0.2, 6, dt);
      for (const m of tfLogo.logoMats) m.opacity = tfLogo.logoLevel;
    }
    for (const g of logoGroups) g.rotation.y = rig.az; // logos stay upright for the camera
  }

  function updateLabels() {
    for (const n of nodes) {
      n.label.classList.toggle('is-on', n.labelOn);
      n.label.classList.toggle('is-hot', state.hovered === n);
      if (!n.labelOn) continue;
      _v.copy(n.top);
      _v.y += 0.3;
      _v.project(camera);
      const x = (_v.x * 0.5 + 0.5) * state.w;
      const y = (-_v.y * 0.5 + 0.5) * state.h;
      n.label.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
    const tfOn = state.mode === 'story' && state.step === TERRAFORM_STEP;
    tfLabel.classList.toggle('is-on', tfOn);
    tfLabel.classList.toggle('is-hot', tfOn);
    if (tfOn) {
      _v.set(AWS_BOUNDS.x0 + 0.4, 0.05, AWS_BOUNDS.z1).project(camera);
      tfLabel.style.transform = `translate3d(${((_v.x * 0.5 + 0.5) * state.w).toFixed(1)}px, ${((-_v.y * 0.5 + 0.5) * state.h).toFixed(1)}px, 0) translate(0, 8px)`;
    }
  }

  function applyRig() {
    const { az, el, dist, ox, oy } = rig;
    scene.fog.density = 0.72 / dist; // same haze at any camera distance (phones sit further back)
    camera.position.set(
      target.x + dist * Math.cos(el) * Math.sin(az),
      target.y + dist * Math.sin(el),
      target.z + dist * Math.cos(el) * Math.cos(az),
    );
    camera.lookAt(target);
    camera.setViewOffset(state.w, state.h, ox * state.w, oy * state.h, state.w, state.h);
  }

  function pick() {
    if (!state.pointerDirty) return;
    state.pointerDirty = false;
    raycaster.setFromCamera(state.pointer, camera);
    const hit = raycaster.intersectObjects(nodes.map((n) => n.mesh), false)[0];
    state.hovered = hit ? nodes.find((n) => n.mesh === hit.object) : null;
  }

  let idle = 0;
  function frame() {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();
    idle += dt;
    const sway = state.mode === 'hero' && !reducedMotion ? Math.sin(idle * 0.18) * 0.08 : 0;
    const px = reducedMotion ? 0 : state.pointer.x === 9 ? 0 : state.pointer.x;
    const py = reducedMotion ? 0 : state.pointer.y === 9 ? 0 : state.pointer.y;
    const damp = (a, b, l) => THREE.MathUtils.damp(a, b, l, dt);
    rig.az = damp(rig.az, rigTarget.az + sway + px * 0.07, 2.4);
    rig.el = damp(rig.el, rigTarget.el + py * 0.04, 2.4);
    rig.dist = damp(rig.dist, rigTarget.dist, 2.2);
    rig.ox = damp(rig.ox, rigTarget.ox, 2.6);
    rig.oy = damp(rig.oy, rigTarget.oy, 2.6);
    state.explode = damp(state.explode, state.explodeTarget, 3.2);
    if (Math.abs(state.explode - state.lastExplode) > 1e-4) placeNodes();
    applyRig();
    pick();
    updateNodes(dt);
    updatePackets(t);
    updateCells(t);
    updateLabels();
    renderer.render(scene, camera);
  }

  // One still frame with every damped value settled (reduced motion, paused, or on demand).
  function settle() {
    Object.assign(rig, rigTarget);
    state.explode = state.explodeTarget;
    placeNodes();
    applyRig();
    pick();
    for (const n of nodes) n.glow = Math.max(n.glowTarget, state.hovered === n ? 1 : 0);
    updateNodes(1);
    updatePackets(0.35);
    updateCells(0.6);
    updateLabels();
    renderer.render(scene, camera);
  }

  function loopShouldRun() {
    return state.active && !state.paused && !reducedMotion && !document.hidden;
  }
  function syncLoop() {
    renderer.setAnimationLoop(loopShouldRun() ? frame : null);
    if (state.active && !loopShouldRun()) settle();
  }

  function resize() {
    state.w = window.innerWidth;
    state.h = window.innerHeight;
    renderer.setSize(state.w, state.h, false); // also resizes the bloom pass
    camera.aspect = state.w / state.h;
    camera.updateProjectionMatrix();
    framing();
    if (!loopShouldRun() && state.active) settle();
  }

  function onPointer(e) {
    state.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    state.pointerDirty = true;
    if (!loopShouldRun() && state.active && reducedMotion) {
      pick();
      settle();
    }
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onPointer, { passive: true });
  document.addEventListener('visibilitychange', syncLoop);
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    renderer.setAnimationLoop(null);
    onLost?.();
  });

  await Promise.all([
    ...nodes.filter((n) => n.logos).map((n) => addLogos(n, n.logos, Math.min(n.s[0], n.s[2]) * (n.logos.length > 1 ? 0.4 : 0.58))),
    addLogos(tfLogo, ['terraform'], 0.85),
  ]);

  resize();
  placeNodes();
  paintLinks();
  updateCells(0);
  updatePackets(0);
  applyRig();
  await renderer.compileAsync(scene, camera); // instance colours exist by now, so shaders compile once
  settle();

  return {
    // Screen position of a node's top face (used by ?debug tests).
    screenOf(id) {
      const n = byId[id];
      if (!n) return null;
      _v.copy(n.top).project(camera);
      return { x: Math.round((_v.x * 0.5 + 0.5) * state.w), y: Math.round((-_v.y * 0.5 + 0.5) * state.h) };
    },
    logoLevels() {
      return Object.fromEntries(nodes.filter((n) => n.logoMats).map((n) => [n.id, Math.round(n.logoLevel * 100) / 100]));
    },
    setActive(on) {
      if (state.active === on) return;
      state.active = on;
      syncLoop();
    },
    setPaused(paused) {
      state.paused = paused;
      syncLoop();
    },
    setMode(mode) {
      if (state.mode === mode) return;
      state.mode = mode;
      if (mode === 'hero') state.step = -1;
      framing();
      paintLinks();
      if (!loopShouldRun() && state.active) settle();
    },
    setProgress(p) {
      state.progress = p;
      const step = Math.min(STEP_COUNT - 1, Math.floor(p * STEP_COUNT));
      framing();
      if (step !== state.step) {
        state.step = step;
        paintLinks();
      }
      if (!loopShouldRun() && state.active) settle();
    },
  };
}

function roundedRect({ x0, x1, z0, z1 }, r) {
  const shape = new THREE.Shape();
  shape.moveTo(x0 + r, z0);
  shape.lineTo(x1 - r, z0);
  shape.quadraticCurveTo(x1, z0, x1, z0 + r);
  shape.lineTo(x1, z1 - r);
  shape.quadraticCurveTo(x1, z1, x1 - r, z1);
  shape.lineTo(x0 + r, z1);
  shape.quadraticCurveTo(x0, z1, x0, z1 - r);
  shape.lineTo(x0, z0 + r);
  shape.quadraticCurveTo(x0, z0, x0 + r, z0);
  return shape.getPoints(8);
}

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(77,141,255,0.55)');
  grad.addColorStop(0.45, 'rgba(77,141,255,0.12)');
  grad.addColorStop(1, 'rgba(77,141,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
