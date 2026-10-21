// Procedural model of the next-generation Roadster as revealed in October 2026:
// a sharp, angular wedge with hidden headlights, a full-width tail light, gold-tinted
// "visor" glass, butterfly doors, an active rear wing and cold-gas thruster nozzles.
// Built from faceted cross-sections so the creases stay crisp. Faces -Z; origin on
// the ground between the axles.
import * as THREE from 'three';

export const PAINTS = {
  ano: { name: 'Ano White', color: 0xeeeeea, metalness: 0.12, roughness: 0.32 },
  red: { name: 'Red Multi-Coat', color: 0x9a0d15, metalness: 0.45, roughness: 0.38 },
  black: { name: 'Solid Black', color: 0x0d0d0f, metalness: 0.4, roughness: 0.3 },
  silver: { name: 'Quicksilver', color: 0x9ea6ad, metalness: 0.75, roughness: 0.28 },
  blue: { name: 'Deep Blue', color: 0x1b3366, metalness: 0.5, roughness: 0.34 },
};

const FRONT_AXLE = -1.3;
const REAR_AXLE = 1.3;
const FRONT_R = 0.34;
const REAR_R = 0.36;
const TRACK = 0.84; // wheel centre x
const ARCH_R = 0.45;
const DOOR = [-0.38, 0.78];
const WING_Y = 0.915;

// Side-profile keyframes along the car (z), piecewise-linear for crisp wedge lines.
const KEYS = {
  z: [-2.32, -2.22, -2.0, -1.6, -1.0, -0.45, 0.2, 0.8, 1.3, 1.8, 2.12, 2.24],
  top: [0.4, 0.49, 0.56, 0.66, 0.74, 0.8, 0.82, 0.84, 0.87, 0.9, 0.9, 0.84],
  shoulder: [0.36, 0.45, 0.53, 0.66, 0.7, 0.71, 0.73, 0.78, 0.83, 0.86, 0.86, 0.8],
  waist: [0.3, 0.34, 0.38, 0.41, 0.43, 0.43, 0.44, 0.46, 0.5, 0.53, 0.54, 0.54],
  w: [0.55, 0.8, 0.93, 0.99, 1.0, 0.97, 0.96, 1.0, 1.04, 1.03, 0.98, 0.94],
  topFrac: [0.62, 0.7, 0.74, 0.76, 0.78, 0.76, 0.75, 0.74, 0.74, 0.75, 0.76, 0.76],
};
const CANOPY = {
  z: [-0.45, -0.1, 0.25, 0.75, 1.2, 1.8],
  roof: [0.8, 1.0, 1.16, 1.17, 1.08, 0.91],
  roofW: [0.46, 0.5, 0.52, 0.5, 0.44, 0.36],
};

function lerpKeys(zs, vs, z) {
  if (z <= zs[0]) return vs[0];
  for (let i = 1; i < zs.length; i++) {
    if (z <= zs[i]) {
      const t = (z - zs[i - 1]) / (zs[i] - zs[i - 1]);
      return vs[i - 1] + (vs[i] - vs[i - 1]) * t;
    }
  }
  return vs[vs.length - 1];
}

function archTop(z) {
  let top = -Infinity;
  for (const [az, r] of [
    [FRONT_AXLE, FRONT_R],
    [REAR_AXLE, REAR_R],
  ]) {
    const dz = z - az;
    if (Math.abs(dz) < ARCH_R) top = Math.max(top, r + Math.sqrt(ARCH_R * ARCH_R - dz * dz) - 0.04);
  }
  return top;
}

/** Half cross-section of the body at z: points from the bottom centerline round to the top centerline. */
function bodySection(z) {
  const k = (name) => lerpKeys(KEYS.z, KEYS[name], z);
  const w = k('w');
  const top = k('top');
  const sh = k('shoulder');
  let waist = k('waist');
  let sill = 0.24;
  let inner = w * 0.82;
  const at = archTop(z);
  if (at > sill) {
    sill = Math.min(at, sh - 0.06);
    waist = Math.max(waist, Math.min(sill + 0.03, sh - 0.03));
    inner = w * 0.6;
  }
  return [
    [0, 0.14],
    [inner, 0.14],
    [w * 0.96, sill],
    [w, waist],
    [w * 0.985, sh],
    [w * k('topFrac'), top],
    [0, top + 0.015],
  ];
}

function canopySection(z) {
  const baseW = lerpKeys(KEYS.z, KEYS.w, z) * lerpKeys(KEYS.z, KEYS.topFrac, z) * 0.97;
  const baseY = lerpKeys(KEYS.z, KEYS.top, z) - 0.01;
  const roof = Math.max(baseY, lerpKeys(CANOPY.z, CANOPY.roof, z));
  const rw = Math.min(baseW, lerpKeys(CANOPY.z, CANOPY.roofW, z));
  return [
    [baseW, baseY],
    [rw, roof - 0.015],
    [0, roof],
  ];
}

/**
 * Loft mirrored strips between consecutive section points. Each strip gets its own
 * vertices so creases stay sharp. include(k, z) picks which strip segments to emit;
 * color(k) is a grey level for strip k (1 = paint, dark = trim). sides limits mirroring.
 */
function loft(zs, sectionFn, { include = () => true, color = () => 1, caps = false, sides = [-1, 1] } = {}) {
  const pos = [];
  const col = [];
  const idx = [];
  const sections = zs.map((z) => sectionFn(z));
  const K = sections[0].length;
  const vtx = (x, y, z, c) => {
    pos.push(x, y, z);
    col.push(c, c, c);
    return pos.length / 3 - 1;
  };
  for (let k = 0; k < K - 1; k++) {
    for (const side of sides) {
      for (let i = 0; i < zs.length - 1; i++) {
        if (!include(k, (zs[i] + zs[i + 1]) / 2)) continue;
        const c = color(k, zs[i]);
        const a0 = sections[i][k];
        const b0 = sections[i][k + 1];
        const a1 = sections[i + 1][k];
        const b1 = sections[i + 1][k + 1];
        const p0 = vtx(side * a0[0], a0[1], zs[i], c);
        const p1 = vtx(side * b0[0], b0[1], zs[i], c);
        const p2 = vtx(side * a1[0], a1[1], zs[i + 1], c);
        const p3 = vtx(side * b1[0], b1[1], zs[i + 1], c);
        // Winding so the face points away from the car's centre.
        const e1 = [side * (b0[0] - a0[0]), b0[1] - a0[1], 0];
        const e2 = [side * (a1[0] - a0[0]), a1[1] - a0[1], zs[i + 1] - zs[i]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const mx = (side * (a0[0] + b0[0])) / 2;
        const my = (a0[1] + b0[1]) / 2 - 0.55;
        if (n[0] * mx + n[1] * my > 0) idx.push(p0, p1, p2, p1, p3, p2);
        else idx.push(p0, p2, p1, p1, p2, p3);
      }
    }
  }
  if (caps) {
    for (const [i, dir] of [
      [0, -1],
      [zs.length - 1, 1],
    ]) {
      const sec = sections[i];
      const ring = [...sec, ...sec.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
      const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const shade = dir < 0 ? 1 : 0.85;
      const c0 = vtx(0, cy, zs[i], shade);
      for (const [x, y] of ring) vtx(x, y, zs[i], shade);
      for (let j = 0; j < ring.length; j++) {
        const a = c0 + 1 + j;
        const b = c0 + 1 + ((j + 1) % ring.length);
        // Ring runs bottom-centre → +x side → top → -x side, which is clockwise seen
        // from the front, so the nose cap needs reversed winding to face outward.
        if (dir < 0) idx.push(c0, b, a);
        else idx.push(c0, a, b);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function range(a, b, step) {
  const out = [];
  for (let z = a; z < b - 1e-6; z += step) out.push(+z.toFixed(4));
  out.push(b);
  return out;
}

function makeWheel(radius, mats, side) {
  const steer = new THREE.Group();
  const spin = new THREE.Group();
  steer.add(spin);
  const width = radius > 0.35 ? 0.33 : 0.29;
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 40, 1), mats.tire);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  spin.add(tire);
  // Flat aero cover with angular blades.
  const cover = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.74, radius * 0.74, width + 0.012, 6, 1), mats.cover);
  cover.rotation.z = Math.PI / 2;
  spin.add(cover);
  const bladeGeo = new THREE.BoxGeometry(0.012, radius * 0.62, 0.05);
  for (let k = 0; k < 6; k++) {
    const blade = new THREE.Mesh(bladeGeo, mats.blade);
    blade.position.x = side * (width / 2 + 0.008);
    blade.rotation.x = (k / 6) * Math.PI * 2 + 0.3;
    blade.translateY(radius * 0.36);
    spin.add(blade);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 6), mats.blade);
  cap.rotation.z = Math.PI / 2;
  cap.position.x = side * (width / 2 + 0.012);
  spin.add(cap);
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.2), mats.caliper);
  caliper.position.set(side * 0.06, 0.12, 0.1);
  steer.add(caliper);
  return { steer, spin, radius };
}

function nozzle(mat, size = 1) {
  return new THREE.Mesh(
    new THREE.LatheGeometry([new THREE.Vector2(0.03 * size, 0), new THREE.Vector2(0.045 * size, 0.04 * size), new THREE.Vector2(0.075 * size, 0.12 * size)], 16),
    mat,
  );
}

export function buildRoadster(paintKey = 'ano') {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const paintDef = PAINTS[paintKey] ?? PAINTS.ano;
  const paint = new THREE.MeshPhysicalMaterial({
    color: paintDef.color,
    metalness: paintDef.metalness,
    roughness: paintDef.roughness,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    vertexColors: true,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.5, metalness: 0.3 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.35, metalness: 0.5 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x6f5420, // gold "spacesuit visor" tint
    metalness: 0.85,
    roughness: 0.08,
    transparent: true,
    opacity: 0.8,
    envMapIntensity: 1.8,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const interior = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.85, side: THREE.DoubleSide });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x232326, roughness: 0.7 });
  const mats = {
    tire: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.92 }),
    cover: new THREE.MeshStandardMaterial({ color: 0x1c1e22, metalness: 0.6, roughness: 0.3 }),
    blade: new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.9, roughness: 0.25 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xc7ccd1, metalness: 0.7, roughness: 0.35 }),
  };
  const headMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0xe8f0ff, emissiveIntensity: 0.15 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1a1a, emissiveIntensity: 0.7 });
  const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.95, roughness: 0.25, side: THREE.DoubleSide });

  // ---- Body shell (door skins cut out so they can open) ----
  const zs = range(-2.32, 2.24, 0.03);
  const inDoor = (z) => z > DOOR[0] && z < DOOR[1];
  const shell = new THREE.Mesh(
    loft(zs, bodySection, {
      include: (k, z) => !(k >= 2 && k <= 4 && inDoor(z)),
      // Underbody is dark, except the front fascia below the nose.
      color: (k, z) => (k === 0 || (k === 1 && z > -2.05) ? 0.05 : 1),
      caps: true,
    }),
    paint,
  );
  shell.castShadow = true;
  shell.receiveShadow = true;
  body.add(shell);

  // Dark door apertures, seen when the doors are open.
  for (const side of [-1, 1]) {
    const ap = new THREE.Mesh(new THREE.PlaneGeometry(DOOR[1] - DOOR[0], 0.5), interior);
    ap.rotation.y = Math.PI / 2;
    ap.position.set(side * 0.93, 0.55, (DOOR[0] + DOOR[1]) / 2);
    body.add(ap);
  }

  // ---- Butterfly doors: the door skin plus its window, hinged high on the A-pillar ----
  const doors = [];
  const glassParts = [];
  const doorZs = range(DOOR[0], DOOR[1], 0.03);
  for (const side of [-1, 1]) {
    const skin = new THREE.Mesh(loft(doorZs, bodySection, { include: (k) => k >= 2 && k <= 4, sides: [side] }), paint);
    skin.castShadow = true;
    const win = new THREE.Mesh(loft(doorZs, canopySection, { include: (k) => k === 0, sides: [side] }), glass);
    win.renderOrder = 2;
    glassParts.push(win);
    const hinge = new THREE.Vector3(side * 0.8, 0.84, DOOR[0] + 0.02);
    const pivot = new THREE.Group();
    pivot.position.copy(hinge);
    for (const m of [skin, win]) {
      m.position.copy(hinge).multiplyScalar(-1);
      pivot.add(m);
    }
    body.add(pivot);
    doors.push({ pivot, side });
  }

  // ---- Gold-tinted canopy (side glass in the door range belongs to the doors) ----
  const canopy = new THREE.Mesh(loft(range(-0.45, 1.8, 0.03), canopySection, { include: (k, z) => !(k === 0 && inDoor(z)) }), glass);
  canopy.renderOrder = 2;
  body.add(canopy);
  glassParts.push(canopy);
  for (const side of [-1, 1]) {
    const pts = [-0.45, -0.25, -0.05, 0.25, 0.75].map((z) => {
      const s = canopySection(z);
      return new THREE.Vector3(side * s[1][0], s[1][1] + 0.004, z);
    });
    const pillar = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.02, 6), trim);
    body.add(pillar);
    glassParts.push(pillar);
  }

  // ---- Lights ----
  // Hidden headlights: a hairline slit under the hood's leading edge that lights at night.
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.022, 0.04), headMat);
  head.position.set(0, 0.47, -2.245);
  body.add(head);
  // Full-width tail light
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.045, 0.05), tailMat);
  tail.position.set(0, 0.85, 2.235);
  body.add(tail);

  // ---- Aero: splitter, diffuser with suction-fan exhaust, side intakes ----
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.035, 0.14), carbon);
  splitter.position.set(0, 0.16, -2.25);
  body.add(splitter);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.26, 0.05), carbon);
  diffuser.position.set(0, 0.34, 2.25);
  body.add(diffuser);
  for (let k = -3; k <= 3; k++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.5), carbon);
    fin.position.set(k * 0.22, 0.22, 2.0);
    body.add(fin);
  }
  const fanRing = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.018, 8, 28), mats.blade);
  fanRing.position.set(0, 0.36, 2.285);
  body.add(fanRing);
  const fanBlades = new THREE.Group();
  for (let k = 0; k < 7; k++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.1, 0.01), trim);
    b.rotation.z = (k / 7) * Math.PI * 2;
    b.translateY(0.05);
    fanBlades.add(b);
  }
  fanBlades.position.set(0, 0.36, 2.28);
  body.add(fanBlades);

  // ---- Active rear wing: flush when stowed, raised with speed, braking and in the air ----
  const wing = new THREE.Group();
  wing.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.03, 0.3), carbon));
  for (const side of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.34), carbon);
    plate.position.set(side * 0.9, -0.045, 0);
    wing.add(plate);
  }
  wing.position.set(0, WING_Y, 1.95);
  body.add(wing);
  const struts = [];
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1, 0.07), carbon);
    strut.position.set(side * 0.4, WING_Y, 1.95);
    body.add(strut);
    struts.push(strut);
  }

  // ---- Interior: yoke, displays, fixed seats ----
  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 1.85), interior);
  tub.position.set(0, 0.8, 0.52);
  body.add(tub);
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.22), interior);
  dash.position.set(0, 0.82, -0.04);
  body.add(dash);
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x07090c, emissive: 0x2a3550, emissiveIntensity: 0.7, roughness: 0.2 });
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.02), screenMat);
  screen.position.set(0.04, 0.9, 0.0);
  screen.rotation.x = -0.45;
  body.add(screen);
  const seats = new THREE.Group();
  body.add(seats);
  const yoke = new THREE.Group();
  const yokeMat = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.55 });
  for (const [w, h, x, y] of [
    [0.3, 0.03, 0, -0.07],
    [0.03, 0.13, -0.15, 0],
    [0.03, 0.13, 0.15, 0],
  ]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), yokeMat);
    p.position.set(x, y, 0);
    yoke.add(p);
  }
  for (const dx of [-0.08, 0.08]) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.01), screenMat);
    d.position.set(dx, 0.02, -0.04);
    yoke.add(d);
  }
  yoke.rotation.x = -0.35;
  body.add(yoke);

  // ---- Wheels (staggered) ----
  const wheels = [];
  for (const [x, z, r, front] of [
    [-TRACK, FRONT_AXLE, FRONT_R, true],
    [TRACK, FRONT_AXLE, FRONT_R, true],
    [-TRACK, REAR_AXLE, REAR_R, false],
    [TRACK, REAR_AXLE, REAR_R, false],
  ]) {
    const w = makeWheel(r, mats, Math.sign(x));
    w.steer.position.set(x, r, z);
    group.add(w.steer);
    wheels.push({ ...w, front, baseY: r });
  }

  // ---- Headlight beams (night) ----
  const beams = [];
  for (const side of [-1, 1]) {
    const spot = new THREE.SpotLight(0xf2f6ff, 0, 220, 0.45, 0.5, 1);
    spot.position.set(side * 0.55, 0.5, -2.2);
    spot.target.position.set(side * 1.5, 0, -40);
    body.add(spot, spot.target);
    beams.push(spot);
  }

  // ---- Cold-gas thrusters: 2 rear (Thrust), plus 4 lift and 4 lateral (Rocket) ----
  const nozzles = { rear: [], lift: [], side: [] };
  const addNozzle = (kind, pos, dir, size = 1) => {
    const n = nozzle(nozzleMat, size);
    n.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()); // bell opens along dir
    n.position.copy(pos);
    body.add(n);
    nozzles[kind].push({ mesh: n, pos: pos.clone(), dir: dir.clone().normalize() });
  };
  addNozzle('rear', new THREE.Vector3(-0.45, 0.4, 2.2), new THREE.Vector3(0, 0, 1), 1.4);
  addNozzle('rear', new THREE.Vector3(0.45, 0.4, 2.2), new THREE.Vector3(0, 0, 1), 1.4);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addNozzle('lift', new THREE.Vector3(sx * 0.6, 0.2, sz * 1.92), new THREE.Vector3(0, -1, 0), 0.75);
      addNozzle('side', new THREE.Vector3(sx * 0.97, 0.48, sz * 1.78), new THREE.Vector3(sx, 0, 0), 0.8);
    }
  }

  const model = {
    group,
    body,
    wheels,
    steeringWheel: yoke,
    canopy,
    glassParts,
    doors,
    wing,
    beams,
    nozzles,
    tailMat,
    headMat,
    fanBlades,
    driverX: -0.36,
    doorOpen: 0,
    wingDeploy: 0,
    setPaint(key) {
      const p = PAINTS[key] ?? PAINTS.ano;
      paint.color.setHex(p.color);
      paint.metalness = p.metalness;
      paint.roughness = p.roughness;
    },
    setTrim(trimKey) {
      for (const n of nozzles.rear) n.mesh.visible = trimKey !== 'performance';
      for (const n of [...nozzles.lift, ...nozzles.side]) n.mesh.visible = trimKey === 'rocket';
      seats.clear();
      const xs = trimKey === 'rocket' ? [0] : [-0.36, 0.36]; // Rocket is a single-seater
      for (const sx of xs) {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 0.12), seatMat);
        seat.position.set(sx, 0.96, 0.42);
        seat.rotation.x = 0.25;
        const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.1), seatMat);
        headrest.position.set(sx, 1.13, 0.49);
        seats.add(seat, headrest);
      }
      model.driverX = xs.length === 1 ? 0 : -0.36;
      yoke.position.set(model.driverX, 0.88, -0.02);
    },
    /** 0 = closed, 1 = fully open (butterfly: up, forward and out). */
    setDoors(t) {
      model.doorOpen = t;
      const e = t * t * (3 - 2 * t);
      for (const d of doors) d.pivot.rotation.set(-1.0 * e, d.side * -0.15 * e, d.side * -0.35 * e, 'ZYX');
    },
    /** 0 = stowed flush, 1 = raised at full angle of attack. */
    setWing(t) {
      model.wingDeploy = t;
      wing.position.y = WING_Y + t * 0.34;
      wing.rotation.x = t * 0.22;
      for (const s of struts) {
        s.visible = t > 0.02;
        s.scale.y = Math.max(0.01, t * 0.34);
        s.position.y = WING_Y + (t * 0.34) / 2;
      }
    },
  };
  model.setTrim('performance');
  model.setWing(0);
  return model;
}
