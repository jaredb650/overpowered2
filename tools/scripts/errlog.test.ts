import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error standalone Node JavaScript reader
import { catalogTags } from './errlog.mjs';
it('reads every catalog fault tag, including numeric codes and either quote style', () => {
  const tags = catalogTags(readFileSync(new URL('../../src/core/errors.ts', import.meta.url), 'utf8'));
  expect(tags.ASSET_404).toBe('us');
  expect(tags.COOP_SAME_LAN_BLOCKED).toBe('network');
  expect(tags.UNCAUGHT_EXCEPTION).toBe('us');
  expect(catalogTags('  ASSET_404: ["A file can\'t be found.", \'us\'],')).toEqual({ ASSET_404: 'us' });
});
