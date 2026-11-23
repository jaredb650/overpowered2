/**
 * Main menu, over the live flythrough. A tree, one level on screen at a time:
 *
 *   Play > Campaign > the missions, in order
 *        > Training, the tutorial (docs/design/tutorial.md). A first launch's Play goes straight there; an invite link never does
 *        > Survival > a map > what plays on it
 *        > Multiplayer, the co-op lobby (coop.ts)
 *   Frame, the Distraint Frame's loadout (frameLoadout.ts)
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
import { ACTIVE, contractSearch, playsOn } from '../../contracts/select';
import { isShut, missionModsUnlocked, missionWins } from '../../contracts/unlocks';
import { isFirstLaunch, markPlayed } from '../../contracts/firstLaunch';
import { INVITE } from './coop';
import { hasStarter, selectedStarter, saveStarter, type StarterGun } from '../../contracts/starter';
import { starterCards, starterModConfig } from './starter';
import { WEAPONS } from '../../weapons/data';
import type { Ctx } from '../../core/contracts';
import type { MapId } from '../../world/map/maps';
import { div, h, span } from '../dom';
import type { Hud } from '../Hud';
import type { Nav, NavItem } from './nav';
import { menuButton, wordmark } from './parts';
import type { Screen } from './Screens';

/** The campaign's missions, in the order they are played. */
export const CAMPAIGN: readonly ContractDef[] = CONTRACTS.filter(c => c.mission && !c.training);

/** Retraining, the tutorial. */
export const TRAINING: ContractDef = CONTRACTS.find(c => c.training)!;

/** Survival's maps, in menu order. "Outpost" is the fort, Outpost Defense's map: the owner's name for it. */
export const SURVIVAL_MAPS: readonly { name: string; map: MapId }[] = [
  { name: 'Crucible', map: 'crucible' },
  { name: 'Kill House', map: 'killhouse' },
  { name: 'Rooftop', map: 'rooftop' },
  { name: 'Badlands', map: 'badlands' },
  { name: 'Outpost', map: 'fort' },
  { name: 'Office', map: 'office' },
];

/** The survival modes that play on a map: every contract there, or also there (`alsoOn`), that is not a mission. */
export const modesOn = (map: MapId): ContractDef[] => CONTRACTS.filter(c => !c.mission && playsOn(c, map));

/** A mode's name under a map: "The Crucible" is also a map, so its mode reads "Crucible mode" and never looks like a map. */
export const modeName = (c: ContractDef): string => `${c.id === 'crucible' ? 'Crucible' : c.name} mode`;

/** A contract on one of its maps: what a leaf of the tree plays. */
interface Mode { contract: ContractDef; map: MapId }
const mode = (contract: ContractDef, map: MapId = contract.map): Mode => ({ contract, map });
const here = (m: Mode): boolean => m.contract === ACTIVE.def && m.map === ACTIVE.map;

const isCrucible = (contract: ContractDef | null): boolean => contract?.id === 'crucible';

interface Level {
  crumb: string;
  items: NavItem[];
  header?: HTMLElement;
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
  private fromCoop = false;
  private playLevel!: Level;

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    this.rules = menuButton('Crucible rules', () => {
      this.fromRules = true;
      this.hud.screens.show('rules');
    });
    this.rules.el.classList.add('mi-small');
    this.rules.focused = () => this.show(mode(CONTRACTS.find(isCrucible)!));

    this.root = this.makeLevel('', null, [
      [menuButton('Play', () => (!INVITE && isFirstLaunch() ? this.play(mode(TRAINING)) : this.enter(play))), null],
      [menuButton('Frame', () => this.hud.screens.show('frame')), null],
      [menuButton('Guide', () => this.hud.screens.show('guide')), null],
      [menuButton('Settings', () => this.hud.screens.show('settings')), null],
    ]);
    const play: Level = this.makeLevel('Play', this.root, []);
    this.playLevel = play;
    const campaign = this.makeLevel('Play / Campaign', play, CAMPAIGN.map((c, i) => [this.leaf(`${i + 1} ${c.name}`, mode(c)), mode(c)]));
    const survival = this.makeLevel('Play / Survival', play, []);
    const mapLevels: Level[] = [];
    for (const { name, map } of SURVIVAL_MAPS) {
      const modes = modesOn(map);
      const level = this.makeLevel(`Play / Survival / ${name}`, survival, modes.map(c => [this.leaf(modeName(c), mode(c, map)), mode(c, map)]));
      mapLevels.push(level);
      if (map === 'crucible') this.crucibleModes = level;
      const item = menuButton(name, () => this.enter(level));
      this.playable.push({ item, contracts: modes });
      this.addItem(survival, item, modes[0] ? mode(modes[0], map) : null);
    }
    const multiplayer = menuButton('Multiplayer', () => this.hud.screens.show('coop'));
    for (const item of [menuButton('Campaign', () => this.enter(campaign)), menuButton('Survival', () => this.enter(survival)), multiplayer]) {
      this.addItem(play, item, null);
    }
    this.addItem(play, this.leaf('Training', mode(TRAINING)), mode(TRAINING));
    // Anything played at all is a returning player from then on (contracts/firstLaunch.ts).
    let played = false;
    ctx.events.on('game:state', e => {
      if (e.to !== 'playing' || played) return;
      played = true;
      markPlayed();
    });
    for (const level of [play, campaign, survival, ...mapLevels]) this.addItem(level, this.backButton(level), undefined);
    this.level = this.root;

    this.list = div('mm-list');
    this.crumb = div('mm-crumb');
    this.notice = div('nt');
    this.brief = div('mm-brief', this.notice, this.rules.el);
    this.el = div('scr scr-menu', this.crumb, this.list, this.brief, span('mm-sub', 'OVERDRIVE'), wordmark());
  }

  private makeLevel(crumb: string, up: Level | null, items: [NavItem, Mode | null][]): Level {
    const level: Level = { crumb, up, items: [], at: 0 };
    for (const [item, shows] of items) this.addItem(level, item, shows);
    return level;
  }

  /** Focus by keyboard or the mouse passing over shows the item's notice, or none. Undefined, as on Back, leaves the notice as it is. */
  private addItem(level: Level, item: NavItem, shows: Mode | null | undefined): void {
    if (shows !== undefined) {
      item.focused = () => this.show(shows);
      // pointermove, as Nav takes focus on it: a list redrawn under a resting mouse must not change the notice.
      item.el.addEventListener('pointermove', () => {
        if (this.level === level) this.show(shows);
      });
    }
    level.items.push(item);
  }

  private leaf(label: string, m: Mode): NavItem {
    const item = menuButton(label, () => this.play(m));
    this.playable.push({ item, contracts: [m.contract] });
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
    this.list.replaceChildren(...(level.header ? [level.header] : []), ...level.items.map(i => i.el));
    this.crumb.textContent = level.crumb;
    this.crumb.style.display = level.crumb ? '' : 'none';
    this.rules.el.style.display = level === this.crucibleModes ? '' : 'none';
    const nav = this.nav;
    if (!nav) return;
    nav.set(items, index);
    nav.back = level.up ? () => this.up(level) : null;
    items[nav.index]?.focused?.();
  }

  /** The record of the mode on screen. The one in play may be ahead of what storage holds. */
  private highScore(m: Mode): number {
    const live = this.ctx.progression.highScore;
    return here(m) && typeof live === 'number' ? live : readHighScore(m.contract, m.map);
  }

  private show(m: Mode | null): void {
    this.brief.style.display = m ? '' : 'none';
    if (m) this.paint(m);
  }

  private paint(m: Mode): void {
    const { contract } = m;
    const briefing = contract.alsoOn?.[m.map] ?? contract.briefing;
    const high = this.highScore(m);
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
    else if (!here(m)) this.notice.append(div('nt-move', 'Starting it reloads the page to reach this site.'));
  }

  /** A contract's map cannot be built under a running world, so another contract means another page load. */
  private play(m: Mode): void {
    const { contract, map } = m;
    if (isShut(contract)) this.ctx.audio.play?.('ui_error');
    else if (hasStarter(contract.id)) {
      let gun = selectedStarter(contract.id);
      const deploy = () => {
        saveStarter(gun);
        const params = new URLSearchParams(contractSearch(contract.id, location.search, map));
        params.set('starter', gun);
        location.search = params.toString();
      };
      const freeMods = Boolean(contract.mission && missionModsUnlocked(contract.id));
      const wins = freeMods ? missionWins(contract.id) : 0;
      const level = this.makeLevel(`${this.level.crumb} / Starter gun`, this.level, []);
      if (freeMods) {
        level.header = div('starter-unlock-note', `Mission cleared ${wins}× · pick a gun to configure free mods`);
        const openMods = (picked: StarterGun) => {
          gun = picked;
          saveStarter(gun);
          const cfg = starterModConfig(gun, wins);
          const modLevel = this.makeLevel(`${level.crumb} / ${WEAPONS[gun].name} mods`, level, []);
          modLevel.header = cfg.header;
          modLevel.items.push(...cfg.items, menuButton('Deploy', deploy), this.backButton(modLevel));
          this.enter(modLevel);
          this.paint(m);
        };
        const cards = starterCards(gun, openMods, { modsUnlocked: true });
        level.items.push(...cards, menuButton('Configure mods', () => openMods(gun)), menuButton('Deploy', deploy), this.backButton(level));
      } else {
        const cards = starterCards(gun, picked => { gun = picked; saveStarter(gun); });
        level.items.push(...cards, menuButton('Deploy', deploy), this.backButton(level));
      }
      this.enter(level);
      this.paint(m);
    }
    else if (here(m)) this.hud.startRun();
    else location.search = contractSearch(contract.id, location.search, map);
  }

  returnToPlay(): void { this.fromCoop = true; }

  open(nav: Nav): void {
    for (const { item, contracts } of this.playable) item.el.classList.toggle('off', contracts.every(isShut));
    this.nav = nav;
    nav.left = nav.right = null;
    this.root.at = 0;
    this.level = this.fromCoop ? this.playLevel : this.fromRules ? this.crucibleModes : this.root;
    this.paintLevel(this.fromRules ? 1 : 0);
    this.fromRules = false;
    this.fromCoop = false;
  }
}
