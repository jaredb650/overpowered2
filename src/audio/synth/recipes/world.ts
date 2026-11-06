import { perc, swell } from '../dsl';
import { MODES, clank, modal, thump, wetBurst, zap } from '../instruments';
import { r } from '../recipe';

/** Ambience beds. Render at half rate: nothing in them lives above 10 kHz and memory is better spent elsewhere. */
const bed = { mix: 'ambience', loop: true, stereo: true, dur: 9, seam: 1.5, rate: 24000 } as const;

export const world = [
  r('jump_pad_idle_loop', { dur: 2, mix: 'loop3d', loop: true, over: { volume: 0.24, near: 3, far: 24, maxVoices: 6 } }, s => {
    s.osc('sine', 110).am(s.lfo(2, 0.2)).out(0.34);
    s.osc('sine', 221).out(0.1);
    s.noise('pink').bp(900, 8).am(s.lfo(1, 0.4)).out(0.3);
  }),
  r('barrel_hiss_loop', { dur: 1.5, mix: 'loop3d', loop: true, over: { volume: 0.34, maxVoices: 4, near: 4, far: 40 } }, s => {
    s.noise('white').bp(6000, 0.9).am(s.wander(16, 0.3)).out(0.6);
    s.noise('pink').bp(2400, 2).out(0.22);
  }),
  r('crusher_slam', { dur: 1.5, mix: 'blastSmall', over: { volume: 0.86, airDelay: false, near: 14, far: 180 }, expect: { attackMs: [0, 8], minSub: 0.1 } }, s => {
    thump(s, 50, 0.42, 1, 3);
    clank(s, 240, 1, 0.34);
    s.noise('white', 0.06).hp(1500).env(perc(0.02, 0.8)).drive(3).out();
    s.grains(0.9, t => 90 * Math.exp(-t * 6), 0.003).bp(1300, 1).out(0.8);
  }),
  r('crusher_rise', { dur: 1.5, mix: 'enemyFx', over: { volume: 0.38, near: 10, far: 90, pitchJitter: 0 } }, s => {
    s.osc('sawtooth', [[0, 70], [1.4, 104]], 1.5).lp(800, 2).am(s.lfo(13, 0.3)).env(swell(0.1, 1.45, 0.2, 0.6)).out();
    s.noise('pink', 1.45).bp(1300, 3).am(s.wander(20, 0.5)).env(swell(0.1, 1.45, 0.3, 0.42)).out();
  }),
  r('electric_floor_loop', { dur: 1, mix: 'loop3d', loop: true, over: { volume: 0.4, near: 6, far: 50, maxVoices: 4 } }, s => {
    s.osc('sawtooth', 120).drive(3, 'fold').lp(3400).hp(120).out(0.3);
    s.grains(1.4, () => 40, 0.001).hp(2600).out(0.6);
  }),
  r('electric_zap', { dur: 0.45, n: 3, mix: 'impact', over: { volume: 0.56, family: undefined, near: 6, far: 60 }, expect: { attackMs: [0, 25] } }, s => {
    // The arc's crackle is random, so its loudest moment can land late. The strike has to be on frame one.
    s.noise('white', 0.02).hp(1800).env(perc(0.008, 1, 0.0002)).drive(3).out(1.2);
    zap(s, s.r(0.24, 0.4), 1, s.r(100, 180));
  }),
  r('lava_loop', { dur: 4, mix: 'loop3d', loop: true, seam: 1, over: { volume: 0.5, near: 14, far: 90, maxVoices: 3, send: 0.2 } }, s => {
    s.noise('brown').lp(240).gain(2).am(s.wander(0.8, 0.3)).out(1);
    s.grains(5, () => 5, 0.004).bp(380, 2).out(1.3);
    for (let i = 0; i < 12; i++) s.at(s.r(0, 3.6), () => wetBurst(s, 4, 0.16, s.r(90, 210), 0.6));
  }),
  r('lava_burn', { dur: 1, mix: 'playerHurt', over: { volume: 0.5 } }, s => {
    s.noise('white', 0.9).hp(3200).env(perc(0.8, 0.6, 0.006)).out();
    wetBurst(s, 14, 0.5, 200, 0.75);
    s.grains(0.9, t => 90 * (1 - t), 0.002).bp(1800, 1.6).out(0.9);
  }),
  r('steam_burst', { dur: 1.5, mix: 'enemyFx', over: { volume: 0.5, near: 8, far: 70, send: 0.2 } }, s => {
    s.noise('white', 1.4).bp([[0, 3000], [1.3, 6500]], 0.8).env(perc(1.3, 1, 0.012)).out(0.8);
    s.noise('pink', 1.3).bp(1200, 1).env(perc(1, 0.42, 0.02)).out();
  }),
  r('metal_groan', { dur: 3, n: 3, mix: 'enemyFx', over: { volume: 0.42, near: 20, far: 260, send: 0.42, priority: 2, pitchJitter: 0.1 } }, s => {
    const f = s.r(70, 115);
    s.osc('sawtooth', [[0, f], [1.4, f * s.r(1.1, 1.5)], [2.9, f * s.r(0.8, 1.1)]], 3).detune(s.wander(4, 90))
      .bp([[0, 500], [1.5, 1300], [2.9, 620]], 6).am(s.wander(9, 0.5)).env(swell(0.4, 2.95, 1.2, 1)).out(1.8);
    modal(s, { f0: f * 3.1, modes: MODES.plate, decay: 1.1, level: 0.14, strike: 0 });
  }),
  r('alarm_klaxon', { dur: 2, mix: 'loop3d', loop: true, seam: 0.02, over: { volume: 0.5, near: 40, far: 380, send: 0.42, priority: 6 } }, s => {
    s.osc('sawtooth', 311).lp(1900).env(swell(0.012, 1.2, 0.06, 1)).out(0.42);
    s.osc('sawtooth', 415, undefined, 6).lp(1900).env(swell(0.012, 1.2, 0.06, 1)).out(0.3);
  }),

  // The reactor. A low engine that never quite settles, in a pit of wet concrete.
  r('amb_core', bed, s => {
    s.osc('sine', 40).am(s.wander(0.4, 0.3)).out(0.42, -0.2);
    s.osc('sine', 60.44).am(s.wander(0.6, 0.4)).out(0.3, 0.2);
    s.noise('brown').lp(190).gain(2).am(s.wander(0.7, 0.3)).out(0.8);
    s.noise('pink').bp(420, 3).sweep(s.wander(0.3, 120)).am(s.wander(0.5, 0.5)).out(0.8, 0.5);
    s.noise('pink').bp(900, 2).sweep(s.wander(0.25, 200)).am(s.wander(0.4, 0.5)).out(0.3, -0.5);
    s.noise('pink').hp(2600).lp(6000).am(s.wander(0.35, 0.6)).out(0.04, -0.5);
  }),
  // The hall. Huge slow air, distant lava and metal ticking as it cools.
  r('amb_foundry', bed, s => {
    s.noise('brown').lp(120).gain(2.4).am(s.wander(0.25, 0.3)).out(1, -0.2);
    s.noise('pink').bp(230, 2).sweep(s.wander(0.2, 70)).am(s.wander(0.3, 0.5)).out(1, 0.3);
    s.noise('pink').bp(640, 1.6).sweep(s.wander(0.2, 180)).am(s.wander(0.25, 0.5)).out(0.42, -0.4);
    s.grains(11, () => 3, 0.004).bp(320, 3).out(1.1, -0.4);
    for (let i = 0; i < 5; i++) s.at(s.r(0.5, 8), () => modal(s, { f0: s.r(700, 1900), modes: MODES.plate, decay: 0.35, level: 0.05, strike: 0.2 }));
  }),
  // Pipes under pressure, a hum you feel, steam leaking somewhere.
  r('amb_refinery', bed, s => {
    s.osc('sawtooth', 50).lp(260).am(s.wander(0.4, 0.2)).out(0.2);
    s.osc('sawtooth', 100.9).lp(460).out(0.08, 0.4);
    s.noise('white').hp(3500).lp(9000).am(s.wander(0.5, 0.7)).out(0.03, -0.6);
    s.noise('pink').bp(780, 7).sweep(s.wander(0.4, 220)).am(s.wander(0.6, 0.6)).out(0.32, 0.6);
    for (let i = 0; i < 4; i++) s.at(s.r(0.5, 8), () => s.noise('white', 1.2).hp(2800).env(swell(0.1, 1.2, 0.8, 0.12)).out(1, 0.6));
  }),
  // Open air: wind through stacked containers, a loose panel.
  r('amb_scrapyard', bed, s => {
    s.noise('pink').bp(420, 0.9).sweep(s.wander(0.4, 170)).am(s.wander(0.5, 0.45)).out(0.6, -0.4);
    s.noise('pink').bp(1050, 1.8).sweep(s.wander(0.5, 340)).am(s.wander(0.7, 0.6)).out(0.26, 0.4);
    s.noise('brown').lp(120).gain(2).out(0.42);
    for (let i = 0; i < 3; i++) s.at(s.r(0.5, 8), () => clank(s, s.r(260, 540), 0.06, 0.28));
  }),
  // A long concrete throat: low standing tones and a slow draught.
  r('amb_transit', bed, s => {
    s.osc('sine', 62).am(s.wander(0.3, 0.4)).out(0.3);
    s.osc('sine', 93.5).am(s.wander(0.35, 0.5)).out(0.18, 0.3);
    s.noise('pink').bp(300, 2.4).sweep(s.wander(0.25, 90)).am(s.wander(0.4, 0.5)).out(1, -0.3);
    s.noise('pink').bp(720, 2).sweep(s.wander(0.3, 200)).am(s.wander(0.5, 0.5)).out(0.34, 0.4);
    s.noise('brown').lp(150).gain(2).am(s.wander(0.4, 0.4)).out(0.7);
  }),
  // High and exposed: nothing but wind at altitude.
  r('amb_ring', bed, s => {
    s.noise('pink').bp(760, 0.8).sweep(s.wander(0.6, 330)).am(s.wander(0.8, 0.5)).out(0.62, -0.5);
    s.noise('pink').bp(1900, 1.4).sweep(s.wander(0.7, 640)).am(s.wander(1, 0.6)).out(0.22, 0.5);
    s.noise('white').hp(5000).am(s.wander(1, 0.5)).out(0.015);
  }),
];

