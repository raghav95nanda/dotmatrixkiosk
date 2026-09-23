#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="0.1.1675465747"
BASE="https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@${VERSION}"
TARGET="$SCRIPT_DIR/mediapipe"

mkdir -p "$TARGET"

files=(
  selfie_segmentation.js
  selfie_segmentation.binarypb
  selfie_segmentation.tflite
  selfie_segmentation_landscape.tflite
  selfie_segmentation_solution_simd_wasm_bin.js
  selfie_segmentation_solution_simd_wasm_bin.wasm
  selfie_segmentation_solution_wasm_bin.js
  selfie_segmentation_solution_wasm_bin.wasm
)

echo "Downloading MediaPipe Selfie Segmentation ${VERSION} for offline use..."
for file in "${files[@]}"; do
  echo "  $file"
  curl -fL "$BASE/$file" -o "$TARGET/$file"
done

: > "$TARGET/selfie_segmentation_solution_simd_wasm_bin.data"

echo
echo "Offline assets downloaded. Running verification..."
python3 "$SCRIPT_DIR/verify-offline.py"
echo
echo "Done. This folder can now run without an internet connection."
