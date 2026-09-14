#!/bin/zsh
# Builds the DAAT Cat menu bar helper into dist/DAAT Cat.app.
# Called by the desktop packaging pipeline (scripts/stage-daatcat.mjs);
# safe to run by hand too.
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release

APP="dist/DAAT Cat.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cp .build/release/DaatCat "$APP/Contents/MacOS/DaatCat"
cp -R Resources/cat "$APP/Contents/Resources/cat"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
 "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>DAAT Cat</string>
    <key>CFBundleDisplayName</key><string>DAAT Cat</string>
    <key>CFBundleIdentifier</key><string>com.allfj.daatcat</string>
    <key>CFBundleExecutable</key><string>DaatCat</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>1.0.0</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    <key>LSUIElement</key><true/>
    <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$APP"
echo "Built: $PWD/$APP"
