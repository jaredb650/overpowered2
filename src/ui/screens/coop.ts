/**
 * Play > Multiplayer: host or join a co-op lobby (src/net/). The main menu's look: the crumb, the list on the left, a
 * notice on the right. Four pages: start, host (pick a password), join (code and password), and the lobby itself.
 *
 * An invite link (`?join=CODE`) opens the join page with the code filled in, straight from the splash.
 * Stage 1 starts an enemy-free match on the host's selected map.
 */
import { saveStarter, starterPreference } from '../../contracts/starter';
import { starterCards } from './starter';
import type { Ctx } from '../../core/contracts';
import { BUILD } from '../../net/build';
import {
  type CoopMap, type CoopMode, CODE_LENGTH, Lobby, MAX_PLAYERS, NAME_MAX, CHAT_MAX, cleanCode, inviteLink, loadCallsign, newCode, saveCallsign, type LobbyError,
} from '../../net/lobby';
import { div, h, span } from '../dom';
import { deployMatch } from '../../net/session';
import type { Hud } from '../Hud';
import type { Nav, NavItem } from './nav';
import { menuButton, wordmark } from './parts';
import type { Screen } from './Screens';
import '../css/coop.css';

/** The code an invite link carried, read once at load. */
export const INVITE: string = typeof location === 'undefined' ? '' : cleanCode(new URLSearchParams(location.search).get('join') ?? '');

/** What the host can start: a mode on its own map, or on a map it also plays on. */
const MODES: readonly { label: string; mode: CoopMode; map?: CoopMap }[] = [
  { label: 'The Crucible', mode: 'crucible' }, { label: 'Endless Humans', mode: 'outpost' }, { label: 'Outpost Defense', mode: 'defense' },
  { label: 'Crucible: Office', mode: 'crucible', map: 'office' }, { label: 'Humans: Office', mode: 'outpost', map: 'office' },
];
const NO_TURN = 'Some networks (strict routers, mobile data, some offices) cannot connect yet: the relay server that fixes that is not set up.';

type Page = 'start' | 'host' | 'join' | 'lobby';

function field(label: string, input: HTMLInputElement): HTMLElement {
  return h('label', 'co-field', span('nt-k', label), input);
}

function textInput(max: number, type = 'text'): HTMLInputElement {
  const input = h('input', 'co-input');
  input.type = type;
  input.maxLength = max;
  input.spellcheck = false;
  input.autocomplete = 'off';
  // Esc leaves the field rather than the page.
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') input.blur();
  });
  return input;
}

export class CoopScreen implements Screen {
  readonly el: HTMLElement;
  private crumb = div('mm-crumb');
  private list = div('mm-list');
  private panel = div('nt co-panel');
  private nav: Nav | null = null;
  private page: Page = 'start';
  private lobby: Lobby | null = null;
  private code = '';
  private mode = 0;
  private roomPassword = '';
  private startItem: NavItem;
  /** The last thing that went wrong, shown on the page it sends the player back to. */
  private message = '';
  private invite = INVITE;

  private password = textInput(40, 'password');
  private joinCode = textInput(CODE_LENGTH + 2);
  private name = textInput(NAME_MAX);
  private chatInput = textInput(CHAT_MAX);
  private status = span('nt-ref');
  private players = div('co-players');
  private chatLog = div('co-chat');
  private copied = span('co-copied');
  private readyItem: NavItem;
  private lobbyPanel: HTMLElement;
  private modes: HTMLElement;
  private starter = div('starter-lobby');

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    this.el = div('scr scr-menu scr-coop', this.crumb, this.list, div('mm-brief co-brief', this.panel), span('mm-sub', 'OVERDRIVE'), wordmark());
    this.name.value = loadCallsign();
    this.name.placeholder = 'Callsign';
    this.joinCode.placeholder = 'ABC123';
    this.chatInput.placeholder = 'Say something, Enter to send';
    const saveName = () => {
      const name = this.name.value.trim();
      if (!name) return void (this.name.value = this.lobby?.me?.name ?? loadCallsign());
      saveCallsign(name);
      this.lobby?.setName(name);
    };
    this.name.addEventListener('change', saveName);
    this.name.addEventListener('keydown', e => e.key === 'Enter' && this.name.blur());
    this.password.addEventListener('keydown', e => e.key === 'Enter' && this.submit());
    this.joinCode.addEventListener('keydown', e => e.key === 'Enter' && this.password.focus());
    this.chatInput.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      this.lobby?.say(this.chatInput.value);
      this.chatInput.value = '';
    });

    this.startItem = menuButton('Start', () => this.lobby?.startMatch(MODES[this.mode]!.mode, undefined, MODES[this.mode]!.map));
    this.readyItem = menuButton('Ready', () => this.lobby?.setReady(!this.lobby.me?.ready));
    const copy = h('button', 'co-copy', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', () => this.copy());
    this.modes = div('co-modes',
      span('nt-k', 'Mode'),
      div('co-mode-row', ...MODES.map(({ label }, i) => {
        const button = h('button', i === 0 ? 'co-mode on' : 'co-mode', label);
        button.type = 'button';
        button.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
        });
        button.addEventListener('click', () => {
          this.mode = i;
          this.modes.querySelectorAll('.co-mode').forEach((el, n) => el.classList.toggle('on', n === i));
        });
        return button;
      })),
      div('co-note', 'Free roam: no enemies or waves. Shooting and enemy sync come in stage 2.'),
    );
    this.lobbyPanel = div('',
      span('nt-office', 'Co-op lobby'),
      div('nt-head', span('nt-title', 'Lobby'), this.status),
      div('co-invite',
        span('nt-k', 'Code'), span('co-code', ''),
        span('nt-k', 'Invite'), div('co-link-row', span('co-link', ''), copy, this.copied),
      ),
      this.players,
      field('Your name', this.name),
      this.modes,
      this.starter,
      this.chatLog,
      this.chatInput,
    );
  }

  open(nav: Nav): void {
    this.nav = nav;
    nav.left = nav.right = null;
    // An invite link lands on the join page once; after that the menu opens on the start page like any other.
    if (this.invite) {
      this.joinCode.value = this.invite;
      this.invite = '';
      history.replaceState(null, '', location.pathname);
      this.go('join');
    } else {
      this.go(this.lobby ? 'lobby' : 'start');
    }
  }

  /** `message` is why the player landed here, when it was not their choice. */
  private go(page: Page, message = ''): void {
    this.page = page;
    this.message = message;
    if (page === 'host' || page === 'join') this.password.value = '';
    const back = (label: string, to: () => void) => {
      const item = menuButton(label, to);
      item.el.classList.add('mi-small');
      return item;
    };
    let items: NavItem[];
    if (page === 'start') {
      this.crumb.textContent = 'Play / Multiplayer';
      items = [
        menuButton('Host a lobby', () => this.go('host')),
        menuButton('Join a lobby', () => this.go('join')),
        back('Back', () => this.hud.screens.playMenu()),
      ];
    } else if (page === 'host') {
      this.crumb.textContent = 'Play / Multiplayer / Host';
      items = [menuButton('Open lobby', () => this.submit()), back('Back', () => this.go('start'))];
    } else if (page === 'join') {
      this.crumb.textContent = 'Play / Multiplayer / Join';
      items = [menuButton('Join', () => this.submit()), back('Back', () => this.go('start'))];
    } else {
      this.crumb.textContent = `Play / Multiplayer / ${this.code}`;
      items = [...(this.lobby?.hosting ? [this.startItem] : []), this.readyItem, menuButton('Copy link', () => this.copy()), back('Leave', () => this.leave())];
    }
    this.list.replaceChildren(...items.map(i => i.el));
    if (this.nav) {
      this.nav.set(items, 0);
      this.nav.back = page === 'start' ? () => this.hud.screens.playMenu() : page === 'lobby' ? () => this.leave() : () => this.go('start');
    }
    this.paint();
    if (page === 'host') this.password.focus();
    if (page === 'join') (this.joinCode.value ? this.password : this.joinCode).focus();
  }

  private paint(): void {
    const err = this.message ? div('co-err', this.message) : '';
    const p = (text: string) => h('p', 'nt-p', text);
    if (this.page === 'start') {
      this.panel.replaceChildren(
        span('nt-office', 'Co-op'),
        div('nt-head', span('nt-title', 'Multiplayer')),
        p('Play with up to three friends, browser to browser. One of you hosts a lobby and picks a password. The others join with its code, or the invite link, and that password.'),
        p('Choose a mode in the lobby and walk its map together. This stage has no enemies; each player keeps their own movement and guns.'),
        err,
        div('co-note', NO_TURN),
      );
    } else if (this.page === 'host') {
      this.panel.replaceChildren(
        span('nt-office', 'Co-op'),
        div('nt-head', span('nt-title', 'Host a lobby')),
        p('Pick a password and tell it to your friends. Without it nobody can join, or see who is in the lobby.'),
        field('Password', this.password),
        err,
        div('co-note', 'Keep this tab in front while friends are in: a hidden tab stops answering.'),
      );
    } else if (this.page === 'join') {
      this.panel.replaceChildren(
        span('nt-office', 'Co-op'),
        div('nt-head', span('nt-title', 'Join a lobby')),
        p('The host has the code and the password.'),
        field('Code', this.joinCode),
        field('Password', this.password),
        err,
        div('co-note', NO_TURN),
      );
    } else {
      this.panel.replaceChildren(this.lobbyPanel);
      this.paintLobby();
    }
  }

  private paintLobby(): void {
    const lobby = this.lobby;
    if (!lobby || this.page !== 'lobby') return;
    const link = inviteLink(this.code);
    this.lobbyPanel.querySelector('.co-code')!.textContent = this.code;
    this.lobbyPanel.querySelector('.co-link')!.textContent = link;
    const n = lobby.players.length;
    this.status.textContent = lobby.phase === 'connecting'
      ? 'Connecting...'
      : lobby.hosting ? `Hosting · ${n} of ${MAX_PLAYERS}` : `Connected · ${n} of ${MAX_PLAYERS}`;
    this.status.classList.toggle('co-wait', lobby.phase === 'connecting');
    this.players.replaceChildren(
      ...(lobby.phase === 'connecting'
        ? [div('co-note', 'Looking for the host. This can take up to half a minute.')]
        : lobby.players.map(pl => div(`co-player${pl.ready ? ' ready' : ''}`,
          span('co-pname', pl.name),
          pl.host ? span('co-tag host', 'Host') : null,
          pl.id === lobby.you ? span('co-tag', 'You') : null,
          span('co-tag', pl.starter?.toUpperCase() ?? 'Mode default'),
          span('co-ready', pl.ready ? 'Ready' : 'Not ready'),
        ))),
    );
    this.modes.style.display = lobby.hosting ? '' : 'none';
    const ready = lobby.me?.ready === true;
    this.readyItem.el.querySelector('.mi-t')!.textContent = ready ? 'Ready: yes' : 'Ready: no';
    const atBottom = this.chatLog.scrollTop + this.chatLog.clientHeight >= this.chatLog.scrollHeight - 4;
    this.chatLog.replaceChildren(...lobby.chat.map(c => div(c.from === null ? 'co-line sys' : 'co-line', c.from ? span('co-from', `${c.from}: `) : null, c.text)));
    if (atBottom) this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  private async submit(): Promise<void> {
    if (this.lobby) return;
    const password = this.password.value;
    if (this.page === 'join') {
      const code = cleanCode(this.joinCode.value);
      if (!code) return this.fail(`A code is ${CODE_LENGTH} letters and digits, as the host's screen shows it.`);
      this.code = code;
    } else {
      this.code = newCode();
    }
    if (!password) return this.fail('Type a password first.');
    const hosting = this.page === 'host';
    // trystero is only fetched by someone who plays co-op.
    const { openLobby } = await import('../../net/trystero');
    const name = this.name.value.trim() || loadCallsign();
    const lobby = new Lobby(openLobby(this.code, password), hosting, name);
    const preference = starterPreference();
    if (preference) lobby.setStarter(preference);
    const cards = starterCards(preference, gun => { saveStarter(gun); lobby.setStarter(gun); });
    for (const card of cards) {
      card.el.addEventListener('click', card.activate!);
      card.el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); });
    }
    this.starter.replaceChildren(span('nt-k', 'Your starter · untouched uses the mode default'), ...cards.map(card => card.el));
    this.roomPassword = password;
    lobby.onMatch = match => {
      try { deployMatch(this.code, this.roomPassword, lobby, match); }
      catch {
        lobby.leave();
        this.lobby = null;
        this.go('start', 'Co-op needs tab storage to load the map. Enable session storage and host again.');
      }
    };
    lobby.onChange = () => (lobby.phase === 'closed' ? this.ended(lobby) : this.paintLobby());
    this.lobby = lobby;
    this.go('lobby');
  }

  private fail(message: string): void {
    this.ctx.audio.play?.('ui_error');
    this.message = message;
    this.paint();
  }

  /** The lobby ended under the player: back to where they can try again, with why. */
  private ended(lobby: Lobby): void {
    if (lobby !== this.lobby) return;
    this.lobby = null;
    const error = lobby.error;
    if (!error) return;
    this.ctx.audio.play?.('ui_error');
    const retry = error === 'password' || error === 'no-host' || error === 'connect';
    if (retry) this.joinCode.value = this.code;
    this.go(retry ? 'join' : 'start', errorText(error, lobby.theirBuild, this.code));
  }

  private leave(): void {
    this.lobby?.leave();
    this.lobby = null;
    this.roomPassword = '';
    this.go('start');
  }

  showMessage(message: string): void {
    this.go('start', message);
  }

  private async copy(): Promise<void> {
    const link = inviteLink(this.code);
    try {
      await navigator.clipboard.writeText(link);
      this.copied.textContent = 'Copied';
    } catch {
      // No clipboard (an insecure page, a refused permission): select it for Cmd+C.
      const range = document.createRange();
      range.selectNodeContents(this.lobbyPanel.querySelector('.co-link')!);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      this.copied.textContent = 'Press Cmd+C';
    }
  }
}

export function errorText(error: LobbyError, theirBuild: string, code: string): string {
  switch (error) {
    case 'password': return 'Wrong password. Check it with the host and try again.';
    case 'version': return `Your friend has a different version of the game (theirs ${theirBuild}, yours ${BUILD}). Both of you reload the page, then try again.`;
    case 'host-left': return 'The host left, so the lobby is closed.';
    case 'no-host': return `No lobby answered on code ${code}. Check the code and password with the host. If both are right, the host may have left, or one of your networks may need the relay server that is not set up yet.`;
    case 'connect': return 'Found the lobby, but could not connect to it. One of your networks needs the relay server that is not set up yet.';
    case 'full': return 'That lobby is full: four players.';
  }
}
