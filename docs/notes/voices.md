# Local voice generation (Breeze TTS 2)

Local neural TTS for NPC dialogue and trooper chatter, running on the dev machine's RTX 4090 via
[Breeze-TTS-2.cpp](https://github.com/HoppouAI/Breeze-TTS-2.cpp). Replaces ElevenLabs for local voice work (zero paid credits,
full voice cloning plus emotion/delivery direction).

> **Note:** Breeze TTS 2 weights are licensed for research / non-commercial use. Never touch the owner's ElevenLabs key or spend
> paid credits without explicit approval.

---

## Mission creation rule (check voices first)

Whenever you create or update a mission (`src/campaign/missions/*.lines.ts`) or add an NPC with spoken dialogue:

1. **Check saved voices** in `/home/jared/projects/breeze-tts-2/voices/` (or `curl -s http://127.0.0.1:8080/v1/voices`).
2. **If the NPC already has a saved voice** (for example `council`, `trooper1`, `trooper2`), generate their lines with Breeze TTS 2
   once the owner approves the script.
3. **If the NPC does NOT have a saved voice yet**, ask the owner directly:
   > *"Do you have a voice sample for `<NPC>` yet?"*
   - **If NO:** leave that NPC's lines unvoiced (dialogue box / subtitles only — write no `.mp3` files for them and leave their IDs
     out of `manifest.json`). The game automatically shows subtitles with no audio when a clip is missing, so we can come back and
     voice them later.
   - **If YES:** train/save the voice from the owner's sample using the steps below, generate 1–2 quick test clips for the owner to
     approve, and then generate the mission's voice lines with that saved voice.

---

## Installed setup & saved voices

| Item | Path / URL |
|---|---|
| Install dir | `/home/jared/projects/breeze-tts-2/` |
| Model (Q8_0, 3.57 GB) | `/home/jared/projects/breeze-tts-2/models/breeze-tts-2-q8_0.gguf` |
| Saved voices dir | `/home/jared/projects/breeze-tts-2/voices/` (`*.breeze`, ~11 KB each) |
| Server launcher | `breeze-serve` (`/home/jared/projects/breeze-tts-2/serve.sh`) |
| CLI binary | `breeze-cli` (`~/.local/bin/breeze-cli`) |
| HTTP API & Web UI | `http://127.0.0.1:8080/` (WebSocket on `8081`) |

Currently saved voices:

#### Core / existing game voices

| Voice ID (`voice_id`) | Character / role | Game file convention |
|---|---|---|
| `council` | Galactic Council / Office of Societal Compliance | `public/audio/voice/<line.id>.mp3` |
| `trooper1` | Garrison Trooper 1 (originally ElevenLabs `trooper2`) | `public/audio/chatter/<key>.t2.mp3` |
| `trooper2` | Garrison Trooper 2 (originally ElevenLabs `trooper3`) | `public/audio/chatter/<key>.t3.mp3` |

#### RESERVED — Survival Mode Enemy Ace Pilot Mini-Bosses
> **Do NOT use these voices for friendly wingmen, allied radio, or generic chatter.** They are reserved strictly as unique boss voices when enemy **F-22 Raptor Ace** mini-bosses spawn in Survival / Dogfight / Badlands (`ROLE_VOICE_POOLS.raptor` in `src/enemies/outpost/chatter/airRadio.ts`).

| Voice ID (`voice_id`) | Chatter suffix | Assigned In-Game NPCs | Personality / archetype | Notes |
|---|---|---|---|---|
| `pilot_manic_ace` | `.pmace` | **Enemy F-22 Raptor Ace** (Dogfight Waves 5/8/10+ & Badlands boss escorts) | Loose-cannon, slightly manic young male fighter ace | Cocky, wired, reckless mini-boss — **Ace only** |
| `pilot_surgical_ace` | `.psace` | **Enemy F-22 Raptor Ace** (Dogfight Waves 5/8/10+ & Badlands boss escorts) | Ice-cold, clinical female fighter ace | Calm, detached, surgical mini-boss — **Ace only** |

#### Pilots & Air Support

| Voice ID (`voice_id`) | Chatter suffix | Assigned In-Game NPCs | Personality / archetype | Notes |
|---|---|---|---|---|
| `pilot_serious_atc` | `.patc` | **Spectre AC-130 call-in**, **Allied Dogfight Wingman Lead** (`Viper 1`), **F/A-18E Hornet** | Serious, commanding ATC / military pilot | Cloned from owner's ElevenLabs Pilot 1 sample (`5.64 s`) — Viper Lead / AC-130 / serious flight radio |
| `pilot_airline_vet` | `.pvet` | **B-1 Lancer Heavy Bomber**, **A-10 Warthog CAS**, **F/A-18E Hornet** | Burned-out airline-captain veteran (deadpan baritone) | Treats flak & SAMs like mild turbulence |
| `pilot_gunship_cowboy` | `.pcow` | **Gunner Strike Chopper call-in**, **A-10 Warthog CAS**, **AV-8B Harrier**, **Enemy Attack Chopper** | Drawling Southern close-air-support pilot | Warthog / Gunner Strike / gunship CAS |
| `pilot_academy_rookie` | `.prook` | **Allied Dogfight Wingman 2** (`Sabre`), **AV-8B Harrier**, **F/A-18E Hornet** | Over-caffeinated young academy rookie | Fast, eager textbook callouts |

#### Tank Commanders

| Voice ID (`voice_id`) | Chatter suffix | Assigned In-Game NPCs | Personality / archetype | Notes |
|---|---|---|---|---|
| `tank_ironclad_sgt` | `.tsgt` | **Enemy Tank Commanders** (`GroundVehicle` tanks in Badlands/Endless) | Old-school gravelly veteran sergeant | Also a strong candidate for Captain Mercer (`crossfire.lines.ts`) or allied Aegis tank lead |
| `tank_smug_tactician` | `.tsmug` | **Enemy Tank Commanders** (`GroundVehicle` tanks in Badlands/Endless) | Crisp British armor tactician | Dry condescension — rival / enemy armor commander |
| `tank_metal_brawler` | `.tbrawl` | **Enemy Tank Commanders** (`GroundVehicle` tanks in Badlands/Endless) | Booming, gleeful heavy-metal brawler | Upbeat demolition tank commander |
| `tank_hulldown_perf` | `.thull` | **Enemy Tank Commanders** (`GroundVehicle` tanks in Badlands/Endless) | Tightly-wound female hull-down perfectionist | Clipped, tactical, obsessed with angles & maintenance budgets |

#### Troop Transport & Convoy Crews

| Voice ID (`voice_id`) | Chatter suffix | Assigned In-Game NPCs | Personality / archetype | Notes |
|---|---|---|---|---|
| `transport_union_driver` | `.tunion` | **Fast-Rope Assault Transport** (`FastRopeHeli`) | Clock-watching blue-collar union bus driver | Dropship insertion pilot (`Packmule 2-3` vibe) |
| `transport_hotdrop_surfer` | `.tsurf` | **Fast-Rope Assault Transport** (`FastRopeHeli`) | Laid-back West Coast surfer pilot | Valkyrie fast-rope / hot-drop pilot |
| `transport_crew_chief` | `.tchief` | **Door Gunners** (`EnemyDoorGunner`) & **Enemy Attack Choppers** (`EnemyChopper`) | Grizzled, raspy crew chief / door gunner | Punchy ramp & minigun callouts |
| `transport_convoy_trucker` | `.ttruck` | **Fast-Rope Assault Transport / Convoy Crews** (`FastRopeHeli`) | Friendly Midwestern convoy trucker | APC / Humvee / overland convoy & lift crew |

> **Speaker-slot note (`crossfire.lines.ts`):** Because `Speaker` in `src/enemies/commander/lines.ts` is a fixed union, `crossfire.lines.ts` reuses `governor` for **Colonel Darrow**, `harbourmaster` for **General Halvorsen**, and `marr` for **Captain Mercer**. Those are separate characters from Bank Run's Governor, Foreclosure's Harbourmaster, and Desert Raid's Sgt Marr — do **not** share voices across those missions by mistake. Colonel Darrow and General Halvorsen do not have saved voices yet.

Check if the server is running:

```sh
curl -s http://127.0.0.1:8080/v1/voices
```

If it is not running, start it in the background:

```sh
setsid nohup /home/jared/projects/breeze-tts-2/serve.sh > /home/jared/projects/breeze-tts-2/server.log 2>&1 < /dev/null &
```

---

## Training (saving) a new voice from a sample

1. **Copy (never move)** the owner's sample file into `/home/jared/projects/breeze-tts-2/refs/` (or keep a clean copy).
2. **Prepare an 8–15 s mono 24 kHz WAV** of clean speech (steady, clear delivery — avoid screaming, music, or heavy distortion).
   - If the owner gave one file, trim to a clean 8–15 s stretch:
     ```sh
     ffmpeg -y -i input_sample.mp3 -ss 0 -t 13 -ac 1 -ar 24000 -sample_fmt s16 /home/jared/projects/breeze-tts-2/refs/<name>_ref.wav
     ```
   - If combining 3–4 shorter lines, join them with 0.25 s silence gaps so total duration is ~10–14 s.
3. **Write the exact word-for-word transcript** of the reference WAV (punctuation and every word must match the audio — mismatches
   degrade clone fidelity).
4. **Encode and save the voice** (takes ~2 seconds on the RTX 4090):
   ```sh
   breeze-cli /home/jared/projects/breeze-tts-2/models/breeze-tts-2-q8_0.gguf \
     --voices-dir /home/jared/projects/breeze-tts-2/voices \
     --ref-audio /home/jared/projects/breeze-tts-2/refs/<name>_ref.wav \
     --ref-text "Exact word-for-word transcript of the reference clip." \
     --description "Character name and role in OVERPOWERED 2" \
     --save-voice <name>
   ```
5. **Restart `breeze-server`** so `/v1/voices` and the Web UI load the new `<name>.breeze` file (use exact `pkill -x`, never
   `pkill -f`):
   ```sh
   pkill -x breeze-server || true
   sleep 1
   setsid nohup /home/jared/projects/breeze-tts-2/serve.sh > /home/jared/projects/breeze-tts-2/server.log 2>&1 < /dev/null &
   ```
6. **Verify** with `curl -s http://127.0.0.1:8080/v1/voices` and generate 1–2 short preview WAVs before doing a full batch.

---

## Generating voice lines

Send a multipart `POST` to `http://127.0.0.1:8080/v1/audio/speech`. The response body is **raw 24 kHz mono signed 16-bit
little-endian PCM (`s16le`)**.

### Critical API rules

- Always pass **`voice_id=<name>`** — **never `voice=`** (unknown form fields are silently ignored and fall back to a random voice;
  a misspelled `voice_id` returns HTTP 404).
- Always pass **`text=<line>`** using `--form-string` in `curl` (so leading parentheses like `(sigh)` are not parsed as file paths).
- **Neutral voice clone:** `cfg_scale=1.0`, omit `instruction`. Closest match to the reference speaker's natural delivery.
- **Emotion / delivery steering (Voice Direction):** include `instruction="..."` and set `cfg_scale=2.0` to `2.8`. Going past
  `~3.0` can sound harsh.
- **Inline vocal events:** put `(laugh)`, `(sigh)`, `(cough)`, `(clears throat)`, `(whispering)`, `(gasp)`, or `(nervous chuckle)`
  directly inside `text` with `cfg_scale=2.0..2.8`.

### Example: generate one line and encode to game MP3

```sh
# 1. Generate raw 24 kHz s16le PCM from Breeze TTS 2
curl -sf -X POST http://127.0.0.1:8080/v1/audio/speech \
  --form-string "voice_id=council" \
  --form-string "text=(clears throat) Contractor. Your compliance score has been adjusted downward." \
  --form-string "instruction=Cold, clipped bureaucratic announcer, faintly smug" \
  --form-string "cfg_scale=2.5" \
  --output /tmp/line.pcm

# 2. Trim lead/tail silence, normalize to -18 LUFS, encode MP3
TRIM="silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03"
ffmpeg -v error -y -f s16le -ar 24000 -ac 1 -i /tmp/line.pcm \
  -af "${TRIM},areverse,${TRIM},areverse,loudnorm=I=-18:TP=-2:LRA=11" \
  -ac 1 -ar 24000 -c:a libmp3lame -b:a 64k \
  public/audio/voice/<line.id>.mp3
```

### Encoding & manifests by system

| System | Output directory | Bitrate | Manifest format |
|---|---|---|---|
| Campaign missions, Commander, Council (`src/campaign/missions/*.lines.ts`, `src/enemies/commander/lines.ts`) | `public/audio/voice/<id>.mp3` | 64–128 kbps mono (`libmp3lame`) | `public/audio/voice/manifest.json`: `{ "clips": ["id1", "id2", ...] }` (sorted, no `.mp3`) |
| Squad trooper chatter (`src/enemies/outpost/chatter/lines.json`) | `public/audio/chatter/<key>.{t2,t3}.mp3` | 32 kbps mono 24 kHz (`libmp3lame`) | `public/audio/chatter/manifest.json`: `{ "ext": "mp3", "clips": ["key.t2", "key.t3", ...] }` (sorted, no `.mp3`) |

Rebuild `public/audio/voice/manifest.json` after adding mission/commander clips:

```sh
node -e '
const fs = require("node:fs");
const dir = "public/audio/voice";
const clips = fs.readdirSync(dir).filter(f => f.endsWith(".mp3")).map(f => f.slice(0, -4)).sort();
fs.writeFileSync(`${dir}/manifest.json`, JSON.stringify({ clips }, null, 2) + "\n");
console.log(`wrote ${clips.length} clips`);
'
```

*(Never commit clips without updating the corresponding `manifest.json`, and run `npx vitest run src/audio/audio.test.ts` plus any
mission/voice tests to verify.)*

---

## Performance & batch concurrency (RTX 4090)

- **VRAM:** ~3.95 GB with `--parallel 4` (~16% of the RTX 4090's 24 GB) — lightweight enough to run alongside ComfyUI and Vite.
- **Speed:** ~3.9–4.9× real-time on a single stream; **~6.2× real-time** (~1.3 clips/s on short trooper lines) with 2 concurrent
  directed streams (`--parallel 4`).
- **CFG slot rule:** `cfg_scale=1.0` uses **1 slot** per stream; `cfg_scale > 1.0` (Voice Direction) uses **2 slots** per stream.
  If you exceed available slots, the server returns `409 {"error":"busy"}`.
  - Default `serve.sh` uses `--parallel 4` (up to 4 clone streams or 2 directed streams at once).
  - For large batch runs (hundreds of lines), restart with `--parallel 8` (up to 4 directed streams at once; retry on HTTP `409`
    with a short backoff).
