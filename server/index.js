const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const level = require(path.join(__dirname, '..', 'shared', 'level.json'));

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
app.get('/vendor/three.module.js', (_req, res) =>
  res.sendFile(path.join(__dirname, '..', 'node_modules', 'three', 'build', 'three.module.js'))
);

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
// ws re-emits http server errors (e.g. EADDRINUSE during port fallback);
// without a listener that becomes an unhandled throw
wss.on('error', (e) => { if (e.code !== 'EADDRINUSE') console.error('ws error:', e.message); });

const now = () => Date.now() / 1000;

let nextId = 1;
const players = new Map();
const mobs = [];
const bosses = [];
const bossSpawned = [false, false, false];
let events = [];

level.zones.forEach((zone, zi) => {
  const [x0, z0, x1, z1] = zone.rect;
  for (let i = 0; i < zone.count; i++) {
    const fx = x0 + ((i + 0.5) / zone.count) * (x1 - x0);
    const fz = z0 + (i % 2 ? 0.72 : 0.28) * (z1 - z0);
    mobs.push({
      id: 'm' + zi + '_' + i, zone: zi, rect: zone.rect, home: [fx, fz],
      x: fx, y: zone.y, z: fz, yaw: 0,
      hp: zone.hp, maxHp: zone.hp, speed: zone.speed, dmg: zone.dmg, aggro: zone.aggro,
      wx: fx, wz: fz, wanderT: 0, atkCd: 0, respawnT: 0,
    });
  }
});

function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(s);
}

function hurtPlayer(p, dmg, by) {
  if (p.dead || p.hp <= 0) return;
  p.hp -= dmg;
  p.lastHit = now();
  events.push({ k: 'phit', id: p.id });
  if (p.hp <= 0) {
    p.hp = 0;
    p.dead = true;
    events.push({ k: 'death', id: p.id, name: p.name, by });
  }
}

function spawnBoss(idx) {
  const cp = level.checkpoints[idx - 1];
  const st = level.bosses[idx - 1];
  bosses.push({
    id: 'boss' + idx, idx, rect: cp.bossRect,
    x: cp.boss[0], y: cp.boss[1], z: cp.boss[2], yaw: 0,
    hp: st.hp, maxHp: st.hp, dmg: st.dmg, speed: st.speed, detect: st.detect,
    target: null, lostT: 0, atkCd: 0, life: 120,
    wx: cp.boss[0], wz: cp.boss[2], wanderT: 0,
  });
  events.push({ k: 'bossSpawn', idx });
}

function step(e, tx, tz, sp, dt) {
  const dx = tx - e.x, dz = tz - e.z;
  const d = Math.hypot(dx, dz) || 1;
  e.x += (dx / d) * sp * dt;
  e.z += (dz / d) * sp * dt;
}

function clampRect(e) {
  e.x = Math.max(e.rect[0], Math.min(e.rect[2], e.x));
  e.z = Math.max(e.rect[1], Math.min(e.rect[3], e.z));
}

let last = now();
setInterval(() => {
  const t = now();
  const dt = Math.min(0.1, t - last);
  last = t;

  for (const p of players.values()) {
    if (!p.dead && p.hp > 0 && p.hp < 100 && t - p.lastHit > 6) {
      p.hp = Math.min(100, p.hp + 5 * dt);
    }
  }

  for (const m of mobs) {
    if (m.hp <= 0) {
      m.respawnT -= dt;
      if (m.respawnT <= 0) { m.hp = m.maxHp; m.x = m.home[0]; m.z = m.home[1]; }
      continue;
    }
    m.atkCd -= dt;
    let best = null, bd = m.aggro;
    for (const p of players.values()) {
      if (p.dead) continue;
      if (Math.abs(p.pos[1] - m.y) > 3) continue;
      const d = Math.hypot(p.pos[0] - m.x, p.pos[2] - m.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      if (bd > 1.3) step(m, best.pos[0], best.pos[2], m.speed, dt);
      else if (m.atkCd <= 0) { m.atkCd = 1.0; hurtPlayer(best, m.dmg, 'a jungle spider'); }
      m.yaw = Math.atan2(best.pos[0] - m.x, best.pos[2] - m.z);
    } else {
      m.wanderT -= dt;
      if (m.wanderT <= 0) {
        m.wanderT = 2 + Math.random() * 3;
        m.wx = m.rect[0] + Math.random() * (m.rect[2] - m.rect[0]);
        m.wz = m.rect[1] + Math.random() * (m.rect[3] - m.rect[1]);
      }
      if (Math.hypot(m.wx - m.x, m.wz - m.z) > 0.4) {
        step(m, m.wx, m.wz, m.speed * 0.4, dt);
        m.yaw = Math.atan2(m.wx - m.x, m.wz - m.z);
      }
      if (m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + 4 * dt);
    }
    clampRect(m);
  }

  for (let i = bosses.length - 1; i >= 0; i--) {
    const b = bosses[i];
    b.life -= dt;
    b.atkCd -= dt;
    if (b.hp <= 0) { events.push({ k: 'bossDie', idx: b.idx }); bosses.splice(i, 1); continue; }
    if (b.life <= 0) { events.push({ k: 'bossGone', idx: b.idx }); bosses.splice(i, 1); continue; }

    // The Broodmother only senses players that move or talk
    let best = null, bd = b.detect;
    for (const p of players.values()) {
      if (p.dead) continue;
      if (Math.abs(p.pos[1] - b.y) > 5) continue;
      const d = Math.hypot(p.pos[0] - b.x, p.pos[2] - b.z);
      if (d < bd && (p.speed > 0.8 || p.talking)) { bd = d; best = p; }
    }
    if (best) { b.target = best.id; b.lostT = 0; }
    else if (b.target) {
      const p = players.get(b.target);
      const gone = !p || p.dead ||
        Math.hypot(p.pos[0] - b.x, p.pos[2] - b.z) > b.detect * 1.4 ||
        (p.speed <= 0.8 && !p.talking);
      if (gone) { b.lostT += dt; if (b.lostT > 1.3) b.target = null; }
    }
    const tp = b.target ? players.get(b.target) : null;
    if (tp && !tp.dead) {
      const d = Math.hypot(tp.pos[0] - b.x, tp.pos[2] - b.z);
      if (d > 2.4) step(b, tp.pos[0], tp.pos[2], b.speed, dt);
      else if (b.atkCd <= 0) { b.atkCd = 0.9; hurtPlayer(tp, b.dmg, 'the Broodmother'); }
      b.yaw = Math.atan2(tp.pos[0] - b.x, tp.pos[2] - b.z);
    } else {
      b.wanderT -= dt;
      if (b.wanderT <= 0) {
        b.wanderT = 3 + Math.random() * 3;
        b.wx = b.rect[0] + Math.random() * (b.rect[2] - b.rect[0]);
        b.wz = b.rect[1] + Math.random() * (b.rect[3] - b.rect[1]);
      }
      if (Math.hypot(b.wx - b.x, b.wz - b.z) > 0.6) {
        step(b, b.wx, b.wz, 1.4, dt);
        b.yaw = Math.atan2(b.wx - b.x, b.wz - b.z);
      }
    }
    clampRect(b);
  }

  const ps = {};
  for (const p of players.values()) {
    ps[p.id] = {
      p: p.pos, yaw: p.yaw, name: p.name,
      hp: Math.round(p.hp), cp: p.cp,
      tk: p.talking ? 1 : 0, dead: p.dead ? 1 : 0,
    };
  }
  const ms = mobs.map(m => ({
    i: m.id, t: 's', p: [m.x, m.y, m.z], yaw: m.yaw,
    hp: Math.round(m.hp), mhp: m.maxHp, z: m.zone,
  }));
  for (const b of bosses) {
    ms.push({
      i: b.id, t: 'b', p: [b.x, b.y, b.z], yaw: b.yaw,
      hp: Math.round(b.hp), mhp: b.maxHp, tg: b.target || 0, idx: b.idx,
    });
  }
  broadcast({ type: 'state', t, players: ps, mobs: ms, ev: events });
  events = [];
}, 50);

wss.on('connection', (ws) => {
  const id = nextId++;
  const p = {
    id, ws, name: 'Player' + id, pos: [...level.spawn], yaw: 0,
    speed: 0, talking: false, hp: 100, cp: 0, dead: false, lastHit: 0, lastAtk: 0,
  };

  ws.on('message', (buf) => {
    let m;
    try { m = JSON.parse(buf); } catch { return; }
    switch (m.type) {
      case 'join': {
        p.name = String(m.name || '').slice(0, 16).trim() || 'Player' + id;
        players.set(id, p);
        ws.send(JSON.stringify({
          type: 'init', id, t: now(),
          peers: [...players.keys()].filter(k => k !== id),
        }));
        events.push({ k: 'join', id, name: p.name });
        break;
      }
      case 'state': {
        if (!players.has(id)) return;
        if (Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isFinite)) p.pos = m.p;
        p.yaw = +m.yaw || 0;
        p.speed = Math.max(0, +m.speed || 0);
        p.talking = !!m.tk;
        break;
      }
      case 'attack': {
        if (!players.has(id) || p.dead) return;
        const t2 = now();
        if (t2 - p.lastAtk < 0.35) return;
        p.lastAtk = t2;
        const dir = Array.isArray(m.dir) ? m.dir : [0, 1];
        const dl = Math.hypot(dir[0], dir[1]) || 1;
        const dx = dir[0] / dl, dz = dir[1] / dl;
        const tryHit = (e, range, isBoss) => {
          if (e.hp <= 0) return;
          const ex = e.x - p.pos[0], ez = e.z - p.pos[2];
          const d = Math.hypot(ex, ez);
          if (d > range || Math.abs(e.y - p.pos[1]) > 3) return;
          if ((ex * dx + ez * dz) / (d || 1) < 0.3) return;
          e.hp -= 30;
          events.push({ k: 'hit', by: id, id: e.id });
          if (e.hp <= 0 && !isBoss) {
            e.hp = 0;
            e.respawnT = 18;
            events.push({ k: 'mobDie', id: e.id, by: p.name });
          }
        };
        for (const mm of mobs) tryHit(mm, 3.0, false);
        for (const b of bosses) tryHit(b, 3.6, true);
        break;
      }
      case 'checkpoint': {
        if (!players.has(id) || p.dead) return;
        const idx = m.idx | 0;
        if (idx >= 1 && idx <= 3 && idx === p.cp + 1) {
          const cp = level.checkpoints[idx - 1];
          if (Math.hypot(p.pos[0] - cp.pos[0], p.pos[2] - cp.pos[2]) < 6) {
            p.cp = idx;
            events.push({ k: 'cp', id, idx, name: p.name });
            if (!bossSpawned[idx - 1]) {
              bossSpawned[idx - 1] = true;
              spawnBoss(idx);
            }
          }
        }
        break;
      }
      case 'fall': {
        if (players.has(id)) hurtPlayer(p, 10, 'the fall');
        break;
      }
      case 'respawn': {
        if (players.has(id) && p.dead) { p.dead = false; p.hp = 100; p.lastHit = 0; }
        break;
      }
      case 'vo': case 'va': case 'vi': {
        const to = players.get(m.to);
        if (to && to.ws.readyState === 1) {
          to.ws.send(JSON.stringify({ type: m.type, from: id, data: m.data }));
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (players.has(id)) {
      events.push({ k: 'leave', id, name: p.name });
      players.delete(id);
    }
  });
});

function start(port = Number(process.env.PORT) || 3000, tries = 10) {
  return new Promise((resolve, reject) => {
    const onListening = () => {
      server.removeListener('error', onError);
      console.log(`Emerald Canopy running on http://localhost:${port}`);
      resolve(port);
    };
    const onError = (err) => {
      server.removeListener('listening', onListening);
      server.removeListener('error', onError);
      if (err.code === 'EADDRINUSE' && tries > 0) resolve(start(port + 1, tries - 1));
      else reject(err);
    };
    server.once('listening', onListening);
    server.once('error', onError);
    server.listen(port);
  });
}

if (require.main === module) {
  start().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { start };
