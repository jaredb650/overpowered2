// The Kill House proof sheet on real Rapier and the real Player, with no browser, for iterating on the layout:
//   nice -n 19 npx tsx tools/scripts/killhouse-headless.ts [fuzz seconds, default 240] [fuzz seed, default 7]
// Geometry and movement are the same code the game runs. Anything that needs a GPU still needs tools/shot.mjs.
import type { Ctx } from '../../src/core/contracts';
import { createHeadlessGame } from '../../src/player/testkit/headless';

const globals = globalThis as unknown as Record<string, unknown>;
globals.location = { search: '?map=killhouse' };
// Canvas painting only feeds textures and the minimap image, which nothing here looks at.
const paint: unknown = new Proxy({}, {
  get: (_, key) => (key === 'measureText' ? () => ({ width: 100 }) : () => undefined),
  set: () => true,
});
globals.document = { createElement: () => ({ getContext: () => paint, style: {}, width: 0, height: 0 }) };

const { World } = await import('../../src/world/World');
const { fuzzPlayer, sweepPlayer, verifyKillHouse } = await import('../../src/world/verify-killhouse');

const fuzzSeconds = Number(process.argv[2] ?? 240);
const fuzzSeed = Number(process.argv[3] ?? 7);
const game = await createHeadlessGame(() => {});
const world = new World(game.ctx);
(game.ctx as Ctx).world = world;
await world.build();
const physics = game.ctx.physics as never;
const rig = { player: game.player, input: game.input, step: () => game.frame(1 / 60) };

const report = { build: world.report, verify: verifyKillHouse(world, physics), sweep: sweepPlayer(world, physics, rig), fuzz: fuzzPlayer(world, physics, rig, fuzzSeconds, fuzzSeed) };
console.log(JSON.stringify(report));
