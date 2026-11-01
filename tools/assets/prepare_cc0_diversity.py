#!/usr/bin/env python3
"""Package the three reviewed CC0 candidates without changing GLB bytes or scale."""
import hashlib
import json
import shutil
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT.parent / 'AisideProject/realestate-spatial-ai/experiments/service-appearance/2026-10-23-cc0-diversity'
ASSETS = [
    ('sofa_02', 'sofa-02', '클래식 쿠션 소파', 'sofa'),
    ('modern_coffee_table_01', 'modern-coffee-table-01', '낮은 거실 테이블', 'coffee_table'),
    ('dining_chair_02', 'dining-chair-02', '가죽 식탁의자', 'dining_chair'),
]

def digest(data):
    return hashlib.sha256(data).hexdigest()

def preserve_write(path, data):
    if path.exists() and path.read_bytes() != data:
        raise RuntimeError(f'Refusing to overwrite a different reviewed asset: {path}')
    path.write_bytes(data)

def main():
    results = []
    for source_id, slug, title, role in ASSETS:
        metadata_path = SOURCE / 'candidates' / source_id / 'manifest.json'
        metadata = json.loads(metadata_path.read_text())
        assert metadata['status'] == 'ready_for_S1_integration_not_active'
        assert all(metadata['checks'].values())
        raw = (SOURCE / metadata['glb']['path']).read_bytes()
        assert digest(raw) == metadata['glb']['sha256']
        assert len(raw) == metadata['glb']['bytes'] < 8 * 1024 * 1024
        magic, version, size = struct.unpack_from('<III', raw)
        assert (magic, version, size) == (0x46546c67, 2, len(raw))
        length, kind = struct.unpack_from('<II', raw, 12)
        assert kind == 0x4e4f534a
        doc = json.loads(raw[20:20+length])
        assert not any('uri' in item for item in doc.get('buffers', []) + doc.get('images', []))
        assert all(m.get('extras', {}).get('appearance_policy') == 'authored-pbr-v1' for m in doc['materials'])
        if source_id == 'modern_coffee_table_01':
            assert doc['materials'][0]['pbrMetallicRoughness']['metallicFactor'] == 0
        geometry = metadata['geometry']
        out = ROOT / 'assets/furniture/cc0' / slug
        out.mkdir(parents=True, exist_ok=True)
        preserve_write(out / 'model.glb', raw)
        author = ', '.join(metadata['authors'])
        preview = SOURCE / next(x['path'] for x in metadata['preview'] if x['view'] == 'three-quarter')
        record = {
            'schema_version': 1, 'id': f'cc0-{slug}', 'title': title,
            'kind': f'catalog:{slug}', 'role': role, 'geometry_kind': 'glb',
            'model_file': 'model.glb', 'model_sha256': digest(raw),
            'model_bytes': len(raw), 'source_model_sha256': digest(raw),
            'dimensions_m': dict(zip(['width','depth','height'], geometry['width_depth_height_m'])),
            'dimension_basis': 'source_model_bounds_not_physical_measurement',
            'physical_measurement_verified': False, 'unit': 'm', 'scale': [1,1,1],
            'original_bounds_xyz': {'min': geometry['AABB_min_xyz'], 'max': geometry['AABB_max_xyz']},
            'front_direction': geometry['front'],
            'dimension_note': ('긴 변은 모델 Z축입니다. 60.0 × 120.2 × 39.0cm는 모델 가로·깊이·높이이며 제품 실측이 아닙니다.'
                               if role == 'coffee_table' else '원본 모델의 가로·깊이·전체 높이입니다. 좌면 높이나 제품 실측이 아닙니다.'),
            'runtime_normalization': 'translation only: center X/Z and ground minimum Y; preserve original node transforms and scale',
            'source': {'official_page': metadata['source_url'], 'author': author,
                       'license': metadata['license'], 'license_url': metadata['license_url'],
                       'license_deed': 'https://creativecommons.org/publicdomain/zero/1.0/',
                       'official_info': f'https://api.polyhaven.com/info/{source_id}',
                       'official_files': f'https://api.polyhaven.com/files/{source_id}',
                       'api_attribution': 'Poly Haven; offline asset package, no production API integration',
                       'physical_sku_reference': None, 'field_measurement_reference': None},
            'triangles': metadata['triangles'], 'materials': [m['name'] for m in doc['materials']],
            'appearance_policy': 'authored-pbr-v1', 'original_BIN_and_images_preserved': True,
            'candidate_copied_byte_identical': True,
            'preview_file': 'preview.png', 'preview_basis': 'CPU render of the delivered GLB; not a product photograph',
            'integration_source_manifest_sha256': digest(metadata_path.read_bytes()),
            'GPU_used': False,
        }
        preserve_write(out / 'manifest.json', (json.dumps(record, ensure_ascii=False, indent=2)+'\n').encode())
        preserve_write(out / 'preview.png', preview.read_bytes())
        notice = f"{metadata['name']} by {author} / Poly Haven\nLicense: CC0-1.0\nSource: {metadata['source_url']}\nLicense: {metadata['license_url']}\nhttps://creativecommons.org/publicdomain/zero/1.0/\n\nOriginal model scale, geometry, UV and image bytes preserved.\nSource candidate adds authored-pbr-v1 metadata; this package copies it unchanged.\nDimensions describe model bounds, not verified physical product measurements.\n"
        preserve_write(out / 'LICENSE.txt', notice.encode())
        results.append({'id': record['id'], 'path': str(out.relative_to(ROOT)), 'sha256': digest(raw), 'bytes': len(raw), 'dimensions_m': record['dimensions_m']})
    print(json.dumps(results, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
