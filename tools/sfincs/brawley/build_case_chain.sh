#!/usr/bin/env bash
# Build the brawley-avra-west native case end to end from prepared components (no solver run).
# Usage (cwd = repo root): bash tools/sfincs/brawley/build_case_chain.sh <tag> <mesh-dir> <components-dir>
#   tag: suffix for .sfincs-runs folders and the packaged case, e.g. v1b
# Runs: subgrid parameters -> boundaries -> stage (NWM and observed inflow) -> rain -> package.
# Optional env (defaults reproduce the v1/v1b inputs):
#   TERRAIN_TAG  space-separated tags of .sfincs-runs/brawley-avra-west-terrain-1m-<tag> folders, each passed as
#                --extra-fine in order (later wins on a same-named window), default "v1"
#   CONTEXT_TAG  .sfincs-runs/brawley-avra-west-context-<tag>, default v1
#   RAIN_TAG     .sfincs-runs/brawley-avra-west-rainfall-<tag>, default v1
#   LABEL_TAG    use tools/sfincs/brawley/labels-<tag>-{nwm,observed-inflow}.json (default: the v1 label files)
# Domain v2: TERRAIN_TAG="v1 v2" CONTEXT_TAG=v2 RAIN_TAG=v2 bash tools/sfincs/brawley/build_case_chain.sh v2 \
#   .sfincs-runs/brawley-avra-west-mesh-v2 tools/sfincs/data/brawley-avra-west-v2/components
set -euo pipefail
TAG=$1; MESH=$2; COMP=$3
PY=${PY:-/h/AI/Projects/FloodPLAIN-sfincs/.venv/Scripts/python.exe}
export NUMBA_CACHE_DIR=${NUMBA_CACHE_DIR:-$PWD/.sfincs-runs/numba-cache}
R=.sfincs-runs; D=tools/sfincs/data/brawley-avra-west-v1
P=$R/brawley-avra-west-parameters-$TAG; B=$R/brawley-avra-west-boundaries-$TAG
CTX=$R/brawley-avra-west-context-${CONTEXT_TAG:-v1}; RAIN=$R/brawley-avra-west-rainfall-${RAIN_TAG:-v1}
FINE=(); for T in ${TERRAIN_TAG:-v1}; do FINE+=(--extra-fine "$R/brawley-avra-west-terrain-1m-$T"); done
for X in "$CTX" "$RAIN" "${FINE[@]/--extra-fine/}"; do [ -z "$X" ] || [ -d "$X" ] || { echo "missing input folder $X" >&2; exit 2; }; done
stamp() { date -u +%FT%TZ; }
step() { echo "== $(stamp) $1"; }
echo "inputs: mesh $MESH components $COMP context $CTX rain $RAIN fine ${FINE[*]}"
step "parameters"; t0=$(date +%s)
"$PY" -u tools/sfincs/prepare_route_case_parameters.py --mesh "$MESH/active-refinement-mesh.nc" \
  --context "$CTX" "${FINE[@]}" --output "$P"
echo "parameters seconds $(( $(date +%s) - t0 ))"
step "boundaries"
"$PY" -u tools/sfincs/prepare_route_case_boundaries.py --case-root "$COMP" --mesh "$MESH/active-refinement-mesh.nc" \
  --parameters "$P" --network "$COMP/brawley-avra-west-network.geojson" --output "$B"
for V in nwm observed; do
  C=$R/brawley-avra-west-case-$TAG-$V
  if [ $V = nwm ]; then H=$D/brawley-avra-west-history.json; F=$D/brawley-avra-west-forecast.json; L=tools/sfincs/brawley/labels${LABEL_TAG:+-$LABEL_TAG}-nwm.json; OUT=tools/sfincs/data/all-route-ready-v3/brawley-avra-west-native-case-$TAG
  else H=$D/brawley-avra-west-history-observed.json; F=$D/brawley-avra-west-forecast-observed.json; L=tools/sfincs/brawley/labels${LABEL_TAG:+-$LABEL_TAG}-observed-inflow.json; OUT=tools/sfincs/data/all-route-ready-v3/brawley-avra-west-native-case-$TAG-observed-inflow; fi
  step "stage $V"
  "$PY" -u tools/sfincs/stage_route_case_native.py --boundaries "$B" --parameters "$P" --history "$H" --forecast "$F" --output "$C"
  step "rain $V"
  "$PY" -u tools/sfincs/finish_route_case.py --case "$C" --rainfall "$RAIN" --domain "$COMP/active-domain.geojson"
  step "package $V"
  "$PY" -u tools/sfincs/package_route_case.py "$C" "$OUT" --labels "$L"
done
step "done"
