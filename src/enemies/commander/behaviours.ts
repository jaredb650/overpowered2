/**
 * The one behaviour the Commander adds to a soldier: hold this pose and do nothing else, because being still is the trick. A hider, a
 * man playing dead, a wired casualty and a false surrender are all this, with the unit deciding when it ends.
 */
import type { Behaviour } from '../brain';
import { pose, soldierOf } from '../outpost/soldier';
import { unitOf } from './units';

/** Above orders and aid, and below what has actually happened to him. */
const SCORE = 5.6;

export const posted: Behaviour = {
  name: 'posted',
  score(e) {
    const s = soldierOf(e);
    return s && unitOf(s)?.pose ? SCORE : 0;
  },
  enter(e) {
    e.mode = 'hold';
    e.face = 'lock';
  },
  think(e) {
    const s = soldierOf(e);
    const wanted = s && unitOf(s)?.pose;
    if (wanted) pose(e, wanted);
  },
  exit(e) {
    pose(e, 'stand');
  },
};
