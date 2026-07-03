import * as THREE from 'three';

function makeLeg(mat, side, i) {
  const root = new THREE.Group();
  root.position.set(side * 0.28, 0.5, 0.32 - i * 0.24);
  root.rotation.y = side * (-0.55 + i * 0.38);

  const upper = new THREE.Group();
  const uMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.6, 5), mat);
  uMesh.position.y = 0.3;
  upper.add(uMesh);
  upper.rotation.z = -side * 2.0;

  const lower = new THREE.Group();
  lower.position.y = 0.6;
  const lMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.015, 0.8, 5), mat);
  lMesh.position.y = 0.4;
  lower.add(lMesh);
  lower.rotation.z = side * 2.5;

  upper.add(lower);
  root.add(upper);
  return root;
}

function makeSpiderMesh(isBoss) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: isBoss ? 0x35100c : 0x241a10, roughness: 0.85,
  });
  const abd = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), mat);
  abd.scale.set(1, 0.82, 1.3);
  abd.position.set(0, 0.55, -0.5);
  g.add(abd);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 10, 8), mat);
  head.position.set(0, 0.5, 0.32);
  g.add(head);

  const eyeMat = new THREE.MeshBasicMaterial({ color: isBoss ? 0xff2010 : 0xffa030 });
  for (const ex of [-0.12, 0.12]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(isBoss ? 0.09 : 0.06, 6, 5), eyeMat);
    eye.position.set(ex, 0.58, 0.6);
    g.add(eye);
  }
  if (isBoss) {
    const fangMat = new THREE.MeshStandardMaterial({ color: 0xd8d0b8, roughness: 0.5 });
    for (const fx of [-0.14, 0.14]) {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 5), fangMat);
      fang.position.set(fx, 0.3, 0.58);
      fang.rotation.x = Math.PI;
      g.add(fang);
    }
  }

  const legs = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const leg = makeLeg(mat, side, i);
      legs.push({ root: leg, side, i, base: leg.rotation.y });
      g.add(leg);
    }
  }

  // hp bar
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x330a0a, depthTest: false }));
  bg.scale.set(1.2, 0.13, 1);
  bg.position.y = 1.5;
  g.add(bg);
  const fg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x55ee44, depthTest: false }));
  fg.center.set(0, 0.5);
  fg.scale.set(1.14, 0.09, 1);
  fg.position.set(-0.57, 1.5, 0.001);
  g.add(fg);

  return { g, legs, eyeMat, hpFg: fg, hpBg: bg };
}

export class Spiders {
  constructor(scene, myIdGetter) {
    this.scene = scene;
    this.map = new Map();
    this.myIdGetter = myIdGetter;
  }

  sync(mobList, dt) {
    const seen = new Set();
    for (const m of mobList) {
      seen.add(m.i);
      let e = this.map.get(m.i);
      if (!e) {
        const isBoss = m.t === 'b';
        const built = makeSpiderMesh(isBoss);
        const scale = isBoss ? 3.3 : 0.85 + (m.z || 0) * 0.18;
        built.g.scale.setScalar(scale);
        built.g.position.set(m.p[0], m.p[1], m.p[2]);
        this.scene.add(built.g);
        e = { ...built, isBoss, phase: Math.random() * 6, tx: m.p[0], ty: m.p[1], tz: m.p[2], tyaw: m.yaw, lastX: m.p[0], lastZ: m.p[2] };
        this.map.set(m.i, e);
      }
      if (m.hp <= 0) { e.g.visible = false; continue; }
      e.g.visible = true;
      e.tx = m.p[0]; e.ty = m.p[1]; e.tz = m.p[2]; e.tyaw = m.yaw;

      const k = 1 - Math.exp(-12 * dt);
      e.g.position.x += (e.tx - e.g.position.x) * k;
      e.g.position.y += (e.ty - e.g.position.y) * k;
      e.g.position.z += (e.tz - e.g.position.z) * k;
      let dy = e.tyaw - e.g.rotation.y;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      e.g.rotation.y += dy * k;

      const moved = Math.hypot(e.g.position.x - e.lastX, e.g.position.z - e.lastZ);
      e.lastX = e.g.position.x; e.lastZ = e.g.position.z;
      e.phase += moved * (e.isBoss ? 2.2 : 7) + dt * 0.6;
      for (const leg of e.legs) {
        leg.root.rotation.y =
          leg.base + Math.sin(e.phase + leg.i * 1.7 + (leg.side > 0 ? 0 : Math.PI)) * 0.28;
      }

      e.hpFg.scale.x = Math.max(0.001, 1.14 * (m.hp / m.mhp));
      const full = m.hp >= m.mhp;
      e.hpFg.visible = e.hpBg.visible = !full || e.isBoss;

      if (e.isBoss) {
        const me = this.myIdGetter();
        const chasing = !!m.tg;
        const pulse = chasing ? 0.5 + 0.5 * Math.sin(performance.now() / 60) : 0;
        e.eyeMat.color.setHex(chasing ? (m.tg === me ? 0xff0000 : 0xff4020) : 0xaa2018);
        e.g.position.y = e.ty + (chasing ? Math.abs(Math.sin(e.phase * 2)) * 0.15 : 0) + pulse * 0.05;
      }
    }
    for (const [id, e] of this.map) {
      if (!seen.has(id)) {
        this.scene.remove(e.g);
        this.map.delete(id);
      }
    }
  }
}
