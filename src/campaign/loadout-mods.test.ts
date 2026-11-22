/** Stealth mission modded loadouts, modded weapon racks, suppressed acoustics, and stealth enemy:hit guard. */
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChipRack } from '../contracts/chips';
import type { Ctx, SurfaceKind } from '../core/contracts';
import type { ModId, WeaponId } from '../core/gameplay';
import { ISSUED, moddedDef } from '../weapons/mods';
import { makeRange, type Range } from '../weapons/testkit';
import { GameHost } from './host';
import type { CampaignHud } from './hud';
import { Racks } from './racks';
import { MissionRunner } from './runner';
import { FakeHost } from './testkit';
import type { Mission, MissionHost } from './types';

let r: Range;
beforeEach(async () => {
  r = await makeRange();
  r.reset();
});

describe('moddedDef for stealth .50 Cal suppressed AWL', () => {
  it('combines awl50, awlCan, awlAp, and awlBarrel with suppressed acoustics and 4-round heavy AP punch', () => {
    const def = moddedDef('awl', new Set<ModId>(['awl50', 'awlCan', 'awlAp', 'awlBarrel']));
    expect(def.muzzle).toBe('suppressed');
    expect(def.armorPiercing).toBe(true);
    expect(def.armour).toBe('heavy');
    expect(def.magSize).toBe(4);
    expect(def.damage).toBeGreaterThanOrEqual(240);
    expect(def.sounds.some(s => s.id === 'awl50_suppressed_shot')).toBe(true);
    expect(def.sounds.some(s => s.id === 'awl_suppressed_shot')).toBe(false);

    // Plain Awl + awlCan without awl50 keeps its standard suppressed scout report.
    const plainSuppressed = moddedDef('awl', new Set<ModId>(['awlCan']));
    expect(plainSuppressed.sounds.some(s => s.id === 'awl_suppressed_shot')).toBe(true);
  });
});

describe('Weapons.setLoadout with mods and exclusiveMods', () => {
  it('strips ISSUED mods when exclusiveMods is true and fits the requested stealth kit', () => {
    expect(r.weapons.fitted.has('gimletAcog')).toBe(true);
    expect(r.weapons.fitted.has('smgLight')).toBe(true);
    expect([...r.weapons.fitted]).toEqual([...ISSUED]);

    const stealthMods: readonly ModId[] = ['ultramagCan', 'ultramagAp', 'gimletShort', 'gimletDot', 'gimletCan'];
    r.weapons.setLoadout(['ultramag', 'gimlet', 'knife'], 0, { mods: stealthMods, exclusiveMods: true });

    expect(r.weapons.fitted.has('gimletAcog')).toBe(false);
    expect(r.weapons.fitted.has('smgLight')).toBe(false);
    for (const m of stealthMods) expect(r.weapons.fitted.has(m), m).toBe(true);
    expect(r.weapons.fitted.size).toBe(stealthMods.length);
    expect(r.weapons.current).toBe('ultramag');
  });

  it('supports passing LoadoutOptions as the second argument and syncs modded magazine sizes', () => {
    const awlMods: readonly ModId[] = ['awl50', 'awlCan', 'awlAp', 'awlBarrel'];
    r.weapons.setLoadout(['awl'], { mods: awlMods, exclusiveMods: true });

    expect(r.weapons.current).toBe('awl');
    expect(r.weapons.ammo('awl').magSize).toBe(4);
    expect(r.weapons.ammo('awl').mag).toBe(4);
    for (const m of awlMods) expect(r.weapons.fitted.has(m)).toBe(true);
  });

  it('preserves existing behavior when called without options', () => {
    r.weapons.setLoadout(['smg', 'shotgun'], 3);
    expect([...r.weapons.fitted]).toEqual([...ISSUED]);
    expect(r.weapons.grenades).toBe(3);
    expect(r.weapons.current).toBe('smg');
  });
});

describe('Racks with mods and custom labels', () => {
  it('shows custom label on HUD marker and equips the modded .50 Cal AWL on pickup', () => {
    const scene = new THREE.Scene();
    const mat = new THREE.MeshBasicMaterial();
    const labels: string[] = [];
    const unmark = vi.fn();

    const rackCtx = {
      ...r.ctx,
      render: {
        ...r.ctx.render,
        scene,
        materials: { world: () => mat },
      },
      hud: {
        ...r.ctx.hud,
        marker: (_pos: THREE.Vector3, label: string) => {
          labels.push(label);
          return unmark;
        },
      },
    } as unknown as Ctx;

    const racks = new Racks(rackCtx);
    const awlMods: readonly ModId[] = ['awl50', 'awlCan', 'awlAp', 'awlBarrel'];
    const took = vi.fn();
    racks.add('awl', { at: [0, 0, -1] }, took, awlMods, '.50 CAL AWL (SUPPRESSED)');

    expect(labels).toEqual(['.50 CAL AWL (SUPPRESSED)']);
    expect(r.weapons.owned.has('awl')).toBe(false);

    // Player stands at origin (0, 0, 0), within REACH (1.9 m) of (0, 0, -1).
    racks.update(0.016);

    expect(took).toHaveBeenCalledTimes(1);
    expect(unmark).toHaveBeenCalledTimes(1);
    expect(r.weapons.owned.has('awl')).toBe(true);
    expect(r.weapons.current).toBe('awl');
    for (const m of awlMods) expect(r.weapons.fitted.has(m), m).toBe(true);
    expect(r.weapons.ammo('awl').magSize).toBe(4);
    expect(r.weapons.ammo('awl').mag).toBe(4);
  });
});

describe('weapon:fired suppressed flag and weapon:impact world acoustics', () => {
  it('emits suppressed: true for suppressed weapons and suppressed: false for unsuppressed weapons', () => {
    const events: { weapon: WeaponId; suppressed?: boolean }[] = [];
    const off = r.ctx.events.on('weapon:fired', e => {
      events.push({ weapon: e.weapon, suppressed: e.suppressed });
    });

    // Unsuppressed Ultramag
    r.weapons.setLoadout(['ultramag'], 0, { exclusiveMods: true });
    r.tap('fire');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ weapon: 'ultramag', suppressed: false });

    // Suppressed Ultramag
    r.weapons.setLoadout(['ultramag'], 0, { mods: ['ultramagCan'], exclusiveMods: true });
    r.run(0.5);
    r.tap('fire');
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ weapon: 'ultramag', suppressed: true });

    off();
  });

  it('emits weapon:impact with pooled position on world wall hits and not on enemy hits', () => {
    const impacts: { pos: THREE.Vector3; raw: THREE.Vector3; surface: SurfaceKind; weapon: WeaponId; suppressed: boolean }[] = [];
    const off = r.ctx.events.on('weapon:impact', e => {
      impacts.push({ pos: e.position.clone(), raw: e.position, surface: e.surface, weapon: e.weapon, suppressed: e.suppressed });
    });

    r.wall(-10, 0.5, 'metal');
    r.weapons.setLoadout(['ultramag'], 0, { mods: ['ultramagCan'], exclusiveMods: true });
    r.tap('fire');
    r.run(0.5);
    r.tap('fire');

    expect(impacts).toHaveLength(2);
    expect(impacts[0]!.surface).toBe('metal');
    expect(impacts[0]!.weapon).toBe('ultramag');
    expect(impacts[0]!.suppressed).toBe(true);
    expect(impacts[0]!.pos.z).toBeCloseTo(-10, 1);
    // Pooled Vector3: same object reference reused across shots.
    expect(impacts[0]!.raw).toBe(impacts[1]!.raw);

    // Enemy in front of the wall: should not emit world weapon:impact.
    impacts.length = 0;
    r.enemies.add(0, -5);
    r.run(0.5);
    r.tap('fire');
    expect(impacts).toHaveLength(0);

    off();
  });
});

describe('MissionRunner and GameHost stealth loadout, chip, and enemy:hit release guard', () => {
  it('forwards rack mods and label and preserves loadout mods/chip across deploys', () => {
    const mission: Mission = {
      id: 'quiet-test',
      title: 'Quiet Test',
      stealth: true,
      loadout: {
        weapons: ['ultramag', 'gimlet', 'knife'],
        grenades: 0,
        mods: ['ultramagCan', 'gimletCan'],
        exclusiveMods: true,
        chip: 'thermal',
      },
      zones: {},
      marks: { start: { at: [0, 0, 0] }, stash: { at: [5, 0, -5] } },
      routes: {},
      doors: {},
      cutscenes: {},
      lines: [],
      redeployLines: [],
      beats: [
        {
          id: 'open',
          title: 'Open',
          start: [{ do: 'rack', weapon: 'awl', at: 'stash', mods: ['awl50', 'awlCan'], label: '.50 CAL AWL' }],
          until: { signal: 'done' },
        },
      ],
    };

    const host = new FakeHost();
    const deployedLoadouts: unknown[] = [];
    host.deploy = (_at, loadout) => {
      deployedLoadouts.push(loadout);
    };
    const rackCalls: { weapon: string; mods?: readonly ModId[]; label?: string }[] = [];
    (host as MissionHost).rack = (weapon, _at, took, mods, label) => {
      rackCalls.push({ weapon, mods, label });
      host.racks.push(took);
      host.rackGuns.push(weapon);
    };

    const runner = new MissionRunner(mission, host);
    runner.start();

    expect(deployedLoadouts).toHaveLength(1);
    expect(deployedLoadouts[0]).toEqual({
      weapons: ['ultramag', 'gimlet', 'knife'],
      grenades: 0,
      mods: ['ultramagCan', 'gimletCan'],
      exclusiveMods: true,
      chip: 'thermal',
    });
    expect(rackCalls).toEqual([{ weapon: 'awl', mods: ['awl50', 'awlCan'], label: '.50 CAL AWL' }]);

    // Taking the rack and redeploying keeps both the weapon and its mods.
    host.racks[0]!();
    runner.down();
    runner.redeploy();
    expect(deployedLoadouts).toHaveLength(2);
    expect(deployedLoadouts[1]).toEqual({
      weapons: ['ultramag', 'gimlet', 'knife', 'awl'],
      grenades: 0,
      mods: ['ultramagCan', 'gimletCan', 'awl50', 'awlCan'],
      exclusiveMods: true,
      chip: 'thermal',
    });
  });

  it('GameHost.deploy fits loadout.chip and guards tag-wide release on enemy:hit when mission.stealth is true', () => {
    const rack = new ChipRack();
    const ctx = {
      ...r.ctx,
      contracts: { chips: { rack } },
    } as unknown as Ctx;
    const ui = {} as CampaignHud;
    const host = new GameHost(ctx, ui);

    const makeMission = (stealth: boolean): Mission => ({
      id: 'stealth-guard',
      title: 'Stealth Guard',
      stealth,
      loadout: { weapons: ['ultramag'], grenades: 0, mods: ['ultramagCan'], exclusiveMods: true, chip: 'thermal' },
      zones: {},
      marks: { start: { at: [0, 0, 0] } },
      routes: {},
      doors: {},
      cutscenes: {},
      lines: [],
      redeployLines: [],
      beats: [{ id: 'a', title: 'A', until: { signal: 'end' } }],
    });

    host.runner = new MissionRunner(makeMission(true), host);
    host.deploy(null, host.runner.mission.loadout);

    expect(rack.fitted).toEqual(['thermal']);
    expect(r.weapons.fitted.has('ultramagCan')).toBe(true);
    expect(r.weapons.fitted.has('gimletAcog')).toBe(false);

    // Stealth mission: enemy:hit does NOT auto-release the tagged group.
    const releaseSpy = vi.spyOn(host, 'release');
    const dummy = { uid: 42 } as unknown as Parameters<GameHost['enlist']>[0];
    host.enlist(dummy, 'patrol');
    r.ctx.events.emit('enemy:hit', { enemy: dummy, damage: {} as never, result: {} as never });
    expect(releaseSpy).not.toHaveBeenCalled();

    // Non-stealth mission: enemy:hit still auto-releases the tagged group as before.
    host.runner = new MissionRunner(makeMission(false), host);
    r.ctx.events.emit('enemy:hit', { enemy: dummy, damage: {} as never, result: {} as never });
    expect(releaseSpy).toHaveBeenCalledWith('patrol');
  });
});
