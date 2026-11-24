/**
 * The team's break between waves (co-op only; single player keeps its own). Solo, the run waits under the shop, so a break
 * lasts as long as the shopping. With a team nothing waits, so the break is longer and the team ends it together:
 *
 * - `TEAM_BREAK` seconds after a cleared wave, `BOSS_BREAK` before a boss wave (the Crucible's bosses, Endless Humans' last).
 * - The next-wave key is a vote. When every living player has pressed it the break drops to its last `CUT_TO` seconds.
 *   One player alone never cuts another's shopping short. The vote shows on the HUD ("2/3 ready") and in the feed.
 * - A guest's key is a `ready` sent to the host; the host's key is a vote like anyone's. The host owns the clock.
 *
 * The first countdown of a run (before wave 1) is not a break: no vote, no stretch.
 */
import type { Ctx } from '../core/contracts';
import { FINAL_WAVE } from '../enemies/commander/adaptations';
import { isBossWave } from '../enemies/waves';
import type { CoopSession } from './index';
import type { WorldEvent } from './worldProtocol';

/** Seconds of a team's break: time to reach the pod, wait for it to open and buy, for everyone. */
export const TEAM_BREAK = 45;
/** Before a boss wave. */
export const BOSS_BREAK = 60;
/** What is left of the break once everyone is ready: the waves' own last three ticks. */
export const CUT_TO = 3;
const VOTE_COLOR = '#ff8a3a';

/** How long the break before `next` lasts in `mode`, by the host's rules. */
export function teamBreakSeconds(mode: string, next: number, rules?: Parameters<typeof isBossWave>[1]): number {
  const boss = mode === 'crucible'
    ? isBossWave(next, rules)
    : mode === 'outpost'
      ? next >= FINAL_WAVE
      : mode === 'rooftop' || mode === 'badlands'
        ? next >= 5 && next % 5 === 0
        : false;
  return boss ? BOSS_BREAK : TEAM_BREAK;
}

export class TeamBreak {
  /** A break after a cleared wave is running. */
  on = false;
  /** The slots that have voted, and how many votes end the break. */
  ready: number[] = [];
  need = 0;
  /** Host: the length the break is stretched to, once the waves have set their own. */
  private stretch = 0;
  /** Host: who has voted, by lobby id. */
  private readonly votes = new Set<string>();
  private cut = false;

  /** `voters`: host only, the slots of the living players in the match, whose votes count. */
  constructor(private readonly ctx: Ctx, private readonly session: CoopSession, private readonly send: (event: WorldEvent, to?: string) => void,
    private readonly voters: () => number[]) {}

  private get waves(): { phase: string; wave: number; nextWaveIn: number; rules?: Parameters<typeof isBossWave>[1] } {
    return this.ctx.waves as unknown as { phase: string; wave: number; nextWaveIn: number };
  }

  /** A wave was cleared: the break begins, with nobody ready. */
  began(wave: number): void {
    this.on = true;
    this.cut = false;
    this.votes.clear();
    this.ready = [];
    if (!this.session.hosting) return;
    this.stretch = teamBreakSeconds(this.session.match.mode, wave + 1, this.waves.rules);
    // A director that has already opened the break (the Crucible's, Endless Humans') gets the team's length now, so the clock
    // that goes out with the wave's news is the team's. `update` sets it again for one that opens it afterwards.
    if (this.waves.phase === 'intermission') this.waves.nextWaveIn = Math.max(this.waves.nextWaveIn, this.stretch);
    this.need = this.voters().length;
    this.tell(-1);
  }

  /** The next wave started. */
  ended(): void {
    this.on = false;
    this.stretch = 0;
    this.votes.clear();
    this.ready = [];
  }

  /** What a guest arriving mid-break is told. */
  tally(): { ready: number[]; need: number } {
    return { ready: this.ready, need: this.need };
  }

  /** Seconds left on the break, for the HUD. */
  get left(): number {
    return Math.max(0, Math.ceil(this.waves.nextWaveIn));
  }

  /** Host: a player's vote (their lobby id). Counted once, only in a break, only from someone alive in the match. */
  vote(id: string): void {
    if (!this.session.hosting || !this.on || this.cut) return;
    const slot = this.session.lobby.players.find(p => p.id === id)?.slot;
    if (slot === undefined || this.votes.has(id) || !this.voters().includes(slot)) return;
    this.votes.add(id);
    this.tell(slot);
  }

  /** Host: counts the votes against who is alive now, tells everyone, and cuts the break when all are in. */
  private tell(by: number): void {
    const lobby = this.session.lobby;
    const voters = this.voters();
    for (const id of [...this.votes]) {
      const slot = lobby.players.find(p => p.id === id)?.slot;
      if (slot === undefined || !voters.includes(slot)) this.votes.delete(id);
    }
    const ready = [...this.votes].map(id => lobby.players.find(p => p.id === id)!.slot).sort((a, b) => a - b);
    const event = { t: 'vote', ready, need: voters.length, by } as const;
    this.send(event);
    this.voted(event);
    if (voters.length > 0 && ready.length >= voters.length && !this.cut) {
      this.cut = true;
      // Applied in `update` if the waves have not opened the break yet (a vote in the same frame as the clear).
      this.stretch = 0;
      if (this.waves.phase === 'intermission') this.waves.nextWaveIn = Math.min(this.waves.nextWaveIn, CUT_TO);
    }
  }

  /** The host's word on the vote, on every screen: the count for the HUD, and a line in the feed for a new vote. */
  voted(value: Extract<WorldEvent, { t: 'vote' }>): void {
    const ready = Array.isArray(value.ready) ? value.ready.filter(s => Number.isInteger(s) && s >= 0 && s < 4).slice(0, 4) : [];
    const need = Number.isInteger(value.need) ? Math.max(0, Math.min(4, value.need)) : 0;
    this.ready = ready;
    this.need = need;
    if (!Number.isInteger(value.by) || value.by < 0 || !ready.includes(value.by)) return;
    const lobby = this.session.lobby;
    const who = lobby.players.find(p => p.slot === value.by);
    const name = who?.id === lobby.you ? 'You are' : `${who?.name ?? 'A player'} is`;
    const all = need > 0 && ready.length >= need;
    this.ctx.hud.feed(all ? `EVERYONE READY · next wave in ${CUT_TO}` : `${name} ready (${ready.length}/${need})`, VOTE_COLOR);
  }

  update(): void {
    const waves = this.waves;
    const between = waves.phase === 'intermission';
    if (this.session.hosting) {
      // The waves set the break's length as it begins, and the shop stretches it for its pod: the team's is set after both.
      if (this.stretch && between) {
        waves.nextWaveIn = Math.max(waves.nextWaveIn, this.stretch);
        this.stretch = 0;
      }
      // Someone died, left or arrived: the count changes, and a vote that is now complete ends the break.
      if (this.on && !this.cut) {
        const need = this.voters().length;
        if (need !== this.need) this.tell(-1);
      }
    }
    if (this.ctx.input.pressed('nextWave')) this.readyUp();
  }

  /**
   * This player is ready for the next wave: the next-wave key, or pressing through the Commander's briefing (which alone
   * shortens the break, and here is that player's vote). The host's is counted at once; a guest's goes to the host.
   */
  readyUp(): void {
    if (!this.on || this.cut || this.waves.phase !== 'intermission') return;
    if (this.session.hosting) this.vote(this.session.lobby.you);
    else this.send({ t: 'ready' });
  }
}
