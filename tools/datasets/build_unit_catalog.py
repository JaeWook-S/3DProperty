#!/usr/bin/env python3
"""Create a small public, read-only unit lookup. No prices or private file paths."""
import argparse
import hashlib
import json
import gzip
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT.parent / 'AisideProject/datasets/acro-river-park/releases/2026-10-25-unit-catalog-v1/data/units.json'
OUTPUT = ROOT / 'src/property/acro-unit-catalog.json'


def build():
    source = json.loads(SOURCE.read_text())
    units = source['units']
    types, type_indices, buildings, seen = [], {}, {}, set()
    for row in sorted(units, key=lambda r: (int(r['building_label'].removesuffix('동')), r['floor'], int(r['line_label']))):
        if row['kind'] != 'residential' or row['plan_variant'] is not None:
            raise ValueError('Unexpected row kind or asserted renovation state')
        building = row['building_label'].removesuffix('동')
        floor, unit, line = row['floor'], row['unit_label'], int(row['line_label'])
        if not isinstance(floor, int) or floor < 1 or not isinstance(unit, str) or not unit:
            raise ValueError('Invalid explicit floor/unit field')
        key = building, floor, unit
        if key in seen:
            raise ValueError('Duplicate unit')
        seen.add(key)
        signature = (row['type_label_exact'], row['supply_area_m2'], row['exclusive_area_m2'], row['catalog_model_type'])
        if signature not in type_indices:
            type_indices[signature] = len(types)
            types.append(dict(zip(['type', 'supplyM2', 'exclusiveM2', 'modelType'], signature)))
        buildings.setdefault(building, []).append([floor, line, unit, type_indices[signature]])
    if len(units) != 1612 or len(buildings) != 15 or len(types) != 33:
        raise ValueError('Reviewed snapshot counts changed; review new intake before replacing')
    return {'schema': 'cortex.unit-lookup.v1',
            'source': {'label': '네이버 부동산 · 사용자 제공 자료',
                       'url': source['provenance']['source_url'],
                       'csvSha256': source['provenance']['source_csv_sha256'],
                       'receivedDate': '2026-10-25', 'capturedAt': source['provenance']['captured_at'],
                       'verification': 'user_csv_consistency_checked', 'renovationState': 'unknown'},
            'rowFields': ['floor', 'line', 'unit', 'typeIndex'], 'types': types, 'buildings': buildings}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = (json.dumps(build(), ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != data:
            raise SystemExit('Unit lookup differs from reviewed source; rebuild it')
    else:
        OUTPUT.write_bytes(data)
    print(json.dumps({'bytes': len(data), 'gzip_bytes': len(gzip.compress(data, mtime=0)),
                      'units': 1612, 'types': 33, 'sha256': hashlib.sha256(data).hexdigest(),
                      'source_sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                      'prices_included': False, 'GLB_copies': 0, 'checked': args.check}))


if __name__ == '__main__':
    main()
