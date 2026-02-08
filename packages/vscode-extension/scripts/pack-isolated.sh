#!/usr/bin/env bash
# Package the extension in an isolated directory so node_modules has no
# workspace symlinks (avoids pulling in repo root and .env into the VSIX).
set -e
EXT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Copying extension to $TMP (excluding node_modules, out, .env)..."
rsync -a \
  --exclude=node_modules \
  --exclude=out \
  --exclude=.env \
  --exclude=.env.* \
  --exclude=scripts \
  "$EXT_DIR/" "$TMP/"

echo "Installing dependencies (no workspace)..."
(cd "$TMP" && npm install)

echo "Packaging VSIX..."
(cd "$TMP" && npx vsce package --allow-package-env-file --allow-package-all-secrets)

VSIX="$(ls "$TMP"/*.vsix 2>/dev/null | head -1)"
if [ -n "$VSIX" ]; then
  cp "$VSIX" "$EXT_DIR/"
  echo "Created: $EXT_DIR/$(basename "$VSIX")"
else
  echo "No .vsix produced." >&2
  exit 1
fi
