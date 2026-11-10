/** The run report table, shared by the game-over screen and the Tab overlay. */
import { div, span } from '../dom';
import type { RunReport } from '../runreport';

const n = (v: number) => Math.round(v).toLocaleString('en-US');

export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const row = (label: string, value: string) => div('st-row', span('st-k', label), span('st-v', value));

export function statRows(r: RunReport): HTMLElement[] {
  return [
    ...(r.beat ? [row('mission', r.beat), row('contractors lost', n(r.deaths))] : [row('wave reached', n(r.wave))]),
    ...(r.custom ? [row('rules', 'custom, unranked')] : []),
    row('time', clock(r.seconds)),
    row('kills', n(r.kills)),
    row('headshots', n(r.headshots)),
    row('limbs severed', n(r.limbs)),
    row('accuracy', `${Math.round(r.accuracy * 100)}%`),
    row('best combo', n(r.bestCombo)),
    row('top multiplier', `x${r.bestMultiplier.toFixed(1)}`),
    row('top speed', `${r.topSpeed.toFixed(1)} m/s`),
    row('call-ins used', n(r.callIns)),
    row('damage taken', n(r.damageTaken)),
  ];
}
