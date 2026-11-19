#!/usr/bin/env bash
# Links this repo's mods, layouts and keys.json into the Herdr app's home, so the app
# runs the files you commit here. An existing real file or folder is moved to
# <home>/.herdr-mods-backup/<date>/ first (outside mods/, so the app doesn't load it);
# a link that already points here is left alone.
set -euo pipefail

repo="$(cd "$(dirname "$0")" && pwd)"
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
stamp="$(date +%Y%m%d-%H%M%S)"

link() {
  local src="$1" dst="$2"
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then return; fi
  if [ -e "$dst" ] || [ -L "$dst" ]; then
    local aside="$home/.herdr-mods-backup/$stamp/${dst#"$home"/}"
    mkdir -p "$(dirname "$aside")"
    mv "$dst" "$aside"
    echo "moved aside: $aside"
  fi
  ln -s "$src" "$dst"
  echo "linked: $dst -> $src"
}

mkdir -p "$home/mods" "$home/layouts"
for mod in "$repo"/mods/*/; do
  mod="${mod%/}"
  link "$mod" "$home/mods/$(basename "$mod")"
done
for layout in "$repo"/layouts/*.json; do
  link "$layout" "$home/layouts/$(basename "$layout")"
done
link "$repo/keys.json" "$home/keys.json"

for mod in "$repo"/mods/*/; do
  herdr-app check "${mod%/}" || true
done
