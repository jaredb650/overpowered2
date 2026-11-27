import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../../../core/events';
import type { Ctx, GameEvents } from '../../../core/contracts';
import type { AiWorld } from '../../aiWorld';
import { Comms, snapDead } from '../comms';
import type { CommsLine } from '../events';
import type { Outpost } from '../index';
import type { MoraleState } from '../morale';
import { enlist, Soldier } from '../soldier';
import { OutpostSquad } from '../squad';
import { RULES } from './lines';
import { NAME_LIST, poolOf } from './names';
import { airtime, priorityOf, type ChatterFacts } from './rules';
import { GUN_DOWN_HOLD, listenToEachOther, reactToCall } from './listeners';
import { Offers } from './offers';
import { radioLoss } from './radio';
import { PlayerMemory, rememberPlayer } from './memory';
import { VehicleChatter } from './vehicles';
import { makeAirSpeaker, resetAirRadio, sayAir } from './airRadio';
import { VOICED } from './voices';
import { Chatter } from '../../../net/world/chatter';
import { ChatterVoices, type VoiceDeps } from '../../../ui/hud/voices';
import { Reactions } from '../../../audio/reactions';
import { CHATTER_OFF, type Settings } from '../../../ui/settings';

vi.mock('../../attacks', async original => ({ ...(await original<object>()), say: vi.fn(), shout: vi.fn() }));

let nextUid = 1000;

function makeWorld(outpost?: Partial<Outpost>) {
  const events = new EventBus<GameEvents>();
  const player = {
    position: new THREE.Vector3(0, 0, -20),
    velocity: new THREE.Vector3(),
    speed: 0,
    mount: 'foot' as const,
    airborne: false,
    heavyArmor: false,
  };
  const ctxPlayer = { health: 100, maxHealth: 100, position: new THREE.Vector3(0, 0, -20), alive: true };
  const camera = new THREE.PerspectiveCamera();
  const ctx = {
    events,
    player: ctxPlayer,
    audio: { play: vi.fn(), voicePriority: false, setVoicePriority: vi.fn(), context: null, voiceBus: null },
    time: { elapsed: 0 },
    render: { camera },
    enemies: { alive: [] },
    world: { nav: { nearest: (_p: THREE.Vector3, _r: number, out: THREE.Vector3) => out } },
  } as unknown as Ctx;
  const w = {
    now: 10,
    ctx,
    player,
    enemies: {
      outpost: {
        doctrine: { radioSilence: false },
        soldiers: [],
        squads: [],
        memory: new PlayerMemory(),
        w: null as unknown as AiWorld,
        ...outpost,
      } as unknown as Outpost,
    },
  } as unknown as AiWorld;
  (w.enemies.outpost as unknown as { w: AiWorld }).w = w;
  return { w, events, ctx };
}

function makeSoldier(squad: OutpostSquad, roster: Soldier[], name: number, state: MoraleState = 'steady', pos = new THREE.Vector3()): Soldier {
  const uid = nextUid++;
  const enemy = {
    uid,
    alive: true,
    health: 100,
    maxHealth: 100,
    position: pos.clone(),
    center: pos.clone().add(new THREE.Vector3(0, 1, 0)),
    yaw: 0,
    dist: 10,
    shield: false,
    plates: [],
    def: { voice: { attack: 'vox_trooper' } },
  };
  const s = new Soldier();
  s.e = enemy as unknown as Soldier['e'];
  enlist(enemy as never, s);
  squad.join(s);
  s.role = 'rifle';
  s.name = name;
  s.desig = 20 + (name % 10); // designation pool starts at 20
  s.known = true;
  s.state = state;
  roster.push(s);
  return s;
}

afterEach(() => {
  VOICED.clips.clear();
  resetAirRadio();
  vi.restoreAllMocks();
});

describe('Batch D audit: Comms, DeadSnap, relay, priority, and chains', () => {
  it('preserves fallen soldier identity via DeadSnap across queued Comms lines even after Soldier.clear()', () => {
    const { w, events } = makeWorld();
    const comms = new Comms(w);
    const squad = new OutpostSquad(1, 'Alpha', w.enemies.outpost!);
    const roster = w.enemies.outpost!.soldiers;
    const speaker = makeSoldier(squad, roster, 0);
    const other = makeSoldier(squad, roster, 1);
    const dead = makeSoldier(squad, roster, 2); // Rook
    dead.nick = 40; // Brick
    dead.buddy = speaker;
    speaker.buddy = dead;

    const heard: CommsLine[] = [];
    events.on('comms:line', l => heard.push({ ...l }));

    // Occupy squad channel with a critical line of a different kind so manDown queues (without hitting KIND_GAP.manDown).
    comms.say('leaderDown', other, null);
    expect(heard).toHaveLength(1);

    // Queue speaker's buddy manDown while other is still talking.
    comms.say('manDown', speaker, dead);
    expect(heard).toHaveLength(1);

    // Clear and recycle `dead` before the queued line drains!
    dead.clear();
    dead.name = 9;
    dead.nick = -1;
    dead.buddy = null;
    dead.known = false;

    w.now += airtime(heard[0]!.text) + 0.5;
    comms.update();
    expect(heard).toHaveLength(2);
    expect(heard[1]!.kind).toBe('manDown');
    expect(heard[1]!.dead).toBe(40); // Brick (buddy nickname preserved despite dead.clear()!)
  });

  it('preserves fallen radio operator identity in 7s delayed radioGrab after dead.clear()', () => {
    const { w, events } = makeWorld();
    const comms = new Comms(w);
    const outpost = w.enemies.outpost!;
    (outpost as { comms: Comms }).comms = comms;
    (outpost as unknown as { scare: () => void }).scare = vi.fn();

    const squad = new OutpostSquad(1, 'Charlie', outpost);
    outpost.squads.push(squad);
    const op = makeSoldier(squad, outpost.soldiers, 2); // Rook, desig 22
    const survivor = makeSoldier(squad, outpost.soldiers, 3);
    squad.radioman = op;

    const heard: CommsLine[] = [];
    events.on('comms:line', l => heard.push({ ...l }));

    vi.spyOn(Math, 'random').mockReturnValue(0.1); // forces GRAB branch
    radioLoss(outpost, squad, op);

    // Recycle dead operator immediately after death.
    op.e.alive = false;
    squad.leave(op);
    op.clear();
    op.name = -1;
    op.desig = -1;
    op.known = false;

    w.now += 7.5;
    comms.update();

    const grab = heard.find(l => l.kind === 'radioGrab');
    expect(grab).toBeDefined();
    expect(grab!.enemy).toBe(survivor.e);
    expect(grab!.dead).toBe(22); // designation preserved from snapDead!
  });

  it('blocks dead soldiers from speaking in Comms.say and Comms.relay', () => {
    const { w, events } = makeWorld();
    const comms = new Comms(w);
    const squad = new OutpostSquad(1, 'Alpha', w.enemies.outpost!);
    const s = makeSoldier(squad, w.enemies.outpost!.soldiers, 0);
    s.e.alive = false;

    const heard: CommsLine[] = [];
    events.on('comms:line', l => heard.push({ ...l }));

    comms.say('contact', s);
    comms.relay('Move up!', s, null, 'siege.charge', false);
    expect(heard).toHaveLength(0);
  });

  it('hardens Comms.relay: respects silent, emits comms:cut on active talk, uses desig on radio, resets ally', () => {
    const { w, events } = makeWorld();
    const comms = new Comms(w);
    const squad = new OutpostSquad(1, 'Alpha', w.enemies.outpost!);
    const a = makeSoldier(squad, w.enemies.outpost!.soldiers, 0);
    const b = makeSoldier(squad, w.enemies.outpost!.soldiers, 1);

    const heard: CommsLine[] = [];
    const cuts: unknown[] = [];
    events.on('comms:line', l => {
      heard.push({ ...l });
      // Mutate reused line object to simulate stale ally flag.
      l.ally = true;
    });
    events.on('comms:cut', c => cuts.push(c));

    a.silent = true;
    comms.relay('Quiet ambush', a, null, 'chatter.ambush', false);
    expect(heard).toHaveLength(0);

    a.silent = false;
    comms.say('contact', a);
    expect(heard).toHaveLength(1);

    // Interrupting active squad talk with relay emits comms:cut and resets ally + uses desig when radio=true.
    w.now += 0.1;
    comms.relay('Hold this lane!', b, null, 'radio.hold', true);
    expect(cuts).toHaveLength(1);
    expect(heard).toHaveLength(2);
    expect(heard[1]!.ally).toBe(false);
    expect(poolOf(heard[1]!.name!)).toBe('designation');
    expect(heard[1]!.speaker).toBe(`${NAME_LIST[b.desig]} · Alpha`);
  });

  it('allows CHAIN replies to bypass LINE_GAP so answers are not silently dropped when another squad speaks', () => {
    const { w, events } = makeWorld();
    const comms = new Comms(w);
    const alpha = new OutpostSquad(1, 'Alpha', w.enemies.outpost!);
    const bravo = new OutpostSquad(2, 'Bravo', w.enemies.outpost!);
    const thrower = makeSoldier(alpha, w.enemies.outpost!.soldiers, 0);
    const mate = makeSoldier(alpha, w.enemies.outpost!.soldiers, 1);
    const bLead = makeSoldier(bravo, w.enemies.outpost!.soldiers, 2);
    thrower.buddy = mate;

    const heard: CommsLine[] = [];
    events.on('comms:line', l => heard.push({ ...l }));

    comms.say('frag', thrower);
    expect(heard).toHaveLength(1);
    expect(heard[0]!.kind).toBe('frag');
    const fragEnd = w.now + airtime(heard[0]!.text);

    // Another squad speaks right before Alpha's reply falls due, pushing nextLineAt past the reply timestamp.
    w.now = fragEnd;
    comms.say('contact', bLead);
    expect(heard).toHaveLength(2);

    // Now advance 0.15s: inside LINE_GAP (1.3s) from Bravo's contact, but Alpha's chained `ack` MUST still fire!
    w.now = fragEnd + 0.15;
    comms.update();
    expect(heard).toHaveLength(3);
    expect(heard[2]!.kind).toBe('ack');
    expect(heard[2]!.enemy).toBe(mate.e);
  });

  it('resolves mixed-priority ordnance rules by facts so tactical rows do not preempt active tactical talks', () => {
    const tacFacts: ChatterFacts = { faction: 'garrison', tier: 'high', role: 'rifle', flags: { flares: true } };
    const incFacts: ChatterFacts = { faction: 'garrison', tier: 'high', role: 'rifle', flags: { incoming: true, bomb: true } };
    expect(priorityOf('ordnance', tacFacts)).toBe('tactical');
    expect(priorityOf('ordnance', incFacts)).toBe('critical');

    const { w, events } = makeWorld();
    const comms = new Comms(w);
    const squad = new OutpostSquad(1, 'Alpha', w.enemies.outpost!);
    const a = makeSoldier(squad, w.enemies.outpost!.soldiers, 0);
    const b = makeSoldier(squad, w.enemies.outpost!.soldiers, 1);

    const cuts: unknown[] = [];
    events.on('comms:cut', c => cuts.push(c));

    comms.say('contact', a); // tactical
    w.now += 0.1;
    // Flares ordnance is tactical: must NOT cut active tactical talk.
    comms.say('ordnance', b, null, { flags: { flares: true } });
    expect(cuts).toHaveLength(0);

    // Incoming bomb ordnance is critical: MUST cut active tactical talk.
    comms.say('ordnance', b, null, { flags: { bomb: true, incoming: true } });
    expect(cuts).toHaveLength(1);
  });

  it('uses focused co-op player health for playerHurt in Comms.read()', () => {
    const { w, events } = makeWorld();
    const comms = new Comms(w);
    // Host player is full HP, focused co-op guest is low HP (hosting: true so Comms is not deaf).
    w.ctx.player.health = 100;
    w.ctx.player.maxHealth = 100;
    (w.ctx as unknown as { coop: { hosting: boolean; world: { targetPlayer: { health: number; maxHealth: number } } } }).coop = {
      hosting: true,
      world: { targetPlayer: { health: 10, maxHealth: 100 } },
    };
    const squad = new OutpostSquad(1, 'Alpha', w.enemies.outpost!);
    const s = makeSoldier(squad, w.enemies.outpost!.soldiers, 0);

    const heard: CommsLine[] = [];
    events.on('comms:line', l => heard.push({ ...l }));

    comms.say('contact', s);
    expect(heard).toHaveLength(1);
    expect(heard[0]!.why).toContain('playerHurt');
  });
});

describe('Batch D audit: listeners, offers, vehicles, memory, airRadio', () => {
  it('fires physical AI reactions even when chatter is muted or rate-limited, without double-firing', () => {
    const order = vi.fn();
    const callForAid = vi.fn();
    const scare = vi.fn();
    const { w } = makeWorld({ order, callForAid, scare });
    const outpost = w.enemies.outpost!;
    const comms = new Comms(w);
    listenToEachOther(w, outpost);

    const squad = new OutpostSquad(1, 'Alpha', outpost);
    const a = makeSoldier(squad, outpost.soldiers, 0, 'steady', new THREE.Vector3(0, 0, 0));
    const b = makeSoldier(squad, outpost.soldiers, 1, 'steady', new THREE.Vector3(2, 0, 0));
    a.throwAt.set(2, 0, 0);

    // Mute speaker: speech drops, but frag dodge MUST still fire once!
    a.injuries.mute = true;
    comms.say('frag', a);
    expect(order).toHaveBeenCalledTimes(1);
    expect(order.mock.calls[0]!.slice(5)).toEqual([2, 1.5]);

    // Unmute speaker: both reactToCall and comms:line run, must still fire ONCE (not twice!).
    a.injuries.mute = false;
    w.now += 5;
    comms.say('downed', b);
    expect(callForAid).toHaveBeenCalledTimes(1);

    // Hold squad on gunDown even when rate-limited inside LINE_GAP.
    const holdSpy = vi.spyOn(squad, 'hold');
    comms.say('gunDown', a);
    expect(holdSpy).toHaveBeenCalledWith(GUN_DOWN_HOLD);
  });

  it('respects squad.directed in listeners except direct lethal frag blast', () => {
    const order = vi.fn();
    const { w } = makeWorld({ order });
    const outpost = w.enemies.outpost!;
    const squad = new OutpostSquad(1, 'Alpha', outpost);
    squad.directed = true;
    const thrower = makeSoldier(squad, outpost.soldiers, 0, 'steady', new THREE.Vector3(0, 0, 0));
    makeSoldier(squad, outpost.soldiers, 1, 'steady', new THREE.Vector3(5.8, 0, 0)); // outer frag ring (> 5m)
    const lethalMan = makeSoldier(squad, outpost.soldiers, 2, 'steady', new THREE.Vector3(2, 0, 0)); // lethal core (< 5m)
    thrower.throwAt.set(0, 0, 0);

    // Flash skips directed soldiers completely.
    reactToCall(outpost, 'flash', thrower);
    expect(order).not.toHaveBeenCalled();

    // Frag moves ONLY the directed soldier inside direct lethal radius (< 5m).
    reactToCall(outpost, 'frag', thrower);
    expect(order).toHaveBeenCalledTimes(1);
    expect(order.mock.calls[0]![0]).toBe(lethalMan);
  });

  it('Offers skips directed followers and cleans taken on dead/downed followers', () => {
    const order = vi.fn();
    const { w } = makeWorld({ order });
    const outpost = w.enemies.outpost!;
    (outpost as { comms: Comms }).comms = new Comms(w);
    const squad = new OutpostSquad(1, 'Alpha', outpost);
    squad.seenAt = w.now;
    const shield = makeSoldier(squad, outpost.soldiers, 0, 'steady', new THREE.Vector3(0, 0, 0));
    shield.role = 'shield';
    shield.e.shield = true;
    const mate = makeSoldier(squad, outpost.soldiers, 1, 'steady', new THREE.Vector3(2, 0, 0));

    const offers = new Offers();
    offers.tick(outpost, 1);
    expect(offers.cover).toHaveLength(1);
    expect(offers.cover[0]!.claims).toContain(mate);

    // Directed squad drops follower and cleans taken.
    squad.directed = true;
    offers.tick(outpost, 2);
    expect(offers.cover[0]!.claims).not.toContain(mate);

    // Undirected again with a second shield wall: follower can claim it (proving `taken` was cleaned, whereas `c.had` prevents re-claiming wall 0).
    squad.directed = false;
    const shield2 = makeSoldier(squad, outpost.soldiers, 2, 'steady', new THREE.Vector3(1, 0, 0));
    shield2.role = 'shield';
    shield2.e.shield = true;
    offers.tick(outpost, 3);
    expect(offers.cover).toHaveLength(2);
    expect(offers.cover[1]!.claims).toContain(mate);

    // Killing follower removes him from claims and taken.
    mate.e.alive = false;
    offers.tick(outpost, 4);
    expect(offers.cover[1]!.claims).not.toContain(mate);
  });

  it('VehicleChatter skips directed on vehicle dodge, scatters directed on lethal CCIP, and passes priority args', () => {
    const order = vi.fn();
    const { w } = makeWorld({ order });
    const outpost = w.enemies.outpost!;
    (outpost as { comms: Comms }).comms = new Comms(w);
    const squad = new OutpostSquad(1, 'Alpha', outpost);
    squad.directed = true;
    const s = makeSoldier(squad, outpost.soldiers, 0, 'steady', new THREE.Vector3(0, 0, -5));
    const vc = new VehicleChatter(outpost);

    // Moving ground vehicle directly toward directed soldier: vehicle path dodge skips directed.
    (w.player as { mount: string; speed: number }).mount = 'tank';
    w.player.speed = 10;
    w.player.position.set(0, 0, 0);
    w.player.velocity.set(0, 0, -10);
    vc.update();
    expect(order).not.toHaveBeenCalled();

    // Direct lethal bomb drop: scatterFrom DOES move directed soldier with priority 2, lock 1.5s.
    vc.scatterFrom(new THREE.Vector3(0, 0, -5), 14);
    expect(order).toHaveBeenCalledTimes(1);
    expect(order.mock.calls[0]![0]).toBe(s);
    expect(order.mock.calls[0]!.slice(5)).toEqual([2, 1.5]);
  });

  it('rememberPlayer ignores ALLY_SOURCE kills/hits/backshots', () => {
    const { w, events } = makeWorld();
    const outpost = w.enemies.outpost!;
    const comms = new Comms(w);
    (outpost as { comms: Comms }).comms = comms;
    const squad = new OutpostSquad(1, 'Alpha', outpost);
    squad.seenAt = w.now;
    outpost.squads.push(squad);
    const s = makeSoldier(squad, outpost.soldiers, 0);
    rememberPlayer(outpost);

    for (let i = 0; i < 6; i++) {
      events.emit('enemy:killed', { enemy: s.e, headshot: true, damage: { source: 'ally_rifle', type: 'bullet', amount: 100, region: 'head' } as never, result: { dealt: 100, killed: true, severed: [], armour: 'none' } as never } as never);
      events.emit('enemy:backshot', { enemy: s.e, fleeing: false, damage: { source: 'ally_rifle' } } as never);
    }
    expect(outpost.memory.counts.heads).toBe(0);
    expect(outpost.memory.counts.flanks).toBe(0);
    expect(outpost.memory.noticed.size).toBe(0);

    for (let i = 0; i < 4; i++) {
      events.emit('enemy:killed', { enemy: s.e, headshot: true, damage: { source: 'rifle', type: 'bullet', amount: 100, region: 'head' } as never, result: { dealt: 100, killed: true, severed: [], armour: 'none' } as never } as never);
    }
    expect(outpost.memory.counts.heads).toBe(4);
    expect(outpost.memory.noticed.has('heads')).toBe(true);
  });

  it('resetAirRadio clears all air-radio state cleanly between runs', () => {
    const { ctx, events } = makeWorld();
    const heard: CommsLine[] = [];
    events.on('comms:line', l => heard.push({ ...l }));

    const sp1 = makeAirSpeaker('transport');
    expect(sp1.callsign).toBe('Chalk 1 · Air Assault');
    sayAir(ctx, 'airInbound', sp1, { transport: true });
    expect(heard).toHaveLength(1);

    // Without reset, same kind on cooldown is suppressed and serial increments.
    const sp2 = makeAirSpeaker('transport');
    expect(sp2.callsign).toBe('Chalk 2 · Air Assault');
    sayAir(ctx, 'airInbound', sp2, { transport: true });
    expect(heard).toHaveLength(1);

    // After resetAirRadio, serial resets to 1 and cooldowns/talks clear.
    resetAirRadio();
    const sp3 = makeAirSpeaker('transport');
    expect(sp3.callsign).toBe('Chalk 1 · Air Assault');
    sayAir(ctx, 'airInbound', sp3, { transport: true });
    expect(heard).toHaveLength(2);
  });
});

describe('Batch D audit: Co-op Chatter sync', () => {
  it('syncs voiced relay lines, preserves radio designations, and drops missing-replica local shouts', () => {
    const hostEvents = new EventBus<GameEvents>();
    const guestEvents = new EventBus<GameEvents>();
    const sent: unknown[] = [];
    const guestHandlers = new Map<string, (v: unknown) => void>();

    const hostEnemy = { uid: 42, center: new THREE.Vector3(5, 1, 5), alive: true };
    const hostSquad = new OutpostSquad(1, 'Alpha', {} as Outpost);
    const hostSoldier = new Soldier();
    hostSoldier.e = hostEnemy as unknown as Soldier['e'];
    enlist(hostEnemy as never, hostSoldier);
    hostSquad.join(hostSoldier);
    hostSoldier.name = 0; // Voss
    hostSoldier.desig = 20; // K-17

    const hostCtx = { events: hostEvents, player: { position: new THREE.Vector3() } } as unknown as Ctx;
    const guestCtx = { events: guestEvents, player: { position: new THREE.Vector3(99, 0, 99) } } as unknown as Ctx;

    new Chatter(
      {
        hosting: true,
        ctx: hostCtx,
        listen: (e: keyof GameEvents, fn: (v: unknown) => void) => hostEvents.on(e, fn as never),
        send: (msg: unknown) => sent.push(msg),
        router: { guest: vi.fn() },
      } as never,
      { enemy: () => undefined } as never,
    );

    const guestEnemy = { uid: 42, center: new THREE.Vector3(5, 1, 5) };
    new Chatter(
      {
        hosting: false,
        ctx: guestCtx,
        listen: vi.fn(),
        send: vi.fn(),
        router: { guest: (t: string, fn: (v: unknown) => void) => guestHandlers.set(t, fn) },
      } as never,
      { enemy: (uid: number) => (uid === 42 ? guestEnemy : undefined) } as never,
    );

    const heard: CommsLine[] = [];
    guestEvents.on('comms:line', l => heard.push({ ...l }));
    const onGuest = guestHandlers.get('chatter')!;

    // 1. Voiced relay (row === -1 with clip) syncs to guest with clip + text + radio desig!
    hostEvents.emit('comms:line', {
      kind: 'order', text: 'Reinforcements inbound.', squad: 'Alpha', speaker: 'K-17 · Alpha',
      enemy: hostEnemy as never, position: hostEnemy.center.clone(), row: -1, name: 0, dead: -1, voice: 0, clip: 'radio.reinforce.1', radio: true,
    });
    expect(sent).toHaveLength(1);
    onGuest(sent[0]);
    expect(heard).toHaveLength(1);
    expect(heard[0]!.clip).toBe('radio.reinforce.1');
    expect(heard[0]!.text).toBe('Reinforcements inbound.');
    expect(heard[0]!.name).toBe(20); // designation sent over wire!
    expect(heard[0]!.speaker).toBe('K-17 · Alpha');

    // 2. Plain hand-written line without clip stays host-only.
    hostEvents.emit('comms:line', {
      kind: 'order', text: 'Local debug only', squad: 'Command', speaker: null,
      enemy: null, position: new THREE.Vector3(), row: -1,
    });
    expect(sent).toHaveLength(1);

    // 3. Missing-replica non-radio local shout is dropped on guest (never plays at guest player position).
    const localRow = RULES.findIndex(r => r.concept === 'contact' && !r.radio);
    onGuest({ t: 'chatter', uid: 999, line: localRow, name: 0, dead: -1, rank: 0, squad: 'Alpha', voice: 0 });
    expect(heard).toHaveLength(1);

    // 4. Missing-replica radio line IS still heard on guest.
    const radioRow = RULES.findIndex(r => r.radio === true && Object.keys(r.criteria).length === 0);
    onGuest({ t: 'chatter', uid: 999, line: radioRow, name: 20, dead: -1, rank: 0, squad: 'Alpha', voice: 0, radio: true });
    expect(heard).toHaveLength(2);
    expect(heard[1]!.radio).toBe(true);
  });
});

describe('Batch D audit: ChatterVoices, reactions.ts, and snapDead helper', () => {
  interface FakeAudio {
    src: string;
    preload: string;
    volume: number;
    currentTime: number;
    paused: boolean;
    ended: boolean;
    play(): Promise<void>;
    pause(): void;
    addEventListener(e: string, fn: () => void, opts?: { signal?: AbortSignal }): void;
    fire(e: string): void;
  }

  function fakeAudio(): FakeAudio {
    const handlers = new Map<string, Set<() => void>>();
    return {
      src: '', preload: '', volume: 1, currentTime: 0, paused: true, ended: false,
      play() { this.paused = false; this.ended = false; return Promise.resolve(); },
      pause() { this.paused = true; },
      addEventListener(e: string, fn: () => void, opts?: { signal?: AbortSignal }) {
        if (!handlers.has(e)) handlers.set(e, new Set());
        handlers.get(e)!.add(fn);
        opts?.signal?.addEventListener('abort', () => handlers.get(e)?.delete(fn));
      },
      fire(e: string) {
        for (const fn of [...(handlers.get(e) ?? [])]) fn();
      },
    };
  }

  it('guards ChatterVoices against stale ended/error events, skips eager load when muted, and ducks on voicePriority', () => {
    const row = RULES.findIndex(r => r.concept === 'frag' && !r.radio);
    const clip = `${RULES[row]!.id}.t2`;
    VOICED.clips.add(clip);

    const listSpy = vi.fn(() => Promise.resolve({ ext: 'mp3', clips: [clip] }));
    const mutedSettings = { master: 1, sfx: 1, voices: 0 } as Settings;
    const camera = new THREE.PerspectiveCamera();
    const ctx = {
      audio: { voicePriority: false, context: null, voiceBus: null },
      render: { camera },
      player: { position: new THREE.Vector3() },
      campaign: { talking: false },
    } as unknown as Ctx;

    // Muted voices: constructor does NOT eagerly fetch manifest.
    const muted = new ChatterVoices(ctx, mutedSettings, { audio: () => fakeAudio() as unknown as ReturnType<VoiceDeps['audio']>, list: listSpy, context: () => null });
    expect(listSpy).not.toHaveBeenCalled();
    expect(muted.say({ kind: 'frag', text: 'Frag out!', squad: 'Alpha', speaker: 'Cpl Voss · Alpha', enemy: { center: new THREE.Vector3() } as never, position: new THREE.Vector3(), row, voice: 0, clip })).toBe(false);
    expect(listSpy).not.toHaveBeenCalled();

    // Audible voices: stale ended callback after slot reuse does NOT free new play; voicePriority ducks gain.
    const audios: FakeAudio[] = [];
    const settings = { master: 1, sfx: 1, voices: 1 } as Settings;
    const voices = new ChatterVoices(ctx, settings, {
      audio: () => { const a = fakeAudio(); audios.push(a); return a as unknown as ReturnType<VoiceDeps['audio']>; },
      list: listSpy,
      context: () => null,
    });
    const enemy = { center: new THREE.Vector3(0, 0, -2) } as never;
    const line: CommsLine = { kind: 'frag', text: 'Frag out!', squad: 'Alpha', speaker: 'Cpl Voss · Alpha', enemy, position: new THREE.Vector3(), row, voice: 0, clip };

    expect(voices.say(line)).toBe(true);
    const slot0 = audios[0]!;
    // Re-trigger same speaker -> increments gen and aborts previous listeners.
    expect(voices.say(line)).toBe(true);
    // Simulate a late ended event with ended=false (spurious from pause/src swap) -> must NOT free slot!
    slot0.ended = false;
    slot0.fire('ended');
    expect(voices.pool.filter(p => p.playing)).toHaveLength(1);

    // Check ducking when audio.voicePriority is true.
    voices.update(0.016, false);
    const normalVol = slot0.volume;
    (ctx.audio as unknown as { voicePriority: boolean }).voicePriority = true;
    voices.update(0.016, false);
    expect(slot0.volume).toBeLessThan(normalVol);
  });

  it('skips synth vox_dying_human for Outpost soldiers while keeping it for non-outpost enemies', () => {
    const events = new EventBus<GameEvents>();
    const play = vi.fn();
    const audio = { play } as unknown as Ctx['audio'];
    const ctx = {
      events,
      audio,
      player: { position: new THREE.Vector3() },
      enemies: { alive: [] },
      time: { elapsed: 0 },
    } as unknown as Ctx;
    const reactions = new Reactions(ctx, audio);

    // Outpost soldier downed: skipped (ChatterVoices owns their downed call).
    const squad = new OutpostSquad(1, 'Alpha', {} as Outpost);
    const soldierEnemy = { uid: 500, center: new THREE.Vector3(), position: new THREE.Vector3(), alive: true, def: { voice: {} } };
    const s = new Soldier();
    s.e = soldierEnemy as unknown as Soldier['e'];
    enlist(soldierEnemy as never, s);
    squad.join(s);
    events.emit('enemy:condition', { enemy: soldierEnemy as never, condition: 'downed' });
    reactions.update(0.05, null);
    expect(play).not.toHaveBeenCalled();

    // Non-outpost enemy downed: still plays vox_dying_human.
    const plainEnemy = { uid: 501, center: new THREE.Vector3(), position: new THREE.Vector3(), alive: true, def: { voice: {} } };
    events.emit('enemy:condition', { enemy: plainEnemy as never, condition: 'downed' });
    reactions.update(0.05, null);
    expect(play).toHaveBeenCalledWith('vox_dying_human', expect.anything());
  });

  it('snapDead is idempotent and CHATTER_OFF constant matches expected value', () => {
    const squad = new OutpostSquad(1, 'Alpha', {} as Outpost);
    const s = makeSoldier(squad, [], 0);
    const snap = snapDead(s);
    expect(snapDead(snap)).toBe(snap);
    expect(CHATTER_OFF).toBe(2);
  });
});
