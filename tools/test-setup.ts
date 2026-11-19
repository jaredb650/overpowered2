// Vitest setup (vite.config.ts `test.setupFiles`): the same random numbers every run.
//
// Game code draws from Math.random on purpose (a body's idle phase, a stumble's side, a wave's roster), so a test of real
// ragdolls or real animators used to check a different case every run, and a bound that holds for most cases failed now and
// then: gore/knockdown "goes down on its muscles, heading 0,1" one run in seven, alone, on an idle machine (measured over 150
// seeds: the bone shake across the switch is 0.034 m at the median and 0.070 at the worst, against a bound of 0.06).
//
// Here Math.random becomes a seeded generator, restarted before every test from the test's own full name, and before each
// file's top-level code from the file's path. So a test draws the same numbers whether it runs alone, in another order, or on a
// busy machine. A test that stubs Math.random itself is not affected: its stub replaces this one for as long as it stands.
//
//   OP2_TEST_SEED=<n>     another set of numbers (default 1). A test that fails for some n and not others has a bound tighter
//                         than the game's real spread: `for n in 1 2 3 4 5; do OP2_TEST_SEED=$n npx vitest run <file>; done`.
//   OP2_TEST_SEED=random  Math.random left alone, as before.
import { beforeEach, expect } from 'vitest';
import { mulberry32 } from '../src/core/math';

const asked = process.env.OP2_TEST_SEED ?? '1';

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

if (asked !== 'random') {
  const seed = Number(asked) >>> 0;
  // The path below the repository, so a second checkout draws the same numbers.
  const file = (expect.getState().testPath ?? '').replace(/^.*?\/(src|tools)\//, '$1/');
  Math.random = mulberry32(hash(file) ^ seed);
  beforeEach(() => {
    Math.random = mulberry32(hash(`${file} ${expect.getState().currentTestName ?? ''}`) ^ seed);
  });
}
