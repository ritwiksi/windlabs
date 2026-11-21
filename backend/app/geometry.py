"""Local-planar turbine layouts, in metres east (x) and north (y)."""
import math
from typing import Iterable

SITE_WIDTH = 2400.0
SITE_HEIGHT = 1800.0
ROTOR_DIAMETER = 126.0
HUB_HEIGHT = 90.0
MIN_SPACING = 4.0 * ROTOR_DIAMETER
TURBINE_COUNT = 6
INITIAL_LAYOUT = [
    {"x": 360.0, "y": 420.0},
    {"x": 1030.0, "y": 420.0},
    {"x": 1700.0, "y": 420.0},
    {"x": 360.0, "y": 1070.0},
    {"x": 1030.0, "y": 1070.0},
    {"x": 1700.0, "y": 1070.0},
]


def validate_layout(layout: Iterable[dict]) -> list[dict]:
    try:
        points = [{"x": float(p["x"]), "y": float(p["y"])} for p in layout]
    except (TypeError, ValueError, KeyError) as exc:
        raise ValueError("Layout coordinates must be numeric x/y values") from exc
    if len(points) != TURBINE_COUNT:
        raise ValueError(f"Exactly {TURBINE_COUNT} turbines are required")
    for index, point in enumerate(points):
        x, y = point["x"], point["y"]
        if not math.isfinite(x) or not math.isfinite(y):
            raise ValueError(f"Turbine {index + 1} has non-finite coordinates")
        if not (0 <= x <= SITE_WIDTH and 0 <= y <= SITE_HEIGHT):
            raise ValueError(f"Turbine {index + 1} is outside the site boundary")
    for i, a in enumerate(points):
        for j in range(i + 1, len(points)):
            b = points[j]
            if math.hypot(a["x"] - b["x"], a["y"] - b["y"]) < MIN_SPACING - 1e-4:
                raise ValueError(f"Turbines {i + 1} and {j + 1} violate the {MIN_SPACING:.0f} m spacing rule")
    return points
