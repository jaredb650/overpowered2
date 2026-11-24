/**
 * End-to-end co-op tests for the new survival modes (Rooftop, Badlands, Dogfight),
 * all 13 player-driveable vehicles + Badlands Motor Pool handoff + guest hijacking,
 * Rooftop/Badlands enemy utility helicopters, and Dogfight AI jets / carrier sync.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type RAPIER from '@dimforge/rapier3d-compat';
import { EventBus } from '../../core/events';
import type { Ctx, GameEvents } from '../../core/contracts';
import type { AiCombatJet } from '../../enemies/dogfight/aiJet';
import type { DogfightNetBridge, DogfightWaves } from '../../enemies/dogfight/waves';
import type { ExtraTarget, VehicleSystem } from '../../enemies/vehicles';
import { ClaimValidator } from '../authority';
import { WORLD_MODES } from '../index';
import { COOP_MODES } from '../lobby';
import type { WorldEvent } from '../worldProtocol';
import type { WorldContext } from './context';
import { creditRule } from './credit';
import { DogfightSync } from './dogfight';
import { Driveables } from './driveables';
import type { Replicas } from './replicas';
import { Router } from './router';
import { Vehicles } from './vehicles';

interface FakePeer {
  w: WorldContext;
  scene: THREE.Scene;
  events: EventBus<GameEvents>;
  sent: { event: WorldEvent; to?: string }[];
  sideHandlers: Map<number, (value: unknown, now: number) => void>;
  remotes: Map<string, {
    inVehicle: boolean;
    root: THREE.Group;
    tag: THREE.Vector3;
  }>;
  setRemoteClaim: ReturnType<typeof vi.fn>;
  releaseRemoteClaim: ReturnType<typeof vi.fn>;
  completeHijack: ReturnType<typeof vi.fn>;
  boardRemoteVehicle: ReturnType<typeof vi.fn>;
  ejectRemoteVehicle: ReturnType<typeof vi.fn>;
  tracers: ReturnType<typeof vi.fn>;
  smoke: ReturnType<typeof vi.fn>;
  sparks: ReturnType<typeof vi.fn>;
  extras: Set<ExtraTarget>;
  applyGuestState: ReturnType<typeof vi.fn>;
  applyGuestShatter: ReturnType<typeof vi.fn>;
  requestBuyUpgrade: ReturnType<typeof vi.fn>;
  requestNextWave: ReturnType<typeof vi.fn>;
  triggerGuestFlares: ReturnType<typeof vi.fn>;
  tickGuest: ReturnType<typeof vi.fn>;
  netBridge: DogfightNetBridge | null;
}

function makeFakeReplicas(): Replicas {
  return {
    get: () => undefined,
    pin: vi.fn(),
    unpin: vi.fn(),
  } as unknown as Replicas;
}

function makeWorldPair() {
  const players = [
    { id: 'host', name: 'HOST', slot: 0, host: true },
    { id: 'guest1', name: 'WINGMAN', slot: 1, host: false },
  ];

  const makeSide = (hosting: boolean): FakePeer => {
    const scene = new THREE.Scene();
    const events = new EventBus<GameEvents>();
    const router = new Router();
    const sideHandlers = new Map<number, (value: unknown, now: number) => void>();
    const sent: { event: WorldEvent; to?: string }[] = [];
    const extras = new Set<ExtraTarget>();

    const setRemoteClaim = vi.fn();
    const releaseRemoteClaim = vi.fn();
    const completeHijack = vi.fn();
    const boardRemoteVehicle = vi.fn();
    const ejectRemoteVehicle = vi.fn();
    const tracers = vi.fn();
    const smoke = vi.fn();
    const sparks = vi.fn();
    const applyGuestState = vi.fn();
    const applyGuestShatter = vi.fn();
    const requestBuyUpgrade = vi.fn(() => true);
    const requestNextWave = vi.fn();
    const triggerGuestFlares = vi.fn();
    const tickGuest = vi.fn();

    const remotes = new Map<string, {
      inVehicle: boolean;
      root: THREE.Group;
      tag: THREE.Vector3;
    }>();
    const otherId = hosting ? 'guest1' : 'host';
    remotes.set(otherId, {
      inVehicle: false,
      root: new THREE.Group(),
      tag: new THREE.Vector3(),
    });

    let nextHandle = 500;
    const peer: FakePeer = {
      w: null as unknown as WorldContext,
      scene,
      events,
      sent,
      sideHandlers,
      remotes,
      setRemoteClaim,
      releaseRemoteClaim,
      completeHijack,
      boardRemoteVehicle,
      ejectRemoteVehicle,
      tracers,
      smoke,
      sparks,
      extras,
      applyGuestState,
      applyGuestShatter,
      requestBuyUpgrade,
      requestNextWave,
      triggerGuestFlares,
      tickGuest,
      netBridge: null,
    };

    const driveablesMgr = {
      active: null as unknown,
      get remoteRidden() {
        const a = this.active as { isRemoteDriven?: boolean } | null;
        return a && a.isRemoteDriven ? a : null;
      },
      setRemoteClaim,
      releaseRemoteClaim,
      completeHijack,
      boardRemoteVehicle,
      ejectRemoteVehicle,
    };

    const vehiclesSys = {
      live: [] as unknown[],
      addExtra: (t: ExtraTarget) => { extras.add(t); },
      removeExtra: (t: ExtraTarget) => { extras.delete(t); },
      hijack: vi.fn(),
      fleet: {
        ground: () => ({
          root: new THREE.Group(),
          wheels: [],
          steered: [],
        }),
      },
    } as unknown as VehicleSystem;

    const dogfightWaves = {
      wave: 2,
      phase: 'clearing' as const,
      remaining: 5,
      nextWaveIn: 0,
      carrier: {
        hp: 3400,
        maxHp: 4000,
        credits: 650,
        destroyed: false,
        ciwsLevel: 2,
        samLevel: 1,
        armorLevel: 0,
        wingmanLevel: 0,
      },
      wreckage: {
        shatter: vi.fn(),
      },
      enemies: [] as AiCombatJet[],
      allies: [] as AiCombatJet[],
      setNetBridge(bridge: DogfightNetBridge | null) {
        peer.netBridge = bridge;
      },
      applyGuestState,
      applyGuestShatter,
      requestBuyUpgrade,
      requestNextWave,
      triggerGuestFlares,
      tickGuest,
    } as unknown as DogfightWaves;

    const ctx = {
      time: { dt: 0.016, elapsed: 10 },
      events,
      render: {
        scene,
        materials: { patch: <T>(m: T) => m },
        lights: { flash: vi.fn() },
      },
      audio: {
        play: vi.fn(),
        startLoop: () => ({ stop: vi.fn(), setPosition: vi.fn(), setPitch: vi.fn(), setVolume: vi.fn() }),
      },
      hud: {
        follow: () => vi.fn(),
        hitMarker: vi.fn(),
        feed: vi.fn(),
        floatText: vi.fn(),
      },
      fx: {
        tracer: tracers,
        muzzleFlash: vi.fn(),
        smoke,
        sparks,
        embers: vi.fn(),
        explosion: vi.fn(),
        attachEmitter: () => ({ stop: vi.fn() }),
      },
      physics: {
        addStaticBox: () => ({
          handle: nextHandle++,
          setTranslation: vi.fn(),
          setRotation: vi.fn(),
        }),
        world: { removeCollider: vi.fn() },
      },
      player: {
        alive: true,
        parked: false,
        position: new THREE.Vector3(0, 20, 0),
        eye: new THREE.Vector3(0, 21.6, 0),
        takeDamage: vi.fn(),
      },
      progression: {
        driveables: driveablesMgr,
      },
      enemies: {
        vehicles: vehiclesSys,
      },
      waves: dogfightWaves,
    } as unknown as Ctx;

    const me = hosting ? players[0]! : players[1]!;
    const w = {
      ctx,
      hosting,
      ready: true,
      router,
      validator: new ClaimValidator(),
      session: {
        hosting,
        lobby: {
          you: me.id,
          me,
          players,
        },
        remotes: {
          get: (id: string) => remotes.get(id),
        },
      },
      send: (event: WorldEvent, to?: string) => {
        sent.push({ event, to });
      },
      relay: (event: WorldEvent) => {
        sent.push({ event });
      },
      side: (kind: number, handler: (value: unknown, now: number) => void) => {
        sideHandlers.set(kind, handler);
      },
      sendSide: vi.fn(),
      playerOf: (from: string, slot?: number) => {
        if (hosting) return players.find(p => p.id === from) ?? null;
        return players.find(p => p.slot === slot) ?? players.find(p => p.id === from) ?? null;
      },
    } as unknown as WorldContext;

    peer.w = w;
    return peer;
  };

  const host = makeSide(true);
  const guest = makeSide(false);

  // Wire sendSide from host directly into guest's sideHandlers!
  (host.w.sendSide as ReturnType<typeof vi.fn>).mockImplementation((kind: number, value: unknown) => {
    guest.sideHandlers.get(kind)?.(value, performance.now());
  });

  const deliver = (fromPeer: FakePeer, toPeer: FakePeer, now = 1000) => {
    const batch = fromPeer.sent.splice(0, fromPeer.sent.length);
    const fromId = fromPeer.w.session.lobby.you;
    for (const { event } of batch) {
      toPeer.w.router.dispatch(event, fromId, toPeer.w.hosting, now);
    }
  };

  return { host, guest, deliver };
}

describe('co-op modes, authority, and credit rules for new maps & vehicles', () => {
  it('registers rooftop, badlands, and dogfight in COOP_MODES and WORLD_MODES (not freeRoam)', () => {
    expect(COOP_MODES).toContain('rooftop');
    expect(COOP_MODES).toContain('badlands');
    expect(COOP_MODES).toContain('dogfight');
    for (const mode of COOP_MODES) {
      expect(WORLD_MODES, `${mode} must be in WORLD_MODES so waves & enemies spawn in co-op`).toContain(mode);
    }
  });

  it('ClaimValidator accepts all 13 drivable vehicle weapon prefixes while vehicle/callIn is active', () => {
    const v = new ClaimValidator();
    v.callIn('guest1', 1000);
    const prefixes = [
      'viper_lance',
      'moto_smg',
      'quad_hmg',
      'jackal_auto_agl',
      'aegis_cannon',
      'bastion_shell',
      'kestrel_rotary',
      'valkyrie_cannon',
      'harrier_cannon',
      'warthog_gau8',
      'raptor_vulcan',
      'hornet_m61',
      'lancer_dump_burn',
    ];
    let shot = 1;
    for (const source of prefixes) {
      const verdict = v.check(
        'guest1',
        {
          t: 'hit',
          target: 100 + shot,
          shot: shot++,
          at: 1200 + shot * 20,
          origin: [0, 80, 0],
          damage: {
            amount: 90,
            type: 'bullet',
            point: [450, 80, 0],
            dir: [1, 0, 0],
            force: 5,
            source,
          },
        },
        1200 + shot * 20,
        {
          eye: [0, 80, 0],
          target: [450, 80, 0],
          down: false,
          visible: () => true,
        },
      );
      expect(verdict.ok, `${source}: ${!verdict.ok ? verdict.why : 'ok'}`).toBe(true);
    }
  });

  it('creditRule classifies all new Dogfight enemy sources and drivable vehicle sources', () => {
    for (const enemySrc of ['carrier_destroyed', 'enemy_rocket', 'enemy_jet_gun', 'enemy_aam']) {
      expect(creditRule(enemySrc), enemySrc).toBe('linger');
    }
    for (const playerSrc of ['viper_overcharge', 'viper_lance', 'viper_lance_blast', 'jackal_auto_agl', 'jackal_auto_turret', 'lancer_dump_burn', 'hornet_cannon', 'raptor_missile', 'aegis_mg']) {
      expect(creditRule(playerSrc), playerSrc).toBe('player');
    }
  });
});

describe('Driveables co-op sync (13 vehicles + Badlands Motor Pool + guest hijacking)', () => {
  it('syncs occupied vehicle pose, hides driver avatar, claims & releases Badlands Motor Pool slots, and replays FX', () => {
    const { host, guest, deliver } = makeWorldPair();
    const hostVehicles = new Vehicles(host.w, makeFakeReplicas());
    const guestVehicles = new Vehicles(guest.w, makeFakeReplicas());
    const hostDrive = new Driveables(host.w, hostVehicles);
    const guestDrive = new Driveables(guest.w, guestVehicles);

    // Host boards the Badlands Motor Pool Jackal.
    const mgr = (host.w.ctx.progression as unknown as { driveables: { active: unknown } }).driveables;
    mgr.active = {
      def: { id: 'jackal' },
      poolSlot: 'motorpool.jackal',
      wirePose: (out: number[]) => {
        out.length = 0;
        out.push(42, 3, -18, 1.25, 0.05, -0.02, 0.4, 0.1, 0.15, 2.2, 0, 0, 1);
        return out;
      },
    };

    hostDrive.update(1000);
    deliver(host, guest, 1000);

    expect(guestDrive.remoteCount).toBe(1);
    const puppet = guestDrive.puppet(0);
    expect(puppet?.id).toBe('jackal');
    expect(puppet?.pool).toBe('motorpool.jackal');
    expect(puppet?.position).toEqual([42, 3, -18]);
    expect(guest.remotes.get('host')?.inVehicle).toBe(true);
    expect(guest.setRemoteClaim).toHaveBeenCalledWith('motorpool.jackal', true);

    // Host fires hitscan gun -> guest replays tracer.
    host.events.emit('vehicle:fx', {
      kind: 'ray',
      from: new THREE.Vector3(42, 4, -18),
      to: new THREE.Vector3(80, 4, -18),
      tracer: 'heavy',
      flash: 'hmg',
    });
    deliver(host, guest, 1050);
    expect(guest.tracers).toHaveBeenCalledTimes(1);

    // Host pops IR flares -> guest replays flare sparks & smoke.
    host.events.emit('dogfight:player_flares', { position: new THREE.Vector3(42, 40, -18) });
    deliver(host, guest, 1080);
    expect(guest.sparks).toHaveBeenCalled();
    expect(guest.smoke).toHaveBeenCalled();

    // Host dismounts -> guest removes puppet, reveals avatar, and parks Badlands Motor Pool Jackal at exit pose.
    mgr.active = null;
    hostDrive.update(1200);
    deliver(host, guest, 1200);

    expect(guestDrive.remoteCount).toBe(0);
    expect(guest.remotes.get('host')?.inVehicle).toBe(false);
    expect(guest.releaseRemoteClaim).toHaveBeenCalledWith(
      'motorpool.jackal',
      expect.objectContaining({ x: 42, y: 3, z: -18 }),
      1.25,
    );

    hostDrive.dispose();
    guestDrive.dispose();
  });

  it('lets a guest hijack a host-owned enemy vehicle via vhijack -> vhijackok', () => {
    const { host, guest, deliver } = makeWorldPair();
    const hostVehicles = new Vehicles(host.w, makeFakeReplicas());
    const guestVehicles = new Vehicles(guest.w, makeFakeReplicas());
    const hostDrive = new Driveables(host.w, hostVehicles);
    const guestDrive = new Driveables(guest.w, guestVehicles);

    // Put a live humvee on the host and stream it once so it gets wire id = 1.
    const liveHumvee = {
      uid: 77,
      def: { kind: 'humvee' },
      alive: true,
      health: 220,
      position: new THREE.Vector3(10, 0, 20),
      quaternion: new THREE.Quaternion(),
    };
    (host.w.ctx.enemies.vehicles as unknown as { live: unknown[]; hijack: ReturnType<typeof vi.fn> }).live.push(liveHumvee);
    (host.w.ctx.enemies.vehicles as unknown as { hijack: ReturnType<typeof vi.fn> }).hijack.mockReturnValue({
      kind: 'humvee',
      position: new THREE.Vector3(10, 0, 20),
      yaw: 0.75,
      velocity: new THREE.Vector3(0, 0, 4),
      healthFraction: 0.82,
    });
    hostVehicles.update(1000);

    // Guest discovers the replicated humvee and requests hijack by its wire id.
    const found = guestDrive.findGuestHijackable(new THREE.Vector3(9, 0, 20), 10);
    expect(found).not.toBeNull();
    guestDrive.requestVehicleHijack(found!.id, true);
    deliver(guest, host, 1500);
    deliver(host, guest, 1510);

    expect(guest.completeHijack).toHaveBeenCalledTimes(1);
    expect(guest.completeHijack).toHaveBeenCalledWith(
      'humvee',
      expect.objectContaining({ x: 10, y: 0, z: 20 }),
      0.75,
      expect.objectContaining({ x: 0, y: 0, z: 4 }),
      0.82,
      true,
    );

    hostDrive.dispose();
    guestDrive.dispose();
  });

  it('catches up late joiners and cleans up puppets on lostSeat', () => {
    const { host, guest, deliver } = makeWorldPair();
    const hostDrive = new Driveables(host.w, new Vehicles(host.w, makeFakeReplicas()));
    const guestDrive = new Driveables(guest.w, new Vehicles(guest.w, makeFakeReplicas()));

    const mgr = (host.w.ctx.progression as unknown as { driveables: { active: unknown } }).driveables;
    mgr.active = {
      def: { id: 'hornet' },
      poolSlot: null,
      wirePose: (out: number[]) => {
        out.length = 0;
        out.push(0, 140, -200, 0, 0.1, 0.2, 0, 0, 0, 0, 0, 0, 1);
        return out;
      },
    };
    hostDrive.update(1000);
    host.sent.length = 0; // Simulate late joiner who missed the initial broadcast.

    hostDrive.catchUp('guest1');
    deliver(host, guest, 1100);
    expect(guestDrive.remoteCount).toBe(1);
    expect(guestDrive.puppet(0)?.id).toBe('hornet');

    guestDrive.lostSeat('host', 0);
    expect(guestDrive.remoteCount).toBe(0);
    expect(guest.remotes.get('host')?.inVehicle).toBe(false);

    hostDrive.dispose();
    guestDrive.dispose();
  });
});

describe('Enemy utility aircraft & hijackable ground vehicle replication (Rooftop & Badlands)', () => {
  it('replicates transport and doorGunner helicopters to guests with hitboxes and exposes hijackable ground vehicles', () => {
    const { host, guest } = makeWorldPair();
    const hostVehicles = new Vehicles(host.w, makeFakeReplicas());
    const guestVehicles = new Vehicles(guest.w, makeFakeReplicas());

    const live = (host.w.ctx.enemies.vehicles as unknown as { live: unknown[] }).live;
    live.push(
      {
        uid: 101,
        def: { kind: 'transport' },
        alive: true,
        health: 400,
        phase: 'approach',
        position: new THREE.Vector3(20, 48, -10),
        quaternion: new THREE.Quaternion(),
      },
      {
        uid: 102,
        def: { kind: 'doorGunner' },
        alive: true,
        health: 320,
        phase: 'orbit',
        position: new THREE.Vector3(-30, 56, 15),
        quaternion: new THREE.Quaternion(),
      },
      {
        uid: 103,
        def: { kind: 'humvee' },
        alive: true,
        health: 220,
        position: new THREE.Vector3(6, 0, 4),
        quaternion: new THREE.Quaternion(),
        turretYaw: 0,
      },
    );

    hostVehicles.update(2000);

    expect(guestVehicles.utilityCount).toBe(2);
    const replicatedKinds: string[] = [];
    guestVehicles.each((_id, kind) => replicatedKinds.push(kind));
    expect(replicatedKinds.sort()).toEqual(['doorGunner', 'humvee', 'transport']);

    const hijackable = guestVehicles.findHijackable(new THREE.Vector3(5, 0, 4), 10);
    expect(hijackable).not.toBeNull();
    expect(hijackable?.kind).toBe('humvee');

    hostVehicles.dispose();
    guestVehicles.dispose();
  });
});

describe('Dogfight co-op sync (AI jets, carrier state, terminal upgrades, RWR & damage)', () => {
  it('streams AI jets to guests, forwards guest cannon/missile hits to host, syncs shatters & carrier HUD', () => {
    const { host, guest, deliver } = makeWorldPair();
    const hostDf = new DogfightSync(host.w);
    const guestDf = new DogfightSync(guest.w);

    const applyDamage = vi.fn();
    const aiJet = {
      kind: 'hornet' as const,
      team: 'enemy' as const,
      alive: true,
      disposed: false,
      health: 180,
      maxHealth: 180,
      position: new THREE.Vector3(120, 220, -340),
      velocity: new THREE.Vector3(0, 0, 75),
      yaw: 0.2,
      pitch: -0.05,
      roll: 0.3,
      applyDamage,
    } as unknown as AiCombatJet;

    (host.w.ctx.waves as unknown as { enemies: AiCombatJet[] }).enemies.push(aiJet);

    // 1. Host update streams SIDE.jets and dfstate to guest; guest update plugs bridge & ticks.
    hostDf.update(1000);
    guestDf.update(1000);
    deliver(host, guest, 1000);

    expect(guestDf.puppetCount).toBe(1);
    expect(guest.extras.size).toBe(1);
    expect(guest.tickGuest).toHaveBeenCalled();
    expect(guest.applyGuestState).toHaveBeenCalledWith(2, 'clearing', 5, 0, 3400, 4000, 650, false, 2, 1, 0, 0);

    // 2. Guest shoots the replicated GuestAiJet puppet -> host receives dfhit and damages real AiCombatJet!
    const puppet = [...guest.extras][0] as ExtraTarget & { collider: RAPIER.Collider };
    expect(puppet.collider).not.toBeNull();
    const hitAccepted = puppet.shot(puppet.collider, new THREE.Vector3(120, 220, -340), 45, 'hornet_m61');
    expect(hitAccepted).toBe(true);
    deliver(guest, host, 1040);

    expect(applyDamage).toHaveBeenCalledTimes(1);
    expect(applyDamage).toHaveBeenCalledWith(45, expect.any(THREE.Vector3), 'hornet_m61', false);

    // 3. Host splashes the jet -> guest receives dfshatter, plays breakup, and removes puppet.
    host.netBridge?.onJetKilled(aiJet, 'hornet_m61', true);
    deliver(host, guest, 1080);
    expect(guest.applyGuestShatter).toHaveBeenCalledTimes(1);
    expect(guestDf.puppetCount).toBe(0);

    // 4. Guest buys Carrier Defense Terminal upgrade, calls next wave, and pops flares -> host runs them.
    guest.netBridge?.onBuyUpgrade('ciws');
    guest.netBridge?.onCallNextWave();
    guest.netBridge?.onPlayerFlares();
    deliver(guest, host, 1120);
    expect(host.requestBuyUpgrade).toHaveBeenCalledWith('ciws');
    expect(host.requestNextWave).toHaveBeenCalledTimes(1);
    expect(host.triggerGuestFlares).toHaveBeenCalledTimes(1);

    // 5. Host forwards RWR lock & air-to-air missile hit -> guest emits dogfight:rwr and dogfight:damage_player_jet while airborne,
    // and falls back to player.takeDamage when on foot on the carrier deck.
    const rwrSpy = vi.fn();
    const dmgSpy = vi.fn();
    guest.events.on('dogfight:rwr', rwrSpy);
    guest.events.on('dogfight:damage_player_jet', dmgSpy);

    (guest.w.ctx.player as { parked: boolean }).parked = true;
    host.netBridge?.onGuestRwr('guest1', true, 0.85, true, 'SU-57 FOX-2');
    host.netBridge?.onGuestDamage('guest1', 38, new THREE.Vector3(50, 200, -100));
    deliver(host, guest, 1160);

    expect(rwrSpy).toHaveBeenCalledWith({
      locking: true,
      lockStrength: 0.85,
      missileInbound: true,
      label: 'SU-57 FOX-2',
    });
    expect(dmgSpy).toHaveBeenCalledWith({
      amount: 38,
      from: expect.objectContaining({ x: 50, y: 200, z: -100 }),
    });

    (guest.w.ctx.player as { parked: boolean }).parked = false;
    host.netBridge?.onGuestDamage('guest1', 22, new THREE.Vector3(10, 80, -20));
    deliver(host, guest, 1200);
    expect(guest.w.ctx.player.takeDamage).toHaveBeenCalledWith(expect.objectContaining({ amount: 22, source: 'enemy_aam' }));

    hostDf.dispose();
    guestDf.dispose();
  });
});

describe('Multi-crew co-op vehicles (boarding, seat swapping, turret aim, driver-bail promotion, explosion eject)', () => {
  interface MockVehicle {
    def: { id: string };
    poolSlot: string | null;
    alive: boolean;
    seatIndex: number;
    remoteDriverSlot: number;
    readonly isRemoteDriven: boolean;
    localTurretAim: { seat: number; yaw: number; pitch: number };
    onRequestSeatSwap: ((targetSeat: number) => boolean) | null;
    wirePose: (out: number[]) => number[];
    setCrewOccupants: ReturnType<typeof vi.fn>;
    switchSeat: ReturnType<typeof vi.fn>;
    applyRemoteHullPose: ReturnType<typeof vi.fn>;
    applyRemoteGunnerTurret: ReturnType<typeof vi.fn>;
    promoteToDriver: ReturnType<typeof vi.fn>;
  }

  function makeMockVehicle(id: string, poolSlot: string | null, pos: [number, number, number], remoteDriverSlot = -1, seatIndex = 0): MockVehicle {
    const v: MockVehicle = {
      def: { id },
      poolSlot,
      alive: true,
      seatIndex,
      remoteDriverSlot,
      get isRemoteDriven() { return this.remoteDriverSlot >= 0; },
      localTurretAim: { seat: seatIndex, yaw: 0.75, pitch: -0.22 },
      onRequestSeatSwap: null,
      wirePose: (out: number[]) => {
        out.length = 0;
        out.push(pos[0], pos[1], pos[2], 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 1);
        return out;
      },
      setCrewOccupants: vi.fn(),
      switchSeat: vi.fn((idx: number) => {
        v.seatIndex = idx;
        v.localTurretAim.seat = idx;
        return true;
      }),
      applyRemoteHullPose: vi.fn(),
      applyRemoteGunnerTurret: vi.fn(),
      promoteToDriver: vi.fn((takeDriver: boolean) => {
        v.remoteDriverSlot = -1;
        if (takeDriver) v.seatIndex = 0;
      }),
    };
    return v;
  }

  it('boards a 3-seat Bastion, prevents seat collisions, swaps open seats 1 <-> 2, and syncs gunner turret aim (drvg)', () => {
    const { host, guest, deliver } = makeWorldPair();
    const hostDrive = new Driveables(host.w, new Vehicles(host.w, makeFakeReplicas()));
    const guestDrive = new Driveables(guest.w, new Vehicles(guest.w, makeFakeReplicas()));

    const hostMgr = (host.w.ctx.progression as unknown as { driveables: { active: MockVehicle | null } }).driveables;
    const guestMgr = (guest.w.ctx.progression as unknown as { driveables: { active: MockVehicle | null } }).driveables;

    // 1. Single-seat jet is NOT boardable.
    hostMgr.active = makeMockVehicle('hornet', null, [0, 10, 0]);
    hostDrive.update(1000);
    deliver(host, guest, 1000);
    expect(guestDrive.findBoardableRemoteVehicle(new THREE.Vector3(1, 10, 0))).toBeNull();

    // 2. Host boards a 3-seat Bastion at (30, 1, -20).
    const hostBastion = makeMockVehicle('bastion', 'motorpool.bastion', [30, 1, -20]);
    hostMgr.active = hostBastion;
    hostDrive.update(1100);
    deliver(host, guest, 1100);

    const boardable = guestDrive.findBoardableRemoteVehicle(new THREE.Vector3(32, 1, -20));
    expect(boardable).not.toBeNull();
    expect(boardable?.id).toBe('bastion');
    expect(boardable?.seatIndex).toBe(1);
    expect(boardable?.crewCount).toBe(1);
    expect(boardable?.seatCount).toBe(3);

    // Wire guest.boardRemoteVehicle to mount a mock remote-ridden Bastion.
    let guestRide: MockVehicle | null = null;
    let guestRequestSwap: ((targetSeat: number) => boolean) | null = null;
    guest.boardRemoteVehicle.mockImplementation(
      (driverSlot: number, id: string, pool: string | null, seatIndex: number, _pos: THREE.Vector3, _yaw: number, _onExit: () => void, onSwap: (t: number) => boolean) => {
        guestRide = makeMockVehicle(id, pool, [30, 1, -20], driverSlot, seatIndex);
        guestRequestSwap = onSwap;
        guestMgr.active = guestRide;
        return guestRide;
      },
    );

    // 3. Guest presses E to join seat 1 -> host arbitrates -> guest boards & host sees crew occupant!
    guestDrive.requestCrewSeat(0, 1);
    deliver(guest, host, 1150);
    deliver(host, guest, 1160);

    expect(guest.boardRemoteVehicle).toHaveBeenCalledTimes(1);
    expect(guestRide).not.toBeNull();
    expect(guestRide!.seatIndex).toBe(1);
    expect(hostBastion.setCrewOccupants).toHaveBeenCalledWith([[1, 'guest1', expect.any(String)]]);
    expect(host.remotes.get('guest1')?.inVehicle).toBe(true);
    expect(guestDrive.crewOf(0).sort((a, b) => a[0] - b[0])).toEqual([[0, 0], [1, 1]]);

    // 4. Guest tries to swap into seat 0 (occupied by host driver) -> rejected!
    expect(guestRequestSwap!(0)).toBe(false);
    deliver(guest, host, 1200);
    deliver(host, guest, 1210);
    expect(guestRide!.seatIndex).toBe(1);

    // 5. Guest swaps into open seat 2 (AA Vulcan gunner) -> approved & synced!
    guestRequestSwap!(2);
    deliver(guest, host, 1250);
    deliver(host, guest, 1260);
    expect(guestRide!.switchSeat).toHaveBeenCalledWith(2, true);
    expect(guestRide!.seatIndex).toBe(2);
    expect(hostDrive.crewOf(0).sort((a, b) => a[0] - b[0])).toEqual([[0, 0], [2, 1]]);

    // 6. Guest updates -> feeds remote hull pose AND sends drvg gunner turret aim -> host applies it!
    guestDrive.update(1350);
    expect(guestRide!.applyRemoteHullPose).toHaveBeenCalled();
    deliver(guest, host, 1360);
    expect(hostBastion.applyRemoteGunnerTurret).toHaveBeenCalledWith(2, expect.closeTo(0.75, 2), expect.closeTo(-0.22, 2));

    hostDrive.dispose();
    guestDrive.dispose();
  });

  it('promotes the gunner to driver seamlessly on driver bailout (both host->guest and guest->host) and ejects on explosion', () => {
    const { host, guest, deliver } = makeWorldPair();
    const hostDrive = new Driveables(host.w, new Vehicles(host.w, makeFakeReplicas()));
    const guestDrive = new Driveables(guest.w, new Vehicles(guest.w, makeFakeReplicas()));

    const hostMgr = (host.w.ctx.progression as unknown as { driveables: { active: MockVehicle | null } }).driveables;
    const guestMgr = (guest.w.ctx.progression as unknown as { driveables: { active: MockVehicle | null } }).driveables;

    // --- Case 1: Host drives Badlands Motor Pool Jackal, guest boards roof gunner, host bails out intact ---
    const hostJackal = makeMockVehicle('jackal', 'motorpool.jackal', [10, 1, 10]);
    hostMgr.active = hostJackal;
    hostDrive.update(1000);
    deliver(host, guest, 1000);

    let guestRide: MockVehicle | null = null;
    guest.boardRemoteVehicle.mockImplementation((driverSlot: number, id: string, pool: string | null, seatIndex: number) => {
      guestRide = makeMockVehicle(id, pool, [10, 1, 10], driverSlot, seatIndex);
      guestMgr.active = guestRide;
      return guestRide;
    });

    guestDrive.requestCrewSeat(0, 1);
    deliver(guest, host, 1050);
    deliver(host, guest, 1060);
    expect(guestRide!.isRemoteDriven).toBe(true);

    // Host bails out while vehicle is intact (`alive = true`)!
    hostMgr.active = null;
    hostDrive.update(1200);
    deliver(host, guest, 1210);

    // Guest is seamlessly promoted to local driver (NOT ejected), and Motor Pool slot is NOT prematurely released!
    expect(guestRide!.promoteToDriver).toHaveBeenCalledWith(true);
    expect(guestRide!.isRemoteDriven).toBe(false);
    expect(guestRide!.seatIndex).toBe(0);
    expect(guest.ejectRemoteVehicle).not.toHaveBeenCalled();
    expect(guest.releaseRemoteClaim).not.toHaveBeenCalled();

    // --- Case 2: Guest is now driving, host hops into gunner seat, then guest bails out intact -> host promoted! ---
    guestDrive.update(1300);
    deliver(guest, host, 1310);

    let hostRide: MockVehicle | null = null;
    host.boardRemoteVehicle.mockImplementation((driverSlot: number, id: string, pool: string | null, seatIndex: number) => {
      hostRide = makeMockVehicle(id, pool, [10, 1, 10], driverSlot, seatIndex);
      hostMgr.active = hostRide;
      return hostRide;
    });

    hostDrive.requestCrewSeat(1, 1);
    deliver(host, guest, 1360);
    expect(hostRide).not.toBeNull();
    expect(hostRide!.isRemoteDriven).toBe(true);

    // Guest bails out intact -> host must be promoted to driver (not ejected)!
    guestMgr.active = null;
    guestDrive.update(1500);
    deliver(guest, host, 1510);

    expect(hostRide!.promoteToDriver).toHaveBeenCalledWith(true);
    expect(hostRide!.isRemoteDriven).toBe(false);
    expect(host.ejectRemoteVehicle).not.toHaveBeenCalled();

    // --- Case 3: Host is driving again, guest boards, vehicle EXPLODES (`alive = false`) -> guest ejected! ---
    hostDrive.update(1600);
    deliver(host, guest, 1610);

    guest.boardRemoteVehicle.mockClear();
    guestDrive.requestCrewSeat(0, 1);
    deliver(guest, host, 1650);
    deliver(host, guest, 1660);
    expect(guestRide!.isRemoteDriven).toBe(true);
    guestRide!.promoteToDriver.mockClear();

    hostRide!.alive = false;
    hostMgr.active = null;
    hostDrive.update(1800);
    deliver(host, guest, 1810);

    expect(guestRide!.promoteToDriver).not.toHaveBeenCalled();
    expect(guest.ejectRemoteVehicle).toHaveBeenCalledWith(0, false);
    expect(guest.releaseRemoteClaim).toHaveBeenCalledWith('motorpool.jackal', expect.any(THREE.Vector3), expect.any(Number));

    hostDrive.dispose();
    guestDrive.dispose();
  });
});
