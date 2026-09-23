# Head Matrix Event Kiosk

This build is designed for a portrait Android touchscreen standee and can also run locally on Raspberry Pi/desktop Chromium.

## Event UX

- The controls start hidden.
- Double-tap anywhere on the matrix to show/hide the controls.
- Tap the × button to close the controls.
- `H` still toggles the controls when a keyboard is connected.
- `D` still toggles the white/black background when a keyboard is connected.
- The camera preview is hidden by default and can be enabled from the controls.
- A touch-friendly background toggle is included in the controls.
- The segmentation mask is post-processed to favor one large, central foreground blob, which usually means the closest participant rather than smaller people walking in the background.

Important limitation: a normal RGB camera has no true depth information. If a background person overlaps/touches the main participant in the image, the two silhouettes can merge into one mask. Positioning the standee so the active user is centered and close to the camera improves the result substantially.

## Prepare MediaPipe files

The repository does not ship the MediaPipe binaries until you run the preparation script once while online.

Windows:

    prepare-offline.bat

Linux/macOS/Raspberry Pi:

    chmod +x prepare-offline.sh
    ./prepare-offline.sh

After this, the `mediapipe/` folder contains all required JS, WASM, and model files.

## Test locally

Windows: run `start-local.bat`.

Linux/macOS/Pi:

    ./start-local.sh

Then open `http://localhost:8000`.

## GitHub Pages

1. Run the offline preparation script first.
2. Confirm the real MediaPipe files are inside `mediapipe/`.
3. Commit and push the entire project to a GitHub repository.
4. In GitHub: Settings → Pages → Deploy from a branch → `main` / root.
5. Open the generated `https://YOURNAME.github.io/REPOSITORY/` URL on the kiosk and allow camera permission.
6. Keep the page online long enough for the control panel to report `Offline cache: ready.`
7. Reload once, then test by disabling Wi-Fi. The service worker should serve the app, SVG, JS, CSS, MediaPipe models, and WASM from local browser cache.

GitHub Pages is HTTPS, which is required for browser camera access and service workers.

## Updating the event build

When changing cached files, increment `CACHE_NAME` near the top of `sw.js` (for example `matrix-kiosk-v2`). That forces existing kiosks to install the new cache on the next online visit.

## Suggested kiosk setup

- Use portrait orientation.
- Give the site permanent camera permission.
- Avoid incognito/private browsing because its storage may be temporary.
- Pre-load the page on the actual standee before the event and verify it once with Wi-Fi disabled.
- Use a browser/device kiosk mode that does not routinely clear site storage/cache.
