/** The Gimlet (weapons-update plan section 11): its place between the SMG and the Harrow, its issued mods, R held and tapped, the launcher. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { WeaponId } from '../core/gameplay';
import { LAUNCHER, WEAPONS } from './data';
import { familyOfSlot } from './families';
import { ISSUED, MODS, moddedDef } from './mods';
import { makeRange, type Range } from './testkit';

let r: Range;
let callouts: string[];
beforeEach(async () => {
  r = await makeRange();
  r.reset();
  callouts = [];
  (r.ctx.hud as { callout?: (t: string) => void }).callout = t => callouts.push(t);
});

function draw(id: WeaponId = 'gimlet'): void {
  r.weapons.give(id);
  r.weapons.switchTo(id);
  r.run(0.6);
  expect(r.weapons.current).toBe(id);
}

/** R held for `seconds`, then let go. */
function holdR(seconds: number): void {
  r.input.simulate('reload', true);
  r.run(seconds);
  r.input.simulate('reload', false);
  r.run(1 / 60);
}

/** Damage kept at `m` metres under a row's falloff. */
function reach(id: WeaponId, m: number): number {
  const f = WEAPONS[id].falloff;
  if (!f || m <= f.from) return 1;
  return m >= f.to ? f.floor : 1 - ((m - f.from) / (f.to - f.from)) * (1 - f.floor);
}

describe('the Gimlet on paper', () => {
  it('the Harrow does 60 damage at 600 rpm, above the Gimlet in DPS, with its rifle penetration unchanged', () => {
    const harrow = WEAPONS.harrow;
    expect(harrow.damage).toBe(60);
    expect(harrow.interval).toBe(0.1);
    expect(60 / harrow.interval).toBe(600);
    expect(harrow.damage / harrow.interval).toBe(600);
    expect(harrow.damage / harrow.interval).toBeGreaterThan(WEAPONS.gimlet.damage / WEAPONS.gimlet.interval);
    expect(harrow.armour).toBe('medium');
    expect(harrow.penetration).toBe(0.5);
    expect(moddedDef('harrow', new Set(['harrowAp'])).damage).toBe(48);
    expect(moddedDef('harrow', new Set(['harrowHp'])).damage).toBe(90);
    expect(moddedDef('harrow', new Set(['harrowPlusP'])).damage).toBe(72);
  });

  it('sits between the SMG and the Harrow: more round than the SMG, less than the Harrow, 800 to 900 a minute, thirty in the magazine', () => {
    const g = WEAPONS.gimlet;
    expect(g.damage).toBeGreaterThan(WEAPONS.smg.damage);
    expect(g.damage).toBeLessThan(WEAPONS.harrow.damage);
    expect(60 / g.interval).toBeGreaterThanOrEqual(800);
    expect(60 / g.interval).toBeLessThanOrEqual(900);
    expect(g.magSize).toBe(30);
    expect(familyOfSlot(1)).toEqual(['smg', 'gimlet', 'harrow']);
    expect(g.base).toBe('smg');
  });

  it('outreaches the SMG: at 80 m and 150 m it keeps most of its round where the SMG has halved', () => {
    for (const m of [80, 150]) {
      expect(WEAPONS.gimlet.damage * reach('gimlet', m)).toBeGreaterThan(WEAPONS.smg.damage * reach('smg', m) * 2);
      expect(reach('gimlet', m)).toBeGreaterThanOrEqual(0.75);
    }
  });

  it('aims through a 4x ACOG: twice the red dot\'s magnification, from a 90 degree view', () => {
    const fov = (zoom: number) => 90 * (1 - zoom);
    const power = (zoom: number) => Math.tan(Math.PI / 4) / Math.tan((fov(zoom) * Math.PI) / 360);
    expect(power(moddedDef('gimlet', new Set(['gimletAcog'])).ads!.zoom)).toBeCloseTo(4, 1);
    expect(power(moddedDef('gimlet', new Set(['gimletDot'])).ads!.zoom)).toBeCloseTo(2, 0);
    expect(moddedDef('harrow', new Set(['harrowAcog'])).ads).toEqual(MODS.gimletAcog.patch.ads);
  });
});

describe('issued mods', () => {
  it('starts every run with the ACOG and the suppressor fitted, and fires the owner\'s suppressed shot', () => {
    for (const id of ISSUED) {
      expect(r.weapons.mods.has(id), id).toBe(true);
      expect(r.weapons.fitted.has(id), id).toBe(true);
    }
    draw();
    r.tap('fire');
    expect(r.record.sounds).toContain('gimlet_suppressed_shot');
    r.weapons.fitMod('gimletCan', false);
    r.run(0.3);
    r.tap('fire');
    expect(r.record.sounds).toContain('gimlet_shot');
  });

  it('takes one optic: the red dot fitted takes the ACOG off, and back', () => {
    r.weapons.grantMod('gimletDot');
    r.weapons.fitMod('gimletDot', true);
    expect(r.weapons.fitted.has('gimletAcog')).toBe(false);
    r.weapons.fitMod('gimletAcog', true);
    expect(r.weapons.fitted.has('gimletDot')).toBe(false);
    expect(r.weapons.fitted.has('gimletCan')).toBe(true);
    // The Harrow's two optics are the same rule.
    r.weapons.grantMod('reddot');
    r.weapons.grantMod('harrowAcog');
    r.weapons.fitMod('reddot', true);
    r.weapons.fitMod('harrowAcog', true);
    expect([...r.weapons.fitted].filter(m => MODS[m].weapon === 'harrow')).toEqual(['harrowAcog']);
  });
});

describe('R on the Gimlet', () => {
  it('a tap reloads, on the release; a hold steps auto, bursts of three, semi and back to auto, with no reload', () => {
    draw();
    r.weapons.ammo('gimlet').mag = 10;
    r.input.simulate('reload', true);
    r.run(0.1);
    expect(r.weapons.reloading).toBe(false);
    r.input.simulate('reload', false);
    r.run(1 / 60);
    expect(r.weapons.reloading).toBe(true);
    r.run(1.5);
    expect(r.weapons.ammo('gimlet').mag).toBe(30);

    r.weapons.ammo('gimlet').mag = 10;
    holdR(WEAPONS.gimlet.select!.hold + 0.05);
    expect(r.weapons.reloading).toBe(false);
    expect(r.weapons.ammoMode).toBe('BURST');
    expect(callouts).toEqual(['BURST']);
    expect(r.record.sounds).toContain('fire_select');

    // One pull held a second: three rounds.
    r.weapons.ammo('gimlet').mag = 30;
    r.input.simulate('fire', true);
    r.run(1);
    r.input.simulate('fire', false);
    r.run(0.4);
    expect(r.weapons.ammo('gimlet').mag).toBe(27);
    // Two pulls: six.
    r.tap('fire');
    r.run(0.4);
    r.tap('fire');
    r.run(0.4);
    expect(r.weapons.ammo('gimlet').mag).toBe(21);

    // Semi: a held trigger is one round, each pull another.
    holdR(0.4);
    expect(r.weapons.ammoMode).toBe('SEMI');
    r.input.simulate('fire', true);
    r.run(1);
    r.input.simulate('fire', false);
    r.run(0.2);
    expect(r.weapons.ammo('gimlet').mag).toBe(20);
    r.tap('fire');
    r.run(0.2);
    expect(r.weapons.ammo('gimlet').mag).toBe(19);

    holdR(0.4);
    expect(r.weapons.ammoMode).toBe('');
    expect(callouts).toEqual(['BURST', 'SEMI', 'AUTO']);
    expect(r.record.sounds.filter(id => id === 'fire_select').length).toBe(3);
    r.input.simulate('fire', true);
    r.run(1);
    r.input.simulate('fire', false);
    expect(r.weapons.ammo('gimlet').mag).toBeLessThan(19 - 10);
  });

  it('the Harrow: a hold toggles full auto and semi, with the click and the callout; a tap still reloads', () => {
    draw('harrow');
    expect(WEAPONS.harrow.select!.modes).toEqual(['auto', 'semi']);
    holdR(WEAPONS.harrow.select!.hold + 0.05);
    expect(r.weapons.ammoMode).toBe('SEMI');
    expect(callouts).toEqual(['SEMI']);
    expect(r.record.sounds).toContain('fire_select');
    r.weapons.ammo('harrow').mag = 24;
    r.input.simulate('fire', true);
    r.run(1);
    r.input.simulate('fire', false);
    r.run(0.2);
    expect(r.weapons.ammo('harrow').mag).toBe(23);
    holdR(0.4);
    expect(r.weapons.ammoMode).toBe('');
    expect(callouts).toEqual(['SEMI', 'AUTO']);
    r.input.simulate('fire', true);
    r.run(0.6);
    r.input.simulate('fire', false);
    expect(r.weapons.ammo('harrow').mag).toBeLessThan(23 - 3);
    r.weapons.ammo('harrow').mag = 10;
    r.tap('reload');
    r.run(1 / 60);
    expect(r.weapons.reloading).toBe(true);
  });

  it('the Harrow semi selector uses the same 0.1 s cap as auto, not a separate old rate', () => {
    draw('harrow');
    holdR(0.4);
    expect(r.weapons.ammoMode).toBe('SEMI');
    r.tap('fire');
    r.tap('fire');
    expect(r.weapons.ammo('harrow').mag).toBe(23);
    r.run(0.04);
    r.tap('fire');
    expect(r.weapons.ammo('harrow').mag).toBe(22);
  });

  it('leaves R alone on every other gun: a press reloads at once', () => {
    draw('smg');
    r.weapons.ammo('smg').mag = 10;
    r.input.simulate('reload', true);
    r.run(1 / 60);
    expect(r.weapons.reloading).toBe(true);
  });
});

describe('the under-barrel launcher', () => {
  beforeEach(() => {
    r.weapons.grantMod('gimletGl');
    r.weapons.fitMod('gimletGl', true);
    draw();
  });

  it('comes up on a held R, fires one grenade that goes off where it lands, and tap R reloads it, not the rifle', () => {
    r.wall(-15, 1);
    holdR(0.4);
    expect(r.weapons.launcherUp).toBe(true);
    expect(r.weapons.ammoMode).toBe('LAUNCHER');
    expect(callouts).toEqual(['LAUNCHER']);
    r.run(0.3);
    const rifle = r.weapons.ammo('gimlet').mag;
    expect(r.weapons.ammo().magSize).toBe(1);
    r.tap('fire');
    expect(r.record.sounds).toContain('launcher_thump');
    r.run(0.6);
    expect(r.record.explosions).toBe(1);
    expect(r.weapons.ammo('gimlet').mag).toBe(rifle);
    // Its one round gone, it reloads itself from the reserve; a tap of R does it too.
    const reserve = r.weapons.ammo().reserve;
    r.run(LAUNCHER.reloadTime + 0.3);
    expect(r.weapons.ammo().mag).toBe(1);
    expect(r.weapons.ammo().reserve).toBe(reserve - 1);

    r.weapons.ammo('gimlet').mag = 5;
    r.tap('reload');
    r.run(0.1);
    expect(r.weapons.reloading).toBe(false);
    expect(r.weapons.ammo('gimlet').mag).toBe(5);
  });

  it('a held R takes it down again, and with it fitted the hold never switches the rifle off full auto', () => {
    holdR(0.4);
    r.run(0.3);
    holdR(0.4);
    expect(r.weapons.launcherUp).toBe(false);
    expect(r.weapons.ammoMode).toBe('');
    expect(callouts).toEqual(['LAUNCHER', 'RIFLE']);
    r.weapons.ammo('gimlet').mag = 30;
    r.input.simulate('fire', true);
    r.run(0.5);
    r.input.simulate('fire', false);
    expect(r.weapons.ammo('gimlet').mag).toBeLessThan(30 - 4);
    r.run(0.3);
    r.weapons.ammo('gimlet').mag = 20;
    r.tap('reload');
    r.run(0.1);
    expect(r.weapons.reloading).toBe(true);
  });

  it('the last grenade gone puts the rifle back in the hands', () => {
    holdR(0.4);
    r.run(0.3);
    r.weapons.ammo().reserve = 0;
    r.tap('fire');
    expect(r.weapons.launcherUp).toBe(false);
    expect(callouts).toEqual(['LAUNCHER', 'RIFLE']);
    r.run(0.3);
    holdR(0.4);
    expect(r.weapons.launcherUp).toBe(false);
    expect(callouts).toContain('NO GRENADES');
  });

  it('comes off with its mod, and the shot is the rifle\'s again', () => {
    holdR(0.4);
    r.weapons.fitMod('gimletGl', false);
    expect(r.weapons.launcherUp).toBe(false);
  });

  it('fitting it puts the rifle on full auto; taking it off brings the selector back, starting from auto', () => {
    r.weapons.fitMod('gimletGl', false);
    r.run(0.1);
    holdR(0.4);
    holdR(0.4);
    expect(r.weapons.ammoMode).toBe('SEMI');
    r.weapons.fitMod('gimletGl', true);
    expect(r.weapons.ammoMode).toBe('');
    r.weapons.fitMod('gimletGl', false);
    expect(r.weapons.ammoMode).toBe('');
    callouts.length = 0;
    holdR(0.4);
    expect(callouts).toEqual(['BURST']);
  });
});
