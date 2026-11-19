/**
 * What the session itself puts on screen, over everything else: the deploy gate ("Click to deploy", and who is still
 * loading), the one status line while the world waits for players or the link to the host is in trouble, and the board
 * shown when the host is gone for good. The team's own HUD (strip, Tab board, end-of-run board) is coopHud.ts.
 */
import { div, span } from '../ui/dom';
import '../ui/css/coopsession.css';
import type { LobbyPlayer } from './lobby';

export interface LostRow { name: string; color: string; me: boolean; kills: number; score: number; credits: number }

const STATE_TEXT = { loading: 'loading the map', ready: 'at the deploy screen', lost: 'lost connection' } as const;

export class SessionHud {
  readonly el = div('cs');
  private gate: HTMLElement | null = null;
  private readonly line = div('cs-line');
  private lost: HTMLElement | null = null;
  private lineText = '';
  private offGate: (() => void) | null = null;

  constructor() {
    this.line.style.display = 'none';
    this.el.append(this.line);
    (document.getElementById('ui') ?? document.body).append(this.el);
  }

  /**
   * The deploy gate. `ready`: this page may deploy (it has its host and its match). The click is the first gesture this
   * page gets, so it is what takes the mouse and unlocks the sound: `onDeploy` runs inside it.
   */
  showGate(title: string, onDeploy: () => void): void {
    this.hideGate();
    const go = div('cs-gate-go', 'Click to deploy');
    const gate = this.gate = div('cs-gate', span('cs-gate-k', title), go, div('cs-gate-sub'), div('cs-gate-list'));
    gate.dataset.ready = '0';
    const fire = () => { if (gate.dataset.ready === '1') onDeploy(); };
    const key = (e: KeyboardEvent) => {
      if (e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      fire();
    };
    gate.addEventListener('click', fire);
    addEventListener('keydown', key);
    this.offGate = () => removeEventListener('keydown', key);
    this.el.append(gate);
  }

  paintGate(ready: boolean, sub: string, players: readonly LobbyPlayer[], you: string): void {
    const gate = this.gate;
    if (!gate) return;
    gate.dataset.ready = ready ? '1' : '0';
    const go = gate.querySelector('.cs-gate-go') as HTMLElement;
    go.textContent = ready ? 'Click to deploy' : 'Connecting…';
    go.classList.toggle('wait', !ready);
    (gate.querySelector('.cs-gate-sub') as HTMLElement).textContent = sub;
    (gate.querySelector('.cs-gate-list') as HTMLElement).replaceChildren(...players.filter(p => !p.away || p.state).map(p =>
      div(`cs-gate-row${p.state ? '' : ' in'}`, span('n', `${p.name}${p.id === you ? ' (you)' : ''}${p.host ? ' · host' : ''}`),
        span('s', p.state ? STATE_TEXT[p.state] : 'in'))));
  }

  hideGate(): void {
    this.offGate?.();
    this.offGate = null;
    this.gate?.remove();
    this.gate = null;
  }

  /** The status line; '' hides it. `bad`: the link is in trouble (red), not just someone loading (amber). */
  setLine(text: string, bad = false): void {
    if (text === this.lineText) return;
    this.lineText = text;
    this.line.textContent = text;
    this.line.classList.toggle('bad', bad);
    this.line.style.display = text ? '' : 'none';
  }

  /** The host is gone for good: everyone's numbers as they stood, and what happens next. */
  showLost(headline: string, sub: string, rows: readonly LostRow[]): void {
    this.lost?.remove();
    const head = ['', 'KILLS', 'SCORE', 'CREDITS'];
    this.lost = div('cs-lost',
      div('cq-big', headline),
      div('cq-sub', sub),
      rows.length ? div('cq-table', div('cq-title', 'TEAM BOARD'), div('cq-row cq-headrow', ...head.map(h => span('', h))),
        ...rows.map(r => {
          const name = span('cq-name', `${r.name}${r.me ? ' (you)' : ''}`);
          name.style.color = r.color;
          return div('cq-row', name, ...[r.kills, r.score, r.credits].map(v => span('', v.toLocaleString('en-US'))));
        })) : null,
      div('cq-foot', ''),
    );
    this.el.append(this.lost);
  }

  setLostFoot(text: string): void {
    const foot = this.lost?.querySelector('.cq-foot');
    if (foot && foot.textContent !== text) foot.textContent = text;
  }

  dispose(): void {
    this.hideGate();
    this.el.remove();
  }
}
