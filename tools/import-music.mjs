// Copies the original soundtrack into public/audio/music with URL-safe names.
// WAV and FLAC masters are re-encoded to 256k MP3 so the game streams them; MP3s are copied as-is.
import { execFileSync } from 'node:child_process';
import { readdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
const src = process.argv[2], out = process.argv[3];
const slug = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const manifest = { menu: [], easy: [], hard: [] };
for (const [folder, key] of [['menu', 'menu'], ['easy', 'easy'], ['Hard', 'hard']]) {
  for (const f of readdirSync(join(src, folder))) {
    const ext = extname(f).toLowerCase();
    if (!['.mp3', '.wav', '.flac'].includes(ext)) continue;
    const name = slug(basename(f, extname(f))) + '.mp3';
    const dest = join(out, key, name);
    if (!existsSync(dest)) {
      if (ext === '.mp3') copyFileSync(join(src, folder, f), dest);
      else execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-threads', '2', '-i', join(src, folder, f), '-map_metadata', '-1', '-vn', '-c:a', 'libmp3lame', '-b:a', '256k', dest]);
    }
    manifest[key].push({ file: `audio/music/${key}/${name}`, title: basename(f, extname(f)) });
    console.log(key, name);
  }
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
