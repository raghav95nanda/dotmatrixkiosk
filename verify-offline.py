from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
MP = ROOT / "mediapipe"

required = {
    "selfie_segmentation.js": 10_000,
    "selfie_segmentation.binarypb": 1,
    "selfie_segmentation.tflite": 100_000,
    "selfie_segmentation_landscape.tflite": 100_000,
    "selfie_segmentation_solution_simd_wasm_bin.js": 100_000,
    "selfie_segmentation_solution_simd_wasm_bin.wasm": 1_000_000,
    "selfie_segmentation_solution_simd_wasm_bin.data": 0,
    "selfie_segmentation_solution_wasm_bin.js": 100_000,
    "selfie_segmentation_solution_wasm_bin.wasm": 1_000_000,
}

errors = []
for name, minimum in required.items():
    p = MP / name
    if not p.exists():
        errors.append(f"MISSING: mediapipe/{name}")
        continue
    size = p.stat().st_size
    if size < minimum:
        errors.append(f"TOO SMALL: mediapipe/{name} ({size} bytes)")

for name in ("index.html", "script.js", "sw.js"):
    text = (ROOT / name).read_text(encoding="utf-8")
    if "cdn.jsdelivr.net" in text or "unpkg.com" in text:
        errors.append(f"REMOTE CDN REFERENCE remains in {name}")

if errors:
    print("Offline verification FAILED:")
    for e in errors:
        print(" -", e)
    print("\nRun prepare-offline.bat (Windows) or ./prepare-offline.sh (Linux/Pi) while online, then verify again.")
    sys.exit(1)

print("Offline verification passed.")
print("All MediaPipe runtime/model files are local and the app has no CDN references.")
