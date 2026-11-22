/** Unit tests for Old Mother's 3-phase boss state machine (Hunt -> Drag -> Seizing -> Deck -> Dead). */
import { describe, expect, it } from 'vitest';
import { CRAWLER, CrawlerState } from './crawler';

describe('CrawlerState (Old Mother)', () => {
  it('ignores damage while dormant and starts full speed in hunt', () => {
    const s = new CrawlerState();
    expect(s.hit('trackL', 500).dealt).toBe(0);
    s.phase = 'hunt';
    expect(s.tracksAlive).toBe(2);
    expect(s.speed).toBe(CRAWLER.speedFull);
    expect(s.barFraction()).toBe(1);
  });

  it('slows when one track breaks and enters drag phase when both tracks break', () => {
    const s = new CrawlerState();
    s.phase = 'hunt';

    const h1 = s.hit('trackL', CRAWLER.hp.trackL);
    expect(h1.broke).toBe(true);
    expect(h1.phaseChanged).toBeNull();
    expect(s.tracksAlive).toBe(1);
    expect(s.speed).toBe(CRAWLER.speedCrippled);

    const h2 = s.hit('trackR', CRAWLER.hp.trackR);
    expect(h2.broke).toBe(true);
    expect(h2.phaseChanged).toBe('drag');
    expect(s.phase).toBe('drag');
    expect(s.speed).toBe(0);
  });

  it('transitions from drag to seizing once all weapons are stripped or drag timeout elapses', () => {
    const s = new CrawlerState();
    s.phase = 'drag';
    s.hp.trackL = 0;
    s.hp.trackR = 0;

    s.hit('turretF', CRAWLER.hp.turretF);
    s.hit('turretA', CRAWLER.hp.turretA);
    expect(s.phase).toBe('drag');
    const last = s.hit('launcher', CRAWLER.hp.launcher);
    expect(last.phaseChanged).toBe('seizing');
    expect(s.phase).toBe('seizing');

    // Timeout path in drag
    const s2 = new CrawlerState();
    s2.phase = 'drag';
    expect(s2.tickDrag(10)).toBe(false);
    expect(s2.tickDrag(CRAWLER.dragMaxSeconds)).toBe(true);
    expect(s2.phase).toBe('seizing');
  });

  it('protects the stern engine until Phase 3 (deck), then dies when engine breaks', () => {
    const s = new CrawlerState();
    s.phase = 'hunt';
    expect(s.hit('engine', 500).dealt).toBe(0);

    s.phase = 'deck';
    expect(s.barFraction()).toBe(1);
    const partial = s.hit('engine', CRAWLER.hp.engine / 2);
    expect(partial.dealt).toBe(CRAWLER.hp.engine / 2);
    expect(partial.broke).toBe(false);
    expect(s.barFraction()).toBeCloseTo(0.5);

    const kill = s.hit('engine', CRAWLER.hp.engine);
    expect(kill.broke).toBe(true);
    expect(kill.phaseChanged).toBe('dead');
    expect(s.phase).toBe('dead');
    expect(s.barFraction()).toBe(0);
  });
});
