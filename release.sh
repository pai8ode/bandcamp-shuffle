#!/usr/bin/env bash
# Publish a new add-on version: ./release.sh 1.3.0
#
# Bumps both manifests, tests, builds, signs the Firefox add-on with Mozilla
# (unlisted), creates the GitHub release, and only then adds the version to
# updates.json, so Firefox never sees an update whose download isn't live yet.
# Needs ~/.config/bandcamp-shuffle/amo.env (WEB_EXT_API_KEY / WEB_EXT_API_SECRET)
# and `gh auth login`.
set -euo pipefail

version="${1:?usage: ./release.sh <version, e.g. 1.3.0>}"
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "version must look like 1.3.0" >&2; exit 1; }
root="$(cd "$(dirname "$0")" && pwd)"
cd "$root"
repo="pai8ode/bandcamp-shuffle"
addon_id="bandcamp-shuffle@pai.omarchy"
keys="$HOME/.config/bandcamp-shuffle/amo.env"

[[ -z $(git status --porcelain) ]] || { echo "commit or stash your changes first" >&2; exit 1; }
[[ -f $keys ]] || { echo "missing $keys" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$version" >/dev/null && { echo "v$version already exists" >&2; exit 1; }

echo "== bump to $version"
for manifest in extension/chrome/manifest.json extension/firefox/manifest.json; do
  jq --arg v "$version" '.version = $v' "$manifest" > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"
done

echo "== test and build"
python -m unittest discover -s tests >/dev/null
(cd extension && node --test test/*.test.mjs >/dev/null && ./build.sh >/dev/null)
(cd dist/firefox && npx --yes web-ext@10 lint --self-hosted | grep -qE '^errors +0')

git commit -qam "Release $version" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git tag -a "v$version" -m "Bandcamp Shuffle $version"
git push -q origin HEAD "v$version"

echo "== sign with Mozilla (unlisted)"
(cd dist/firefox && set -a && . "$keys" && set +a &&
  npx --yes web-ext@10 sign --channel=unlisted --artifacts-dir ../signed --approval-timeout 900000) |
  grep -E 'Waiting|Signed xpi'
signed=$(ls dist/signed/*-"$version".xpi)

echo "== GitHub release"
rm -rf dist/release && mkdir -p dist/release
cp "$signed" dist/release/bandcamp-shuffle-firefox.xpi
cp dist/bandcamp-shuffle-chrome.zip dist/release/
notes="${RELEASE_NOTES:-Bandcamp Shuffle $version.}"
gh release create "v$version" dist/release/* --repo "$repo" --latest --title "Bandcamp Shuffle $version" --notes "$notes"

echo "== announce the update to installed Firefox copies"
hash=$(sha256sum dist/release/bandcamp-shuffle-firefox.xpi | cut -d' ' -f1)
link="https://github.com/$repo/releases/download/v$version/bandcamp-shuffle-firefox.xpi"
[[ -f updates.json ]] || echo "{\"addons\": {\"$addon_id\": {\"updates\": []}}}" > updates.json
jq --arg id "$addon_id" --arg v "$version" --arg link "$link" --arg hash "sha256:$hash" \
  '.addons[$id].updates += [{version: $v, update_link: $link, update_hash: $hash}]' updates.json > updates.json.tmp
mv updates.json.tmp updates.json
git add updates.json
git commit -qm "Announce $version in updates.json" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q origin HEAD

echo "Released $version: https://github.com/$repo/releases/tag/v$version"
