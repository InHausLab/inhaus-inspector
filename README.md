# InHaus Inspector

iPad-first field inspection PWA for home health inspectors.

## Run Locally

```bash
cd inhaus-inspector
python3 -m http.server 8080
```

Open `http://localhost:8080` in Safari (iPad or desktop).

## Install on iPad

1. Open the URL in Safari on iPad
2. Tap the Share button
3. Tap "Add to Home Screen"
4. The app works offline after first load

## File Structure

- `index.html` — App shell with PWA meta tags
- `styles.css` — iPad-optimized styles (20px+ fonts, 56px+ targets)
- `db.js` — IndexedDB wrapper for persistent local storage
- `ui.js` — Reusable UI components (fields, timer, voice, photo)
- `app.js` — App logic, step definitions, navigation, screens
- `manifest.json` — PWA manifest
- `service-worker.js` — Offline caching
- `icons/` — App icons (192px, 512px)

## Workflow

1. **Home** — New / Resume / View inspections
2. **Intake** — Customer & property details
3. **Equipment Checklist** — Pre-assessment gear check
4. **Inspection Steps** — Room-by-room guided workflow
5. **Final Review** — Summary, JSON export, mark complete
