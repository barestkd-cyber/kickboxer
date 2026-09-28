// Game rules and state. Pure logic: no rendering. The simulation runs on a 2D plane
// (x, y); the renderer maps sim y to world z.

export const DEG = Math.PI / 180;
export const ARENA = 6;            // octagon apothem (world units)
export const R = 0.45;             // fighter body radius
export const MOVE_SPEED = 3.0;
export const MAX_HP = 100, MAX_ST = 100;
const ST_REGEN = 22, ST_REGEN_BLOCK = 6, ST_REGEN_DELAY = 0.45;
const BLOCK_MULT = 0.15;           // damage taken while blocking

// CPU difficulty: all the knobs in one place (lower = easier)
export const AI = {
  thinkMin: 0.9, thinkMax: 1.6, // seconds between attack decisions
  attackChance: 0.75,           // scales how often it throws when a decision comes up
  blockChance: 0.1,             // chance to block when it sees your wind-up
  extraStartup: 0.15,           // added wind-up on its attacks, so you can react to the red cone
  damageMult: 0.6,              // its hits do 60% damage
  speedMult: 0.75,              // it moves slower than you
};

// range = reach from attacker's center to the target's body edge
export const ATTACKS = {
  jab:  { key: 'jab',  name: 'JAB',        startup: 0.07, active: 0.08, recovery: 0.14, missRecovery: 0.05, range: 1.55, arc: 40,  dmg: 5,  stam: 7,  color: '#5fd0ff' },
  hook: { key: 'hook', name: 'HOOK',       startup: 0.18, active: 0.10, recovery: 0.22, missRecovery: 0.38, range: 1.10, arc: 110, dmg: 12, stam: 15, color: '#ffae3a' },
  kick: { key: 'kick', name: 'ROUND KICK', startup: 0.32, active: 0.12, recovery: 0.32, missRecovery: 0.60, range: 2.10, arc: 85,  dmg: 18, stam: 25, color: '#c77dff' },
};
// movement speed multiplier and max turn rate (rad/s) by state
const STATE_MOVE = { idle: 1, block: 0.4, startup: 0.3, active: 0.2, recovery: 0.35, hitstun: 0 };
const STATE_TURN = { idle: 10, block: 8, startup: 3, active: 1.2, recovery: 3, hitstun: 0 };

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const rand = (a, b) => a + Math.random() * (b - a);

// Shared state. `emit(type, data)` is set by main.js for effects/HUD.
export const S = {
  player: null, cpu: null, ai: null,
  practice: false, over: false, overTimer: 0,
  hitstop: 0, shake: 0, time: 0, lastGesture: '-',
  emit: () => {},
};
let atkCounter = 0;

function makeFighter(x, y, face, isPlayer) {
  return {
    x, y, vx: 0, vy: 0, kx: 0, ky: 0, face, isPlayer,
    hp: MAX_HP, st: MAX_ST, state: 'idle', t: 0, atk: null, atkId: 0, hitDone: false,
    missed: false, blockMin: 0, regenDelay: 0, flash: 0, buffer: null, wantBlock: false,
    startupT: 0, recT: 0, ko: false,
  };
}

export function reset(practice) {
  S.practice = practice;
  S.player = makeFighter(-2.5, 0, 0, true);
  S.cpu = makeFighter(2.5, 0, Math.PI, false);
  S.ai = { decide: 1.5, strafe: 1, strafeT: 0, pref: 2.0, prefT: 0, retreat: false, blockT: 0, reactedTo: -1 };
  S.hitstop = 0; S.shake = 0; S.over = false; S.overTimer = 0;
  S.lastGesture = '-';
}

// ---------------------------------------------------------------- combat
export function tryStartAttack(f, key) {
  const a = ATTACKS[key];
  if (f.state === 'block') { if (f.isPlayer) S.emit('say', { text: 'GUARD UP — CAN\'T ATTACK', color: '#aaa' }); return false; }
  if (f.state !== 'idle') { f.buffer = { key, t: S.time }; return false; }
  if (f.st < a.stam) { if (f.isPlayer) S.emit('say', { text: 'NO STAMINA', color: '#ffd23a' }); return false; }
  f.st -= a.stam;
  f.atk = a; f.atkId = ++atkCounter; f.state = 'startup'; f.t = f.startupT = a.startup + (f.isPlayer ? 0 : AI.extraStartup);
  f.hitDone = false; f.missed = false; f.regenDelay = ST_REGEN_DELAY; f.buffer = null;
  return true;
}

export function playerAttack(key) {
  if (S.over) return;
  S.lastGesture = ATTACKS[key].name;
  S.emit('say', { text: ATTACKS[key].name, color: ATTACKS[key].color });
  tryStartAttack(S.player, key);
}

function resolveHit(a, b) {
  const atk = a.atk;
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  if (d - R > atk.range) return;
  if (Math.abs(angDiff(Math.atan2(dy, dx), a.face)) > (atk.arc / 2) * DEG) return;
  a.hitDone = true;
  const nx = dx / d, ny = dy / d;
  const facingAttacker = Math.abs(angDiff(Math.atan2(-dy, -dx), b.face)) < 100 * DEG;
  const blocked = b.state === 'block' && facingAttacker;
  const hx = b.x - nx * R * 0.5, hy = b.y - ny * R * 0.5;
  if (blocked) {
    const dmg = atk.dmg * BLOCK_MULT * (a.isPlayer ? 1 : AI.damageMult);
    b.hp -= dmg; b.st = Math.max(0, b.st - atk.dmg * 0.6);
    b.kx += nx * 2.0; b.ky += ny * 2.0;
    S.emit('hit', { x: hx, y: hy, atk, dmg, blocked: true, target: b });
    S.emit('floater', { f: b, text: 'BLOCKED', color: '#9fc8ff' });
    S.hitstop = 0.03; S.shake = Math.max(S.shake, 0.05);
  } else {
    const dmg = Math.round(atk.dmg * (a.isPlayer ? 1 : AI.damageMult));
    b.hp -= dmg;
    b.state = 'hitstun'; b.t = 0.16 + dmg * 0.012; b.atk = null; b.buffer = null;
    b.kx += nx * (2.5 + dmg * 0.25); b.ky += ny * (2.5 + dmg * 0.25);
    b.flash = 0.15;
    S.emit('hit', { x: hx, y: hy, atk, dmg, blocked: false, target: b });
    S.emit('floater', { f: b, text: '-' + dmg, color: '#ffea7a' });
    S.hitstop = 0.05 + dmg * 0.003; S.shake = Math.max(S.shake, 0.08 + dmg * 0.012);
  }
  b.hp = Math.max(0, b.hp);
}

function updateFighter(f, opp, mx, my, dt) {
  f.flash = Math.max(0, f.flash - dt);
  f.regenDelay = Math.max(0, f.regenDelay - dt);
  f.blockMin = Math.max(0, f.blockMin - dt);

  switch (f.state) {
    case 'startup':
      f.t -= dt;
      if (f.t <= 0) { f.state = 'active'; f.t = f.atk.active; }
      break;
    case 'active':
      if (!f.hitDone) resolveHit(f, opp);
      f.t -= dt;
      if (f.t <= 0) {
        f.state = 'recovery';
        f.missed = !f.hitDone;
        f.t = f.recT = f.atk.recovery + (f.missed ? f.atk.missRecovery : 0);
        if (f.missed) S.emit('floater', { f, text: 'MISS', color: '#bbb' });
      }
      break;
    case 'recovery':
      f.t -= dt;
      if (f.t <= 0) { f.state = 'idle'; f.atk = null; f.missed = false; }
      break;
    case 'hitstun':
      f.t -= dt;
      if (f.t <= 0) f.state = 'idle';
      break;
    case 'block':
      if (!f.wantBlock && f.blockMin <= 0) f.state = 'idle';
      break;
  }

  if (f.state === 'idle') {
    if (f.wantBlock) {
      f.state = 'block'; f.blockMin = 0.25; f.buffer = null;
      if (f.isPlayer) S.emit('say', { text: 'BLOCK', color: '#9fc8ff' });
    } else if (f.buffer) {
      const b = f.buffer; f.buffer = null;
      if (S.time - b.t < 0.25) tryStartAttack(f, b.key);
    }
  }

  // stamina
  if (f.state === 'idle' && f.regenDelay <= 0) f.st += ST_REGEN * dt;
  else if (f.state === 'block') f.st += ST_REGEN_BLOCK * dt;
  f.st = clamp(f.st, 0, MAX_ST);

  // facing: auto-face opponent, limited turn rate (committed while attacking)
  const want = Math.atan2(opp.y - f.y, opp.x - f.x);
  const turn = STATE_TURN[f.state] * dt;
  f.face += clamp(angDiff(want, f.face), -turn, turn);

  // movement
  const sp = MOVE_SPEED * STATE_MOVE[f.state] * (f.isPlayer ? 1 : AI.speedMult);
  const k = Math.min(1, dt * 14);
  f.vx += (mx * sp - f.vx) * k;
  f.vy += (my * sp - f.vy) * k;
  f.x += (f.vx + f.kx) * dt;
  f.y += (f.vy + f.ky) * dt;
  const kd = Math.exp(-dt * 9);
  f.kx *= kd; f.ky *= kd;
}

// keep inside the octagon: flat edges at normals 0,45,...,315 deg
function confine(f) {
  const lim = ARENA - R;
  for (let i = 0; i < 8; i++) {
    const a = i * 45 * DEG, nx = Math.cos(a), ny = Math.sin(a);
    const over = f.x * nx + f.y * ny - lim;
    if (over > 0) { f.x -= nx * over; f.y -= ny * over; }
  }
}
function separate(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.001;
  const min = R * 2 + 0.05;
  if (d < min) {
    const p = (min - d) / 2, nx = dx / d, ny = dy / d;
    a.x -= nx * p; a.y -= ny * p; b.x += nx * p; b.y += ny * p;
  }
}

// ---------------------------------------------------------------- AI (intentionally dumb)
function updateAI(f, p, dt) {
  const ai = S.ai;
  const dx = p.x - f.x, dy = p.y - f.y, d = Math.hypot(dx, dy) || 0.001;
  const ux = dx / d, uy = dy / d, px = -uy, py = ux;
  const edge = d - R;

  if (f.st < 22) ai.retreat = true;
  if (f.st > 60) ai.retreat = false;

  ai.strafeT -= dt;
  if (ai.strafeT <= 0) { ai.strafe = Math.random() < 0.5 ? -1 : 1; ai.strafeT = rand(0.8, 2.2); if (Math.random() < 0.25) ai.strafe = 0; }
  ai.prefT -= dt;
  if (ai.prefT <= 0) { ai.pref = rand(1.4, 2.4); ai.prefT = rand(1.2, 3); }

  // react to player's attack wind-up with a block sometimes
  if (p.state === 'startup' && ai.reactedTo !== p.atkId) {
    ai.reactedTo = p.atkId;
    if (edge < p.atk.range + 0.4 && f.state === 'idle' && Math.random() < AI.blockChance) ai.blockT = rand(0.45, 0.8);
  }
  ai.blockT = Math.max(0, ai.blockT - dt);
  f.wantBlock = ai.blockT > 0;

  let mx = 0, my = 0;
  if (ai.retreat) {
    mx = -ux * 0.9 + px * ai.strafe * 0.6; my = -uy * 0.9 + py * ai.strafe * 0.6;
  } else {
    const err = d - ai.pref;
    const inout = Math.abs(err) > 0.15 ? clamp(err, -1, 1) : 0;
    mx = ux * inout + px * ai.strafe * 0.55; my = uy * inout + py * ai.strafe * 0.55;
  }
  // avoid getting pinned on the fence: nudge toward center
  const r = Math.hypot(f.x, f.y);
  if (r > ARENA - 1.2) { mx -= f.x / r * 0.8; my -= f.y / r * 0.8; }
  const m = Math.hypot(mx, my);
  if (m > 1) { mx /= m; my /= m; }

  ai.decide -= dt;
  if (ai.decide <= 0 && f.state === 'idle' && !f.wantBlock) {
    ai.decide = rand(AI.thinkMin, AI.thinkMax);
    const facing = Math.abs(angDiff(Math.atan2(dy, dx), f.face)) < 25 * DEG;
    if (facing) {
      if (ai.retreat) {
        if (edge <= ATTACKS.jab.range && Math.random() < 0.2 * AI.attackChance) tryStartAttack(f, 'jab');
      } else if (edge <= ATTACKS.hook.range && Math.random() < 0.4 * AI.attackChance) tryStartAttack(f, 'hook');
      else if (edge <= ATTACKS.jab.range && Math.random() < 0.45 * AI.attackChance) tryStartAttack(f, 'jab');
      else if (edge > 1.2 && edge <= ATTACKS.kick.range && Math.random() < 0.3 * AI.attackChance) tryStartAttack(f, 'kick');
    }
  }
  return [mx, my];
}

// Pick a fall direction with room on the mat and away from the winner; the body falls backwards.
function koFacing(f, w) {
  const LEN = 2.9;
  let best = f.face, bestScore = -Infinity;
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8, ex = f.x + Math.cos(a) * LEN, ey = f.y + Math.sin(a) * LEN;
    let margin = Infinity;
    for (let j = 0; j < 8; j++) {
      const b = j * 45 * DEG;
      margin = Math.min(margin, (ARENA - 0.4) - (ex * Math.cos(b) + ey * Math.sin(b)));
    }
    const mx = f.x + Math.cos(a) * LEN * 0.55, my = f.y + Math.sin(a) * LEN * 0.55;
    const dw = Math.min(Math.hypot(mx - w.x, my - w.y), Math.hypot(ex - w.x, ey - w.y));
    const natural = -Math.abs(angDiff(a, f.face + Math.PI)) * 0.4; // prefer falling straight back
    const score = Math.min(margin, 0) * 10 + Math.min(dw, 1.6) * 3 + natural;
    if (score > bestScore) { bestScore = score; best = a + Math.PI; }
  }
  return best;
}

// ---------------------------------------------------------------- step
// move: [mx, my] player movement input; wantBlock: player guard input
export function step(dt, move, wantBlock) {
  if (S.hitstop > 0) { S.hitstop -= dt; return; }
  S.time += dt;
  S.shake = Math.max(0, S.shake - dt);
  const { player, cpu } = S;

  if (!S.over) {
    player.wantBlock = wantBlock;
    // practice: the opponent is a stationary dummy that never attacks
    const [amx, amy] = S.practice ? [0, 0] : updateAI(cpu, player, dt);
    updateFighter(player, cpu, move[0], move[1], dt);
    updateFighter(cpu, player, amx, amy, dt);
    if (S.practice) {
      player.st = MAX_ST;
      if (cpu.hp < 25) { cpu.hp = MAX_HP; S.emit('floater', { f: cpu, text: 'RESET', color: '#8f8' }); }
    }
    separate(player, cpu);
    confine(player); confine(cpu);
    if (!S.practice && (player.hp <= 0 || cpu.hp <= 0)) {
      S.over = true; S.overTimer = 1.8;
      const loser = player.hp <= 0 ? player : cpu;
      loser.state = 'hitstun'; loser.t = 99; loser.ko = true; loser.atk = null;
      loser.face = koFacing(loser, loser === player ? cpu : player);
    }
  } else {
    // let knockback settle
    for (const f of [player, cpu]) {
      f.x += f.kx * dt; f.y += f.ky * dt; f.kx *= 0.9; f.ky *= 0.9;
      f.vx *= 0.8; f.vy *= 0.8; confine(f);
      if (f.ko) {
        // slide inward so the falling body (about 2.9 units long, falling backwards) lands on the mat
        const hx = f.x - Math.cos(f.face) * 2.9, hy = f.y - Math.sin(f.face) * 2.9;
        for (let i = 0; i < 8; i++) {
          const a = i * 45 * DEG, nx = Math.cos(a), ny = Math.sin(a);
          const over = hx * nx + hy * ny - (ARENA - 0.5);
          if (over > 0) { const k = Math.min(1, dt * 8); f.x -= nx * over * k; f.y -= ny * over * k; }
        }
      }
    }
    S.overTimer -= dt;
    if (S.overTimer <= 0) { S.overTimer = Infinity; S.emit('end', { win: cpu.hp <= 0 }); }
  }
}
