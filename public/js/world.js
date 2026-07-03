import * as THREE from 'three';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildWorld(scene, level) {
  scene.background = new THREE.Color(0x9cba7f);
  scene.fog = new THREE.Fog(0x9cba7f, 25, 130);
  scene.add(new THREE.HemisphereLight(0xe8ffd8, 0x1e2f16, 1.0));
  const sun = new THREE.DirectionalLight(0xfff0c9, 1.6);
  sun.position.set(50, 80, 30);
  scene.add(sun);

  const swamp = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ color: 0x17240f, roughness: 1 })
  );
  swamp.rotation.x = -Math.PI / 2;
  swamp.position.set(0, -7, 100);
  scene.add(swamp);

  const mats = {
    ground: new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 0.95 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x6f8a5a, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x7a5a37, roughness: 0.9 }),
    moving: new THREE.MeshStandardMaterial({ color: 0xb8923f, roughness: 0.8 }),
    temple: new THREE.MeshStandardMaterial({ color: 0xb0a273, roughness: 0.85 }),
  };

  const plats = [];
  level.platforms.forEach((pl, i) => {
    let mat = mats.ground;
    if (pl.t === 'temple') mat = mats.temple;
    else if (pl.t === 'step') mat = pl.mv ? mats.moving : (i % 2 ? mats.stone : mats.wood);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(pl.s[0], pl.s[1], pl.s[2]), mat);
    mesh.position.set(pl.p[0], pl.p[1], pl.p[2]);
    scene.add(mesh);
    plats.push({ p: pl.p, s: pl.s, mv: pl.mv || null, ox: 0, mesh });
  });

  // jungle trees along the corridor
  const rnd = mulberry32(20260703);
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 });
  const leafMats = [0x2e6b2a, 0x3c8033, 0x27502a].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 })
  );
  for (let i = 0; i < 170; i++) {
    const x = (rnd() * 2 - 1) * 62;
    const z = -20 + rnd() * 245;
    if (Math.abs(x) < 11.5) continue;
    const h = 10 + rnd() * 17;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25 + rnd() * 0.25, 0.45 + rnd() * 0.4, h, 6),
      treeMat
    );
    trunk.position.set(x, -7 + h / 2, z);
    scene.add(trunk);
    const blobs = 2 + Math.floor(rnd() * 2);
    for (let b = 0; b < blobs; b++) {
      const r = 1.6 + rnd() * 2.2;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 6), leafMats[Math.floor(rnd() * 3)]);
      leaf.position.set(
        x + (rnd() * 2 - 1) * 1.6,
        -7 + h - rnd() * 2,
        z + (rnd() * 2 - 1) * 1.6
      );
      scene.add(leaf);
    }
  }

  // fireflies drifting through the corridor
  const fCount = 180;
  const fPos = new Float32Array(fCount * 3);
  for (let i = 0; i < fCount; i++) {
    fPos[i * 3] = (rnd() * 2 - 1) * 14;
    fPos[i * 3 + 1] = rnd() * 12;
    fPos[i * 3 + 2] = -5 + rnd() * 210;
  }
  const fGeo = new THREE.BufferGeometry();
  fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
  const fMat = new THREE.PointsMaterial({
    color: 0xd8ff9e, size: 0.16, transparent: true, opacity: 0.85, sizeAttenuation: true,
  });
  scene.add(new THREE.Points(fGeo, fMat));

  // checkpoint totems
  const checkpoints = level.checkpoints.map((cp) => {
    const g = new THREE.Group();
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.6, 2.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 0.8 })
    );
    pillar.position.y = 1.2;
    g.add(pillar);
    const orbMat = new THREE.MeshStandardMaterial({
      color: 0xff8c42, emissive: 0xff8c42, emissiveIntensity: 0.9,
    });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), orbMat);
    orb.position.y = 2.8;
    g.add(orb);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffb347, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.05, 8, 32), ringMat);
    ring.position.y = 2.8;
    g.add(ring);
    g.position.set(cp.pos[0], cp.pos[1], cp.pos[2]);
    scene.add(g);
    return { cp, orbMat, ringMat, ring };
  });

  // golden idol + pillars on the final temple
  const idol = new THREE.Group();
  const idolMat = new THREE.MeshStandardMaterial({
    color: 0xf0c040, emissive: 0x9a6a10, emissiveIntensity: 0.5,
    metalness: 0.8, roughness: 0.3,
  });
  const idolBase = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 1.6), idolMat);
  idolBase.position.y = 0.5;
  idol.add(idolBase);
  const idolHead = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10), idolMat);
  idolHead.position.y = 1.7;
  idol.add(idolHead);
  idol.position.set(0, 9, 195.5);
  scene.add(idol);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x9a8c62, roughness: 0.9 });
  for (const [px, pz] of [[-9, 182], [9, 182], [-9, 198], [9, 198]]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 7, 8), pillarMat);
    col.position.set(px, 12.5, pz);
    scene.add(col);
  }

  function update(tS, myCp) {
    for (const pl of plats) {
      if (!pl.mv) continue;
      pl.ox = Math.sin((tS / pl.mv.per) * Math.PI * 2 + pl.mv.ph) * pl.mv.a;
      pl.mesh.position.x = pl.p[0] + pl.ox;
    }
    for (const c of checkpoints) {
      c.ring.rotation.y = tS * 1.2;
      const active = c.cp.idx <= myCp;
      const col = active ? 0x54ff6a : 0xff8c42;
      c.orbMat.color.setHex(col);
      c.orbMat.emissive.setHex(col);
      c.orbMat.emissiveIntensity = 0.7 + 0.3 * Math.sin(tS * 3);
      c.ringMat.color.setHex(active ? 0x7bff8a : 0xffb347);
    }
    idol.rotation.y = tS * 0.5;
  }

  return { plats, checkpoints, update };
}
