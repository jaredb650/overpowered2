/**
 * The end of a run. The Commander stops talking to the player and comes down himself, in the only heavy suit left in the armoury.
 *
 * He is a Juggernaut with a cap on: the same armour stages, the same charge, the same boss bar, because section 14's reference for a
 * man who takes a lot of killing is that fight. What he adds is his own trade. He calls shells on himself, and he never stops talking.
 */
import * as THREE from 'three';
import { ACTIVE } from '../../contracts/select';
import { pick } from '../../core/math';
import type { Behaviour } from '../brain';
import { JUGGERNAUT_ATTACKS, JUGGERNAUT_BEHAVIOURS, type Juggernaut } from '../bosses';
import { ENEMIES } from '../data';
import type { Enemy } from '../Enemy';
import type { Commander } from './index';
import { IN_PERSON } from './lines';

/** Seconds into the last wave. The men go first, which is the kind of commander he is. */
const ENTRY_DELAY = 26;
/** Share of health at which he has something new to say. */
const BARK_AT = [0.8, 0.6, 0.4, 0.2];
const SHELL_EVERY = 16;
const SHELLS = 5;
/** Men left standing when he stops waiting. */
const HOLD_OUT = 2;
/** Seconds from the smoke going up to him being gone from under it. */
const SMOKE_COVER = 1.4;
const SMOKE_PUFFS = 7;
/** Seconds from him reaching the roof to the first shells on it, which is about how long the player takes to follow him up. */
const ROOF_SHELLS_AFTER = 14;
/** Higher than this over the player's head is sky. */
const OPEN_SKY = 40;
/** Share of him one hit can take in a staged fight. The swarm's 5% is 20 autocannon rounds, and a bot with the mission's kit had him dead in 16 s. */
const STAGED_MAX_HIT = 0.025;

const UP = new THREE.Vector3(0, 1, 0);
const STAND: Behaviour = {
  name: 'stand',
  score: () => 0.6,
  enter(e) {
    e.mode = 'hold';
    e.face = 'player';
  },
};

export class Person {
  body: Enemy | null = null;
  /** He has been killed. */
  dead = false;
  private dueAt = -1;
  private barks = 0;
  private shellAt = 0;
  /** A mission's mark for him. Null drops him from the sky. */
  private stagedAt: THREE.Vector3 | null = null;
  private fallTo: THREE.Vector3 | null = null;
  private fallAt = 0;

  constructor(private readonly c: Commander) {}

  reset(): void {
    this.body = null;
    this.dead = false;
    this.dueAt = -1;
    this.barks = 0;
    this.shellAt = 0;
    this.stagedAt = null;
    this.fallTo = null;
  }

  /** Called as the last wave starts. Outpost Defense has no last wave, so he never comes down there, and his death ends nothing. */
  arm(): void {
    if (this.body || this.dead || ACTIVE.def.economy) return;
    this.dueAt = this.c.w.now + ENTRY_DELAY;
  }

  /** Straight in, for tests. */
  summon(): void {
    this.dueAt = this.c.w.now;
  }

  /** A mission has him standing there already, behind his own glass. */
  stage(at: THREE.Vector3): void {
    this.stagedAt = at;
    this.summon();
  }

  /** He walks out of his own fight, under smoke, and the next the player sees of him is up here. */
  fallBack(to: THREE.Vector3): void {
    const e = this.body;
    if (!e) return;
    const { fx, audio } = this.c.w.ctx;
    this.fallTo = to;
    this.fallAt = this.c.w.now + SMOKE_COVER;
    for (let i = 0; i < SMOKE_PUFFS; i++) fx.smoke(e.center, 0x9aa2aa, 2.6, 2.4);
    audio.play('steam_burst', { position: e.center });
  }

  get pending(): boolean {
    return this.dueAt >= 0;
  }

  update(): void {
    const { c } = this;
    const { w } = c;
    const now = w.now;
    // He does not wait for the last man to die. He has that much pride left.
    if (this.dueAt >= 0 && (now >= this.dueAt || (c.o.waves.phase === 'clearing' && c.o.hostile <= HOLD_OUT))) this.arrive();
    const e = this.body;
    if (!e) return;
    if (!e.alive) {
      this.fall();
      return;
    }
    if (this.fallTo && now >= this.fallAt) {
      e.position.copy(this.fallTo);
      e.groundY = this.fallTo.y;
      e.velocity.set(0, 0, 0);
      this.fallTo = null;
      this.shellAt = now + ROOF_SHELLS_AFTER;
    }
    const share = e.health / e.maxHealth;
    if (this.barks < BARK_AT.length && share < BARK_AT[this.barks]!) {
      c.bark(IN_PERSON[Math.min(this.barks + 1, IN_PERSON.length - 1)]!.id);
      this.barks++;
    }
    if (now >= this.shellAt) {
      this.shellAt = now + SHELL_EVERY;
      // On the player, with the suit standing in it. He has stopped caring which of them it hits. A shell cannot find anyone under a roof.
      const staged = this.stagedAt !== null;
      const clear = !staged || !w.ctx.physics.raycast(w.player.eye, UP, OPEN_SKY);
      if (clear && c.mortars.call(w.player.position, 'mortar', SHELLS, !staged)) c.bark(pick(IN_PERSON.slice(1)).id);
    }
  }

  private arrive(): void {
    const { c } = this;
    const { manager, w } = c;
    this.dueAt = -1;
    const e = this.stagedAt ? manager.spawn('juggernaut', this.stagedAt) : manager.spawnBoss('juggernaut');
    if (!e) {
      this.dueAt = w.now + 2;
      return;
    }
    this.body = e;
    if (this.stagedAt) this.plant(e);
    c.props.fit(e.char, 'cap');
    // A staged fight opens under a roof, and shells cannot reach him until he has gone up to the open.
    this.shellAt = this.stagedAt ? Infinity : w.now + SHELL_EVERY;
    w.ctx.audio.play('boss_alarm');
    w.ctx.events.emit('commander:person', { arrived: true });
    c.bark(IN_PERSON[0]!.id);
  }

  /**
   * A staged fight has a room and a roof to happen in. A swarm boss runs a flow field down whatever levels it likes, a charge runs
   * straight over a rail or a waist-high parapet, and a slam's leap lands on the deck above a four-metre ceiling. So he stands, in a suit
   * too big for him, and brings the machine gun the men on the wall carry, because all his own reach was in the charge.
   */
  private plant(e: Enemy): void {
    (e.boss as Juggernaut).maxHit = STAGED_MAX_HIT;
    e.behaviours = [STAND, ...JUGGERNAUT_BEHAVIOURS.filter(b => b.name !== 'bossAdvance')];
    e.attacks = [...JUGGERNAUT_ATTACKS.filter(a => a.name !== 'charge' && a.name !== 'slam'), ...ENEMIES.brute.attacks.filter(a => a.name === 'minigun')];
  }

  private fall(): void {
    const { c } = this;
    this.body = null;
    this.dead = true;
    c.w.ctx.events.emit('commander:person', { arrived: false });
    // With him gone nobody is left to tell them to stay. Every man still standing breaks.
    for (const s of c.o.soldiers) if (s.fighting) c.o.breakNerve(s);
    c.w.ctx.events.emit('commander:fulfilled', {});
  }
}
