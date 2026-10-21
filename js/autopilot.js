// Driving AI used for the menu attract loop and the "autopilot" ride-along.
import { G, SPEC } from './car.js';

export class Autopilot {
  constructor() {
    this.enabled = false;
    this.lane = 0;
    this.caution = 0.82; // fraction of the grip limit used in corners
    this.maxSpeed = Infinity;
  }

  /**
   * @param {import('./car.js').CarPhysics} car
   * @param {import('./track.js').Track} track
   * @param {{s:number}} near nearest-point query for the car
   */
  compute(car, track, near) {
    const v = Math.max(0, car.v);
    const look = 8 + v * 0.42;
    const p = track.sample(near.s + look, this.lane);
    const dx = p.x - car.x;
    const dz = p.z - car.z;
    const fx = -Math.sin(car.heading);
    const fz = -Math.cos(car.heading);
    const lx = fz;
    const lz = -fx;
    const alpha = Math.atan2(dx * lx + dz * lz, dx * fx + dz * fz);
    const delta = Math.atan((2 * SPEC.wheelbase * Math.sin(alpha)) / look);
    const steer = Math.max(-1, Math.min(1, delta / Math.max(car.maxSteerAngle(), 1e-3)));

    // Target speed: corner limits ahead, back-propagated with a braking budget.
    const latLimit = SPEC.mu * SPEC.latGrip * G * this.caution;
    const decel = SPEC.brakeG * G * 0.7;
    const horizon = (v * v) / (2 * decel) + 60;
    let vt = Math.min(SPEC.vMax, this.maxSpeed);
    for (let d = 0; d < horizon; d += 6) {
      const k = Math.abs(track.curvAt(near.s + d));
      if (k > 1e-5) vt = Math.min(vt, Math.sqrt(latLimit / k + 2 * decel * d));
    }
    if (!track.closed) {
      const remaining = track.length - 60 - near.s;
      vt = Math.min(vt, Math.sqrt(2 * decel * Math.max(0, remaining)));
    }

    const throttle = Math.max(0, Math.min(1, (vt - v) / 2.5));
    const brake = Math.max(0, Math.min(1, (v - vt) / 3));
    return { throttle, brake: v - vt > 0.4 ? brake : 0, steer, boost: false };
  }
}
