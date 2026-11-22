/**
 * Procedural WebAudio synth recipes for Mission 3 ("Quiet Title") stealth infiltration:
 * awareness cues, estate lockdown klaxon, silent takedown, breaker throw, CCTV chirp,
 * ferro-steel blast shutter slam, and hydraulic capacitor overload.
 */
import { perc, swell } from '../dsl';
import { MODES, brass, clank, click, modal, riser, slap, thump, zap } from '../instruments';
import { r } from '../recipe';

export const stealth = [
  // Subtle low metallic tension sting when a guard starts investigating.
  r('stealth_suspicious', {
    dur: 1.1,
    mix: 'reward',
    stereo: true,
    over: { volume: 0.42, send: 0.14, maxVoices: 2 },
    expect: { centroid: [120, 2600] },
  }, s => {
    s.osc('sine', [[0, 96], [0.85, 84]], 0.95).env(swell(0.03, 0.92, 0.6, 0.65)).out(1, -0.15);
    s.osc('sawtooth', [[0, 184], [0.8, 180]], 0.9).lp(780, 1.8).env(swell(0.05, 0.88, 0.55, 0.24)).out(1, -0.35);
    s.osc('sawtooth', [[0, 195], [0.8, 191]], 0.9, 6).lp(820, 1.8).env(swell(0.06, 0.88, 0.55, 0.2)).out(1, 0.35);
    modal(s, { f0: 340, modes: MODES.plate, decay: 0.48, level: 0.28, damping: 0.66, strike: 0.1 });
  }),

  // Sharp brassy discovery sting when a guard spots the player and goes Alert.
  r('stealth_alert', {
    dur: 1.45,
    mix: 'stinger',
    stereo: true,
    over: { volume: 0.56, duck: [0.3, 0.8], send: 0.12 },
    expect: { attackMs: [0, 30] },
  }, s => {
    thump(s, 68, 0.28, 0.85, 2.6);
    brass(s, [45, 51, 56], 0.92, 1.05, 3100);
    modal(s, { f0: 980, modes: MODES.bar, decay: 0.4, level: 0.34, damping: 0.68, strike: 0.4 });
    s.noise('white', 0.04).hp(1800).env(perc(0.018, 0.55, 0.0005)).out();
  }),

  // Two-tone industrial estate klaxon alarm burst on Compound Lockdown.
  r('stealth_lockdown', {
    dur: 2.6,
    mix: 'stinger',
    stereo: true,
    over: { volume: 0.66, duck: [0.45, 1.8], send: 0.24 },
    expect: { centroid: [250, 3200] },
  }, s => {
    thump(s, 54, 0.26, 0.7, 2.2);
    const bursts: readonly (readonly [t: number, lo: number, hi: number, len: number, lvl: number])[] = [
      [0.02, 311, 415, 0.62, 0.72],
      [0.74, 370, 494, 0.62, 0.68],
      [1.46, 311, 415, 0.78, 0.56],
    ];
    for (const [t, lo, hi, len, lvl] of bursts) {
      s.at(t, () => {
        s.osc('sawtooth', lo, len).drive(2.2).lp(2000, 1.2).env(swell(0.012, len, 0.22, lvl)).out(1, -0.25);
        s.osc('sawtooth', hi, len, 7).drive(1.8).lp(2200, 1.2).env(swell(0.012, len, 0.22, lvl * 0.62)).out(1, 0.25);
      });
    }
  }),

  // Tight muffled blade/cloth close-quarters takedown impact.
  r('stealth_takedown', {
    dur: 0.42,
    n: 3,
    mix: 'player',
    over: { volume: 0.56, priority: 7, critical: true, maxVoices: 3, near: 3, far: 24, send: 0.05 },
    expect: { attackMs: [0, 12] },
  }, s => {
    s.noise('white', 0.08).bp([[0, s.r(3400, 4200)], [0.065, 1300]], 2.2).env(perc(0.055, 0.58, 0.0008)).out();
    slap(s, 0.72, s.r(620, 760));
    thump(s, s.r(72, 86), 0.13, 0.85, 2.2);
    s.at(0.04, () => {
      s.noise('pink', 0.18).bp(880, 1.1).env(perc(0.13, 0.34, 0.006)).out();
    });
  }),

  // Heavy electrical switch clunk + power-down transformer hum.
  r('breaker_flip', {
    dur: 0.95,
    n: 2,
    mix: 'foley',
    over: { volume: 0.58, priority: 6, maxVoices: 3, near: 4, far: 30, send: 0.12 },
    expect: { attackMs: [0, 15] },
  }, s => {
    clank(s, s.r(490, 560), 0.85, 0.07);
    click(s, 1850, 0.9, 0.01);
    thump(s, 95, 0.08, 0.7, 2.1);
    s.at(0.055, () => {
      click(s, 1260, 0.78, 0.012);
      s.noise('white', 0.025).bp(2600, 1.8).env(perc(0.016, 0.48, 0.0006)).drive(2.4).out();
    });
    s.at(0.07, () => {
      s.osc('sawtooth', [[0, 120], [0.76, 42]], 0.82).lp([[0, 620], [0.76, 160]], 1.4).env(perc(0.72, 0.42, 0.012)).out();
      s.osc('sine', [[0, 240], [0.72, 84]], 0.78).env(perc(0.66, 0.24, 0.015)).out();
    });
  }),

  // Sharp electronic surveillance CCTV lock chirp.
  r('camera_beep', {
    dur: 0.22,
    mix: 'enemyFx',
    over: { volume: 0.44, priority: 7, maxVoices: 4, perFrame: 1, near: 6, far: 48, send: 0.08, pitchJitter: 0 },
    expect: { centroid: [1000, 7000], attackMs: [0, 10] },
  }, s => {
    s.osc('square', 2150, 0.055).lp(5200).env(perc(0.045, 0.65, 0.0008)).out();
    s.osc('sine', 4300, 0.03).env(perc(0.022, 0.2, 0.0006)).out();
    s.at(0.062, () => {
      s.osc('square', 2680, 0.09).lp(5600).env(perc(0.078, 0.72, 0.0008)).out();
      s.osc('sine', 2680, 0.1).env(perc(0.09, 0.35, 0.001)).out();
    });
  }),

  // Heavy ferro-steel blast shutter drop & lock thud.
  r('shutter_slam', {
    dur: 1.45,
    mix: 'blastSmall',
    over: { volume: 0.82, priority: 7, airDelay: false, near: 12, far: 140, send: 0.28 },
    expect: { attackMs: [0, 20], minSub: 0.08 },
  }, s => {
    thump(s, 46, 0.42, 1, 2.8);
    clank(s, 210, 0.95, 0.36);
    modal(s, { f0: 145, modes: MODES.plate, decay: 0.62, level: 0.52, damping: 0.65, strike: 0.45 });
    s.noise('pink', 0.22).bp(1100, 1.1).env(perc(0.18, 0.72, 0.002)).drive(3).out();
    s.at(0.22, () => {
      clank(s, 360, 0.72, 0.14);
      thump(s, 68, 0.16, 0.65, 2.2);
    });
    s.at(0.31, () => click(s, 1400, 0.62, 0.012));
  }),

  // Rising hydraulic capacitor whine + pressure surge burst.
  r('bunker_overload', {
    dur: 2.3,
    mix: 'stinger',
    stereo: true,
    over: { volume: 0.74, duck: [0.4, 1.5], near: 14, far: 160, send: 0.26 },
    expect: { minSub: 0.06 },
  }, s => {
    riser(s, 1.16, 0.55, 240, 3800);
    s.osc('sawtooth', [[0, 110], [1.16, 980]], 1.18).lp([[0, 520], [1.15, 4200]], 2.2)
      .env([[0, 0.005], [1.12, 0.62], [1.18, 0.0001]]).out(1, -0.2);
    s.osc('sine', [[0, 220], [1.16, 1960]], 1.18)
      .env([[0, 0.005], [1.12, 0.34], [1.18, 0.0001]]).out(1, 0.2);
    s.grains(1.16, t => 8 + t * t * 34, 0.0014, t => 0.2 + t * 0.45).hp(2600).out(0.55);

    s.at(1.18, () => {
      thump(s, 52, 0.52, 1, 3);
      s.noise('white', 0.95).bp([[0, 2400], [0.85, 550]], 0.9).env(perc(0.84, 0.95, 0.003)).drive(3).out();
      zap(s, 0.42, 0.62, 130);
      clank(s, 260, 0.65, 0.26);
    });
  }),
];
