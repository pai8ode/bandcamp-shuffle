#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
plugin_dir="$HOME/.config/omarchy/plugins/pai.bandcamp-shuffle"

mkdir -p "$HOME/.local/bin" "$plugin_dir"
ln -sf "$here/bandcamp_shuffle.py" "$HOME/.local/bin/bandcamp-shuffle"
cp "$here"/widget/* "$plugin_dir/"
echo "Installed bandcamp-shuffle and $plugin_dir"
