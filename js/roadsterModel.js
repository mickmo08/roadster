// Procedural low-poly-ish model of a 2+2 electric roadster with a removable
// glass roof. Faces -Z. Origin is on the ground, centered between the axles.
import * as THREE from 'three';

export const PAINTS = {
  red: { name: 'Red Multi-Coat', color: 0x8c0a12 },
  white: { name: 'Pearl White', color: 0xe8eaec },
  black: { name: 'Solid Black', color: 0x0c0c0e },
  blue: { name: 'Deep Blue', color: 0x1a3570 },
  silver: { name: 'Quicksilver', color: 0x9ba3aa },
};

const WHEEL_X = 0.86;
const AXLE_Z = 1.3;
const TIRE_R = 0.35;

function profileShape(points) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  return shape;
}

function arch(cu, r = 0.5, cy = 0.35, steps = 14) {
  const pts = [];
  // Sweep over the top of the wheel, rear to front, meeting the sill at y = 0.22.
  const a0 = Math.PI + Math.asin((cy - 0.22) / r);
  const a1 = -Math.asin((cy - 0.22) / r);
  for (let k = 0; k <= steps; k++) {
    const a = a0 + (a1 - a0) * (k / steps);
    pts.push([cu + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** Extrude a side profile (u = forward, v = up) across the car's width. */
function extrudeProfile(points, width, bevel) {
  const geo = new THREE.ExtrudeGeometry(profileShape(points), {
    depth: width,
    bevelEnabled: true,
    bevelThickness: bevel.thickness,
    bevelSize: bevel.size,
    bevelSegments: bevel.segments ?? 5,
    curveSegments: 8,
  });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(Math.PI / 2); // profile +u becomes -Z (front)
  if (bevel.shape) {
    // Plan-view taper toward the nose and tail, plus tumblehome toward the top,
    // so the extrusion reads as a rounded car rather than a box.
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const y = pos.getY(i);
      const zt = Math.min(1, Math.abs(z) / 2.3);
      const taper = 1 - (z < 0 ? 0.2 : 0.1) * zt ** 2.5;
      const tumble = 1 - 0.16 * Math.max(0, Math.min(1, (y - 0.55) / 0.5)) ** 1.5;
      pos.setX(i, pos.getX(i) * taper * tumble);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

function makeWheel(rimMat, tireMat, caliperMat, side) {
  const steer = new THREE.Group();
  const spin = new THREE.Group();
  steer.add(spin);

  const tire = new THREE.Mesh(new THREE.CylinderGeometry(TIRE_R, TIRE_R, 0.3, 32, 1), tireMat);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  spin.add(tire);

  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.255, 0.255, 0.31, 32, 1), rimMat);
  rim.rotation.z = Math.PI / 2;
  spin.add(rim);

  const spokeGeo = new THREE.BoxGeometry(0.03, 0.46, 0.06);
  for (let k = 0; k < 10; k++) {
    const spoke = new THREE.Mesh(spokeGeo, k % 2 ? tireMat : rimMat);
    spoke.position.x = side * 0.158;
    spoke.rotation.x = (k / 10) * Math.PI;
    spin.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12), caliperMat);
  hub.rotation.z = Math.PI / 2;
  hub.position.x = side * 0.165;
  spin.add(hub);

  // Brake caliper does not spin.
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.22), caliperMat);
  caliper.position.set(side * 0.08, 0.1, 0.12);
  steer.add(caliper);

  return { steer, spin };
}

export function buildRoadster(paintKey = 'red') {
  const group = new THREE.Group();
  const body = new THREE.Group(); // pitches/rolls on the suspension
  group.add(body);

  const paint = new THREE.MeshPhysicalMaterial({
    color: PAINTS[paintKey]?.color ?? PAINTS.red.color,
    metalness: 0.45,
    roughness: 0.4,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.55, metalness: 0.2 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0d141c,
    metalness: 0.1,
    roughness: 0.03,
    transparent: true,
    opacity: 0.42,
    envMapIntensity: 1.6,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const interior = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.85 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.75 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.9, roughness: 0.28 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.92 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd2, metalness: 0.7, roughness: 0.35 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdfe9ff, emissiveIntensity: 1.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a1a, emissiveIntensity: 0.6 });

  // --- Main body: long, low, soft wedge with wheel arches ---
  const bodyProfile = [
    [2.05, 0.22],
    [2.2, 0.36],
    [2.2, 0.5],
    [2.06, 0.6],
    [1.6, 0.71],
    [1.0, 0.8],
    [0.5, 0.88],
    [-0.6, 0.93],
    [-1.4, 0.96],
    [-1.95, 0.93],
    [-2.18, 0.86],
    [-2.24, 0.62],
    [-2.14, 0.3],
    [-2.0, 0.22],
    ...arch(-AXLE_Z),
    ...arch(AXLE_Z),
  ];
  const shell = new THREE.Mesh(extrudeProfile(bodyProfile, 1.62, { thickness: 0.2, size: 0.11, shape: true }), paint);
  shell.castShadow = true;
  shell.receiveShadow = true;
  body.add(shell);

  // --- Glass canopy (removable roof) ---
  const canopyProfile = [
    [0.62, 0.86],
    [0.1, 1.17],
    [-0.45, 1.23],
    [-1.05, 1.17],
    [-1.75, 0.97],
    [-1.75, 0.86],
  ];
  const canopy = new THREE.Mesh(extrudeProfile(canopyProfile, 1.05, { thickness: 0.13, size: 0.09 }), glass);
  canopy.renderOrder = 2;
  body.add(canopy);

  // Roof pillars / frame for definition
  const frameGeo = new THREE.BoxGeometry(0.05, 0.04, 1.6);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(frameGeo, trim);
    rail.position.set(side * 0.62, 1.12, 0.35);
    rail.rotation.x = -0.12;
    body.add(rail);
  }

  // --- Lower trim: splitter, side skirts, diffuser ---
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.3), trim);
  splitter.position.set(0, 0.2, -2.05);
  body.add(splitter);
  const intake = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.05), trim);
  intake.position.set(0, 0.33, -2.3);
  body.add(intake);
  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 1.5), trim);
    skirt.position.set(side * 1.0, 0.22, 0);
    body.add(skirt);
  }
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.25), trim);
  diffuser.position.set(0, 0.24, 2.12);
  body.add(diffuser);

  // --- Lights ---
  const headGeo = new THREE.BoxGeometry(0.42, 0.045, 0.1);
  for (const side of [-1, 1]) {
    const hl = new THREE.Mesh(headGeo, headMat);
    hl.position.set(side * 0.68, 0.6, -2.12);
    hl.rotation.set(-0.25, side * 0.35, 0);
    body.add(hl);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.05, 0.06), tailMat);
  tail.position.set(0, 0.84, 2.37);
  body.add(tail);

  // Side mirrors
  for (const side of [-1, 1]) {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.12), paint);
    mirror.position.set(side * 0.98, 1.0, -0.25);
    body.add(mirror);
  }

  // --- Interior (visible through the glass and from the cockpit cam) ---
  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 2.2), interior);
  tub.position.set(0, 1.07, -0.55);
  body.add(tub);
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.16, 0.35), interior);
  dash.position.set(0, 1.08, -0.63);
  body.add(dash);
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.18, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x07090c, emissive: 0x2a3550, emissiveIntensity: 0.6, roughness: 0.2 }),
  );
  screen.position.set(0.05, 1.19, -0.72);
  screen.rotation.x = -0.5;
  body.add(screen);
  for (const sx of [-0.38, 0.38]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.36, 0.12), seatMat);
    seat.position.set(sx, 1.17, 0.25);
    seat.rotation.x = 0.2;
    body.add(seat);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.1), seatMat);
    head.position.set(sx, 1.36, 0.3);
    body.add(head);
  }
  // Steering wheel (driver on the left)
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.6 });
  const steeringWheel = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 10, 32), wheelMat);
  steeringWheel.add(ring);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.03), wheelMat);
  steeringWheel.add(bar);
  steeringWheel.position.set(-0.38, 1.12, -0.5);
  steeringWheel.rotation.x = -0.35;
  body.add(steeringWheel);

  // --- Wheels ---
  const wheels = [];
  for (const [x, z, front] of [
    [-WHEEL_X, -AXLE_Z, true],
    [WHEEL_X, -AXLE_Z, true],
    [-WHEEL_X, AXLE_Z, false],
    [WHEEL_X, AXLE_Z, false],
  ]) {
    const w = makeWheel(rimMat, tireMat, caliperMat, Math.sign(x));
    w.steer.position.set(x, TIRE_R, z);
    group.add(w.steer);
    wheels.push({ ...w, front });
  }

  // --- Headlight beams (enabled at night) ---
  const beams = [];
  for (const side of [-1, 1]) {
    const spot = new THREE.SpotLight(0xf2f6ff, 0, 220, 0.45, 0.5, 1);
    spot.position.set(side * 0.68, 0.62, -2.1);
    spot.target.position.set(side * 1.5, 0, -40);
    body.add(spot, spot.target);
    beams.push(spot);
  }

  // Thruster exhaust glow (rear, for the thruster pack)
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x3d8bff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const flames = [];
  for (const side of [-1, 1]) {
    // Cone tip trails behind the car (+Z); the open base sits at the nozzle.
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.9, 16, 1, true), flameMat);
    f.rotation.x = Math.PI / 2;
    f.position.set(side * 0.45, 0.42, 2.85);
    body.add(f);
    flames.push(f);
  }

  return {
    group,
    body,
    wheels,
    steeringWheel,
    canopy,
    beams,
    flames,
    flameMat,
    tailMat,
    headMat,
    setPaint(key) {
      paint.color.setHex(PAINTS[key]?.color ?? PAINTS.red.color);
    },
  };
}
