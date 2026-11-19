/**
 * Co-op's team rules (stage 3): going down, bleeding out, reviving, spectating, the wipe, and what each player reports
 * about themselves (health, kills, credits) for the teammates strip and the Tab board.
 *
 * The host decides every life. A player at 0 health goes DOWN: they crawl (Player.downed) and can be revived by any
 * teammate holding E beside them for ALLY.revive seconds (the allies' hold, src/allies/rules.ts OrderKey; no stim spent).
 * After BLEED_MS down they are DEAD and watch a living teammate until the next wave starts, when the dead come back at
 * the spawn. When nobody is up the run is over for everyone (`over`).
 *
 * Economy: each player's own purse is their own Crucible shop (contracts/shop). Kill pay goes to whoever killed
 * (world.ts attributes kills; a guest replays its own kills as local `enemy:killed`). The wave-clear bonus is shared:
 * every player, alive or not, is paid the full wave pay by their own shop when the host's `wave:clear` reaches them.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import { OrderKey } from '../allies/rules';
import { ALLY } from '../allies/data';
import { COLORS } from './remote';
import type { CoopSession } from './index';
import type { WorldEvent } from './worldProtocol';
import type { Router } from './world/router';
import type { Vec } from './world/wire';
import { spread } from './mission';

export type LifeState = 'up' | 'down' | 'dead';
/** What one player shows the others: the teammates strip and the Tab board. Clamped on arrival (`cleanCard`). */
export interface Card {
  slot: number; state: LifeState; bleed: number; life: number; hp: number; max: number; armor: number;
  kills: number; score: number; credits: number; downs: number; revives: number; ping: number;
}
/** The team's events on the wire. */
export type TeamEvent =
  /** Guest to host: I am at 0 health, on life `life`. */
  | { t: 'life'; slot: number; alive: boolean; life: number }
  /** Guest to host: my card, 4 Hz. Host to guests: everyone's, 4 Hz, with the host's word on life, bleed and ping. */
  | { t: 'card'; card: Card }
  | { t: 'team'; list: Card[] }
  /** Guest to host: I held E over this downed player. */
  | { t: 'revive'; slot: number }
  /** Host: this player is up again, revived (`by` the reviver's slot) or respawned at a new wave. */
  | { t: 'up'; slot: number; life: number; how: 'revive' | 'respawn'; by: number; at?: Vec; yaw?: number }
  /** Host: the waves' own events, replayed on guests so their shops, pods, banners and ammo follow the host's waves. */
  | { t: 'wave'; kind: 'start' | 'clear'; wave: number; total: number; boss: boolean; bonus: number }
  /** Host: nobody is up. The run is over for everyone; the cards are the final board. */
  | { t: 'over'; wave: number; cards: Card[]; won?: boolean }
  /** Host to a rejoining guest: the purse and score they left with. */
  | { t: 'restore'; credits: number; score: number; kills: number };
/** The events `receive` takes on each side, for the world's router. */
const HOST_EVENTS = ['life', 'card', 'revive'] as const;
const GUEST_EVENTS = ['team', 'up', 'wave', 'over', 'restore'] as const;

/** Down to dead. The allies bleed for longer; a friend should be reached in a wave, not after it. */
export const BLEED_MS = 30_000;
/** Health a revived player gets back. */
export const REVIVE_HEALTH = 40;
/** Metres from a downed friend at which E revives. A little more for the host's check, for the pose's lag. */
export const REVIVE_REACH = 2.4;
const HOST_REACH = 4.5;
const CARD_MS = 250;
const DOWN_COLOR = '#ff3b3b';

/** One player's life, as the host keeps it. `life` counts lives, so damage meant for an earlier one is dropped. */
export class TeamLife {
  state: LifeState = 'up';
  life = 0;
  bleedUntil = 0;
  get down(): boolean { return this.state !== 'up'; }
  /** At 0 health. False if already down or dead. */
  fall(now: number): boolean {
    if (this.state !== 'up') return false;
    this.state = 'down';
    this.bleedUntil = now + BLEED_MS;
    return true;
  }
  /** A teammate's hold: only from down. */
  revive(): boolean {
    if (this.state !== 'down') return false;
    this.state = 'up';
    this.life++;
    return true;
  }
  /** A new wave: the dead (and anyone still down) come back. */
  respawn(): boolean {
    if (this.state === 'up') return false;
    this.state = 'up';
    this.life++;
    return true;
  }
  /** True the moment a downed player bleeds out. */
  bleed(now: number): boolean {
    if (this.state !== 'down' || now < this.bleedUntil) return false;
    this.state = 'dead';
    return true;
  }
  accepts(life: number): boolean { return this.state === 'up' && life === this.life; }
}

/** Nobody is up: the run is over. An empty team is not a wipe. */
export const wiped = (lives: readonly TeamLife[]): boolean => lives.length > 0 && lives.every(life => life.state !== 'up');

const STATES: readonly LifeState[] = ['up', 'down', 'dead'];
const int = (value: unknown, max: number): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : 0;

/** A card as it arrives from someone else's browser: every field clamped, nothing else kept. */
export function cleanCard(value: unknown): Card | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Partial<Card>;
  if (!Number.isInteger(c.slot) || c.slot! < 0 || c.slot! > 3) return null;
  return {
    slot: c.slot!, state: STATES.includes(c.state as LifeState) ? c.state! : 'up', bleed: int(c.bleed, 60), life: int(c.life, 1e6),
    hp: int(c.hp, 1000), max: int(c.max, 1000) || 100, armor: int(c.armor, 1000), kills: int(c.kills, 1e6), score: int(c.score, 1e9),
    credits: int(c.credits, 1e9), downs: int(c.downs, 1e4), revives: int(c.revives, 1e4), ping: int(c.ping, 9999),
  };
}

export class Team {
  /** Host: every player's life by lobby id. Guests mirror the host's cards into it. */
  readonly lives = new Map<string, TeamLife>();
  /** Every player's latest card, by slot. */
  readonly cards = new Map<number, Card>();
  /** Spent at the end: the cards as the run ended, for the end-of-run board. */
  final: Card[] | null = null;
  overWave = 0;
  downs = 0;
  revives = 0;
  reviving = false;
  private readonly key = new OrderKey();
  private nextCard = 0;
  private watching = -1;
  private readonly seat = { position: new THREE.Vector3(), yaw: 0, pitch: -0.25, roll: 0, shake: 0 };
  private prompt: { text: string; off: () => void } | null = null;
  private readonly promptAt = new THREE.Vector3();
  private myState: LifeState = 'up';
  private readonly off: (() => void)[] = [];
  /** Host: a guest's purse by callsign, so a player who drops and rejoins gets their credits and score back. */
  private readonly purses = new Map<string, Card>();
  onOver: (cards: Card[], wave: number, won: boolean) => void = () => {};
  /** Host: a guest's world is up (its first card came in): the moment to hand it what it missed while loading. */
  onArrived: (id: string) => void = () => {};
  private readonly arrived = new Set<string>();

  constructor(private readonly ctx: Ctx, private readonly session: CoopSession, private readonly send: (event: WorldEvent, to?: string) => void) {
    this.off.push(ctx.events.on('player:died', () => this.fell(session.lobby.you)));
    if (session.hosting) {
      this.off.push(ctx.events.on('wave:start', e => {
        this.send({ t: 'wave', kind: 'start', wave: e.wave, total: e.total, boss: e.boss, bonus: 0 });
        // The dead come back with the next wave.
        for (const [id, life] of this.lives) if (life.state === 'dead' && life.respawn()) this.up(id, 'respawn');
      }));
      this.off.push(ctx.events.on('wave:clear', e => this.send({ t: 'wave', kind: 'clear', wave: e.wave, total: 0, boss: false, bonus: e.bonus })));
      // A mission won is the end of the run for everyone, with the board.
      this.off.push(ctx.events.on('campaign:complete', () => {
        this.broadcastCards();
        const cards = [...this.cards.values()];
        this.send({ t: 'over', wave: this.ctx.waves.wave, cards, won: true });
        this.over(cards, this.ctx.waves.wave, true);
      }));
    }
  }

  private get me(): number { return this.session.lobby.me?.slot ?? 0; }

  life(id: string): TeamLife {
    let life = this.lives.get(id);
    if (!life) this.lives.set(id, life = new TeamLife());
    return life;
  }

  private idOf(slot: number): string | undefined {
    return this.session.lobby.players.find(p => p.slot === slot)?.id;
  }

  /** Someone hit 0 health. Locally first (the crawl starts at once), then the host makes it so. */
  fell(id: string): void {
    if (id === this.session.lobby.you) {
      const p = this.ctx.player as unknown as { downed: boolean };
      p.downed = true;
      this.myState = 'down';
      this.downs++;
      this.ctx.hud.feed('YOU ARE DOWN · crawl to cover, a teammate can revive you with E', DOWN_COLOR);
    }
    if (!this.session.hosting) {
      if (id !== this.session.lobby.you) return;
      const life = this.life(id);
      this.send({ t: 'life', slot: this.me, alive: false, life: life.life });
      // Until the host's word comes back, damage for this life is already moot.
      life.state = 'down';
      return;
    }
    if (!this.life(id).fall(performance.now())) return;
    const name = this.session.lobby.players.find(p => p.id === id)?.name ?? 'A player';
    if (id !== this.session.lobby.you) this.ctx.hud.feed(`${name} IS DOWN`, DOWN_COLOR);
    this.broadcastCards();
  }

  /** Host: a checkpoint (or the team's redeploy): everyone down or dead gets up beside the host. */
  respawnAll(): void {
    if (!this.session.hosting) return;
    const at = this.ctx.player.position;
    for (const [id, life] of this.lives) if (life.respawn()) this.up(id, 'respawn', undefined, [at.x, at.y, at.z], this.ctx.player.yaw);
  }

  /** Host: a revive or a respawn. The player's own browser puts them back on their feet: at the map's spawn, or beside `at`. */
  private up(id: string, how: 'revive' | 'respawn', by?: string, at?: [number, number, number], yaw = 0): void {
    const slot = this.session.lobby.players.find(p => p.id === id)?.slot;
    if (slot === undefined) return;
    const life = this.life(id);
    const event: WorldEvent = { t: 'up', slot, life: life.life, how, by: by ? this.session.lobby.players.find(p => p.id === by)?.slot ?? -1 : -1,
      ...(at ? { at, yaw } : {}) };
    this.send(event);
    this.applyUp(event);
  }

  private applyUp(event: Extract<WorldEvent, { t: 'up' }>): void {
    const lobby = this.session.lobby;
    const player = lobby.players.find(p => p.slot === event.slot);
    if (!player) return;
    if (!this.session.hosting) {
      const life = this.life(player.id);
      life.state = 'up';
      life.life = event.life;
    }
    const by = lobby.players.find(p => p.slot === event.by);
    if (player.id === lobby.you) {
      const p = this.ctx.player as unknown as { alive: boolean; downed: boolean; health: number; maxHealth: number };
      p.alive = true;
      p.downed = false;
      this.myState = 'up';
      this.stopWatching();
      if (event.how === 'revive') {
        p.health = REVIVE_HEALTH;
        this.ctx.hud.feed(by ? `${by.name} GOT YOU UP` : 'BACK ON YOUR FEET', '#79f1ad');
      } else {
        p.health = p.maxHealth;
        const spawns = this.ctx.world.playerSpawns;
        const spawn = spawns[(lobby.me?.slot ?? 0) % Math.max(1, spawns.length)];
        const at = Array.isArray(event.at) && event.at.length === 3 && event.at.every(Number.isFinite) ? event.at : null;
        if (at) this.ctx.player.teleport(new THREE.Vector3(...spread(at, Number.isFinite(event.yaw) ? event.yaw! : 0, lobby.me?.slot ?? 0)), event.yaw);
        else if (spawn) this.ctx.player.teleport(spawn.position, spawn.yaw);
        this.ctx.hud.feed('BACK IN THE FIGHT', '#79f1ad');
      }
    } else if (event.how === 'revive') {
      this.ctx.hud.feed(`${by?.name ?? 'Someone'} revived ${player.name}`, '#79f1ad');
    }
    if (by?.id === lobby.you && event.how === 'revive') this.revives++;
  }

  /** Registers the team's events with the world's router (world/router.ts): each goes to `receive` on the side that hears it. */
  plug(router: Router): void {
    for (const type of HOST_EVENTS) router.host(type, (event, from) => { this.receive(event, from); });
    for (const type of GUEST_EVENTS) router.guest(type, (event, from) => { this.receive(event, from); });
  }

  /** Everything addressed to the team. True when the event was one of its own. */
  receive(value: WorldEvent, from: string): boolean {
    const lobby = this.session.lobby;
    if (this.session.hosting) {
      switch (value.t) {
        case 'life':
          if (value.alive === false && value.life === this.life(from).life) this.fell(from);
          return true;
        case 'card': {
          const slot = lobby.players.find(p => p.id === from)?.slot;
          const card = cleanCard({ ...(value.card as object), slot });
          if (card) {
            const life = this.life(from);
            Object.assign(card, { state: life.state, life: life.life, bleed: this.bleedLeft(life), ping: lobby.pingOf(from) ?? 0 });
            this.cards.set(card.slot, card);
            const name = lobby.players.find(p => p.id === from)?.name;
            if (!this.arrived.has(from)) {
              this.arrived.add(from);
              this.restore(from);
              this.onArrived(from);
            }
            if (name) this.purses.set(name, card);
          }
          return true;
        }
        case 'revive': {
          const target = this.idOf(value.slot);
          if (!target || !this.near(from, target) || this.life(from).state !== 'up' || !this.life(target).revive()) return true;
          this.up(target, 'revive', from);
          return true;
        }
        default: return false;
      }
    }
    switch (value.t) {
      case 'team':
        if (!Array.isArray(value.list)) return true;
        for (const raw of value.list.slice(0, 4)) {
          const card = cleanCard(raw);
          if (!card) continue;
          this.cards.set(card.slot, card);
          const id = this.idOf(card.slot);
          if (!id) continue;
          const life = this.life(id);
          life.state = card.state;
          life.life = card.life;
          // The host says this player bled out or got up while a message was lost: follow it.
          if (id === lobby.you && card.state !== this.myState) this.follow(card.state);
        }
        return true;
      case 'up': if (Number.isInteger(value.slot) && Number.isInteger(value.life)) this.applyUp(value); return true;
      case 'wave':
        if (!Number.isInteger(value.wave) || value.wave < 0 || value.wave > 100000) return true;
        if (value.kind === 'start') this.ctx.events.emit('wave:start', { wave: value.wave, total: int(value.total, 1000), boss: value.boss === true });
        else if (value.kind === 'clear') this.ctx.events.emit('wave:clear', { wave: value.wave, bonus: int(value.bonus, 1e7) });
        return true;
      case 'over': this.over(Array.isArray(value.cards) ? value.cards.map(cleanCard).filter((c): c is Card => !!c) : [], int(value.wave, 1e5), value.won === true); return true;
      case 'restore': {
        const progression = this.ctx.progression;
        progression.resume(int(value.score, 1e9), int(value.kills, 1e6), progression.headshots);
        const wallet = this.ctx.contracts.wallet as { credits?: number } | null | undefined;
        if (wallet && typeof wallet.credits === 'number') wallet.credits = int(value.credits, 1e9);
        this.ctx.hud.feed('Rejoined: your credits and score are back', '#79f1ad');
        return true;
      }
      default: return false;
    }
  }

  /** A guest whose own state the host has moved on (a lost `up`, a bleed-out). */
  private follow(state: LifeState): void {
    // Only an `up` event brings a player back (and says how); a card that lags my own fall must not undo it.
    if (state === 'up') return;
    const p = this.ctx.player as unknown as { alive: boolean; downed: boolean; health: number };
    this.myState = state;
    if (state === 'dead') p.downed = false;
    if (state === 'down' && p.alive) { p.alive = false; p.downed = true; p.health = 0; }
  }

  /** Host: has the reviver's body really been beside the downed one? Positions from the pose lane or the host's own player. */
  private near(a: string, b: string): boolean {
    const at = (id: string) => id === this.session.lobby.you ? this.ctx.player.position : this.session.remotes.get(id)?.char.root.position;
    const pa = at(a), pb = at(b);
    return !!pa && !!pb && pa.distanceTo(pb) <= HOST_REACH;
  }

  private bleedLeft(life: TeamLife): number {
    return life.state === 'down' ? Math.max(0, Math.ceil((life.bleedUntil - performance.now()) / 1000)) : 0;
  }

  /** My own card: what the teammates strip and the Tab board show about me. */
  private card(): Card {
    const p = this.ctx.player;
    const wallet = this.ctx.contracts?.wallet as { credits?: number } | null | undefined;
    const life = this.life(this.session.lobby.you);
    return { slot: this.me, state: this.session.hosting ? life.state : this.myState, bleed: this.bleedLeft(life), life: life.life,
      hp: Math.max(0, Math.round(p.health)), max: Math.round(p.maxHealth), armor: Math.round(p.armor), kills: this.ctx.progression.kills,
      score: Math.round(this.ctx.progression.score), credits: Math.round(wallet?.credits ?? 0), downs: this.downs, revives: this.revives, ping: 0 };
  }

  private broadcastCards(): void {
    if (!this.session.hosting) return;
    const lobby = this.session.lobby;
    this.cards.set(this.me, this.card());
    for (const player of lobby.players) {
      // A player whose own card has not come in yet still has a line, with what the host knows.
      if (!this.cards.has(player.slot)) this.cards.set(player.slot, cleanCard({ slot: player.slot })!);
      const card = this.cards.get(player.slot);
      const life = this.life(player.id);
      if (card) Object.assign(card, { state: life.state, life: life.life, bleed: this.bleedLeft(life), ping: player.host ? 0 : lobby.pingOf(player.id) ?? 0 });
    }
    for (const slot of [...this.cards.keys()]) if (!lobby.players.some(p => p.slot === slot)) this.cards.delete(slot);
    this.send({ t: 'team', list: [...this.cards.values()] });
  }

  /** Host: a returning player's purse, sent once they are back in. */
  restore(id: string): void {
    const name = this.session.lobby.players.find(p => p.id === id)?.name;
    const purse = name ? this.purses.get(name) : undefined;
    if (purse && (purse.credits > 0 || purse.score > 0)) this.send({ t: 'restore', credits: purse.credits, score: purse.score, kills: purse.kills }, id);
  }

  update(now: number, dt: number): void {
    const lobby = this.session.lobby;
    if (this.final) return;
    if (now >= this.nextCard) {
      this.nextCard = now + CARD_MS;
      if (this.session.hosting) this.broadcastCards();
      else this.send({ t: 'card', card: this.card() });
    }
    if (this.session.hosting) {
      const lives: TeamLife[] = [];
      for (const player of lobby.players) {
        if (player.away) continue;
        const life = this.life(player.id);
        lives.push(life);
        if (life.bleed(now)) {
          if (player.id === lobby.you) this.follow('dead');
          this.ctx.hud.feed(`${player.name} BLED OUT · back next wave`, DOWN_COLOR);
          this.broadcastCards();
        }
      }
      for (const id of this.lives.keys()) if (!lobby.players.some(p => p.id === id)) this.lives.delete(id);
      if (wiped(lives) && this.checkpoint()) return;
      if (wiped(lives)) {
        this.broadcastCards();
        const cards = [...this.cards.values()];
        this.send({ t: 'over', wave: this.ctx.waves.wave, cards });
        this.over(cards, this.ctx.waves.wave);
        return;
      }
    }
    this.markers();
    this.reviveKey(dt);
    if (this.myState === 'dead') this.spectate();
  }

  /** Downed teammates carry a red tag with their seconds left, and E beside one revives them. */
  private markers(): void {
    const lobby = this.session.lobby;
    for (const player of lobby.players) {
      if (player.id === lobby.you) continue;
      const remote = this.session.remotes.get(player.id);
      const card = this.cards.get(player.slot);
      const life = this.lives.get(player.id);
      if (!remote) continue;
      remote.downed = life?.state === 'down';
      remote.setTag(remote.downed ? `${player.name} DOWN ${card?.bleed ?? ''}s` : '', DOWN_COLOR);
    }
  }

  private reviveKey(dt: number): void {
    const { player, input } = this.ctx;
    this.reviving = false;
    let target: { slot: number; name: string; at: THREE.Vector3 } | null = null;
    if (player.alive && !player.parked) {
      let best = REVIVE_REACH;
      for (const p of this.session.lobby.players) {
        if (this.lives.get(p.id)?.state !== 'down') continue;
        const body = this.session.remotes.get(p.id)?.char.root.position;
        const d = body?.distanceTo(player.position) ?? Infinity;
        if (d < best) { best = d; target = { slot: p.slot, name: p.name, at: body! }; }
      }
    }
    if (!target) {
      this.key.held = -1;
      this.setPrompt('');
      return;
    }
    const gesture = this.key.update(dt, input.pressed('interact'), input.isDown('interact'), true);
    this.reviving = this.key.held >= 0;
    if (this.key.held >= 0) this.ctx.hud.hold?.(this.key.progress(true));
    if (gesture === 'revive') {
      this.ctx.hud.hold?.(1);
      const id = this.idOf(target.slot);
      if (this.session.hosting) { if (id && this.life(id).revive()) this.up(id, 'revive', this.session.lobby.you); }
      else this.send({ t: 'revive', slot: target.slot });
    }
    // Above the name tag on the body, so the two never sit on each other.
    this.promptAt.copy(target.at).y += 1.9;
    // The ring round the crosshair shows the hold, so the words stay put.
    this.setPrompt(`Hold [${input.labelFor?.('interact') ?? 'E'}] to revive ${target.name}`);
  }

  private setPrompt(text: string): void {
    if (this.prompt?.text === text) return;
    this.prompt?.off();
    this.prompt = text ? { text, off: this.ctx.hud.follow(this.promptAt, text, '#79f1ad') } : null;
  }

  /** Dead: the camera rides over a living teammate's shoulder. Fire cycles to the next one. */
  private spectate(): void {
    const lobby = this.session.lobby;
    const living = lobby.players.filter(p => p.id !== lobby.you && this.lives.get(p.id)?.state === 'up' && this.session.remotes.get(p.id)?.char.root.visible);
    if (!living.length) return this.stopWatching();
    let index = living.findIndex(p => p.slot === this.watching);
    if (index < 0 || this.ctx.input.pressed('fire')) index = (index + 1) % living.length;
    const watched = living[index]!;
    this.watching = watched.slot;
    const remote = this.session.remotes.get(watched.id)!;
    const root = remote.char.root;
    // The body faces +Z with a half turn (remote.ts); the camera looks down its -Z.
    const yaw = root.rotation.y - Math.PI;
    this.seat.yaw = yaw;
    this.seat.position.set(root.position.x + Math.sin(yaw) * 3.2, root.position.y + 2.3, root.position.z + Math.cos(yaw) * 3.2);
    this.ctx.camera.setSeat?.(this.seat);
    // Over a friend's shoulder there is no gun in my hands.
    const view = this.ctx.render.viewScene as { visible?: boolean } | undefined;
    if (view) view.visible = false;
    this.setPrompt('');
    if (this.ctx.time.frame % 30 === 0) this.ctx.hud.callout?.(`WATCHING ${watched.name} · back next wave · fire: next`);
  }

  private stopWatching(): void {
    if (this.watching < 0) return;
    this.watching = -1;
    this.ctx.camera.setSeat?.(null);
    const view = this.ctx.render.viewScene as { visible?: boolean } | undefined;
    if (view) view.visible = true;
  }

  /**
   * Host, in a mission: everyone down sends the whole team back to the last checkpoint, as one player's death does alone.
   * False off a mission, or with no checkpoint to go back to.
   */
  private checkpoint(): boolean {
    const campaign = this.ctx.campaign as unknown as { active?: boolean; restart?(): boolean };
    if (!campaign?.active || !campaign.restart) return false;
    if (!campaign.restart()) return false;
    this.ctx.hud.feed('EVERYONE DOWN · BACK TO THE CHECKPOINT', DOWN_COLOR);
    this.respawnAll();
    return true;
  }

  /** Everyone is down (or the mission is won): the run is over for the whole team. */
  private over(cards: Card[], wave: number, won = false): void {
    if (this.final) return;
    this.final = cards.sort((a, b) => b.score - a.score);
    this.overWave = wave;
    this.stopWatching();
    this.onOver(this.final, wave, won);
  }

  /** The strip and the board read this: every player in slot order, with the colour of their tag. */
  roster(): { card: Card; name: string; color: string; me: boolean }[] {
    const lobby = this.session.lobby;
    if (!this.session.hosting) this.cards.set(this.me, { ...this.card(), ...this.pick(this.cards.get(this.me)) });
    return lobby.players.filter(p => !p.away).sort((a, b) => a.slot - b.slot).flatMap(p => {
      const card = p.id === lobby.you ? { ...this.card(), ...this.pick(this.cards.get(p.slot)) } : this.cards.get(p.slot);
      return card ? [{ card, name: p.name, color: `#${(COLORS[p.slot] ?? COLORS[0]!).toString(16).padStart(6, '0')}`, me: p.id === lobby.you }] : [];
    });
  }

  /** The host's word on state, bleed and ping, over my own numbers. */
  private pick(card: Card | undefined): Partial<Card> {
    return card ? { state: card.state, bleed: card.bleed, ping: card.ping } : {};
  }

  dispose(): void {
    for (const off of this.off) off();
    this.setPrompt('');
    this.stopWatching();
  }
}
