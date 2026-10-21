// GPU point-sprite particles: cold-gas jets, vapor, dust, tyre smoke, sparks, rocket exhaust.
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d);
  if (vColor.a * a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

class ParticlePool {
  constructor(max, blending) {
    this.max = max;
    this.next = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.base = new Float32Array(max * 4); // r g b a at birth
    this.age = new Float32Array(max);
    this.life = new Float32Array(max).fill(0);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.buoy = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(p) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = p.vx ?? 0;
    this.vel[i * 3 + 1] = p.vy ?? 0;
    this.vel[i * 3 + 2] = p.vz ?? 0;
    this.base[i * 4] = p.r ?? 1;
    this.base[i * 4 + 1] = p.g ?? 1;
    this.base[i * 4 + 2] = p.b ?? 1;
    this.base[i * 4 + 3] = p.a ?? 1;
    this.age[i] = 0;
    this.life[i] = p.life ?? 1;
    this.s0[i] = p.size ?? 1;
    this.s1[i] = p.grow ?? p.size ?? 1;
    this.drag[i] = p.drag ?? 0;
    this.buoy[i] = p.buoy ?? 0;
  }

  update(dt, ground) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        this.col[i * 4 + 3] = 0;
        continue;
      }
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) {
        this.life[i] = 0;
        this.size[i] = 0;
        this.col[i * 4 + 3] = 0;
        continue;
      }
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + this.buoy[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      // Spread along the ground instead of sinking into it.
      const g = ground ? ground(this.pos[i * 3], this.pos[i * 3 + 2]) + 0.05 : -Infinity;
      if (this.pos[i * 3 + 1] < g) {
        this.pos[i * 3 + 1] = g;
        this.vel[i * 3 + 1] = Math.abs(this.vel[i * 3 + 1]) * 0.1;
      }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      this.col[i * 4] = this.base[i * 4];
      this.col[i * 4 + 1] = this.base[i * 4 + 1];
      this.col[i * 4 + 2] = this.base[i * 4 + 2];
      this.col[i * 4 + 3] = this.base[i * 4 + 3] * fade;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
  }
}

const rnd = (a = 1) => (Math.random() * 2 - 1) * a;

export class Effects {
  constructor() {
    this.glow = new ParticlePool(2500, THREE.AdditiveBlending);
    this.smoke = new ParticlePool(3500, THREE.NormalBlending);
    this.acc = new Map();
  }

  attach(scene) {
    scene.add(this.smoke.points, this.glow.points);
    this.glow.clear();
    this.smoke.clear();
  }

  setCamera(camera, height) {
    const s = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.glow.material.uniforms.uScale.value = s;
    this.smoke.material.uniforms.uScale.value = s;
  }

  /** Spread an emission rate over frames: returns how many particles to emit now. */
  count(key, rate, dt) {
    const a = (this.acc.get(key) ?? 0) + rate * dt;
    const n = Math.floor(a);
    this.acc.set(key, a - n);
    return n;
  }

  /**
   * Cold-gas jet: a hard, near-invisible supersonic core with a bright Mach-disk
   * glow at the nozzle, then a billowing white condensation plume. Kicks up dust
   * when it hits the ground.
   */
  coldJet(key, p, dir, carVel, dt, { power = 1, ground = null } = {}) {
    const n = this.count(key + 'c', 260 * power, dt);
    for (let i = 0; i < n; i++) {
      const sp = 45 + Math.random() * 30;
      this.glow.emit({
        x: p.x + rnd(0.04),
        y: p.y + rnd(0.04),
        z: p.z + rnd(0.04),
        vx: carVel.x + (dir.x + rnd(0.06)) * sp,
        vy: carVel.y + (dir.y + rnd(0.06)) * sp,
        vz: carVel.z + (dir.z + rnd(0.06)) * sp,
        life: 0.09 + Math.random() * 0.05,
        size: 0.55 * power,
        grow: 0.25,
        r: 0.75,
        g: 0.88,
        b: 1,
        a: 0.55,
      });
    }
    const m = this.count(key + 'v', 110 * power, dt);
    for (let i = 0; i < m; i++) {
      const sp = 14 + Math.random() * 12;
      const back = 0.6 + Math.random() * 1.6;
      this.smoke.emit({
        x: p.x + dir.x * back + rnd(0.15),
        y: p.y + dir.y * back + rnd(0.15),
        z: p.z + dir.z * back + rnd(0.15),
        vx: carVel.x * 0.4 + (dir.x + rnd(0.25)) * sp,
        vy: carVel.y * 0.4 + (dir.y + rnd(0.25)) * sp,
        vz: carVel.z * 0.4 + (dir.z + rnd(0.25)) * sp,
        life: 0.8 + Math.random() * 0.8,
        size: 0.5,
        grow: 3.5 + Math.random() * 2,
        r: 0.93,
        g: 0.95,
        b: 0.98,
        a: 0.26,
        drag: 2.2,
        buoy: 0.6,
      });
    }
    // Downwash: if the jet points at nearby ground, blast dust outward.
    if (ground && dir.y < -0.5) {
      const gh = ground(p.x, p.z);
      const alt = p.y - gh;
      if (alt < 9) {
        const d = this.count(key + 'd', 140 * power * (1 - alt / 9), dt);
        for (let i = 0; i < d; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 10 + Math.random() * 12;
          this.smoke.emit({
            x: p.x + Math.cos(a) * 0.8,
            y: gh + 0.2,
            z: p.z + Math.sin(a) * 0.8,
            vx: Math.cos(a) * sp,
            vy: 1 + Math.random() * 2,
            vz: Math.sin(a) * sp,
            life: 1.2 + Math.random() * 0.8,
            size: 0.8,
            grow: 5,
            r: 0.78,
            g: 0.72,
            b: 0.62,
            a: 0.22,
            drag: 1.8,
            buoy: 0.4,
          });
        }
      }
    }
  }

  /** Short side puff from an attitude-control (RCS) nozzle. */
  rcsPuff(key, p, dir, carVel, dt) {
    const n = this.count(key, 70, dt);
    for (let i = 0; i < n; i++) {
      const sp = 18 + Math.random() * 8;
      this.smoke.emit({
        x: p.x,
        y: p.y,
        z: p.z,
        vx: carVel.x + (dir.x + rnd(0.2)) * sp,
        vy: carVel.y + (dir.y + rnd(0.2)) * sp,
        vz: carVel.z + (dir.z + rnd(0.2)) * sp,
        life: 0.35 + Math.random() * 0.25,
        size: 0.2,
        grow: 1.4,
        r: 0.96,
        g: 0.97,
        b: 1,
        a: 0.45,
        drag: 4,
      });
    }
  }

  tyreSmoke(key, p, amount, dt) {
    const n = this.count(key, 60 * amount, dt);
    for (let i = 0; i < n; i++) {
      this.smoke.emit({ x: p.x + rnd(0.2), y: p.y + 0.1, z: p.z + rnd(0.2), vx: rnd(1), vy: 0.6 + Math.random(), vz: rnd(1), life: 1.4, size: 0.5, grow: 3, r: 0.85, g: 0.85, b: 0.86, a: 0.25, drag: 1.5, buoy: 0.5 });
    }
  }

  /** One-off burst for landings, crashes and wall hits. */
  burst(p, { dust = 30, sparks = 0, smoke = 0, color = [0.78, 0.72, 0.62] } = {}) {
    for (let i = 0; i < dust; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 8;
      this.smoke.emit({ x: p.x + rnd(1), y: p.y + 0.2, z: p.z + rnd(1), vx: Math.cos(a) * sp, vy: 1 + Math.random() * 2, vz: Math.sin(a) * sp, life: 1.5, size: 0.8, grow: 4.5, r: color[0], g: color[1], b: color[2], a: 0.35, drag: 2, buoy: 0.3 });
    }
    for (let i = 0; i < sparks; i++) {
      this.glow.emit({ x: p.x, y: p.y + 0.5, z: p.z, vx: rnd(12), vy: 3 + Math.random() * 8, vz: rnd(12), life: 0.4 + Math.random() * 0.4, size: 0.18, grow: 0.05, r: 1, g: 0.65, b: 0.25, a: 1, drag: 1 });
    }
    for (let i = 0; i < smoke; i++) {
      this.smoke.emit({ x: p.x + rnd(1), y: p.y + 0.5, z: p.z + rnd(1), vx: rnd(1.5), vy: 1.5 + Math.random() * 2, vz: rnd(1.5), life: 3 + Math.random() * 2, size: 1.2, grow: 7, r: 0.25, g: 0.25, b: 0.26, a: 0.45, drag: 0.6, buoy: 0.6 });
    }
  }

  /** Methane-oxygen rocket exhaust (for the launch in the background). */
  rocketExhaust(key, p, dt, { throttle = 1, nearGround = true, groundY = 0 } = {}) {
    const n = this.count(key + 'f', 220 * throttle, dt);
    for (let i = 0; i < n; i++) {
      const sp = 60 + Math.random() * 40;
      this.glow.emit({ x: p.x + rnd(4), y: p.y, z: p.z + rnd(4), vx: rnd(4), vy: -sp, vz: rnd(4), life: 0.35 + Math.random() * 0.25, size: 9, grow: 18, r: 1, g: 0.62 + Math.random() * 0.15, b: 0.3, a: 0.5 });
    }
    if (nearGround) {
      const m = this.count(key + 's', 120 * throttle, dt);
      for (let i = 0; i < m; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 25 + Math.random() * 35;
        this.smoke.emit({ x: p.x, y: groundY + 4, z: p.z, vx: Math.cos(a) * sp, vy: 3 + Math.random() * 10, vz: Math.sin(a) * sp, life: 6 + Math.random() * 4, size: 14, grow: 60, r: 0.9, g: 0.88, b: 0.85, a: 0.4, drag: 0.5, buoy: 1.2 });
      }
    } else {
      const m = this.count(key + 't', 50 * throttle, dt);
      for (let i = 0; i < m; i++) {
        this.smoke.emit({ x: p.x + rnd(3), y: p.y - 20, z: p.z + rnd(3), vx: rnd(2), vy: -10, vz: rnd(2), life: 8, size: 12, grow: 40, r: 0.92, g: 0.9, b: 0.88, a: 0.28, drag: 0.4 });
      }
    }
  }

  update(dt, ground) {
    this.glow.update(dt, null);
    this.smoke.update(dt, ground);
  }
}
