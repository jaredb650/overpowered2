import { errorPanel } from '../errorReport';
import { coopErrorCode, type ErrorCode } from '../../core/errors';
import { report, reportLobby, reportSolo } from '../../core/report';
/**
 * Play > Multiplayer: host or join a co-op lobby (src/net/). The main menu's look: the crumb, the list on the left, a
 * notice on the right. Four pages: start, host (pick a password), join (code and password), and the lobby itself.
 *
 * An invite link (`?join=CODE`) skips the splash and opens on a page that only asks for the password.
 * Stage 1 starts an enemy-free match on the host's selected map.
 */
import { STARTERS, defaultStarter, saveStarter, starterPreference } from '../../contracts/starter';
import { starterCards } from './starter';
import type { Ctx } from '../../core/contracts';
import {
  type CoopMap, type CoopMode, type JoinStage, type Match, CODE_LENGTH, Lobby, MAX_PLAYERS, NAME_MAX, CHAT_MAX, cleanCode, inviteLink, loadCallsign, newCode, saveCallsign,
} from '../../net/lobby';
import { errorText } from '../../net/lobbyText';
import type { Regroup } from '../../net';
import { div, h, span } from '../dom';
import { canDeploy, deployMatch } from '../../net/session';
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
  { label: 'Crucible mode', mode: 'crucible' }, { label: 'Endless Humans mode', mode: 'outpost' }, { label: 'Outpost Defense mode', mode: 'defense' },
  { label: 'Office — Crucible mode', mode: 'crucible', map: 'office' }, { label: 'Office — Endless Humans mode', mode: 'outpost', map: 'office' },
  { label: 'Mission 1: The Outpost', mode: 'campaign' }, { label: 'Mission 2: Foreclosure', mode: 'foreclosure' },
];
/** What each mode is like together, under the picker. */
const MODE_NOTE: Record<CoopMode, string> = {
  crucible: 'Crucible mode together: the host runs the waves, each of you earns and spends your own credits at your own supply pod, and a downed friend can be revived with E. Everyone down ends the run.',
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

/** Regrouping after a lost host: how long each player in the line waits for the one ahead of them to open the new lobby. */
const REGROUP_WAIT_MS = 14_000;
/** The ways a regrouping join can fail that mean "nobody is hosting": the next in line takes over. */
const NOBODY: readonly string[] = ['no-host', 'no-answer', 'connect', 'relays', 'host-left', 'lost'];

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
  private reportCode: ErrorCode | null = null;
  private invite = INVITE;
  /** A lobby is being opened (the awaits in `open`): a second press must not open another. */
  private busy = false;
  /** Meeting again after the host was lost: the plan, and whether this page has already taken its turn at hosting. */
  private regrouping: Regroup | null = null;
  private tookOver = false;
  /** On the join page from an invite link: the code is known, so the page asks only for the password. */
  private invited = false;
  private joinButton = h('button', 'co-copy co-join', 'Join lobby');
  /** What to do next: the host's who-is-not-ready line, or a guest's three steps. */
  private guide = div('co-guide');
  private forceItem: NavItem;
  /** Force start asks twice: the first press arms it until then. */
  private forceArmed = 0;
  /** Points at READY once a guest has picked a gun and not readied yet. */
  private callout = span('co-callout', 'Now press READY');
  private picked = false;

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
    this.forceItem = menuButton('Force start', () => this.force());
    this.readyItem = menuButton('READY', () => this.lobby?.setReady(!this.lobby.me?.ready));
    this.readyItem.el.classList.add('co-readybtn');
    this.callout.setAttribute('aria-hidden', 'true');
    this.readyItem.el.append(this.callout);
    this.joinButton.type = 'button';
    this.joinButton.addEventListener('click', () => this.submit());
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
        button.addEventListener('click', () => this.pickMode(i));
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
      this.guide,
      this.players,
      field('Your name', this.name),
      this.modes,
      this.starter,
      this.chatLog,
      this.chatInput,
    );
  }

  private pickMode(i: number): void {
    this.mode = i;
    this.modes.querySelectorAll('.co-mode').forEach((el, n) => el.classList.toggle('on', n === i));
    this.modeNote.textContent = MODE_NOTE[MODES[i]!.mode];
    this.lobby?.setPick(MODES[i]!.mode, MODES[i]!.map);
  }

  open(nav: Nav): void {
    this.nav = nav;
    nav.left = nav.right = null;
    // An invite link lands on the join page once; after that the menu opens on the start page like any other.
    if (this.invite) {
      this.joinCode.value = this.invite;
      this.invite = '';
      this.invited = true;
      // The code stays in the address until the lobby is joined, so a reload on this page still knows it (`attach`).
      this.go('join');
    } else {
      this.go(this.lobby ? 'lobby' : 'start');
    }
  }

  /** `message` is why the player landed here, when it was not their choice. */
  private go(page: Page, message = ''): void {
    this.page = page;
    this.message = message;
    if (!message) this.reportCode = null;
    if (page === 'start') this.invited = false;
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
      // The host does not ready up; Force start is there only while someone is not ready.
      const hosting = this.lobby?.hosting;
      items = [...(hosting ? [this.startItem, ...(this.lobby!.notReady.length ? [this.forceItem] : [])] : []), ...(this.lobby?.awayFrom ? [this.rejoinItem] : []),
        ...(hosting ? [] : [this.readyItem]), menuButton('Copy link', () => this.copy()), back('Leave', () => this.leave())];
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
    const err = message ? (this.reportCode ? errorPanel(this.reportCode, message) : div('co-err', message)) : '';
    const p = (text: string) => h('p', 'nt-p', text);
    if (this.page === 'start') {
      this.panel.replaceChildren(
        span('nt-office', 'Co-op'),
        div('nt-head', span('nt-title', 'Multiplayer')),
        p('Play with up to three friends, browser to browser. One of you hosts a lobby and picks a password. The others join with its code, or the invite link, and that password.'),
        p('The host picks the mode and starts it. Each of you keeps your own guns, credits and loot; enemies, waves and the bosses are shared.'),
        err,
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
    } else if (this.page === 'join' && this.invited) {
      this.panel.replaceChildren(
        span('nt-office', 'Co-op'),
        div('nt-head', span('nt-title', `Joining lobby ${this.joinCode.value}`)),
        p('Enter the password the host gave you, then press Join.'),
        field('Password', this.password),
        this.joinButton,
        err,
      );
    } else if (this.page === 'join') {
      this.panel.replaceChildren(
        span('nt-office', 'Co-op'),
        div('nt-head', span('nt-title', 'Join a lobby')),
        p('The host has the code and the password.'),
        field('Code', this.joinCode),
        field('Password', this.password),
        err,
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
    const slow = lobby.hosting && lobby.match ? lobby.slowToStart : [];
    this.status.textContent = lobby.phase === 'connecting'
      ? (this.regrouping ? `Regrouping · ${STAGE[lobby.stage]}` : STAGE[lobby.stage])
      : lobby.reconnecting ? `Reconnecting to host… ${lobby.reconnectIn}`
      : lobby.match && lobby.hosting ? (slow.length ? `Starting · waiting for ${slow.map(p => p.name).join(', ')}` : 'Starting…')
      : lobby.count ? `Starting in ${lobby.count}${lobby.hosting ? ' · Start again to cancel' : ''}`
      : lobby.awayFrom ? 'The match is still on · Rejoin match to go back'
      : lobby.hosting ? `Hosting · ${n} of ${MAX_PLAYERS}${trying ? ` · ${trying} trying to connect` : ''}`
      : `Connected · ${n} of ${MAX_PLAYERS}`;
    this.status.classList.toggle('co-wait', lobby.phase === 'connecting' || lobby.count > 0 || !!lobby.reconnecting);
    this.startItem.el.querySelector('.mi-t')!.textContent = lobby.count ? `Cancel (${lobby.count})` : 'Start';
    this.startItem.el.classList.toggle('off', !lobby.count && waiting > 0);
    this.forceItem.el.querySelector('.mi-t')!.textContent = performance.now() < this.forceArmed ? 'Sure? Click again' : 'Force start';
    const pick = MODES.find(m => m.mode === lobby.pick.mode && m.map === lobby.pick.map)?.label ?? '';
    const ready = lobby.me?.ready === true;
    const step = (text: string, state: string) => span(`co-step ${state}`, text);
    const arrow = () => span('co-arrow', '→');
    this.guide.style.display = lobby.phase === 'open' && !lobby.count && !lobby.awayFrom ? '' : 'none';
    if (lobby.hosting) {
      this.guide.replaceChildren(n === 1 ? 'Waiting for players. Send them the invite link (it opens straight on this lobby, also for someone new to the game) and tell them the password.'
        : waiting ? `Waiting for ${lobby.notReady.map(p => p.name).join(', ')} to ready up. Start unlocks when everyone is ready, or use Force start.`
        : 'Everyone is ready. Press Start.');
    } else {
      this.guide.replaceChildren(step('1. Pick your weapon (optional)', ready ? 'done' : ''), arrow(), step('2. Press READY', ready ? 'done' : 'now'), arrow(),
        step(`3. The host starts the match${pick ? `: ${pick}` : ''}`, ready ? 'now' : ''));
    }
    // An untouched pick is the mode's gun, which the host's mode decides (startMatch).
    const mine = lobby.starter ?? defaultStarter(lobby.pick.mode);
    this.starter.querySelectorAll('.starter-card').forEach((el, i) => {
      el.classList.toggle('selected', STARTERS[i] === mine);
      el.setAttribute('aria-pressed', String(STARTERS[i] === mine));
    });
    this.players.replaceChildren(
      ...(lobby.phase === 'connecting'
        ? [div('co-note', this.regrouping ? `The host was lost. Looking for ${this.regrouping.names[0] ?? 'a teammate'}'s new lobby on the same code…` : 'Looking for the host. This can take up to half a minute.')]
        : lobby.players.map(pl => div(`co-player${pl.ready ? ' ready' : ''}`,
          span('co-pname', pl.name),
          pl.host ? span('co-tag host', 'Host') : null,
          pl.id === lobby.you ? span('co-tag', 'You') : null,
          span('co-tag', (pl.starter ?? defaultStarter(lobby.pick.mode)).toUpperCase()),
          pl.state === 'lost' ? span('co-tag', 'Reconnecting') : pl.state ? span('co-tag', 'Loading') : pl.away ? span('co-tag', 'In lobby') : null,
          span('co-ping', pl.host || pl.state === 'lost' ? '' : pl.ping === undefined ? '… ms' : `${pl.ping} ms`),
          span('co-ready', pl.host ? 'Starts the match' : pl.state === 'lost' ? 'LOST CONNECTION' : pl.ready ? '✓ READY' : 'NOT READY'),
        ))),
    );
    this.modes.style.display = lobby.hosting ? '' : 'none';
    this.noteEl.textContent = this.lobbyNote;
    this.noteEl.style.display = this.lobbyNote ? '' : 'none';
    this.readyItem.el.querySelector('.mi-t')!.textContent = ready ? 'Cancel ready' : 'READY';
    this.readyItem.el.classList.toggle('on', ready);
    this.callout.style.display = this.picked && !ready && lobby.phase === 'open' && !lobby.count ? '' : 'none';
    const atBottom = this.chatLog.scrollTop + this.chatLog.clientHeight >= this.chatLog.scrollHeight - 4;
    this.chatLog.replaceChildren(...lobby.chat.map(c => div(c.from === null ? 'co-line sys' : 'co-line', c.from ? span('co-from', `${c.from}: `) : null, c.text)));
    if (atBottom) this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  private async submit(): Promise<void> {
    // Enter in the password field, the menu item and the button all land here: one lobby however many presses.
    if (this.lobby || this.busy) return;
    this.reportCode = null;
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
    this.regrouping = null;
    await this.openRoom(this.page === 'host', password);
  }

  /** Opens the lobby on `this.code`, as host or guest. One at a time (`busy`), with the buttons greyed meanwhile. */
  private async openRoom(hosting: boolean, password: string, hostWait?: number): Promise<void> {
    if (this.lobby || this.busy) return;
    this.busy = true;
    this.joinButton.disabled = true;
    this.list.classList.add('co-busy');
    try {
      await reportLobby(this.code, hosting ? 'host' : 'guest');
      report('COOP_ATTEMPT', { stage: this.regrouping ? 'regroup' : hosting ? 'host' : 'join' });
      // trystero is only fetched by someone who plays co-op.
      const name = this.name.value.trim() || loadCallsign();
      this.status.textContent = 'Connecting...';
      let rooms;
      try {
        const { openLobby } = await import('../../net/trystero');
        rooms = await openLobby(this.code, password);
      } catch (error) {
        report('COOP_RELAYS_UNREACHABLE', { error, stage: 'open-room' });
        this.reportCode = 'COOP_RELAYS_UNREACHABLE';
        this.regrouping = null;
        return this.fail('Could not start the connection. Check you are online, then try again.');
      }
      this.attach(new Lobby(rooms, hosting, name, undefined, hostWait ? { hostWait } : {}), password);
    } finally {
      this.busy = false;
      this.joinButton.disabled = false;
      this.list.classList.remove('co-busy');
    }
  }

  /** Back from a match: the same room, the same players, on the lobby page. `played`: the match just played, which the picker stays on. */
  adopt(lobby: Lobby, code: string, password: string, message = '', played?: Match): void {
    if (lobby.phase === 'closed') return this.showMessage(message || 'The co-op room closed.');
    if (this.lobby !== lobby) this.lobby?.leave();
    this.code = code;
    const mode = played ? MODES.findIndex(m => m.mode === played.mode && m.map === played.map) : -1;
    if (mode >= 0) this.pickMode(mode);
    this.attach(lobby, password);
    this.lobbyNote = message;
    this.paintLobby();
  }

  /**
   * The host is gone for good (its tab closed, its network died past the reconnect grace). There is no host migration:
   * the world lived on that page. So everyone left meets again in a new lobby on the same code and password. The first in
   * the line (lowest slot) hosts; the others join it, and each takes over in turn if nobody ahead of them shows up.
   */
  regroup(plan: Regroup): void {
    if (this.lobby || this.busy) return;
    this.regrouping = plan;
    this.tookOver = plan.rank === 0;
    this.code = plan.code;
    this.lobbyNote = plan.note;
    // Everyone comes back under the callsign they had in the room.
    if (plan.name) this.name.value = plan.name;
    console.info(`[coop] Regrouping on the same code: ${plan.rank === 0 ? 'hosting' : `joining ${plan.names[0] ?? 'the new host'}`}.`);
    void this.openRoom(plan.rank === 0, plan.password, plan.rank === 0 ? undefined : REGROUP_WAIT_MS * plan.rank);
  }

  private attach(lobby: Lobby, password: string): void {
    const preference = starterPreference();
    if (preference) lobby.setStarter(preference);
    this.picked = false;
    const cards = starterCards(preference, gun => { saveStarter(gun); lobby.setStarter(gun); this.picked = true; this.paintLobby(); });
    for (const card of cards) {
      card.el.addEventListener('click', card.activate!);
      card.el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); });
    }
    this.starter.replaceChildren(span('nt-k', 'Your weapon · already picked for you, change it if you like'), ...cards.map(card => card.el));
    if (lobby.hosting) lobby.setPick(MODES[this.mode]!.mode, MODES[this.mode]!.map);
    this.roomPassword = password;
    // Joined: the invite code has done its work. Only it goes; the rest of the address stays.
    const query = new URLSearchParams(location.search);
    if (query.has('join')) {
      query.delete('join');
      history.replaceState(null, '', `${location.pathname}${query.size ? `?${query}` : ''}`);
    }
    // Asked before any guest is sent off to load a map this page could not follow them to.
    lobby.canStart = canDeploy;
    lobby.onMatch = match => {
      try { deployMatch(this.code, this.roomPassword, lobby, match); }
      catch {
        lobby.leave();
        this.lobby = null;
        this.go('start', 'Co-op needs tab storage to load the map. Allow site data for this page and join again.');
      }
    };
    lobby.onChange = () => {
      if (lobby.phase === 'closed') return this.ended(lobby);
      // The rejoin item comes and goes with the match the host still plays, and Force start with whoever is not ready.
      if (this.page === 'lobby' && (this.list.contains(this.rejoinItem.el) !== !!lobby.awayFrom
        || (lobby.hosting && this.list.contains(this.forceItem.el) !== lobby.notReady.length > 0))) this.go('lobby');
      else this.paintLobby();
    };
    lobby.onEnd = () => {};
    this.lobby = lobby;
    this.go('lobby');
  }

  /** Host: pulls everyone in as they are. The first press only arms it. */
  private force(): void {
    const lobby = this.lobby;
    if (!lobby) return;
    if (performance.now() >= this.forceArmed) {
      this.forceArmed = performance.now() + 4000;
      setTimeout(() => this.paintLobby(), 4100);
      return this.paintLobby();
    }
    this.forceArmed = 0;
    lobby.forceStart(MODES[this.mode]!.mode, MODES[this.mode]!.map);
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
    const plan = this.regrouping;
    // Regrouping, and the lobby this page joined never appeared (or went again): its turn to host. And a page that hosted
    // only to find someone already hosting on the code joins them.
    if (plan && !this.tookOver && NOBODY.includes(error)) {
      this.tookOver = true;
      this.lobbyNote = 'The host was lost, and nobody ahead of you came back. You are hosting this lobby now.';
      return void this.openRoom(true, plan.password);
    }
    if (plan && error === 'code-taken') {
      this.regrouping = { ...plan, rank: 1 };
      this.lobbyNote = 'The host was lost. A teammate is hosting this lobby now.';
      return void this.openRoom(false, plan.password);
    }
    // The host of a lobby this page was in is gone for good: meet again on the same code.
    if ((error === 'host-left' || error === 'lost') && lobby.players.length > 1 && this.roomPassword) {
      const { rank, names } = lobby.successors();
      const lead = error === 'lost' ? 'Lost the connection to the host.' : 'The host left.';
      this.go('start');
      return this.regroup({ code: this.code, password: this.roomPassword, rank, names, name: lobby.me?.name,
        note: rank === 0 ? `${lead} You are hosting this lobby now${names.length > 1 ? '; the others are rejoining' : ''}.` : `${lead} ${names[0] ?? 'A teammate'} is hosting now.` });
    }
    this.regrouping = null;
    this.reportCode = coopErrorCode(error, /same network/i.test(lobby.connectAdvice), turnConfigured());
    this.ctx.audio.play?.('ui_error');
    const retry = error === 'password' || error === 'no-host' || error === 'no-answer' || error === 'connect' || error === 'relays' || error === 'lost';
    if (retry) this.joinCode.value = this.code;
    this.go(retry ? 'join' : 'start', errorText(error, lobby.theirBuild, this.code, lobby.connectAdvice));
  }

  private leave(): void {
    this.lobbyNote = '';
    this.regrouping = null;
    this.lobby?.leave();
    this.lobby = null;
    this.roomPassword = '';
    reportSolo();
    this.go('start');
  }

  showMessage(message: string): void {
    this.reportCode = /host left/i.test(message) ? 'COOP_HOST_LEFT' : /kick|removed/i.test(message) ? 'COOP_KICKED' : /out of sync|desync/i.test(message) ? 'COOP_DESYNC' : 'COOP_DISCONNECTED';
    if (this.reportCode === 'COOP_KICKED' || this.reportCode === 'COOP_DESYNC') report(this.reportCode, { stage: 'room-ended' });
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

export { errorText };
