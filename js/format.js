import { MPH } from './car.js';

export function speedValue(v, units) {
  return units === 'mph' ? Math.abs(v) / MPH : Math.abs(v) * 3.6;
}

export function fmtSpeed(v, units) {
  return `${Math.round(speedValue(v, units))} ${units === 'mph' ? 'mph' : 'km/h'}`;
}

export function fmtSec(t) {
  return `${t.toFixed(2)} s`;
}

export function fmtLap(t) {
  if (!isFinite(t) || t <= 0) return '0:00.000';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function fmtDist(m, units) {
  if (units === 'mph') {
    const mi = m / 1609.344;
    return mi < 0.1 ? `${Math.round(m * 3.28084)} ft` : `${mi.toFixed(2)} mi`;
  }
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}
