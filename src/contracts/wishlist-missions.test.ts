/** Lane K: Missions beaten twice — per-mission win counter, free starter mod persistence, mission/checkpoint application, and co-op sync. */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MISSIONS } from '../campaign/missions';
import { MissionRunner } from '../campaign/runner';
import { missionWithStarter } from '../campaign/starter';
import { FakeHost } from '../campaign/testkit';
import type { Mission } from '../campaign/types';
import { validateMission } from '../campaign/validate';
import { EventBus } from '../core/events';
import type { Ctx, GameEvents } from '../core/contracts';
import type { ModId } from '../core/gameplay';
import type { CoopSession } from '../net/index';
import { Lobby } from '../net/lobby';
import type { NetRoom } from '../net/room';
import { CoopWorld } from '../net/world';
import { eventOf } from '../net/world/pack';
import type { WorldEvent } from '../net/worldProtocol';
import { ISSUED, MODS, MOD_ORDER } from '../weapons/mods';
import { makeRange } from '../weapons/testkit';
import { isFirstLaunch } from './firstLaunch';
import {
  STARTER_MODS_KEY,
  defaultStarterMods,
  saveStarterMods,
  selectedStarterMods,
  starterGunMods,
  toggleStarterMod,
} from './starter';
import { MISSION_MOD_WINS, MISSION_WINS_KEY } from './unlocks';

function stubStorage() {
  const data = new Map<string, string>();
  const storage = {
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => { data.clear(); },
  };
  vi.stubGlobal('localStorage', storage);
  return { data, storage };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('per-mission win tracking and unlock threshold', () => {
  it('unlocks starter mods at 2 wins per mission and isolates missions from one another', async () => {
    const { data } = stubStorage();
    vi.resetModules();
    const { missionWins, recordMissionWin, missionModsUnlocked } = await import('./unlocks');

    expect(MISSION_MOD_WINS).toBe(2);
    expect(missionWins('campaign')).toBe(0);
    expect(missionModsUnlocked('campaign')).toBe(false);
    expect(missionModsUnlocked('foreclosure')).toBe(false);

    // 1st win on The Outpost: still locked
    expect(recordMissionWin('campaign')).toBe(1);
    expect(missionWins('campaign')).toBe(1);
    expect(missionModsUnlocked('campaign')).toBe(false);

    // 2nd win on The Outpost: unlocked for campaign ONLY, not foreclosure or bank_run
    expect(recordMissionWin('campaign')).toBe(2);
    expect(missionWins('campaign')).toBe(2);
    expect(missionModsUnlocked('campaign')).toBe(true);
    expect(missionWins('foreclosure')).toBe(0);
    expect(missionModsUnlocked('foreclosure')).toBe(false);
    expect(missionModsUnlocked('bank_run')).toBe(false);

    // Persisted under op2_mission_wins
    expect(JSON.parse(data.get(MISSION_WINS_KEY)!)).toEqual({ campaign: 2 });

    // 1st win on Foreclosure does not unlock it; 2nd does
    expect(recordMissionWin('foreclosure')).toBe(1);
    expect(missionModsUnlocked('foreclosure')).toBe(false);
    expect(recordMissionWin('foreclosure')).toBe(2);
    expect(missionModsUnlocked('foreclosure')).toBe(true);
    expect(JSON.parse(data.get(MISSION_WINS_KEY)!)).toEqual({ campaign: 2, foreclosure: 2 });
  });

  it('survives blocked storage using in-session tracking', async () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    });
    vi.resetModules();
    const { missionWins, recordMissionWin, missionModsUnlocked } = await import('./unlocks');
    expect(missionWins('bank_run')).toBe(0);
    expect(recordMissionWin('bank_run')).toBe(1);
    expect(missionModsUnlocked('bank_run')).toBe(false);
    expect(recordMissionWin('bank_run')).toBe(2);
    expect(missionModsUnlocked('bank_run')).toBe(true);
  });
});

describe('per-gun starter mod persistence and slot exclusion', () => {
  it('defaults to ISSUED mods per gun when nothing is saved', () => {
    stubStorage();
    expect(defaultStarterMods('gimlet')).toEqual(['gimletAcog', 'gimletCan']);
    expect(defaultStarterMods('smg')).toEqual(['smgLight']);
    expect(defaultStarterMods('harrow')).toEqual([]);
    expect(selectedStarterMods('gimlet')).toEqual(['gimletAcog', 'gimletCan']);
    expect(selectedStarterMods('smg')).toEqual(['smgLight']);
    expect(selectedStarterMods('harrow')).toEqual([]);
  });

  it('enforces same-slot exclusion while stacking different slots and slot-free mods', () => {
    stubStorage();

    // Gimlet starts with ACOG (sight) + Suppressor (no slot).
    let mods = selectedStarterMods('gimlet');
    // Picking Red dot (sight) replaces ACOG, keeps Suppressor.
    mods = toggleStarterMod(mods, 'gimlet', 'gimletDot');
    expect(mods).toEqual(['gimletDot', 'gimletCan']);

    // Stacking barrel + ammo + loader + slot-free mods (launcher, light) all coexist.
    mods = toggleStarterMod(mods, 'gimlet', 'gimletLong');
    mods = toggleStarterMod(mods, 'gimlet', 'gimletAp');
    mods = toggleStarterMod(mods, 'gimlet', 'gimletMagwell');
    mods = toggleStarterMod(mods, 'gimlet', 'gimletGl');
    mods = toggleStarterMod(mods, 'gimlet', 'gimletLight');
    expect(mods).toEqual(
      MOD_ORDER.filter(id =>
        (['gimletDot', 'gimletCan', 'gimletGl', 'gimletAp', 'gimletLong', 'gimletLight', 'gimletMagwell'] as ModId[]).includes(id),
      ),
    );

    // Switching barrel replaces Long barrel with Short barrel.
    mods = toggleStarterMod(mods, 'gimlet', 'gimletShort');
    expect(mods).toContain('gimletShort');
    expect(mods).not.toContain('gimletLong');

    // Switching ammo replaces AP with +P.
    mods = toggleStarterMod(mods, 'gimlet', 'gimletPlusP');
    expect(mods).toContain('gimletPlusP');
    expect(mods).not.toContain('gimletAp');

    // Toggling an already-fitted mod removes it.
    mods = toggleStarterMod(mods, 'gimlet', 'gimletCan');
    expect(mods).not.toContain('gimletCan');

    // Foreign weapon mods are ignored.
    const before = [...mods];
    expect(toggleStarterMod(mods, 'gimlet', 'smgMag')).toEqual(before);
    expect(toggleStarterMod(mods, 'gimlet', 'harrowMag')).toEqual(before);
  });

  it('persists per gun independently, respects explicit empty selection, and counts as progress in firstLaunch', () => {
    const { data, storage } = stubStorage();
    expect(isFirstLaunch(storage)).toBe(true);

    // Save custom mods for Harrow and explicitly strip all mods off Gimlet.
    saveStarterMods('harrow', ['harrowAcog', 'harrowShort', 'harrowBrake', 'harrowMag', 'harrowApi', 'harrowMagwell']);
    saveStarterMods('gimlet', []);

    expect(selectedStarterMods('harrow')).toEqual(
      MOD_ORDER.filter(id =>
        (['harrowAcog', 'harrowShort', 'harrowBrake', 'harrowMag', 'harrowApi', 'harrowMagwell'] as ModId[]).includes(id),
      ),
    );
    // Explicit empty selection stays empty (does NOT revert to ISSUED ACOG + Can).
    expect(selectedStarterMods('gimlet')).toEqual([]);
    // Untouched SMG still gets its issued default.
    expect(selectedStarterMods('smg')).toEqual(['smgLight']);

    // Stored under op2_starter_mods and recognized by firstLaunch progress list.
    expect(data.has(STARTER_MODS_KEY)).toBe(true);
    expect(isFirstLaunch(storage)).toBe(false);

    // Clearing progress keys resets back to first launch & issued defaults.
    storage.clear();
    expect(isFirstLaunch(storage)).toBe(true);
    expect(selectedStarterMods('gimlet')).toEqual(['gimletAcog', 'gimletCan']);
    expect(selectedStarterMods('harrow')).toEqual([]);

    // op2_mission_wins alone also counts as progress in firstLaunch.
    storage.setItem(MISSION_WINS_KEY, JSON.stringify({ campaign: 2 }));
    expect(isFirstLaunch(storage)).toBe(false);
  });

  it('lists all mods for each starter gun from MOD_ORDER', () => {
    for (const gun of ['smg', 'gimlet', 'harrow'] as const) {
      const expected = MOD_ORDER.filter(id => MODS[id].weapon === gun);
      expect(starterGunMods(gun)).toEqual(expected);
      expect(expected.length).toBeGreaterThanOrEqual(9);
    }
  });
});

describe('missionWithStarter with custom starter mods', () => {
  it('applies custom starter mods to mission start and every checkpoint while keeping validation clean', () => {
    const custom: ModId[] = ['harrowAcog', 'harrowShort', 'harrowBrake', 'harrowMag', 'harrowAp'];
    for (const id of ['outpost', 'foreclosure'] as const) {
      const source = MISSIONS[id]!;
      const mission = missionWithStarter(source, 'harrow', custom);
      expect(validateMission(mission)).toEqual([]);
      expect(mission.loadout.weapons[0]).toBe('harrow');
      expect(mission.loadout.mods).toEqual(MOD_ORDER.filter(m => custom.includes(m)));
      expect(mission.loadout.exclusiveMods).toBe(true);

      let checkpointsChecked = 0;
      for (const beat of mission.beats) {
        if (!beat.checkpoint) continue;
        checkpointsChecked++;
        expect(beat.checkpoint.loadout.weapons).toContain('harrow');
        expect(beat.checkpoint.loadout.mods).toEqual(MOD_ORDER.filter(m => custom.includes(m)));
        expect(beat.checkpoint.loadout.exclusiveMods).toBe(true);
      }
      expect(checkpointsChecked).toBeGreaterThan(0);

      // Source mission is never mutated.
      expect(source.loadout.mods).toBeUndefined();
      expect(source.loadout.exclusiveMods).toBeUndefined();
    }
  });

  it('preserves fixed non-starter mods on loadouts and checkpoints', () => {
    const base: Mission = {
      id: 'fixed-mod-test',
      title: 'Fixed Mod Test',
      loadout: { weapons: ['smg', 'ultramag', 'sword'], grenades: 2, mods: ['ultramagCan', 'smgLight'] },
      zones: {},
      marks: { start: { at: [0, 0, 0] }, mid: { at: [10, 0, 0] } },
      routes: {},
      doors: {},
      cutscenes: {},
      lines: [],
      redeployLines: [],
      beats: [
        { id: 'a', title: 'A', until: { signal: 'next' } },
        {
          id: 'b',
          title: 'B',
          checkpoint: { at: 'mid', loadout: { weapons: ['smg', 'ultramag', 'sword'], grenades: 3, mods: ['ultramagCan'] } },
        },
      ],
    };
    const adapted = missionWithStarter(base, 'gimlet', ['gimletDot', 'gimletLong']);
    expect(adapted.loadout.mods).toEqual(['ultramagCan', 'gimletDot', 'gimletLong']);
    expect(adapted.loadout.exclusiveMods).toBe(true);
    expect(adapted.beats[1]!.checkpoint!.loadout.mods).toEqual(['ultramagCan', 'gimletDot', 'gimletLong']);
    expect(adapted.beats[1]!.checkpoint!.loadout.exclusiveMods).toBe(true);
  });

  it('equips custom starter mods via Weapons.setLoadout, strips unchosen ISSUED mods, and updates mag size', async () => {
    const r = await makeRange();
    r.reset();
    expect([...r.weapons.fitted]).toEqual([...ISSUED]);

    const source = MISSIONS.outpost!;
    const mission = missionWithStarter(source, 'harrow', ['harrowAcog', 'harrowMag', 'harrowShort']);
    r.weapons.setLoadout(mission.loadout.weapons, mission.loadout.grenades, {
      mods: mission.loadout.mods,
      exclusiveMods: mission.loadout.exclusiveMods,
    });

    expect(r.weapons.current).toBe('harrow');
    expect(r.weapons.fitted.has('harrowAcog')).toBe(true);
    expect(r.weapons.fitted.has('harrowMag')).toBe(true);
    expect(r.weapons.fitted.has('harrowShort')).toBe(true);
    // Unchosen ISSUED mods are cleared cleanly.
    expect(r.weapons.fitted.has('gimletAcog')).toBe(false);
    expect(r.weapons.fitted.has('gimletCan')).toBe(false);
    expect(r.weapons.fitted.has('smgLight')).toBe(false);
    // Extended Harrow mag (40 rounds) is synced immediately.
    expect(r.weapons.ammo('harrow').magSize).toBe(40);
    expect(r.weapons.ammo('harrow').mag).toBe(40);

    // Stripping all mods off Gimlet leaves Gimlet genuinely stock (no ACOG, no suppressor).
    const stockGimlet = missionWithStarter(source, 'gimlet', []);
    r.weapons.setLoadout(stockGimlet.loadout.weapons, stockGimlet.loadout.grenades, {
      mods: stockGimlet.loadout.mods,
      exclusiveMods: stockGimlet.loadout.exclusiveMods,
    });
    expect(r.weapons.current).toBe('gimlet');
    expect(r.weapons.fitted.size).toBe(0);
  });
});

describe('co-op starter mods deployment and held sync', () => {
  class Relay {
    readonly rooms: Room[] = [];
    readonly queue: (() => void)[] = [];
    readonly packets: { from: string; to?: string; lane: string; data: unknown }[] = [];
    open(id: string): Room {
      const room = new Room(id, this);
      for (const peer of this.rooms) this.queue.push(() => { peer.join(id); room.join(peer.id); });
      this.rooms.push(room);
      return room;
    }
    flush(): void { while (this.queue.length) this.queue.shift()!(); }
  }
  class Room implements NetRoom {
    readonly handlers = new Map<string, (data: unknown, from: string) => void>();
    join: (id: string) => void = () => {};
    constructor(readonly id: string, private readonly relay: Relay) {}
    channel<T>(lane: string) {
      return {
        on: (handler: (data: T, from: string) => void) => this.handlers.set(lane, handler as (data: unknown, from: string) => void),
        send: (data: T, to?: string) => {
          this.relay.packets.push({ from: this.id, to, lane, data: structuredClone(data) });
          for (const peer of this.relay.rooms) if (peer !== this && (!to || peer.id === to)) {
            const copied = structuredClone(data);
            this.relay.queue.push(() => peer.handlers.get(lane)?.(copied, this.id));
          }
        },
      };
    }
    onPeerJoin(handler: (id: string) => void) { this.join = handler; }
    onPeerLeave() {}
    onError() {}
    leave() {}
  }

  function makeCtx(fitted: Set<ModId>, current: 'smg' | 'gimlet' | 'harrow' = 'smg') {
    const events = new EventBus<GameEvents>();
    const player = {
      position: new THREE.Vector3(), eye: new THREE.Vector3(0, 1.6, 0), forward: new THREE.Vector3(0, 0, -1), yaw: 0,
      velocity: new THREE.Vector3(), alive: true, health: 100, maxHealth: 100, armor: 0, grounded: true, downed: false, parked: false,
      reset: vi.fn(), teleport: vi.fn(), takeDamage: vi.fn(),
    };
    const owned = new Set<string>([current]);
    return {
      events, player, enemies: { alive: [], spawn: vi.fn(), withdraw: vi.fn() }, waves: { wave: 1 },
      physics: { raycast: vi.fn(() => null) },
      weapons: { current, owned, fitted, ammo: () => ({ mag: 30, reserve: 90 }), give: vi.fn((w: string) => owned.add(w)) },
      world: { playerSpawns: [{ position: new THREE.Vector3(), yaw: 0 }] },
      hud: { feed: vi.fn(), follow: vi.fn(() => () => {}), callout: vi.fn(), banner: vi.fn() },
      time: { dt: 0.016, realDt: 0.25, frame: 0 },
      progression: { kills: 0, score: 0, headshots: 0, resume: vi.fn() },
      contracts: { wallet: { credits: 0 } },
      camera: { setSeat: vi.fn(), addTrauma: vi.fn() },
      input: { pressed: vi.fn(() => false), isDown: vi.fn(() => false) },
      fx: { tracer: vi.fn() }, gore: {}, audio: { play: vi.fn() }, combat: {},
    } as unknown as Ctx;
  }

  it('applies each guest’s own unlocked starter mods instead of the host’s, and broadcasts them via held', () => {
    const { storage } = stubStorage();
    storage.setItem(MISSION_WINS_KEY, JSON.stringify({ campaign: 2 }));
    storage.setItem('op2_starter', 'smg');
    saveStarterMods('smg', ['suppressor', 'smgMag']);

    const baseMission: Mission = {
      id: 'coop-mods',
      title: 'Co-op Mods',
      loadout: { weapons: ['smg', 'sword'], grenades: 1 },
      zones: {},
      marks: { start: { at: [0, 0, 0] } },
      routes: {},
      doors: {},
      cutscenes: {},
      lines: [],
      redeployLines: [],
      beats: [{ id: 'open', title: 'Open', until: { signal: 'done' } }],
    };
    // Host has different starter + mods (Harrow + harrowShort + harrowMag).
    const hostMission = missionWithStarter(baseMission, 'harrow', ['harrowShort', 'harrowMag']);

    const relay = new Relay();
    const hr = relay.open('host-peer');
    const hostLobby = new Lobby({ main: hr, door: () => new Room('door', new Relay()) }, true, 'HOST', 'test');
    const gr = relay.open('guest-peer');
    const guestLobby = new Lobby({ main: gr, door: () => new Room('door', new Relay()) }, false, 'GUEST', 'test');
    relay.flush();
    hostLobby.startMatch('campaign', 'm-mods');
    relay.flush();

    const hostFitted = new Set<ModId>(['harrowShort', 'harrowMag']);
    const guestFitted = new Set<ModId>();
    const hostCtx = makeCtx(hostFitted, 'harrow');
    const guestCtx = makeCtx(guestFitted, 'smg');

    const hostFake = new FakeHost();
    const guestFake = new FakeHost();
    const guestDeploys: unknown[] = [];
    guestFake.deploy = (_at, kit) => {
      const full = kit as { weapons: readonly string[]; grenades?: number; mods?: readonly ModId[]; exclusiveMods?: boolean };
      guestDeploys.push(full);
      guestFitted.clear();
      for (const m of full.mods ?? []) guestFitted.add(m);
    };

    const makeCamp = (m: Mission, h: FakeHost) => {
      const runner = new MissionRunner(m, h);
      return { active: true, host: h, runner, ui: { votes: vi.fn(), beat: vi.fn() }, provide(p: object) { Object.assign(h, p); }, tally: () => ({ title: m.title, seconds: 0, deaths: 0, vehicles: 0, unlocked: false }) };
    };
    const hc = makeCamp(hostMission, hostFake);
    const gc = makeCamp(baseMission, guestFake);

    const hs = { lobby: hostLobby, hosting: true, match: hostLobby.match, remotes: new Map() } as unknown as CoopSession;
    const gs = { lobby: guestLobby, hosting: false, match: guestLobby.match, remotes: new Map() } as unknown as CoopSession;
    Object.assign(hostCtx, { campaign: hc, coop: hs });
    Object.assign(guestCtx, { campaign: gc, coop: gs });
    const hw = new CoopWorld(hostCtx, hs);
    const gw = new CoopWorld(guestCtx, gs);
    Object.assign(hs, { world: hw });
    Object.assign(gs, { world: gw });
    hw.begin();
    gw.begin();

    hc.runner.start();
    relay.flush();

    // Guest received its own SMG + custom mods (suppressor, smgMag), NOT the host's Harrow mods.
    expect(guestDeploys).toHaveLength(1);
    expect(guestDeploys[0]).toEqual({
      weapons: ['smg', 'sword'],
      grenades: 1,
      mods: ['suppressor', 'smgMag'],
      exclusiveMods: true,
    });

    // Updating the co-op worlds broadcasts each player's fitted starter mods via `held` events.
    hw.update();
    gw.update();
    relay.flush();
    const heldFromGuest = relay.packets
      .filter(p => p.from === 'guest-peer' && p.lane === 'action')
      .map(p => eventOf<WorldEvent>(p.data))
      .filter((ev): ev is Extract<WorldEvent, { t: 'held' }> => ev.t === 'held');
    expect(heldFromGuest).toContainEqual({ t: 'held', weapon: 'smg', mods: ['smgMag', 'suppressor'] });

    const heldFromHost = relay.packets
      .filter(p => p.from === 'host-peer' && p.lane === 'action')
      .map(p => eventOf<WorldEvent>(p.data))
      .filter((ev): ev is Extract<WorldEvent, { t: 'held' }> => ev.t === 'held');
    expect(heldFromHost).toContainEqual({ t: 'held', weapon: 'harrow', mods: ['harrowMag', 'harrowShort'], slot: 0 });

    hw.dispose();
    gw.dispose();
  });

  it('never leaks host custom starter mods to a guest who has not unlocked mods on that mission', () => {
    const { storage } = stubStorage();
    // Guest has 0 wins on foreclosure and picked Gimlet.
    storage.setItem('op2_starter', 'gimlet');

    const baseMission: Mission = {
      id: 'coop-locked',
      title: 'Co-op Locked',
      loadout: { weapons: ['smg', 'sword'], grenades: 1 },
      zones: {},
      marks: { start: { at: [0, 0, 0] } },
      routes: {},
      doors: {},
      cutscenes: {},
      lines: [],
      redeployLines: [],
      beats: [{ id: 'open', title: 'Open', until: { signal: 'done' } }],
    };
    const hostMission = missionWithStarter(baseMission, 'harrow', ['harrowShort', 'harrowMag']);

    const relay = new Relay();
    const hr = relay.open('host-peer');
    const hostLobby = new Lobby({ main: hr, door: () => new Room('door', new Relay()) }, true, 'HOST', 'test');
    const gr = relay.open('guest-peer');
    const guestLobby = new Lobby({ main: gr, door: () => new Room('door', new Relay()) }, false, 'GUEST', 'test');
    relay.flush();
    hostLobby.startMatch('foreclosure', 'm-locked');
    relay.flush();

    const hostCtx = makeCtx(new Set<ModId>(), 'harrow');
    const guestCtx = makeCtx(new Set<ModId>(), 'gimlet');
    const hostFake = new FakeHost();
    const guestFake = new FakeHost();
    const guestDeploys: unknown[] = [];
    guestFake.deploy = (_at, kit) => guestDeploys.push(kit);

    const makeCamp = (m: Mission, h: FakeHost) => {
      const runner = new MissionRunner(m, h);
      return { active: true, host: h, runner, ui: { votes: vi.fn(), beat: vi.fn() }, provide(p: object) { Object.assign(h, p); }, tally: () => ({ title: m.title, seconds: 0, deaths: 0, vehicles: 0, unlocked: false }) };
    };
    const hc = makeCamp(hostMission, hostFake);
    const gc = makeCamp(baseMission, guestFake);

    const hs = { lobby: hostLobby, hosting: true, match: hostLobby.match, remotes: new Map() } as unknown as CoopSession;
    const gs = { lobby: guestLobby, hosting: false, match: guestLobby.match, remotes: new Map() } as unknown as CoopSession;
    Object.assign(hostCtx, { campaign: hc, coop: hs });
    Object.assign(guestCtx, { campaign: gc, coop: gs });
    const hw = new CoopWorld(hostCtx, hs);
    const gw = new CoopWorld(guestCtx, gs);
    Object.assign(hs, { world: hw });
    Object.assign(gs, { world: gw });
    hw.begin();
    gw.begin();

    hc.runner.start();
    relay.flush();

    // Locked guest keeps default issued Gimlet behavior (no host Harrow mods, no exclusiveMods stripping ISSUED).
    expect(guestDeploys).toEqual([{ weapons: ['gimlet', 'sword'], grenades: 1 }]);

    hw.dispose();
    gw.dispose();
  });
});
