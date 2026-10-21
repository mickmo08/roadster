// Minimal quaternion helpers ([x, y, z, w]) so the physics has no three.js dependency.

export function qMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function qNormalize(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function qConj(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Rotate vector v by quaternion q. */
export function qRotate(q, v) {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [v[0] + qw * tx + (qy * tz - qz * ty), v[1] + qw * ty + (qz * tx - qx * tz), v[2] + qw * tz + (qx * ty - qy * tx)];
}

/** Same convention as THREE.Euler(pitch, yaw, roll, 'YXZ'). */
export function qFromEuler(yaw, pitch, roll) {
  const qy = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  const qx = [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)];
  const qz = [0, 0, Math.sin(roll / 2), Math.cos(roll / 2)];
  return qMul(qMul(qy, qx), qz);
}

/** Quaternion for a rotation vector (axis * angle). */
export function qFromRotVec(x, y, z) {
  const a = Math.hypot(x, y, z);
  if (a < 1e-9) return [0, 0, 0, 1];
  const s = Math.sin(a / 2) / a;
  return [x * s, y * s, z * s, Math.cos(a / 2)];
}

export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
