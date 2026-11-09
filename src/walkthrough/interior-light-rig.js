import { Group, RectAreaLight, Vector3 } from 'three';

// Interior AREA sources read on CPU from the 4096-spp reference's original
// 168C expanded BLEND. Blender (X,Y,Z) -> glTF/Three (X,Z,-Y).
// All interior sources are SQUARE (size_y is irrelevant), with local -Z
// emission facing down after the -90 degree X basis conversion.
// Blender watts and Three nits are not interchangeable. The calibration below
// is deliberately independent of the preserved source watts.
const DOWN = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
const WARM = [1, .8999999761581421, .7599999904632568];
const TASK = [1, .9200000166893005, .8199999928474426];
export const INTERIOR_LIGHT_REFERENCE = Object.freeze({
  source: 'assets/models/acro-river-park/168c/archisketch-metric-v1/expanded/acro168c-expanded.blend',
  sha256: 'cc636e6dd2dbf4a4802c87747315e3a256500c0f1de99a15e7b0846e9ba82ad2',
  coordinateTransform: 'Blender [X,Y,Z] -> Three [X,Z,-Y]',
  sourceUnits: 'Blender watts; dimensions and positions in meters',
  excludes: 'Exterior Sky/Sun and emissive mesh geometry; neither is duplicated here',
});
const source = (name, position, width, watts, color = WARM) => ({ name, position, width, height: width, watts, color, quaternion: DOWN, basis: 'saved_blend_area_light' });
export const AUTHORED_168C_INTERIOR_LIGHTS = Object.freeze([
  source('Interior entry-storage', [9.192749977111816, 2.380000114440918, 1.7734999656677246], 1.399999976158142, 35),
  source('Interior bedroom-1', [2.3434998989105225, 2.380000114440918, 8.281000137329102], 1.399999976158142, 35),
  source('Interior bathroom-1', [1.7354999780654907, 2.380000114440918, 5.602499961853027], 1.399999976158142, 35),
  source('Interior living-kitchen-hall', [16.069000244140625, 2.380000114440918, 8.277999877929688], 1.399999976158142, 120),
  source('Interior hall-pantry', [5.7804999351501465, 2.380000114440918, 4.343999862670898], 1.399999976158142, 35),
  source('Interior bedroom-3', [9.007499694824219, 2.380000114440918, 8.178000450134277], 1.399999976158142, 35),
  source('Interior primary', [16.834999084472656, 2.380000114440918, 3.1010000705718994], 1.399999976158142, 35),
  source('Interior primary-bath', [13.005000114440918, 2.380000114440918, 3.3450000286102295], 1.399999976158142, 35),
  source('Interior dressing', [11.59850025177002, 2.380000114440918, 1.4930000305175781], 1.399999976158142, 35),
  source('Interior hall-storage', [12.359999656677246, 2.380000114440918, 4.486000061035156], 1.399999976158142, 35),
  source('Interior bedroom-2', [5.7870001792907715, 2.380000114440918, 8.281000137329102], 1.399999976158142, 35),
  source('Kitchen task light', [11.949999809265137, 2.390000104904175, 9.399999618530273], 2, 75, TASK),
  source('Living fill', [17.200000762939453, 2.390000104904175, 8.399999618530273], 3, 100, TASK),
].map(item => Object.freeze({ ...item, position: Object.freeze(item.position), color: Object.freeze([...item.color]), quaternion: Object.freeze([...item.quaternion]) })));

// Appearance-only calibration. These values are not measurements or a watts to
// lumens conversion. The integration owner can tune gain against a fixed view.
export const INTERIOR_LIGHT_CALIBRATION = Object.freeze({
  day: Object.freeze({ gain: .18, color: [1, 1, 1] }),
  sunset: Object.freeze({ gain: .24, color: [1, .92, .80] }),
  night: Object.freeze({ gain: .30, color: [1, .90, .76] }),
});

function fallbackSources(info) {
  const bounds = info.bounds_m ?? [0, 0, 14, 9];
  const positions = info.lightPositions?.length ? info.lightPositions : [[(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]];
  return positions.flatMap((p, i) => {
    if (!Array.isArray(p) || p.length < 2 || !p.slice(0, 2).every(Number.isFinite)) return [];
    const room = info.rooms?.[i];
    const width = Math.max(.6, Math.min(1.4, (room?.width_m ?? 2.5) * .55, (room?.depth_m ?? 2.5) * .55));
    return [{ ...source(`Approximate interior light ${room?.id ?? i}`, [p[0], (info.ceilingHeight_m ?? 2.6) - .12, p[1]], width, 35), basis: 'room_representative_point_appearance_assumption' }];
  });
}

// No geometry/material mutation, no asynchronous loads, no GPU initialization.
// The caller initializes RectAreaLightUniformsLib once when this feature is used.
// IMPORTANT: RectAreaLight does not cast shadows in Three WebGL. This is a
// direct/specular light rig, not GI or a replacement for contact/occlusion passes.
// The group starts hidden. Parent must gate setEnabled() to interior tour only;
// site-appearance hides direct scene lights but cannot hide nested light groups.
export function createInteriorLightRig({ maxLights = 6, gain = 1 } = {}) {
  if (!Number.isInteger(maxLights) || maxLights < 1 || maxLights > 13) throw Error('maxLights must be between 1 and 13');
  if (!Number.isFinite(gain) || gain < 0) throw Error('gain must be finite and nonnegative');
  const group = new Group();
  group.name = 'Interior reference area lights';
  group.visible = false;
  group.userData = { interiorAppearance: true, collisionDisabled: true };
  const lights = Array.from({ length: maxLights }, () => {
    const light = new RectAreaLight(0xffffff, 0, 1, 1);
    light.visible = false; group.add(light); return light;
  });
  let sources = [], selected = [], lighting = 'day', enabled = false, disposed = false, calibrationGain = gain;
  const focus = new Vector3();
  const assertAlive = () => { if (disposed) throw Error('Interior light rig is disposed'); };
  function assignSource(light, item) {
    const calibration = INTERIOR_LIGHT_CALIBRATION[lighting];
    light.name = item.name;
    light.position.fromArray(item.position); light.quaternion.fromArray(item.quaternion).normalize();
    light.width = item.width; light.height = item.height;
    light.color.setRGB(...item.color.map((c, i) => c * calibration.color[i]));
    light.intensity = item.watts / (item.width * item.height) * calibration.gain * calibrationGain;
    light.userData = { sourceBasis: item.basis, sourceWatts: item.watts, appearanceCalibration: calibration.gain * calibrationGain };
  }
  function refresh() {
    // A bounded pool avoids compiling shaders for every source light in a house.
    // Stable names break equal-distance ties deterministically.
    selected = sources.map(item => ({ item, d: (item.position[0] - focus.x) ** 2 + (item.position[2] - focus.z) ** 2 }))
      .sort((a, b) => a.d - b.d || a.item.name.localeCompare(b.item.name)).slice(0, maxLights).map(x => x.item);
    lights.forEach((light, index) => {
      const item = selected[index]; light.visible = Boolean(item);
      if (!item) { light.intensity = 0; light.userData = {}; return; }
      assignSource(light, item);
    });
    group.visible = enabled && selected.length > 0;
  }
  return {
    group,
    setModel(info = {}) {
      assertAlive();
      sources = info.unitType === '168C' && info.variant === 'expanded' ? [...AUTHORED_168C_INTERIOR_LIGHTS] : fallbackSources(info);
      const b = info.bounds_m ?? [0, 0, 14, 9]; focus.set((b[0] + b[2]) / 2, 0, (b[1] + b[3]) / 2); refresh();
    },
    setLighting(value) { assertAlive(); if (!Object.hasOwn(INTERIOR_LIGHT_CALIBRATION, value)) throw Error(`Unknown lighting: ${value}`); lighting = value; refresh(); },
    setGain(value) { assertAlive(); if (!Number.isFinite(value) || value < 0) throw Error('gain must be finite and nonnegative'); calibrationGain = value; refresh(); },
    setEnabled(value) { assertAlive(); enabled = Boolean(value); group.visible = enabled && selected.length > 0; },
    updateFocus(position) {
      assertAlive(); const p = Array.isArray(position) ? position : [position?.x, position?.y, position?.z];
      if (p.length < 3 || !p.slice(0, 3).every(Number.isFinite)) throw Error('focus must be a finite XYZ position');
      // Reuse current pool while the viewer makes sub-meter moves.
      const distance = (p[0] - focus.x) ** 2 + (p[2] - focus.z) ** 2;
      if (distance < .25) return false;
      focus.fromArray(p); refresh(); return true;
    },
    // Explicit snapshot for an isolated path-tracing scene. Unlike the raster
    // pool, every source is included, even when it is behind the current view.
    // Returned lights have no parent or mutable objects shared with this rig;
    // caller owns them and must rebuild the snapshot after preset/model changes.
    // Group visibility does not suppress this explicit operation: the caller
    // decides whether its separate PT scene is active. No Sky/Sun is added here.
    createPathtraceLights() {
      assertAlive();
      return sources.map(item => {
        const light = new RectAreaLight(); assignSource(light, item);
        light.visible = true;
        light.userData.pathtraceSnapshot = true;
        light.updateMatrix();
        return light;
      });
    },
    inspect() { return { enabled, visible: group.visible, lighting, sourceCount: sources.length, activeCount: selected.length, maxLights, gain: calibrationGain,
      limitation: 'RectAreaLight has no shadow support; no GI or measured photometry',
      sources: lights.filter(l => l.visible).map(l => ({ name: l.name, position: l.position.toArray(), quaternion: l.quaternion.toArray(), width: l.width, height: l.height, color: l.color.toArray(), intensity: l.intensity, ...l.userData })) }; },
    dispose() { if (disposed) return; disposed = true; enabled = false; group.visible = false; group.removeFromParent(); group.clear(); sources = []; selected = []; },
  };
}
