/** The game-facing co-op session. Host world snapshots and hit claims are world.ts, the team rules team.ts; never Player or Weapons. */
import type { Ctx, GameSystem } from '../core/contracts';
import { Lobby, type ChatLine, type Match } from './lobby';
import { POSE_MS, type Move } from './pose';
import { PROPS, RemotePlayer } from './remote';
import { clearSession, resumedRoom } from './session';
import { CoopWorld } from './world';
import { CoopHud } from './coopHud';

/** The modes whose world the host runs. The others are free roam: everyone walks the map, nothing else. */
export const WORLD_MODES: readonly Match['mode'][] = ['crucible'];

/** Where a player lands after the match: the same room, on its lobby page. */
export interface Room { lobby: Lobby; code: string; password: string }

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
  private seen = new Map<string, string>();
  private hidden = false;
  private firstRoster = true;
  private readonly offDoc: (() => void)[] = [];
  /** Why the match ended under this player, and whether the room is still there to go back to. */
  onEnded: (message: string, room: Room | null) => void = () => {};

  constructor(private readonly ctx: Ctx, readonly lobby: Lobby, readonly match: Match, private readonly code = resumedRoom?.code ?? '', private readonly password = resumedRoom?.password ?? '') {
    this.freeRoam = !WORLD_MODES.includes(match.mode);
    this.world = this.freeRoam ? null : new CoopWorld(ctx, this);
    lobby.onChange = () => this.roster();
    lobby.onPose = (id, pose) => this.remotes.get(id)?.push(pose, performance.now());
    lobby.onLine = line => this.chatLine(line);
    // The host took everyone back to the lobby page.
    lobby.onEnd = () => this.end('The host ended the match. You are back in the lobby.', true);
    if (typeof document !== 'undefined' && lobby.hosting) {
      const seen = () => this.tellHidden();
      document.addEventListener('visibilitychange', seen);
      this.offDoc.push(() => document.removeEventListener('visibilitychange', seen));
    }
  }
  get hosting(): boolean { return this.lobby.hosting; }
  async init(): Promise<void> {
    await this.ctx.characters.load(['bailiff']);
    const lib = this.ctx.characters as Ctx['characters'] & { prop(id: string): Promise<unknown> };
    // Every gun a friend may hold; a prop that fails to load leaves that friend holding the last one.
    await Promise.all(PROPS.map(id => Promise.resolve().then(() => lib.prop(id)).catch(() => undefined)));
    this.ready = true;
  }
  /** Called after run:start has reset the HUD's world markers. */
  begin(): void {
    this.begun = true;
    if (!this.hud && typeof document !== 'undefined') {
      this.hud = new CoopHud(this.ctx, this);
      this.hud.onEndDone = () => this.backToLobby();
    }
    if (this.world) this.world.team.onOver = (cards, wave) => this.hud?.showEnd(this.world!.team.roster().filter(r => cards.some(c => c.slot === r.card.slot))
      .map(r => ({ ...r, card: cards.find(c => c.slot === r.card.slot)! })), wave, performance.now());
    this.roster();
    if (!this.closed) this.world?.begin();
  }
  private roster(): void {
    if (this.closed || !this.ready || !this.begun) return;
    if (this.lobby.phase === 'closed') {
      const message = this.lobby.error === 'host-left' ? 'The host left. The co-op match has ended.'
        : this.lobby.error === 'lost' ? 'Lost the connection to the host. The co-op match has ended.'
        : 'The co-op room disconnected. Return to Multiplayer to try again.';
      this.end(message, false);
      return;
    }
    const players = this.lobby.players.filter(p => p.id !== this.lobby.you && !p.away);
    for (const [id, remote] of this.remotes) {
      const player = players.find(p => p.id === id);
      if (!player || player.name !== remote.player.name) {
        remote.dispose();
        this.remotes.delete(id);
      }
    }
    for (const [id, name] of this.seen) if (!players.some(p => p.id === id)) this.ctx.hud.feed(`${name} left.`, '#ffb33d');
    for (const p of players) if (!this.seen.has(p.id) && !this.firstRoster) {
      this.ctx.hud.feed(`${p.name} joined.`, '#79f1ad');
      if (this.hosting) this.world?.team.restore(p.id);
    }
    this.seen = new Map(players.map(p => [p.id, p.name]));
    this.firstRoster = false;
    for (const p of players) if (!this.remotes.has(p.id)) this.remotes.set(p.id, new RemotePlayer(this.ctx, p));
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
  update(): void {
    if (this.closed || !this.ready) return;
    const now = performance.now();
    this.lobby.heartbeat(now);
    for (const remote of this.remotes.values()) remote.update(now, this.ctx.time.realDt);
    this.world?.update();
    if (this.world && this.hud) this.hud.update(this.world.team.roster(), now);
    if (now < this.nextPose || !this.lobby.match) return;
    this.nextPose = now >= this.nextPose + POSE_MS ? now + POSE_MS : this.nextPose + POSE_MS; // Never catch up by bursting a backlog after a stalled/background tab.
    const p = this.ctx.player as Ctx['player'] & { downed?: boolean; mantling?: boolean; vaulting?: boolean };
    const team = this.world?.team;
    const move: Move = p.downed ? 'downed' : team?.reviving ? 'revive'
      : this.localPaused ? (p.crouched ? 'crouch' : p.grounded ? 'walk' : 'airborne')
      : p.wallRunning ? (p.wallSide > 0 ? 'wallrunR' : 'wallrun') : p.mantling || p.vaulting ? 'mantle' : p.sliding ? 'slide' : !p.grounded ? 'airborne'
      : p.crouched ? 'crouch' : p.speed > 8 ? 'sprint' : 'walk';
    this.lobby.sendPose({ seq: this.seq++ >>> 0, position: p.position.toArray(), velocity: this.localPaused ? [0, 0, 0] : p.velocity.toArray(),
      yaw: Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw)), pitch: p.pitch, move, weapon: this.ctx.weapons.current });
  }

  /** Host: the match is over for everyone, and they all land on the lobby page. */
  backToLobby(): void {
    if (this.closed) return;
    this.end(this.hosting ? 'Match over. Everyone is back in the lobby.' : 'You left the match. The others play on; Rejoin match takes you back.', true);
  }

  private end(message: string, keepRoom: boolean): void {
    const room = this.leave(keepRoom);
    this.onEnded(message, room);
  }

  /**
   * Leaves the match. `keepRoom`: stay in the room on its lobby page (the host ends the match for everyone, a guest steps
   * out while the others play on). Returns that room, or null when it is gone.
   */
  leave(keepRoom = false): Room | null {
    if (this.closed) return null;
    this.closed = true;
    this.world?.dispose();
    this.hud?.dispose();
    for (const off of this.offDoc) off();
    for (const remote of this.remotes.values()) remote.dispose();
    this.remotes.clear();
    this.lobby.onChange = () => {};
    this.lobby.onPose = () => {};
    this.lobby.onLine = () => {};
    this.lobby.onEnd = () => {};
    const open = keepRoom && this.lobby.phase === 'open' && !!this.code;
    if (open) {
      if (this.hosting) this.lobby.endMatch();
      // A guest the host already sent back has no match to step out of.
      else if (this.lobby.match) this.lobby.away(false);
    } else this.lobby.leave();
    clearSession();
    return open ? { lobby: this.lobby, code: this.code, password: this.password } : null;
  }
}

declare module '../core/contracts' {
  interface Ctx { coop?: CoopSession }
}
