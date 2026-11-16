/** Stage 1 game-facing co-op interface. Future host world snapshots/hit claims belong here, never in Player or Weapons. */
import type { Ctx, GameSystem } from '../core/contracts';
import { Lobby, type Match } from './lobby';
import { POSE_MS, type Move } from './pose';
import { RemotePlayer } from './remote';
import { clearSession } from './session';
import { CoopWorld } from './world';

export class CoopSession implements GameSystem {
  readonly freeRoam: boolean;
  readonly world: CoopWorld | null;
  localPaused = false;
  readonly remotes = new Map<string, RemotePlayer>();
  private ready = false;
  private begun = false;
  private closed = false;
  private nextPose = 0;
  private seq = 0;
  private seen = new Map<string, string>();
  onEnded: (message: string) => void = () => {};

  constructor(private readonly ctx: Ctx, readonly lobby: Lobby, readonly match: Match) {
    this.freeRoam = match.mode !== 'crucible';
    this.world = this.freeRoam ? null : new CoopWorld(ctx, this);
    lobby.onChange = () => this.roster();
    lobby.onPose = (id, pose) => this.remotes.get(id)?.push(pose, performance.now());
  }
  get hosting(): boolean { return this.lobby.hosting; }
  async init(): Promise<void> {
    await this.ctx.characters.load(['bailiff']);
    const lib = this.ctx.characters as Ctx['characters'] & { prop(id: string): Promise<unknown> };
    await lib.prop('smg');
    this.ready = true;
  }
  /** Called after run:start has reset the HUD's world markers. */
  begin(): void {
    this.begun = true;
    this.roster();
    if (!this.closed) this.world?.begin();
  }
  private roster(): void {
    if (this.closed || !this.ready || !this.begun) return;
    if (this.lobby.phase === 'closed') {
      const message = this.lobby.error === 'host-left' ? 'The host left. The co-op match has ended.'
        : 'The co-op room disconnected. Return to Multiplayer to try again.';
      this.leave();
      this.onEnded(message);
      return;
    }
    const players = this.lobby.players.filter(p => p.id !== this.lobby.you);
    for (const [id, remote] of this.remotes) {
      const player = players.find(p => p.id === id);
      if (!player || player.name !== remote.player.name) {
        remote.dispose();
        this.remotes.delete(id);
      }
    }
    for (const [id, name] of this.seen) if (!players.some(p => p.id === id)) this.ctx.hud.feed(`${name} left.`, '#ffb33d');
    this.seen = new Map(players.map(p => [p.id, p.name]));
    for (const p of players) if (!this.remotes.has(p.id)) this.remotes.set(p.id, new RemotePlayer(this.ctx, p));
  }
  update(): void {
    if (this.closed || !this.ready) return;
    const now = performance.now();
    for (const remote of this.remotes.values()) remote.update(now, this.ctx.time.realDt);
    this.world?.update();
    if (now < this.nextPose || !this.lobby.match) return;
    this.nextPose = now >= this.nextPose + POSE_MS ? now + POSE_MS : this.nextPose + POSE_MS; // Never catch up by bursting a backlog after a stalled/background tab.
    const p = this.ctx.player;
    const move: Move = this.localPaused ? (p.crouched ? 'crouch' : p.grounded ? 'walk' : 'airborne') : p.wallRunning ? 'wallrun' : p.sliding ? 'slide' : !p.grounded ? 'airborne'
      : p.crouched ? 'crouch' : p.speed > 8 ? 'sprint' : 'walk';
    this.lobby.sendPose({ seq: this.seq++ >>> 0, position: p.position.toArray(), velocity: this.localPaused ? [0, 0, 0] : p.velocity.toArray(),
      yaw: Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw)), pitch: p.pitch, move, weapon: this.ctx.weapons.current });
  }
  leave(): void {
    if (this.closed) return;
    this.closed = true;
    this.world?.dispose();
    for (const remote of this.remotes.values()) remote.dispose();
    this.remotes.clear();
    this.lobby.onChange = () => {};
    this.lobby.onPose = () => {};
    this.lobby.leave();
    clearSession();
  }
}

declare module '../core/contracts' {
  interface Ctx { coop?: CoopSession }
}
