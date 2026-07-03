import * as THREE from 'three';
import { Net } from './net.js';
import { Voice } from './voice.js';
import { buildWorld } from './world.js';
import { Spiders } from './spiders.js';
import { actx, sfx } from './audio.js';

const level = await (await fetch('/shared/level.json')).json();

const UP = new THREE.Vector3(0, 1, 0);
const RADIUS = 0.35;
const HEIGHT = 1.7;
const EYE = 1.62;
const GRAVITY = 20;
const JUMP_V = 7.8;
const WALK = 6;
const SPRINT = 9;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.1, 400);
scene.add(camera);

const world = buildWorld(scene, level);
let myId = 0;
const spiders = new Spiders(scene, () => myId);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- machete ----------
const machete = new THREE.Group();
{
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xb8c4c0, metalness: 0.7, roughness: 0.3 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.9 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.13, 0.55), bladeMat);
  blade.position.z = -0.33;
  machete.add(blade);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.06, 0.2), gripMat);
  grip.position.z = 0.05;
  machete.add(grip);
  machete.scale.setScalar(0.6);
  machete.position.set(0.34, -0.3, -0.6);
  machete.rotation.set(0.1, 0.55, -0.2);
  camera.add(machete);
}

// ---------- player state ----------
const P = {
  pos: new THREE.Vector3(...level.spawn),
  vel: new THREE.Vector3(),
  yaw: Math.PI,
  pitch: 0,
  grounded: false,
  standOn: null,
  lastOx: 0,
};
let joined = false;
let dying = false;
let myCp = 0;
let locked = false;
let swingT = 0;
let lastAtk = 0;
let lastCpSend = 0;
let emaSpeed = 0;
let talking = false;
let flash = 0;
let lastHp = 100;
let completeShown = false;
let S = null; // latest server state
let timeOff = 0;
const serverNow = () => Date.now() / 1000 + timeOff;

const keys = {};
addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  keys[e.code] = true;
  if (!joined) return;
  if (e.code === 'KeyV' && !voice.micTrack) {
    voice.enableMic().then((ok) => {
      toast(ok ? 'Voice enabled 🎙 — others hear you when close' : 'Microphone unavailable');
      updateMicState();
    });
  }
  if (e.code === 'KeyM' && voice.micTrack) {
    const muted = voice.toggleMute();
    toast(muted ? 'Muted 🔇' : 'Unmuted 🎙');
    updateMicState();
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
});
renderer.domElement.addEventListener('click', () => {
  if (joined && !locked) renderer.domElement.requestPointerLock();
});
addEventListener('mousemove', (e) => {
  if (!locked) return;
  P.yaw -= e.movementX * 0.0022;
  P.pitch = Math.max(-1.5, Math.min(1.5, P.pitch - e.movementY * 0.0022));
});
addEventListener('mousedown', (e) => {
  if (!joined || dying || e.target.closest('#start')) return;
  const t = performance.now() / 1000;
  if (t - lastAtk < 0.4) return;
  lastAtk = t;
  swingT = 1;
  sfx.swing();
  const f = new THREE.Vector3();
  camera.getWorldDirection(f);
  net.send({ type: 'attack', dir: [f.x, f.z] });
});

// ---------- network ----------
// ?server=host:port lets the desktop build load the page from localhost while
// joining a remote host; ?name= prefills the explorer name from the launcher menu.
const qs = new URLSearchParams(location.search);
const serverAddr = qs.get('server');
const net = new Net(serverAddr
  ? 'ws://' + serverAddr
  : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
const voice = new Voice(net);

net.on('init', (m) => {
  myId = m.id;
  voice.setId(m.id);
  timeOff = m.t - Date.now() / 1000;
  for (const pid of m.peers) voice.connectTo(pid);
  joined = true;
});

net.on('state', (m) => {
  S = m;
  timeOff += (m.t - Date.now() / 1000 - timeOff) * 0.1;
  for (const ev of m.ev) handleEvent(ev);
});

function handleEvent(ev) {
  switch (ev.k) {
    case 'join':
      if (ev.id !== myId) { toast(`🌿 ${ev.name} entered the jungle`); voice.connectTo(ev.id); }
      break;
    case 'leave':
      toast(`${ev.name} left`);
      voice.removePeer(ev.id);
      removeAvatar(ev.id);
      break;
    case 'cp':
      if (ev.id === myId) { sfx.cp(); banner(`CHECKPOINT ${ev.idx} / 3`, 'Progress saved — but something stirs…'); }
      else toast(`🏁 ${ev.name} reached checkpoint ${ev.idx}`);
      break;
    case 'bossSpawn':
      sfx.roar();
      banner('🕷 THE BROODMOTHER HAS AWAKENED', 'She hunts movement and sound. Freeze. Say nothing.', true);
      break;
    case 'bossDie':
      sfx.mobdie();
      banner('THE BROODMOTHER IS SLAIN 💀', 'The jungle grows quiet again.');
      break;
    case 'bossGone':
      toast('The Broodmother retreats into the canopy…');
      break;
    case 'mobDie':
      toast(`🕷 ${ev.by} squashed a spider`);
      break;
    case 'hit':
      if (ev.by === myId) { sfx.hit(); hitmark(); }
      break;
    case 'phit':
      if (ev.id === myId) { sfx.hurt(); flash = 0.6; }
      break;
    case 'death':
      if (ev.id !== myId) toast(`☠ ${ev.name} was slain by ${ev.by}`);
      break;
  }
}

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
const hud = $('hud'), startEl = $('start');
const hpFill = $('hpfill'), cpText = $('cptext'), vignette = $('vignette');
const bannerEl = $('banner'), toastsEl = $('toasts'), plistEl = $('plist');
const bossWrap = $('bosswrap'), bossFill = $('bossfill'), bossWarn = $('bosswarn'), bossName = $('bossname');
const deathEl = $('death'), micState = $('micstate'), hitEl = $('hitmark');

let bannerTimer = 0;
function banner(big, small = '', danger = false) {
  bannerEl.querySelector('.big').textContent = big;
  bannerEl.querySelector('.small').textContent = small;
  bannerEl.classList.toggle('danger', danger);
  bannerEl.style.opacity = 1;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { bannerEl.style.opacity = 0; }, 4200);
}
function toast(txt) {
  const d = document.createElement('div');
  d.className = 'toast';
  d.textContent = txt;
  toastsEl.appendChild(d);
  setTimeout(() => { d.style.opacity = 0; d.style.transition = 'opacity .5s'; }, 3400);
  setTimeout(() => d.remove(), 4000);
  while (toastsEl.children.length > 6) toastsEl.firstChild.remove();
}
let hitTimer = 0;
function hitmark() {
  hitEl.style.opacity = 1;
  clearTimeout(hitTimer);
  hitTimer = setTimeout(() => { hitEl.style.opacity = 0; }, 130);
}
function updateMicState() {
  if (!voice.micTrack) { micState.textContent = '🎙 voice off — press V'; micState.className = ''; }
  else if (voice.muted) { micState.textContent = '🔇 muted — press M'; micState.className = ''; }
  else { micState.textContent = '🎙 voice on (proximity)'; micState.className = 'on'; }
}

async function join(withVoice) {
  actx();
  try { await net.ready(); } catch { alert('Could not reach the game server.'); return; }
  if (withVoice) {
    const ok = await voice.enableMic();
    if (!ok) toast('Mic unavailable — joined muted. Press V to retry.');
  }
  const name = $('nameInput').value.trim() || 'Explorer';
  net.send({ type: 'join', name });
  startEl.style.display = 'none';
  hud.style.display = 'block';
  updateMicState();
  renderer.domElement.requestPointerLock();
}
$('joinVoice').onclick = () => join(true);
$('joinMuted').onclick = () => join(false);
if (qs.get('name')) $('nameInput').value = qs.get('name').slice(0, 16);
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(true); });

// ---------- remote avatars ----------
const avatars = new Map();
function colorFromName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.65, 0.55);
}
function makeTagTexture(name, talk) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(0,0,0,0.45)';
  c.beginPath();
  c.roundRect(8, 8, 240, 48, 10);
  c.fill();
  c.font = 'bold 26px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = talk ? '#7bff8a' : '#ffffff';
  c.fillText((talk ? '🎙 ' : '') + name, 128, 34);
  const tex = new THREE.CanvasTexture(cv);
  return tex;
}
function makeAvatar(id, name) {
  const g = new THREE.Group();
  const col = colorFromName(name);
  const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.75, 4, 10), bodyMat);
  body.position.y = 0.95;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8c8a0, roughness: 0.8 })
  );
  head.position.y = 1.72;
  g.add(head);
  const tagMat = new THREE.SpriteMaterial({ map: makeTagTexture(name, false), depthTest: false });
  const tag = new THREE.Sprite(tagMat);
  tag.scale.set(1.9, 0.48, 1);
  tag.position.y = 2.3;
  g.add(tag);
  scene.add(g);
  const a = { g, tag, tagMat, name, talk: false, tx: 0, ty: 0, tz: 0 };
  avatars.set(id, a);
  return a;
}
function removeAvatar(id) {
  const a = avatars.get(id);
  if (a) { scene.remove(a.g); avatars.delete(id); }
}

// ---------- physics ----------
function respawnPos() {
  return myCp > 0 ? level.checkpoints[myCp - 1].respawn : level.spawn;
}
function teleport(pos) {
  P.pos.set(pos[0], pos[1] + 0.1, pos[2]);
  P.vel.set(0, 0, 0);
  P.yaw = Math.PI;
  P.pitch = 0;
  P.standOn = null;
}

function resolveHoriz(axis) {
  for (const b of world.plats) {
    const cx = b.p[0] + b.ox, cy = b.p[1], cz = b.p[2];
    const hx = b.s[0] / 2 + RADIUS, hy = b.s[1] / 2, hz = b.s[2] / 2 + RADIUS;
    const top = cy + hy, bot = cy - hy;
    if (P.pos.y >= top - 0.05 || P.pos.y + HEIGHT <= bot + 0.05) continue;
    const dx = P.pos.x - cx, dz = P.pos.z - cz;
    if (Math.abs(dx) >= hx || Math.abs(dz) >= hz) continue;
    if (P.grounded && top - P.pos.y <= 0.55 && P.vel.y <= 0.01) {
      P.pos.y = top;
      continue;
    }
    if (axis === 'x') P.pos.x = cx + Math.sign(dx || 1) * hx;
    else P.pos.z = cz + Math.sign(dz || 1) * hz;
  }
}

const moveVec = new THREE.Vector3();
function physics(dt) {
  if (P.standOn && P.standOn.mv) {
    P.pos.x += P.standOn.ox - P.lastOx;
    P.lastOx = P.standOn.ox;
  }

  let mx = 0, mz = 0;
  if (!dying) {
    if (keys.KeyW) mz -= 1;
    if (keys.KeyS) mz += 1;
    if (keys.KeyA) mx -= 1;
    if (keys.KeyD) mx += 1;
  }
  const sp = keys.ShiftLeft || keys.ShiftRight ? SPRINT : WALK;
  moveVec.set(mx, 0, mz);
  if (moveVec.lengthSq() > 0) {
    moveVec.normalize().applyAxisAngle(UP, P.yaw).multiplyScalar(sp * dt);
  } else {
    moveVec.set(0, 0, 0);
  }

  const px0 = P.pos.x, py0 = P.pos.y, pz0 = P.pos.z;

  P.pos.x += moveVec.x;
  resolveHoriz('x');
  P.pos.z += moveVec.z;
  resolveHoriz('z');

  P.vel.y -= GRAVITY * dt;
  const prevY = P.pos.y;
  P.pos.y += P.vel.y * dt;
  P.grounded = false;
  P.standOn = null;
  for (const b of world.plats) {
    const cx = b.p[0] + b.ox;
    const top = b.p[1] + b.s[1] / 2, bot = b.p[1] - b.s[1] / 2;
    if (Math.abs(P.pos.x - cx) >= b.s[0] / 2 + RADIUS) continue;
    if (Math.abs(P.pos.z - b.p[2]) >= b.s[2] / 2 + RADIUS) continue;
    if (P.vel.y <= 0 && prevY >= top - 0.01 && P.pos.y <= top) {
      P.pos.y = top;
      P.vel.y = 0;
      P.grounded = true;
      P.standOn = b;
      P.lastOx = b.ox;
    } else if (P.vel.y > 0 && prevY + HEIGHT <= bot + 0.01 && P.pos.y + HEIGHT >= bot) {
      P.pos.y = bot - HEIGHT;
      P.vel.y = 0;
    }
  }

  if (keys.Space && P.grounded && !dying) {
    P.vel.y = JUMP_V;
    P.grounded = false;
    P.standOn = null;
    sfx.jump();
  }

  if (P.pos.y < level.killY) {
    sfx.hurt();
    flash = 0.5;
    net.send({ type: 'fall' });
    teleport(respawnPos());
  }

  const inst = Math.hypot(P.pos.x - px0, P.pos.y - py0, P.pos.z - pz0) / Math.max(dt, 1e-4);
  emaSpeed += (inst - emaSpeed) * 0.25;
}

// ---------- game loop ----------
const fwd = new THREE.Vector3();
const camUp = new THREE.Vector3();
let sendAcc = 0;
let lastT = performance.now() / 1000;

renderer.setAnimationLoop(() => {
  const t = performance.now() / 1000;
  const dt = Math.min(0.05, t - lastT);
  lastT = t;

  world.update(serverNow(), myCp);

  if (joined) {
    physics(dt);

    sendAcc += dt;
    if (sendAcc >= 1 / 15) {
      talking = voice.isTalking();
      net.send({
        type: 'state',
        p: [+P.pos.x.toFixed(3), +P.pos.y.toFixed(3), +P.pos.z.toFixed(3)],
        yaw: +P.yaw.toFixed(3),
        speed: +emaSpeed.toFixed(2),
        tk: talking ? 1 : 0,
      });
      sendAcc = 0;
    }

    const nxt = myCp + 1;
    if (nxt <= 3 && !dying) {
      const cp = level.checkpoints[nxt - 1];
      const d = Math.hypot(P.pos.x - cp.pos[0], P.pos.z - cp.pos[2]);
      if (d < 3.2 && Math.abs(P.pos.y - cp.pos[1]) < 2.5 && t - lastCpSend > 1) {
        lastCpSend = t;
        net.send({ type: 'checkpoint', idx: nxt });
      }
    }
  }

  camera.position.set(P.pos.x, P.pos.y + EYE, P.pos.z);
  camera.rotation.set(P.pitch, P.yaw, 0, 'YXZ');

  if (swingT > 0) {
    swingT = Math.max(0, swingT - dt / 0.35);
    machete.rotation.x = -Math.sin((1 - swingT) * Math.PI) * 1.5;
  } else {
    machete.rotation.x = 0;
  }
  machete.position.y = -0.34 + (emaSpeed > 0.5 && P.grounded ? Math.sin(t * 9) * 0.012 : 0);

  if (S) {
    for (const [idStr, sp] of Object.entries(S.players)) {
      const id = +idStr;
      if (id === myId) { syncSelf(sp, t); continue; }
      let a = avatars.get(id) || makeAvatar(id, sp.name);
      a.g.visible = !sp.dead;
      a.tx = sp.p[0]; a.ty = sp.p[1]; a.tz = sp.p[2];
      const k = 1 - Math.exp(-12 * dt);
      a.g.position.x += (a.tx - a.g.position.x) * k;
      a.g.position.y += (a.ty - a.g.position.y) * k;
      a.g.position.z += (a.tz - a.g.position.z) * k;
      if (!!sp.tk !== a.talk) {
        a.talk = !!sp.tk;
        a.tagMat.map = makeTagTexture(a.name, a.talk);
        a.tagMat.needsUpdate = true;
      }
      voice.setPeerPos(id, a.g.position.x, a.g.position.y + 1.6, a.g.position.z);
    }
    for (const id of avatars.keys()) {
      if (!S.players[id]) removeAvatar(id);
    }
    spiders.sync(S.mobs, dt);
    updateBossUI();
    updatePlayerList();
  }

  camera.getWorldDirection(fwd);
  camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  voice.updateListener(camera.position, fwd, camUp);

  flash = Math.max(0, flash - dt * 1.2);
  const hpFrac = lastHp / 100;
  vignette.style.opacity = Math.min(0.9, (1 - hpFrac) * 0.5 + flash);

  renderer.render(scene, camera);
});

function syncSelf(me, t) {
  myCp = me.cp;
  if (me.hp !== lastHp) {
    lastHp = me.hp;
    hpFill.style.width = me.hp + '%';
    hpFill.style.background = me.hp > 40
      ? 'linear-gradient(90deg,#4ecb3a,#8ae055)'
      : 'linear-gradient(90deg,#cb3a3a,#e08855)';
  }
  cpText.textContent = myCp >= 3 ? '🏆 Temple reached!' : `Checkpoint ${myCp} / 3`;
  if (me.cp === 3 && !completeShown) {
    completeShown = true;
    banner('🏆 TEMPLE REACHED — LEVEL COMPLETE!', 'The golden idol is yours. Survive the guardian…');
  }
  if (me.dead && !dying) {
    dying = true;
    sfx.die();
    deathEl.style.display = 'flex';
    setTimeout(() => {
      teleport(respawnPos());
      net.send({ type: 'respawn' });
    }, 2500);
  }
  if (!me.dead && dying) {
    dying = false;
    deathEl.style.display = 'none';
  }
}

function updateBossUI() {
  let boss = null, bd = 1e9;
  for (const m of S.mobs) {
    if (m.t !== 'b' || m.hp <= 0) continue;
    const d = Math.hypot(m.p[0] - P.pos.x, m.p[2] - P.pos.z);
    if (d < bd) { bd = d; boss = m; }
  }
  if (boss && bd < 34) {
    bossWrap.style.display = 'block';
    bossName.textContent = `THE BROODMOTHER — GUARDIAN ${boss.idx}`;
    bossFill.style.width = (100 * boss.hp / boss.mhp) + '%';
    if (boss.tg === myId) {
      bossWarn.textContent = '⚠ SHE SEES YOU — RUN!';
      bossWarn.className = 'seen';
    } else {
      bossWarn.textContent = 'She senses movement and voices — freeze and hush.';
      bossWarn.className = '';
    }
  } else {
    bossWrap.style.display = 'none';
  }
}

let plistAcc = 0;
function updatePlayerList() {
  if (performance.now() - plistAcc < 500) return;
  plistAcc = performance.now();
  let html = '';
  for (const sp of Object.values(S.players)) {
    html += `<div class="row">${sp.tk ? '<span class="mic">🎙</span> ' : ''}${escapeHtml(sp.name)} · cp ${sp.cp}/3${sp.dead ? ' ☠' : ''}</div>`;
  }
  plistEl.innerHTML = html;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.__dbg = { P, teleport, net, get state() { return S; } };
