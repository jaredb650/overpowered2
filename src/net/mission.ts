/**
 * Campaign co-op (stage 5). The host's browser runs the mission: the runner, its triggers, the spawns, the battles.
 * Everything a mission shows or hands to "the player" is mirrored to every guest's own campaign host, which runs inert
 * (no runner) and only draws: the villain's lines, objectives, hints, banners, doors, cutscenes, music, the guns and
 * grenades handed out, pickups dropped, a rack to take a gun from, a teleport, a deploy, and the rides.
 *
 * Per-mission rules (docs/notes/coop.md, "Campaign co-op", has the table):
 * - A zone trigger fires when ANY living player is in it; an `outside` trigger when ALL have left (MissionHost.crowd).
 * - A door that closes gathers the group: a guest more than GATHER_M from the host is put beside them, so no gate splits it.
 * - `place` and `deploy` put everyone at the mark, each a step to the side by slot.
 * - A ride (the Outpost's door-gunner intro, Foreclosure's flights) is flown by everyone: each player sits in the door gun of
 *   their own copy of the same Packmule on the same route and clock, and their rounds count through the host as call-in hits.
 *   The gunship sortie is the same. The Frame (the mech) is the host's alone.
 * - A checkpoint gets everyone up: the downed and the dead respawn beside the host.
 * - Everyone down at once: the whole team goes back to the last checkpoint (the mission's own redeploy), not a game over.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import type { CoopSession } from './index';
import type { WorldEvent } from './worldProtocol';
import type { Team } from './team';
import type { Router } from './world/router';
import type { Vec } from './world/wire';

/** The mission's events on the wire. */
export type MissionEvent =
  /** Host: a mission host op every guest plays on its own inert mission host. Data only; callbacks stay on the host. */
  | { t: 'mission'; op: string; args: unknown[] }
  /** Host: a gate is closing; a guest far from `at` is brought there. */
  | { t: 'gather'; at: Vec; yaw: number };

/** What a guest mirrors. Everything else (squads, battles, spawns, vehicles, bosses) is the host's world, replicated as such. */
export const MIRRORED = ['speak', 'hush', 'objectives', 'hint', 'banner', 'door', 'music', 'cutscene', 'give', 'grenades', 'drop', 'rack',
  'place', 'deploy', 'ride', 'sortie'] as const;
export type MirroredOp = typeof MIRRORED[number];
/** Ops whose last argument is a callback: the guest's copy gets one that does nothing. */
const CALLBACK: ReadonlySet<MirroredOp> = new Set(['speak', 'door', 'cutscene', 'rack', 'ride', 'sortie']);
const GATHER_M = 30;
const noop = (): void => {};

type Host = Record<string, (...args: unknown[]) => unknown> & { playerAt?(out: { x: number; y: number; z: number }): void };

/** A mark moved a step to the side for this slot, so four players never land in one spot. */
export function spread(at: readonly number[], yaw: number, slot: number): [number, number, number] {
  const side = slot === 0 ? 0 : (slot % 2 ? 1 : -1) * Math.ceil(slot / 2) * 1.3;
  return [at[0]! + Math.cos(yaw) * side, at[1]!, at[2]! - Math.sin(yaw) * side];
}

export class CoopMission {
  private wrapped = false;
  /** Host: the latest of each op a late joiner needs to be where the mission is (and every door as it last moved). */
  private readonly latest = new Map<string, unknown[]>();
  /** The beat's title over the objectives: the host's runner's, shown on every screen. */
  private beatTitle = '';
  /** Guest: mirrored ops played, for the proofs. */
  mirrored = 0;

  constructor(private readonly ctx: Ctx, private readonly session: CoopSession, private readonly send: (event: WorldEvent, to?: string) => void,
    private readonly team: Team, private readonly onRide: () => void) {}

  private get host(): Host | null {
    const campaign = this.ctx.campaign as unknown as { active?: boolean; host?: Host };
    return campaign?.active ? campaign.host ?? null : null;
  }

  /** Host: wraps the mission host so each mirrored op also goes to the guests, and the zones see every player. */
  begin(): void {
    const host = this.host;
    if (!host || !this.session.hosting || this.wrapped) return;
    this.wrapped = true;
    const parts: Record<string, unknown> = {};
    for (const op of MIRRORED) {
      const real = host[op]?.bind(host);
      if (!real) continue;
      parts[op] = (...args: unknown[]) => {
        const data = CALLBACK.has(op) ? args.slice(0, -1) : args;
        if (op === 'ride' || op === 'sortie') this.onRide();
        if (op === 'door' && args[2] === 0) this.gather();
        const wire = JSON.parse(JSON.stringify(data)) as unknown[];
        this.send({ t: 'mission', op, args: wire });
        if (op === 'door') this.latest.set(`door:${String(args[0])}`, [args[0], args[1], args[2], 0]);
        else if (op === 'objectives' || op === 'music' || op === 'deploy' || op === 'give' || op === 'grenades') this.latest.set(op, wire);
        return real(...args);
      };
    }
    // Any living player in a zone counts (watch.ts).
    parts.crowd = () => this.crowd();
    // A checkpoint gets everyone up, beside the host.
    const saved = host.saved?.bind(host);
    if (saved) parts.saved = (...args: unknown[]) => { this.team.respawnAll(); return saved(...args); };
    (this.ctx.campaign as unknown as { provide(parts: object): void }).provide(parts);
  }

  /** Host: a guest who joined (or rejoined) mid-mission gets its loadout, objectives, music and doors, and is put beside the host. */
  catchUp(id: string): void {
    if (!this.wrapped) return;
    for (const [key, args] of this.latest) {
      const op = key.startsWith('door:') ? 'door' : key;
      // The deploy's guns, never its mark: the mission has moved on from where it began.
      this.send({ t: 'mission', op, args: op === 'deploy' ? [null, args[1]] : args }, id);
    }
    const at = this.ctx.player.position;
    this.send({ t: 'gather', at: [at.x, at.y, at.z], yaw: this.ctx.player.yaw }, id);
  }

  /** Where every living player stands, for the mission's zones. */
  crowd(): { x: number; y: number; z: number }[] {
    const out: { x: number; y: number; z: number }[] = [];
    for (const p of this.session.lobby.players) {
      if (p.away || this.team.life(p.id).state !== 'up') continue;
      const at = p.id === this.session.lobby.you ? this.ctx.player.position : this.session.remotes.get(p.id)?.char.root.position;
      if (at && (p.id === this.session.lobby.you || this.session.remotes.get(p.id)?.char.root.visible)) out.push({ x: at.x, y: at.y, z: at.z });
    }
    return out;
  }

  /** Host: a gate is closing. Guests far from the host are brought to them. */
  private gather(): void {
    const at = this.ctx.player.position;
    this.send({ t: 'gather', at: [at.x, at.y, at.z], yaw: this.ctx.player.yaw });
  }

  /** Registers the mission's events with the world's router (world/router.ts): a guest hears both, the host neither. */
  plug(router: Router): void {
    router.guest('mission', event => { this.receive(event); });
    router.guest('gather', event => { this.receive(event); });
  }

  /** Guest: plays a mirrored op on its own (inert) mission host. */
  receive(value: WorldEvent): boolean {
    if (value.t === 'gather') {
      const at = value.at;
      if (!Array.isArray(at) || at.length !== 3 || !at.every(Number.isFinite)) return true;
      const here = this.ctx.player.position;
      if (Math.hypot(here.x - at[0]!, here.z - at[2]!) > GATHER_M) {
        const slot = this.session.lobby.me?.slot ?? 1;
        this.ctx.player.teleport(new THREE.Vector3(...spread(at, Number.isFinite(value.yaw) ? value.yaw : 0, slot)), value.yaw);
      }
      return true;
    }
    if (value.t !== 'mission') return false;
    if (value.op === 'beat') { this.beatTitle = String(value.args?.[0] ?? '').slice(0, 80); return true; }
    const host = this.host;
    const op = value.op as MirroredOp;
    if (!host || !MIRRORED.includes(op) || !Array.isArray(value.args) || value.args.length > 6) return true;
    const args = [...value.args];
    // Everyone lands at the mark, a step apart.
    if ((op === 'place' || op === 'deploy') && args[0] && typeof args[0] === 'object') {
      const mark = args[0] as { at?: number[]; yaw?: number };
      if (Array.isArray(mark.at) && mark.at.length === 3 && mark.at.every(Number.isFinite)) {
        args[0] = { ...mark, at: spread(mark.at, mark.yaw ?? 0, this.session.lobby.me?.slot ?? 1) };
      }
    }
    if (CALLBACK.has(op)) args.push(noop);
    try { host[op]?.(...args); this.mirrored++; } catch (error) { console.warn('[coop] Could not mirror the mission\'s', op, error); }
    return true;
  }

  /** Every frame: the host says when the beat changes; a guest shows the host's beat over its own (empty) one. */
  update(): void {
    const campaign = this.ctx.campaign as unknown as { active?: boolean; runner?: { beat?: { title?: string } | null }; ui?: { beat(title: string): void } };
    if (!campaign?.active) return;
    if (this.session.hosting) {
      const title = campaign.runner?.beat?.title ?? '';
      if (title !== this.beatTitle) {
        this.beatTitle = title;
        this.latest.set('beat', [title]);
        this.send({ t: 'mission', op: 'beat', args: [title] });
      }
    } else campaign.ui?.beat(this.beatTitle);
  }
}
