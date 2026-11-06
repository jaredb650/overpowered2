/**
 * The Commander's side of the HUD (section 18). Only the Outpost contract builds this, so the swarm never sees it.
 *
 * It listens to the Commander's events and owns the box: a few short pages between waves, each on a reading timer, or on the recording
 * if there is one. E moves it along. It never takes the mouse or stops the game, because a player who wants to reload through a
 * speech should be able to.
 */
import type { Ctx } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { TONE_OF, type Tone } from '../../enemies/commander/adaptations';
import type { Briefing, StatusFlag } from '../../enemies/commander/events';
import { FINAL_COUNCIL, FIRST, LAST_WORDS, lineById, PLAYER_DOWN, type Speaker } from '../../enemies/commander/lines';
import { Flag, Label, div, h, span } from '../dom';
import type { Settings } from '../settings';
import './commander.css';
import { readingSeconds, Script, spoken, type Page } from './pick';
import { Portrait } from './portrait';
import { Voice } from './voice';

/** Characters a second. Quick enough that nobody waits for it, slow enough to look typed by a man under fire. */
const TYPE_RATE = 70;
/** Seconds a line over the open channel stays up. */
const BARK_SECONDS = 4.2;
/** Seconds between the run starting and his first words. */
const FIRST_WORDS_AT = 3.5;

const BOSS_NAME = 'The Commander';
const NAMES: Record<Speaker, string> = { commander: 'The Commander', council: 'The Council', intercept: 'Intercepted transmission', radio: 'Radio' };
const TAGS: Record<Speaker, string> = {
  commander: 'Outpost command / open channel',
  council: 'Office of Societal Compliance',
  intercept: 'Outpost command to all units',
  radio: '',
};
const CHIPS: readonly [StatusFlag, string][] = [['painted', 'PAINTED'], ['jammed', 'SONAR JAMMED'], ['uplink', 'UPLINK JAMMED'], ['aaLock', 'AA LOCK']];

interface Radar {
  outpost?: { commander: { jam: { radar(list: readonly EnemyInstance[]): readonly EnemyInstance[] } } } | null;
}

export class CommanderHud {
  readonly el: HTMLElement;
  private readonly box: HTMLElement;
  private readonly name: Label;
  private readonly tag: Label;
  private readonly text: HTMLElement;
  private readonly pips: HTMLElement;
  private readonly skipKey: Label;
  private readonly face = new Portrait('cmd-face');
  private readonly script = new Script();
  private readonly voice: Voice;
  private readonly chips = new Map<StatusFlag, Flag>();

  private pages: Page[] = [];
  private page = -1;
  private person = false;
  private full = '';
  private shown = 0;
  private clock = 0;
  private bark = false;
  private firstIn = -1;
  private afterLast: (() => void) | null = null;
  /** Called when the last page of the last box has been read. */
  onFulfilled: (() => void) | null = null;

  constructor(private readonly ctx: Ctx, settings: Settings) {
    this.voice = new Voice(ctx, settings);
    const name = span('cmd-name');
    const tag = span('cmd-tag');
    this.text = h('p', 'cmd-text');
    this.pips = div('cmd-pips');
    const key = h('b');
    this.box = div('cmd-box',
      this.face.el,
      div('cmd-body',
        div('cmd-head', name, tag),
        this.text,
        div('cmd-foot', this.pips, span('cmd-skip', key, ' next')),
      ),
    );
    this.name = new Label(name);
    this.tag = new Label(tag);
    this.skipKey = new Label(key);
    const chipRow = div('cmd-chips');
    for (const [flag, label] of CHIPS) {
      const chip = div(`cmd-chip ${flag}`, label);
      chipRow.append(chip);
      this.chips.set(flag, new Flag(chip, 'on'));
    }
    this.el = div('cmd', this.box, chipRow);
    const { events } = ctx;
    events.on('commander:briefing', b => this.onBriefing(b));
    events.on('commander:status', e => this.chips.get(e.flag)?.set(e.on));
    events.on('commander:bark', e => this.onBark(e.id, e.vars));
    events.on('commander:fulfilled', () => this.onFulfil());
    events.on('commander:person', e => { this.person = e.arrived; });
    events.on('player:died', () => this.onBark(PLAYER_DOWN[0]!.id));
  }

  reset(): void {
    this.close();
    this.script.reset();
    this.firstIn = FIRST_WORDS_AT;
    this.afterLast = null;
    this.person = false;
    for (const flag of this.chips.values()) flag.set(false);
    const label = this.ctx.input.labelFor?.('interact');
    this.skipKey.set(typeof label === 'string' ? label : 'E');
  }

  private onBriefing(b: Briefing): void {
    this.open(this.script.compose(b));
  }

  private onBark(id: string, vars?: Readonly<Record<string, string>>): void {
    if (this.page >= 0 && !this.bark) return;
    const line = lineById(id);
    if (!line) return;
    const part = spoken(line, vars ?? {}, null);
    const tone: Tone = line.emotion === 'smug' || line.emotion === 'irritated' || line.emotion === 'rattled' || line.emotion === 'cracked' ? line.emotion : 'cracked';
    this.bark = true;
    this.pages = [{ speaker: 'commander', tone, parts: [part] }];
    this.show(0);
  }

  /** The Commander is dead. His last words, the Council's receipt, and the run is over. */
  private onFulfil(): void {
    const tone = TONE_OF.lastStand;
    const last = LAST_WORDS[Math.floor(Math.random() * LAST_WORDS.length)]!;
    this.afterLast = () => this.onFulfilled?.();
    this.open([
      { speaker: 'commander', tone, parts: [spoken(last, {}, null)] },
      { speaker: 'council', tone, parts: FINAL_COUNCIL.map(l => spoken(l, {}, null)) },
    ]);
  }

  private open(pages: Page[]): void {
    this.bark = false;
    this.pages = pages;
    if (pages.length === 0) return;
    this.show(0);
  }

  private show(index: number): void {
    const page = this.pages[index]!;
    this.page = index;
    this.full = page.parts.map(p => p.text).join(page.speaker === 'intercept' ? '\n' : ' ');
    this.shown = 0;
    this.text.textContent = '';
    this.clock = readingSeconds(page) * (this.bark ? 0 : 1) + (this.bark ? BARK_SECONDS : 0);
    this.box.className = `cmd-box on ${page.speaker} ${page.tone}${this.bark ? ' bark' : ''}`;
    this.name.set(NAMES[page.speaker]);
    this.tag.set(TAGS[page.speaker]);
    this.face.set(page.speaker, page.tone);
    this.voice.say(page.parts.map(p => p.clip));
    this.pips.replaceChildren(...this.pages.map((_, i) => div(i <= index ? 'cmd-pip on' : 'cmd-pip')));
  }

  private close(): void {
    this.box.className = 'cmd-box';
    this.page = -1;
    this.pages = [];
    this.bark = false;
    this.voice.stop();
  }

  private next(skipped: boolean): void {
    if (this.page + 1 < this.pages.length) {
      this.show(this.page + 1);
      return;
    }
    const wasBriefing = !this.bark;
    this.close();
    if (skipped && wasBriefing && !this.afterLast) this.ctx.events.emit('commander:skipped', {});
    if (this.afterLast) {
      const end = this.afterLast;
      this.afterLast = null;
      end();
    }
  }

  update(dt: number): void {
    if (this.firstIn > 0) {
      this.firstIn -= dt;
      if (this.firstIn <= 0) this.onBark(FIRST[Math.floor(Math.random() * FIRST.length)]!.id);
    }
    if (this.page < 0) return;
    const typing = this.shown < this.full.length;
    if (typing) {
      this.shown = Math.min(this.full.length, this.shown + TYPE_RATE * dt);
      this.text.textContent = this.full.slice(0, Math.ceil(this.shown));
    }
    this.face.update(dt, typing || this.voice.speaking);
    if (!this.bark && this.ctx.input.pressed?.('interact') === true) {
      // The first press finishes the line, the second moves on. Nobody should lose a joke to a stray key.
      if (typing) {
        this.shown = this.full.length;
        this.text.textContent = this.full;
      } else this.next(true);
      return;
    }
    if (!typing && !this.voice.speaking) this.clock -= dt;
    if (this.clock <= 0) this.next(false);
  }

  /** He wears a Juggernaut's armour, and he would like that understood. */
  nameBoss(bar: HTMLElement): void {
    if (!this.person) return;
    const name = bar.querySelector('.bs-name');
    if (name && name.textContent !== BOSS_NAME) name.textContent = BOSS_NAME;
  }

  setPaused(paused: boolean): void {
    this.voice.setPaused(paused);
  }

  /** The minimap's view of the enemy, once the Commander has lied to it. */
  radar(real: readonly EnemyInstance[]): readonly EnemyInstance[] {
    return (this.ctx.enemies as unknown as Radar).outpost?.commander.jam.radar(real) ?? real;
  }
}
