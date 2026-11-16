/**
 * Co-op's own HUD (stage 3): the teammates strip (health, down and dead, ping), the Tab board (kills, score, credits,
 * downs, revives, ping), chat on Enter, the end-of-run board, and one-line notices. It lives inside the HUD's own root,
 * so it shows and hides with the rest of the HUD.
 */
import type { Ctx } from '../core/contracts';
import { div, span } from '../ui/dom';
import { CHAT_MAX } from './lobby';
import type { CoopSession } from './index';
import type { Card } from './worldProtocol';

type Row = { card: Card; name: string; color: string; me: boolean };

const stateText = (card: Card): string => card.state === 'down' ? `DOWN ${card.bleed}s` : card.state === 'dead' ? 'DEAD' : '';

export class CoopHud {
  readonly el: HTMLElement;
  private readonly strip = div('cq-strip');
  private readonly board = div('cq-board');
  private readonly end = div('cq-end');
  private readonly chat: HTMLInputElement;
  private nextPaint = 0;
  private endAt = 0;
  private readonly off: (() => void)[] = [];
  /** Host: back to the lobby page for everyone. */
  onEndDone: () => void = () => {};

  constructor(private readonly ctx: Ctx, private readonly session: CoopSession) {
    this.chat = document.createElement('input');
    this.chat.className = 'cq-chat';
    this.chat.maxLength = CHAT_MAX;
    this.chat.placeholder = 'Say something · Enter sends · Esc cancels';
    this.chat.spellcheck = false;
    this.chat.autocomplete = 'off';
    this.chat.style.display = 'none';
    this.board.style.display = 'none';
    this.end.style.display = 'none';
    this.el = div('cq', this.strip, this.board, this.end, this.chat);
    (ctx.hud as Ctx['hud'] & { mount?(el: HTMLElement): void }).mount?.(this.el);
    const key = (e: KeyboardEvent) => this.key(e);
    window.addEventListener('keydown', key);
    this.off.push(() => window.removeEventListener('keydown', key));
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
    if (e.key !== 'Enter' || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
    if (this.endAt && this.session.hosting) return this.onEndDone();
    const game = (window as unknown as { __op2?: { game?: { state: string } } }).__op2?.game;
    if (game && game.state !== 'playing') return;
    e.preventDefault();
    this.chat.style.display = '';
    this.chat.value = '';
    this.chat.focus();
  }

  private closeChat(): void {
    if (this.chat.style.display === 'none') return;
    this.chat.style.display = 'none';
    this.chat.blur();
  }

  update(rows: Row[], now: number): void {
    const held = this.ctx.input.isDown?.('scoreboard') === true;
    this.board.style.display = held && !this.endAt ? '' : 'none';
    if (this.endAt) {
      const left = Math.max(0, Math.ceil((this.endAt - now) / 1000));
      const foot = this.end.querySelector('.cq-foot');
      if (foot) foot.textContent = this.session.hosting ? `Back to the lobby in ${left} · Enter now` : 'Waiting for the host to take everyone back to the lobby';
      if (this.session.hosting && now >= this.endAt) this.onEndDone();
    }
    if (now < this.nextPaint) return;
    this.nextPaint = now + 250;
    this.strip.replaceChildren(...rows.filter(r => !r.me).map(r => div(`cq-mate ${r.card.state}`,
      div('cq-mate-head', span('cq-name', r.name), span('cq-state', stateText(r.card)), span('cq-ping', `${r.card.ping} ms`)),
      div('cq-bar', div('cq-fill')),
    )));
    rows.filter(r => !r.me).forEach((r, i) => {
      const mate = this.strip.children[i] as HTMLElement;
      (mate.querySelector('.cq-name') as HTMLElement).style.color = r.color;
      const fill = mate.querySelector('.cq-fill') as HTMLElement;
      fill.style.width = `${Math.round(100 * Math.min(1, r.card.hp / Math.max(1, r.card.max)))}%`;
      fill.style.background = r.color;
    });
    if (held) this.board.replaceChildren(this.table(rows, 'TEAM · TAB'));
  }

  private table(rows: Row[], title: string): HTMLElement {
    const head = ['', 'KILLS', 'SCORE', 'CREDITS', 'DOWNS', 'REVIVES', 'PING'];
    return div('cq-table',
      div('cq-title', title),
      div('cq-row cq-headrow', ...head.map(h => span('', h))),
      ...rows.map(r => {
        const name = span('cq-name', `${r.name}${r.me ? ' (you)' : ''}${stateText(r.card) ? ` · ${stateText(r.card)}` : ''}`);
        name.style.color = r.color;
        const c = r.card;
        return div('cq-row', name, ...[c.kills, c.score, c.credits, c.downs, c.revives, `${c.ping} ms`].map(v => span('', String(v.toLocaleString?.('en-US') ?? v))));
      }),
    );
  }

  /** The run is over: everyone's board, and (host) the way back to the lobby. */
  showEnd(rows: Row[], wave: number, now: number, won = false): void {
    this.endAt = now + 15_000;
    this.closeChat();
    const big = div('cq-big', won ? 'MISSION COMPLETE' : 'TEAM WIPED');
    if (won) big.style.color = '#79f1ad';
    this.end.replaceChildren(
      big,
      div('cq-sub', won ? 'The Council thanks you all for your service.' : `The run ended on wave ${wave}.`),
      this.table(rows, 'FINAL BOARD'),
      div('cq-foot', ''),
    );
    this.end.style.display = '';
  }

  dispose(): void {
    for (const off of this.off) off();
    this.el.remove();
  }
}
