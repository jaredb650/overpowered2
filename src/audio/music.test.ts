/**
 * The playlist rules, and the two promises about what ships: the game's own soundtrack is in the repo and listed, and the
 * owner's placeholder songs can never be committed.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { displayTitle, mergeManifests, Playlist, sampleFile, sourceFor, type MusicTrack } from './playlist';

const root = resolve(__dirname, '../..');

/** A repeatable stand-in for Math.random. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const tracks = (originals: number, placeholders: number): MusicTrack[] => [
  ...Array.from({ length: originals }, (_, i) => ({ file: `audio/ost/menu/o${i}.mp3`, title: `Original ${i}`, original: true })),
  ...Array.from({ length: placeholders }, (_, i) => ({ file: `audio/music/menu/p${i}.mp3`, title: `Placeholder ${i}`, original: false })),
];

describe('mergeManifests', () => {
  const ost = { menu: [{ file: 'audio/ost/menu/a.mp3', title: 'A' }], easy: [], hard: [{ file: 'audio/ost/hard/h.mp3', title: 'H' }] };
  const local = { menu: [{ file: 'audio/music/menu/x.mp3', title: 'x_y' }], easy: [{ file: 'audio/music/easy/e.mp3', title: 'E' }], hard: [] };

  it('puts both sources in each list and marks which is which', () => {
    const lists = mergeManifests(ost, local);
    expect(lists.menu.map(t => [t.file, t.original])).toEqual([['audio/ost/menu/a.mp3', true], ['audio/music/menu/x.mp3', false]]);
    expect(lists.easy.map(t => t.original)).toEqual([false]);
    expect(lists.hard.map(t => t.original)).toEqual([true]);
    expect(lists.menu[1]!.title).toBe('x y');
  });

  it('is the originals alone on the public site, where the placeholder manifest is emptied', () => {
    const lists = mergeManifests(ost, { menu: [], easy: [], hard: [] });
    expect(lists.menu).toHaveLength(1);
    expect(lists.easy).toHaveLength(0);
    expect([...lists.menu, ...lists.easy, ...lists.hard].every(t => t.original)).toBe(true);
  });

  it('survives a missing or broken manifest on either side', () => {
    expect(mergeManifests(null, local).menu.map(t => t.original)).toEqual([false]);
    expect(mergeManifests(ost, null).menu.map(t => t.original)).toEqual([true]);
    expect(mergeManifests(undefined, 'nonsense').menu).toEqual([]);
    const odd = mergeManifests({ menu: [null, 3, { title: 'no file' }, { file: 'audio/ost/menu/b.mp3' }, { file: 'audio/ost/menu/b.mp3', title: 'again' }], easy: 'no' }, {});
    expect(odd.menu).toEqual([{ file: 'audio/ost/menu/b.mp3', title: 'b', original: true }]);
    expect(odd.easy).toEqual([]);
  });

  it('names one file to ask the server about, and none for an empty or broken manifest', () => {
    expect(sampleFile(local)).toBe('audio/music/menu/x.mp3');
    expect(sampleFile({ menu: [], easy: [], hard: [{ file: 'audio/music/hard/h.mp3' }] })).toBe('audio/music/hard/h.mp3');
    expect(sampleFile({ menu: [], easy: [], hard: [] })).toBeNull();
    expect(sampleFile(null)).toBeNull();
    expect(sampleFile({ menu: [{ title: 'no file' }] })).toBeNull();
  });

  it('cleans file-name titles', () => {
    expect(displayTitle('01-bad_boy__name-some_title')).toBe('01-bad boy name-some title');
  });
});

describe('Playlist', () => {
  it('takes turns between originals and placeholders, starting with an original', () => {
    const list = new Playlist(tracks(2, 13), seeded(1));
    const played = Array.from({ length: 12 }, () => list.next()!);
    expect(played.map(t => t.original)).toEqual([true, false, true, false, true, false, true, false, true, false, true, false]);
  });

  it('never plays a track twice in a row, whatever the sizes', () => {
    for (const [o, p] of [[2, 1], [1, 1], [2, 0], [0, 2], [3, 11], [1, 13], [2, 13], [5, 5]] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const list = new Playlist(tracks(o, p), seeded(seed));
        let last = '';
        for (let i = 0; i < 200; i++) {
          const t = list.next()!;
          expect(t.file, `${o}+${p} seed ${seed} draw ${i}`).not.toBe(last);
          last = t.file;
        }
      }
    }
  });

  it('plays every track of a source before repeating any of it', () => {
    const list = new Playlist(tracks(3, 11), seeded(7));
    const seenOriginal = new Set<string>();
    const seenPlaceholder = new Set<string>();
    for (let i = 0; i < 22; i++) {
      const t = list.next()!;
      (t.original ? seenOriginal : seenPlaceholder).add(t.file);
      if (i === 5) expect(seenOriginal.size).toBe(3);
    }
    expect(seenPlaceholder.size).toBe(11);
  });

  it('is a plain shuffle when only one source is there', () => {
    const list = new Playlist(tracks(4, 0), seeded(3));
    const first = new Set(Array.from({ length: 4 }, () => list.next()!.file));
    expect(first.size).toBe(4);
    const local = new Playlist(tracks(0, 5), seeded(3));
    expect(new Set(Array.from({ length: 5 }, () => local.next()!.file)).size).toBe(5);
  });

  it('gives null for an empty list, and the one track for a list of one', () => {
    expect(new Playlist([]).next()).toBeNull();
    const one = new Playlist(tracks(1, 0));
    expect(one.next()!.file).toBe(one.next()!.file);
  });

  it('stops offering a track that would not load', () => {
    const all = tracks(2, 3);
    const list = new Playlist(all, seeded(5));
    for (const t of all.filter(t => !t.original)) list.drop(t.file);
    expect(list.length).toBe(2);
    const played = Array.from({ length: 10 }, () => list.next()!);
    expect(played.every(t => t.original)).toBe(true);
    for (let i = 1; i < played.length; i++) expect(played[i]!.file).not.toBe(played[i - 1]!.file);
    list.drop(all[0]!.file);
    list.drop(all[1]!.file);
    expect(list.next()).toBeNull();
  });
});

describe('sourceFor', () => {
  it('plays a state from its own list when it has one', () => {
    const counts = { menu: 3, easy: 13, hard: 11 };
    expect(sourceFor('menu', counts)).toBe('menu');
    expect(sourceFor('easy', counts)).toBe('easy');
    expect(sourceFor('hard', counts)).toBe('hard');
  });
  it('borrows another list rather than playing nothing', () => {
    expect(sourceFor('easy', { menu: 2, easy: 0, hard: 0 })).toBe('menu');
    expect(sourceFor('hard', { menu: 2, easy: 1, hard: 0 })).toBe('easy');
    expect(sourceFor('easy', { menu: 2, easy: 0, hard: 1 })).toBe('hard');
    expect(sourceFor('menu', { menu: 0, easy: 1, hard: 1 })).toBe('easy');
    expect(sourceFor('menu', { menu: 0, easy: 0, hard: 0 })).toBeNull();
  });
});

describe('what ships', () => {
  const manifestPath = resolve(root, 'public/audio/ost/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, { file: string; title: string }[]>;

  it('lists only files that are in public/audio/ost, each small enough to stream at once', () => {
    const all = [...manifest.menu!, ...manifest.easy!, ...manifest.hard!];
    expect(manifest.menu!.length).toBeGreaterThanOrEqual(2);
    for (const entry of all) {
      expect(entry.file).toMatch(/^audio\/ost\/(menu|easy|hard)\/[a-z0-9-]+\.mp3$/);
      expect(entry.title.length).toBeGreaterThan(0);
      const path = resolve(root, 'public', entry.file);
      expect(existsSync(path), entry.file).toBe(true);
      expect(statSync(path).size, entry.file).toBeLessThan(3.7e6);
      expect(statSync(path).size, entry.file).toBeGreaterThan(5e5);
    }
    expect(new Set(all.map(e => e.file)).size).toBe(all.length);
  });

  it('keeps every list key, so the player never reads an undefined list', () => {
    expect(Object.keys(manifest).sort()).toEqual(['easy', 'hard', 'menu']);
  });

  it('ignores everything under public/audio/music except its manifest, and nothing under public/audio/ost', () => {
    const ignore = readFileSync(resolve(root, '.gitignore'), 'utf8').split('\n').map(l => l.trim());
    expect(ignore).toContain('public/audio/music/*');
    expect(ignore).toContain('!public/audio/music/manifest.json');
    expect(ignore.some(l => l.includes('audio/ost'))).toBe(false);
    let git = true;
    try {
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, stdio: 'pipe' });
    } catch {
      git = false;
    }
    if (!git) return;
    const ignored = (path: string): boolean => {
      try {
        execFileSync('git', ['check-ignore', '-q', path], { cwd: root, stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    };
    expect(ignored('public/audio/music/menu/anything.mp3')).toBe(true);
    expect(ignored('public/audio/music/easy/anything.mp3')).toBe(true);
    expect(ignored('public/audio/music/hard/anything.wav')).toBe(true);
    expect(ignored('public/audio/music/new-folder/anything.mp3')).toBe(true);
    expect(ignored('public/audio/ost/menu/anything.mp3')).toBe(false);
    expect(ignored('public/audio/ost/manifest.json')).toBe(false);
    const tracked = execFileSync('git', ['ls-files', 'public/audio/music'], { cwd: root }).toString().trim().split('\n').filter(Boolean);
    expect(tracked).toEqual(['public/audio/music/manifest.json']);
  });

  it('builds the public site with the placeholder list emptied and the soundtrack left alone', () => {
    const workflow = readFileSync(resolve(root, '.github/workflows/pages.yml'), 'utf8');
    expect(workflow).toContain(`echo '{"menu":[],"easy":[],"hard":[]}' > public/audio/music/manifest.json`);
    expect(workflow).not.toMatch(/>\s*public\/audio\/ost/);
    expect(workflow).not.toMatch(/rm[^\n]*audio\/ost/);
  });
});
