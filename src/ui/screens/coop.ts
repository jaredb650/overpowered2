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
  type CoopMap, type CoopMode, type JoinStage, CODE_LENGTH, Lobby, MAX_PLAYERS, NAME_MAX, CHAT_MAX, cleanCode, inviteLink, loadCallsign, newCode, saveCallsign, type LobbyError,
} from '../../net/lobby';
import { div, h, span } from '../dom';
import { deployMatch } from '../../net/session';
import { turnConfigured } from '../../net/turn';
import type { Hud } from '../Hud';
import type { Nav, NavItem } from './nav';
import { menuButton } from './parts';
import type { Screen } from './Screens';
import '../css/coop.css';

/** The code an invite link carried, read once at load. */
export const INVITE: string = typeof location === 'undefined' ? '' : cleanCode(new URLSearchParams(location.search).get('join') ?? '');

/** What the host can start: a mode on its own map, or on a map it also plays on. */
const MODES: readonly { label: string; mode: CoopMode; map?: CoopMap }[] = [
  { label: 'The Crucible', mode: 'crucible' }, { label: 'Endless Humans', mode: 'outpost' }, { label: 'Outpost Defense', mode: 'defense' },
  { label: 'Crucible: Office', mode: 'crucible', map: 'office' }, { label: 'Humans: Office', mode: 'outpost', map: 'office' },
  { label: 'Mission 1: The Outpost', mode: 'campaign' }, { label: 'Mission 2: Foreclosure', mode: 'foreclosure' },
];
const NO_TURN = turnConfigured()
  ? 'If a friend cannot connect, the game falls back on its relay server (TURN) by itself.'
  : 'Some networks (strict routers, mobile data, some offices) cannot connect directly, and the relay server (TURN) that fixes that is not set up yet: docs/notes/coop.md says how.';
/** What each mode is like together, under the picker. */
const MODE_NOTE: Record<CoopMode, string> = {
  crucible: 'The Crucible together: the host runs the waves, each of you earns and spends your own credits at your own supply pod, and a downed friend can be revived with E. Everyone down ends the run.',
  outpost: 'Endless Humans together: squads, surrender and capture. Whoever takes a prisoner gets the bounty.',
  defense: 'Outpost Defense together: hold the fort. The host runs the waves, the garrison, the Barracks and the walls; each of you has your own loadout, credits, Armoury and Infirmary.',
  campaign: 'The Outpost together. The host runs the mission; everyone hears the Commander, rides the door guns in on the same Packmule, and goes back to the last checkpoint if all of you go down.',
  foreclosure: 'Foreclosure together. The host runs the mission and the Bailiffs; everyone rides and fights it, and goes back to the last checkpoint if all of you go down.',
};

/** What a guest's join is doing, on the status line until it is in. */
const STAGE: Record<JoinStage, string> = {
  relays: 'Contacting lobby servers…', looking: 'Looking for lobby…', connecting: 'Connecting to host…', version: 'Checking version…', joined: 'Joined',
};

/** Phones and touch-only tablets: no keyboard and mouse to play with, and too little memory for a map. */
export const PHONE = typeof navigator !== 'undefined' && typeof matchMedia === 'function'
  && (/Android|iPhone|iPod|Mobile/i.test(navigator.userAgent) || !matchMedia('(any-pointer: fine)').matches);
export const PHONE_TEXT = 'OVERPOWERED 2 needs a computer with keyboard and mouse.';

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
  private rejoinItem: NavItem;
  private modeNote = div('co-note', MODE_NOTE.crucible);
  /** Why the player is back on the lobby page after a match. */
  private lobbyNote = '';
  private noteEl = div('co-note co-back');
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
    this.el = div('scr scr-menu scr-coop', this.crumb, this.list, div('mm-brief co-brief', this.panel));
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

    // Refused while a guest is not ready; the lobby's chat line says who.
    this.startItem = menuButton('Start', () => this.lobby && !this.lobby.countdown(MODES[this.mode]!.mode, MODES[this.mode]!.map) && this.ctx.audio.play?.('ui_error'));
    this.rejoinItem = menuButton('Rejoin match', () => this.lobby?.away(true));
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
          this.modeNote.textContent = MODE_NOTE[MODES[i]!.mode];
        });
        return button;
      })),
      this.modeNote,
    );
    this.lobbyPanel = div('',
      span('nt-office', 'Co-op lobby'),
      div('nt-head', span('nt-title', 'Lobby'), this.status),
      div('co-invite',
        span('nt-k', 'Code'), span('co-code', ''),
        span('nt-k', 'Invite'), div('co-link-row', span('co-link', ''), copy, this.copied),
      ),
      this.noteEl,
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
      items = [...(this.lobby?.hosting ? [this.startItem] : []), ...(this.lobby?.awayFrom ? [this.rejoinItem] : []), this.readyItem, menuButton('Copy link', () => this.copy()), back('Leave', () => this.leave())];
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
    const message = this.message || (PHONE ? PHONE_TEXT : '');
    const err = message ? div('co-err', message) : '';
    const p = (text: string) => h('p', 'nt-p', text);
    if (this.page === 'start') {
      this.panel.replaceChildren(
        span('nt-office', 'Co-op'),
        div('nt-head', span('nt-title', 'Multiplayer')),
        p('Play with up to three friends, browser to browser. One of you hosts a lobby and picks a password. The others join with its code, or the invite link, and that password.'),
        p('The host picks the mode and starts it. Each of you keeps your own guns, credits and loot; enemies, waves and the bosses are shared.'),
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
    const trying = lobby.hosting ? lobby.trying : 0;
    const waiting = lobby.hosting ? lobby.notReady.length : 0;
    this.status.textContent = lobby.phase === 'connecting'
      ? STAGE[lobby.stage]
      : lobby.count ? `Starting in ${lobby.count}${lobby.hosting ? ' · Start again to cancel' : ''}`
      : lobby.awayFrom ? 'The match is still on · Rejoin match to go back'
      : lobby.hosting ? `Hosting · ${n} of ${MAX_PLAYERS}${n === 1 && !trying ? ' · Waiting for players…' : ''}${trying ? ` · ${trying} trying to connect` : ''}${waiting ? ` · ${waiting} not ready` : ''}`
      : `Connected · ${n} of ${MAX_PLAYERS}`;
    this.status.classList.toggle('co-wait', lobby.phase === 'connecting' || lobby.count > 0);
    this.startItem.el.querySelector('.mi-t')!.textContent = lobby.count ? `Cancel (${lobby.count})` : 'Start';
    this.players.replaceChildren(
      ...(lobby.phase === 'connecting'
        ? [div('co-note', 'Looking for the host. This can take up to half a minute.')]
        : lobby.players.map(pl => div(`co-player${pl.ready ? ' ready' : ''}`,
          span('co-pname', pl.name),
          pl.host ? span('co-tag host', 'Host') : null,
          pl.id === lobby.you ? span('co-tag', 'You') : null,
          span('co-tag', pl.starter?.toUpperCase() ?? 'Mode default'),
          pl.away ? span('co-tag', 'In lobby') : null,
          span('co-ping', pl.host ? '' : pl.ping === undefined ? '… ms' : `${pl.ping} ms`),
          span('co-ready', pl.ready ? 'Ready' : 'Not ready'),
        ))),
    );
    this.modes.style.display = lobby.hosting ? '' : 'none';
    this.noteEl.textContent = this.lobbyNote;
    this.noteEl.style.display = this.lobbyNote ? '' : 'none';
    const ready = lobby.me?.ready === true;
    this.readyItem.el.querySelector('.mi-t')!.textContent = ready ? 'Ready: yes' : 'Ready: no';
    const atBottom = this.chatLog.scrollTop + this.chatLog.clientHeight >= this.chatLog.scrollHeight - 4;
    this.chatLog.replaceChildren(...lobby.chat.map(c => div(c.from === null ? 'co-line sys' : 'co-line', c.from ? span('co-from', `${c.from}: `) : null, c.text)));
    if (atBottom) this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  private async submit(): Promise<void> {
    if (this.lobby) return;
    if (PHONE) return this.fail(`${PHONE_TEXT} Open the invite link on a computer.`);
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
    this.status.textContent = 'Connecting...';
    let rooms;
    try { rooms = await openLobby(this.code, password); }
    catch (error) {
      console.warn('[coop] Could not open the room', error);
      return this.fail('Could not start the connection. Check you are online, then try again.');
    }
    const lobby = new Lobby(rooms, hosting, name);
    this.attach(lobby, password);
  }

  /** Back from a match: the same room, the same players, on the lobby page. */
  adopt(lobby: Lobby, code: string, password: string, message = ''): void {
    if (lobby.phase === 'closed') return this.showMessage(message || 'The co-op room closed.');
    if (this.lobby !== lobby) this.lobby?.leave();
    this.code = code;
    this.attach(lobby, password);
    this.lobbyNote = message;
    this.paintLobby();
  }

  private attach(lobby: Lobby, password: string): void {
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
    lobby.onChange = () => {
      if (lobby.phase === 'closed') return this.ended(lobby);
      // The rejoin item comes and goes with the match the host still plays.
      if (this.page === 'lobby' && this.list.contains(this.rejoinItem.el) !== !!lobby.awayFrom) this.go('lobby');
      else this.paintLobby();
    };
    lobby.onEnd = () => {};
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
    const retry = error === 'password' || error === 'no-host' || error === 'connect' || error === 'relays' || error === 'lost';
    if (retry) this.joinCode.value = this.code;
    this.go(retry ? 'join' : 'start', errorText(error, lobby.theirBuild, this.code, lobby.connectAdvice));
  }

  private leave(): void {
    this.lobbyNote = '';
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

/** `advice`: with 'connect', what the failed connection's candidates say (ice.ts), in place of the generic network line. */
export function errorText(error: LobbyError, theirBuild: string, code: string, advice = ''): string {
  switch (error) {
    case 'password': return 'Wrong password. Check it with the host and try again.';
    case 'version': return `Version mismatch: the host has ${theirBuild}, you have ${BUILD}. Both of you hard reload (Ctrl+Shift+R, or Cmd+Shift+R on a Mac), then try again.`;
    case 'host-left': return 'The host left, so the lobby is closed.';
    case 'no-host': return `Lobby not found: nobody answered on code ${code}. Check the code and password with the host; an old invite link points at a lobby that has closed. If both are right, ${turnConfigured() ? 'the host may have left.' : "your networks may not be able to connect directly: set up TURN or try a different network."}`;
    case 'connect': return advice ? `Connecting to host failed. ${advice}` : turnConfigured()
      ? 'Connecting to host failed: found the lobby, but could not connect even through the relay server. Try a different network.'
      : "Connecting to host failed: couldn't reach the host directly, because your network or theirs blocks peer-to-peer (mobile data and strict routers do). It needs the relay server; host: see TURN setup in docs/notes/coop.md. Another network may work meanwhile.";
    case 'full': return 'That lobby is full: four players.';
    case 'relays': return 'Contacting lobby servers failed: could not reach any of the matchmaking relays. Check your internet connection (a VPN or firewall can block them), then try again.';
    case 'lost': return 'Lost the connection to the host: nothing heard for 20 seconds. Their game may have closed or their network dropped.';
    case 'code-taken': return 'That code was already in use by another lobby. Host again for a fresh code.';
  }
}
