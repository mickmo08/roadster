// Synthesized sound: motor/inverter whine, wind, road roar, tyre squeal, thrusters.

function noiseBuffer(ctx, seconds = 2) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    const noise = noiseBuffer(ctx);

    const loopNoise = () => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.start();
      return src;
    };

    // Motor: two detuned tones through a peaky filter, plus a high inverter tone.
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    const motorFilter = ctx.createBiquadFilter();
    motorFilter.type = 'bandpass';
    motorFilter.Q.value = 2;
    this.motorFilter = motorFilter;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'triangle';
    this.osc3 = ctx.createOscillator();
    this.osc3.type = 'sine';
    const g1 = ctx.createGain();
    g1.gain.value = 0.25;
    const g2 = ctx.createGain();
    g2.gain.value = 0.6;
    this.invGain = ctx.createGain();
    this.invGain.gain.value = 0;
    this.osc1.connect(g1).connect(motorFilter);
    this.osc2.connect(g2).connect(motorFilter);
    motorFilter.connect(this.motorGain).connect(this.master);
    this.osc3.connect(this.invGain).connect(this.master);
    for (const o of [this.osc1, this.osc2, this.osc3]) o.start();

    // Wind
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    loopNoise().connect(this.windFilter).connect(this.windGain).connect(this.master);

    // Road roar
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    const roadFilter = ctx.createBiquadFilter();
    roadFilter.type = 'bandpass';
    roadFilter.frequency.value = 160;
    roadFilter.Q.value = 0.8;
    this.roadFilter = roadFilter;
    loopNoise().connect(roadFilter).connect(this.roadGain).connect(this.master);

    // Tyre squeal
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    const sq = ctx.createBiquadFilter();
    sq.type = 'bandpass';
    sq.frequency.value = 1400;
    sq.Q.value = 12;
    this.squealOsc = ctx.createOscillator();
    this.squealOsc.type = 'sawtooth';
    this.squealOsc.frequency.value = 1100;
    const sqMix = ctx.createGain();
    sqMix.gain.value = 0.05;
    this.squealOsc.connect(sqMix).connect(sq);
    this.squealOsc.start();
    loopNoise().connect(sq);
    sq.connect(this.squealGain).connect(this.master);

    // Cold-gas jets: a hard high-pressure hiss plus a chest-thumping low roar.
    this.thrustGain = ctx.createGain();
    this.thrustGain.gain.value = 0;
    const th = ctx.createBiquadFilter();
    th.type = 'highpass';
    th.frequency.value = 900;
    loopNoise().connect(th).connect(this.thrustGain).connect(this.master);
    this.roarGain = ctx.createGain();
    this.roarGain.gain.value = 0;
    const roar = ctx.createBiquadFilter();
    roar.type = 'lowpass';
    roar.frequency.value = 220;
    loopNoise().connect(roar).connect(this.roarGain).connect(this.master);

    // Suction fans: a high, slightly rough whine.
    this.fanGain = ctx.createGain();
    this.fanGain.gain.value = 0;
    this.fanOsc = ctx.createOscillator();
    this.fanOsc.type = 'sawtooth';
    this.fanOsc.frequency.value = 410;
    const fanF = ctx.createBiquadFilter();
    fanF.type = 'bandpass';
    fanF.frequency.value = 820;
    fanF.Q.value = 3;
    this.fanOsc.connect(fanF).connect(this.fanGain).connect(this.master);
    this.fanOsc.start();

    // Distant rocket launch rumble
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 90;
    loopNoise().connect(rf).connect(this.rumbleGain).connect(this.master);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  suspend() {
    this.ctx?.suspend();
  }

  resume() {
    this.ctx?.resume();
  }

  /** @param {{speed:number, powerKW:number, slip:number, thrusting:boolean, offRoad:boolean, interior:boolean}} s */
  update(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = 0.05;
    const v = Math.abs(s.speed);
    const load = Math.min(1, Math.abs(s.powerKW) / 500);
    const motorHz = 40 + v * 14;
    this.osc1.frequency.setTargetAtTime(motorHz, t, k);
    this.osc2.frequency.setTargetAtTime(motorHz * 2.01, t, k);
    this.osc3.frequency.setTargetAtTime(1800 + v * 30, t, k);
    this.motorFilter.frequency.setTargetAtTime(motorHz * 2.2 + 200, t, k);
    const motorLevel = Math.min(0.5, (v > 0.2 ? 0.05 : 0) + load * 0.35 + Math.min(v / 60, 1) * 0.06);
    this.motorGain.gain.setTargetAtTime(motorLevel, t, k);
    this.invGain.gain.setTargetAtTime(0.004 + load * 0.012, t, k);

    const interior = s.interior ? 0.55 : 1;
    const w = Math.min(1, ((s.wind ?? v) / 90) ** 2);
    this.windGain.gain.setTargetAtTime(w * 0.55 * interior, t, k);
    this.windFilter.frequency.setTargetAtTime(300 + (s.wind ?? v) * 25, t, k);
    this.roadGain.gain.setTargetAtTime(Math.min(0.5, v / 60) * (s.offRoad ? 1.4 : 0.35) * interior, t, k);
    this.roadFilter.frequency.setTargetAtTime(s.offRoad ? 90 : 160 + v * 2, t, k);
    this.squealGain.gain.setTargetAtTime(v > 3 && !s.offRoad ? s.slip * 0.6 : 0, t, 0.04);
    const jets = s.jets ?? (s.thrusting ? 1 : 0);
    this.thrustGain.gain.setTargetAtTime(Math.min(1, jets) * 0.55, t, 0.03);
    this.roarGain.gain.setTargetAtTime(Math.min(1.2, jets) * 0.9, t, 0.04);
    this.fanGain.gain.setTargetAtTime((s.fan ?? 0) * 0.018 * interior, t, 0.2);
    this.fanOsc.frequency.setTargetAtTime(400 + Math.min(60, v) * 1.5, t, 0.2);
    this.rumbleGain.gain.setTargetAtTime((s.rumble ?? 0) * 1.2, t, 0.3);
  }

  beep(freq = 880, dur = 0.15, vol = 0.25) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  impact(strength) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuffer(this.ctx, 0.5);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.min(1, strength / 15), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }
}
