// Runs the movement bots on real Rapier in Node, for fast tuning: npx tsx tools/scripts/movement-headless.ts [bot...] [--fps 60]
import { BOTS } from '../../src/player/testkit/bots';
import { createHeadlessGame } from '../../src/player/testkit/headless';

const args = process.argv.slice(2);
const fpsAt = args.indexOf('--fps');
const fps = fpsAt >= 0 ? Number(args.splice(fpsAt, 2)[1]) : 60;
const names = args.length ? args : Object.keys(BOTS);
const game = await createHeadlessGame();
for (const name of names) {
  const metrics = game.run(BOTS[name]!, fps);
  console.log(`\n# ${name}`);
  for (const [k, v] of Object.entries(metrics)) console.log(`  ${k}: ${v}`);
}
