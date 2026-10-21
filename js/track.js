// Track centerlines: sampled polylines with arc length, tangents and curvature.

export class Track {
  /**
   * @param {{x:number, z:number}[]} points
   * @param {{closed?:boolean, width?:number}} opts
   */
  constructor(points, { closed = false, width = 12 } = {}) {
    const n = points.length;
    this.n = n;
    this.closed = closed;
    this.width = width;
    this.x = new Float64Array(n);
    this.z = new Float64Array(n);
    this.s = new Float64Array(n);
    this.tx = new Float64Array(n);
    this.tz = new Float64Array(n);
    this.curv = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      this.x[i] = points[i].x;
      this.z[i] = points[i].z;
    }
    for (let i = 1; i < n; i++) {
      this.s[i] = this.s[i - 1] + Math.hypot(this.x[i] - this.x[i - 1], this.z[i] - this.z[i - 1]);
    }
    this.length = closed
      ? this.s[n - 1] + Math.hypot(this.x[0] - this.x[n - 1], this.z[0] - this.z[n - 1])
      : this.s[n - 1];

    for (let i = 0; i < n; i++) {
      const a = this.idx(i - 1);
      const b = this.idx(i + 1);
      const dx = this.x[b] - this.x[a];
      const dz = this.z[b] - this.z[a];
      const len = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / len;
      this.tz[i] = dz / len;
    }

    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.idx(i - 1);
      const b = this.idx(i + 1);
      const ha = Math.atan2(this.tx[a], this.tz[a]);
      const hb = Math.atan2(this.tx[b], this.tz[b]);
      let dh = hb - ha;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const ds = this.ds(a, b) || 1;
      raw[i] = dh / ds; // positive = turning left
    }
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -4; k <= 4; k++) sum += raw[this.idx(i + k)];
      this.curv[i] = sum / 9;
    }
  }

  idx(i) {
    if (this.closed) return ((i % this.n) + this.n) % this.n;
    return Math.max(0, Math.min(this.n - 1, i));
  }

  ds(a, b) {
    let d = this.s[b] - this.s[a];
    if (this.closed && d < 0) d += this.length;
    return d;
  }

  wrapS(s) {
    if (!this.closed) return Math.max(0, Math.min(this.length, s));
    return ((s % this.length) + this.length) % this.length;
  }

  headingAt(i) {
    return Math.atan2(-this.tx[i], -this.tz[i]);
  }

  indexAtS(s) {
    s = this.wrapS(s);
    let lo = 0;
    let hi = this.n - 1;
    if (s >= this.s[hi]) return hi;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.s[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Position, tangent and left-normal at arc length s, offset laterally. */
  sample(s, lateral = 0) {
    s = this.wrapS(s);
    const i = this.indexAtS(s);
    const j = this.idx(i + 1);
    const segLen = this.ds(i, j) || 1;
    const t = Math.max(0, Math.min(1, (s - this.s[i]) / segLen));
    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t;
    const tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const tl = Math.hypot(tx, tz) || 1;
    const ux = tx / tl;
    const uz = tz / tl;
    // Left of the direction of travel (y up).
    const lx = uz;
    const lz = -ux;
    return {
      x: this.x[i] + (this.x[j] - this.x[i]) * t + lx * lateral,
      z: this.z[i] + (this.z[j] - this.z[i]) * t + lz * lateral,
      tx: ux,
      tz: uz,
      lx,
      lz,
      heading: Math.atan2(-ux, -uz),
      curv: this.curv[i],
    };
  }

  curvAt(s) {
    return this.curv[this.indexAtS(s)];
  }

  /** Closest point on the centerline. Pass the previous index as a hint for speed. */
  nearest(px, pz, hint = -1) {
    let best = 0;
    let bestD = Infinity;
    const scan = (i) => {
      const dx = px - this.x[i];
      const dz = pz - this.z[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    };
    if (hint < 0) {
      for (let i = 0; i < this.n; i++) scan(i);
    } else {
      for (let k = -60; k <= 60; k++) scan(this.idx(hint + k));
      // Lost track of the car (teleport, huge offset): fall back to a full scan.
      if (bestD > 150 * 150) for (let i = 0; i < this.n; i++) scan(i);
    }

    // Project onto the better of the two adjacent segments.
    let res = null;
    for (const [a, b] of [
      [best, this.idx(best + 1)],
      [this.idx(best - 1), best],
    ]) {
      if (a === b) continue;
      const sx = this.x[b] - this.x[a];
      const sz = this.z[b] - this.z[a];
      const l2 = sx * sx + sz * sz || 1;
      let t = ((px - this.x[a]) * sx + (pz - this.z[a]) * sz) / l2;
      t = Math.max(0, Math.min(1, t));
      const cx = this.x[a] + sx * t;
      const cz = this.z[a] + sz * t;
      const d = (px - cx) ** 2 + (pz - cz) ** 2;
      if (!res || d < res.d) res = { a, t, cx, cz, d, segLen: Math.sqrt(l2) };
    }
    if (!res) res = { a: best, t: 0, cx: this.x[best], cz: this.z[best], d: bestD, segLen: 0 };

    const i = res.a;
    const tx = this.tx[i];
    const tz = this.tz[i];
    const lx = tz;
    const lz = -tx;
    let s = this.s[i] + res.t * res.segLen;
    if (this.closed) s = this.wrapS(s);
    // Past the ends of an open track, extend along the end tangent.
    if (!this.closed) {
      if (best === this.n - 1 || (i === this.n - 2 && res.t >= 1)) {
        s = this.length + (px - this.x[this.n - 1]) * tx + (pz - this.z[this.n - 1]) * tz;
      } else if (best === 0 && res.t <= 0) {
        s = (px - this.x[0]) * tx + (pz - this.z[0]) * tz;
      }
    }
    return {
      i: best,
      s,
      lateral: (px - res.cx) * lx + (pz - res.cz) * lz,
      tx,
      tz,
      heading: Math.atan2(-tx, -tz),
    };
  }
}

/** Straight strip heading toward -Z. s = pre is at z = 0 (the start line). */
export function makeStraight(length, pre = 60, spacing = 5) {
  const pts = [];
  const total = length + pre;
  for (let s = 0; s <= total + 0.001; s += spacing) pts.push({ x: 0, z: pre - s });
  return new Track(pts, { closed: false, width: 16 });
}

/** Island circuit (~6.7 km): fast sweepers plus a few real braking zones. */
export function makeCircuit(width = 14) {
  const pts = [];
  const N = 3200;
  for (let k = 0; k < N; k++) {
    const th = (k / N) * Math.PI * 2;
    const r =
      880 +
      280 * Math.sin(2 * th + 0.6) +
      160 * Math.sin(3 * th + 1.9) +
      80 * Math.sin(5 * th + 0.3) +
      40 * Math.sin(7 * th + 2.2) +
      18 * Math.sin(11 * th + 0.7);
    // Negative z so the circuit runs clockwise when viewed from above.
    pts.push({ x: r * Math.cos(th), z: -r * Math.sin(th) });
  }
  return new Track(pts, { closed: true, width });
}
