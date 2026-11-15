import { generateMaps, swatchPixels } from './procedural-textures.js';

// Off-main-thread synthesis. Buffers are transferred, never copied.
self.onmessage = ({ data }) => {
  try {
    const maps = generateMaps(data.recipe, data.size);
    const swatch = data.swatch ? swatchPixels(maps, data.swatch, data.swatchRepeat ?? 1) : null;
    const transfer = [maps.albedo.buffer, maps.normal.buffer, maps.orm.buffer, ...(swatch ? [swatch.buffer] : [])];
    self.postMessage({ id: data.id, ok: true, maps, swatch }, transfer);
  } catch (error) { self.postMessage({ id: data.id, ok: false, error: error.message }); }
};
