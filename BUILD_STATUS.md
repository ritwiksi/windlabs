# WindLab build verification

## Verified locally
- `python -m compileall -q backend scripts`: passed.
- `PYTHONPATH=backend pytest -q backend/tests -m 'not integration'`: 10 passed.
- GitHub Actions' first remote FLORIS integration suite passed **12/12** on commit `b6527c0`, including wake direction and constrained optimizer acceptance.

## Current follow-up
- The first remote TypeScript build failed on Cesium `CallbackProperty` position types and Vite `ImportMeta.env`; fixed by using `CallbackPositionProperty` and a `vite/client` reference. Changes await next remote CI run.
- Initial wind cache push workflow had invalid YAML; fixed and configured to fetch 2025 Mars Hill (northern Maine) ERA5 data on this feature-branch push.
- A running browser and production deployment have **not** been verified.
- Wind rose is still marked **illustrative** until the wind-cache GitHub Action successfully replaces it.

## Remaining validation
- Confirm second GitHub Actions frontend and backend CI pass.
- Confirm the cache-wind Action commits a historical wind rose with 8,000+ valid hourly data points and `is_historical: true`.
- Open a browser to check Cesium rendering, turbine dragging and source attribution.
- Deploy and smoke-test end-to-end.
