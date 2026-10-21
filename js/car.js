// Vehicle dynamics for the Roadster, on the ground, on curved ramps, and in the air.
//
// Reference: the Roadster revealed on 15 Oct 2026. It has a multi-mode suction-fan
// system, three trims (Performance, Thrust with rear cold-gas jets, Rocket with 10
// cold-gas thrusters for lift and rotation), 230+ mph and 300+ mi range. Announced
// 0–60 mph: under 1.6 s / 0.9 s / 0.59 s. Tesla hasn't published mass, power or pack
// size, so those are estimates tuned to land on the announced times.
import { qFromEuler, qMul, qNormalize, qRotate, qConj, qFromRotVec, cross, dot } from './math3.js';

export const G = 9.81;
export const MPH = 0.44704; // m/s per mph

export const TRIMS = {
  performance: {
    key: 'performance',
    name: 'Performance',
    tagline: 'Road ready',
    seats: 2,
    mass: 1950,
    rearThrust: 0,
    lift: 0, // multiples of g
    rcs: 0.6, // rad/s² of air control (wheel inertia + active aero only)
    gas: 0, // seconds of full thrust in the COPVs
    claim060: 'under 1.6 s',
  },
  thrust: {
    key: 'thrust',
    name: 'Thrust',
    tagline: 'Race ready · rear cold-gas thrusters',
    seats: 2,
    mass: 1990,
    rearThrust: 26000,
    lift: 0,
    rcs: 0.9,
    gas: 7,
    claim060: 'under 0.9 s',
  },
  rocket: {
    key: 'rocket',
    name: 'Rocket',
    tagline: 'Air ready · 10 thrusters · single seat',
    seats: 1,
    mass: 1850,
    rearThrust: 50000,
    lift: 1.75,
    rcs: 7,
    gas: 16,
    claim060: 'under 0.59 s',
  },
};

export const SPEC = {
  wheelbase: 2.6,
  tireRadius: 0.35,
  maxMotorForce: 35000, // N (estimate)
  peakPower: 1000e3, // W (estimate)
  mu: 1.05, // tyre friction
  fanSuction: 1.1, // suction-fan force in multiples of weight; holds the car even when stopped
  clA: 1.1, // active-aero downforce area, m²
  latGrip: 0.85,
  cdA: 0.5,
  rho: 1.225,
  crr: 0.011,
  vMax: 235 * MPH, // "speeds exceeding 230 mph"
  reverseMax: 12,
  brakeG: 1.8,
  regenG: 0.2,
  regenPower: 300e3,
  batteryWh: 140000, // estimate; Tesla hasn't announced pack size
  ratedRangeKm: 300 * 1.609344, // "300+ miles"
  auxPower: 1500, // W, includes the suction fans' idle draw
  driveEff: 0.92,
  regenEff: 0.75,
  maxSteer: 0.55,
  steerSpeedFactor: 300,
  gasUse: { rear: 1, lift: 1, rcs: 0.25 },
  gasRecharge: 0.35, // onboard compressor, per second, while grounded and idle
};

// Contact probes in car-local space (origin on the ground between the axles, -Z forward).
const WHEEL_PROBES = [
  [-0.85, 0.02, -1.3],
  [0.85, 0.02, -1.3],
  [-0.85, 0.02, 1.3],
  [0.85, 0.02, 1.3],
];
const BODY_PROBES = [
  [0, 0.45, -2.3],
  [0, 0.75, 2.3],
  [0, 1.12, 0.3],
  [-1.0, 0.7, 0],
  [1.0, 0.7, 0],
];

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class CarPhysics {
  constructor(trimKey = 'performance') {
    this.setTrim(trimKey);
    this.reset(0, 0, 0);
  }

  setTrim(key) {
    this.trim = TRIMS[key] ?? TRIMS.performance;
    this.mass = this.trim.mass;
    this.gas = this.trim.gas;
  }

  reset(x, z, heading, y = 0, full = true) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.heading = heading;
    this.mode = 'ground'; // ground | rail | air | crashed
    this.v = 0;
    this.vy = 0;
    this.vel = [0, 0, 0];
    this.omega = [0, 0, 0]; // body-frame angular velocity (pitch, yaw, roll axes)
    this.q = qFromEuler(heading, 0, 0);
    this.pitch = 0;
    this.roll = 0;
    this.steer = 0;
    this.steerAngle = 0;
    this.yawRate = 0;
    this.longAcc = 0;
    this.latAcc = 0;
    this.gear = 'D';
    if (full) {
      this.batteryWh = SPEC.batteryWh * 0.9;
      this.energyUsedWh = 0;
      this.odometer = 0;
    }
    this.gas = this.trim.gas;
    this.thrusting = false;
    this.lifting = false;
    this.rcsInput = [0, 0, 0];
    this.torqueRamp = 0.3;
    this.launchArmed = false;
    this.powerKW = 0;
    this.slip = 0;
    this.braking = false;
    this.wheelSpin = 0;
    this.recentWhPerKm = 290;
    this.rail = null;
    this.air = null;
    this.crashTimer = 0;
    this.events = [];
    this.safe = { x, z, heading, y };
    this.safeTimer = 0;
  }

  get airborne() {
    return this.mode === 'air';
  }

  get speed() {
    return this.mode === 'air' ? Math.hypot(...this.vel) : Math.abs(this.v);
  }

  maxSteerAngle() {
    const v = Math.abs(this.v);
    return SPEC.maxSteer / (1 + (v * v) / SPEC.steerSpeedFactor);
  }

  /** Lateral grip in m/s² on a flat road (used by the autopilot). */
  latLimit() {
    return SPEC.mu * SPEC.latGrip * G * (1 + SPEC.fanSuction);
  }

  setGear(gear) {
    if (Math.abs(this.v) < 1 && this.mode === 'ground') this.gear = gear;
    return this.gear === gear;
  }

  forward3() {
    return qRotate(this.q, [0, 0, -1]);
  }

  up3() {
    return qRotate(this.q, [0, 1, 0]);
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  // ---------------------------------------------------------------- gas
  useGas(amount) {
    if (this.gas <= 0) return false;
    this.gas = Math.max(0, this.gas - amount);
    return true;
  }

  /**
   * @param {number} dt
   * @param {{throttle:number, brake:number, steer:number, boost:boolean, lift:boolean, roll:number}} input
   * @param {{surface:{grip:number, rolling:number}, ground:(x:number,z:number)=>number, rails:any[]}} env
   */
  step(dt, input, env) {
    const throttle = this.batteryWh > 0 ? input.throttle : 0;
    const t = this.trim;
    const wantRear = input.boost && t.rearThrust > 0 && this.gear === 'D';
    const wantLift = input.lift && t.lift > 0;
    this.thrusting = wantRear && this.gas > 0 && this.mode !== 'crashed';
    this.lifting = wantLift && this.gas > 0 && this.mode !== 'crashed';
    if (this.thrusting) this.useGas(SPEC.gasUse.rear * dt);
    if (this.lifting) this.useGas(SPEC.gasUse.lift * dt);

    if (this.mode === 'ground') this.stepGround(dt, { ...input, throttle }, env);
    else if (this.mode === 'rail') this.stepRail(dt, { ...input, throttle }, env);
    else if (this.mode === 'air') this.stepAir(dt, input, env);
    else this.stepCrashed(dt, env);

    if (this.mode === 'ground' && !this.thrusting && !this.lifting) {
      this.gas = Math.min(t.gas, this.gas + SPEC.gasRecharge * dt);
    }
    this.wheelSpin += ((this.mode === 'air' ? this.v * 0.98 : this.v) / SPEC.tireRadius) * dt;
  }

  // ---------------------------------------------------------------- energy
  account(dt, motorF, regenF, brakeF, vAbs) {
    const mechOut = motorF * vAbs;
    const recovered = Math.min(SPEC.regenPower, (regenF + (regenF > 0 ? 0 : brakeF * 0.5)) * vAbs);
    const elec = mechOut / SPEC.driveEff + SPEC.auxPower - recovered * SPEC.regenEff;
    const wh = (elec * dt) / 3600;
    this.batteryWh = Math.max(0, Math.min(SPEC.batteryWh, this.batteryWh - wh));
    this.energyUsedWh += wh;
    this.powerKW = (mechOut - recovered) / 1000;
    const dist = vAbs * dt;
    this.odometer += dist;
    if (dist > 0) {
      const inst = wh / (dist / 1000);
      this.recentWhPerKm += (Math.max(60, Math.min(3000, inst)) - this.recentWhPerKm) * Math.min(1, dist / 2000);
    }
  }

  /** Longitudinal motor/brake/regen forces shared by ground and rail driving. */
  driveForces(dt, input, vAbs, tractionCap) {
    const m = this.mass;
    const throttle = input.throttle;
    const brake = input.brake;
    const fwd = this.gear === 'R' ? -1 : 1;

    if (vAbs < 0.3 && this.gear === 'D' && brake > 0.5 && throttle > 0.9) {
      this.launchArmed = true;
    } else if (this.launchArmed && brake < 0.2) {
      if (throttle > 0.9) this.torqueRamp = 1;
      this.launchArmed = false;
    } else if (throttle < 0.9) {
      this.launchArmed = false;
    }
    if (throttle > 0.02) this.torqueRamp = Math.min(1, this.torqueRamp + dt * 2);
    else if (vAbs < 0.5) this.torqueRamp = 0.3;

    let motorF = 0;
    if (throttle > 0 && !(brake > 0.5 && vAbs < 0.3)) {
      motorF = throttle * Math.min(SPEC.maxMotorForce, SPEC.peakPower / Math.max(vAbs, 0.5)) * this.torqueRamp;
      if (this.gear === 'R') motorF = vAbs > SPEC.reverseMax ? 0 : Math.min(motorF, 6000);
    }
    const drag = 0.5 * SPEC.rho * SPEC.cdA * this.v * this.v;
    if (this.gear === 'D' && this.v >= SPEC.vMax) motorF = Math.min(motorF, drag);
    let spin = 0;
    if (motorF > tractionCap) {
      spin = 1 - tractionCap / motorF;
      motorF = tractionCap;
    }
    const brakeF = Math.min(brake * SPEC.brakeG * m * G, tractionCap);
    const regenF = throttle < 0.02 && vAbs > 1 ? Math.min(SPEC.regenPower / vAbs, SPEC.regenG * m * G) : 0;
    this.braking = brake > 0.05;
    return { motorF, brakeF, regenF, drag, spin, fwd };
  }

  // ---------------------------------------------------------------- ground
  stepGround(dt, input, env) {
    const m = this.mass;
    const vAbs = Math.abs(this.v);
    const suction = this.lifting ? 0 : SPEC.fanSuction;
    const downforce = (0.5 * SPEC.rho * SPEC.clA * this.v * this.v) / (m * G);
    const loadG = 1 + suction + downforce; // normal load in multiples of weight
    const mu = SPEC.mu * env.surface.grip;

    // Steering (kinematic bicycle with grip-limited yaw)
    this.steer += (input.steer - this.steer) * Math.min(1, dt * 10);
    this.steerAngle = this.steer * this.maxSteerAngle();
    let yawDesired = (this.v * Math.tan(this.steerAngle)) / SPEC.wheelbase;
    const latCap = mu * loadG * G * SPEC.latGrip;
    let understeer = 0;
    if (vAbs > 0.5) {
      const yawCap = latCap / vAbs;
      if (Math.abs(yawDesired) > yawCap) {
        understeer = 1 - yawCap / Math.abs(yawDesired);
        yawDesired = Math.sign(yawDesired) * yawCap;
      }
    }
    this.yawRate += (yawDesired - this.yawRate) * Math.min(1, dt * 12);
    this.heading += this.yawRate * dt;
    const latAcc = this.v * this.yawRate;
    const usage = Math.min(0.95, Math.abs(latAcc) / (mu * loadG * G));
    const longCap = mu * loadG * G * m * Math.sqrt(1 - usage * usage);

    const f = this.driveForces(dt, input, vAbs, longCap);
    // On the ground the thrusters only help up to the limiter; past it they just hold speed.
    const thrustF = this.thrusting ? (this.v < SPEC.vMax ? this.trim.rearThrust : Math.min(this.trim.rearThrust, f.drag)) : 0;
    const roll = SPEC.crr * m * G * env.surface.rolling * (1 + suction * 0.3);

    // Slope under the car
    const fx = -Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    const [gx, gz] = gradient(env.ground, this.x, this.z);
    const sAlong = gx * fx + gz * fz;
    const sSide = gx * fz - gz * fx; // toward the car's left
    const slopeAcc = (-G * sAlong) / Math.sqrt(1 + sAlong * sAlong);

    const motion = vAbs > 0.05 ? Math.sign(this.v) : f.fwd;
    const resist = f.drag + roll + f.brakeF + f.regenF;
    const force = f.fwd * f.motorF + thrustF - motion * resist + m * slopeAcc;
    const prevV = this.v;
    let v = this.v + (force / m) * dt;
    const driven = f.fwd * f.motorF + thrustF;
    if (prevV !== 0 && Math.sign(v) !== Math.sign(prevV) && (driven === 0 || Math.sign(driven) !== Math.sign(v)) && Math.abs(slopeAcc) < 1) v = 0;
    if (prevV === 0 && driven === 0 && Math.abs(slopeAcc) < 1) v = 0;
    if (input.brake > 0.1 && Math.abs(v) < 0.3 && driven === 0) v = 0;
    this.v = v;

    const px = this.x;
    const pz = this.z;
    this.x += fx * v * dt;
    this.z += fz * v * dt;
    this.account(dt, f.motorF, f.regenF, f.brakeF, vAbs);

    this.longAcc += ((v - prevV) / dt - this.longAcc) * Math.min(1, dt * 8);
    this.latAcc += (latAcc - this.latAcc) * Math.min(1, dt * 8);
    const lockup = input.brake > 0.9 && vAbs > 5 ? 0.35 : 0;
    this.slip = Math.min(1, Math.max(understeer * Math.min(1, vAbs / 15) * 1.4, f.spin * 2, lockup, usage > 0.85 ? (usage - 0.85) * 5 : 0));

    // --- Vertical: follow the ground, or leave it ---
    const h = env.ground(this.x, this.z);
    if (h - this.y > 0.6) {
      // Ran into something taller than a kerb: a wall or the side of a ramp.
      this.x = px;
      this.z = pz;
      const hit = Math.abs(this.v);
      this.v = -this.v * 0.15;
      this.emit('bump', { speed: hit });
      if (hit > 14) this.crash('wall');
      return;
    }
    const liftAcc = this.lifting ? this.trim.lift * G : 0;
    const stick = G * (1 + suction);
    const yBall = this.y + this.vy * dt + 0.5 * (liftAcc - stick) * dt * dt;
    if (yBall > h + 0.04 || (liftAcc > stick && this.lifting)) {
      this.takeOff(Math.max(yBall, h + 0.01), liftAcc, dt);
      return;
    }
    this.vy = (h - this.y) / dt;
    this.y = h;
    this.pitch = Math.atan(sAlong);
    this.roll = -Math.atan(sSide);
    this.q = qFromEuler(this.heading, this.pitch, this.roll);

    // Curved ramps: hand over to rail mode when driving onto one.
    for (const rail of env.rails ?? []) {
      if (this.tryEnterRail(rail)) return;
    }

    this.safeTimer += dt;
    if (this.safeTimer > 0.5 && Math.abs(this.pitch) < 0.05 && Math.abs(this.roll) < 0.05) {
      this.safeTimer = 0;
      this.safe = { x: this.x, z: this.z, heading: this.heading, y: this.y };
    }
  }

  takeOff(y, liftAcc, dt, from = null) {
    const f = this.forward3();
    this.mode = 'air';
    this.y = y;
    this.vel = [f[0] * this.v, f[1] * this.v, f[2] * this.v];
    // On the ground vy tracks the surface; carry it if it's larger (ramp lips).
    this.vel[1] = Math.max(this.vel[1], this.vy) + (liftAcc - G) * dt;
    this.omega = [0, 0, 0];
    this.air = {
      t: 0,
      x0: this.x,
      z0: this.z,
      maxH: this.y,
      rot: [0, 0, 0],
      liftTime: 0,
      from,
      startY: this.y,
    };
    this.emit('takeoff', { from });
  }

  // ---------------------------------------------------------------- rails (curved ramps)
  tryEnterRail(rail) {
    if (this.v < 1 || this.gear !== 'D') return false;
    const dx = this.x - rail.x;
    const dz = this.z - rail.z;
    const along = dx * rail.dx + dz * rail.dz;
    const lat = dx * rail.rx + dz * rail.rz;
    if (along < -0.2 || along > 1.5 || Math.abs(lat) > rail.width / 2 - 0.8) return false;
    if (Math.abs(wrapAngle(this.heading - rail.yaw)) > 0.6) return false;
    this.mode = 'rail';
    this.rail = { def: rail, s: Math.max(0, along), lat };
    this.yawRate = 0;
    this.emit('railEnter', { id: rail.id });
    return true;
  }

  railPose(def, s, lat) {
    const R = def.radius;
    const phi = s / R;
    const shift = def.helix ? (def.helix * phi) / def.sweep : 0;
    const fwd = R * Math.sin(phi);
    const up = R * (1 - Math.cos(phi));
    return {
      phi,
      x: def.x + def.dx * fwd + def.rx * (lat + shift),
      y: def.y0 + up,
      z: def.z + def.dz * fwd + def.rz * (lat + shift),
      // Unit tangent of travel
      t: [def.dx * Math.cos(phi), Math.sin(phi), def.dz * Math.cos(phi)],
    };
  }

  stepRail(dt, input) {
    const def = this.rail.def;
    const m = this.mass;
    const R = def.radius;
    const phi = this.rail.s / R;
    const vAbs = Math.abs(this.v);
    const suction = SPEC.fanSuction;
    // Normal load per unit mass: centripetal + gravity component + suction fans.
    const nAcc = (this.v * this.v) / R + G * Math.cos(phi) + suction * G;
    this.steer += (input.steer - this.steer) * Math.min(1, dt * 10);
    this.steerAngle = this.steer * this.maxSteerAngle();
    if (nAcc < 0) {
      this.leaveRail(dt, 'detach');
      return;
    }
    const tractionCap = SPEC.mu * m * nAcc;
    const f = this.driveForces(dt, input, vAbs, tractionCap);
    const thrustF = this.thrusting ? this.trim.rearThrust : 0;
    const motion = vAbs > 0.05 ? Math.sign(this.v) : 1;
    const force = f.fwd * f.motorF + thrustF - motion * (f.drag + f.brakeF + f.regenF) - m * G * Math.sin(phi);
    const prevV = this.v;
    this.v += (force / m) * dt;
    this.rail.s += this.v * dt;
    this.account(dt, f.motorF, f.regenF, f.brakeF, vAbs);
    this.longAcc += ((this.v - prevV) / dt - this.longAcc) * Math.min(1, dt * 8);
    this.latAcc *= 0.9;
    this.slip = f.spin;

    const L = R * def.sweep;
    if (this.rail.s >= L) {
      if (def.sweep >= Math.PI * 2 - 1e-3) {
        // Completed a loop: back on the ground, carrying on.
        const p = this.railPose(def, L, this.rail.lat);
        this.mode = 'ground';
        this.x = p.x;
        this.z = p.z;
        this.y = def.y0;
        this.vy = 0;
        this.heading = def.yaw;
        this.q = qFromEuler(this.heading, 0, 0);
        this.emit('railComplete', { id: def.id });
        this.rail = null;
        return;
      }
      this.rail.s = L;
      this.leaveRail(dt, 'exit');
      return;
    }
    if (this.rail.s <= 0 && this.v < 0) {
      const p = this.railPose(def, 0, this.rail.lat);
      this.mode = 'ground';
      this.x = p.x;
      this.z = p.z;
      this.y = def.y0;
      this.vy = 0;
      this.heading = def.yaw;
      this.q = qFromEuler(this.heading, 0, 0);
      this.rail = null;
      return;
    }
    const p = this.railPose(def, this.rail.s, this.rail.lat);
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;
    this.heading = def.yaw;
    this.pitch = p.phi;
    this.roll = 0;
    this.q = qFromEuler(def.yaw, p.phi, 0);
  }

  leaveRail(dt, why) {
    const def = this.rail.def;
    const p = this.railPose(def, this.rail.s, this.rail.lat);
    this.q = qFromEuler(def.yaw, p.phi, 0);
    this.mode = 'air';
    this.vel = [p.t[0] * this.v, p.t[1] * this.v, p.t[2] * this.v];
    this.omega = [0, 0, 0];
    this.air = { t: 0, x0: this.x, z0: this.z, maxH: this.y, rot: [0, 0, 0], liftTime: 0, from: def.id, startY: this.y };
    this.rail = null;
    this.emit('takeoff', { from: def.id, why });
  }

  // ---------------------------------------------------------------- air
  stepAir(dt, input, env) {
    const m = this.mass;
    const t = this.trim;
    const f3 = this.forward3();
    const u3 = this.up3();
    const vel = this.vel;
    const sp = Math.hypot(vel[0], vel[1], vel[2]);
    const dragK = (0.5 * SPEC.rho * (SPEC.cdA + 0.25) * sp) / m;
    const acc = [-vel[0] * dragK, -G - vel[1] * dragK, -vel[2] * dragK];
    if (this.thrusting) for (let i = 0; i < 3; i++) acc[i] += (f3[i] * t.rearThrust) / m;
    // Lift jets only push while they point at the ground; inverted, the RCS rights the car first.
    const liftK = this.lifting ? Math.max(0, Math.min(1, (u3[1] - 0.2) / 0.5)) : 0;
    for (let i = 0; i < 3; i++) acc[i] += u3[i] * t.lift * G * liftK;
    for (let i = 0; i < 3; i++) vel[i] += acc[i] * dt;
    this.x += vel[0] * dt;
    this.y += vel[1] * dt;
    this.z += vel[2] * dt;

    // --- Attitude: RCS thrusters (Rocket) or just wheel inertia (others) ---
    const pitchIn = input.brake - input.throttle; // S = nose up (backflip), W = nose down
    const yawIn = input.steer;
    const rollIn = input.roll || 0;
    this.rcsInput = [pitchIn, yawIn, rollIn];
    const needsGas = t.gas > 0;
    const active = Math.abs(pitchIn) + Math.abs(yawIn) + Math.abs(rollIn) > 0.05;
    const auth = needsGas && this.gas <= 0 ? 0.5 : t.rcs;
    if (needsGas && active && t.key === 'rocket') this.useGas(SPEC.gasUse.rcs * dt);
    const om = this.omega;
    const ins = [pitchIn, yawIn, -rollIn];
    for (let i = 0; i < 3; i++) {
      om[i] += ins[i] * auth * dt;
      // Rate damping: strong on the Rocket's stability assist, light otherwise.
      if (Math.abs(ins[i]) < 0.05) om[i] -= om[i] * Math.min(1, dt * (t.key === 'rocket' ? 4 : 0.15));
      om[i] = Math.max(-8, Math.min(8, om[i]));
    }
    // Drone-style auto-level while hovering on the lift thrusters.
    if (t.key === 'rocket' && this.lifting && Math.abs(pitchIn) < 0.05 && Math.abs(rollIn) < 0.05) {
      const w = cross(u3, [0, 1, 0]); // world-frame correction axis
      const b = qRotate(qConj(this.q), w);
      om[0] += b[0] * 14 * dt;
      om[2] += b[2] * 14 * dt;
    }
    this.q = qNormalize(qMul(this.q, qFromRotVec(om[0] * dt, om[1] * dt, om[2] * dt)));
    const a = this.air;
    a.t += dt;
    a.maxH = Math.max(a.maxH, this.y);
    for (let i = 0; i < 3; i++) a.rot[i] += om[i] * dt;
    if (this.lifting) a.liftTime += dt;

    const nf = this.forward3();
    const hl = Math.hypot(nf[0], nf[2]);
    if (hl > 0.2) this.heading = Math.atan2(-nf[0], -nf[2]);
    this.v = vel[0] * -Math.sin(this.heading) + vel[2] * -Math.cos(this.heading);
    this.longAcc *= 0.9;
    this.latAcc *= 0.9;
    this.slip = 0;
    this.steer += (input.steer - this.steer) * Math.min(1, dt * 10);
    this.steerAngle = 0;
    this.account(dt, 0, 0, 0, 0);
    this.powerKW = 0;

    this.checkContact(env);
  }

  checkContact(env) {
    let wheelDepth = -Infinity;
    let bodyDepth = -Infinity;
    for (const p of WHEEL_PROBES) {
      const w = qRotate(this.q, p);
      wheelDepth = Math.max(wheelDepth, env.ground(this.x + w[0], this.z + w[2]) - (this.y + w[1]));
    }
    for (const p of BODY_PROBES) {
      const w = qRotate(this.q, p);
      bodyDepth = Math.max(bodyDepth, env.ground(this.x + w[0], this.z + w[2]) - (this.y + w[1]));
    }
    if (wheelDepth <= 0 && bodyDepth <= 0) return;

    const [gx, gz] = gradient(env.ground, this.x, this.z);
    const nl = Math.hypot(gx, 1, gz);
    const n = [-gx / nl, 1 / nl, -gz / nl];
    const up = this.up3();
    const upright = dot(up, n);
    const impact = -dot(this.vel, n);
    const a = this.air;

    if (Math.max(wheelDepth, bodyDepth) > 1.2) return this.crash('side'); // flew into the side of something
    if (bodyDepth > 0 && upright < 0.7) return this.crash(upright < 0 ? 'roof' : 'tumble');
    if (upright < 0.7) return this.crash('tumble');
    if (impact > 16) return this.crash('hard');

    // Landed on the wheels.
    const h = env.ground(this.x, this.z);
    const fx = -Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    this.mode = 'ground';
    this.y = h;
    this.vy = 0;
    this.v = this.vel[0] * fx + this.vel[2] * fz;
    this.gear = this.v < -1 ? 'R' : 'D';
    this.yawRate = 0;
    this.omega = [0, 0, 0];
    const turns = (r) => Math.floor((Math.abs(r) + 0.7) / (Math.PI * 2));
    const perfect = upright > 0.97 && impact < 6;
    this.emit('land', {
      airtime: a?.t ?? 0,
      dist: a ? Math.hypot(this.x - a.x0, this.z - a.z0) : 0,
      height: a ? a.maxH - Math.min(a.startY, h) : 0,
      flips: a ? turns(a.rot[0]) : 0,
      spins: a ? turns(a.rot[1]) : 0,
      rolls: a ? turns(a.rot[2]) : 0,
      liftTime: a?.liftTime ?? 0,
      from: a?.from ?? null,
      impact,
      perfect,
      x: this.x,
      z: this.z,
      y: h,
    });
    this.air = null;
  }

  crash(reason) {
    if (this.mode !== 'air') {
      const f = this.forward3();
      this.vel = [f[0] * this.v, f[1] * this.v, f[2] * this.v];
    }
    this.mode = 'crashed';
    this.crashTimer = 0;
    this.emit('crash', { reason, speed: this.speed, air: this.air });
    this.air = null;
    this.rail = null;
  }

  stepCrashed(dt, env) {
    this.crashTimer += dt;
    // Skid and settle where it fell.
    const k = Math.min(1, dt * 2.5);
    for (let i = 0; i < 3; i++) this.vel[i] -= this.vel[i] * k;
    this.v -= this.v * k;
    const h = env.ground(this.x, this.z);
    this.x += this.vel[0] * dt;
    this.z += this.vel[2] * dt;
    this.y = Math.max(h, this.y + this.vel[1] * dt - G * dt * dt);
    for (let i = 0; i < 3; i++) this.omega[i] *= 1 - k;
    this.q = qNormalize(qMul(this.q, qFromRotVec(this.omega[0] * dt, this.omega[1] * dt, this.omega[2] * dt)));
    this.powerKW = 0;
    this.thrusting = this.lifting = false;
  }

  /** Put the car back on its wheels at the last safe spot (or a given pose). */
  respawn(pose = this.safe) {
    this.reset(pose.x, pose.z, pose.heading, pose.y ?? 0, false);
    this.emit('respawn');
  }

  get batteryPct() {
    return (this.batteryWh / SPEC.batteryWh) * 100;
  }

  get gasPct() {
    return this.trim.gas ? (this.gas / this.trim.gas) * 100 : 0;
  }

  get rangeKm() {
    const rated = SPEC.batteryWh / SPEC.ratedRangeKm;
    const whPerKm = 0.3 * this.recentWhPerKm + 0.7 * rated;
    return this.batteryWh / whPerKm;
  }
}

/**
 * Ground slope (dh/dx, dh/dz). Uses the gentler of the two one-sided differences on
 * each axis, so a ramp's lip or a platform edge doesn't read as a cliff under the car.
 */
export function gradient(ground, x, z, e = 0.25) {
  const h = ground(x, z);
  const pick = (a, b) => (Math.abs(a) < Math.abs(b) ? a : b);
  return [pick((ground(x + e, z) - h) / e, (h - ground(x - e, z)) / e), pick((ground(x, z + e) - h) / e, (h - ground(x, z - e)) / e)];
}
