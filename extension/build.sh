#!/usr/bin/env bash
# Assemble dist/<browser>/ from the shared sources plus <browser>/ overrides,
# and zip each one.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../dist"
shared=(background.js popup.html popup.css popup.js lib icons/16.png icons/32.png icons/48.png icons/128.png)

for browser in chrome firefox; do
  dir="$out/$browser"
  rm -rf "$dir" && mkdir -p "$dir/icons"
  for path in "${shared[@]}"; do cp -r "$here/$path" "$dir/$path"; done
  cp "$here/$browser"/* "$dir/"
  rm -f "$out/bandcamp-shuffle-$browser.zip"
  (cd "$dir" && zip -9 -qrX "$out/bandcamp-shuffle-$browser.zip" .)
done
echo "Built $out/chrome and $out/firefox"
