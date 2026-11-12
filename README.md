# Flask Flow

An ad-free liquid-sort puzzle that installs on your iPhone's Home Screen as a web app.
It has no ads, accounts, tracking or purchases, and it works offline once installed.

See [SPEC.md](SPEC.md) for the game design.

## Play locally (on the Mac)

```bash
python3 -m http.server 8765
```

Open http://localhost:8765. Engine tests run at http://localhost:8765/tests.html.

## Quick try on your iPhone (same Wi-Fi, no hosting)

```bash
python3 -m http.server 8765 --bind 0.0.0.0
```

On the iPhone, open `http://<your-mac-ip>:8765` in Safari. To find the IP, run `ipconfig getifaddr en0`.
You can play right away, and Share → Add to Home Screen works too. Offline mode is off here,
though, because iOS only allows it over HTTPS.

## Install for real (free, permanent, offline): GitHub Pages

1. On github.com, create a new **public** repo named `flask-flow`. Leave it empty: no README, license or .gitignore.
2. Push this folder, which is already a git repo with everything committed:
   ```bash
   git remote add origin https://github.com/<username>/flask-flow.git
   git push -u origin main
   ```
   If git asks for a password, use a GitHub **personal access token** (Settings → Developer settings → Tokens), not your account password.
3. In the repo, go to **Settings → Pages → Source: Deploy from branch → `main` / `(root)`**, then Save.
4. After about a minute, the site is live at `https://<username>.github.io/flask-flow/`.
5. On the iPhone, open that URL in **Safari**, tap **Share → Add to Home Screen**, then **Add**.

It now launches full-screen from the Home Screen icon. After the first launch it works with no internet.
Your progress is saved on the phone only.

## Shipping an update

1. Change the files.
2. **Bump `VERSION` in `sw.js`**, e.g. `flaskflow-v2`. Without this, phones keep serving the cached copy.
3. Push. The phone picks up the new version on the next launch or the one after.

## Project layout

| Path | What |
|---|---|
| `index.html`, `css/style.css` | Screens and styling (light/dark follow the system) |
| `js/engine.js` | Rules, seeded RNG, solver, level generator (pure logic) |
| `js/levels.js` | Difficulty curve and daily-puzzle config |
| `js/app.js` | UI, pour animation, helpers, saving |
| `js/audio.js`, `js/haptics.js` | Synthesized sounds; haptics via the iOS 18 switch trick |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and Home Screen install |
| `scripts/make_icons.py` | Regenerates the app icons |
| `tests.html` | Engine tests + generates and verifies 260 levels and 30 dailies |
