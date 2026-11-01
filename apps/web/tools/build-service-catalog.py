"""Derive lightweight UI JSON from existing artifacts. Never writes a source model."""
from pathlib import Path
import argparse
from collections import defaultdict
import hashlib
import json
import math
import struct

ROOT = Path(__file__).resolve().parents[3]
PUBLIC = ROOT / 'apps/web/public'
EVIDENCE = ROOT.parent / 'AisideProject/realestate-spatial-ai/docs/benchmarking/2026-10-23-service-data'
MODELS = [
    ('112a', 'basic', 'archisketch-metric-v1'),
    ('112a', 'expanded', 'archisketch-metric-v1'),
    ('168c', 'basic', 'archisketch-details-v2'),
    ('168c', 'expanded', 'archisketch-metric-v1'),
]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(name, value):
    path = PUBLIC / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')


IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def multiply(a, b):
    """Column-major glTF matrices, including parent transforms."""
    return [sum(a[row + k * 4] * b[k + col * 4] for k in range(4))
            for col in range(4) for row in range(4)]


def node_matrix(node):
    if 'matrix' in node:
        return node['matrix']
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    sx, sy, sz = node.get('scale', [1, 1, 1])
    tx, ty, tz = node.get('translation', [0, 0, 0])
    return [(1 - 2*y*y - 2*z*z)*sx, (2*x*y + 2*z*w)*sx, (2*x*z - 2*y*w)*sx, 0,
            (2*x*y - 2*z*w)*sy, (1 - 2*x*x - 2*z*z)*sy, (2*y*z + 2*x*w)*sy, 0,
            (2*x*z + 2*y*w)*sz, (2*y*z - 2*x*w)*sz, (1 - 2*x*x - 2*y*y)*sz, 0,
            tx, ty, tz, 1]


def world_point(point, matrix):
    return tuple(sum(matrix[row + col*4] * point[col] for col in range(3)) + matrix[row+12]
                 for row in range(3))


class Glb:
    """Only geometry is decoded; textures, Blender and a graphics context are unused."""
    def __init__(self, path):
        data = path.read_bytes()
        magic, version, size = struct.unpack_from('<4sII', data)
        assert magic == b'glTF' and version == 2 and size == len(data), path
        chunks = {}
        offset = 12
        while offset < size:
            length, kind = struct.unpack_from('<I4s', data, offset)
            chunks[kind] = data[offset+8:offset+8+length]
            offset += 8 + length
        self.gltf = json.loads(chunks[b'JSON'])
        self.binary = chunks[b'BIN\x00']
        self.cache = {}

    def accessor(self, index):
        if index in self.cache:
            return self.cache[index]
        accessor = self.gltf['accessors'][index]
        assert 'sparse' not in accessor and not accessor.get('normalized'), 'Unsupported geometry accessor'
        view = self.gltf['bufferViews'][accessor['bufferView']]
        assert view.get('buffer', 0) == 0
        count = {'SCALAR': 1, 'VEC3': 3}[accessor['type']]
        component = {5121: 'B', 5123: 'H', 5125: 'I', 5126: 'f'}[accessor['componentType']]
        decoder = struct.Struct('<' + component * count)
        stride = view.get('byteStride', decoder.size)
        start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        values = [decoder.unpack_from(self.binary, start + i*stride) for i in range(accessor['count'])]
        self.cache[index] = values
        return values

    def wall_sections(self, height):
        nodes = self.gltf['nodes']
        roots = self.gltf['scenes'][self.gltf.get('scene', 0)]['nodes']
        walls = []

        def visit(index, parent):
            node = nodes[index]
            matrix = multiply(parent, node_matrix(node))
            component = node.get('extras', {}).get('component')
            if component in ('wall', 'excluded_volume') and 'mesh' in node:
                segments = []
                # Join all material primitives before closing a section contour.
                for primitive in self.gltf['meshes'][node['mesh']]['primitives']:
                    assert primitive.get('mode', 4) == 4, 'Walls must contain triangles'
                    positions = [world_point(p, matrix) for p in self.accessor(primitive['attributes']['POSITION'])]
                    indices = ([v[0] for v in self.accessor(primitive['indices'])]
                               if 'indices' in primitive else list(range(len(positions))))
                    for i in range(0, len(indices), 3):
                        triangle = [positions[j] for j in indices[i:i+3]]
                        hits = []
                        for a, b in zip(triangle, triangle[1:] + triangle[:1]):
                            if (a[1] < height) == (b[1] < height) or abs(a[1]-b[1]) < 1e-9:
                                continue
                            t = (height-a[1]) / (b[1]-a[1])
                            hits.append((a[0] + (b[0]-a[0])*t, a[2] + (b[2]-a[2])*t))
                        if len(hits) == 2 and math.dist(*hits) > 1e-6:
                            segments.append(hits)
                path, outline = section_paths(segments)
                if path or outline:
                    wall = {'id': node.get('name', str(index)), 'component': component, 'path': path}
                    if outline:
                        wall['outline'] = outline
                    walls.append(wall)
            for child in node.get('children', []):
                visit(child, matrix)

        for index in roots:
            visit(index, IDENTITY)
        assert walls and any(w['path'] for w in walls), 'No closed wall sections exported'
        return walls


def section_paths(segments):
    """Same 1e-5m weld as Studio wallSectionPath; never fill an open chain."""
    edges, adjacency, unique = [], defaultdict(list), set()
    for a, b in segments:
        ka, kb = (tuple(round(n*1e5) for n in p) for p in (a, b))
        edge = tuple(sorted((ka, kb)))
        if ka == kb or edge in unique:
            continue
        unique.add(edge)
        adjacency[ka].append(len(edges))
        adjacency[kb].append(len(edges))
        edges.append((ka, kb))
    used, closed, opened = set(), [], []
    for index, (a, b) in enumerate(edges):
        if index in used:
            continue
        used.add(index)
        points, last = [a, b], b
        while last != a:
            following = next((j for j in adjacency[last] if j not in used), None)
            if following is None:
                break
            used.add(following)
            c, d = edges[following]
            last = d if c == last else c
            points.append(last)
        is_closed = last == a
        if is_closed:
            points.pop()
        # Triangle diagonals introduce collinear intermediate vertices. Removing
        # those changes neither the section shape nor its real wall thickness.
        simplified = []
        for point in points:
            while len(simplified) > 1 and collinear(simplified[-2], simplified[-1], point):
                simplified.pop()
            simplified.append(point)
        if is_closed:
            while len(simplified) > 3 and collinear(simplified[-2], simplified[-1], simplified[0]):
                simplified.pop()
            while len(simplified) > 3 and collinear(simplified[-1], simplified[0], simplified[1]):
                simplified.pop(0)
        path = 'M' + 'L'.join(','.join(format(n/1e5, '.5f').rstrip('0').rstrip('.') for n in p) for p in simplified)
        (closed if is_closed else opened).append(path + ('Z' if is_closed else ''))
    return ' '.join(closed), ' '.join(opened)


def collinear(a, b, c):
    ab, bc = (b[0]-a[0], b[1]-a[1]), (c[0]-b[0], c[1]-b[1])
    return ab[0]*bc[1] == ab[1]*bc[0] and ab[0]*bc[0] + ab[1]*bc[1] >= 0


def plan_openings(info):
    openings = []
    for opening in info['openings']:
        kind = opening['kind']
        if kind not in ('door', 'window', 'sliding'):
            continue
        x, z = opening['center_m']
        along_x = opening['axis'] == 'x'
        half = opening['width_m'] / 2
        dx, dz = (half, 0) if along_x else (0, half)
        item = {'id': opening['id'], 'kind': kind,
                'segment': [[round(x-dx, 5), round(z-dz, 5)], [round(x+dx, 5), round(z+dz, 5)]]}
        if kind == 'door':
            # Use the same leaf width as archisketchWebData. Swing is emitted
            # only where source metadata explicitly supplies hinge and direction.
            width = opening.get('leaf_width_m', .8)
            direction = -1 if opening.get('hinge_end') == 'positive' else 1
            vx, vz = (direction*width, 0) if along_x else (0, direction*width)
            hinge = [x-vx/2, z-vz/2]
            item['leaf'] = [[round(v, 5) for v in hinge], [round(x+vx/2, 5), round(z+vz/2, 5)]]
            if 'hinge_end' in opening and 'swing_sign' in opening:
                swing = []
                for step in range(17):
                    angle = opening['swing_sign'] * math.pi/2 * step/16
                    swing.append([round(hinge[0]+vx*math.cos(angle)+vz*math.sin(angle), 5),
                                  round(hinge[1]-vx*math.sin(angle)+vz*math.cos(angle), 5)])
                item['leaf'] = [[round(v, 5) for v in hinge], swing[-1]]
                item['swing'] = swing
                item['operationBasis'] = opening.get('operation_basis', 'source_metadata')
        openings.append(item)
    return openings


def build_plans():
    for kind, form, revision in MODELS:
        source = Path(f'assets/models/acro-river-park/{kind}/{revision}/{form}/model-info.json')
        path = ROOT / source
        info = json.loads(path.read_text())
        rooms = [{key: r.get(key) for key in ['id', 'name', 'polygon_m', 'bounds_m', 'polygon_area_m2']} for r in info['rooms']]
        assert all(r['polygon_m'] and len(r['bounds_m']) == 4 for r in rooms)
        glb = source.with_name(f'acro{kind}-{form}.glb')
        architecture = {'sliceHeight_m': 1, 'walls': Glb(ROOT / glb).wall_sections(1),
                        'openings': plan_openings(info),
                        'source': {'glb': str(glb), 'sha256': sha(ROOT / glb),
                                   'method': 'world-space GLB triangle cross-section at y=1m; source metadata openings'}}
        variant = f'{kind}-{form}-archisketch'
        write(f'floorplans/{variant}.json', dict(variant=variant, revision=info['finish_revision'], units='m', bounds=info['bounds_m'], rooms=rooms, source=str(source), sha256=sha(path), unitMapping='unknown', basis='아키스케치 좌표 기반 체험 평면 · 실측/특정 세대 연결 미확인', architecture=architecture))


def build_catalog():
    site = json.loads((ROOT / 'assets/location/acro-river-park/site-context.json').read_text())
    write('acro-site-selection.json', {'source': 'OpenStreetMap community height/levels tags, not building registry', 'buildings': [{k: b[k] for k in ['id', 'title', 'levels', 'height_m']} for b in site['buildings']]})
    files = {n: EVIDENCE / 'data' / n for n in ['building-type-observations.json', 'complex-type-catalog.json', 'verified-unit-mappings.json']}
    rows = {n: json.loads(p.read_text())['rows'] for n, p in files.items()}
    assert not rows['verified-unit-mappings.json'], 'Verified units need a separate reviewed runtime contract; never auto-promote them.'
    assert all(r['floor'] is None and r['unit_label'] is None and not r['eligible_for_unit_selection'] for r in rows['building-type-observations.json'])
    write('acro-evidence.json', {'schema': 'cortex.service-public-evidence.v1', 'basis': 'S4 observed source UI/catalog; not building registry; no verified unit mappings', 'sources': {n: {'path': str(p.relative_to(ROOT.parent)), 'sha256': sha(p)} for n, p in files.items()}, 'buildingObservations': rows['building-type-observations.json'], 'planCatalog': rows['complex-type-catalog.json'], 'verifiedUnits': []})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plans-only', action='store_true', help='Regenerate only the four lightweight 2D plans')
    args = parser.parse_args()
    build_plans()
    if not args.plans_only:
        build_catalog()
    print('Generated 4 lightweight plans' + ('.' if args.plans_only else ', OSM building catalog and scoped source observations.') + ' Source artifacts unchanged.')
