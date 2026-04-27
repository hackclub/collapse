#!/usr/bin/env bash
# Reproduces the encode step from packages/worker/src/compile.ts on synthetic
# noise frames, so we can see whether libx264 or libvpx (VP8) is the bottleneck.
#
# Usage:  scripts/bench-compile.sh [workdir] [frame_count]
#         workdir defaults to a tmp dir; frame_count defaults to 300 (5 hours @ 1/min)
set -euo pipefail

WORK="${1:-$(mktemp -d -t compile-bench-XXXX)}"
FRAMES="${2:-300}"
W=1920
H=1080
SCALE="scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2"

mkdir -p "$WORK"
echo "workdir:    $WORK"
echo "frames:     $FRAMES @ ${W}x${H}"
echo "ffmpeg:     $(ffmpeg -version | head -1)"
echo "host:       $(uname -sm) / $(sysctl -n hw.ncpu 2>/dev/null || nproc) CPUs"
echo

INPUT="$WORK/%05d.jpg"
MP4="$WORK/timelapse.mp4"
WEBM="$WORK/timelapse.webm"
LOG="$WORK/bench.log"
: > "$LOG"

# ---- 1. Generate random-noise JPEGs ----
echo "==> generating $FRAMES noise frames"
{ time ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -i "color=s=${W}x${H}:r=1:d=${FRAMES}:c=gray,noise=alls=100:allf=t" \
    -qscale:v 2 \
    "$INPUT" ; } 2>&1 | tee -a "$LOG"
COUNT=$(ls "$WORK"/[0-9]*.jpg | wc -l | tr -d ' ')
SIZE=$(du -sh "$WORK" | awk '{print $1}')
echo "    wrote $COUNT frames, total $SIZE on disk"
echo

run_x264() {
  ffmpeg -y -hide_banner -loglevel error -stats \
    -framerate 1 -i "$INPUT" \
    -c:v libx264 -preset fast -crf 28 \
    -r 30 -pix_fmt yuv420p -movflags +faststart \
    -vf "$SCALE" "$@" "$MP4"
}

run_vpx() {
  ffmpeg -y -hide_banner -loglevel error -stats \
    -framerate 1 -i "$INPUT" \
    -c:v libvpx -crf 10 -b:v 1M \
    -r 30 -pix_fmt yuv420p \
    -vf "$SCALE" "$@" "$WEBM"
}

bench() {
  local label="$1"; shift
  echo "==> $label"
  { time "$@" ; } 2>&1 | tail -3 | tee -a "$LOG"
  echo
}

# ---- 2. Solo encodes, default threading (laptop = all cores) ----
bench "libx264  solo  (default threads — laptop)"     run_x264
bench "libvpx   solo  (default threads — laptop)"     run_vpx

# ---- 3. Solo encodes constrained to 2 threads (prod worker has 2 CPUs) ----
bench "libx264  solo  -threads 2  (prod-like)"        run_x264 -threads 2
bench "libvpx   solo  -threads 2  (prod-like)"        run_vpx  -threads 2

# ---- 4. Parallel — matches compile.ts exactly ----
echo "==> libx264 + libvpx PARALLEL  -threads 2 each  (prod compile.ts)"
{ time {
    run_x264 -threads 2 &
    PIDX=$!
    run_vpx  -threads 2 &
    PIDV=$!
    wait "$PIDX" "$PIDV"
} ; } 2>&1 | tail -3 | tee -a "$LOG"
echo

echo "==> outputs"
ls -lh "$MP4" "$WEBM" | awk '{print "    "$5"\t"$NF}'
echo
echo "log: $LOG"
echo "workdir: $WORK"
