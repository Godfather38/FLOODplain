# Wash Watch (FLOODplain)

A check of the roads between Avra Valley, AZ and I-10, either direction. It reads live USGS stream gauges at each river crossing and recommends a route. It's a hobby tool, not an official warning.

- `public/`: the static web app (no server). `logic.js` holds the route-rating rules and `config.js` the gauge-to-route mapping.
- `tools/`: rebuilds the route and crossing data from OpenStreetMap (via Overture Maps).
- Alerts: the app's Alerts screen gives you a free ntfy topic for the time and days you pick.
- `docs/SCOPE.md`: existing tools, legality, and limitations. `docs/PLAN.md`: what's next.

## Run locally
```
npm test             # route-rating logic
npm run serve        # http://localhost:8080
```

## Rebuild routes
```
pip install -r tools/requirements.txt
B="-111.50 32.25 -110.98 32.56"; D=/tmp/ov; mkdir -p $D
python3 tools/fetch_overture.py 2026-10-21.0 transportation segment $B $D/segments.parquet
python3 tools/fetch_overture.py 2026-10-21.0 base water $B $D/water.parquet
python3 tools/build_routes.py $D && python3 tools/render_preview.py $D
```

## Publish free on GitHub Pages
Repo Settings → Pages → Source: **GitHub Actions**. Every push to `main` then deploys `public/`.

Data: road and water geometry © OpenStreetMap contributors (ODbL), via Overture Maps. Gauge data is from USGS and is provisional.
