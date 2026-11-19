/**
 * Co-op's own HUD: the teammates strip (health, down and dead, in a menu, cheats, ping, ready), the break's clock and ready
 * vote, the kill feed, the Tab board (kills, score, credits, downs, revives, ping), chat on Enter, and the end-of-run board with
 * its buttons. The strip, the feed and the Tab board live inside the HUD's own root, so they show and hide with the rest of the
 * HUD; the end board sits over everything (Hud.teamBoard), because the HUD hides once the mouse is let go.
 */
import type { Ctx } from '../core/contracts';
import { div, h, span } from '../ui/dom';
import { ENEMY_NAMES } from '../ui/data';
import { CHAT_MAX } from './lobby';
import type { CoopSession } from './index';
import type { Ending } from './team';
import { CUT_TO } from './teamBreak';
import type { Card } from './worldProtocol';
import type { KillNews } from './world/credit';

type Row = { card: Card; name: string; color: string; me: boolean };

/** Seconds the end board stays before the host takes everyone back to the lobby. */
export const END_SECONDS = 20;
/** The kill feed: lines kept, seconds each stays, and the seconds within which one player's kills of one kind share a line. */
const KILL_LINES = 5;
const KILL_LIFE = 4.5;
const KILL_MERGE = 2.5;

/** What the strip and the boards say after a name: down with the seconds, dead, or standing in a menu. */
const stateText = (card: Card, between = false): string => card.state === 'down' ? `DOWN ${card.bleed}s` : card.state === 'dead' ? 'DEAD'
  : card.menu ? (between ? 'SHOPPING' : 'IN A MENU') : '';

/** The end board's words, by ending. The Council's voice: dry, and never sorry. */
export function endCopy(ending: Ending, wave: number): { big: string; sub: string; won: boolean } {
  switch (ending) {
    case 'fulfilled': return { big: 'CONTRACT FULFILLED', won: true, sub: 'The Commander is deceased. The Council thanks you all for your service. Payment is under review.' };
    case 'mission': return { big: 'MISSION COMPLETE', won: true, sub: 'The Council thanks you all for your service.' };
    default: return { big: 'TEAM WIPED', won: false, sub: `The run ended on wave ${wave}. The Council notes the outcome and regrets nothing.` };
  }
}

interface KillLine { el: HTMLElement; who: HTMLElement; what: HTMLElement; slot: number; id: string; head: boolean; count: number; age: number; live: boolean }

export class CoopHud {
  readonly el: HTMLElement;
  private readonly strip = div('cq-strip');
  private readonly rest = div('cq-rest');
  private readonly kills = div('cq-kills');
  private readonly board = div('cq-board');
  private readonly end = div('cq-end');
  private readonly over = div('cq-over', this.end);
  private readonly chat: HTMLInputElement;
  private readonly lines: KillLine[] = [];
  private nextPaint = 0;
  private lastFrame = 0;
  private endAt = 0;
  private buttons: { el: HTMLButtonElement; run: () => void }[] = [];
  private focus = 0;
  private readonly off: (() => void)[] = [];
  /** Back to the lobby page: the host takes everyone, a guest steps out alone. */
  onEndDone: () => void = () => {};
  /** Host: the same contract again, for everyone. */
  onPlayAgain: () => void = () => {};

  constructor(private readonly ctx: Ctx, private readonly session: CoopSession) {
    this.chat = document.createElement('input');
    this.chat.className = 'cq-chat';
    this.chat.maxLength = CHAT_MAX;
    this.chat.placeholder = 'Say something · Enter sends · Esc cancels';
    this.chat.spellcheck = false;
    this.chat.autocomplete = 'off';
    this.chat.style.display = 'none';
    this.board.style.display = 'none';
    this.rest.style.display = 'none';
    this.over.style.display = 'none';
    for (let i = 0; i < KILL_LINES; i++) {
      const who = span('cq-kill-who'), what = span('cq-kill-what');
      const el = div('cq-kill', who, what);
      el.style.display = 'none';
      this.kills.append(el);
      this.lines.push({ el, who, what, slot: -1, id: '', head: false, count: 0, age: 0, live: false });
    }
    this.el = div('cq', this.strip, this.rest, this.kills, this.board, this.chat);
    (ctx.hud as Ctx['hud'] & { mount?(el: HTMLElement): void }).mount?.(this.el);
    const key = (e: KeyboardEvent) => this.key(e);
    window.addEventListener('keydown', key);
    this.off.push(() => window.removeEventListener('keydown', key));
    this.off.push(ctx.events.on('coop:kill', kill => this.killed(kill)));
    this.chat.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        this.session.lobby.say(this.chat.value);
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
    this.chat.addEventListener('blur', () => this.closeChat());
  }

  private key(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
    if (this.endAt) return this.endKey(e);
    if (e.key !== 'Enter') return;
    const game = (window as unknown as { __op2?: { game?: { state: string } } }).__op2?.game;
    if (game && game.state !== 'playing') return;
    e.preventDefault();
    this.chat.style.display = '';
    this.chat.value = '';
    this.chat.focus();
  }

  /** The end board's keys: the arrows pick a button, Enter presses it. */
  private endKey(e: KeyboardEvent): void {
    if (e.repeat || !this.buttons.length) return;
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (step) {
      this.setFocus((this.focus + step + this.buttons.length) % this.buttons.length);
      this.ctx.audio.play?.('ui_hover');
    } else if (e.key === 'Enter') this.press(this.focus);
    else return;
    e.preventDefault();
  }

  private setFocus(index: number): void {
    this.focus = index;
    this.buttons.forEach((b, i) => b.el.classList.toggle('focus', i === index));
  }

  private press(index: number): void {
    const button = this.buttons[index];
    if (!button) return;
    this.ctx.audio.play?.('menu_select');
    button.run();
  }

  private closeChat(): void {
    if (this.chat.style.display === 'none') return;
    this.chat.style.display = 'none';
    this.chat.blur();
  }

  /** A kill, anyone's: a line in the kill feed. One player's kills of one kind in quick succession share a line. */
  private killed(kill: KillNews): void {
    const team = this.session.world?.team;
    if (!team || kill.by < 0) return;
    const newest = this.lines.filter(l => l.live).sort((a, b) => a.age - b.age)[0];
    let line = newest && newest.slot === kill.by && newest.id === kill.id && newest.age < KILL_MERGE ? newest : null;
    if (!line) {
      // The oldest line gives way.
      line = this.lines.find(l => !l.live) ?? this.lines.reduce((a, b) => (b.age > a.age ? b : a));
      Object.assign(line, { slot: kill.by, id: kill.id, count: 0, head: false, live: true });
      this.kills.append(line.el);
      line.el.style.display = '';
    }
    line.count++;
    line.age = 0;
    line.head ||= kill.head;
    const who = team.who(kill.by);
    const name = (ENEMY_NAMES as Record<string, string>)[kill.id] ?? kill.id;
    line.who.textContent = who.me ? 'YOU' : who.name;
    line.who.style.color = who.color;
    line.what.textContent = `${name.toUpperCase()}${line.count > 1 ? ` ×${line.count}` : ''}${line.head ? ' · HEAD' : ''}`;
    line.el.classList.toggle('boss', kill.boss);
    // A boss is news for the main feed too, by name.
    if (kill.boss) this.ctx.hud.feed(`${who.me ? 'You' : who.name} killed the ${name}`, who.color);
  }

  update(rows: Row[], now: number): void {
    const dt = this.lastFrame ? Math.min(0.25, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    for (const line of this.lines) {
      if (!line.live) continue;
      line.age += dt;
      if (line.age >= KILL_LIFE) { line.live = false; line.el.style.display = 'none'; }
      else line.el.style.opacity = line.age > KILL_LIFE - 0.6 ? String((KILL_LIFE - line.age) / 0.6) : '';
    }
    const held = this.ctx.input.isDown?.('scoreboard') === true;
    this.board.style.display = held && !this.endAt ? '' : 'none';
    if (this.endAt) {
      const left = Math.max(0, Math.ceil((this.endAt - now) / 1000));
      const foot = this.end.querySelector('.cq-foot');
      if (foot) foot.textContent = this.session.hosting ? `Everyone goes back to the lobby in ${left} s.` : 'The host decides what comes next. You may leave on your own.';
      if (this.session.hosting && now >= this.endAt) this.onEndDone();
    }
    if (now < this.nextPaint) return;
    this.nextPaint = now + 250;
    const team = this.session.world?.team;
    const rest = team?.rest;
    const between = rest?.on === true && this.ctx.waves.phase === 'intermission';
    this.strip.replaceChildren(...rows.filter(r => !r.me).map(r => div(`cq-mate ${r.card.state}`,
      div('cq-mate-head', span('cq-name', r.name), span('cq-state', stateText(r.card, between)),
        r.card.cheats ? span('cq-cheat', 'CHEATS') : null, between && rest!.ready.includes(r.card.slot) ? span('cq-ready', 'READY') : null,
        span('cq-ping', `${r.card.ping} ms`)),
      div('cq-bar', div('cq-fill')),
    )));
    rows.filter(r => !r.me).forEach((r, i) => {
      const mate = this.strip.children[i] as HTMLElement;
      (mate.querySelector('.cq-name') as HTMLElement).style.color = r.color;
      const fill = mate.querySelector('.cq-fill') as HTMLElement;
      fill.style.width = `${Math.round(100 * Math.min(1, r.card.hp / Math.max(1, r.card.max)))}%`;
      fill.style.background = r.color;
    });
    this.rest.style.display = between ? '' : 'none';
    // For the layout: what else is top centre makes room for the chip while it is up (ui/css/cooptime.css).
    this.rest.classList.toggle('up', between);
    if (between && rest) {
      const mine = rows.find(r => r.me)?.card.slot ?? -1;
      const key = this.ctx.input.labelFor?.('nextWave') ?? 'L';
      const left = rest.left;
      const voted = rest.ready.includes(mine);
      this.rest.replaceChildren(
        span('cq-rest-t', `NEXT WAVE IN ${left} s`),
        span('cq-rest-n', `${rest.ready.length}/${rest.need} READY`),
        span(`cq-rest-k${voted ? ' on' : ''}`, left <= CUT_TO ? 'STAND BY' : voted ? 'YOU ARE READY' : `[${key}] READY UP`),
      );
    }
    if (held) this.board.replaceChildren(this.table(rows, 'TEAM · TAB'));
  }

  private table(rows: Row[], title: string): HTMLElement {
    const head = ['', 'KILLS', 'SCORE', 'CREDITS', 'DOWNS', 'REVIVES', 'PING'];
    return div('cq-table',
      div('cq-title', title),
      div('cq-row cq-headrow', ...head.map(text => span('', text))),
      ...rows.map(r => {
        const name = span('cq-name', `${r.name}${r.me ? ' (you)' : ''}${stateText(r.card) ? ` · ${stateText(r.card)}` : ''}${r.card.cheats ? ' · CHEATS' : ''}`);
        name.style.color = r.color;
        const c = r.card;
        return div('cq-row', name, ...[c.kills, c.score, c.credits, c.downs, c.revives, `${c.ping} ms`].map(v => span('', String(v.toLocaleString?.('en-US') ?? v))));
      }),
    );
  }

  /**
   * The run is over: everyone's board, with its buttons. Every player may go back to the lobby; the host takes everyone, and
   * may start the same contract again. The world stays live under it.
   */
  showEnd(rows: Row[], wave: number, now: number, ending: Ending = 'wipe'): void {
    this.endAt = now + END_SECONDS * 1000;
    this.closeChat();
    const copy = endCopy(ending, wave);
    const big = div(`cq-big${copy.won ? ' won' : ''}`, copy.big);
    const hosting = this.session.hosting;
    const make = (label: string, run: () => void) => {
      const el = h('button', 'mi mi-small cq-btn', span('mi-t', label));
      el.type = 'button';
      el.tabIndex = -1;
      return { el, run };
    };
    this.buttons = hosting
      ? [make('Back to lobby (everyone)', () => this.onEndDone()), make('Start again', () => this.onPlayAgain())]
      : [make('Back to lobby', () => this.onEndDone())];
    this.buttons.forEach((button, i) => {
      button.el.addEventListener('pointermove', () => { if (this.focus !== i) this.setFocus(i); });
      button.el.addEventListener('click', () => this.press(i));
    });
    this.end.replaceChildren(
      big,
      div('cq-sub', copy.sub),
      this.table(rows, 'FINAL BOARD'),
      div('cq-btns', ...this.buttons.map(b => b.el)),
      div('cq-foot', ''),
    );
    this.setFocus(0);
    this.over.style.display = '';
    // Over everything, with the mouse free for the buttons (the HUD itself hides once the mouse is let go).
    const hud = this.ctx.hud as Ctx['hud'] & { teamBoard?(el: HTMLElement): void };
    if (hud.teamBoard) hud.teamBoard(this.over);
    else this.el.append(this.over);
  }

  dispose(): void {
    for (const off of this.off) off();
    this.el.remove();
    this.over.remove();
  }
}
