import { Color, RenderTarget, Vector4 } from 'three';

// Explicit ownership adapter for three-gpu-pathtracer 0.0.24. Its public
// dispose() omits the low-resolution renderer and physical-material uniforms.
// Do not replace this allowlist with a recursive walk: scene/material/background
// references also contain borrowed application objects.
export const PATHTRACE_DISPOSAL_VERSION = '0.0.24';
const completed = new WeakMap();
const constructorMaterials = new WeakMap();
const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');

// v0.0.24's SobolNumberMapGenerator drops its temporary material after render.
// Capture only materials rendered into the constructor's two Sobol targets.
// The scoped synchronous hook is always removed before returning to the app.
export function createManagedPathTracer(TracerClass, renderer) {
  if (typeof TracerClass !== 'function' || typeof renderer?.render !== 'function') {
    throw new TypeError('A path tracer constructor and renderer are required');
  }
  const render = renderer.render, ownRender = Object.hasOwn(renderer, 'render');
  const state = {
    target: renderer.getRenderTarget?.(), face: renderer.getActiveCubeFace?.(), mip: renderer.getActiveMipmapLevel?.(),
    viewport: renderer.getViewport?.(new Vector4()), scissor: renderer.getScissor?.(new Vector4()),
    scissorTest: renderer.getScissorTest?.(), color: renderer.getClearColor?.(new Color()), alpha: renderer.getClearAlpha?.(),
    autoClear: renderer.autoClear, toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure,
  };
  const captures = [];
  renderer.render = function (object, ...args) {
    const target = renderer.getRenderTarget?.(), materials = Array.isArray(object?.material) ? object.material : [object?.material];
    // Explicit pinned shader fingerprint: do not register arbitrary scene assets.
    for (const material of materials) if (target && target !== state.target && material?.isShaderMaterial &&
      material.fragmentShader?.includes('generateSobolPoint( index )')) captures.push({ target, material });
    return render.call(this, object, ...args);
  };
  try {
    const tracer = new TracerClass(renderer);
    const targets = new Set([tracer._pathTracer?._sobolTarget, tracer._lowResPathTracer?._sobolTarget]);
    constructorMaterials.set(tracer, [...new Set(captures.filter(entry => targets.has(entry.target)).map(entry => entry.material))]);
    return tracer;
  } catch (error) {
    // Constructor failure leaves no tracer handle. Release only the temporary
    // Sobol shader/target pairs identified above, never the previous target.
    const seen = new Set();
    for (const entry of captures) for (const resource of [entry.material, entry.target]) {
      if (!seen.has(resource)) { seen.add(resource); try { resource.dispose(); } catch { /* preserve the constructor error */ } }
    }
    throw error;
  } finally {
    if (ownRender) renderer.render = render; else delete renderer.render;
    // Keep render-state restoration independent: one lost-context failure must
    // not prevent restoring the remaining JS settings and original hook.
    const restore = action => { try { action(); } catch { /* lost context */ } };
    if (state.target !== undefined) restore(() => renderer.setRenderTarget?.(state.target, state.face, state.mip));
    if (state.viewport) restore(() => renderer.setViewport?.(state.viewport));
    if (state.scissor) restore(() => renderer.setScissor?.(state.scissor));
    if (state.scissorTest !== undefined) restore(() => renderer.setScissorTest?.(state.scissorTest));
    if (state.color) restore(() => renderer.setClearColor?.(state.color, state.alpha));
    renderer.autoClear = state.autoClear; renderer.toneMapping = state.toneMapping; renderer.toneMappingExposure = state.exposure;
  }
}

export function disposePathtraceResources(tracer) {
  if (!objectLike(tracer)) return { disposed: false, alreadyDisposed: false, resources: 0, errors: [] };
  if (completed.has(tracer)) return { ...completed.get(tracer), alreadyDisposed: true };
  const report = { disposed: true, alreadyDisposed: false, resources: 0, errors: [] };
  completed.set(tracer, report);
  const seen = new Set(), borrowed = new Set();
  for (const value of [tracer._previousEnvironment, tracer._previousBackground, tracer.scene?.environment, tracer.scene?.background]) if (objectLike(value)) borrowed.add(value);
  // _materials is the library's list of input snapshot materials, not its shader.
  for (const material of tracer._materials ?? []) {
    if (!objectLike(material)) continue;
    borrowed.add(material);
    for (const value of Object.values(material)) if (value?.isTexture) borrowed.add(value);
  }
  function dispose(resource, name, invoke = null) {
    if (!objectLike(resource) || seen.has(resource) || borrowed.has(resource)) return;
    seen.add(resource);
    if (typeof resource.dispose !== 'function') return;
    try { if (invoke) invoke(); else resource.dispose(); report.resources++; }
    catch (error) { report.errors.push({ resource: name, message: error?.message ?? String(error) }); }
  }
  function quad(quadObject, name) {
    // FullScreenQuad uses Pass.js's shared module-level geometry. It is not
    // tracer-owned; disposing it here would also evict the application's passes.
    dispose(quadObject?.material, `${name}.material`);
  }
  function textureArray(texture, name) {
    if (!texture || borrowed.has(texture)) return;
    // Three 0.186 WebGLArrayRenderTarget replaces its texture after the base
    // constructor, so texture.renderTarget is null. Once actually uploaded,
    // WebGLTextures stores the owned attachment target in renderer properties.
    // Never-uploaded array targets/copy quads have no GPU allocation/program.
    const properties = tracer._renderer?.properties;
    const uploaded = properties?.has?.(texture) ? properties.get(texture).__renderTarget : null;
    const target = texture.renderTarget ?? uploaded;
    if (target?.isRenderTarget) {
      quad(target.fsQuad, `${name}.copyQuad`);
      // Its subclass dispose also disposes shared fullscreen geometry. The
      // owned copy material was handled above; release the target event only.
      dispose(target, `${name}.renderTarget`, () => RenderTarget.prototype.dispose.call(target));
      // The render target owns its attachment. Do not dispose it a second time.
      seen.add(texture);
    } else dispose(texture, name);
  }
  function physicalMaterial(material, name) {
    if (!material || borrowed.has(material) || seen.has(material)) return;
    const value = key => material.uniforms?.[key]?.value ?? material[key];
    const bvh = value('bvh');
    for (const key of ['index', 'position', 'bvhBounds', 'bvhContents']) dispose(bvh?.[key], `${name}.bvh.${key}`);
    const attributes = value('attributesArray');
    for (const [i, texture] of (attributes?._textures ?? []).entries()) dispose(texture, `${name}.attributesArray.${i}`);
    for (const key of ['attributesArray', 'materialIndexAttribute', 'materials', 'stratifiedTexture', 'stratifiedOffsetTexture']) dispose(value(key), `${name}.${key}`);
    dispose(value('lights')?.tex, `${name}.lights.tex`);
    const environment = value('envMapInfo');
    for (const key of ['map', 'marginalWeights', 'conditionalWeights']) dispose(environment?.[key], `${name}.envMapInfo.${key}`);
    textureArray(value('textures'), `${name}.textures`);
    textureArray(value('iesProfiles'), `${name}.iesProfiles`);
    // backgroundMap can be the caller's environment. sobolTexture belongs to a
    // renderer target below. Other uniforms are not owned by this adapter.
    dispose(material, name);
  }
  function pathRenderer(path, name) {
    if (!objectLike(path)) return;
    const material = path.material ?? path._fsQuad?.material;
    if (material?.removeEventListener && path._compileFunction) material.removeEventListener('recompilation', path._compileFunction);
    for (const [key, resource] of [['_primaryTarget', path._primaryTarget], ['_sobolTarget', path._sobolTarget]]) dispose(resource, `${name}.${key}`);
    for (const [i, target] of (path._blendTargets ?? []).entries()) dispose(target, `${name}._blendTargets.${i}`);
    physicalMaterial(material, `${name}.material`);
    quad(path._blendQuad, `${name}._blendQuad`);
    path._task = null; path._compilePromise = null;
  }

  for (const [i, material] of (constructorMaterials.get(tracer) ?? []).entries()) dispose(material, `constructor.sobolMaterial.${i}`);
  constructorMaterials.delete(tracer);
  pathRenderer(tracer._pathTracer, '_pathTracer');
  pathRenderer(tracer._lowResPathTracer, '_lowResPathTracer');
  quad(tracer._quad, '_quad');
  dispose(tracer._colorBackground, '_colorBackground');
  dispose(tracer._internalBackground, '_internalBackground');
  const generator = tracer._generator, staticGenerator = generator?.staticGeometryGenerator;
  dispose(generator?.geometry, '_generator.geometry');
  if (staticGenerator?._intermediateGeometry instanceof Map) {
    for (const [key, geometry] of staticGenerator._intermediateGeometry) dispose(geometry, `_generator.baked.${key}`);
    staticGenerator._intermediateGeometry.clear();
  }
  dispose(staticGenerator?._dummyMesh?.geometry, '_generator.dummy.geometry');
  dispose(staticGenerator?._dummyMesh?.material, '_generator.dummy.material');
  if (staticGenerator) { staticGenerator.objects = []; staticGenerator._mergeOrder = []; staticGenerator._dummyMesh = null; }
  if (generator) generator.bvh = null;
  // Drop references only. The owner separately disposes snapshot and environment.
  for (const key of ['scene', 'camera', '_previousScene', '_previousEnvironment', '_previousBackground', '_internalBackground', '_colorBackground', '_materials']) if (key in tracer) tracer[key] = null;
  tracer.pausePathTracing = true; tracer.enablePathTracing = false;
  return report;
}
