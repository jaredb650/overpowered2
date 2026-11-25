/** The game-facing co-op session. Host world snapshots and hit claims are world.ts, the team rules team.ts; never Player or Weapons. */
import type { Ctx, GameSystem } from '../core/contracts';
import { tabBusy } from '../core/oneTab';
import { isPageNavigationAllowed } from '../input';
import { Lobby, type ChatLine, type Match } from './lobby';
import { errorText } from './lobbyText';
import { POSE_MS, type Move } from './pose';
import { AKIMBO_TAG, PROPS, RemotePlayer, friendTorches } from './remote';
import { clearSession, deployMatch, deploying, forgetRoom, resumedRoom, whileLoading } from './session';
import { SessionHud } from './sessionHud';
import { CoopWorld } from './world';
import { CoopHud } from './coopHud';
import { publishNet, watchCost } from './debug';
import { pageSim } from './netsim';
import { Hook, SeatHooks, type Arrival } from './seats';
export { Hook, type Arrival };
import { metrics } from './metrics';
import { Starved } from './starved';

/** The modes whose world the host runs. The others are free roam: everyone walks the map, nothing else. */
export const WORLD_MODES: readonly Match['mode'][] = ['crucible', 'outpost', 'rooftop', 'badlands', 'endless_war', 'dogfight', 'defense', 'campaign', 'foreclosure'];
/** How long the team board stays up after the host is gone for good, before everyone regroups in a new lobby. */
export const LOST_BOARD_MS = 10_000;
/** The status line of a guest the host has stopped feeding: in the place and style of "Reconnecting to host…". */
export const TOO_SLOW = 'Connection too slow. Catching up…';

/** Where a player lands after the match: the same room, on its lobby page. `match`: what was just played, so the host's picker stays on it. */
export interface Room { lobby: Lobby; code: string; password: string; match?: Match }
/**
 * After the host is gone for good: everyone who was in the room meets again in a new lobby on the same code and password.
 * `rank` 0 hosts it; the others join, and take over in turn if nobody ahead of them shows up (ui/screens/coop.ts).
 */
export interface Regroup { code: string; password: string; rank: number; names: string[]; note: string; /** This player's callsign as it was in the room. */ name?: string }

export class CoopSession implements GameSystem {
  readonly freeRoam: boolean;
  readonly world: CoopWorld | null;
  localPaused = false;
  readonly remotes = new Map<string, RemotePlayer>();
  hud: CoopHud | null = null;
  private ready = false;
  private begun = false;
  private closed = false;
  private nextPose = 0;
  private seq = 0;
  private hidden = false;
  private readonly torches: ReturnType<typeof friendTorches>;
  cpuMs = 0;
  private readonly offDoc: (() => void)[] = [];
  /** The session's own layer: the deploy gate, the waiting and reconnecting line, the host-lost board. */
  private view: SessionHud | null = null;
  /** Set while "Click to deploy" is up: what the click starts (the local run). */
  private gateStart: (() => void) | null = null;
  /** The host ended the match before this page had finished loading it. */
  private endedEarly = false;
  /** Guest, the host gone for good: the board is up until then, and then everyone regroups. */
  private lostUntil = 0;
  /** Guest: the host has stopped feeding this page (`feed`), and when its own pose last arrived. */
  private readonly starved = new Starved();
  private starving = false;
  private poseAt = 0;
  private regroup: Regroup | null = null;
  private idle: 'menu' | 'hidden' | undefined;
  /**
   * Host: what happens to a seat (seats.ts). `CoopWorld` is the listener: it hands an arriving player everything they
   * missed, lets go of what a lost player held in the world, and forgets a connection that is gone (world.ts).
   */
  private readonly seats = new SeatHooks();
  /** Host: a player is in the world, for the first time in this match or again (`rejoin`; `same`: on the same page as before). */
  readonly onArrived = this.seats.onArrived;
  /** Host: a player's connection dropped. Their seat is kept (SEAT_GRACE_MS): hold their state, take their body out. */
  readonly onLost = this.seats.onLost;
  /** Host: a seat is given up for good (the grace ran out, or they quit). */
  readonly onGone = this.seats.onGone;
  /** Host: a connection id that will never be heard from again (a seat's old page, or a seat gone). */
  readonly onForget = this.seats.onForget;
  /** Why the match ended under this player, and whether the room is still there to go back to (or to regroup in). */
  onEnded: (message: string, room: Room | null, regroup?: Regroup) => void = () => {};
  /** Host: the load barrier is over. The game starts the world it has been holding (core/Game.ts). */
  onGo: () => void = () => {};

  constructor(private readonly ctx: Ctx, readonly lobby: Lobby, readonly match: Match, private readonly code = resumedRoom?.code ?? '', private readonly password = resumedRoom?.password ?? '') {
    this.freeRoam = !WORLD_MODES.includes(match.mode);
    // The friends' weapon lights, in the scene before the first frame (remote.ts).
    this.torches = friendTorches(ctx);
    this.world = this.freeRoam ? null : new CoopWorld(ctx, this);
    // One message per peer for everything a frame (or one arriving message) sends on the reliable lane: the queue is
    // flushed when that frame's script ends, before the page draws (lobby.ts `batching`).
    lobby.batching(run => queueMicrotask(run));
    this.endedEarly = whileLoading.ended;
    lobby.onChange = () => this.changed();
    lobby.onPose = (id, pose) => {
      const now = performance.now();
      const remote = this.remotes.get(id);
      // The host's own pose is the steadiest thing it sends (20 a second, whatever the wave is doing): see `feed`.
      if (remote?.player.host) this.poseAt = now;
      remote?.push(pose, now);
    };
    lobby.onLine = line => this.chatLine(line);
    // The host took everyone back to the lobby page. While this page is still loading, that waits for the boot to end.
    lobby.onEnd = () => {
      if (this.gateStart || this.begun) this.end('The host ended the match. You are back in the lobby.', true);
      else this.endedEarly = true;
    };
    // The host moved on to another match (its page reloaded, so its world is gone): this page follows it.
    lobby.onMatch = next => {
      if (next.id === this.match.id || !this.code) return;
      console.info('[coop] The host started a new match; loading it.');
      try { deployMatch(this.code, this.password, lobby, next); } catch (error) { console.warn('[coop] Could not follow the host to its new match', error); }
    };
    lobby.onGo = () => {
      if (!this.begun || this.closed) return;
      if (this.hosting) this.onGo();
    };
    lobby.onSeat = (player, event) => this.seats.feed(player, event);
    if (typeof document !== 'undefined' && lobby.hosting) {
      const seen = () => this.tellHidden();
      document.addEventListener('visibilitychange', seen);
      this.offDoc.push(() => document.removeEventListener('visibilitychange', seen));
    }
    if (typeof addEventListener === 'function') {
      // Closing or reloading the tab mid-match asks first. A reload rejoins (session.ts); a close does not.
      const asking = (e: BeforeUnloadEvent) => { if (this.begun && !this.closed && this.lobby.phase === 'open' && !leavingOnPurpose()) e.preventDefault(); };
      addEventListener('beforeunload', asking);
      this.offDoc.push(() => removeEventListener('beforeunload', asking));
    }
  }
  get hosting(): boolean { return this.lobby.hosting; }
  async init(): Promise<void> {
    // The Bailiffs: the friends' own bodies, and the host's garrison drawn on guests.
    await this.ctx.characters.load(['bailiff', 'bailiffHeavy']);
    const lib = this.ctx.characters as Ctx['characters'] & { prop(id: string): Promise<unknown> };
    // Every gun a friend may hold; a prop that fails to load leaves that friend holding the last one.
    await Promise.all(PROPS.map(id => Promise.resolve().then(() => lib.prop(id)).catch(() => undefined)));
    this.ready = true;
  }
  /**
   * The load barrier's half on this page. True from the deploy click until the host's world starts: the host holds its waves,
   * directors and mission meanwhile (core/Game.ts), and every screen says who is still loading.
   */
  get holding(): boolean { return !!this.world && !this.lobby.live; }

  /**
   * The map has loaded. Nothing starts yet: the page shows "Click to deploy", and that click is what takes the mouse,
   * unlocks the sound, starts the local run (`start`) and tells the host this player is in. A room that closed, or a match
   * that ended, while the page was loading is told here instead, with the real reason.
   */
  gate(start: () => void): void {
    if (this.closed) return;
    this.lobby.booted();
    if (this.lobby.phase === 'closed') return this.roomClosed();
    if (this.endedEarly || whileLoading.ended) return this.end('The match ended while you were loading. You are back in the lobby.', true);
    this.gateStart = start;
    if (typeof document !== 'undefined') {
      this.view ??= new SessionHud();
      this.view.showGate(`Co-op · ${this.hosting ? 'hosting' : 'joining'}`, () => this.deploy());
    }
    this.changed();
  }

  /** This page has its host and its match: the click may go ahead. */
  private get canDeploy(): boolean {
    return this.lobby.phase === 'open' && this.lobby.match?.id === this.match.id && !this.lobby.reconnecting;
  }

  /** The deploy click (or Enter). Also for scripts: `__op2.ctx.coop.deploy()`. */
  deploy(): boolean {
    const start = this.gateStart;
    if (!start || this.closed || !this.canDeploy) return false;
    this.gateStart = null;
    this.view?.hideGate();
    start();
    this.begin();
    return true;
  }

  /** Called after run:start has reset the HUD's world markers. */
  begin(): void {
    this.begun = true;
    // Another tab of this browser taking over would end this (core/oneTab.ts): its notice says so.
    tabBusy.coop = this.hosting ? 'host' : 'guest';
    // `window.__op2.net` for scripts and the console: the simulator, the counters, and this meter (debug.ts).
    publishNet();
    watchCost(() => this.cpuMs);
    this.gateStart = null;
    if (!this.hud && typeof document !== 'undefined') {
      this.view ??= new SessionHud();
      this.hud = new CoopHud(this.ctx, this);
      this.hud.onEndDone = () => this.backToLobby();
      this.hud.onPlayAgain = () => this.playAgain();
    }
    if (this.world) this.world.team.onOver = (cards, wave, ending) => this.hud?.showEnd(this.world!.team.roster().filter(r => cards.some(c => c.slot === r.card.slot))
      .map(r => ({ ...r, card: cards.find(c => c.slot === r.card.slot)! })), wave, performance.now(), ending);
    this.changed();
    if (this.closed) return;
    // The host's world is up before its own word lifts the barrier (`deployed` can start the waves on the spot). A guest
    // says it is in first: what its world then asks of the host (`worldsync`) is read by a host that has it in the match,
    // not dropped as a word from a player still loading.
    if (this.hosting) { this.world?.begin(); this.lobby.deployed(); }
    else { this.lobby.deployed(); this.world?.begin(); }
  }

  /** Every change in the room: a list from the host, a line, a link in trouble, the room closing. */
  private changed(): void {
    if (this.closed) return;
    // Before the gate there is nobody to tell yet: the boot's end reads the room's state itself (`gate`).
    if (!this.gateStart && !(this.ready && this.begun)) return;
    if (this.lobby.phase === 'closed') return this.roomClosed();
    if (this.gateStart) return this.paintGate();
    this.roster();
  }

  private paintGate(): void {
    const lobby = this.lobby;
    const others = lobby.waitingFor.filter(p => p.id !== lobby.you);
    const sub = lobby.reconnecting ? `Reconnecting to host… ${lobby.reconnectIn}`
      : lobby.phase !== 'open' ? 'Finding the host…'
      : !this.canDeploy ? 'Waiting for the host…'
      : lobby.live ? 'The match is already running: you join it in progress.'
      : others.length ? `${others.map(p => p.name).join(', ')} still loading. You can deploy and look around; the fight starts when everyone is in.`
      : 'Everyone else is ready.';
    this.view?.paintGate(this.canDeploy, sub, lobby.players, lobby.you);
  }

  /** The room closed under this page: the real reason, on the screen and in the console (the lobby logs it as it closes). */
  private roomClosed(): void {
    const { lobby } = this;
    const error = lobby.error;
    const reason = error ? errorText(error, lobby.theirBuild, this.code, lobby.connectAdvice) : 'The co-op room closed.';
    const hostGone = !this.hosting && (error === 'host-left' || error === 'lost') && !!this.code;
    // This host gave way to another on its code (lobby.ts `otherHost`): its page reloaded for longer than its guests
    // waited, and they have regrouped under one of them. It joins that lobby as a guest; nobody is left hosting alone.
    if (this.hosting && error === 'code-taken' && this.code) {
      const who = lobby.yieldedTo || 'A teammate';
      return this.end('', false, { code: this.code, password: this.password, rank: 1, names: [who], name: lobby.me?.name,
        note: `Your team regrouped while this page was away. ${who} is hosting now; you have joined their lobby.` });
    }
    if (!hostGone) return this.end(error === 'host-left' ? 'The host left. The co-op match has ended.' : reason, false);
    // No host migration: the world lived on the host's page. Everyone who is left meets again on the same code instead.
    const { rank, names } = lobby.successors();
    const next = names[0] ?? 'You';
    const lead = error === 'lost' ? 'Lost the connection to the host.' : 'The host left.';
    this.regroup = { code: this.code, password: this.password, rank, names, name: lobby.me?.name,
      note: rank === 0 ? `${lead} You are hosting this lobby now${names.length > 1 ? '; the others are rejoining' : ''}.` : `${lead} ${next} is hosting now.` };
    // Mid-match the team's numbers are shown first; before the deploy click there is nothing to show.
    if (!this.begun || !this.world || !this.view || this.lostUntil) {
      if (!this.lostUntil) this.end(this.regroup.note, false, this.regroup);
      return;
    }
    this.lostUntil = performance.now() + LOST_BOARD_MS;
    const wave = this.ctx.waves.wave;
    this.view.setLine('');
    this.view.showLost('HOST LOST', `${lead} The match ended${wave > 0 ? ` on wave ${wave}` : ''}. Your team's numbers are below.`,
      this.world.team.roster().map(r => ({ name: r.name, color: r.color, me: r.me, kills: r.card.kills, score: r.card.score, credits: r.card.credits })));
    for (const remote of this.remotes.values()) remote.dispose();
    this.remotes.clear();
  }

  private roster(): void {
    if (this.closed || !this.ready || !this.begun) return;
    // Joins, drops and returns are the lobby's own lines (chatLine): one source, so nothing is said twice.
    const players = this.lobby.players.filter(p => p.id !== this.lobby.you && !p.away);
    for (const [id, remote] of this.remotes) {
      const player = players.find(p => p.id === id);
      if (!player || player.name !== remote.player.name) {
        remote.dispose();
        this.remotes.delete(id);
      }
    }
    // Each friend's seat on this screen, 1 to 3: the slots but this player's own, in order (their strand of a hose, their light).
    const mine = this.lobby.me?.slot ?? 0;
    for (const p of players) if (!this.remotes.has(p.id)) {
      const seat = Math.min(3, Math.max(1, p.slot < mine ? p.slot + 1 : p.slot));
      this.remotes.set(p.id, new RemotePlayer(this.ctx, p, seat, this.torches[seat - 1] ?? null));
    }
  }
  private chatLine(line: ChatLine): void {
    if (!this.begun || this.closed) return;
    this.ctx.hud.feed(line.from ? `${line.from}: ${line.text}` : line.text, line.from ? '#cfe8ff' : '#ffb33d');
  }
  private tellHidden(): void {
    const hidden = document.hidden;
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.lobby.notice(hidden ? 'The host\'s game is in a background tab: the world keeps running, a little coarser.' : 'The host is back.');
  }
  /** The one status line: the link in trouble first, then who the world is still waiting for. */
  private status(): void {
    const { lobby, view } = this;
    if (!view) return;
    if (this.gateStart) return this.paintGate();
    if (this.lostUntil || !this.begun) return;
    if (lobby.reconnecting) return view.setLine(`Reconnecting to host… ${lobby.reconnectIn}`, true);
    // The host has stopped feeding this page: it is behind, or cut for it until its queue has drained (lobby.ts `stall`).
    // The host's list would say so (`lost`), but it is queued behind the very backlog and arrives as the cut ends: for the
    // seconds that matter the page reads it off the feed having stopped (`feed`). The world stands still meanwhile, and a
    // player is never left in a still world without being told why.
    if (!this.hosting && (this.starving || lobby.me?.state === 'lost')) return view.setLine(TOO_SLOW, true);
    const waiting = lobby.match && !lobby.live ? lobby.waitingFor : [];
    if (!waiting.length) return view.setLine('');
    view.setLine(`Waiting for ${waiting.map(p => p.name).join(', ')}${lobby.holdLeft ? ` · starting without them in ${lobby.holdLeft} s` : ''}`);
  }

  /**
   * Guest: is the host still feeding this page its world? Its latest-wins data (snapshots, its own pose) stops when this
   * page is behind and when the host has cut it (starved.ts). Not counted: the host's tab hidden (its own line says so and
   * the world runs coarser), the host's page loading its map (that is "Waiting for HOST"), the run over, and a line that
   * is down (that is "Reconnecting").
   */
  private feed(now: number): void {
    const { lobby, world } = this;
    if (this.hosting || !this.begun || !world) { this.starving = false; return; }
    let resting = false;
    for (const player of lobby.players) if (player.host && (player.idle === 'hidden' || player.state)) resting = true;
    if (resting || lobby.reconnecting || world.team.final) {
      this.starved.reset();
      this.starving = false;
      return;
    }
    this.starving = this.starved.update(now, Math.max(this.poseAt, world.fedAt ?? 0));
  }

  update(): void {
    if (this.closed || !this.ready) return;
    const now = performance.now();
    this.lobby.heartbeat(now);
    // The network simulator's delayed sends leave on the frame too: a hidden tab's timers run once a second.
    pageSim().pump();
    if (this.closed) return;
    this.feed(now);
    this.status();
    if (this.lostUntil) {
      const left = Math.max(0, Math.ceil((this.lostUntil - now) / 1000));
      const plan = this.regroup!;
      this.view?.setLostFoot(plan.rank === 0 ? `You host the new lobby in ${left}` : `Regrouping in ${plan.names[0] ?? 'a teammate'}'s lobby in ${left}`);
      if (now >= this.lostUntil) return this.end(plan.note, false, plan);
    }
    if (!this.begun) return;
    // Standing still under a menu, or in a hidden tab: the others are told, so nobody wonders why (lobby.ts `idle`).
    const idle = typeof document !== 'undefined' && document.hidden ? 'hidden' : this.localPaused ? 'menu' : undefined;
    if (idle !== this.idle) this.lobby.setIdle(this.idle = idle);
    for (const remote of this.remotes.values()) remote.update(now, this.ctx.time.realDt);
    this.world?.update();
    // What co-op itself costs a frame (bodies, snapshots, events), averaged, for the measurements in docs/notes/coop.md.
    const spent = performance.now() - now;
    this.cpuMs += (spent - this.cpuMs) * 0.05;
    metrics.spend('coop.update', spent);
    if (this.world && this.hud) this.hud.update(this.world.team.roster(), now);
    if (now < this.nextPose || !this.lobby.match) return;
    this.nextPose = now >= this.nextPose + POSE_MS ? now + POSE_MS : this.nextPose + POSE_MS; // Never catch up by bursting a backlog after a stalled/background tab.
    const p = this.ctx.player as Ctx['player'] & { downed?: boolean; mantling?: boolean; vaulting?: boolean; jetting?: boolean };
    const team = this.world?.team;
    const move: Move = p.downed ? 'downed' : team?.reviving ? 'revive'
      : this.localPaused ? (p.crouched ? 'crouch' : p.grounded ? 'walk' : 'airborne')
      : p.wallRunning ? (p.wallSide > 0 ? 'wallrunR' : 'wallrun') : p.mantling || p.vaulting ? 'mantle' : p.sliding ? 'slide' : p.jetting ? 'jet' : !p.grounded ? 'airborne'
      : p.crouched ? 'crouch' : p.speed > 8 ? 'sprint' : 'walk';
    const clamp = (n: number, bound: number) => (Number.isFinite(n) ? Math.max(-bound, Math.min(bound, n)) : 0);
    const rawWeapon = this.ctx.weapons.akimbo ? `${this.ctx.weapons.current}${AKIMBO_TAG}` : this.ctx.weapons.current;
    const weapon = /^[a-zA-Z0-9_-]{1,32}$/.test(rawWeapon) ? rawWeapon : 'smg';
    try {
      this.lobby.sendPose({
        seq: this.seq++ >>> 0,
        position: [clamp(p.position.x, 9999), clamp(p.position.y, 9999), clamp(p.position.z, 9999)],
        velocity: this.localPaused ? [0, 0, 0] : [clamp(p.velocity.x, 999), clamp(p.velocity.y, 999), clamp(p.velocity.z, 999)],
        yaw: clamp(Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw)), Math.PI * 2),
        pitch: clamp(p.pitch, Math.PI),
        move,
        // `-ak`: two of it in hand (the akimbo mod), drawn so on the others' screens (remote.ts).
        weapon,
        // What they are doing with the gun besides firing it: a reload, a stim, the laser up, a charge (pose.ts DOING).
        flags: this.world?.doing() ?? 0,
      });
    } catch (error) {
      console.warn('[coop] Dropped invalid local pose', error);
    }
  }

  /** Host: the match is over for everyone, and they all land on the lobby page. */
  backToLobby(): void {
    if (this.closed) return;
    this.end(this.hosting ? 'Match over. Everyone is back in the lobby.' : 'You left the match. The others play on; Rejoin match takes you back.', true);
  }

  /**
   * Host, from the end board: the same mode again for everyone. The match ends, every player lands on the lobby page (which is
   * what takes a `start`), and the next match starts at once, each on the gun they had picked.
   */
  playAgain(): void {
    if (this.closed || !this.hosting) return;
    const { mode, map } = this.match;
    const lobby = this.lobby;
    this.end('Starting again: the same contract, for everyone.', true);
    if (lobby.phase === 'open' && !lobby.match) lobby.startMatch(mode, undefined, map);
  }

  private end(message: string, keepRoom: boolean, regroup?: Regroup): void {
    const room = this.leave(keepRoom);
    this.onEnded(message, room, regroup);
  }

  /**
   * Leaves the match. `keepRoom`: stay in the room on its lobby page (the host ends the match for everyone, a guest steps
   * out while the others play on). Returns that room, or null when it is gone.
   */
  leave(keepRoom = false): Room | null {
    if (this.closed) return null;
    this.closed = true;
    tabBusy.coop = '';
    this.world?.dispose();
    this.lobby.batching(null);
    this.hud?.dispose();
    watchCost(null);
    this.view?.dispose();
    this.gateStart = null;
    for (const off of this.offDoc) off();
    for (const remote of this.remotes.values()) remote.dispose();
    this.remotes.clear();
    for (const light of this.torches) { light.removeFromParent(); light.target.removeFromParent(); light.dispose(); }
    this.lobby.onChange = () => {};
    this.lobby.onPose = () => {};
    this.lobby.onLine = () => {};
    this.lobby.onEnd = () => {};
    this.lobby.onMatch = () => {};
    this.lobby.onGo = () => {};
    this.lobby.onSeat = () => {};
    const open = keepRoom && this.lobby.phase === 'open' && !!this.code;
    if (open) {
      if (this.hosting) this.lobby.endMatch();
      // A guest the host already sent back has no match to step out of.
      else if (this.lobby.match) this.lobby.away(false);
    } else {
      this.lobby.leave();
      // Out of the room as well as the match: a reload must not walk back in (a regroup remembers the room again as it joins).
      forgetRoom();
    }
    clearSession();
    return open ? { lobby: this.lobby, code: this.code, password: this.password, match: this.match } : null;
  }
}

/** This page is changing address of its own accord (to a map page): no prompt for that. */
const leavingOnPurpose = (): boolean => deploying || isPageNavigationAllowed();

declare module '../core/contracts' {
  interface Ctx { coop?: CoopSession }
}
