// Touch/mouse/keyboard input: floating joystick on the left half, gesture strikes on the right half.
import { DEG, angDiff, ATTACKS } from './sim.js';

const now = () => performance.now() / 1000;

export const input = {
  joy: null, gest: null, guardPtr: null, lastTapT: -1, lastTapX: 0, lastTapY: 0, keys: {},
  trails: [],       // fading gesture trails {pts, t, kind}
  enabled: false,
};

export const joyRadius = () => Math.max(44, Math.min(innerWidth, innerHeight) * 0.12);

// handlers: { onAttack(key), onGuard(), onDebugKey() }
export function initInput(el, handlers) {
  el.addEventListener('pointerdown', e => {
    if (!input.enabled) return;
    e.preventDefault();
    const x = e.clientX, y = e.clientY;
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    if (x < innerWidth / 2) {
      if (!input.joy) input.joy = { id: e.pointerId, ox: x, oy: y, x, y };
    } else {
      const t = now();
      if (t - input.lastTapT < 0.32 && Math.hypot(x - input.lastTapX, y - input.lastTapY) < 60) {
        input.guardPtr = e.pointerId; input.lastTapT = -1;
        handlers.onGuard();
      } else if (!input.gest) {
        input.gest = { id: e.pointerId, pts: [{ x, y, t }] };
      }
    }
  });
  el.addEventListener('pointermove', e => {
    if (input.joy && e.pointerId === input.joy.id) { input.joy.x = e.clientX; input.joy.y = e.clientY; }
    if (input.gest && e.pointerId === input.gest.id) input.gest.pts.push({ x: e.clientX, y: e.clientY, t: now() });
  });
  const end = e => {
    if (input.joy && e.pointerId === input.joy.id) input.joy = null;
    if (input.guardPtr === e.pointerId) input.guardPtr = null;
    if (input.gest && e.pointerId === input.gest.id) {
      const g = input.gest; input.gest = null;
      g.pts.push({ x: e.clientX, y: e.clientY, t: now() });
      const res = classify(g.pts);
      input.trails.push({ pts: g.pts, t: 0.35, kind: res });
      if (res === 'tap') {
        const p = g.pts[g.pts.length - 1];
        input.lastTapT = now(); input.lastTapX = p.x; input.lastTapY = p.y;
      } else if (res && input.enabled) {
        handlers.onAttack(res);
      }
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    input.keys[e.code] = true;
    if (e.code === 'Backquote') handlers.onDebugKey();
    if (!input.enabled) return;
    if (e.code === 'KeyJ') handlers.onAttack('jab');
    if (e.code === 'KeyK') handlers.onAttack('hook');
    if (e.code === 'KeyL') handlers.onAttack('kick');
    if (e.code === 'Space') handlers.onGuard();
  });
  window.addEventListener('keyup', e => { input.keys[e.code] = false; });
}

export function clearInput() {
  input.joy = null; input.gest = null; input.guardPtr = null;
}

export const wantBlock = () => input.guardPtr !== null || !!input.keys.Space;

// Camera looks from the south without rotating, so screen directions map straight to world x/z.
export function readMove() {
  let mx = 0, my = 0;
  const k = input.keys;
  if (k.KeyA || k.ArrowLeft) mx -= 1;
  if (k.KeyD || k.ArrowRight) mx += 1;
  if (k.KeyW || k.ArrowUp) my -= 1;
  if (k.KeyS || k.ArrowDown) my += 1;
  if (input.joy) {
    const j = input.joy, max = joyRadius();
    let dx = j.x - j.ox, dy = j.y - j.oy;
    const d = Math.hypot(dx, dy);
    if (d > max) { j.ox = j.x - dx / d * max; j.oy = j.y - dy / d * max; dx = j.x - j.ox; dy = j.y - j.oy; } // drag the base along
    const m = Math.min(1, Math.hypot(dx, dy) / max);
    if (m > 0.12) { mx = dx / Math.hypot(dx, dy) * m; my = dy / Math.hypot(dx, dy) * m; }
  }
  const m = Math.hypot(mx, my);
  if (m > 1) { mx /= m; my /= m; }
  return [mx, my];
}

// Forgiving gesture classifier: straight vs curved, then upper/lower half for curved.
export function classify(pts) {
  const p0 = pts[0], pn = pts[pts.length - 1];
  let path = 0;
  for (let i = 1; i < pts.length; i++) path += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const dur = pn.t - p0.t;
  if (path < 18 && dur < 0.3) return 'tap';
  if (path < 30) return null;

  // resample to cut jitter
  const rs = [p0];
  for (const p of pts) { const l = rs[rs.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) >= 10) rs.push(p); }
  let turn = 0;
  for (let i = 2; i < rs.length; i++) {
    const a1 = Math.atan2(rs[i - 1].y - rs[i - 2].y, rs[i - 1].x - rs[i - 2].x);
    const a2 = Math.atan2(rs[i].y - rs[i - 1].y, rs[i].x - rs[i - 1].x);
    turn += angDiff(a2, a1);
  }
  const chord = Math.hypot(pn.x - p0.x, pn.y - p0.y);
  let maxDev = 0;
  if (chord > 1) {
    const cx = (pn.x - p0.x) / chord, cy = (pn.y - p0.y) / chord;
    for (const p of pts) maxDev = Math.max(maxDev, Math.abs((p.x - p0.x) * cy - (p.y - p0.y) * cx));
  }
  const curved = Math.abs(turn) > 55 * DEG || chord / path < 0.8 || maxDev / Math.max(chord, 1) > 0.22;
  if (!curved) return 'jab';
  let my = 0; for (const p of pts) my += p.y; my /= pts.length;
  return my < innerHeight / 2 ? 'hook' : 'kick';
}

// Draw live + fading swipe trails on the 2D overlay canvas.
export function drawTrails(ctx, dt) {
  for (const tr of input.trails) tr.t -= dt;
  while (input.trails.length && input.trails[0].t <= 0) input.trails.shift();
  const line = (pts, alpha, color) => {
    if (pts.length < 2) return;
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = color; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  };
  if (input.gest) line(input.gest.pts, 0.7, '#ffffff');
  for (const tr of input.trails) {
    const c = tr.kind && ATTACKS[tr.kind] ? ATTACKS[tr.kind].color : '#888';
    line(tr.pts, Math.max(0, tr.t / 0.35) * 0.7, c);
  }
}
