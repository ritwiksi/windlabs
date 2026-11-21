import pytest
from fastapi.testclient import TestClient
from app.geometry import INITIAL_LAYOUT, MIN_SPACING, validate_layout
from app.main import app
from app.physics import evaluate, optimize, load_wind_resource

client = TestClient(app)


def test_config_and_wind_rose():
    response = client.get('/api/config')
    assert response.status_code == 200
    data = response.json()
    assert len(data['initial_layout']) == 6
    assert load_wind_resource()[3].sum() == pytest.approx(1)


def test_invalid_layout_http_422():
    points = [p.copy() for p in INITIAL_LAYOUT]
    points[1] = points[0].copy()
    response = client.post('/api/simulate', json={
        'layout': points, 'wind_speed': 8.0, 'wind_direction': 270.0,
    })
    assert response.status_code == 422


@pytest.mark.integration
def test_downstream_wake_and_direction_change():
    # At 270 deg wind blows west -> east. Turbine 2 shadows turbine 3.
    west = evaluate(INITIAL_LAYOUT, 8.0, 270.0)
    north = evaluate(INITIAL_LAYOUT, 8.0, 0.0)
    assert west['turbines'][1]['wake_loss_pct'] > 0.0
    assert west['instant_wake_loss_pct'] > north['instant_wake_loss_pct']
    assert west['aep_mwh'] == pytest.approx(north['aep_mwh'])


@pytest.mark.integration
def test_optimizer_no_fabrication_and_constraints():
    result = optimize(INITIAL_LAYOUT, 8.0, 270.0)
    validate_layout(result['layout'])
    assert result['baseline']['aep_mwh'] > 0
    if result['accepted']:
        assert result['optimized']['aep_mwh'] > result['baseline']['aep_mwh']
        assert result['improvement_pct'] > 0
    else:
        assert result['improvement_pct'] == 0
        assert result['layout'] == INITIAL_LAYOUT
