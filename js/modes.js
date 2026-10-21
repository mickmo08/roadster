// Game modes: drag strip, top-speed run, circuit laps and free cruise.
import { MPH } from './car.js';
import { makeCircuit, makeStraight } from './track.js';
import { fmtLap, fmtSec, fmtSpeed, fmtDist } from './format.js';

const QUARTER = 402.336;
const EIGHTH = 201.168;
const SIXTY_FT = 18.288;

/** Time at which a value crossed a threshold during the last step (linear interpolation). */
function crossTime(prev, cur, thr, t, h) {
  if (prev < thr && cur >= thr) return t - (h * (cur - thr)) / (cur - prev || 1);
  return null;
}

class BaseMode {
  constructor(game) {
    this.game = game;
    this.t = 0;
  }

  get units() {
    return this.game.settings.units;
  }

  /** 3-2-1-GO countdown; returns true once green. Call every physics step. */
  countdown(goAt = 3) {
    const step = Math.floor(this.t);
    if (this.t < goAt && step !== this.lastCount) {
      this.lastCount = step;
      if (step >= goAt - 3) {
        this.game.hud.banner(String(goAt - step), 900, 'count');
        this.game.audio.beep(660, 0.18);
      }
    }
    if (this.t >= goAt && !this.wentGreen) {
      this.wentGreen = true;
      this.game.hud.banner('GO', 900, 'go');
      this.game.audio.beep(1320, 0.4);
    }
    return this.t >= goAt;
  }

  speedSplits() {
    return this.units === 'mph' ? [60, 100, 150, 200, 250].map((x) => [x, x * MPH, `0–${x} mph`]) : [100, 200, 300, 400].map((x) => [x, x / 3.6, `0–${x} km/h`]);
  }

  controls(c) {
    return c;
  }

  aiControls(c) {
    return c;
  }

  onEndBarrier() {}

  frame() {}
}

// ---------------------------------------------------------------------------

export class DragMode extends BaseMode {
  static id = 'drag';
  title = 'Drag Strip';

  config() {
    const pre = 60;
    const track = makeStraight(1500, pre);
    track.width = 16;
    return {
      track,
      theme: 'desert',
      decor: 'drag',
      wallOffset: 9,
      startS: pre,
      finishS: pre + QUARTER,
      carS: pre - 2.3, // front bumper on the line
      carLateral: 3.6,
      aiLane: 3.6,
      tree: true,
    };
  }

  start() {
    this.t = 0;
    this.green = 3.4;
    this.moveT = null;
    this.reaction = null;
    this.foul = false;
    this.s0 = null;
    this.prevD = 0;
    this.prevV = 0;
    this.split = {};
    this.done = false;
    this.doneAt = 0;
    this.finished = false;
    this.lastLight = '';
    this.game.hud.banner('Hold BRAKE + THROTTLE for Launch Mode · release on green', 3200, 'hint');
  }

  lights() {
    const t = this.t;
    const g = this.green;
    return {
      prestage: t > 0.4,
      stage: t > 1.0,
      amber1: t >= g - 1.5 && t < g - 1.0,
      amber2: t >= g - 1.0 && t < g - 0.5,
      amber3: t >= g - 0.5 && t < g,
      green: t >= g && !this.foul,
      red: this.foul,
    };
  }

  step(h, car, near) {
    this.t += h;
    if (this.s0 === null) this.s0 = near.s;
    const d = near.s - this.s0;
    const v = car.v;

    const L = this.lights();
    const key = L.green ? 'green' : L.amber3 ? 'a3' : L.amber2 ? 'a2' : L.amber1 ? 'a1' : '';
    if (key !== this.lastLight) {
      this.lastLight = key;
      if (key === 'green') this.game.audio.beep(1320, 0.35);
      else if (key) this.game.audio.beep(740, 0.12);
    }
    this.game.world.setTree(L);
    this.game.hud.setTree(L);

    if (this.moveT === null && d > 0.02) {
      this.moveT = this.t;
      this.reaction = this.t - this.green;
      if (this.t < this.green) {
        this.foul = true;
        this.game.hud.banner('RED LIGHT', 2000, 'bad');
      }
    }
    if (this.moveT !== null && !this.done) {
      const el = this.t - this.moveT;
      for (const [label, thr] of [
        ['60ft', SIXTY_FT],
        ['eighth', EIGHTH],
        ['quarter', QUARTER],
      ]) {
        const tt = this.split[label] ?? crossTime(this.prevD, d, thr, el, h);
        if (tt !== null) this.split[label] = tt;
      }
      for (const [, thr, label] of this.allSpeedSplits()) {
        const tt = this.split[label] ?? crossTime(this.prevV, v, thr, el, h);
        if (tt !== null) this.split[label] = tt;
      }
      if (this.split.quarter !== undefined) {
        this.done = true;
        this.doneAt = this.t;
        this.trap = v;
        this.game.hud.banner(`${fmtSec(this.split.quarter)} @ ${fmtSpeed(v, this.units)}`, 2600, 'go');
      }
    }
    if (this.done && !this.finished && (this.t - this.doneAt > 2.6 || Math.abs(v) < 1)) this.finish();
    this.prevD = d;
    this.prevV = v;
  }

  allSpeedSplits() {
    return [
      [60, 60 * MPH, '0–60 mph'],
      [100, 100 * MPH, '0–100 mph'],
      [100, 100 / 3.6, '0–100 km/h'],
      [200, 200 / 3.6, '0–200 km/h'],
    ];
  }

  shownSpeedSplits() {
    return this.units === 'mph' ? ['0–60 mph', '0–100 mph'] : ['0–100 km/h', '0–200 km/h'];
  }

  aiControls(c) {
    if (this.done) return c;
    // Launch mode during the tree, release with a sharp 0.12 s reaction.
    if (this.t < this.green + 0.12) return { throttle: this.t > 1.2 ? 1 : 0, brake: 1, steer: c.steer, boost: false };
    return { throttle: 1, brake: 0, steer: c.steer, boost: this.game.car.thrusterPack };
  }

  onEndBarrier() {
    if (!this.finished) this.finish();
  }

  hudLines() {
    const s = this.split;
    const f = (x) => (x === undefined ? '—' : fmtSec(x));
    const lines = [['Reaction', this.reaction === null ? '—' : `${this.reaction >= 0 ? '' : '−'}${Math.abs(this.reaction).toFixed(3)} s`, this.foul ? 'bad' : '']];
    lines.push(['60 ft', f(s['60ft'])]);
    for (const k of this.shownSpeedSplits()) lines.push([k, f(s[k])]);
    lines.push(['⅛ mile', f(s.eighth)]);
    lines.push(['¼ mile', f(s.quarter)]);
    lines.push(['Trap', this.trap ? fmtSpeed(this.trap, this.units) : '—']);
    return lines;
  }

  finish() {
    this.finished = true;
    const s = this.split;
    const best = this.game.best;
    const ok = !this.foul && s.quarter !== undefined;
    const newEt = ok && best.check('drag_et', s.quarter, 'min');
    const new60 = ok && s['0–60 mph'] !== undefined && best.check('drag_060', s['0–60 mph'], 'min');
    const lines = this.hudLines().map(([k, v, cls]) => [k, v, cls]);
    if (newEt) lines.find((l) => l[0] === '¼ mile')[2] = 'best';
    if (new60 && this.units === 'mph') lines.find((l) => l[0] === '0–60 mph')[2] = 'best';
    const bestEt = best.get('drag_et');
    this.game.finish({
      title: this.foul ? 'Red light' : s.quarter !== undefined ? 'Run complete' : 'Run aborted',
      tone: this.foul ? 'bad' : '',
      subtitle: this.foul ? 'You left before the green. Times shown, but they don’t count.' : newEt ? 'New personal best ¼ mile!' : bestEt ? `Personal best ¼ mile: ${fmtSec(bestEt)}` : '',
      lines,
      note: 'Announced targets: 0–60 mph in 1.9 s · ¼ mile in 8.8 s. Launch Mode (brake + throttle, then release) is the difference between a good and a great run.',
    });
  }
}

// ---------------------------------------------------------------------------

export class TopSpeedMode extends BaseMode {
  static id = 'top';
  title = 'Top Speed Run';

  config() {
    const pre = 60;
    const track = makeStraight(9000, pre, 10);
    track.width = 30;
    return {
      track,
      theme: 'salt',
      decor: 'salt',
      wallOffset: 3000,
      hasWalls: false,
      startS: pre,
      carS: pre - 2.3,
      carLateral: 0,
      aiLane: 0,
    };
  }

  start() {
    this.t = 0;
    this.lastCount = -1;
    this.wentGreen = false;
    this.s0 = null;
    this.goT = null;
    this.prevV = 0;
    this.maxV = 0;
    this.split = {};
    this.finished = false;
    this.endHit = false;
    this.energy0 = this.game.car.energyUsedWh;
  }

  controls(c) {
    if (!this.wentGreen) return { ...c, brake: 1 }; // held on the line; throttle arms launch mode
    return c;
  }

  aiControls(c) {
    if (!this.wentGreen) return { throttle: this.t > 1 ? 1 : 0, brake: 1, steer: c.steer, boost: false };
    return c;
  }

  step(h, car, near) {
    this.t += h;
    if (this.s0 === null) this.s0 = near.s;
    const green = this.countdown(3);
    if (green && this.goT === null) this.goT = this.t;
    const v = car.v;
    this.dist = near.s - this.s0;
    if (this.goT !== null) {
      const el = this.t - this.goT;
      for (const [, thr, label] of this.speedSplits()) {
        if (this.split[label] === undefined) {
          const tt = crossTime(this.prevV, v, thr, el, h);
          if (tt !== null) {
            this.split[label] = tt;
            this.game.hud.banner(`${label}: ${fmtSec(tt)}`, 1400, 'split');
          }
        }
      }
      if (v > this.maxV) this.maxV = v;
      if (!this.finished && this.dist > 200 && Math.abs(v) < 0.3) this.finish();
    }
    this.prevV = v;
  }

  onEndBarrier(speed) {
    this.endHit = speed;
    if (!this.finished) this.finish();
  }

  hudLines() {
    const lines = [
      ['Top speed', fmtSpeed(this.maxV, this.units)],
      ['Distance', fmtDist(Math.max(0, this.dist || 0), this.units)],
    ];
    for (const [, , label] of this.speedSplits()) lines.push([label, this.split[label] === undefined ? '—' : fmtSec(this.split[label])]);
    return lines;
  }

  finish() {
    this.finished = true;
    const isBest = this.game.best.check('top_speed', this.maxV, 'max');
    const lines = this.hudLines();
    if (isBest) lines[0][2] = 'best';
    const used = (this.game.car.energyUsedWh - this.energy0) / 1000;
    lines.push(['Energy used', `${used.toFixed(2)} kWh`]);
    const crashed = this.endHit !== false && this.endHit > 3;
    this.game.finish({
      title: crashed ? 'Ran out of runway' : 'Run complete',
      tone: crashed ? 'bad' : '',
      subtitle: crashed ? `Hit the end barrier at ${fmtSpeed(this.endHit, this.units)}. Brake earlier!` : isBest ? 'New personal top speed!' : `Personal best: ${fmtSpeed(this.game.best.get('top_speed') ?? 0, this.units)}`,
      lines,
      note: 'Announced target: 250+ mph (400+ km/h). The car is electronically limited at 250 mph here.',
    });
  }
}

// ---------------------------------------------------------------------------

export class CircuitMode extends BaseMode {
  static id = 'circuit';

  constructor(game, laps = 3) {
    super(game);
    this.laps = laps;
    this.title = laps ? 'Coast Circuit' : 'Free Cruise';
  }

  config() {
    const track = makeCircuit(14);
    return {
      track,
      theme: 'coast',
      decor: 'coast',
      wallOffset: 22,
      startS: 0,
      carS: this.laps ? track.length - 12 : 20,
      carLateral: this.laps ? 2.5 : -3.5,
      aiLane: this.laps ? 0 : -3.5,
      aiMaxSpeed: this.laps ? Infinity : 80 * MPH, // a relaxed cruise, not a hot lap
    };
  }

  start() {
    this.t = 0;
    this.lastCount = -1;
    this.wentGreen = !this.laps;
    this.goT = this.laps ? null : 0;
    this.lastS = null;
    this.progress = this.laps ? -12 : 0;
    this.lap = 0;
    this.lapTimes = [];
    this.lapStart = 0;
    this.maxV = 0;
    this.finished = false;
    this.energy0 = this.game.car.energyUsedWh;
    this.odo0 = this.game.car.odometer;
    this.wrongWay = 0;
    if (!this.laps) this.game.hud.banner('Free Cruise · press T for Autopilot ride-along', 3000, 'hint');
  }

  controls(c) {
    if (!this.wentGreen) return { ...c, brake: 1 };
    return c;
  }

  aiControls(c) {
    if (!this.wentGreen) return { throttle: this.t > 1 ? 1 : 0, brake: 1, steer: c.steer, boost: false };
    return c;
  }

  step(h, car, near) {
    this.t += h;
    const L = this.game.track.length;
    if (this.laps) {
      const green = this.countdown(3);
      if (green && this.goT === null) {
        this.goT = this.t;
        this.lapStart = this.t;
      }
    }
    if (this.lastS !== null) {
      let ds = near.s - this.lastS;
      if (ds < -L / 2) ds += L;
      if (ds > L / 2) ds -= L;
      this.progress += ds;
    }
    this.lastS = near.s;
    if (car.v > this.maxV) this.maxV = car.v;

    // Wrong-way warning
    let dh = car.heading - near.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.wrongWay = Math.abs(dh) > 2.2 && car.v > 4 ? this.wrongWay + h : 0;

    if (this.laps && this.goT !== null && !this.finished && this.progress >= (this.lap + 1) * L) {
      const lt = this.t - this.lapStart;
      this.lapTimes.push(lt);
      this.lapStart = this.t;
      this.lap++;
      const best = Math.min(...this.lapTimes);
      const pb = this.game.best.check('circuit_lap', lt, 'min');
      if (this.lap >= this.laps) {
        this.finish();
      } else {
        this.game.hud.banner(`Lap ${this.lap}: ${fmtLap(lt)}${pb ? ' · Personal best!' : lt === best && this.lap > 1 ? ' · Fastest lap' : ''}`, 2600, pb ? 'go' : 'split');
        this.game.audio.beep(990, 0.12);
      }
    }
  }

  frame() {
    if (this.wrongWay > 1) this.game.hud.banner('WRONG WAY', 300, 'bad');
  }

  hudLines() {
    const car = this.game.car;
    const units = this.units;
    const km = (car.odometer - this.odo0) / 1000;
    const kWh = (car.energyUsedWh - this.energy0) / 1000;
    const eff = km > 0.2 ? (units === 'mph' ? `${Math.round((kWh * 1000) / (km / 1.609344))} Wh/mi` : `${Math.round((kWh * 1000) / km)} Wh/km`) : '—';
    if (!this.laps) {
      return [
        ['Trip', fmtDist(km * 1000, units)],
        ['Energy', `${kWh.toFixed(2)} kWh`],
        ['Efficiency', eff],
        ['Top speed', fmtSpeed(this.maxV, units)],
      ];
    }
    const cur = this.goT === null ? 0 : this.finished ? 0 : this.t - this.lapStart;
    const best = this.lapTimes.length ? Math.min(...this.lapTimes) : null;
    const pb = this.game.best.get('circuit_lap');
    return [
      ['Lap', `${Math.min(this.lap + 1, this.laps)} / ${this.laps}`],
      ['Current', fmtLap(cur)],
      ['Last', this.lapTimes.length ? fmtLap(this.lapTimes[this.lapTimes.length - 1]) : '—'],
      ['Best', best ? fmtLap(best) : '—'],
      ['Record', pb ? fmtLap(pb) : '—'],
      ['Efficiency', eff],
    ];
  }

  finish() {
    this.finished = true;
    const total = this.lapTimes.reduce((a, b) => a + b, 0);
    const best = Math.min(...this.lapTimes);
    const lines = this.lapTimes.map((t, i) => [`Lap ${i + 1}`, fmtLap(t), t === best ? 'best' : '']);
    lines.push(['Total', fmtLap(total)]);
    lines.push(['Top speed', fmtSpeed(this.maxV, this.units)]);
    const kWh = (this.game.car.energyUsedWh - this.energy0) / 1000;
    lines.push(['Energy used', `${kWh.toFixed(2)} kWh`]);
    const pb = this.game.best.get('circuit_lap');
    this.game.finish({
      title: 'Race complete',
      subtitle: pb && Math.abs(pb - best) < 1e-6 ? 'New lap record!' : pb ? `Lap record: ${fmtLap(pb)}` : '',
      lines,
      note: 'Tip: the Roadster carries huge speed out of corners — brake in a straight line, then feed the throttle in as you unwind the steering.',
    });
  }
}

export const MODE_LIST = [
  { id: 'drag', make: (g) => new DragMode(g), title: 'Drag Strip', desc: 'Stage, watch the tree, launch. Chase the announced 1.9 s 0–60 and 8.8 s ¼ mile.', tag: '¼ mile' },
  { id: 'top', make: (g) => new TopSpeedMode(g), title: 'Top Speed', desc: 'Nine kilometres of salt flat. Find 250 mph — then find the brakes.', tag: '250+ mph' },
  { id: 'circuit', make: (g) => new CircuitMode(g, 3), title: 'Coast Circuit', desc: 'Three timed laps of a 6.7 km island circuit — fast sweepers and a hairpin.', tag: '3 laps' },
  { id: 'cruise', make: (g) => new CircuitMode(g, 0), title: 'Free Cruise', desc: 'No clock. Roof off, ocean views, one-pedal driving and range in mind.', tag: 'Relax' },
];
