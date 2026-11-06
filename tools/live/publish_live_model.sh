#!/usr/bin/env bash
# Replace one folder of the live-model branch and keep the rest (the coarse run's live/ and each
# all-route case's folder are published by different jobs). Each publish is a single commit with
# no history, so the branch never grows; a lease keeps two jobs from overwriting each other.
#   publish_live_model.sh SOURCE_DIR FOLDER "commit message"
set -eu
src=$(cd "$1" && pwd); dest=$2; msg=$3
repo="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
for try in 1 2 3 4 5 6; do
  rm -rf "$RUNNER_TEMP/live-model" && mkdir -p "$RUNNER_TEMP/live-model" && cd "$RUNNER_TEMP/live-model"
  git init -q -b live-model
  lease=""
  if git fetch -q --depth 1 "$repo" live-model 2>/dev/null; then lease=$(git rev-parse FETCH_HEAD); git checkout -q FETCH_HEAD -- . ; fi
  rm -rf "./$dest" && mkdir -p "./$dest" && cp -r "$src"/. "./$dest"/
  git add -A && git commit -qm "$msg"
  if [ -n "$lease" ]; then
    git push -q --force-with-lease="live-model:$lease" "$repo" HEAD:live-model && exit 0
  else
    git push -q "$repo" HEAD:live-model && exit 0
  fi
  echo "live-model moved while publishing; retry $try"; sleep $((try * 7))
done
exit 1
