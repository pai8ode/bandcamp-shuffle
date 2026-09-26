#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
plugin_dir="$HOME/.config/omarchy/plugins/pai.bandcamp-shuffle"

mkdir -p "$HOME/.local/bin" "$plugin_dir"
ln -sf "$here/bandcamp_shuffle.py" "$HOME/.local/bin/bandcamp-shuffle"

changed=false
for file in "$here"/widget/*; do
  cmp -s "$file" "$plugin_dir/$(basename "$file")" || changed=true
done
cp "$here"/widget/* "$plugin_dir/"

# omarchy-shell notices edited plugin files but keeps the bar's existing widget
# instance, so new widget code only takes effect after a shell restart.
if $changed; then
  omarchy restart shell >/dev/null 2>&1
  echo "Installed bandcamp-shuffle; restarted omarchy-shell to load the new widget"
else
  echo "Installed bandcamp-shuffle (widget unchanged)"
fi
