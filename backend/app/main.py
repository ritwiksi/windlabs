"""FastAPI for the WindLab six-turbine conceptual planner."""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .geometry import (HUB_HEIGHT, INITIAL_LAYOUT, MIN_SPACING,
                       ROTOR_DIAMETER, SITE_HEIGHT, SITE_WIDTH, TURBINE_COUNT, validate_layout)
from .physics import evaluate, load_wind_resource, optimize

app = FastAPI(title='WindLab · FLORIS backend', version='0.1.0')
app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:5173', 'http://127.0.0.1:5173'],
                   allow_methods=['GET', 'POST'], allow_headers=['*'])


class Point(BaseModel):
    x: float
    y: float


class SimulationRequest(BaseModel):
    layout: list[Point] = Field(min_length=TURBINE_COUNT, max_length=TURBINE_COUNT)
    wind_speed: float = Field(ge=2.0, le=25.0)
    wind_direction: float = Field(ge=0.0, lt=360.0)


def unpack(request: SimulationRequest):
    try:
        return validate_layout([p.model_dump() for p in request.layout])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get('/health')
def health():
    try:
        import floris
        status = 'ready'
    except ImportError:
        status = 'missing-floris'
    return {'status': status}


@app.get('/api/config')
def config():
    source, _, _, _ = load_wind_resource()
    return {
        'site': {'width_m': SITE_WIDTH, 'height_m': SITE_HEIGHT,
                 'min_spacing_m': MIN_SPACING, 'rotor_diameter_m': ROTOR_DIAMETER,
                 'hub_height_m': HUB_HEIGHT},
        'initial_layout': INITIAL_LAYOUT,
        'wind_resource': source['metadata'],
        'default_wind': {'speed': 8.0, 'direction': 270.0},
        'turbine_count': TURBINE_COUNT,
    }


@app.post('/api/simulate')
def simulate(request: SimulationRequest):
    layout = unpack(request)
    try:
        return evaluate(layout, request.wind_speed, request.wind_direction)
    except Exception as exc:
        # Do not turn FLORIS failures into fake energy outputs.
        raise HTTPException(status_code=503, detail=f'FLORIS calculation failed: {exc}') from exc


@app.post('/api/optimize')
def optimize_endpoint(request: SimulationRequest):
    layout = unpack(request)
    try:
        return optimize(layout, request.wind_speed, request.wind_direction)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f'FLORIS optimization failed: {exc}') from exc
