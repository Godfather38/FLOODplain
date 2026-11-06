#!/usr/bin/env bash
# Publish only a completed, validated coarse run. The existing publisher replaces
# live/ alone and retains every high-resolution model folder.
set -euo pipefail
work=$1
out=$2
cycle=$3
if (cd "$work" && timeout 900 "$GITHUB_WORKSPACE/engine/sfincs" > solver.log 2>&1); then
  tail -5 "$work/solver.log"
else
  status=$?
  tail -5 "$work/solver.log" || true
  echo "::error::SFINCS solver failed or timed out (exit $status); previous model retained"
  exit "$status"
fi
rm -rf "$out"
python tools/live/run_live_sfincs.py export "$work" "$out"
cp "$work/live-case.json" "$out/"
python tools/live/verify_live_package.py "$out" "$cycle"
bash tools/live/publish_live_model.sh "$out" live "Live SFINCS run for HRRR $cycle"
