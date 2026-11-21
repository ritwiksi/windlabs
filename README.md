# WindLab — 3D wind farm digital twin

A hands-on, six-turbine wind farm layout tool using **CesiumJS + React** and a real **FLORIS v4 Jensen** wake simulation. Change the site layout, vary the *instantaneous* wind, inspect simulated wake penalties, and request constrained **annual energy** optimization. No pretend electricity measurements or fabricated optimization percentages.

![stage](https://img.shields.io/badge/stage-hackathon%20MVP-4f8069)

## Run locally

Backend (Python 3.11/3.12 strongly recommended):

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\\Scripts\\activate
pip install -r backend/requirements-dev.txt
PYTHONPATH=backend uvicorn app.main:app --reload --port 8000
```

Frontend (Node 22+):

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. To run in Docker with no credentials, use `docker compose up --build` and open `http://localhost:8080`.

## Important: historical wind data

The development branch now contains **cached 2025 ERA5 reanalysis** for the Mars Hill reference coordinates, validated from 8,760 hourly records. To regenerate independently, run:

```bash
python scripts/fetch_wind.py
```

The **Cache verified ERA5 2025 wind resource** GitHub Action also regenerates and commits the wind rose. The backend works offline after this step. Do not interpret the regional ERA5 data as onsite measurements.

* Source: https://open-meteo.com/en/docs/historical-weather-api
* Reference location: 46.52° N, 67.87° W (Mars Hill, northern Maine; fictional site informed by data from that region)
* Period: 2025 full year; modeled **ERA5 reanalysis**, **not direct site measurements**.
* Input variables: 100 m wind speed & direction. Wind speed is discretized to 2/6/10/14/18/22 m/s; 30° direction bins; 0.06 TI and wind shear assumptions.
* 100 m weather is applied to a 90 m hub for this conceptual model. Calm periods are assigned 2 m/s (below the NREL 5 MW turbine cut-in speed); extremes are coarsely binned. The AEP excludes electrical losses, downtime, curtailment, layout cost and terrain effects. These caveats matter.

## What the numbers mean

* **Live MW**: FLORIS power for current wind speed/direction and current layout.
* **Live wake penalty**: comparison against `FlorisModel.run_no_wake()` under the same instant.
* **Annual MWh**: 8,760 × expected farm power over a **fixed** cached wind rose. Moving the instantaneous slider **does not** change AEP or optimization input.
* **Annual wake loss**: AEP with wakes vs the same layout under no wakes.
* **Optimization result**: `LayoutOptimizationScipy` SLSQP with 2,400 × 1,800 m bounds and 504 m minimum spacing. Results are verified with an independent model re-run and only accepted if numerically better. **Local candidate only; no global optimum claim.**
* **3D wake envelopes**: conceptual directional geometry (not quantitative CFD velocity contours). The numeric per-turbine wake penalties are from FLORIS.

## Engineering design

```text
React/TypeScript → Cesium scene, draggable turbines, wind controls, compare UI
                 ↓ /api/config, /api/simulate, /api/optimize
FastAPI         → input validation, FLORIS v4, bounded layout optimization
                 ↑ bundled wind_rose.json + FLORIS Jensen configuration
```

The Cesium terrain is a **fictional local platform** shown without network terrain/imagery or Cesium ion credentials. Turbines are made from lightweight 3D Cesium primitives. Deployment uses a frontend nginx + one Python backend, no database. Coordinates are east/north in metres and projected onto a tiny geographic frame for the viewer.

## Quality checks

```bash
PYTHONPATH=backend pytest -v backend/tests
npm run build
```

GitHub Actions performs both. Tests cover spacing/boundaries, invalid API inputs, wake direction, and safe optimization acceptance. Backend code intentionally refuses to make up results if FLORIS cannot run.

## API

* `GET /api/config` → site, initial layout, wind metadata
* `POST /api/simulate` with `{layout:[{x,y},...],wind_speed:8,wind_direction:270}`
* `POST /api/optimize` with the same payload
* `GET /health` → FLORIS installation check

## References

* [FLORIS documentation](https://natlabrockies.github.io/floris/) — wake model and layout optimizer, open-source NLR/NREL software.
* [NLR FLORIS Jensen input example](https://github.com/NatLabRockies/floris/blob/main/examples/inputs/jensen.yaml) — adapted with attribution.
* [Open-Meteo historical reanalysis API](https://open-meteo.com/en/docs/historical-weather-api).
* Reuse direction / concept based on [TempleTwin](https://github.com/ritwiksi/TempleTwin), while avoiding its database/LLM stack.

## Browser integration test

The CI workflow includes a headless Chromium/Playwright test that boots FastAPI and Vite, checks the rendered Cesium scene and FLORIS model values, changes the wind control, and runs optimization. It saves before/after screenshots as the `windlab-browser-smoke` artifact for inspection.

```bash
npm install
npx playwright install chromium
npm run test:e2e
```
