#!/bin/bash
# Every picture of the gore update's index (tools/out/gore-update/LOOK.md), for one build: the four short scenes of
# tools/scripts/gore-look-scenes.mjs as contact sheets with their frames kept, and with FIGHT=1 the 30 s fight of
# tools/scripts/gore-look.mjs as a sheet and a video.
#
#   tools/scripts/gore-look-all.sh <port> <tag> <out dir> [extra URL parameters]
#   tools/scripts/gore-look-all.sh 5671 before tools/out/x            # an old build's server
#   tools/scripts/gore-look-all.sh 5670 on tools/out/x                # the update
#   tools/scripts/gore-look-all.sh 5670 off tools/out/x "flinch=0&clutch=0&..."   # its switches off (GC_OFF in gore-cost.mjs)
# SCENES="react gib" picks some. One browser run at a time; each takes one of the machine's slots.
set -u
port=$1; tag=$2; out=$3; extra=${4:-}
cd "$(dirname "$0")/../.."
url="/?contract=crucible&autostart=1"; [ -n "$extra" ] && url="$url&$extra"
mkdir -p "$out"
sheet() { # name script frames every pick crop [more args]
  local name=$1 script=$2 frames=$3 every=$4 pick=$5 crop=$6; shift 6
  local args=(--port "$port" --url "$url" --until "window.__op2?.game?.state==='playing'" --script "$script" --dpr 2 --w 1440 --h 900
    --frames "$frames" --every "$every" --pick "$pick" --cols 6 --tile 480 --timeout 2400 --out "$out/$name-$tag.png")
  [ -n "$crop" ] && args+=(--crop "$crop")
  # The short scenes keep their frames (the full-size stills are picked from them); the fight's 900 would be 4 GB.
  [ "$name" != fight ] && args+=(--keep)
  node tools/sheet.mjs "${args[@]}" "$@" > "$out/$name-$tag.json" 2> "$out/$name-$tag.log"
  echo "$(date +%H:%M:%S) $name-$tag $(grep -c '"name"' "$out/$name-$tag.json") frames, errors: $(node -e "const r=require('$out/$name-$tag.json');console.log(JSON.stringify(r.errors).slice(0,160))" 2>/dev/null)"
}
for scene in ${SCENES:-react gib fire wear}; do
  case $scene in
    react) LOOK_SCENE=react sheet react tools/scripts/gore-look-scenes.mjs 84 64 24 "330,210,780,490" ;;
    gib)   LOOK_SCENE=gib   sheet gib   tools/scripts/gore-look-scenes.mjs 64 48 24 "" ;;
    fire)  LOOK_SCENE=fire  sheet fire  tools/scripts/gore-look-scenes.mjs 72 160 24 "280,180,880,560" ;;
    wear)  LOOK_SCENE=wear  sheet wear  tools/scripts/gore-look-scenes.mjs 70 96 24 "430,120,580,660" ;;
  esac
done
if [ "${FIGHT:-0}" = 1 ]; then
  sheet fight tools/scripts/gore-look.mjs 900 33 30 "" --video "$out/fight-$tag.mp4"
fi
