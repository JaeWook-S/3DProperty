// Synthetic unit-test cube, or a real Blender export supplied by the test runner.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BoxGeometry } from 'three';

export function generatedFixture() {
  if (process.env.GENERATED_ASSET_FIXTURE) {
    const asset = JSON.parse(readFileSync(process.env.GENERATED_ASSET_FIXTURE, 'utf8'));
    return { asset, bytes: readFileSync(join(dirname(process.env.GENERATED_ASSET_FIXTURE), 'model.glb')) };
  }
  const geometry = new BoxGeometry(.8, .75, .6);
  const positions = geometry.attributes.position.array, normals = geometry.attributes.normal.array, indices = geometry.index.array;
  const buffers = [positions, normals, indices].map(array => Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  const bin = Buffer.concat(buffers);
  const doc = { asset: { version: '2.0', generator: 'synthetic unit test, not Blender' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [0, .375, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [.55, .32, .14, 1], metallicFactor: 0, roughnessFactor: .6 } }],
    buffers: [{ byteLength: bin.length }], bufferViews: buffers.map((buffer, index) => ({ buffer: 0,
      byteOffset: buffers.slice(0, index).reduce((sum, value) => sum + value.length, 0), byteLength: buffer.length })),
    accessors: [{ bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: [-.4, -.375, -.3], max: [.4, .375, .3] },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' }] };
  const json = Buffer.from(JSON.stringify(doc)), paddedJson = Buffer.concat([json, Buffer.alloc((-json.length) & 3, 32)]);
  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + paddedJson.length + 8 + bin.length, 8);
  jsonHeader.writeUInt32LE(paddedJson.length); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binHeader.writeUInt32LE(bin.length); binHeader.writeUInt32LE(0x004e4942, 4);
  const bytes = Buffer.concat([header, jsonHeader, paddedJson, binHeader, bin]);
  const id = `${'d'.repeat(32)}-000`;
  return { bytes, asset: { schema_version: 'cortex.furniture.v0', asset_id: id, revision: 'stub-blender-v1', units: 'm',
    coordinate_space: 'gltf-y-up', front_axis: '+Z', pivot: 'bottom-center', dimensions_m: { width: .8, depth: .6, height: .75 },
    dimension_basis: 'estimated', scale_status: 'metric-estimated', confidence: null, geometry_kind: 'glb',
    model_uri: `/api/furniture/assets/${id}/model.glb`, manifest_uri: `/api/furniture/assets/${id}/asset.json`,
    model_sha256: createHash('sha256').update(bytes).digest('hex'), title: '테스트 테이블 · chair', generation_provider: 'stub-no-api',
    provenance: { sample_id: 'synthetic-test', method: 'Synthetic test geometry, not model inference', implementation_revision: 'test',
      weights_id: null, scale_reference_used: false, scale_reference_description: null } } };
}
