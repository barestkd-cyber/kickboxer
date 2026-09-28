// Three.js presentation: octagon cage, arena lighting, crowd, floor indicators, hit FX, camera.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ARENA, R, ATTACKS, DEG, S, angDiff, clamp } from './sim.js';
import { FighterModel, SC } from './fighter.js';

const BLUE = 0x2f7bff, RED = 0xff2a2a;
const FENCE_H = 3.0;
const CR = ARENA / Math.cos(22.5 * DEG);   // octagon circumradius

function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  t.anisotropy = 4;
  return t;
}

function octShape(ap) {
  const cr = ap / Math.cos(22.5 * DEG), s = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const a = (22.5 + i * 45) * DEG;
    i ? s.lineTo(Math.cos(a) * cr, Math.sin(a) * cr) : s.moveTo(Math.cos(a) * cr, Math.sin(a) * cr);
  }
  s.closePath();
  return s;
}

// flat mesh lying on the floor; `geo` is built in the XY plane
function flat(geo, mat, y = 0.02) {
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2; m.position.y = y;
  return m;
}
const basic = (color, opacity = 1, additive = false) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, depthWrite: false,
  blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide,
});

// ---------------------------------------------------------------- textures
function matTexture(font) {
  const S2 = CR + 0.2; // texture spans [-S2, S2]
  return canvasTex(2048, 2048, (g, w) => {
    const u = w / (2 * S2); // px per world unit
    const X = x => (x + S2) * u, Y = y => (y + S2) * u;
    g.fillStyle = '#8e9197'; g.fillRect(0, 0, w, w);
    // canvas grain + scuffs
    for (let i = 0; i < 26000; i++) {
      const v = Math.random() < 0.5 ? 255 : 0;
      g.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.05})`;
      g.fillRect(Math.random() * w, Math.random() * w, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
    g.strokeStyle = 'rgba(40,40,45,0.08)'; g.lineWidth = 3;
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * w, y = Math.random() * w, a = Math.random() * 6.28, l = 20 + Math.random() * 90;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 1) * l, y + Math.sin(a + 1) * l, x + Math.cos(a) * l * 1.6, y + Math.sin(a) * l * 1.6); g.stroke();
    }
    const oct = (ap, keep) => {
      const cr = ap / Math.cos(22.5 * DEG);
      if (!keep) g.beginPath();
      for (let i = 0; i < 8; i++) { const a = (22.5 + i * 45) * DEG; const px = X(Math.cos(a) * cr), py = Y(Math.sin(a) * cr); i ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.closePath();
    };
    // dark border band along the fence
    oct(ARENA + 0.2); oct(ARENA - 0.55, true); g.fillStyle = '#2c2e33'; g.fill('evenodd');
    oct(ARENA - 0.55); g.strokeStyle = 'rgba(235,235,235,0.9)'; g.lineWidth = 0.06 * u; g.stroke();
    // inner octagon ring
    oct(3.6); g.strokeStyle = 'rgba(45,46,50,0.75)'; g.lineWidth = 0.28 * u; g.stroke();
    // red corner chevrons
    g.fillStyle = 'rgba(190,34,40,0.8)';
    for (const [cx, cy, rot] of [[-4.3, -2.6, -0.5], [4.3, -2.6, 0.5], [-4.3, 2.8, 0.5], [4.3, 2.8, -0.5]]) {
      g.save(); g.translate(X(cx), Y(cy)); g.rotate(rot);
      for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-0.45 * u, (i * 0.24 - 0.3) * u); g.lineTo(0.45 * u, (i * 0.24 - 0.42) * u); g.lineTo(0.45 * u, (i * 0.24 - 0.3) * u); g.lineTo(-0.45 * u, (i * 0.24 - 0.18) * u); g.fill(); }
      g.restore();
    }
    // centre logo
    g.save(); g.translate(X(0), Y(0.9)); g.transform(1, 0, -0.18, 1, 0, 0);
    g.fillStyle = 'rgba(38,39,43,0.82)';
    g.font = `700 ${1.55 * u}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('KICKBOXER', 0, 0);
    g.fillStyle = 'rgba(185,30,36,0.85)';
    g.beginPath(); g.moveTo(-2.6 * u, 0.95 * u); g.lineTo(2.9 * u, 0.62 * u); g.lineTo(2.4 * u, 0.82 * u); g.lineTo(-2.9 * u, 1.08 * u); g.fill();
    g.restore();
    // crown
    g.save(); g.translate(X(0), Y(-0.55)); g.fillStyle = 'rgba(38,39,43,0.82)';
    const c = 0.32 * u;
    g.beginPath(); g.moveTo(-c, c * 0.5); g.lineTo(-c, -c * 0.4); g.lineTo(-c * 0.5, 0); g.lineTo(0, -c * 0.6); g.lineTo(c * 0.5, 0); g.lineTo(c, -c * 0.4); g.lineTo(c, c * 0.5); g.fill();
    g.restore();
    // side slogans
    g.fillStyle = 'rgba(45,46,50,0.7)'; g.font = `700 ${0.5 * u}px ${font}`;
    g.save(); g.translate(X(-3.7), Y(-0.2)); g.rotate(-0.12); g.textAlign = 'center';
    ['STRIKE', 'MOVE', 'EVOLVE'].forEach((s, i) => g.fillText(s, 0, (i - 1) * 0.55 * u)); g.restore();
    g.save(); g.translate(X(3.7), Y(-0.1)); g.rotate(0.12); g.textAlign = 'center';
    ['FIGHT', 'SMARTER'].forEach((s, i) => g.fillText(s, 0, (i - 0.5) * 0.55 * u)); g.restore();
  });
}

function chainTexture() {
  return canvasTex(64, 64, (g, w) => {
    g.clearRect(0, 0, w, w);
    g.strokeStyle = 'rgba(210,214,222,1)'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, w / 2); g.lineTo(w / 2, 0); g.lineTo(w, w / 2); g.lineTo(w / 2, w); g.closePath(); g.stroke();
  }, { repeat: [1, 1] });
}

function crowdTexture() {
  return canvasTex(1024, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#07080c'); grd.addColorStop(1, '#161922');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let row = 0; row < 7; row++) {
      const y = h - 18 - row * 34;
      for (let x = -10; x < w + 10; x += 16 + Math.random() * 8) {
        const l = 26 + Math.random() * 26 - row * 2;
        const tint = Math.random() < 0.15 ? (Math.random() < 0.5 ? '30,40,80' : '80,25,25') : `${l},${l},${l + 4}`;
        g.fillStyle = `rgb(${tint})`;
        g.beginPath(); g.ellipse(x, y + 8, 9, 12, 0, 0, Math.PI * 2); g.fill();   // shoulders
        g.beginPath(); g.arc(x, y - 8, 5.5, 0, Math.PI * 2); g.fill();          // head
      }
    }
  }, { repeat: [5, 1] });
}

function textTexture(text, color) {
  return canvasTex(128, 512, (g, w, h) => {
    g.fillStyle = '#16171b'; g.fillRect(0, 0, w, h);
    g.save(); g.translate(w / 2, h / 2); g.rotate(Math.PI / 2);
    g.fillStyle = color; g.font = '700 64px Oswald, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 0, 4); g.restore();
    g.fillStyle = color; g.fillRect(6, 0, 5, h); g.fillRect(w - 11, 0, 5, h);
  });
}

function glowTexture() {
  return canvasTex(64, 64, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.5)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
}

// ---------------------------------------------------------------- world
export class World {
  constructor(canvas, font) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;

    const sc = this.scene = new THREE.Scene();
    sc.background = new THREE.Color(0x050608);
    sc.fog = new THREE.Fog(0x050608, 24, 48);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 120);
    this.camTarget = new THREE.Vector3();
    this.camDist = 12; this.camOverride = null;
    this.glow = glowTexture();

    this.buildLights();
    this.buildArena(font);
    this.buildCrowd();

    this.player = new FighterModel({ skin: '#d9a47f', shorts: '#1537a8', trim: '#e8ecff', gloves: '#1f5cff', hair: '#2a1d16' });
    this.cpu = new FighterModel({ skin: '#b87a55', shorts: '#b01218', trim: '#1a1a1a', gloves: '#d4141c', hair: '#141010' });
    sc.add(this.player.root, this.cpu.root);
    this.buildIndicators();
    this.buildFx();

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(sc, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  buildLights() {
    const sc = this.scene;
    sc.add(new THREE.HemisphereLight(0x8a9ab8, 0x0c0c10, 0.55));
    const spot = new THREE.SpotLight(0xffffff, 2.5, 0, 0.62, 0.6, 0);
    spot.position.set(0, 18, 3);
    spot.target.position.set(0, 0, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.camera.near = 8; spot.shadow.camera.far = 30;
    spot.shadow.bias = -0.0004;
    sc.add(spot, spot.target);
    // corner colour washes (blue side / red side)
    const b = new THREE.PointLight(BLUE, 1.6, 22, 1); b.position.set(-8, 5, 1); sc.add(b);
    const rd = new THREE.PointLight(RED, 1.6, 22, 1); rd.position.set(8, 5, 1); sc.add(rd);
  }

  buildArena(font) {
    const sc = this.scene;
    // mat
    const matGeo = new THREE.ShapeGeometry(octShape(ARENA + 0.2));
    const S2 = CR + 0.2, pos = matGeo.attributes.position, uv = matGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (2 * S2) + 0.5, pos.getY(i) / (2 * S2) + 0.5);
    const mat = flat(matGeo, new THREE.MeshStandardMaterial({ map: matTexture(font), roughness: 0.85 }), 0);
    mat.receiveShadow = true;
    sc.add(mat);
    // apron outside the fence + platform skirt + floor
    const apronGeo = new THREE.ShapeGeometry((() => { const s = octShape(ARENA + 1.6); s.holes.push(octShape(ARENA + 0.2)); return s; })());
    sc.add(flat(apronGeo, new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.7 }), 0));
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry((ARENA + 1.6) / Math.cos(22.5 * DEG), (ARENA + 1.6) / Math.cos(22.5 * DEG), 1.2, 8, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.6 }));
    skirt.rotation.y = 22.5 * DEG; skirt.position.y = -0.6; sc.add(skirt);
    const floor = flat(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x060608, roughness: 1 }), -1.2);
    sc.add(floor);

    // fence panels, rails, pads, LED strips
    const chain = chainTexture();
    const blackPad = new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 0.45, metalness: 0.1 });
    const ledMat = c => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.2) });
    const sideW = 2 * ARENA * Math.tan(22.5 * DEG);
    for (let i = 0; i < 8; i++) {
      const a = i * 45 * DEG, nx = Math.cos(a), nz = Math.sin(a);
      const near = nz > 0.3; // panels between the camera and the fight
      const g = new THREE.Group();
      g.position.set(nx * (ARENA + 0.12), 0, nz * (ARENA + 0.12));
      g.rotation.y = Math.PI / 2 - a;
      const tex = chain.clone(); tex.needsUpdate = true; tex.repeat.set(sideW / 0.28, FENCE_H / 0.28);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sideW, FENCE_H - 0.5),
        new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: near ? 0.25 : 0.8, depthWrite: false, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.4, color: 0x9aa0aa }));
      mesh.position.y = FENCE_H / 2 + 0.2; g.add(mesh);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(sideW, 0.5, 0.22), blackPad); pad.position.y = 0.25; pad.receiveShadow = true; g.add(pad);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(sideW, 0.22, 0.26), blackPad); rail.position.y = FENCE_H; g.add(rail);
      const col = nx < -0.3 ? BLUE : nx > 0.3 ? RED : 0x6f7890;
      const led = new THREE.Mesh(new THREE.BoxGeometry(sideW - 0.3, 0.05, 0.04), ledMat(col)); led.position.set(0, FENCE_H - 0.14, -0.15); g.add(led);
      const led2 = led.clone(); led2.position.y = 0.52; g.add(led2);
      sc.add(g);
    }
    // corner posts with branded padding
    for (let i = 0; i < 8; i++) {
      const a = (22.5 + i * 45) * DEG, x = Math.cos(a) * (CR + 0.12), z = Math.sin(a) * (CR + 0.12);
      const blue = x < 0;
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = Math.PI / 2 - a;
      const faceMat = new THREE.MeshStandardMaterial({ map: textTexture('KICKBOXER', blue ? '#6aa2ff' : '#ff5a5a'), roughness: 0.5 });
      const mats = [blackPad, blackPad, blackPad, blackPad, blackPad, faceMat];
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.46, FENCE_H + 0.35, 0.4), mats);
      post.position.y = (FENCE_H + 0.35) / 2; post.castShadow = true; g.add(post);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, FENCE_H + 0.2, 0.05), ledMat(blue ? BLUE : RED));
      for (const sx of [-0.25, 0.25]) { const s = strip.clone(); s.position.set(sx, (FENCE_H + 0.35) / 2, -0.21); g.add(s); }
      sc.add(g);
    }
  }

  buildCrowd() {
    const tex = crowdTexture();
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(19, 23, 12, 48, 1, true),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, color: 0xffffff }));
    cyl.position.y = 4.8; this.scene.add(cyl);
    // camera flashes in the crowd
    this.flashes = [];
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      const a = Math.random() * Math.PI * 2, h = 0.5 + Math.random() * 7;
      s.position.set(Math.cos(a) * (19.5 + h * 0.3), h, Math.sin(a) * (19.5 + h * 0.3));
      s.scale.setScalar(0.9);
      this.scene.add(s); this.flashes.push({ s, t: Math.random() * 4 });
    }
  }

  buildIndicators() {
    const mk = (isPlayer) => {
      const col = isPlayer ? BLUE : RED;
      const g = new THREE.Group();
      const ring = flat(new THREE.RingGeometry(0.62, 0.74, 48), basic(col, 0.85, true), 0.03);
      const disc = flat(new THREE.CircleGeometry(0.74, 48), basic(col, 0.12, true), 0.025);
      g.add(ring, disc);
      // facing wedge (rotates with facing)
      const aim = new THREE.Group(); g.add(aim);
      const wedge = flat(new THREE.CircleGeometry(0.95, 3, -0.28, 0.56), basic(col, 0.5, true), 0.035);
      aim.add(wedge);
      // per-attack range arcs and wind-up telegraphs
      const arcs = {}, tele = {};
      for (const key of ['jab', 'hook', 'kick']) {
        const A = ATTACKS[key], half = (A.arc / 2) * DEG, rr = A.range + R;
        if (isPlayer) {
          arcs[key] = flat(new THREE.RingGeometry(rr - 0.04, rr + 0.04, 40, 1, -half, 2 * half), basic(A.color, 0.25, true), 0.04);
          aim.add(arcs[key]);
        }
        tele[key] = flat(new THREE.CircleGeometry(rr, 40, -half, 2 * half), basic(isPlayer ? A.color : 0xff2a1a, 0, true), 0.045);
        aim.add(tele[key]);
      }
      // guard shield + vulnerable ring
      const shield = flat(new THREE.RingGeometry(0.9, 1.02, 32, 1, -1.0, 2.0), basic(0x9fc8ff, 0, true), 0.05); aim.add(shield);
      const open = flat(new THREE.RingGeometry(0.8, 0.95, 48), basic(0xffa020, 0, true), 0.05); g.add(open);
      this.scene.add(g);
      return { g, aim, ring, arcs, tele, shield, open };
    };
    this.ind = { player: mk(true), cpu: mk(false) };
  }

  buildFx() {
    this.sparks = [];
    for (let i = 0; i < 90; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.visible = false; this.scene.add(s);
      this.sparks.push({ s, v: new THREE.Vector3(), t: 0, life: 1 });
    }
    this.rings = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; this.scene.add(m); this.rings.push({ s: m, t: 0 });
    }
    this.sparkIdx = 0; this.ringIdx = 0;
  }

  // impact at sim (x, y); punches land high, kicks at body height
  spawnHit({ x, y, atk, dmg, blocked }) {
    const h = atk.key === 'kick' ? 1.15 * SC : 1.52 * SC;
    const col = new THREE.Color(blocked ? 0x9fc8ff : 0xfff0b0);
    const n = blocked ? 8 : 14 + dmg;
    for (let i = 0; i < n; i++) {
      const p = this.sparks[this.sparkIdx++ % this.sparks.length];
      p.s.visible = true; p.s.position.set(x, h, y);
      p.v.set(Math.random() - 0.5, Math.random() * 0.8 - 0.2, Math.random() - 0.5).normalize().multiplyScalar(3 + Math.random() * 6);
      p.t = p.life = 0.2 + Math.random() * 0.25;
      p.s.material.color.copy(col); p.s.scale.setScalar(0.12 + Math.random() * 0.1);
    }
    const r = this.rings[this.ringIdx++ % this.rings.length];
    r.s.visible = true; r.s.position.set(x, h, y); r.t = 0.18; r.big = blocked ? 1.2 : 1.6 + dmg * 0.06;
    r.s.material.color.copy(col);
  }

  // world position -> screen px
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight, v.z < 1];
  }

  update(dt, time, showArcs) {
    const { player, cpu } = S;
    this.player.update(player, dt, time);
    this.cpu.update(cpu, dt, time);
    this.updateIndicators(this.ind.player, player, cpu, time, showArcs);
    this.updateIndicators(this.ind.cpu, cpu, player, time, false);

    for (const p of this.sparks) {
      if (!p.s.visible) continue;
      p.t -= dt;
      if (p.t <= 0) { p.s.visible = false; continue; }
      p.s.position.addScaledVector(p.v, dt); p.v.multiplyScalar(0.88); p.v.y -= 9 * dt;
      p.s.material.opacity = p.t / p.life;
    }
    for (const r of this.rings) {
      if (!r.s.visible) continue;
      r.t -= dt;
      if (r.t <= 0) { r.s.visible = false; continue; }
      const u = 1 - r.t / 0.18;
      r.s.scale.setScalar(0.3 + u * r.big); r.s.material.opacity = 1 - u;
    }
    for (const f of this.flashes) {
      f.t -= dt;
      if (f.t <= 0) { f.t = 0.5 + Math.random() * 5; f.on = 0.07; }
      f.on = Math.max(0, (f.on || 0) - dt);
      f.s.material.opacity = f.on > 0 ? 1 : 0;
    }

    // camera: follow the fighters' midpoint; pull back as they separate and on tall screens
    const mx = (player.x + cpu.x) / 2, mz = (player.y + cpu.y) / 2;
    const d = Math.hypot(player.x - cpu.x, player.y - cpu.y);
    const aspect = innerWidth / innerHeight;
    const fit = aspect < 1.3 ? Math.pow(1.3 / aspect, 0.8) : 1;
    const ov = this.camOverride; // dev: { dist, el, yaw }
    const want = (ov ? ov.dist : clamp(7 + d * 1.0, 8.5, 13)) * fit;
    const k = 1 - Math.exp(-dt * 3.5);
    this.camTarget.x += (mx * 0.85 - this.camTarget.x) * k;
    this.camTarget.z += (mz * 0.85 - this.camTarget.z) * k;
    this.camTarget.y = 1.4;
    this.camDist += (want - this.camDist) * k;
    const el = (ov ? ov.el : 54) * DEG, yaw = ov ? ov.yaw * DEG : 0;
    const c = this.camera;
    c.position.set(this.camTarget.x + Math.sin(yaw) * Math.cos(el) * this.camDist, this.camTarget.y + Math.sin(el) * this.camDist,
                   this.camTarget.z + Math.cos(yaw) * Math.cos(el) * this.camDist);
    if (S.shake > 0) c.position.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(S.shake * 2.2));
    c.lookAt(this.camTarget);

    this.composer.render();
  }

  updateIndicators(ind, f, opp, time, showArcs) {
    ind.g.position.set(f.x, 0, f.y);
    ind.aim.rotation.y = -f.face;
    ind.g.visible = !f.ko;
    const d = Math.hypot(opp.x - f.x, opp.y - f.y);
    const ang = Math.abs(angDiff(Math.atan2(opp.y - f.y, opp.x - f.x), f.face));
    for (const key in ind.arcs) {
      const A = ATTACKS[key];
      const inRange = d - R <= A.range && ang <= (A.arc / 2) * DEG;
      ind.arcs[key].visible = showArcs && !S.over;
      ind.arcs[key].material.opacity = inRange ? 0.95 : 0.22;
    }
    for (const key in ind.tele) {
      const m = ind.tele[key].material;
      if (f.atk && f.atk.key === key && (f.state === 'startup' || f.state === 'active')) {
        m.opacity = f.state === 'active' ? 0.5 : 0.12 + 0.2 * (1 - f.t / f.startupT);
      } else m.opacity = 0;
    }
    ind.shield.material.opacity = f.state === 'block' ? 0.9 : 0;
    const open = f.state === 'recovery' && f.missed && f.atk && f.atk.key !== 'jab';
    ind.open.material.opacity = open ? 0.5 + 0.5 * Math.sin(time * 30) : 0;
  }
}
