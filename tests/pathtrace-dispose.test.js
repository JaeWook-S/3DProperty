import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, ShaderMaterial, Texture, WebGLRenderTarget } from 'three';
import { WebGLProperties } from 'three/src/renderers/webgl/WebGLProperties.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { PathTracingSceneGenerator, PhysicalPathTracingMaterial, WebGLPathTracer } from 'three-gpu-pathtracer/src/index.js';
import { createManagedPathTracer, disposePathtraceResources, PATHTRACE_DISPOSAL_VERSION } from '../src/walkthrough/pathtrace-dispose.js';

const tracker = () => {
  const counts = new Map();
  return { counts, add(resource) { if (!counts.has(resource)) { counts.set(resource, 0); resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1)); } return resource; } };
};
function rendererFixture(material, record) {
  const path = { material, _primaryTarget: record.add(new WebGLRenderTarget()), _sobolTarget: record.add(new WebGLRenderTarget()),
    _blendTargets: [record.add(new WebGLRenderTarget()), record.add(new WebGLRenderTarget())], _fsQuad: new FullScreenQuad(material),
    _blendQuad: new FullScreenQuad(record.add(new ShaderMaterial())), _task: {}, _compilePromise: Promise.resolve(), _compileFunction() {} };
  material.addEventListener('recompilation', path._compileFunction); return path;
}
function uploadArrays(material) {
  // Exercise the pinned library's real setTextures closure without a GL context.
  // WebGLTextures sets this same __renderTarget link during actual upload.
  const properties = WebGLProperties(), state = { target: null };
  const renderer = { properties, toneMapping: 0, getRenderTarget: () => state.target,
    getClearAlpha: () => 0, getClearColor: out => out.set(0), setClearColor() {},
    setRenderTarget(target) { state.target = target; if (target) properties.get(target.texture).__renderTarget = target; },
    render() {} };
  const targets = [];
  for (const key of ['textures', 'iesProfiles']) {
    const texture = material.uniforms[key].value;
    assert.equal(texture.renderTarget, null); // Current Three replaces this texture.
    texture.setTextures(renderer, [new Texture()]);
    targets.push(properties.get(texture).__renderTarget);
  }
  return { renderer, targets };
}
function recordMaterial(material, record, targets = []) {
  record.add(material);
  const u = key => material.uniforms[key].value;
  for (const key of ['index', 'position', 'bvhBounds', 'bvhContents']) record.add(u('bvh')[key]);
  for (const key of ['attributesArray', 'materialIndexAttribute', 'materials', 'stratifiedTexture', 'stratifiedOffsetTexture']) record.add(u(key));
  for (const texture of u('attributesArray')._textures) record.add(texture);
  record.add(u('lights').tex);
  for (const key of ['map', 'marginalWeights', 'conditionalWeights']) record.add(u('envMapInfo')[key]);
  if (targets.length) for (const target of targets) { record.add(target); record.add(target.fsQuad.material); }
  else for (const key of ['textures', 'iesProfiles']) record.add(u(key));
}

test('v0.0.24 owned resources are disposed once; original/snapshot/borrowed environment and global fullscreen geometry remain intact', () => {
  assert.equal(PATHTRACE_DISPOSAL_VERSION, '0.0.24');
  const record = tracker(), borrowed = tracker();
  const model = new Group(), sourceGeometry = borrowed.add(new BoxGeometry()), sourceMaterial = borrowed.add(new MeshStandardMaterial());
  sourceMaterial.map = borrowed.add(new Texture()); model.add(new Mesh(sourceGeometry, sourceMaterial));
  const environment = borrowed.add(new Texture()), background = borrowed.add(new Texture());
  const generator = new PathTracingSceneGenerator(model); const result = generator.generate();
  record.add(generator.geometry); for (const geometry of generator.staticGeometryGenerator._intermediateGeometry.values()) record.add(geometry);
  const material = new PhysicalPathTracingMaterial(); material.bvh.updateFrom(result.bvh);
  material.attributesArray.updateFrom(result.geometry.attributes.normal, result.geometry.attributes.tangent, result.geometry.attributes.uv, result.geometry.attributes.color);
  material.backgroundMap = environment;
  material.uniforms.notOwned = { value: borrowed.add(new Texture()) };
  const lowMaterial = new PhysicalPathTracingMaterial(); lowMaterial.backgroundMap = background;
  const uploaded = uploadArrays(material);
  recordMaterial(material, record, uploaded.targets); recordMaterial(lowMaterial, record);
  const primary = rendererFixture(material, record), low = rendererFixture(lowMaterial, record);
  borrowed.add(primary._fsQuad._mesh.geometry); // Pass.js shares this with all application's fullscreen passes.
  const tracer = { _renderer: uploaded.renderer, _pathTracer: primary, _lowResPathTracer: low, _quad: new FullScreenQuad(record.add(new ShaderMaterial())), _generator: generator,
    _materials: [sourceMaterial], scene: { environment, background, model }, _previousScene: model, _previousEnvironment: environment, _previousBackground: background,
    _colorBackground: record.add(new Texture()), _internalBackground: record.add(new Texture()) };
  const resultReport = disposePathtraceResources(tracer);
  assert.equal(resultReport.disposed, true); assert.deepEqual(resultReport.errors, []); assert.equal(resultReport.resources, record.counts.size);
  for (const count of record.counts.values()) assert.equal(count, 1);
  for (const count of borrowed.counts.values()) assert.equal(count, 0);
  assert.equal(generator.staticGeometryGenerator._intermediateGeometry.size, 0); assert.deepEqual(generator.staticGeometryGenerator.objects, []);
  assert.equal(tracer.scene, null); assert.equal(tracer._materials, null); assert.equal(tracer.enablePathTracing, false);
  assert.equal(primary._task, null); assert.equal(low._compilePromise, null);
  assert.equal(material.hasEventListener('recompilation', primary._compileFunction), false);
  assert.equal(disposePathtraceResources(tracer).alreadyDisposed, true);
  for (const count of record.counts.values()) assert.equal(count, 1);
});

test('shared shader/targets/uniform aliases are deduplicated and omitted unknown fields are never recursively disposed', () => {
  const record = tracker(), material = new PhysicalPathTracingMaterial(); recordMaterial(material, record);
  const primary = rendererFixture(material, record), low = rendererFixture(material, record);
  // Shared physical material occurs when dynamicLowRes is enabled.
  const oldTarget = low._primaryTarget; record.counts.delete(oldTarget); low._primaryTarget = primary._primaryTarget;
  const sentinel = new Texture(); let unexpected = 0; sentinel.addEventListener('dispose', () => unexpected++);
  const tracer = { _pathTracer: primary, _lowResPathTracer: low, somethingElse: sentinel, _previousEnvironment: sentinel };
  const report = disposePathtraceResources(tracer);
  assert.deepEqual(report.errors, []); assert.equal(unexpected, 0);
  for (const count of record.counts.values()) assert.equal(count, 1);
});

test('null/partial objects and disposal errors are contained; subsequent owned resources still release and repeat calls are safe', () => {
  assert.equal(disposePathtraceResources(null).disposed, false);
  let released = 0, original = 0;
  const source = { isTexture: true, dispose() { original++; } };
  const broken = { dispose() { throw Error('mock lost context'); } };
  const tracer = { _pathTracer: { _primaryTarget: broken, _blendTargets: [{ dispose() { released++; } }] },
    _materials: [{ map: source }], _internalBackground: source, _generator: { geometry: { dispose() { released++; } } } };
  const report = disposePathtraceResources(tracer);
  assert.equal(report.errors.length, 1); assert.equal(released, 2); assert.equal(original, 0);
  disposePathtraceResources(tracer); assert.equal(released, 2); assert.equal(original, 0);
});

function constructorRenderer(record) {
  const previous = record.add(new WebGLRenderTarget()), state = { target: previous, viewport: [1,2,320,200], scissor: [3,4,300,190], test: true, color: 0x123456, alpha: .3 };
  const renderer = { autoClear: false, toneMapping: 4, toneMappingExposure: 1.2,
    render(object) { assert.equal(this, renderer); if (renderer.throwOnRender) throw Error('constructor render failure'); },
    getRenderTarget: () => state.target, setRenderTarget(target) { state.target = target; },
    getViewport(out) { return out.fromArray(state.viewport); }, setViewport(v) { state.viewport = v.toArray(); },
    getScissor(out) { return out.fromArray(state.scissor); }, setScissor(v) { state.scissor = v.toArray(); },
    getScissorTest: () => state.test, setScissorTest(v) { state.test = v; },
    getClearColor(out) { return out.setHex(state.color); }, getClearAlpha: () => state.alpha,
    setClearColor(v, a) { state.color = v?.isColor ? v.getHex() : v; state.alpha = a; },
  };
  return { renderer, state, previous };
}
function sobolFixture(record) {
  const target = record.add(new WebGLRenderTarget()), material = record.add(new ShaderMaterial({ fragmentShader: 'void main() { generateSobolPoint( index ); }' }));
  return { target, material };
}

test('managed construction captures only the two Sobol shader materials, restores renderer state/hook, and disposes them once', () => {
  const record = tracker(), borrowed = tracker(), { renderer, state, previous } = constructorRenderer(borrowed);
  const render = renderer.render, before = structuredClone({ ...state, target: null });
  const one = sobolFixture(record), two = sobolFixture(record), source = borrowed.add(new MeshStandardMaterial());
  class FakeTracer {
    constructor(r) {
      for (const entry of [one, two]) { r.setRenderTarget(entry.target); r.render(new Mesh(new BoxGeometry(), entry.material)); }
      r.render(new Mesh(new BoxGeometry(), source));
      this._pathTracer = { _sobolTarget: one.target }; this._lowResPathTracer = { _sobolTarget: two.target };
      state.viewport = [8,8,8,8]; state.scissor = [7,7,7,7]; state.test = false; state.color = 0; state.alpha = 0;
      r.autoClear = true; r.toneMapping = 0; r.toneMappingExposure = 7;
    }
  }
  const tracer = createManagedPathTracer(FakeTracer, renderer);
  assert.equal(renderer.render, render); assert.equal(state.target, previous); assert.deepEqual({ ...state, target: null }, before);
  assert.equal(renderer.autoClear, false); assert.equal(renderer.toneMapping, 4); assert.equal(renderer.toneMappingExposure, 1.2);
  assert.deepEqual(disposePathtraceResources(tracer).errors, []); disposePathtraceResources(tracer);
  for (const count of record.counts.values()) assert.equal(count, 1);
  for (const count of borrowed.counts.values()) assert.equal(count, 0);
});

test('constructor failure restores the original render hook/state and releases only captured Sobol resources', () => {
  const record = tracker(), borrowed = tracker(), { renderer, state, previous } = constructorRenderer(borrowed);
  const render = renderer.render, entry = sobolFixture(record); renderer.throwOnRender = true;
  class BrokenTracer { constructor(r) { r.autoClear = true; r.setRenderTarget(entry.target); r.render(new Mesh(new BoxGeometry(), entry.material)); } }
  assert.throws(() => createManagedPathTracer(BrokenTracer, renderer), /constructor render failure/);
  assert.equal(renderer.render, render); assert.equal(state.target, previous); assert.equal(renderer.autoClear, false);
  for (const count of record.counts.values()) assert.equal(count, 1);
  for (const count of borrowed.counts.values()) assert.equal(count, 0);
});


test('actual pinned WebGLPathTracer constructor exposes two captured Sobol shaders for managed disposal without WebGL execution', async () => {
  const borrowed = tracker(), record = tracker(), { renderer, state, previous } = constructorRenderer(borrowed);
  renderer.getContextAttributes = () => ({ premultipliedAlpha: false });
  renderer.compileAsync = async () => {};
  const originalRender = renderer.render, materials = [];
  renderer.render = function (mesh, camera) { record.add(mesh.material); materials.push(mesh.material); return originalRender.call(this, mesh, camera); };
  const hook = renderer.render;
  const tracer = createManagedPathTracer(WebGLPathTracer, renderer);
  assert.equal(renderer.render, hook); assert.equal(state.target, previous); assert.equal(materials.length, 2);
  assert.ok(materials.every(material => material.fragmentShader.includes('generateSobolPoint( index )')));
  assert.deepEqual(disposePathtraceResources(tracer).errors, []);
  await Promise.resolve();
  for (const count of record.counts.values()) assert.equal(count, 1);
  for (const count of borrowed.counts.values()) assert.equal(count, 0);
});
