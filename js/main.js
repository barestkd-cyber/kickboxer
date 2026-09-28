// Glue: game loop, HUD, menu.
import { S, reset, step, playerAttack, MAX_HP, MAX_ST, R } from './sim.js';
import { input, initInput, clearInput, readMove, wantBlock, drawTrails, joyRadius, classify } from './input.js';
import { World } from './scene.js';
import { SC } from './fighter.js';

const $ = id => document.getElementById(id);
const FONT = 'Oswald, Impact, sans-serif';
try { await document.fonts.load(`700 100px Oswald`); } catch (e) {}

const world = new World($('gl'), FONT);
const fx = $('fx'), fctx = fx.getContext('2d');
let showDebug = false, running = false;

function resize() {
  world.resize();
  const d = Math.min(devicePixelRatio || 1, 2);
  fx.width = innerWidth * d; fx.height = innerHeight * d;
  fctx.setTransform(d, 0, 0, d, 0, 0);
  document.documentElement.style.setProperty('--jd', joyRadius() * 2 + 'px');
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- effects from the sim
let bannerT = 0;
const floaters = [];
S.emit = (type, d) => {
  if (type === 'say') {
    const b = $('banner'); b.textContent = d.text; b.style.color = d.color; bannerT = 0.7;
  } else if (type === 'floater') {
    const el = document.createElement('div');
    el.className = 'floater'; el.textContent = d.text; el.style.color = d.color;
    $('floaters').appendChild(el);
    floaters.push({ el, f: d.f, t: 0.8, rise: 0 });
  } else if (type === 'hit') {
    world.spawnHit(d);
  } else if (type === 'end') {
    endMatch(d.win);
  }
};

initInput($('gl'), {
  onAttack: key => playerAttack(key),
  onGuard: () => { S.lastGesture = 'BLOCK'; },
  onDebugKey: () => toggleDebug(),
});

// ---------------------------------------------------------------- HUD
const hud = {
  pHp: $('pHp'), pSt: $('pSt'), cHp: $('cHp'), cSt: $('cSt'),
  pHpN: $('pHpN'), pStN: $('pStN'), cHpN: $('cHpN'), cStN: $('cStN'),
};
const pct = (v, m) => `calc(${(Math.max(0, v) / m) * 100}% - 4px)`;
function updateHud(dt) {
  const { player: p, cpu: c } = S;
  hud.pHp.style.width = pct(p.hp, MAX_HP); hud.pSt.style.width = pct(p.st, MAX_ST);
  hud.cHp.style.width = pct(c.hp, MAX_HP); hud.cSt.style.width = pct(c.st, MAX_ST);
  hud.pHpN.textContent = Math.ceil(p.hp); hud.pStN.textContent = Math.round(p.st);
  hud.cHpN.textContent = Math.ceil(c.hp); hud.cStN.textContent = Math.round(c.st);

  bannerT -= dt;
  $('banner').style.opacity = Math.max(0, Math.min(1, bannerT / 0.3));

  for (let i = floaters.length - 1; i >= 0; i--) {
    const fl = floaters[i];
    fl.t -= dt; fl.rise += dt * 0.9;
    if (fl.t <= 0) { fl.el.remove(); floaters.splice(i, 1); continue; }
    const [x, y] = world.project(fl.f.x, 2.05 * SC + fl.rise, fl.f.y);
    fl.el.style.left = x + 'px'; fl.el.style.top = y + 'px';
    fl.el.style.opacity = Math.min(1, fl.t / 0.4);
  }

  // joystick: parked bottom-left, follows the thumb while dragging
  const joy = $('joy'), jr = joyRadius();
  if (input.joy) {
    joy.style.left = input.joy.ox + 'px'; joy.style.top = input.joy.oy + 'px';
    const dx = input.joy.x - input.joy.ox, dy = input.joy.y - input.joy.oy;
    $('knob').style.transform = `translate(${dx}px, ${dy}px)`;
    joy.style.opacity = 1;
  } else {
    joy.style.left = (jr + 26) + 'px'; joy.style.top = (innerHeight - jr - 26) + 'px';
    $('knob').style.transform = '';
    joy.style.opacity = 0.75;
  }

  if (showDebug) {
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    $('debug').textContent =
      `gesture: ${S.lastGesture}\nstate: ${p.state}${p.atk ? ' (' + p.atk.key + ')' : ''}${p.missed ? ' MISSED' : ''}\n` +
      `dist: ${d.toFixed(2)}  edge: ${(d - R).toFixed(2)}\ncpu: ${c.state}${S.ai.retreat ? ' retreat' : ''}`;
  }
}

function toggleDebug() {
  showDebug = !showDebug;
  $('debug').style.display = showDebug ? '' : 'none';
  $('dbgBtn').classList.toggle('on', showDebug);
}
$('debug').style.display = 'none';
$('dbgBtn').addEventListener('click', toggleDebug);
$('menuBtn').addEventListener('click', () => showMenu());

// ---------------------------------------------------------------- flow
const ov = $('overlay');
const menuHTML = $('ovText').innerHTML;

function startMatch(practice) {
  reset(practice);
  for (const fl of floaters) fl.el.remove();
  floaters.length = 0;
  running = true; input.enabled = true;
  ov.classList.add('hidden'); $('hud').classList.remove('hidden');
  $('mode').textContent = practice ? 'PRACTICE · unlimited stamina' : '';
  $('cpuTag').textContent = practice ? 'DUMMY' : 'CPU';
  try { if (document.documentElement.requestFullscreen && matchMedia('(pointer: coarse)').matches) document.documentElement.requestFullscreen().catch(() => {}); } catch (e) {}
}
function endMatch(win) {
  running = false; input.enabled = false; clearInput();
  $('ovTitle').textContent = win ? 'PLAYER WINS' : 'OPPONENT WINS';
  $('ovTitle').style.color = win ? '#5b9bff' : '#ff5a5a';
  $('ovText').innerHTML = '';
  $('ovBtn').textContent = 'RESTART';
  ov.classList.remove('hidden');
}
function showMenu() {
  running = false; input.enabled = false; clearInput();
  $('ovTitle').textContent = 'KICKBOXER'; $('ovTitle').style.color = '';
  $('ovText').innerHTML = menuHTML;
  $('ovBtn').textContent = 'FIGHT';
  ov.classList.remove('hidden'); $('hud').classList.add('hidden');
}
$('ovBtn').addEventListener('click', () => startMatch(false));
$('ovPractice').addEventListener('click', () => startMatch(true));

// ---------------------------------------------------------------- loop
reset(false);
let last = performance.now() / 1000, time = 0;
function frame() {
  const t = performance.now() / 1000;
  const dt = Math.min(0.05, t - last); last = t;
  if (running || S.over) step(dt, readMove(), wantBlock());
  // freeze-frame on hits: the world only advances when the sim did
  const simDt = S.hitstop > 0 ? 0 : dt;
  time += simDt;
  world.update(simDt, time, running);
  updateHud(dt);
  fctx.clearRect(0, 0, innerWidth, innerHeight);
  drawTrails(fctx, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__kb = () => ({ S, input, classify, world }); // dev inspection
