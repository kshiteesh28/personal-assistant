#!/bin/bash
set -euo pipefail

package_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
repo_dir="$(cd -- "$package_dir/../.." && pwd)"
app_dir="$package_dir/build/kst.app"

# SwiftPM's manifest sandbox cannot be nested inside some coding-agent sandboxes.
# This flag affects the compiler build, not the installed app's permissions.
swift build --disable-sandbox --package-path "$package_dir" --product kst
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
cp "$package_dir/.build/debug/kst" "$app_dir/Contents/MacOS/kst"
cp "$package_dir/Info.plist" "$app_dir/Contents/Info.plist"
node_path="$(command -v node)"
plutil -replace KSTCoreEntry -string "$repo_dir/packages/kst-core/src/server.mjs" "$app_dir/Contents/Info.plist"
plutil -replace KSTNodePath -string "$node_path" "$app_dir/Contents/Info.plist"
if [ -f "$repo_dir/assets/kst/kst-logo.png" ]; then
  cp "$repo_dir/assets/kst/kst-logo.png" "$app_dir/Contents/Resources/kst-logo.png"
  iconset_dir="$package_dir/build/kst.iconset"
  mkdir -p "$iconset_dir"
  square_logo="$package_dir/build/kst-icon-square.png"
  swift run --disable-sandbox --package-path "$package_dir" KstIconPrep "$repo_dir/assets/kst/kst-logo.png" "$square_logo"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$square_logo" --out "$iconset_dir/icon_${size}x${size}.png" >/dev/null
    retina_size=$((size * 2))
    sips -z "$retina_size" "$retina_size" "$square_logo" --out "$iconset_dir/icon_${size}x${size}@2x.png" >/dev/null
  done
  if ! iconutil -c icns "$iconset_dir" -o "$app_dir/Contents/Resources/kst.icns"; then
    printf 'iconutil unavailable; using deterministic PNG-backed ICNS packaging.\n'
    node "$package_dir/make-icon.mjs" "$iconset_dir" "$app_dir/Contents/Resources/kst.icns"
  fi
fi
codesign --force --sign - "$app_dir"
codesign --verify "$app_dir"
printf 'Built %s\n' "$app_dir"
