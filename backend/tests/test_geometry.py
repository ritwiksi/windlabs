import math
import pytest
from app.geometry import INITIAL_LAYOUT, MIN_SPACING, validate_layout


def test_initial_layout_valid():
    assert validate_layout(INITIAL_LAYOUT) == INITIAL_LAYOUT


def test_outside_site_rejected():
    with pytest.raises(ValueError, match='outside'):
        validate_layout([{**INITIAL_LAYOUT[0], 'x': -1}, *INITIAL_LAYOUT[1:]])


def test_too_close_rejected():
    with pytest.raises(ValueError, match='spacing'):
        validate_layout([INITIAL_LAYOUT[0], INITIAL_LAYOUT[0], *INITIAL_LAYOUT[2:]])


def test_nan_rejected():
    with pytest.raises(ValueError, match='non-finite'):
        validate_layout([{**INITIAL_LAYOUT[0], 'x': math.nan}, *INITIAL_LAYOUT[1:]])


def test_count_preserved():
    with pytest.raises(ValueError, match='Exactly'):
        validate_layout(INITIAL_LAYOUT[:-1])
