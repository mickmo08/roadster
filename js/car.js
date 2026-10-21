// Vehicle dynamics for the Roadster.
//
// Numbers are based on the publicly announced targets from the 2017 reveal
// (0–60 mph in 1.9 s, ¼ mile in 8.8 s, 250+ mph, 620 mi range, 10,000 Nm
// wheel torque, 200 kWh pack). Mass, drag and power are estimates tuned so the
// simulation lands on those targets.

export const G = 9.81;
export const MPH = 0.44704; // m/s per mph

export const SPEC = {
  mass: 1950, // kg (estimate)
  wheelbase: 2.6, // m
  tireRadius: 0.35, // m
  wheelTorque: 10000, // Nm at the wheels (announced)
  peakPower: 750e3, // W (estimate, tuned for the ¼ mile target)
  mu: 1.45, // longitudinal tyre grip on prepped tarmac
  latGrip: 0.8, // fraction of mu available for cornering (~1.2 g)
  cdA: 0.52, // m² drag area (estimate)
  rho: 1.225, // kg/m³ air density
  crr: 0.011, // rolling resistance
  vMax: 250 * MPH, // electronic limiter
  reverseMax: 12, // m/s
  brakeG: 1.3,
  regenG: 0.18, // one-pedal lift-off deceleration
  regenPower: 250e3, // W
  batteryWh: 200000,
  auxPower: 1200, // W (HVAC, electronics)
  driveEff: 0.92,
  regenEff: 0.75,
  maxSteer: 0.55, // rad at the front wheels, standstill
  steerSpeedFactor: 300, // larger = less steering reduction with speed
  thrustForce: 20000, // N, rumored cold-gas thruster option
  thrustCapacity: 4, // seconds of thrust per full tank
  thrustRecharge: 0.2, // seconds of thrust regained per second
};

SPEC.maxMotorForce = SPEC.wheelTorque / SPEC.tireRadius;

export class CarPhysics {
  constructor({ thrusterPack = false } = {}) {
    this.thrusterPack = thrusterPack;
    this.reset(0, 0, 0);
  }

  reset(x, z, heading) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.v = 0; // signed speed along heading, m/s
    this.steer = 0; // smoothed steering input
    this.steerAngle = 0; // front-wheel angle, rad
    this.yawRate = 0;
    this.longAcc = 0;
    this.latAcc = 0;
    this.gear = 'D';
    this.batteryWh = SPEC.batteryWh * 0.9;
    this.energyUsedWh = 0;
    this.odometer = 0;
    this.thrustFuel = SPEC.thrustCapacity;
    this.thrusting = false;
    this.torqueRamp = 0.3;
    this.launchArmed = false;
    this.powerKW = 0;
    this.slip = 0; // 0..1, drives tyre squeal
    this.braking = false;
    this.wheelSpin = 0; // accumulated wheel rotation, rad
    this.recentWhPerKm = 125;
  }

  maxSteerAngle() {
    const v = Math.abs(this.v);
    return SPEC.maxSteer / (1 + (v * v) / SPEC.steerSpeedFactor);
  }

  setGear(gear) {
    if (Math.abs(this.v) < 1) this.gear = gear;
    return this.gear === gear;
  }

  /**
   * @param {number} dt seconds
   * @param {{throttle:number, brake:number, steer:number, boost:boolean}} input
   * @param {{grip:number, rolling:number}} surface
   */
  step(dt, input, surface) {
    const m = SPEC.mass;
    const mu = SPEC.mu * surface.grip;
    const vAbs = Math.abs(this.v);
    const fwd = this.gear === 'R' ? -1 : 1;
    const throttle = this.batteryWh > 0 ? input.throttle : 0;
    const brake = input.brake;

    // --- Steering & yaw (kinematic bicycle with a grip-limited yaw rate) ---
    this.steer += (input.steer - this.steer) * Math.min(1, dt * 10);
    this.steerAngle = this.steer * this.maxSteerAngle();
    let yawDesired = (this.v * Math.tan(this.steerAngle)) / SPEC.wheelbase;
    const latCap = mu * G * SPEC.latGrip;
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

    // Friction circle: cornering eats into the grip available for accel/brake.
    const usage = Math.min(0.95, Math.abs(latAcc) / (mu * G));
    const longCap = mu * G * m * Math.sqrt(1 - usage * usage);

    // --- Launch mode: brake + full throttle at standstill pre-loads torque ---
    if (vAbs < 0.3 && this.gear === 'D' && brake > 0.5 && throttle > 0.9) {
      this.launchArmed = true;
    } else if (this.launchArmed && brake < 0.2) {
      if (throttle > 0.9) this.torqueRamp = 1;
      this.launchArmed = false;
    } else if (throttle < 0.9) {
      this.launchArmed = false;
    }

    // Without launch mode, torque ramps in over ~0.35 s from a standstill.
    if (throttle > 0.02) this.torqueRamp = Math.min(1, this.torqueRamp + dt * 2);
    else if (vAbs < 0.5) this.torqueRamp = 0.3;

    // --- Motor ---
    let motorF = 0;
    if (throttle > 0 && !(brake > 0.5 && vAbs < 0.3)) {
      const powerLimited = SPEC.peakPower / Math.max(vAbs, 0.5);
      motorF = throttle * Math.min(SPEC.maxMotorForce, powerLimited) * this.torqueRamp;
      if (this.gear === 'R') motorF = vAbs > SPEC.reverseMax ? 0 : Math.min(motorF, 6000);
    }

    const drag = 0.5 * SPEC.rho * SPEC.cdA * this.v * this.v;
    const roll = SPEC.crr * m * G * surface.rolling;

    if (this.gear === 'D' && this.v >= SPEC.vMax) motorF = Math.min(motorF, drag + roll);

    let spin = 0;
    if (motorF > longCap) {
      spin = 1 - longCap / motorF;
      motorF = longCap; // traction control holds the tyres at the limit
    }

    // --- Thrusters (not traction-limited) ---
    let thrustF = 0;
    this.thrusting = false;
    if (this.thrusterPack && input.boost && this.thrustFuel > 0 && this.gear === 'D') {
      thrustF = SPEC.thrustForce;
      this.thrustFuel = Math.max(0, this.thrustFuel - dt);
      this.thrusting = true;
    } else if (!input.boost) {
      this.thrustFuel = Math.min(SPEC.thrustCapacity, this.thrustFuel + dt * SPEC.thrustRecharge);
    }

    // --- Brakes & regen ---
    let brakeF = Math.min(brake * SPEC.brakeG * m * G, longCap);
    let regenF = 0;
    if (throttle < 0.02 && vAbs > 1) {
      regenF = Math.min(SPEC.regenPower / vAbs, SPEC.regenG * m * G);
    }
    this.braking = brake > 0.05;

    // --- Integrate ---
    const motion = vAbs > 0.05 ? Math.sign(this.v) : fwd;
    const resist = drag + roll + brakeF + regenF;
    const force = fwd * motorF + thrustF - motion * resist;
    const prevV = this.v;
    let v = this.v + (force / m) * dt;
    // Resistive forces can stop the car but never push it backwards.
    if (Math.sign(v) !== Math.sign(prevV) && prevV !== 0) {
      const driven = fwd * motorF + thrustF;
      if (Math.sign(driven) !== Math.sign(v) || driven === 0) v = 0;
    }
    if (prevV === 0 && Math.abs(fwd * motorF + thrustF) <= resist && motorF === 0 && thrustF === 0) v = 0;
    if (brake > 0.1 && Math.abs(v) < 0.3 && motorF === 0 && thrustF === 0) v = 0;
    this.v = v;

    const fx = -Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    this.x += fx * this.v * dt;
    this.z += fz * this.v * dt;
    const dist = Math.abs(this.v) * dt;
    this.odometer += dist;
    this.wheelSpin += (this.v / SPEC.tireRadius) * dt * (1 + spin * 0.6);

    // --- Energy ---
    const mechOut = motorF * Math.abs(this.v);
    const recovered = Math.min(SPEC.regenPower, (regenF + Math.min(brakeF, regenF > 0 ? 0 : brakeF * 0.5)) * vAbs);
    const elec = mechOut / SPEC.driveEff + SPEC.auxPower - recovered * SPEC.regenEff;
    const wh = (elec * dt) / 3600;
    this.batteryWh = Math.max(0, Math.min(SPEC.batteryWh, this.batteryWh - wh));
    this.energyUsedWh += wh;
    this.powerKW = (mechOut - recovered) / 1000;
    if (dist > 0) {
      const inst = wh / (dist / 1000);
      const k = Math.min(1, dist / 2000);
      this.recentWhPerKm += (Math.max(40, Math.min(2000, inst)) - this.recentWhPerKm) * k;
    }

    this.longAcc += ((v - prevV) / dt - this.longAcc) * Math.min(1, dt * 8);
    this.latAcc += (latAcc - this.latAcc) * Math.min(1, dt * 8);
    const lockup = brake > 0.9 && vAbs > 5 ? 0.35 : 0;
    this.slip = Math.min(1, Math.max(understeer * Math.min(1, vAbs / 15) * 1.4, spin * 2, lockup, usage > 0.85 ? (usage - 0.85) * 5 : 0));
  }

  get batteryPct() {
    return (this.batteryWh / SPEC.batteryWh) * 100;
  }

  get rangeKm() {
    // Blend live consumption with the rated figure so the number stays calm.
    const rated = SPEC.batteryWh / (620 * 1.609344);
    const whPerKm = 0.3 * this.recentWhPerKm + 0.7 * rated;
    return this.batteryWh / whPerKm;
  }
}
