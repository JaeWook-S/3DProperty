import { Matrix3, Matrix4, Mesh, Scene, TangentSpaceNormalMap, TextureSource, Vector3 } from 'three';

const SURFACE_OFFSET_M = .001;
const supportedMaterial = material => material?.isMeshStandardMaterial || material?.isMeshPhysicalMaterial;

// A path-tracing library may generate tangents and repack texture matrices. Give
// it owned render data, never the model used for editing, picking or collision.
export function createPathtraceSnapshot({ model, lights = [], environment = null, background = null, environmentIntensity = 1 } = {}) {
  if (!model?.isObject3D) throw new TypeError('A model Object3D is required.');
  const scene = new Scene();
  scene.name = 'Interior path-tracing snapshot';
  scene.environment = environment; scene.background = background;
  scene.environmentIntensity = environmentIntensity;
  const geometries = new Set(), materials = new Set(), textures = new Set(), ownedLights = new Set();
  const materialCache = new Map(), textureCache = new Map(), worlds = new WeakMap();
  const stats = { meshes: 0, triangles: 0, materials: 0, textures: 0, lights: 0, normalBasisCorrections: 0, surfaceOverrides: 0,
    skipped: { highlight: 0, unsupportedMaterial: 0, skinned: 0, instanced: 0, morph: 0, missingPosition: 0, line: 0, sprite: 0, light: 0 } };
  let disposed = false;

  // Do not call updateWorldMatrix on the source: even a read-only snapshot must
  // preserve its existing matrix values and dirty flags.
  function world(object) {
    if (worlds.has(object)) return worlds.get(object);
    const matrix = object.matrixWorldAutoUpdate === false ? object.matrixWorld.clone()
      : object.matrixAutoUpdate ? new Matrix4().compose(object.position, object.quaternion, object.scale) : object.matrix.clone();
    if (object.matrixWorldAutoUpdate !== false && object.parent) matrix.premultiply(world(object.parent));
    worlds.set(object, matrix); return matrix;
  }
  function inherited(object, key) {
    for (let current = object; current; current = current.parent) {
      if (current.userData?.[key]) return true;
      if (current === model) break;
    }
    return false;
  }
  function cloneTexture(texture) {
    if (!textureCache.has(texture)) {
      // Texture.copy calls needsUpdate and increments Source.version. Supplying
      // a separate Source first prevents even that mutation of the live model.
      const source = new TextureSource(texture.source.data);
      const clone = new texture.constructor().copy({ ...texture, source });
      textureCache.set(texture, clone); textures.add(clone);
    }
    return textureCache.get(texture);
  }
  function cloneMaterial(material, hasTangent) {
    let variants = materialCache.get(material);
    if (!variants) materialCache.set(material, variants = new Map());
    if (!variants.has(hasTangent)) {
      const clone = material.clone();
      for (const [key, value] of Object.entries(material)) if (value?.isTexture) clone[key] = cloneTexture(value);
      // GLTFLoader reverses Y for derivative tangents. The path tracer creates
      // explicit tangents, so reverse this renderer-specific adjustment only
      // on the owned material for a geometry which originally had no tangent.
      if (!hasTangent && material.normalMap && material.normalMapType === TangentSpaceNormalMap) {
        clone.normalScale.y *= -1; stats.normalBasisCorrections++;
      }
      if (!hasTangent && material.clearcoatNormalMap && clone.clearcoatNormalScale) {
        clone.clearcoatNormalScale.y *= -1; stats.normalBasisCorrections++;
      }
      variants.set(hasTangent, clone); materials.add(clone);
    }
    return variants.get(hasTangent);
  }
  function offsetSurface(geometry, matrix) {
    const position = geometry.attributes.position, normal = geometry.attributes.normal;
    if (!normal || Math.abs(matrix.determinant()) < 1e-12) throw new Error('Cannot offset a structural surface without a normal and invertible world transform.');
    const normalMatrix = new Matrix3().getNormalMatrix(matrix);
    const inverseLinear = new Matrix3().setFromMatrix4(matrix.clone().invert());
    const delta = new Vector3();
    for (let i = 0; i < position.count; i++) {
      delta.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize().multiplyScalar(SURFACE_OFFSET_M).applyMatrix3(inverseLinear);
      position.setXYZ(i, position.getX(i) + delta.x, position.getY(i) + delta.y, position.getZ(i) + delta.z);
    }
    position.needsUpdate = true;
    geometry.boundingBox = null; geometry.boundingSphere = null;
  }
  function fixedWorld(object, matrix) {
    object.matrixAutoUpdate = false; object.matrix.copy(matrix);
    object.matrixWorld.copy(matrix); object.matrixWorldNeedsUpdate = false;
  }
  function dispose() {
    if (disposed) return; disposed = true;
    scene.clear();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    for (const light of ownedLights) light.dispose?.();
    // environment/background belong to the caller and are deliberately borrowed.
    scene.environment = null; scene.background = null;
  }

  try {
    model.traverseVisible(object => {
      if (object.isLine) { stats.skipped.line++; return; }
      if (object.isSprite) { stats.skipped.sprite++; return; }
      if (!object.isMesh) return;
      if (inherited(object, 'surfaceHighlight')) { stats.skipped.highlight++; return; }
      if (object.isSkinnedMesh) { stats.skipped.skinned++; return; }
      if (object.isInstancedMesh) { stats.skipped.instanced++; return; }
      if (object.morphTargetInfluences?.length) { stats.skipped.morph++; return; }
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      if (!sourceMaterials.length || sourceMaterials.some(material => !supportedMaterial(material))) { stats.skipped.unsupportedMaterial++; return; }
      if (!object.geometry?.attributes.position) { stats.skipped.missingPosition++; return; }
      const geometry = object.geometry.clone(), matrix = world(object);
      geometries.add(geometry);
      if (inherited(object, 'surfaceOverride')) { offsetSurface(geometry, matrix); stats.surfaceOverrides++; }
      const copiedMaterials = sourceMaterials.map(material => cloneMaterial(material, Boolean(object.geometry.attributes.tangent)));
      const mesh = new Mesh(geometry, Array.isArray(object.material) ? copiedMaterials : copiedMaterials[0]);
      mesh.name = object.name;
      mesh.userData = { ...object.userData, pathtraceSnapshot: true, sourceUuid: object.uuid };
      mesh.castShadow = object.castShadow; mesh.receiveShadow = object.receiveShadow;
      mesh.renderOrder = object.renderOrder; mesh.frustumCulled = object.frustumCulled;
      fixedWorld(mesh, matrix); scene.add(mesh);
      stats.meshes++; stats.triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
    });
    for (const light of lights) {
      if (!light?.visible || !(light.isRectAreaLight || light.isDirectionalLight || light.isPointLight || light.isSpotLight)) { stats.skipped.light++; continue; }
      const clone = light.clone(false); clone.clear(); ownedLights.add(clone);
      for (const [key, value] of Object.entries(light)) if (value?.isTexture) clone[key] = cloneTexture(value);
      fixedWorld(clone, world(light)); scene.add(clone);
      if (light.target && clone.target) { clone.target.clear(); fixedWorld(clone.target, world(light.target)); scene.add(clone.target); }
      stats.lights++;
    }
    stats.materials = materials.size; stats.textures = textures.size;
    return { scene, dispose, stats };
  } catch (error) { dispose(); throw error; }
}
