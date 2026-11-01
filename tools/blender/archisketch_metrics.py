"""Source authority and ingestion checks for Archisketch coordinates.

Lengths are source-model measurements, not independently surveyed dimensions.
This module performs no writes and needs no Blender/GPU runtime.
"""
import math


def positive_mm(value, field):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field}: expected a finite positive millimeter value")
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{field}: expected a finite positive millimeter value")
    return value


def opening_width(catalog_dimensions, scaled_dimensions=None, endpoint_span_m=None):
    """Use the placed instance size; nearby room corners are diagnostics only.

    The catalog size is a provisional fallback only when there is no placed
    instance. A supplied but malformed instance must not silently fall back.
    Explicit user design overrides belong downstream with their own provenance.
    """
    dims = scaled_dimensions if scaled_dimensions is not None else catalog_dimensions
    width_m = positive_mm(dims.get("width"), "opening.width") / 1000
    basis = "scaled_editor_item_width" if scaled_dimensions is not None else "catalog_width_provisional"
    delta = None if endpoint_span_m is None else endpoint_span_m - width_m
    return {
        "width_m": width_m,
        "dimension_basis": basis,
        "source_endpoint_span_m": endpoint_span_m,
        "source_span_delta_m": delta,
        "source_span_conflict": delta is not None and abs(delta) > .01,
        "independent_as_built_validation": False,
    }


def require_unique_room_ids(rooms):
    """Reject collisions before a dictionary can silently overwrite a room."""
    seen = set()
    for room in rooms:
        key = room.get("id")
        if not key or key in seen:
            raise ValueError(f"Missing or duplicate normalized room id: {key!r}")
        seen.add(key)


def source_room_changes(rooms, baseline_rooms):
    """Stable source IDs detect edits without relying on titles/type labels."""
    def keyed(values):
        out = {}
        for room in values:
            key = room.get("archiId", room.get("source_id"))
            if not key or key in out:
                raise ValueError(f"Missing or duplicate source room id: {key!r}")
            out[key] = room.get("polygon", room.get("source_polygon_mm"))
        return out
    current, baseline = keyed(rooms), keyed(baseline_rooms)
    return {
        "added": sorted(current.keys() - baseline.keys()),
        "removed": sorted(baseline.keys() - current.keys()),
        "changed": sorted(key for key in current.keys() & baseline.keys() if current[key] != baseline[key]),
        "unchanged": sorted(key for key in current.keys() & baseline.keys() if current[key] == baseline[key]),
    }
