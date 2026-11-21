"""Production model: actual FLORIS, never a fabricated power curve.

Units: internal FLORIS outputs are watts; API uses MW and MWh/year.
The annual calculation uses fixed cached wind-rose frequencies, independently
of the wind selected for the instantaneous view.
"""
import json
from functools import lru_cache
from pathlib import Path

import numpy as np

from .geometry import (
    SITE_HEIGHT, SITE_WIDTH, MIN_SPACING, INITIAL_LAYOUT, validate_layout
)

CONFIG = Path(__file__).resolve().parent / 'jensen.yaml'
WIND_FILE = Path(__file__).resolve().parent / 'wind_rose.json'


def load_wind_resource():
    data = json.loads(WIND_FILE.read_text())
    directions = np.asarray(data['directions_deg'], dtype=float)
    speeds = np.asarray(data['speeds_ms'], dtype=float)
    frequency = np.asarray(data['frequencies'], dtype=float)
    if frequency.shape != (len(directions), len(speeds)):
        raise ValueError('Wind frequency dimensions are incorrect')
    if not np.all(np.isfinite(frequency)) or np.any(frequency < 0) or frequency.sum() <= 0:
        raise ValueError('Wind resource has invalid frequencies')
    if not np.all(np.isfinite(speeds)) or np.any(speeds <= 0):
        raise ValueError('Wind speeds must be positive finite values')
    frequency = frequency / frequency.sum()
    return data, directions, speeds, frequency


def _make_model():
    # Deliberately no silent fallback if FLORIS is missing or errors.
    from floris import FlorisModel
    return FlorisModel(str(CONFIG))


def _configure_layout(model, layout):
    model.set(layout_x=[p['x'] for p in layout], layout_y=[p['y'] for p in layout])


@lru_cache(maxsize=64)
def _annual_cached(key):
    return _evaluate_annual([{"x": p[0], "y": p[1]} for p in key])


def annual(layout):
    return _annual_cached(tuple((round(p["x"], 3), round(p["y"], 3)) for p in layout)).copy()


def _evaluate_annual(layout, model=None):
    from floris import WindRose
    _, directions, speeds, frequencies = load_wind_resource()
    fmodel = model if model is not None else _make_model()
    _configure_layout(fmodel, layout)
    rose = WindRose(wind_directions=directions, wind_speeds=speeds,
                    freq_table=frequencies, ti_table=0.06)
    fmodel.set(wind_data=rose)
    fmodel.run()
    aep = float(fmodel.get_farm_AEP()) / 1e6
    fmodel.run_no_wake()
    no_wake_aep = float(fmodel.get_farm_AEP()) / 1e6
    return {
        'aep_mwh': round(aep, 2),
        'annual_wake_loss_pct': round(max(0.0, 100.0 * (no_wake_aep - aep) / no_wake_aep), 2),
    }


def evaluate(layout, wind_speed: float, wind_direction: float):
    layout = validate_layout(layout)
    if not (2.0 <= wind_speed <= 25.0) or not (0.0 <= wind_direction < 360.0):
        raise ValueError('Wind speed must be 2–25 m/s and direction 0–359.99°')
    model = _make_model()
    _configure_layout(model, layout)
    model.set(wind_directions=[wind_direction], wind_speeds=[wind_speed],
              turbulence_intensities=[0.06])
    model.run()
    turbines_w = np.asarray(model.get_turbine_powers(), dtype=float).reshape(-1)
    model.run_no_wake()
    no_wake_w = np.asarray(model.get_turbine_powers(), dtype=float).reshape(-1)
    farm_power = float(turbines_w.sum())
    no_wake_power = float(no_wake_w.sum())
    annual_metrics = annual(layout)
    return {
        **annual_metrics,
        'power_mw': round(farm_power / 1e6, 3),
        'instant_wake_loss_pct': round(max(0.0, 100.0 * (no_wake_power - farm_power) / no_wake_power), 2) if no_wake_power > 0 else 0.0,
        'turbines': [{
            'id': i + 1,
            'power_mw': round(float(p) / 1e6, 3),
            'wake_loss_pct': round(max(0.0, 100.0 * (float(n) - float(p)) / float(n)), 2) if n > 0 else 0.0,
        } for i, (p, n) in enumerate(zip(turbines_w, no_wake_w))],
    }


def optimize(layout, wind_speed: float, wind_direction: float):
    from floris import WindRose
    from floris.optimization.layout_optimization.layout_optimization_scipy import LayoutOptimizationScipy
    layout = validate_layout(layout)
    # Preserve exactly the same wind resource in both comparisons.
    metadata, directions, speeds, frequencies = load_wind_resource()
    baseline = annual(layout)
    model = _make_model()
    _configure_layout(model, layout)
    model.set(wind_data=WindRose(wind_directions=directions,
                                wind_speeds=speeds, freq_table=frequencies, ti_table=0.06))
    boundary = [(0.0, 0.0), (SITE_WIDTH, 0.0),
                (SITE_WIDTH, SITE_HEIGHT), (0.0, SITE_HEIGHT), (0.0, 0.0)]
    optimizer = LayoutOptimizationScipy(
        model, boundaries=boundary, min_dist=MIN_SPACING,
        optOptions={'maxiter': 18, 'disp': False, 'iprint': 0, 'ftol': 1e-6, 'eps': 0.02}
    )
    xs, ys = optimizer.optimize()
    proposed = [{'x': float(x), 'y': float(y)} for x, y in zip(xs, ys)]
    # Candidate must be valid and independently re-evaluated. Failed optimization
    # returns the baseline rather than inventing a gain.
    try:
        optimized = validate_layout(proposed)
        candidate = annual(optimized)
        if candidate['aep_mwh'] <= baseline['aep_mwh'] + 1e-3:
            return {'accepted': False, 'message': 'No verified AEP improvement found',
                    'layout': layout, 'baseline': baseline, 'optimized': baseline,
                    'improvement_pct': 0.0}
        improvement = 100 * (candidate['aep_mwh'] - baseline['aep_mwh']) / baseline['aep_mwh']
        return {'accepted': True, 'message': 'Verified locally optimized layout',
                'layout': optimized, 'baseline': baseline, 'optimized': candidate,
                'improvement_pct': round(improvement, 3)}
    except ValueError as exc:
        return {'accepted': False, 'message': f'Optimizer returned invalid layout: {exc}',
                'layout': layout, 'baseline': baseline, 'optimized': baseline,
                'improvement_pct': 0.0}
