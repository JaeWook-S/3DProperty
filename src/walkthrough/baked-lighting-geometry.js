// Render data belongs to the lighting layer; collision/picking use source buffers.
const renderData = new WeakMap();
export const bakedRenderData = mesh => renderData.get(mesh);
export function setBakedRenderData(mesh, data) { renderData.set(mesh, data); }
export function clearBakedRenderData(mesh) { renderData.delete(mesh); }
