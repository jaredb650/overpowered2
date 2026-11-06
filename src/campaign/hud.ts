/**
 * The mission on the HUD: what to do, who is talking, and what the next key does. It sits inside the game's own HUD so it comes and
 * goes with it, and it stays up in a gunner's seat, because the insertion is where the mission starts talking.
 */
import type { Ctx } from '../core/contracts';
import type { SeatPanel } from '../core/gameplay';
import type { Tone } from '../enemies/commander/adaptations';
import type { Line, Speaker } from '../enemies/commander/lines';
import { Flag, Label, div, h, span } from '../ui/dom';
import { Portrait } from '../ui/commander/portrait';
import { Voice } from '../ui/commander/voice';
import { loadSettings } from '../ui/settings';
import type { ObjectiveState } from './types';
import './campaign.css';

/** Words a second, for a line nobody has recorded. */
const WORDS_PER_SECOND = 2.6;
const LEAST_SECONDS = 2;
/** Between one line and the next, so a speech has breaths in it. */
const GAP_SECONDS = 0.35;
/** A ticked objective stays up this long. */
const TICK_SECONDS = 1.6;

const WHO: Record<Speaker, readonly [name: string, tag: string]> = {
  commander: ['The Commander', 'Outpost command / open channel'],
  council: ['The Council', 'Office of Societal Compliance'],
  intercept: ['Intercepted transmission', 'Outpost command to all units'],
  radio: ['Packmule', 'Your ride'],
};

const TONES: ReadonlySet<string> = new Set(['smug', 'irritated', 'rattled', 'cracked']);

class ObjectiveRow {
  readonly el: HTMLElement;
  private readonly text: Label;
  private readonly ticked: Flag;
  /** Seconds left on a ticked row. Below 0, the row is not ticked. */
  clock = -1;

  constructor() {
    const text = span('ms-obj-text');
    this.el = div('ms-obj', span('ms-obj-box'), text);
    this.text = new Label(text);
    this.ticked = new Flag(this.el, 'done');
  }

  show(o: ObjectiveState): void {
    this.text.set(o.text);
    this.ticked.set(o.done);
    this.clock = o.done ? TICK_SECONDS : -1;
  }
}

export class CampaignHud {
  readonly el: HTMLElement;
  /** Under the score, where a column of perks makes room for it rather than being covered by it. */
  readonly objectiveList = div('ms-objs');
  /** Bars and a skip key, for a cutscene. Goes in the seat's slot, so the on-foot HUD steps aside for it. */
  readonly cinema: SeatPanel;
  private readonly rows = new Map<string, ObjectiveRow>();
  private readonly hintEl = div('ms-hint');
  private readonly box: HTMLElement;
  private readonly name: Label;
  private readonly tag: Label;
  private readonly text: Label;
  private readonly face = new Portrait('cmd-face');
  private readonly voice: Voice;
  private hintLeft = 0;
  private lineLeft = 0;
  private gapLeft = 0;
  private lineDone: (() => void) | null = null;
  private lineClip = false;

  constructor(private readonly ctx: Ctx) {
    this.voice = new Voice(ctx, loadSettings());
    const name = span('cmd-name');
    const tag = span('cmd-tag');
    const text = h('p', 'cmd-text');
    this.box = div('cmd-box ms-radio', this.face.el, div('cmd-body', div('cmd-head', name, tag), text));
    this.name = new Label(name);
    this.tag = new Label(tag);
    this.text = new Label(text);
    this.el = div('ms', this.box, this.hintEl);
    const skip = h('b');
    const skipKey = new Label(skip);
    const panel = div('ms-cinema', div('ms-bar top'), div('ms-bar bottom', span('ms-skip', skip, ' skip')));
    this.cinema = {
      el: panel,
      update: () => skipKey.set(ctx.input.labelFor('interact')),
    };
  }

  objectives(list: readonly ObjectiveState[]): void {
    for (const o of list) {
      let row = this.rows.get(o.id);
      if (!row) {
        row = new ObjectiveRow();
        this.rows.set(o.id, row);
        this.objectiveList.append(row.el);
      }
      row.show(o);
    }
    for (const [id, row] of this.rows) {
      if (row.clock >= 0 || list.some(o => o.id === id)) continue;
      row.el.remove();
      this.rows.delete(id);
    }
  }

  /** `{jump}` and the like become the player's own binding. */
  hint(text: string, seconds: number): void {
    const { input } = this.ctx;
    this.hintEl.textContent = text.replace(/\{(\w+)\}/g, (_, action) => input.labelFor(action));
    this.hintEl.classList.add('on');
    this.hintLeft = seconds;
  }

  speak(line: Line, done: () => void): void {
    const [name, tag] = WHO[line.speaker];
    const tone: Tone = TONES.has(line.emotion) ? (line.emotion as Tone) : 'smug';
    this.box.className = `cmd-box ms-radio on bark ${line.speaker} ${tone}`;
    this.name.set(name);
    this.tag.set(tag);
    this.text.set(line.text);
    this.face.set(line.speaker, tone);
    this.lineClip = this.voice.has(line.id);
    this.voice.say([line.id]);
    this.lineLeft = Math.max(LEAST_SECONDS, line.text.split(' ').length / WORDS_PER_SECOND);
    this.lineDone = done;
  }

  hush(): void {
    this.voice.stop();
    this.lineDone = null;
    this.lineLeft = 0;
    this.gapLeft = 0;
    this.box.classList.remove('on');
  }

  private updateLine(dt: number): void {
    if (this.gapLeft > 0) {
      this.gapLeft -= dt;
      if (this.gapLeft > 0) return;
      const done = this.lineDone;
      this.lineDone = null;
      done?.();
      return;
    }
    if (!this.lineDone) return;
    const talking = this.lineClip && this.voice.speaking;
    this.face.update(dt, talking || this.lineLeft > 0);
    if (!talking) this.lineLeft -= dt;
    if (talking || this.lineLeft > 0) return;
    this.box.classList.remove('on');
    this.gapLeft = GAP_SECONDS;
  }

  update(dt: number): void {
    this.updateLine(dt);
    if (this.hintLeft > 0) {
      this.hintLeft -= dt;
      if (this.hintLeft <= 0) this.hintEl.classList.remove('on');
    }
    for (const [id, row] of this.rows) {
      if (row.clock < 0) continue;
      row.clock -= dt;
      if (row.clock > 0) continue;
      row.el.remove();
      this.rows.delete(id);
    }
  }

  reset(): void {
    this.hush();
    this.hintLeft = 0;
    this.hintEl.classList.remove('on');
    this.objectiveList.replaceChildren();
    this.rows.clear();
  }
}
