# WindLab build verification

## Verified locally
- `python -m compileall -q backend scripts`: passed.
- `PYTHONPATH=backend pytest -q backend/tests -m 'not integration'`: 10 passed.
- GitHub Actions' first remote FLORIS integration suite passed **12/12** on commit `b6527c0`, including wake direction and constrained optimizer acceptance.

## Current follow-up
- The second remote CI run passed both frontend production build and all 12 FLORIS backend tests.
- Wind-cache workflow succeeded and committed 8,760 hourly 2025 ERA5 reanalysis records for Mars Hill, Maine on development branch.
- Initial browser smoke test found an invalid minor/major vegetation ellipse in Cesium; corrected bounds. Next CI run must verify rendering and optimization. Production deployment remains unverified.
- Wind rose is now real regional **modeled reanalysis**; it is not onsite measurement data.

## Remaining validation
- Confirm browser smoke test and screenshots pass.
- Verify cached ERA5 resource is preserved across future commits and tests.
- Open a browser to check Cesium rendering, turbine dragging and source attribution.
- Deploy and smoke-test end-to-end.
