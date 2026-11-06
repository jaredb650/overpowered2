/** Game over: the full run report. Space runs it back and Esc leaves, as in the first game. */
import { Label, Shown, div, markup, span } from '../dom';
import type { WeaponId } from '../../core/gameplay';
import { PERKS, POWERUPS, WEAPONS } from '../data';
import type { Hud } from '../Hud';
import { weaponIcon } from '../icons';
import { Odometer } from '../hud/tally';
import type { Nav } from './nav';
import { menuButton } from './parts';
import { statRows } from './stats';
import type { Screen } from './Screens';

const name = (id: string): string =>
  PERKS[id as keyof typeof PERKS]?.name ?? POWERUPS[id as keyof typeof POWERUPS]?.name ?? id;

export class GameOverScreen implements Screen {
  readonly el: HTMLElement;
  private killedBy: Label;
  private record: Shown;
  private high: Label;
  private stats: HTMLElement;
  private weapons: HTMLElement;
  private perks: HTMLElement;
  private odo = new Odometer('odo-big');
  private items;
  private target = 0;

  constructor(private readonly hud: Hud) {
    this.items = [
      menuButton('Run again', () => this.hud.startRun()),
      menuButton('Menu', () => this.hud.quitToMenu()),
    ];
    const killedBy = span('go-by');
    const record = span('go-record', 'New high score');
    const high = span('go-high');
    this.stats = div('stats');
    this.weapons = div('go-weapons');
    this.perks = div('go-perks');
    this.el = div('scr scr-gameover',
      div('go-left',
        span('go-title', 'Run over'),
        killedBy,
        div('go-score', this.odo.el),
        div('go-marks', record, high),
        div('mm-list', ...this.items.map(i => i.el)),
      ),
      div('go-right',
        this.stats,
        div('go-col', span('go-h', 'Kills by weapon'), this.weapons),
        div('go-col', span('go-h', 'Perks earned'), this.perks),
      ),
    );
    this.killedBy = new Label(killedBy);
    this.record = new Shown(record, 'inline-block');
    this.high = new Label(high);
  }

  open(nav: Nav): void {
    nav.set(this.items);
    nav.back = () => this.hud.quitToMenu();
    nav.left = nav.right = null;

    const r = this.hud.report;
    this.killedBy.set(r.killedBy ? `Killed by ${this.hud.killerName(r.killedBy)}` : 'Killed');
    this.record.set(r.isHighScore);
    this.high.set(r.isHighScore ? `Old best ${r.highAtStart.toLocaleString('en-US')}` : `High score ${r.highAtStart.toLocaleString('en-US')}`);
    this.stats.replaceChildren(...statRows(r));

    const top = r.topWeapons(5);
    const max = top[0]?.[1] ?? 1;
    this.weapons.replaceChildren(...(top.length ? top.map(([source, kills]) => {
      const weapon = WEAPONS[source as WeaponId];
      const bar = div('go-wbar');
      bar.style.transform = `scaleX(${kills / max})`;
      return div('go-wrow',
        weapon ? markup(weaponIcon(source as WeaponId)) : div('go-noicon'),
        span('go-wname', weapon?.name ?? source),
        span('go-wn', String(kills)),
        div('go-wtrack', bar),
      );
    }) : [span('go-none', 'No kills.')]));

    const perks = [...r.perks.entries()].sort((a, b) => b[1] - a[1]);
    this.perks.replaceChildren(...(perks.length ? perks.map(([id, count]) =>
      div('go-prow', span('go-pname', name(id)), span('go-pn', `x${count}`)),
    ) : [span('go-none', 'None this run.')]));

    this.odo.snap(0);
    this.target = r.score;
    this.odo.set(this.target);
  }

  update(dt: number): void {
    this.odo.update(dt);
  }
}
