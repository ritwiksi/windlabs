"""Cache an Open-Meteo ERA5-derived 2025 wind rose for a *reference location*.

Run from repository root: python scripts/fetch_wind.py

The site rendered by WindLab is fictional. ERA5 is modeled reanalysis at
100 m, not measured turbine-level winds, and FLORIS assumes uniform inflow.
"""
from collections import Counter
import json
import math
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

LATITUDE, LONGITUDE = 46.52, -67.87  # Mars Hill, northern Maine, USA
OUT = Path(__file__).resolve().parents[1] / 'backend/app/wind_rose.json'
DIRECTIONS = list(range(0, 360, 30))
# Equally spaced WindRose centers. 2 m/s represents calm/sub-cut-in hours;
# using 4 m/s as the lowest center would create spurious generation.
SPEEDS = [2, 6, 10, 14, 18, 22]


def bin_observations(times, speeds, directions):
    """Aggregate an ERA5 hourly series into 12x6 normalized frequencies."""
    if not (len(times) == len(speeds) == len(directions)) or len(times) < 8000:
        raise ValueError('Incomplete historical wind response')
    counts = Counter()
    valid = 0
    for ws, wd in zip(speeds, directions):
        if ws is None or wd is None:
            continue
        ws, wd = float(ws), float(wd)
        if not (math.isfinite(ws) and math.isfinite(wd)) or not (0 <= ws < 100 and 0 <= wd <= 360):
            continue
        d = int(((wd + 15) % 360) // 30)
        s = min(range(len(SPEEDS)), key=lambda i: abs(SPEEDS[i] - ws))
        counts[d, s] += 1
        valid += 1
    if valid < 8000:
        raise ValueError('Not enough valid ERA5 hours')
    return [[counts[i, j] / valid for j in range(len(SPEEDS))]
            for i in range(len(DIRECTIONS))], valid


def main():
    query = urlencode({
        'latitude': LATITUDE, 'longitude': LONGITUDE,
        'start_date': '2025-01-01', 'end_date': '2025-12-31',
        'hourly': 'wind_speed_100m,wind_direction_100m',
        'wind_speed_unit': 'ms', 'timezone': 'GMT', 'models': 'era5',
    })
    url = f'https://archive-api.open-meteo.com/v1/archive?{query}'
    with urlopen(url, timeout=90) as response:
        result = json.load(response)
    hourly = result['hourly']
    frequencies, valid = bin_observations(hourly['time'], hourly['wind_speed_100m'],
                                          hourly['wind_direction_100m'])
    payload = {
        'metadata': {
            'source': 'Open-Meteo Historical Weather API / ERA5 reanalysis',
            'reference': 'Mars Hill, Maine, USA (46.52 N, 67.87 W)',
            'period': '2025-01-01 to 2025-12-31 (UTC)',
            'method': 'Modeled hourly 100 m wind, 30° direction bins and 4 m/s speed bins centered at 2–22 m/s',
            'is_historical': True,
            'notice': 'Fictional uniform-inflow farm; ERA5 regional reanalysis, not site measurements. 100 m wind applied at 90 m hub; excludes terrain effects, downtime, electrical and curtailment losses.',
            'sample_count': valid,
            'source_url': url,
        },
        'directions_deg': DIRECTIONS,
        'speeds_ms': SPEEDS,
        'frequencies': frequencies,
    }
    # Write only after validating all observations: a network/API failure must
    # not overwrite a previously verified wind rose.
    OUT.write_text(json.dumps(payload, indent=2) + '\n')
    print(f'Cached {valid} modeled ERA5 hours from Mars Hill, ME to {OUT}')


if __name__ == '__main__':
    main()
