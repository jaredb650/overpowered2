/**
 * The Outpost's machines. Every loop's rhythm is a whole number of beats per loop, so a firing cycle or a blade pulse wraps with no seam.
 * Engines are heard through `EngineSound`, which holds the loop beside the listener and sets its level itself, so distance lives there.
 */
import { perc, swell } from '../dsl';
import { blast, boom, clank, click, gunshot, laser, modal, MODES, snap, thump } from '../instruments';
import { r } from '../recipe';

const ENGINE = { mix: 'loop3d', loop: true, over: { volume: 0.5, maxVoices: 8, family: 'engine', familyMax: 10, near: 6, far: 120, send: 0.1 } } as const;

export const vehicles = [
  // A big diesel at a fast idle: a firing cycle you can count, a rattle on top of it, and a low note under it.
  r('truck_engine_loop', { ...ENGINE, dur: 1 }, s => {
    s.osc('sawtooth', 45).lp(360).am(s.lfo(15, 0.46)).drive(1.6).out(0.5);
    s.osc('sine', 30).am(s.lfo(15, 0.3)).out(0.4);
    s.noise('pink').bp(260, 1.3).am(s.lfo(30, 0.74)).out(0.6);
    s.noise('white').bp(2100, 2.2).am(s.lfo(15, 0.5, 'square')).out(0.05);
  }),
  // Tanks are all weight and a turbine's whistle over the top.
  r('tank_engine_loop', { ...ENGINE, dur: 1, over: { ...ENGINE.over, volume: 0.62, maxVoices: 6 } }, s => {
    s.osc('sawtooth', 28).lp(170).am(s.lfo(7, 0.3)).drive(1.8).out(0.8);
    s.osc('sine', 42).am(s.lfo(14, 0.24)).out(0.5);
    s.noise('brown').lp(240).gain(2).am(s.lfo(14, 0.4)).out(0.7);
    s.osc('sine', 1260).am(s.wander(1, 0.18)).out(0.035);
    s.noise('pink').bp(1500, 5).out(0.1);
  }),
  // Steel links on steel teeth. Regular, and never quite the same twice.
  r('tank_tracks_loop', { ...ENGINE, dur: 2, seam: 0.2, over: { ...ENGINE.over, volume: 0.5, maxVoices: 6 } }, s => {
    s.grains(2.2, () => 11, 0.006, () => s.r(0.4, 1)).bp(760, 2.4).drive(2).out(1);
    s.grains(2.2, () => 5.5, 0.012, () => s.r(0.5, 1)).bp(240, 1.6).out(1.1);
    s.noise('brown').lp(320).gain(1.6).out(0.5);
    s.noise('pink').bp(2600, 1.4).am(s.lfo(11, 0.5)).out(0.04);
  }),
  // Hydraulics and a geared ring: the sound of being looked at.
  r('tank_turret_loop', { dur: 1, mix: 'loop3d', loop: true, over: { volume: 0.5, maxVoices: 4, near: 10, far: 90 } }, s => {
    s.osc('sawtooth', 220).lp(1100).am(s.lfo(9, 0.16)).out(0.28);
    s.osc('square', 441).lp(900).out(0.1);
    s.noise('pink').bp(1600, 4).am(s.lfo(18, 0.5)).out(0.3);
    s.noise('brown').lp(140).gain(1.4).out(0.3);
  }),
  r('tank_turret_stop', { dur: 0.5, mix: 'machine', over: { volume: 0.5, near: 10, far: 90 } }, s => {
    clank(s, 320, 0.8, 0.14);
    thump(s, 70, 0.12, 0.7);
  }),
  // The gunner's on the mark. A rising servo and a hard stop, so a player who cannot see the laser still knows to move.
  r('tank_lay', { dur: 1, mix: 'enemyFx', over: { volume: 0.66, priority: 7, near: 18, far: 150, exempt: true }, expect: { trend: 1 } }, s => {
    s.osc('sawtooth', [[0, 300], [0.8, 900]], 0.85).lp(2800).env(swell(0.12, 0.7, 0.05, 0.34)).out();
    s.osc('square', [[0, 600], [0.8, 1800]], 0.85).lp(3600).env(swell(0.3, 0.5, 0.05, 0.1)).out();
    s.at(0.84, () => click(s, 2400, 1, 0.02));
  }),
  r('tank_cannon', { dur: 3.2, n: 2, mix: 'blast', over: { volume: 1, near: 22, far: 420, send: 0.5, maxVoices: 3, duck: [0.35, 0.6] }, expect: { attackMs: [0, 10], minSub: 0.1 } }, s => {
    gunshot(s, { crack: 1.3, crackHp: 1100, body: 520, bodyDecay: 0.2, sub: 1, subFreq: 46, subDecay: 0.5, drive: 4.5 });
    boom(s, 1.5, 0.8);
    s.noise('pink', 2.4).lp([[0, 2600], [2, 180]]).env(perc(1.1, 0.34, 0.01)).out();
  }),
  r('track_snap', { dur: 1.4, mix: 'blastSmall', over: { volume: 0.8, near: 12, far: 160, airDelay: false }, expect: { attackMs: [0, 10] } }, s => {
    clank(s, 620, 1, 0.16);
    thump(s, 90, 0.2, 0.9);
    for (let i = 0; i < 9; i++) s.at(0.05 + i * 0.09 + s.r(0, 0.03), () => clank(s, s.r(480, 1200), 0.4 - i * 0.03, 0.05));
  }),
  // Heavy machine gun: slower and lower than anything a man carries, so a mount is known by ear.
  r('mounted_gun', { dur: 0.42, n: 3, mix: 'enemyGun', over: { volume: 0.56, maxVoices: 4, near: 12, far: 190, send: 0.26, family: undefined }, expect: { attackMs: [0, 6] } }, s => {
    gunshot(s, { crack: 0.9, crackHp: 1800, body: 700, bodyDecay: 0.075, sub: 0.6, subFreq: 92, subDecay: 0.09, drive: 3.4 });
  }),
  r('gunship_gun', { dur: 0.36, n: 3, mix: 'enemyGun', over: { volume: 0.6, maxVoices: 5, near: 20, far: 320, send: 0.3, family: undefined, airDelay: true }, expect: { attackMs: [0, 6] } }, s => {
    gunshot(s, { crack: 1, crackHp: 1400, body: 480, bodyDecay: 0.06, sub: 0.7, subFreq: 74, subDecay: 0.08, drive: 4 });
  }),
  // Five heavy blades at eighteen slaps a second. The thump carries a long way, and the slap is what tells you which way it is turning.
  r('gunship_rotor_loop', { dur: 1, mix: 'loop3d', loop: true, over: { volume: 0.66, maxVoices: 3, near: 6, far: 120, send: 0.18 } }, s => {
    s.osc('sine', 36).am(s.lfo(18, 0.86)).drive(1.5).out(0.9);
    s.noise('brown').lp(320).gain(2).am(s.lfo(18, 0.9)).out(0.9);
    s.noise('pink').bp(520, 1.1).am(s.lfo(18, 0.92, 'sawtooth')).out(0.5);
    s.noise('white').hp(2600).am(s.lfo(18, 0.9, 'sawtooth')).out(0.03);
  }),
  r('gunship_turbine_loop', { dur: 1, mix: 'loop3d', loop: true, over: { volume: 0.42, maxVoices: 3, near: 6, far: 120 } }, s => {
    s.osc('sine', 2100).am(s.wander(2, 0.1)).out(0.09);
    s.osc('sine', 3150).out(0.05);
    s.noise('pink').bp(1800, 3).out(0.34);
    s.noise('white').hp(5000).out(0.012);
  }),
  // Everything that was holding it up stops at once.
  r('gunship_stricken', { dur: 2.6, mix: 'enemyFx', over: { volume: 0.86, priority: 8, near: 40, far: 380, send: 0.4, exempt: true, airDelay: true }, expect: { trend: -1 } }, s => {
    laser(s, 2300, 240, 2.3, 0.5);
    clank(s, 300, 1, 0.3);
    s.noise('pink', 2.4).bp([[0, 1500], [2.2, 220]], 1.1).env(swell(0.05, 2.2, 0.1, 0.7)).out();
    for (let i = 0; i < 6; i++) s.at(0.4 + i * 0.28, () => s.osc('square', 900, 0.12).lp(2400).env(perc(0.1, 0.14)).out());
  }),
  // The driver's head on the wheel.
  r('vehicle_horn', { dur: 2.6, mix: 'enemyFx', over: { volume: 0.5, near: 14, far: 140, send: 0.34 } }, s => {
    s.osc('sawtooth', 415, 2.5).lp(2400).env(swell(0.04, 1.9, 0.55, 0.32)).out();
    s.osc('sawtooth', 523, 2.5).lp(2400).env(swell(0.04, 1.9, 0.55, 0.26)).out();
  }),
  r('vehicle_fuel_leak', { dur: 1.3, mix: 'enemyFx', over: { volume: 0.56, near: 10, far: 90 } }, s => {
    s.noise('white', 0.9).hp(2600).env(swell(0.05, 0.8, 0.2, 0.3)).out();
    s.at(0.1, () => s.noise('pink', 0.9).lp([[0, 240], [0.3, 1800], [0.8, 400]]).env(perc(0.5, 0.9, 0.02)).out());
    s.at(0.1, () => thump(s, 62, 0.3, 0.7));
  }),
  r('vehicle_explode', { dur: 4.6, n: 2, mix: 'blast', over: { volume: 1, near: 26, far: 480, send: 0.5, maxVoices: 3, duck: [0.45, 1.1] }, expect: { attackMs: [0, 12], minSub: 0.1 } }, s => {
    blast(s, { size: 1.5, crack: 1.25, crackle: 0.9, tail: 0.85 });
    boom(s, 2.2, 0.8);
    // What came up comes back down.
    for (let i = 0; i < 10; i++) s.at(s.r(0.7, 3.2), () => modal(s, { f0: s.r(240, 1100), modes: MODES.barrel, decay: s.r(0.06, 0.2), level: s.r(0.05, 0.16), strike: 0.4 }));
    s.at(0.4, () => snap(s, 12, 1.2, 0.2, 1700));
  }),
  r('wreck_land', { dur: 1.6, n: 2, mix: 'blastSmall', over: { volume: 0.86, near: 16, far: 220 }, expect: { attackMs: [0, 10], minSub: 0.08 } }, s => {
    thump(s, 46, 0.5, 1, 3);
    clank(s, 210, 1, 0.3);
    s.noise('white', 0.08).hp(1400).env(perc(0.03, 0.6)).drive(3).out();
    for (let i = 0; i < 5; i++) s.at(s.r(0.06, 0.9), () => clank(s, s.r(500, 1600), s.r(0.1, 0.3), 0.06));
  }),
];
