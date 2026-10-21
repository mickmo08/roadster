// The Proving Ground: a test site modelled on the October 2026 reveal. It has the
// inverted "reveal ramp", a suction-fan loop, a kicker over a lineup of vehicles,
// an elevated landing tower, sky rings, a gas recharge pad, and a rocket on its
// launch mount in the distance.
import * as THREE from 'three';

export const ARENA_CENTER = [0, -150];
export const ARENA_RADIUS = 650;
export const PAD_HALF = 330;
export const START = { x: 0, z: 12, heading: 0 };
export const TURNTABLE = { x: 0, z: 40 };

// Footprints the physics can stand on. kind: up (rises along +a), down (falls), flat.
function rect(cx, cz, yaw, len, wid, h, kind = 'flat', extra = {}) {
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  return { cx, cz, yaw, len, wid, h, kind, dx, dz, rx: Math.cos(yaw), rz: -Math.sin(yaw), ...extra };
}

function rail(id, x, z, yaw, radius, sweep, width, helix = 0) {
  return { id, x, z, y0: 0, yaw, dx: -Math.sin(yaw), dz: -Math.cos(yaw), rx: Math.cos(yaw), rz: -Math.sin(yaw), radius, sweep, width, helix };
}

export const RAILS = [rail('reveal', 120, -80, 0, 11, (170 * Math.PI) / 180, 10), rail('loop', -120, -80, 0, 9, Math.PI * 2, 9, 10)];

const KICK = { z0: -120, len: 30, h: 6, w: 10 };
const LAND = { z0: -200, len: 150, w: 16 };
export const LINEUP_Z = [-163, -168.5, -174, -179.5, -185];

const BLOCKS = [
  rect(0, -120, 0, KICK.len, KICK.w, KICK.h, 'up', { id: 'kicker' }),
  rect(0, -200, 0, LAND.len, LAND.w, KICK.h, 'down', { id: 'landing' }),
  // Vehicle lineup (broadside across the jump path)
  rect(4.9 / 2, LINEUP_Z[0] + 1.0, Math.PI / 2, 4.9, 2.0, 1.4, 'flat', { id: 'veh' }),
  rect(5.8 / 2, LINEUP_Z[1] + 1.1, Math.PI / 2, 5.8, 2.2, 1.9, 'flat', { id: 'veh' }),
  rect(6.8 / 2, LINEUP_Z[2] + 1.3, Math.PI / 2, 6.8, 2.6, 3.6, 'flat', { id: 'veh' }),
  rect(4.8 / 2, LINEUP_Z[3] + 1.0, Math.PI / 2, 4.8, 2.0, 1.7, 'flat', { id: 'veh' }),
  rect(4.7 / 2, LINEUP_Z[4] + 1.0, Math.PI / 2, 4.7, 1.9, 1.45, 'flat', { id: 'veh' }),
  // Landing tower top (18 m square, 30 m up)
  rect(230, -300 + 9, 0, 18, 18, 30, 'flat', { id: 'tower' }),
  // Low skirts round the curved ramps so you can't drive into them sideways.
  rect(120 - 6.5, -80 - 1.5, 0, 12, 3, 0.9, 'flat', { id: 'skirt' }),
  rect(120 + 6.5, -80 - 1.5, 0, 12, 3, 0.9, 'flat', { id: 'skirt' }),
  rect(-120 - 6, -80 - 1.5, 0, 10, 3, 0.9, 'flat', { id: 'skirt' }),
  // Small fun kickers
  rect(60, -40, 0, 14, 7, 2.2, 'up', { id: 'small' }),
  rect(-60, -260, Math.PI, 14, 7, 2.2, 'up', { id: 'small' }),
  // Menu turntable
  rect(TURNTABLE.x, TURNTABLE.z + 4.5, 0, 9, 9, 0.18, 'flat', { id: 'turntable' }),
];

export const PADS = [
  { id: 'padA', x: -200, z: -330, r: 7 },
  { id: 'padB', x: 260, z: -60, r: 7 },
  { id: 'tower', x: 230, z: -300, r: 6, y: 30 },
];
export const RECHARGE = { x: 45, z: 20, half: 5 };

export const RINGS = [
  [-40, 14, -40],
  [-80, 20, -120],
  [-150, 26, -180],
  [-230, 30, -215],
  [-300, 26, -205],
  [-350, 18, -150],
].map(([x, y, z], i, arr) => {
  const n = arr[Math.min(i + 1, arr.length - 1)];
  const p = arr[Math.max(i - 1, 0)];
  return { x, y, z, r: 6, yaw: Math.atan2(-(n[0] - p[0]), -(n[2] - p[2])), passed: false };
});

/** Height of the drivable surface at (x, z). */
export function heightAt(x, z) {
  let h = 0;
  for (const b of BLOCKS) {
    const lx = x - b.cx;
    const lz = z - b.cz;
    const a = lx * b.dx + lz * b.dz;
    if (a < 0 || a > b.len) continue;
    const s = lx * b.rx + lz * b.rz;
    if (Math.abs(s) > b.wid / 2) continue;
    const v = b.kind === 'up' ? (b.h * a) / b.len : b.kind === 'down' ? b.h * (1 - a / b.len) : b.h;
    if (v > h) h = v;
  }
  return h;
}

/** Which block (if any) the point is on: used to name jumps. */
export function blockAt(x, z) {
  for (const b of BLOCKS) {
    const lx = x - b.cx;
    const lz = z - b.cz;
    const a = lx * b.dx + lz * b.dz;
    const s = lx * b.rx + lz * b.rz;
    if (a >= -1 && a <= b.len + 1 && Math.abs(s) <= b.wid / 2) return b.id;
  }
  return null;
}

export function onPad(x, z) {
  const dx = x - ARENA_CENTER[0];
  const dz = z - ARENA_CENTER[1];
  return Math.max(Math.abs(dx), Math.abs(dz)) < PAD_HALF;
}

// ------------------------------------------------------------------ visuals

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function chevronTex() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#9b9ea3';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(0, 0, 18, h);
    ctx.fillRect(w - 18, 0, 18, h);
    ctx.fillStyle = '#111';
    for (let y = -20; y < h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(18, y + 20);
      ctx.lineTo(18, y + 34);
      ctx.lineTo(0, y + 14);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(w, y);
      ctx.lineTo(w - 18, y + 20);
      ctx.lineTo(w - 18, y + 34);
      ctx.lineTo(w, y + 14);
      ctx.fill();
    }
  });
}

function padTex(label, ring = '#f2f2f2') {
  return canvasTex(512, 512, (ctx, w) => {
    ctx.fillStyle = '#2b2d31';
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ring;
    ctx.lineWidth = 18;
    for (const r of [0.46, 0.3, 0.14]) {
      ctx.beginPath();
      ctx.arc(w / 2, w / 2, w * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = ring;
    ctx.font = '700 120px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, w / 2, w / 2 + 6);
  });
}

function concreteTex() {
  const t = canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#a7a8a6';
    ctx.fillRect(0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 18;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(40,40,40,0.35)';
    ctx.lineWidth = 3;
    for (let k = 0; k <= 4; k++) {
      ctx.beginPath();
      ctx.moveTo((k * w) / 4, 0);
      ctx.lineTo((k * w) / 4, h);
      ctx.moveTo(0, (k * h) / 4);
      ctx.lineTo(w, (k * h) / 4);
      ctx.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Sloped wedge for kickers and landing ramps. */
function wedge(b, mat, sideMat) {
  const L = b.len;
  const W = b.wid / 2;
  const up = b.kind === 'up';
  const h0 = up ? 0 : b.h;
  const h1 = up ? b.h : 0;
  // Local frame: a along -Z (forward), s along +X.
  const v = [
    [-W, 0, 0], [W, 0, 0], [-W, h0, 0], [W, h0, 0],
    [-W, 0, -L], [W, 0, -L], [-W, h1, -L], [W, h1, -L],
  ];
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute([...v[2], ...v[3], ...v[6], ...v[7]], 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, L / 8, 1, L / 8], 2));
  top.setIndex([0, 1, 2, 1, 3, 2]);
  top.computeVertexNormals();
  const sides = new THREE.BufferGeometry();
  const quads = [
    [0, 2, 4, 6], // left
    [5, 7, 1, 3], // right
    [1, 3, 0, 2], // front face
    [4, 6, 5, 7], // back face
  ];
  const pos = [];
  for (const [a, b2, c, d] of quads) pos.push(...v[a], ...v[c], ...v[b2], ...v[c], ...v[d], ...v[b2]);
  sides.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sides.computeVertexNormals();
  const g = new THREE.Group();
  const t = new THREE.Mesh(top, mat);
  const s = new THREE.Mesh(sides, sideMat);
  t.receiveShadow = s.receiveShadow = true;
  t.castShadow = s.castShadow = true;
  g.add(t, s);
  g.position.set(b.cx, 0, b.cz);
  g.rotation.y = b.yaw;
  return g;
}

/** Curved ramp surface along a rail, with steel trusses behind it. */
function railMesh(def, mats) {
  const g = new THREE.Group();
  const N = Math.ceil((def.sweep * def.radius) / 0.6);
  const pos = [];
  const uv = [];
  const idx = [];
  const W = def.width / 2;
  const P = (phi, lat) => {
    const shift = def.helix ? (def.helix * phi) / def.sweep : 0;
    const f = def.radius * Math.sin(phi);
    const u = def.radius * (1 - Math.cos(phi));
    return [def.x + def.dx * f + def.rx * (lat + shift), u + 0.02, def.z + def.dz * f + def.rz * (lat + shift)];
  };
  for (let i = 0; i <= N; i++) {
    const phi = (i / N) * def.sweep;
    pos.push(...P(phi, -W), ...P(phi, W));
    uv.push(0, (phi * def.radius) / 8, 1, (phi * def.radius) / 8);
    if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const surf = new THREE.Mesh(geo, mats.surface);
  surf.castShadow = surf.receiveShadow = true;
  g.add(surf);
  // Trusses: columns from the ground up to the outside of the surface.
  const colGeo = new THREE.BoxGeometry(0.35, 1, 0.35);
  const steps = Math.max(4, Math.round(def.sweep / 0.35));
  for (let i = 1; i < steps; i++) {
    const phi = (i / steps) * def.sweep;
    for (const lat of [-W - 0.3, W + 0.3]) {
      const p = P(phi, lat);
      // Offset outward from the curve centre.
      const out = 0.5;
      const cx = p[0] + def.dx * Math.sin(phi) * out;
      const cy = p[1] - Math.cos(phi) * out;
      const cz = p[2] + def.dz * Math.sin(phi) * out;
      if (cy < 0.6) continue;
      const col = new THREE.Mesh(colGeo, mats.steel);
      col.scale.y = cy;
      col.position.set(cx, cy / 2, cz);
      col.castShadow = true;
      g.add(col);
    }
  }
  // Edge rails
  for (const lat of [-W - 0.15, W + 0.15]) {
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push(new THREE.Vector3(...P((i / 40) * def.sweep, lat)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.12, 6), mats.edge));
  }
  return g;
}

function vehicle(kind, mats) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const wheel = (x, z, r = 0.38) => {
    const w = add(new THREE.CylinderGeometry(r, r, 0.3, 18), mats.tire, x, r, z);
    w.rotation.z = Math.PI / 2;
  };
  if (kind === 'truck') {
    // Angular stainless pickup
    const shape = new THREE.Shape([new THREE.Vector2(-2.9, 0.5), new THREE.Vector2(2.9, 0.5), new THREE.Vector2(2.9, 1.25), new THREE.Vector2(0.2, 1.9), new THREE.Vector2(-2.9, 1.15)]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 2.1, bevelEnabled: false });
    geo.translate(0, 0, -1.05);
    geo.rotateY(Math.PI / 2);
    add(geo, mats.steelBody, 0, 0, 0);
    for (const z of [-1.9, 1.9]) for (const x of [-0.95, 0.95]) wheel(x, z, 0.45);
  } else if (kind === 'semi') {
    add(new THREE.BoxGeometry(2.5, 2.8, 2.6), mats.white, 0, 2.2, -1.6);
    add(new THREE.BoxGeometry(2.5, 1.1, 1.4), mats.white, 0, 1.2, -3.1);
    add(new THREE.BoxGeometry(2.3, 1.2, 0.05), mats.glass, 0, 2.9, -2.92, -0.25);
    add(new THREE.BoxGeometry(2.4, 0.4, 4), mats.dark, 0, 0.8, 1.2);
    for (const z of [-2.6, 0.6, 1.9]) for (const x of [-1.05, 1.05]) wheel(x, z, 0.52);
  } else if (kind === 'pod') {
    add(new THREE.SphereGeometry(1, 20, 14), mats.champagne, 0, 0.75, 0).scale.set(0.95, 0.62, 1.8);
    add(new THREE.SphereGeometry(1, 20, 14), mats.glass, 0, 1.0, -0.1).scale.set(0.8, 0.4, 1.0);
    for (const z of [-1.2, 1.2]) for (const x of [-0.85, 0.85]) wheel(x, z, 0.36);
  } else {
    // Generic SUV / sedan two-box
    const tall = kind === 'suv';
    const c = kind === 'suv' ? mats.white : mats.red;
    add(new THREE.BoxGeometry(1.9, 0.75, 4.6), c, 0, 0.75, 0);
    add(new THREE.BoxGeometry(1.6, tall ? 0.6 : 0.5, tall ? 2.7 : 2.2), mats.glass, 0, tall ? 1.42 : 1.36, tall ? 0.2 : 0.15);
    for (const z of [-1.45, 1.45]) for (const x of [-0.9, 0.9]) wheel(x, z, 0.36);
  }
  return g;
}

function lattice(height, size, mat) {
  const g = new THREE.Group();
  const leg = new THREE.BoxGeometry(0.5, height, 0.5);
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const m = new THREE.Mesh(leg, mat);
      m.position.set((x * size) / 2, height / 2, (z * size) / 2);
      m.castShadow = true;
      g.add(m);
    }
  }
  const brace = new THREE.BoxGeometry(size, 0.25, 0.25);
  for (let y = 4; y < height; y += 4) {
    for (const [rx, z] of [
      [0, size / 2],
      [0, -size / 2],
      [Math.PI / 2, 0],
    ]) {
      const b = new THREE.Mesh(brace, mat);
      if (rx) {
        b.rotation.y = Math.PI / 2;
        for (const x of [-size / 2, size / 2]) {
          const c = b.clone();
          c.position.set(x, y, 0);
          g.add(c);
        }
      } else {
        b.position.set(0, y, z);
        g.add(b);
      }
    }
  }
  return g;
}

function label(text, w, h, bg = '#0e0f12', fg = '#ffffff') {
  const tex = canvasTex(512, Math.round((512 * h) / w), (ctx, cw, ch) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = fg;
    let size = ch * 0.6;
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    const tw = ctx.measureText(text).width;
    if (tw > cw * 0.9) size *= (cw * 0.9) / tw;
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cw / 2, ch / 2);
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15, side: THREE.DoubleSide }));
}

export function buildArena(world) {
  const scene = world.scene;
  const night = world.timeKey === 'night';
  const mats = {
    steel: new THREE.MeshStandardMaterial({ color: 0x6d7278, metalness: 0.8, roughness: 0.4, side: THREE.DoubleSide }),
    edge: new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5 }),
    surface: new THREE.MeshStandardMaterial({ map: chevronTex(), roughness: 0.7, side: THREE.DoubleSide }),
    tire: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }),
    steelBody: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.9, roughness: 0.35 }),
    white: new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4, metalness: 0.2 }),
    red: new THREE.MeshStandardMaterial({ color: 0x9a1018, roughness: 0.35, metalness: 0.4 }),
    champagne: new THREE.MeshStandardMaterial({ color: 0xc8b48a, roughness: 0.3, metalness: 0.7 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.1, metalness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.6 }),
  };
  mats.surface.map.wrapS = mats.surface.map.wrapT = THREE.RepeatWrapping;

  // Concrete test pad
  const ct = concreteTex();
  ct.repeat.set(PAD_HALF / 10, PAD_HALF / 10);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(PAD_HALF * 2, PAD_HALF * 2, 40, 40), new THREE.MeshStandardMaterial({ map: ct, roughness: 0.85 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(ARENA_CENTER[0], 0.004, ARENA_CENTER[1]);
  pad.receiveShadow = true;
  scene.add(pad);

  // Kicker, landing ramp, small kickers
  for (const b of BLOCKS) {
    if (b.kind === 'up' || b.kind === 'down') scene.add(wedge(b, mats.surface, mats.steel));
    if (b.id === 'skirt') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.wid, b.h, b.len), mats.steel);
      m.position.set(b.cx + (b.dx * b.len) / 2, b.h / 2, b.cz + (b.dz * b.len) / 2);
      m.rotation.y = b.yaw;
      scene.add(m);
    }
  }
  // Painted run-up lanes
  const laneMat = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const [x, z0, z1] of [
    [0, 5, -120],
    [120, 20, -80],
    [-120, 20, -80],
  ]) {
    for (const s of [-5.2, 5.2]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.3, z0 - z1), laneMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x + s, 0.01, (z0 + z1) / 2);
      scene.add(line);
    }
  }

  // Curved ramps
  for (const r of RAILS) scene.add(railMesh(r, mats));

  // Vehicle lineup
  const kinds = ['pod', 'truck', 'semi', 'suv', 'sedan'];
  LINEUP_Z.forEach((z, i) => {
    const v = vehicle(kinds[i], mats);
    v.position.set(0, 0, z + 1.0);
    v.rotation.y = Math.PI / 2 + (i % 2 ? Math.PI : 0);
    scene.add(v);
  });

  // Landing tower
  const tower = lattice(30, 12, mats.steel);
  tower.position.set(230, 0, -300);
  scene.add(tower);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 18), mats.dark);
  deck.position.set(230, 29.75, -300);
  deck.castShadow = deck.receiveShadow = true;
  scene.add(deck);

  // Landing pads
  const padMeshes = [];
  for (const p of PADS) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(p.r, 48), new THREE.MeshStandardMaterial({ map: padTex(p.id === 'tower' ? 'H' : 'X', p.id === 'tower' ? '#ffd23f' : '#f2f2f2'), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, (p.y ?? 0) + 0.02, p.z);
    m.receiveShadow = true;
    scene.add(m);
    padMeshes.push(m);
  }

  // Gas (COPV) recharge pad
  const rc = new THREE.Mesh(new THREE.PlaneGeometry(RECHARGE.half * 2, RECHARGE.half * 2), new THREE.MeshStandardMaterial({ color: 0x0d2a4a, emissive: 0x2a8cff, emissiveIntensity: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
  rc.rotation.x = -Math.PI / 2;
  rc.position.set(RECHARGE.x, 0.015, RECHARGE.z);
  scene.add(rc);
  for (let k = 0; k < 3; k++) {
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 3, 6, 16), mats.steelBody);
    tank.position.set(RECHARGE.x + RECHARGE.half + 2, 2.2, RECHARGE.z - 2 + k * 2);
    tank.castShadow = true;
    scene.add(tank);
  }

  // Turntable for the menu reveal
  const tt = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.6, 0.18, 64), new THREE.MeshStandardMaterial({ color: 0x1a1b1e, metalness: 0.6, roughness: 0.25 }));
  tt.position.set(TURNTABLE.x, 0.09, TURNTABLE.z);
  tt.receiveShadow = true;
  scene.add(tt);
  const ttRing = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.06, 8, 96), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2 }));
  ttRing.rotation.x = Math.PI / 2;
  ttRing.position.set(TURNTABLE.x, 0.19, TURNTABLE.z);
  scene.add(ttRing);

  // Sky rings
  const ringMeshes = RINGS.map((r) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r.r, 0.35, 12, 48), new THREE.MeshStandardMaterial({ color: 0x103040, emissive: 0x29d3ff, emissiveIntensity: 1.6 }));
    m.position.set(r.x, r.y, r.z);
    m.rotation.y = r.yaw;
    scene.add(m);
    return m;
  });

  // Signs
  for (const [text, x, z, w, rot] of [
    ['REVEAL RAMP', 120, -60, 14, 0],
    ['FAN LOOP', -120, -60, 12, 0],
    ['JUMP THE LINEUP', 0, -100, 16, 0],
    ['TOWER PAD', 230, -280, 12, 0],
    ['RECHARGE', RECHARGE.x, RECHARGE.z - 8, 9, 0],
  ]) {
    const s = label(text, w, w / 6);
    s.position.set(x, 6 + w / 12, z);
    s.rotation.y = rot;
    scene.add(s);
    for (const dx of [-w / 2 + 0.3, w / 2 - 0.3]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 6, 0.25), mats.steel);
      post.position.set(x + dx, 3, z);
      scene.add(post);
    }
  }

  // Floodlight masts
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d0, emissiveIntensity: night ? 4 : 0.3 });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.3;
    const x = ARENA_CENTER[0] + Math.cos(a) * (PAD_HALF + 15);
    const z = ARENA_CENTER[1] + Math.sin(a) * (PAD_HALF + 15);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 28, 8), mats.steel);
    mast.position.set(x, 14, z);
    scene.add(mast);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(5, 2, 1), lampMat);
    lamp.position.set(x, 28, z);
    lamp.lookAt(ARENA_CENTER[0], 0, ARENA_CENTER[1]);
    scene.add(lamp);
  }
  if (night) {
    const flood = new THREE.HemisphereLight(0xfff1d0, 0x222222, 0.6);
    scene.add(flood);
  }

  // Rocket on its launch mount, in the distance
  const rocket = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.95, roughness: 0.22 });
  const booster = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 70, 32), steel);
  booster.position.y = 35;
  const ship = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 40, 32), steel);
  ship.position.y = 90;
  const noseGeo = new THREE.SphereGeometry(4.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  noseGeo.scale(1, 2.4, 1);
  const nose = new THREE.Mesh(noseGeo, steel);
  nose.position.y = 110;
  rocket.add(booster, ship, nose);
  for (const s of [-1, 1]) {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8, 5), mats.dark);
    flap.position.set(s * 4.8, 75, 0);
    const flap2 = flap.clone();
    flap2.position.y = 104;
    flap2.scale.set(1, 0.8, 0.8);
    rocket.add(flap, flap2);
  }
  rocket.traverse((o) => (o.castShadow = true));
  const ROCKET_POS = new THREE.Vector3(-650, 0, -900);
  rocket.position.copy(ROCKET_POS).setY(22);
  scene.add(rocket);
  const mount = lattice(22, 16, mats.steel);
  mount.position.copy(ROCKET_POS);
  scene.add(mount);
  const towerL = lattice(145, 9, mats.steel);
  towerL.position.copy(ROCKET_POS).add(new THREE.Vector3(18, 0, 0));
  scene.add(towerL);
  for (const y of [95, 120]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(14, 2, 2), mats.steel);
    arm.position.copy(ROCKET_POS).add(new THREE.Vector3(10, y, 0));
    scene.add(arm);
  }

  const launch = { t: -25, phase: 'pad', alt: 0, vel: 0 };
  const LAUNCH_EVERY = 150;

  return {
    rails: RAILS,
    rings: RINGS.map((r) => ({ ...r })),
    ringMeshes,
    rocket,
    launch,
    resetRings() {
      for (const [i, r] of this.rings.entries()) {
        r.passed = false;
        ringMeshes[i].material.emissive.setHex(0x29d3ff);
      }
    },
    markRing(i) {
      this.rings[i].passed = true;
      ringMeshes[i].material.emissive.setHex(0x35ff7a);
    },
    /** Animate the background launch; returns rumble 0..1 for audio. */
    update(dt, fx, camPos) {
      for (const m of ringMeshes) m.rotation.z += dt * 0.4;
      tt.rotation.y += dt * 0.25;
      launch.t += dt;
      const base = rocket.position;
      let rumble = 0;
      if (launch.phase === 'pad' && launch.t > 0) {
        launch.phase = 'ignite';
        launch.t = 0;
      }
      if (launch.phase === 'ignite') {
        fx?.rocketExhaust('rocket', { x: base.x, y: base.y, z: base.z }, dt, { throttle: 0.6, groundY: 0 });
        rumble = 0.6;
        if (launch.t > 3) {
          launch.phase = 'climb';
          launch.t = 0;
        }
      } else if (launch.phase === 'climb') {
        launch.vel += dt * (6 + launch.t * 0.6);
        base.y += launch.vel * dt;
        fx?.rocketExhaust('rocket', { x: base.x, y: base.y, z: base.z }, dt, { throttle: 1, nearGround: base.y < 120, groundY: 0 });
        rumble = Math.max(0, 1 - launch.t / 40);
        if (base.y > 9000) {
          launch.phase = 'gone';
          launch.t = 0;
          rocket.visible = false;
        }
      } else if (launch.phase === 'gone' && launch.t > LAUNCH_EVERY) {
        rocket.visible = true;
        base.copy(ROCKET_POS).setY(22);
        launch.vel = 0;
        launch.phase = 'pad';
        launch.t = -20;
      }
      // Sound is delayed and dimmed by distance; keep it simple: scale by distance.
      const d = camPos ? camPos.distanceTo(base) : 1000;
      return rumble * Math.min(1, 900 / Math.max(d, 1));
    },
  };
}
