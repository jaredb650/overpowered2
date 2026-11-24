/**
 * Whose kill, and whose reward. The host decides who did each piece of damage, so each player's own browser pays, scores and
 * grants only what that player did (`notMine`), and every screen can say who killed what (`coop:kill`, the kill feed).
 *
 * A kill belongs to, in order:
 * 1. the guest whose claim is being applied (claims.ts `applying`): their gun, their blast, their call-in;
 * 2. the player whose delayed work is running (`as`): a blast queued by their hit (weapons/Combat.ts chains);
 * 3. nobody, when a garrison ally did it;
 * 4. the last player to hurt that enemy within `LINGER_MS`, when no player's hand was on what killed it: time (a bleed, a
 *    burn), the map (lava, a crusher, a live floor, a fall), another enemy (a blast, a charge), a boss's death;
 * 5. the host otherwise: the host's own guns, call-ins, slam and barrels, and a death by rule 4 that nobody had a hand in,
 *    as a solo run counts them.
 * The host's own hits are remembered for rule 4 as a guest's are, so a guest's single hit minutes ago never takes the host's kill.
 * Which rule a damage source falls under is `creditRule`: one table, and a test that fails on a source it does not name.
 *
 * Rewards the host's world raises for a guest's doing (a wound's bonus, an execution, a BACK SHOT label) are not paid on the
 * host: they go to that guest as `award`, and its own browser scores, labels and grants.
 */
import * as THREE from 'three';
import type { EnemyId, KillEvent } from '../../core/gameplay';
import { ALLY_SOURCE } from '../../allies/data';
import { hitText } from '../../progression/data';
import type { Claims } from './claims';
import type { WorldContext, WorldModule } from './context';
import { WEAPONS } from '../../weapons/data';
import { ENEMY_IDS, validVec, type Vec } from './wire';

/** An enemy died, on any screen: who killed it (`by` a slot, -1 nobody's) and what it was. */
export interface KillNews { by: number; id: EnemyId; boss: boolean; head: boolean }

declare module '../../core/contracts' {
  interface GameEvents {
    /** Co-op: a kill and whose it was, emitted on the host and on every guest. The kill feed reads it. */
    'coop:kill': KillNews;
  }
}

/**
 * Host to one guest: a reward for something that guest did. `score`: points under `label` at `at`. `label`: floating text
 * only. `executed`: an execution (the guest's own browser scores it and grants the perk).
 */
export type AwardEvent = { t: 'award'; kind: 'score' | 'label' | 'executed'; uid: number; points: number; label: string; at: Vec; color?: string };
const AWARDS: readonly AwardEvent['kind'][] = ['score', 'label', 'executed'];

/**
 * Whose a death is, by the source its damage names:
 * - `player`: the player acting now (a guest's claim being applied, the owner of a queued blast, else the host's own doing):
 *   every gun, blade and grenade, the player's body, call-ins, perks, mounted guns, barrels, the cheat panel;
 * - `ally`: a garrison soldier's. Nobody is paid;
 * - `linger`: nobody's hand is on it now. It belongs to whoever hurt the enemy last, for `LINGER_MS`: bleeding and burning
 *   (the burn tick's source is `burn`: EnemyManager.updateBurn), the map's hazards, a fall, a drone's crash, another enemy's
 *   blast or charge, the villain's devices, a boss's death taking the field.
 */
export type CreditRule = 'player' | 'ally' | 'linger';

/** Time and the map. `fire` is the scratch damage's first value in EnemyManager, never emitted; `''` a scratch one never filled. */
const LINGER = /^(|bleed|burn|fire|fell|crash|trample|hazard|coop|lava|crusher|electric|structural_collapse|chandelier)$/;
/** Enemies' own weapons, the villain's devices, wrecks, and what a boss's death does to the field. */
const ENEMY_MADE = /^(titan_death|frag|flashbang|smoke|manpads|mortar|mine|tripwire|claymore|snare|tank_cannon|enemy_emplacement|vehicle_ram|wreck_fire|wreck|vehicle_blast|crawler_cutter|crawler_missile|crawler_turret|crawler_lunge|crawler_mortar|crawler_steam|crawler_casemate|rival_rotary|rival_cannon|rival_missile|rival_stomp|flak_gun|aa_top_attack|sapper_charge|saltblood_technical|saltblood_bike|saltblood_fire|quist_grenade|quist_suicide|highway_enemy|carrier_destroyed|enemy_rocket|enemy_jet_gun|enemy_aam)$/;
/** Everything of a player's that is not a gun in the weapon table (authority.ts classes the same names for a claim). */
const PLAYER_MADE = /^(grenade|sword|slam|gib|kick|stomp|barrel|lab|test|airstrike|warthog|chopper|door_gun|gunship|orbital|ac130|black_sun|nuke|sentry|drop_pod|frame|mech|wireBomb|harrow_|howitzer_cluster|rocket_wp|weapon|attack|chain|skyfall|frost|rigged|deadman|vampire|overdrive|emplacement|mounted|turret|hazard_|breach_charge|hydraulic_overload|stealth_takedown|viper_|moto_|quad_|jackal_|aegis_|bastion_|kestrel_|valkyrie_|harrier_|raptor_|hornet_|lancer_)/;

/** The rule for a damage source, or null for a source this table has never heard of (credit then goes as `player`). */
export function creditRule(source: string): CreditRule | null {
  if (ALLY_SOURCE.test(source)) return 'ally';
  if (LINGER.test(source) || ENEMY_MADE.test(source) || ENEMY_IDS.some(id => id === source)) return 'linger';
  if (Object.hasOwn(WEAPONS, source) || PLAYER_MADE.test(source)) return 'player';
  return null;
}
/** How long a hit keeps its claim on a death by bleeding or burning. */
export const LINGER_MS = 30_000;
/** How long a kill's owner is kept: every system has heard `enemy:killed` long before. */
const KILL_KEEP_MS = 3000;

export class Credit implements WorldModule {
  /** Host: who killed each enemy that died lately (lobby id, '' nobody). */
  private readonly killedBy = new Map<number, { id: string; at: number }>();
  /** Host: the last player to hurt each living enemy, and when. */
  private readonly lastHit = new Map<number, { id: string; at: number }>();
  /** Host: the player whose delayed work is running right now (lobby id). */
  private owner: string | null = null;
  /** Host: damage sources seen that `creditRule` does not name, for the proofs and the dev log. Empty in a healthy game. */
  readonly unknown = new Set<string>();

  constructor(private readonly w: WorldContext, private readonly claims: Claims) {
    if (w.hosting) {
      w.listen('enemy:hit', event => {
        const id = this.acting(event.damage.source);
        if (id) this.lastHit.set(event.enemy.uid, { id, at: performance.now() });
      });
      // Registered before any system's own listener (systems listen in init, after the world is built): who killed it is known first.
      w.listen('enemy:killed', event => {
        const id = this.killer(event);
        this.killedBy.set(event.enemy.uid, { id, at: performance.now() });
        w.ctx.events.emit('coop:kill', { by: this.slotOf(id), id: event.enemy.id, boss: event.enemy.isBoss === true, head: event.headshot });
      });
      w.listen('enemy:wounded', event => {
        const id = this.acting(event.damage.source);
        if (id && id !== w.session.lobby.you && event.bonus > 0) {
          w.send({ t: 'award', kind: 'score', uid: event.enemy.uid, points: event.bonus, label: event.label, at: event.enemy.center.toArray() as Vec }, id);
        }
      });
      w.listen('enemy:executed', event => {
        const id = this.killedBy.get(event.kill.enemy.uid)?.id;
        if (id && id !== w.session.lobby.you) {
          w.send({ t: 'award', kind: 'executed', uid: event.kill.enemy.uid, points: 0, label: event.kill.damage.source, at: event.kill.enemy.center.toArray() as Vec }, id);
        }
      });
      // A burn or a freeze a guest's claim started has no hit behind it: the kill it ends in is still that guest's.
      claims.onStatus = (uid, from) => this.lastHit.set(uid, { id: from, at: performance.now() });
      w.snapshotSent.push(alive => {
        for (const uid of this.lastHit.keys()) if (!alive.has(uid)) this.lastHit.delete(uid);
      });
    }
    w.router.guest('award', value => this.awardIn(value));
  }

  /** Host: whose doing the damage being applied right now is (lobby id), or null: an ally's, or nobody's hand (a bleed, a burn). */
  private acting(source: string): string | null {
    const id = this.claims.applying ?? this.owner;
    if (id) return id;
    return this.rule(source) === 'player' ? this.w.session.lobby.you : null;
  }

  private rule(source: string): CreditRule {
    const rule = creditRule(source);
    if (rule) return rule;
    if (!this.unknown.has(source) && this.unknown.size < 64) {
      this.unknown.add(source);
      console.warn(`[coop] No credit rule for damage source "${source}": counted as the host's own (net/world/credit.ts creditRule)`);
    }
    return 'player';
  }

  /**
   * Host: fire, frost or a live bolt was put on this enemy by the player acting now (EnemyManager.afflict: the host's own
   * weapon, or a guest's `status` claim being applied). No hit says so, and the death it ends in is theirs.
   */
  lit(uid: number): void {
    if (!this.w.hosting) return;
    const id = this.claims.applying ?? this.owner ?? this.w.session.lobby.you;
    if (id) this.lastHit.set(uid, { id, at: performance.now() });
  }

  /** Host: fire spread from one enemy to the next (EnemyManager.updateBurn). The new fire is whose the old one was. */
  spread(from: number, to: number): void {
    if (!this.w.hosting) return;
    const first = this.lastHit.get(from);
    if (!first) return;
    const now = performance.now();
    const mine = this.lastHit.get(to);
    if (now - first.at <= LINGER_MS && (!mine || now - mine.at > LINGER_MS)) this.lastHit.set(to, { id: first.id, at: first.at });
  }

  private killer(event: KillEvent): string {
    const you = this.w.session.lobby.you;
    const id = this.claims.applying ?? this.owner;
    if (id) return id;
    const rule = this.rule(event.damage.source);
    if (rule === 'ally') return '';
    if (rule === 'linger') {
      const last = this.lastHit.get(event.enemy.uid);
      return last && performance.now() - last.at <= LINGER_MS ? last.id : you;
    }
    return you;
  }

  private slotOf(id: string): number {
    return this.w.session.lobby.players.find(p => p.id === id)?.slot ?? -1;
  }

  /** Host: the slot of whoever killed this enemy, -1 nobody's, for the `kill` event. */
  slot(uid: number): number {
    const kill = this.killedBy.get(uid);
    return kill ? this.slotOf(kill.id) : -1;
  }

  /**
   * Not this player's: a kill (by uid) or a hit landed by a teammate. Score, combo, perks, kill pay and the run report skip it,
   * so each player's own browser pays and scores only what they did. Solo and guests' own replays read false.
   */
  notMine(enemy?: { uid: number }): boolean {
    const you = this.w.session.lobby.you;
    if (this.claims.applying !== null || (this.owner !== null && this.owner !== you)) return true;
    const killer = enemy ? this.killedBy.get(enemy.uid)?.id : undefined;
    return killer !== undefined && killer !== you;
  }

  /** Host: whose damage is being applied right now (lobby id), or null: read when work is put off for later (`as`). */
  get crediting(): string | null {
    return this.w.hosting ? this.claims.applying ?? this.owner : null;
  }

  /**
   * Host: delayed work is about to run for `owner` (a blast a player's hit queued), or has finished (pass back what this
   * returned). Kills and hits in between are that player's.
   */
  as(owner: string | null): string | null {
    const before = this.owner;
    this.owner = owner;
    return before;
  }

  /**
   * Host: floating text for the hit being applied. True when it was a guest's hit: the text has gone to that guest and must
   * not be drawn here.
   */
  label(at: THREE.Vector3, text: string, color?: string): boolean {
    if (!this.w.hosting) return false;
    const id = this.claims.applying ?? this.owner;
    if (!id || id === this.w.session.lobby.you) return false;
    this.w.send({ t: 'award', kind: 'label', uid: 0, points: 0, label: text, at: at.toArray() as Vec, ...(color ? { color } : {}) }, id);
    return true;
  }

  /** Guest: a reward the host's world raised for something I did. */
  private awardIn(value: AwardEvent): void {
    const { ctx } = this.w;
    if (!AWARDS.includes(value.kind) || !validVec(value.at) || typeof value.label !== 'string') return;
    const at = new THREE.Vector3(...value.at);
    const label = value.label.replace(/[^\w !+'.·-]/g, '').slice(0, 40);
    const points = Number.isFinite(value.points) ? Math.max(0, Math.min(1e6, Math.round(value.points))) : 0;
    if (value.kind === 'score') {
      if (points > 0) ctx.progression.award(points, label, at);
    } else if (value.kind === 'label') {
      const text = hitText(label);
      if (text) ctx.hud.floatText(at, text, typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : undefined);
    } else {
      // The man is already dead on this screen (the `kill` came first): a stand-in carries where he was.
      const enemy = { uid: value.uid, id: 'trooper', center: at, position: at, isBoss: false, alive: false } as unknown as KillEvent['enemy'];
      const p = ctx.player;
      const kill: KillEvent = { enemy, damage: { amount: 0, type: 'bullet', point: at, dir: new THREE.Vector3(0, 0, 1), force: 0, source: label || ctx.weapons.current },
        headshot: false, gibbed: false, sliced: false, severedCount: 0, playerAirborne: !p.grounded, playerSliding: p.sliding, playerWallRunning: p.wallRunning,
        playerSpeed: p.speed, distance: at.distanceTo(p.position), explosionId: null };
      ctx.events.emit('enemy:executed', { kill });
    }
  }

  update(now: number): void {
    for (const [uid, kill] of this.killedBy) if (now - kill.at > KILL_KEEP_MS) this.killedBy.delete(uid);
  }
}

/** For a peer that is behind: which of this module's events may be left out (net/pressure.ts). A fact never is. */
export const CREDIT_WIRE: import('../pressure').WireClasses<AwardEvent> = { award: 'fact' };
