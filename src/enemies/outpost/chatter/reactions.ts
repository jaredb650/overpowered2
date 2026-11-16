/**
 * Every hidden system gets a voice (docs/design/squad-comms.md, "Audio highlights every system"). The armour, wound and gore code
 * already raise events; this listens to them and has the man say what just happened to him, on top of the sound it already makes.
 * Nothing here changes what anyone does, and nothing reaches into the gore or damage code: if their events change, only this file
 * follows.
 *
 *   enemy:hit        armour 'stopped' -> plateHeld, 'broken' -> plateGone, through a plate or past it on AP -> pierced
 *   enemy:wounded    an artery (carotid, inner thigh) -> artery, the gut or pelvis -> gut
 *   enemy:severed    an arm or a leg, while he lives -> limbLost, with the `arm` or `leg` fact
 *   enemy:condition  downed -> downed
 */
import type { GoreRegion } from '../../../characters/rig';
import type { AiWorld } from '../../aiWorld';
import type { Comms } from '../comms';
import { soldierOf, type Soldier } from '../soldier';

const ARTERY = new Set(['carotid', 'innerThigh']);
const GUT = new Set(['gut', 'pelvis']);
const ARM: ReadonlySet<GoreRegion> = new Set<GoreRegion>(['armL', 'forearmL', 'armR', 'forearmR']);
const LEG: ReadonlySet<GoreRegion> = new Set<GoreRegion>(['legL', 'shinL', 'legR', 'shinR']);

export function listenForWounds(w: AiWorld, comms: Comms): void {
  const events = w.ctx.events;
  /** A man still able to talk about it. */
  const live = (e: object): Soldier | null => {
    const s = soldierOf(e);
    return s && s.e.alive && !s.surrendered ? s : null;
  };
  events.on('enemy:hit', ({ enemy, damage, result }) => {
    const s = live(enemy);
    if (!s || result.killed) return;
    const plated = s.e.plates.some(p => p.hp > 0);
    if (result.armour === 'stopped') comms.say('plateHeld', s);
    else if (result.armour === 'broken') comms.say('plateGone', s);
    else if (result.armour === 'through' || (plated && (damage.pierces || damage.armorPiercing || damage.load === 'ap') && result.dealt > 0)) comms.say('pierced', s);
  });
  events.on('enemy:wounded', ({ enemy, zone }) => {
    const s = live(enemy);
    if (!s) return;
    if (ARTERY.has(zone)) comms.say('artery', s);
    else if (GUT.has(zone)) comms.say('gut', s);
  });
  events.on('enemy:severed', ({ enemy, region }) => {
    const s = live(enemy);
    if (!s || !(ARM.has(region) || LEG.has(region))) return;
    comms.say('limbLost', s, null, { flags: { arm: ARM.has(region), leg: LEG.has(region) } });
  });
  events.on('enemy:condition', ({ enemy, condition }) => {
    const s = live(enemy);
    if (s && condition === 'downed') comms.say('downed', s);
  });
}
