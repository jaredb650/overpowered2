/**
 * The mission on the HUD: what to do, who is talking, and what the next key does. It sits inside the game's own HUD so it comes and
 * goes with it, and it stays up in a gunner's seat, because the insertion is where the mission starts talking.
 */
import type { Action, Ctx } from '../core/contracts';
import type { SeatPanel } from '../core/gameplay';
import type { Tone } from '../enemies/commander/adaptations';
import type { Line, Speaker } from '../enemies/commander/lines';
import { Flag, Label, div, h, span } from '../ui/dom';
import { Portrait } from '../ui/commander/portrait';
import { Voice } from '../ui/commander/voice';
import type { Hud } from '../ui/Hud';
import { Airtime } from './airtime';
import type { ObjectiveState } from './types';
import './campaign.css';

/** A ticked objective stays up this long. */
const TICK_SECONDS = 1.6;
const SAVED_SECONDS = 2.6;

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
  private readonly beatEl = span('ms-beat');
  private readonly beatName = new Label(this.beatEl);
  private readonly savedEl = span('ms-saved', 'Checkpoint');
  private readonly curtainEl = div('ms-curtain');
  private readonly captionEl = span('ms-caption');
  private readonly captionText = new Label(this.captionEl);
  private readonly box: HTMLElement;
  private readonly name: Label;
  private readonly tag: Label;
  private readonly text: Label;
  private readonly face = new Portrait('cmd-face');
  private readonly voice: Voice;
  /** How long the line on the radio holds it: airtime.ts. */
  private readonly airtime: Airtime;
  private curtainShare = 0;
  private curtainRate = 0;
  private savedLeft = 0;
  private hintLeft = 0;

  constructor(private readonly ctx: Ctx) {
    this.voice = new Voice(ctx, (ctx.hud as unknown as Hud).settings);
    this.airtime = new Airtime(this.voice);
    const name = span('cmd-name');
    const tag = span('cmd-tag');
    const text = h('p', 'cmd-text');
    this.box = div('cmd-box ms-radio', this.face.el, div('cmd-body', div('cmd-head', name, tag), text));
    this.name = new Label(name);
    this.tag = new Label(tag);
    this.text = new Label(text);
    this.el = div('ms', this.curtainEl, this.box, this.hintEl, this.savedEl);
    this.objectiveList.append(this.beatEl);
    const skip = h('b');
    const skipKey = new Label(skip);
    const panel = div('ms-cinema', div('ms-bar top'), div('ms-bar bottom', this.captionEl, span('ms-skip', skip, ' skip')));
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

  /** `{jump}` and the like become a key cap with the player's own binding on it. */
  hint(text: string, seconds: number): void {
    const { input } = this.ctx;
    // A split on a captured group leaves the words at even places and the actions at odd ones.
    this.hintEl.replaceChildren(...text.split(/\{(\w+)\}/).map((part, i) => (i % 2 === 1 ? span('ms-key', input.labelFor(part as Action)) : part)));
    this.hintEl.classList.add('on');
    this.hintLeft = seconds;
  }

  /** What the player is in the middle of, over the list of what to do about it. */
  beat(title: string): void {
    this.beatName.set(title);
  }

  saved(): void {
    this.savedEl.classList.add('on');
    this.savedLeft = SAVED_SECONDS;
  }

  /** How much of the picture is black. Stays until told otherwise. */
  curtain(share: number): void {
    this.curtainRate = 0;
    this.setCurtain(share);
  }

  /** Back up from black over this long. */
  lift(seconds: number): void {
    this.curtainRate = 1 / seconds;
  }

  caption(text: string): void {
    this.captionText.set(text);
  }

  private setCurtain(share: number): void {
    if (share === this.curtainShare) return;
    this.curtainShare = share;
    this.curtainEl.style.opacity = String(share);
  }

  /** A paused game has nobody talking over it, and the voice's clock stops with the game's. */
  setPaused(paused: boolean): void {
    this.voice.setPaused(paused);
  }

  /** A mission line has the radio, from its first word to the breath after the last line of a run. The Commander's own box gives way. */
  get talking(): boolean {
    return this.airtime.held;
  }

  speak(line: Line, done: () => void): void {
    const [name, tag] = WHO[line.speaker];
    const tone: Tone = TONES.has(line.emotion) ? (line.emotion as Tone) : 'smug';
    this.box.className = `cmd-box ms-radio on bark ${line.speaker} ${tone}`;
    this.name.set(name);
    this.tag.set(tag);
    this.text.set(line.text);
    this.face.set(line.speaker, tone);
    this.voice.say([line.id]);
    this.airtime.begin(line.text, done);
  }

  hush(): void {
    this.voice.stop();
    this.airtime.clear();
    this.box.classList.remove('on');
  }

  private updateLine(dt: number): void {
    this.voice.update(dt);
    const { airtime } = this;
    const was = airtime.up;
    // This can say the next line, from inside the runner's `done`.
    airtime.update(dt);
    if (!was) return;
    this.face.update(dt, airtime.talking);
    if (!airtime.up) this.box.classList.remove('on');
  }

  update(dt: number): void {
    this.updateLine(dt);
    if (this.hintLeft > 0) {
      this.hintLeft -= dt;
      if (this.hintLeft <= 0) this.hintEl.classList.remove('on');
    }
    if (this.savedLeft > 0) {
      this.savedLeft -= dt;
      if (this.savedLeft <= 0) this.savedEl.classList.remove('on');
    }
    if (this.curtainRate > 0) {
      this.setCurtain(Math.max(0, this.curtainShare - this.curtainRate * dt));
      if (this.curtainShare === 0) this.curtainRate = 0;
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
    this.hintLeft = this.savedLeft = 0;
    this.hintEl.classList.remove('on');
    this.savedEl.classList.remove('on');
    this.curtain(0);
    this.caption('');
    this.objectiveList.replaceChildren(this.beatEl);
    this.rows.clear();
  }
}
