// Steps shared by the world-b proofs (coop-worldb-*.mjs), on top of coop-kit.mjs.
import { lateGuest } from './coop-kit.mjs';

/** One more player into a match that is already running: the kit's `lateGuest`. */
export const lateJoin = lateGuest;

/** Waiting and agreeing, tolerant of a loaded machine. `check` is the kit's; `dump` is run on a page when a wait fails. */
export function waits({ check, sleep, dump }) {
  const until = async (page, fn, arg, what, timeout = 150000) => {
    try { await page.waitForFunction(fn, arg, { timeout }); } catch { check(false, what, dump ? await dump(page).catch(e => String(e)) : undefined); }
    check(true, what);
  };
  /** Waits until `read` (run on each page) gives the same answer on every page, and returns it. */
  const agree = async (pages, read, what, timeout = 60000) => {
    let last = [];
    for (const end = Date.now() + timeout; Date.now() < end;) {
      last = await Promise.all(pages.map(read));
      if (last.every(v => JSON.stringify(v) === JSON.stringify(last[0]))) { check(true, `${what}: every page agrees`); return last[0]; }
      await sleep(100);
    }
    check(false, `${what}: every page agrees`, last);
  };
  return { until, agree };
}

/** Turns a player to look at a point. */
export const lookAt = (page, at) => page.evaluate(at => {
  const { ctx } = window.__op2;
  const dx = at[0] - ctx.player.eye.x, dy = at[1] - ctx.player.eye.y, dz = at[2] - ctx.player.eye.z;
  ctx.player.yaw = Math.atan2(-dx, -dz); ctx.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}, at);
