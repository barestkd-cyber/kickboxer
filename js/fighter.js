// Procedural 3D fighter: a jointed rig driven by pose keyframes.
// Rig is modeled in meters (1.8 m tall) and scaled by SC into world units.
// Model faces +Z locally; +X is the fighter's left. Orthodox stance (left side forward).
import * as THREE from 'three';
import { clamp, angDiff } from './sim.js';

export const SC = 1.8;

// Joint angles in radians. Shoulders/hips use Euler order YXZ:
// z = raise out to the side, x = swing forward (negative), y = yaw around the body.
const GUARD = {
  pY: -0.45, sX: 0.12, sY: 0.32, sZ: 0, hX: -0.1, lunge: 0, drop: 0.05,
  lShX: -1.0, lShY: -0.2, lShZ: 0.18, lEl: -2.25,
  rShX: -0.85, rShY: 0.3, rShZ: -0.18, rEl: -2.4,
  lHX: -0.5, lHY: 0.1, lHZ: 0.05, lKn: 0.6,
  rHX: 0.05, rHY: -0.1, rHZ: -0.06, rKn: 0.6,
  koT: 0,
};
const KEYS = Object.keys(GUARD);
const P = o => ({ ...GUARD, ...o });

const BLOCK = P({ lShX: -1.3, lShY: -0.4, lShZ: 0.1, lEl: -2.65, rShX: -1.3, rShY: 0.45, rShZ: -0.1, rEl: -2.65,
                  sX: 0.3, hX: 0.25, drop: 0.1, pY: -0.35, sY: 0.25 });
const HIT = P({ sX: -0.3, hX: -0.55, lunge: -0.1, lShX: -0.5, lEl: -1.6, rShX: -0.4, rEl: -1.7, drop: 0.08 });

const ATK = {
  jab: {
    wind: P({ lEl: -2.35, sY: 0.4, drop: 0.07 }),
    hit:  P({ lShX: -1.6, lShY: 0.5, lShZ: 0, lEl: -0.05, sY: -0.1, sX: 0.2, pY: -0.55, lunge: 0.16, hX: -0.2, rShX: -0.9, rEl: -2.45 }),
  },
  hook: {
    wind: P({ sY: 0.05, rShZ: -1.1, rShX: -0.3, rShY: -0.3, rEl: -1.3, drop: 0.08 }),
    hit:  P({ sY: 1.05, pY: -0.1, sZ: 0.1, rShZ: -1.5, rShX: 0, rShY: 1.1, rEl: -1.5, lunge: 0.1,
              lShX: -1.1, lShY: 0.4, lEl: -2.4 }),
  },
  kick: {
    wind: P({ pY: 0.05, sZ: -0.2, sX: -0.05, rHZ: -1.2, rHY: 0.25, rHX: 0, rKn: 2.1, lKn: 0.25, lHX: -0.2, lHZ: 0.05,
              rShX: 0.1, rShZ: -0.4, rEl: -1.0, drop: 0 }),
    hit:  P({ pY: 0.65, sZ: -0.45, sX: -0.2, sY: -0.25, rHZ: -1.65, rHY: 1.05, rHX: 0, rKn: 0.08, lKn: 0.08, lHX: 0, lHZ: 0.05,
              lunge: 0.18, rShX: 0.4, rShY: -0.4, rShZ: -0.6, rEl: -0.5, drop: 0 }),
  },
};

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
function mix(a, b, t) { const o = {}; for (const k of KEYS) o[k] = lerp(a[k], b[k], t); return o; }

function targetPose(f) {
  if (f.ko) return HIT;
  switch (f.state) {
    case 'block': return BLOCK;
    case 'hitstun': return HIT;
    case 'startup': return mix(GUARD, ATK[f.atk.key].wind, smooth(clamp(1 - f.t / f.startupT, 0, 1)));
    case 'active': return mix(ATK[f.atk.key].wind, ATK[f.atk.key].hit, 1 - Math.pow(clamp(f.t / f.atk.active, 0, 1), 2));
    case 'recovery': {
      if (!f.atk) return GUARD;
      // hold the extended pose briefly — longer after a miss, so the opening is visible
      const w = 1 - f.t / f.recT, hold = f.missed ? 0.45 : 0.15;
      return mix(ATK[f.atk.key].hit, GUARD, smooth(clamp((w - hold) / (1 - hold), 0, 1)));
    }
  }
  return GUARD;
}

function std(color, rough = 0.6, metal = 0) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); }

export class FighterModel {
  // scheme: { skin, shorts, trim, gloves, hair }
  constructor(scheme) {
    this.root = new THREE.Group();
    this.root.scale.setScalar(SC);
    this.body = new THREE.Group();
    this.root.add(this.body);
    const m = this.mats = {
      skin: std(scheme.skin, 0.55), shorts: std(scheme.shorts, 0.45), trim: std(scheme.trim, 0.5),
      gloves: std(scheme.gloves, 0.28, 0.1), hair: std(scheme.hair, 0.8), cuff: std('#f2f2f2', 0.4),
    };
    const add = (parent, mesh, x = 0, y = 0, z = 0) => { mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh; };
    const sphere = (r, mat, sx = 1, sy = 1, sz = 1) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat); s.scale.set(sx, sy, sz); return s; };
    const cap = (r, len, mat) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 12), mat);
    const joint = (parent, x, y, z, order = 'XYZ') => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.order = order; parent.add(g); return g; };
    const seg = (parent, r, len, mat) => add(parent, cap(r, len, mat), 0, -len / 2, 0);

    const pelvis = this.pelvis = joint(this.body, 0, 0.95, 0);
    add(pelvis, sphere(1, m.shorts, 0.19, 0.14, 0.135), 0, -0.02, 0);
    const band = add(pelvis, new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.055, 20), m.trim), 0, 0.08, 0);
    band.scale.z = 0.75;

    const spine = this.spine = joint(pelvis, 0, 0.06, 0, 'YXZ');
    add(spine, cap(0.13, 0.14, m.skin), 0, 0.1, 0).scale.set(1.2, 1, 0.82);
    const chest = joint(spine, 0, 0.24, 0);
    add(chest, sphere(1, m.skin, 0.225, 0.17, 0.145), 0, 0.1, 0.01);
    for (const sx of [-1, 1]) add(chest, sphere(0.085, m.skin, 1.1, 0.8, 0.7), 0.085 * sx, 0.1, 0.07); // pecs
    const traps = add(chest, cap(0.085, 0.3, m.skin), 0, 0.19, -0.01);
    traps.rotation.z = Math.PI / 2; traps.scale.z = 0.85;
    add(chest, cap(0.062, 0.06, m.skin), 0, 0.29, 0);
    const head = this.head = joint(chest, 0, 0.36, 0);
    add(head, sphere(0.105, m.skin, 0.9, 1.1, 1), 0, 0.1, 0);
    const hair = add(head, new THREE.Mesh(new THREE.SphereGeometry(0.108, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.hair), 0, 0.115, -0.008);
    hair.scale.set(0.93, 1.0, 1.02);
    add(head, sphere(0.022, m.skin), 0, 0.09, 0.1); // nose: makes facing readable from above

    const arm = (side) => {
      const sh = joint(chest, 0.2 * side, 0.19, 0, 'YXZ');
      add(sh, sphere(0.085, m.skin));
      seg(sh, 0.062, 0.22, m.skin);
      add(sh, sphere(0.06, m.skin, 1, 1.5, 1), 0, -0.13, 0.02); // biceps
      const el = joint(sh, 0, -0.28, 0);
      seg(el, 0.052, 0.19, m.skin);
      add(el, new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.07, 14), m.cuff), 0, -0.21, 0);
      add(el, sphere(0.085, m.gloves, 1, 1.15, 1.05), 0, -0.3, 0.01);
      return { sh, el };
    };
    const leg = (side) => {
      const hip = joint(pelvis, 0.1 * side, -0.06, 0, 'YXZ');
      add(hip, cap(0.105, 0.14, m.shorts), 0, -0.1, 0);
      seg(hip, 0.088, 0.34, m.skin);
      const kn = joint(hip, 0, -0.44, 0);
      seg(kn, 0.062, 0.36, m.skin);
      add(kn, sphere(0.06, m.skin, 1, 1.9, 1.1), 0, -0.13, -0.025); // calf
      const an = joint(kn, 0, -0.44, 0);
      add(an, new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.22), m.skin), 0, -0.025, 0.055);
      return { hip, kn, an };
    };
    this.L = { ...arm(1), ...leg(1) };
    this.Rt = { ...arm(-1), ...leg(-1) };

    this.pose = { ...GUARD };
    this.phase = 0;
    this.koT = 0;
    this._v = new THREE.Vector3();
  }

  update(f, dt, time) {
    this.root.position.set(f.x, 0, f.y);
    // a knocked-out fighter spins toward the chosen fall direction instead of snapping
    const yaw = Math.PI / 2 - f.face;
    this.root.rotation.y = f.ko ? this.root.rotation.y + angDiff(yaw, this.root.rotation.y) * Math.min(1, dt * 10) : yaw;

    // target pose from game state, plus footwork
    const t = { ...targetPose(f) };
    const kicking = f.atk && f.atk.key === 'kick' && f.state !== 'recovery';
    if (!f.ko && !kicking && f.state !== 'hitstun') {
      const sp = Math.hypot(f.vx, f.vy) / 3;
      const fwd = (f.vx * Math.cos(f.face) + f.vy * Math.sin(f.face)) / 3;
      const side = (f.vx * Math.sin(f.face) - f.vy * Math.cos(f.face)) / 3;
      if (sp > 0.05) this.phase += dt * (9 + 5 * sp);
      const s = Math.sin(this.phase), c = Math.cos(this.phase), a = clamp(sp, 0, 1);
      t.lHX += s * 0.4 * fwd; t.rHX -= s * 0.4 * fwd;
      t.lHZ += Math.max(0, s) * 0.3 * Math.abs(side); t.rHZ -= Math.max(0, -s) * 0.3 * Math.abs(side);
      t.lKn += Math.max(0, c) * 0.55 * a; t.rKn += Math.max(0, -c) * 0.55 * a;
      t.drop += 0.03 * a * Math.abs(Math.sin(this.phase * 2));
      // boxer's bounce when standing
      const b = (0.5 + 0.5 * Math.sin(time * 7.5)) * (1 - a);
      t.drop += b * 0.025; t.lKn += b * 0.12; t.rKn += b * 0.12;
    }
    if (f.ko) this.koT += dt; else this.koT = 0;

    const k = 1 - Math.exp(-dt * (f.state === 'active' || f.state === 'startup' ? 40 : 18));
    const p = this.pose;
    for (const key of KEYS) p[key] += (t[key] - p[key]) * k;
    this.apply(p);

    // hit flash
    const fl = clamp(f.flash / 0.15, 0, 1);
    this.mats.skin.emissive.setRGB(fl * 0.45, fl * 0.3, fl * 0.2);

    // knockdown: fall backwards; otherwise plant the lowest foot on the floor
    if (f.ko) {
      const u = Math.min(1, this.koT / 0.55);
      this.body.rotation.x = -u * u * 1.45;
      this.body.position.y = 0.1 * u;
      this.body.position.z = p.lunge - 0.3 * u;
    } else {
      this.body.rotation.x = 0;
      this.body.position.set(0, 0, p.lunge);
      this.root.updateMatrixWorld(true);
      const yl = this.L.an.getWorldPosition(this._v).y;
      const yr = this.Rt.an.getWorldPosition(this._v).y;
      this.body.position.y = -(Math.min(yl, yr) - 0.06 * SC) / SC;
    }
  }

  apply(p) {
    this.pelvis.position.y = 0.95 - p.drop;
    this.pelvis.rotation.y = p.pY;
    this.spine.rotation.set(p.sX, p.sY, p.sZ);
    this.head.rotation.x = p.hX;
    const { L, Rt } = this;
    L.sh.rotation.set(p.lShX, p.lShY, p.lShZ);  L.el.rotation.x = p.lEl;
    Rt.sh.rotation.set(p.rShX, p.rShY, p.rShZ); Rt.el.rotation.x = p.rEl;
    L.hip.rotation.set(p.lHX, p.lHY, p.lHZ);    L.kn.rotation.x = p.lKn;
    Rt.hip.rotation.set(p.rHX, p.rHY, p.rHZ);   Rt.kn.rotation.x = p.rKn;
    // keep feet roughly flat
    L.an.rotation.x = -(p.lHX + p.lKn);
    Rt.an.rotation.x = -(p.rHX + p.rKn);
  }
}
