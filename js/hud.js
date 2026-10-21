// Heads-up display: speed, gear, power, battery, g-meter, minimap, banners.
import { G } from './car.js';
import { speedValue } from './format.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      mode: $('hud-mode'),
      lines: $('hud-lines'),
      speed: $('speed'),
      units: $('units'),
      gear: $('gear'),
      powerPos: $('power-pos'),
      powerNeg: $('power-neg'),
      powerLabel: $('power-label'),
      battFill: $('batt-fill'),
      battPct: $('batt-pct'),
      range: $('range'),
      thrust: $('thrust'),
      thrustFill: $('thrust-fill'),
      banner: $('banner'),
      toast: $('toast'),
      ap: $('ap'),
      tree: $('tree'),
      launch: $('launch'),
    };
    this.g = $('gmeter').getContext('2d');
    this.map = $('minimap');
    this.mctx = this.map.getContext('2d');
    this.trail = [];
    this.bannerTimer = 0;
    this.toastTimer = 0;
    this.linesKey = '';
  }

  show(on) {
    this.root.hidden = !on;
  }

  setMode(title, { thrusters, tree, map }) {
    this.el.mode.textContent = title;
    this.el.thrust.hidden = !thrusters;
    this.el.tree.hidden = !tree;
    this.map.hidden = !map;
    this.el.banner.className = '';
    this.el.banner.textContent = '';
    this.trail.length = 0;
  }

  banner(text, ms = 1500, cls = '') {
    const b = this.el.banner;
    b.textContent = text;
    b.className = `show ${cls}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => (b.className = cls), ms);
  }

  toast(text) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 1300);
  }

  setTree(L) {
    for (const node of this.el.tree.querySelectorAll('[data-light]')) node.classList.toggle('on', !!L[node.dataset.light]);
  }

  setLines(lines) {
    const key = lines.map((l) => l.join('|')).join('/');
    if (key === this.linesKey) return;
    this.linesKey = key;
    this.el.lines.replaceChildren(
      ...lines.map(([k, v, cls]) => {
        const row = document.createElement('div');
        row.className = `row ${cls || ''}`;
        const a = document.createElement('span');
        a.textContent = k;
        const b = document.createElement('b');
        b.textContent = v;
        row.append(a, b);
        return row;
      }),
    );
  }

  setTrack(track) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < track.n; i++) {
      minX = Math.min(minX, track.x[i]);
      maxX = Math.max(maxX, track.x[i]);
      minZ = Math.min(minZ, track.z[i]);
      maxZ = Math.max(maxZ, track.z[i]);
    }
    const size = this.map.width;
    const pad = 10;
    const scale = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    this.mapTf = (x, z) => [pad + (x - minX) * scale + (size - pad * 2 - (maxX - minX) * scale) / 2, pad + (z - minZ) * scale + (size - pad * 2 - (maxZ - minZ) * scale) / 2];
    // Pre-render the track outline.
    const off = document.createElement('canvas');
    off.width = off.height = size;
    const c = off.getContext('2d');
    c.strokeStyle = 'rgba(255,255,255,0.75)';
    c.lineWidth = 3;
    c.lineJoin = 'round';
    c.beginPath();
    for (let i = 0; i < track.n; i += 4) {
      const [px, py] = this.mapTf(track.x[i], track.z[i]);
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
    c.stroke();
    const [sx, sy] = this.mapTf(track.x[0], track.z[0]);
    c.fillStyle = '#fff';
    c.fillRect(sx - 4, sy - 1.5, 8, 3);
    this.mapBg = off;
  }

  update(car, { units, autopilot, launchArmed }) {
    const e = this.el;
    e.speed.textContent = Math.round(speedValue(car.v, units));
    e.units.textContent = units === 'mph' ? 'MPH' : 'KM/H';
    for (const span of e.gear.children) span.classList.toggle('on', span.textContent === car.gear);

    const kw = car.powerKW;
    const maxKw = 750;
    const maxRegen = 250;
    e.powerPos.style.width = `${Math.min(100, (Math.max(0, kw) / maxKw) * 100)}%`;
    e.powerNeg.style.width = `${Math.min(100, (Math.max(0, -kw) / maxRegen) * 100)}%`;
    e.powerLabel.textContent = `${Math.round(kw)} kW`;

    const pct = car.batteryPct;
    e.battFill.style.width = `${pct}%`;
    e.battFill.classList.toggle('low', pct < 15);
    e.battPct.textContent = `${Math.round(pct)}%`;
    const r = units === 'mph' ? car.rangeKm / 1.609344 : car.rangeKm;
    e.range.textContent = `${Math.round(r)} ${units === 'mph' ? 'mi' : 'km'}`;

    if (!e.thrust.hidden) {
      e.thrustFill.style.height = `${(car.thrustFuel / 4) * 100}%`;
      e.thrust.classList.toggle('firing', car.thrusting);
    }
    e.ap.classList.toggle('on', autopilot);
    e.launch.classList.toggle('on', launchArmed);

    this.drawG(car.longAcc / G, car.latAcc / G);
  }

  drawG(lon, lat) {
    const c = this.g;
    const s = c.canvas.width;
    const r = s / 2 - 6;
    const cx = s / 2;
    const cy = s / 2;
    c.clearRect(0, 0, s, s);
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.lineWidth = 1;
    for (const k of [0.5, 1, 1.5]) {
      c.beginPath();
      c.arc(cx, cy, (r * k) / 1.5, 0, Math.PI * 2);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(cx - r, cy);
    c.lineTo(cx + r, cy);
    c.moveTo(cx, cy - r);
    c.lineTo(cx, cy + r);
    c.stroke();
    // Acceleration pushes you back into the seat: draw it like a G-meter does (dot moves opposite).
    const x = cx - (Math.max(-1.5, Math.min(1.5, lat)) / 1.5) * r;
    const y = cy + (Math.max(-1.5, Math.min(1.5, lon)) / 1.5) * r;
    this.trail.push([x, y]);
    if (this.trail.length > 40) this.trail.shift();
    c.strokeStyle = 'rgba(62,140,255,0.6)';
    c.lineWidth = 2;
    c.beginPath();
    this.trail.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
    c.stroke();
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(x, y, 5, 0, Math.PI * 2);
    c.fill();
    const total = Math.hypot(lon, lat);
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.font = '600 12px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText(`${total.toFixed(2)} g`, cx, s - 2);
  }

  drawMap(car) {
    if (this.map.hidden || !this.mapBg) return;
    const c = this.mctx;
    const s = this.map.width;
    c.clearRect(0, 0, s, s);
    c.drawImage(this.mapBg, 0, 0);
    const [x, y] = this.mapTf(car.x, car.z);
    c.save();
    c.translate(x, y);
    c.rotate(-car.heading);
    c.fillStyle = '#e8212e';
    c.strokeStyle = '#fff';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -7);
    c.lineTo(5, 5);
    c.lineTo(-5, 5);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }
}
