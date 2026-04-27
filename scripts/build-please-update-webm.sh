#!/usr/bin/env bash
# Generates the static "Please update your Lookout app" WebM that the server
# returns to legacy clients still requesting WebM (the post-WebM-removal
# backwards-compat path). Run when the message changes; commit the result.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/packages/server/public/please-update.webm"

# Pick a font that ships everywhere we run this (macOS dev + Linux CI).
FONT=""
for candidate in \
  "/System/Library/Fonts/Helvetica.ttc" \
  "/System/Library/Fonts/HelveticaNeue.ttc" \
  "/System/Library/Fonts/Supplemental/Arial.ttf" \
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" \
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"; do
  if [ -f "$candidate" ]; then FONT="$candidate"; break; fi
done
if [ -z "$FONT" ]; then
  echo "No usable font found — install DejaVu or run on macOS." >&2
  exit 1
fi

echo "Using font: $FONT"
echo "Writing to: $OUT"

mkdir -p "$(dirname "$OUT")"

# 6-second 1280x720 VP8 WebM with a centered upgrade message.
# Two-pass encode + remux so the WebM container has a valid Duration tag and
# Cues — without those, some WebKitGTK / GStreamer players refuse to start.
TMP="$(mktemp -t please-update-XXXX).webm"
trap 'rm -f "$TMP"' EXIT

ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "color=c=#0b0d12:s=1280x720:r=24" \
  -vf "drawtext=fontfile='$FONT':text='Please update your Lookout app':\
fontcolor=white:fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2-30,\
drawtext=fontfile='$FONT':text='This timelapse format can no longer be displayed.':\
fontcolor=#9aa0aa:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2+50" \
  -c:v libvpx -b:v 200k -crf 30 -pix_fmt yuv420p \
  -t 6 -f webm "$TMP"

# Remux to populate Duration + write Cues at the head — required for seekable
# playback in browser-grade WebM players.
ffmpeg -y -hide_banner -loglevel error \
  -i "$TMP" -c copy -cues_to_front 1 -f webm "$OUT"

ls -lh "$OUT"
ffprobe -v error -show_entries format=duration,bit_rate -of default=nw=1 "$OUT"
