/**
 * Main menu, over the live flythrough. A tree, one level on screen at a time:
 *
 *   Play > Campaign > the missions, in order
 *        > Survival > a map > what plays on it
 *        > Multiplayer (coming soon, does nothing)
 *   Guide, Settings
 *
 * Esc, Backspace or Back goes up a level. A mission or mode shows the Council's notice for it while it has focus, and choosing
 * it plays it. One still shut can be read and not played.
 *
 * The Crucible's notice carries its rules: a button under it opens them, from any page, because they live in storage and Play
 * takes them to the Crucible's own page. Never from pause: a run keeps the rules it started with.
 */
import { storedRulesCustom } from '../../contracts/crucible';
import { CONTRACTS, COUNCIL_OFFICE, NOTICE_FOOTER, NOTICE_TITLE, type ContractDef } from '../../contracts/data';
import { readHighScore } from '../../contracts/scores';
import { ACTIVE, contractSearch } from '../../contracts/select';
import { isShut } from '../../contracts/unlocks';
import type { Ctx } from '../../core/contracts';
import type { MapId } from '../../world/map/maps';
import { div, h, span } from '../dom';
import type { Hud } from '../Hud';
import type { Nav, NavItem } from './nav';
import { menuButton, wordmark } from './parts';
import type { Screen } from './Screens';

/** The campaign's missions, in the order they are played. */
export const CAMPAIGN: readonly ContractDef[] = CONTRACTS.filter(c => c.mission);

/** Survival's maps, in menu order. "Outpost" is the fort, Outpost Defense's map: the owner's name for it. */
export const SURVIVAL_MAPS: readonly { name: string; map: MapId }[] = [
  { name: 'Crucible', map: 'crucible' },
  { name: 'Kill House', map: 'killhouse' },
  { name: 'Outpost', map: 'fort' },
];

/** The survival modes that play on a map: every contract there that is not a mission. */
export const modesOn = (map: MapId): ContractDef[] => CONTRACTS.filter(c => !c.mission && c.map === map);

const isCrucible = (contract: ContractDef | null): boolean => contract?.id === 'crucible';

interface Level {
  crumb: string;
  items: NavItem[];
  up: Level | null;
  /** The item focused when the player went down from here, to land on again coming back up. */
  at: number;
}

export class MainMenu implements Screen {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private crumb: HTMLElement;
  private brief: HTMLElement;
  private notice: HTMLElement;
  private rules: NavItem;
  private root: Level;
  private crucibleModes!: Level;
  private level: Level;
  /** Every mission, mode and map button, to grey the ones with nothing open each time the menu opens. */
  private playable: { item: NavItem; contracts: ContractDef[] }[] = [];
  private nav: Nav | null = null;
  /** Back from the rules screen, so focus lands where it left. */
  private fromRules = false;

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    this.rules = menuButton('Crucible rules', () => {
      this.fromRules = true;
      this.hud.screens.show('rules');
    });
    this.rules.el.classList.add('mi-small');
    this.rules.focused = () => this.show(CONTRACTS.find(isCrucible)!);

    this.root = this.makeLevel('', null, [
      [menuButton('Play', () => this.enter(play)), null],
      [menuButton('Guide', () => this.hud.screens.show('guide')), null],
      [menuButton('Settings', () => this.hud.screens.show('settings')), null],
    ]);
    const play: Level = this.makeLevel('Play', this.root, []);
    const campaign = this.makeLevel('Play / Campaign', play, CAMPAIGN.map((c, i) => [this.leaf(`${i + 1} ${c.name}`, c), c]));
    const survival = this.makeLevel('Play / Survival', play, []);
    const mapLevels: Level[] = [];
    for (const { name, map } of SURVIVAL_MAPS) {
      const modes = modesOn(map);
      const level = this.makeLevel(`Play / Survival / ${name}`, survival, modes.map(c => [this.leaf(c.name, c), c]));
      mapLevels.push(level);
      if (map === 'crucible') this.crucibleModes = level;
      const item = menuButton(name, () => this.enter(level));
      this.playable.push({ item, contracts: modes });
      this.addItem(survival, item, modes[0] ?? null);
    }
    const multiplayer = menuButton('Multiplayer', () => this.ctx.audio.play?.('ui_error'));
    multiplayer.el.classList.add('off');
    multiplayer.el.append(span('mi-soon', 'Coming soon'));
    for (const item of [menuButton('Campaign', () => this.enter(campaign)), menuButton('Survival', () => this.enter(survival)), multiplayer]) {
      this.addItem(play, item, null);
    }
    for (const level of [play, campaign, survival, ...mapLevels]) this.addItem(level, this.backButton(level), undefined);
    this.level = this.root;

    this.list = div('mm-list');
    this.crumb = div('mm-crumb');
    this.notice = div('nt');
    this.brief = div('mm-brief', this.notice, this.rules.el);
    this.el = div('scr scr-menu', this.crumb, this.list, this.brief, span('mm-sub', 'OVERDRIVE'), wordmark());
  }

  private makeLevel(crumb: string, up: Level | null, items: [NavItem, ContractDef | null][]): Level {
    const level: Level = { crumb, up, items: [], at: 0 };
    for (const [item, shows] of items) this.addItem(level, item, shows);
    return level;
  }

  /** Focus by keyboard or the mouse passing over shows the item's notice, or none. Undefined, as on Back, leaves the notice as it is. */
  private addItem(level: Level, item: NavItem, shows: ContractDef | null | undefined): void {
    if (shows !== undefined) {
      item.focused = () => this.show(shows);
      // pointermove, as Nav takes focus on it: a list redrawn under a resting mouse must not change the notice.
      item.el.addEventListener('pointermove', () => {
        if (this.level === level) this.show(shows);
      });
    }
    level.items.push(item);
  }

  private leaf(label: string, contract: ContractDef): NavItem {
    const item = menuButton(label, () => this.play(contract));
    this.playable.push({ item, contracts: [contract] });
    return item;
  }

  private backButton(level: Level): NavItem {
    const item = menuButton('Back', () => this.up(level));
    item.el.classList.add('mi-small');
    return item;
  }

  private up(level: Level): void {
    if (!level.up) return;
    this.level = level.up;
    this.paintLevel(level.up.at);
  }

  private enter(level: Level): void {
    this.level.at = this.nav?.index ?? 0;
    this.level = level;
    this.paintLevel(0);
  }

  /** The level's buttons, its crumb, and the notice of whatever has focus. Back is Esc everywhere but the root. */
  private paintLevel(index: number): void {
    const level = this.level;
    const items = [...level.items];
    if (level === this.crucibleModes) items.splice(1, 0, this.rules);
    this.list.replaceChildren(...level.items.map(i => i.el));
    this.crumb.textContent = level.crumb;
    this.crumb.style.display = level.crumb ? '' : 'none';
    this.rules.el.style.display = level === this.crucibleModes ? '' : 'none';
    const nav = this.nav;
    if (!nav) return;
    nav.set(items, index);
    nav.back = level.up ? () => this.up(level) : null;
    items[nav.index]?.focused?.();
  }

  /** The record of the contract on screen. The one in play may be ahead of what storage holds. */
  private highScore(contract: ContractDef): number {
    const live = this.ctx.progression.highScore;
    return contract === ACTIVE.def && typeof live === 'number' ? live : readHighScore(contract);
  }

  private show(contract: ContractDef | null): void {
    this.brief.style.display = contract ? '' : 'none';
    if (contract) this.paint(contract);
  }

  private paint(contract: ContractDef): void {
    const { briefing } = contract;
    const high = this.highScore(contract);
    this.notice.replaceChildren(
      span('nt-office', COUNCIL_OFFICE),
      div('nt-head', span('nt-title', NOTICE_TITLE), span('nt-ref', briefing.ref)),
      div('nt-subject', briefing.subject),
      ...briefing.body.map(text => h('p', 'nt-p', text)),
      div('nt-terms', ...briefing.terms.flatMap(([key, value]) => [span('nt-k', key), span('nt-v', value)])),
      div('nt-foot', NOTICE_FOOTER),
    );
    if (high > 0) this.notice.append(div('nt-high', span('nt-high-k', 'High score'), span('nt-high-v', high.toLocaleString('en-US'))));
    if (isCrucible(contract) && storedRulesCustom()) this.notice.append(div('nt-rules', 'Custom rules are on. Runs on them are unranked and set no record.'));
    if (isShut(contract)) this.notice.append(div('nt-lock', 'Locked. Finish the Campaign to open this account.'));
    else if (contract !== ACTIVE.def) this.notice.append(div('nt-move', 'Starting it reloads the page to reach this site.'));
  }

  /** A contract's map cannot be built under a running world, so another contract means another page load. */
  private play(contract: ContractDef): void {
    if (isShut(contract)) this.ctx.audio.play?.('ui_error');
    else if (contract === ACTIVE.def) this.hud.startRun();
    else location.search = contractSearch(contract.id, location.search);
  }

  open(nav: Nav): void {
    for (const { item, contracts } of this.playable) item.el.classList.toggle('off', contracts.every(isShut));
    this.nav = nav;
    nav.left = nav.right = null;
    this.root.at = 0;
    this.level = this.fromRules ? this.crucibleModes : this.root;
    this.paintLevel(this.fromRules ? 1 : 0);
    this.fromRules = false;
  }
}
