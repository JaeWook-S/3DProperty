#!/usr/bin/env python3
"""Derive lightweight metre-based ACRO River Park site data from OSM XML."""

from __future__ import annotations

import argparse
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path


REPOSITORY = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = (
    REPOSITORY.parent
    / "AisideProject/datasets/acro-river-park/raw/site-context/2026-10-21"
)
RELATION_IDS = {
    "7766717", "7766718", "7770395", "7770396", "7770397", "7770398",
    "7770771", "7770772", "7770773", "7770774", "7784340", "7784341",
    "7784469", "7784502",
}
SITE_BOUNDARY_WAY = "412614475"
SINGLE_BUILDING_WAY = "544766951"
ROAD_NAMES = {"올림픽대로", "신반포로", "신반포로15길"}


def element_tags(element):
    return {tag.attrib["k"]: tag.attrib["v"] for tag in element.findall("tag")}


def read_documents(paths):
    documents = [ET.parse(path).getroot() for path in paths]
    nodes = {
        node.attrib["id"]: (float(node.attrib["lon"]), float(node.attrib["lat"]))
        for document in documents
        for node in document.findall("node")
    }
    ways = {
        way.attrib["id"]: way
        for document in documents
        for way in document.findall("way")
    }
    relations = {
        relation.attrib["id"]: relation
        for document in documents
        for relation in document.findall("relation")
    }
    return documents[0], nodes, ways, relations


def derive(osm_path, supplemental_paths):
    root, nodes, ways, relations = read_documents([osm_path, *supplemental_paths])
    boundary_refs = [node.attrib["ref"] for node in ways[SITE_BOUNDARY_WAY].findall("nd")]
    boundary_wgs84 = [nodes[reference] for reference in boundary_refs[:-1]]
    longitude = sum(point[0] for point in boundary_wgs84) / len(boundary_wgs84)
    latitude = sum(point[1] for point in boundary_wgs84) / len(boundary_wgs84)
    metres_per_longitude = 111_320 * math.cos(math.radians(latitude))
    metres_per_latitude = 110_574

    def local(reference):
        lon, lat = nodes[reference]
        return [
            round((lon - longitude) * metres_per_longitude, 2),
            round(-(lat - latitude) * metres_per_latitude, 2),
        ]

    def footprint(way):
        references = [node.attrib["ref"] for node in way.findall("nd")]
        if references and references[0] == references[-1]:
            references.pop()
        return [local(reference) for reference in references]

    buildings = []
    for relation_id in RELATION_IDS:
        relation = relations[relation_id]
        tags = element_tags(relation)
        levels = int(tags["building:levels"])
        height = float(tags["height"])
        parts = []
        warnings = []
        for member in relation.findall("member"):
            if member.attrib.get("type") != "way" or member.attrib.get("role") != "outer":
                continue
            way = ways.get(member.attrib["ref"])
            if way is None:
                raise ValueError(f"Missing OSM way {member.attrib['ref']} for relation {relation_id}")
            way_tags = element_tags(way)
            part_levels = int(way_tags.get("building:levels", levels))
            if part_levels > levels:
                warnings.append(
                    f"OSM part {member.attrib['ref']} levels {part_levels} exceeds building levels {levels}; rendered height is capped at {height:g}m"
                )
            parts.append({
                "osm_way_id": int(member.attrib["ref"]),
                "levels": part_levels,
                "height_m": round(min(height, height * part_levels / levels), 2),
                "footprint_m": footprint(way),
            })
        buildings.append({
            "id": tags["name"],
            "title": f"{tags['name']}동",
            "levels": levels,
            "height_m": height,
            "nominal_storey_height_m": round(height / levels, 3),
            "osm": {"type": "relation", "id": int(relation_id)},
            "parts": parts,
            "data_warnings": warnings,
        })

    single = ways[SINGLE_BUILDING_WAY]
    single_tags = element_tags(single)
    buildings.append({
        "id": single_tags["name"],
        "title": f"{single_tags['name']}동",
        "levels": int(single_tags["building:levels"]),
        "height_m": float(single_tags["height"]),
        "nominal_storey_height_m": round(
            float(single_tags["height"]) / int(single_tags["building:levels"]), 3
        ),
        "osm": {"type": "way", "id": int(SINGLE_BUILDING_WAY)},
        "parts": [{
            "osm_way_id": int(SINGLE_BUILDING_WAY),
            "levels": int(single_tags["building:levels"]),
            "height_m": float(single_tags["height"]),
            "footprint_m": footprint(single),
        }],
        "data_warnings": [],
    })

    roads = []
    for way in root.findall("way"):
        tags = element_tags(way)
        if tags.get("name") not in ROAD_NAMES:
            continue
        road_points = footprint(way)
        if len(road_points) >= 2:
            roads.append({
                "osm_way_id": int(way.attrib["id"]),
                "name": tags["name"],
                "kind": tags.get("highway", "road"),
                "path_m": road_points,
            })

    gates = []
    for node in root.findall("node"):
        tags = element_tags(node)
        if tags.get("name", "").startswith("아크로리버파크 GATE"):
            gates.append({
                "osm_node_id": int(node.attrib["id"]),
                "name": tags["name"],
                "position_m": local(node.attrib["id"]),
            })

    return {
        "schema": "cortex.site-context.v1",
        "site": "아크로 리버파크",
        "reference_wgs84": [round(longitude, 8), round(latitude, 8)],
        "coordinate_frame": {"unit": "m", "x": "east", "z": "south"},
        "site_boundary_m": [local(reference) for reference in boundary_refs[:-1]],
        "buildings": sorted(buildings, key=lambda building: int(building["id"])),
        "roads": roads,
        "gates": gates,
        "provenance": {
            "osm_source": "https://api.openstreetmap.org/api/0.6/map?bbox=126.9908,37.5032,126.9965,37.5074",
            "osm_copyright": "© OpenStreetMap contributors",
            "osm_license": "ODbL 1.0",
            "osm_license_url": "https://www.openstreetmap.org/copyright",
            "retrieved_at_utc": "2026-10-21T12:28:56.821822+00:00",
            "label_crosscheck": "동 번호는 별도 단지 배치도와 대조함",
            "label_crosscheck_sources": [
                "https://blog.naver.com/k5342211/221343866905?viewType=pc",
                "https://easyfasthand.com/entry/아크로리버파크-평면도-배치도-시세-매매-전세-실거래가-입지분석-총정리",
            ],
            "height_caution": "OSM 높이·층수는 커뮤니티 지도 태그이며 건축 실측값이 아님",
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--osm", type=Path, default=DEFAULT_SOURCE / "osm-map.osm")
    parser.add_argument(
        "--supplemental",
        type=Path,
        action="append",
        default=[Path(__file__).with_name("osm-way-543646531-full.osm")],
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=REPOSITORY / "assets/location/acro-river-park/site-context.json",
    )
    args = parser.parse_args()
    supplemental = [path for path in args.supplemental if path.exists()]
    data = derive(args.osm, supplemental)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {args.output}: {len(data['buildings'])} buildings")


if __name__ == "__main__":
    main()
