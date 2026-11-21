import math
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import pytest
from scripts.fetch_wind import bin_observations, SPEEDS, DIRECTIONS, LATITUDE, LONGITUDE


def test_region_and_equally_spaced_windrose():
    assert LATITUDE == pytest.approx(46.52)
    assert LONGITUDE == pytest.approx(-67.87)
    assert len(SPEEDS) == 6 and all(b - a == 4 for a, b in zip(SPEEDS, SPEEDS[1:]))
    assert len(DIRECTIONS) == 12


def test_binning_calms_north_wraparound_and_counts():
    count = 8760
    ws = [0.0] * count
    wd = [359.0] * count
    ws[1], wd[1] = 8.0, 15.0
    ws[2], wd[2] = 13.0, 300.0
    freqs, valid = bin_observations(list(range(count)), ws, wd)
    assert valid == 8760
    assert sum(map(sum, freqs)) == pytest.approx(1)
    assert freqs[0][0] == pytest.approx((count - 2) / count)
    assert freqs[1][1] == pytest.approx(1 / count)
    assert freqs[10][3] == pytest.approx(1 / count)


def test_missing_data_does_not_create_invented_hours():
    n=8760
    with pytest.raises(ValueError, match='Not enough valid'):
        bin_observations(list(range(n)), [math.nan] * n, [270] * n)
    with pytest.raises(ValueError, match='Incomplete'):
        bin_observations([0], [8], [270])
