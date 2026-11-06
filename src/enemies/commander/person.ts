/**
 * The end of a run. The Commander stops talking to the player and comes down himself, in the only heavy suit left in the armoury.
 *
 * He is a Juggernaut with a cap on: the same armour stages, the same charge, the same boss bar, because section 14's reference for a
 * man who takes a lot of killing is that fight. What he adds is his own trade. He calls shells on himself, and he never stops talking.
 */
import { pick } from '../../core/math';
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


export class Person {
  body: Enemy | null = null;
  /** He has been killed. */
  dead = false;
  private dueAt = -1;
  private barks = 0;
  private shellAt = 0;

  constructor(private readonly c: Commander) {}

  reset(): void {
    this.body = null;
    this.dead = false;
    this.dueAt = -1;
    this.barks = 0;
    this.shellAt = 0;
  }

  /** Called as the last wave starts. */
  arm(): void {
    if (this.body || this.dead) return;
    this.dueAt = this.c.w.now + ENTRY_DELAY;
  }

  /** Straight in, for tests. */
  summon(): void {
    this.dueAt = this.c.w.now;
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
    const share = e.health / e.maxHealth;
    if (this.barks < BARK_AT.length && share < BARK_AT[this.barks]!) {
      c.bark(IN_PERSON[Math.min(this.barks + 1, IN_PERSON.length - 1)]!.id);
      this.barks++;
    }
    if (now >= this.shellAt) {
      this.shellAt = now + SHELL_EVERY;
      // On the player, with the suit standing in it. He has stopped caring which of them it hits.
      if (c.mortars.call(w.player.position, 'mortar', SHELLS)) c.bark(pick(IN_PERSON.slice(1)).id);
    }
  }

  private arrive(): void {
    const { c } = this;
    const { manager, w } = c;
    this.dueAt = -1;
    const e = manager.spawnBoss('juggernaut');
    if (!e) {
      this.dueAt = w.now + 2;
      return;
    }
    this.body = e;
    c.props.fit(e.char, 'cap');
    this.shellAt = w.now + SHELL_EVERY;
    w.ctx.audio.play('boss_alarm');
    w.ctx.events.emit('commander:person', { arrived: true });
    c.bark(IN_PERSON[0]!.id);
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
