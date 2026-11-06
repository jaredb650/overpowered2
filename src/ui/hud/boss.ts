/** Boss bar. Reads whichever live enemy is flagged a boss. Titan limbs are its phases, so they get pips. */
import type { GoreRegion } from '../../characters/rig';
import type { EnemyInstance } from '../../core/gameplay';
import { clamp, damp } from '../../core/math';
import { Flag, Label, Meter, Shown, div, span } from '../dom';
import { ENEMY_NAMES } from '../data';
import type { HudState } from '../state';

const LIMBS: readonly { label: string; regions: readonly GoreRegion[] }[] = [
  { label: 'L arm', regions: ['armL', 'forearmL'] },
  { label: 'R arm', regions: ['armR', 'forearmR'] },
  { label: 'L leg', regions: ['legL', 'shinL'] },
  { label: 'R leg', regions: ['legR', 'shinR'] },
];

export class BossBar {
  readonly el: HTMLElement;
  private name: Label;
  private fill: Meter;
  private lag: Meter;
  private armor: Meter;
  private visible: Shown;
  private limbsRow: Shown;
  private limbs: Flag[] = [];
  private lagValue = 1;
  private target: EnemyInstance | null = null;
  private clock = 0;

  constructor() {
    const name = span('bs-name');
    const fill = div('bs-fill');
    const lag = div('bs-lag');
    const armor = div('bs-armor');
    const limbs = div('bs-limbs');
    for (const limb of LIMBS) {
      const pip = span('bs-limb', limb.label);
      limbs.append(pip);
      this.limbs.push(new Flag(pip, 'gone'));
    }
    this.el = div('boss',
      div('bs-head', name, limbs),
      div('bs-bar', div('bs-back'), lag, fill, armor),
    );
    this.name = new Label(name);
    this.fill = new Meter(fill);
    this.lag = new Meter(lag);
    this.armor = new Meter(armor);
    this.visible = new Shown(this.el, 'block');
    this.limbsRow = new Shown(limbs, 'flex');
  }

  private pick(s: HudState): EnemyInstance | null {
    if (this.target?.alive && this.target.isBoss) return this.target;
    for (const e of s.enemies) if (e.isBoss && e.alive) return e;
    return null;
  }

  update(s: HudState, dt: number): void {
    const boss = this.pick(s);
    if (boss !== this.target) {
      this.target = boss;
      this.lagValue = 1;
      if (boss) {
        this.name.set(ENEMY_NAMES[boss.id] ?? boss.id);
        this.limbsRow.set(boss.id === 'titan');
      }
    }
    this.visible.set(boss !== null);
    if (!boss) return;

    const frac = clamp(boss.health / Math.max(1, boss.maxHealth));
    this.fill.set(frac);
    this.lagValue = frac >= this.lagValue ? frac : damp(this.lagValue, frac, 3.5, dt);
    this.lag.set(this.lagValue);
    this.armor.set(boss.armor / Math.max(1, boss.maxHealth));

    this.clock -= dt;
    if (this.clock > 0 || boss.id !== 'titan') return;
    this.clock = 0.15;
    const severed = boss.char?.severed;
    if (!severed?.has) return;
    for (let i = 0; i < LIMBS.length; i++) {
      const regions = LIMBS[i]!.regions;
      this.limbs[i]!.set(severed.has(regions[0]!) || severed.has(regions[1]!));
    }
  }

  reset(): void {
    this.target = null;
    this.visible.set(false);
  }
}
