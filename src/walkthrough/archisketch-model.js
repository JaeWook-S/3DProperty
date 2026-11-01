import { pointInRoom } from './minimap-geometry.js';

// GLB and room polygons share meter-valued X/Z coordinates. No rescaling.
export function archisketchWebData(source) {
  const unitType = source.unit_type || '168C';
  const rooms = source.rooms.map(r => ({...r, name_ko: r.name, source_representative_point_m:r.representative_point_m, representative_point_m:r.walk_start_m ?? r.representative_point_m,
    width_m: r.bbox_width_m, depth_m: r.bbox_depth_m, floor_object: `Floor/${r.id}`}));
  const roomBeside = (o, side) => {
    const [x, z] = o.center_m;
    return rooms.find(r => pointInRoom(r, x + (o.axis === 'z' ? side * .32 : 0), z + (o.axis === 'x' ? side * .32 : 0)));
  };
  const doors = source.openings.flatMap(o => {
    if (!['door', 'sliding'].includes(o.kind)) return [];
    const [x, z] = o.center_m, alongX = o.axis === 'x';
    const a = roomBeside(o, -1), b = roomBeside(o, 1);
    // Exterior glazing stays fixed: no walkable exit into the sky.
    if (o.kind === 'sliding' && (!a || !b)) return [];
    const name = o.id === 'door-00' ? '현관문' : `${[a, b].filter(Boolean).map(r => r.name_ko).join(' / ')} ${o.kind === 'sliding' ? '미닫이문' : '문'}`;
    const common = {id: `archisketch:${unitType==='112A'?'112a:':''}${source.variant}:${o.id}`, name, adapter: 'exported', exportedPose: 'closed',
      sourceOpening: o.id, operationBasis: 'provisional_hinge_or_slide_direction', width: o.width_m, height: o.height_m};
    if (o.kind === 'door') {
      // User-sized leaf; hinges are absent from the source contract. Opening
      // toward the adjacent small room is a provisional review convention.
      const interior = r => r && r.id !== 'living-kitchen-hall';
      const side = interior(b) ? 1 : interior(a) ? -1 : 1;
      const width = o.leaf_width_m ?? .8, height = o.leaf_height_m ?? 2.4;
      const direction=o.hinge_end==='positive'?-1:1;
      const swing=o.swing_sign ?? (alongX ? -side : side);
      return [{...common, operationBasis:o.operation_basis ?? common.operationBasis, type: 'hinged', objectId: `${o.id}/leaf`, accessories:source.door_accessories?.[o.id] ?? [], width, height,
        hinge: [x - (alongX ? direction*width/2 : 0), o.bottom_m + height/2, z - (alongX ? 0 : direction*width/2)],
        axis: alongX ? 'H' : 'V', closedDirection: alongX ? [direction, 0] : [0, direction],
        swingRadians: swing * Math.PI / 2}];
    }
    const clearWidth = o.clear_span_m?.[0] ?? o.width_m - .1;
    if (o.sliding_operation) {
      // Narrow source-scaled patio products cannot always be traversed with a
      // half-opening. A reviewed operation is explicit; never widen the opening.
      const operation=o.sliding_operation;
      return [{...common, type:'sliding', operationBasis:operation.basis,
        translationAxis:operation.axis, panelGroups:operation.panel_groups,
        clearOpening:operation.clear_opening_m}];
    }
    return [{...common, type: 'sliding', movingObjects: [`${o.id}/glass-0`, `${o.id}/mullion`],
      translationAxis: o.axis, travel: clearWidth / 2 - .02}];
  });
  return {doors, info: {
    units: 'm', upAxis: 'Y', unitType, variant: source.variant,
    navigationReady: true, structureRevision: source.revision, wallSlice: true,
    rooms, navigationZones:source.navigation_zones ?? [], openings:source.openings, fixtures:source.fixtures ?? [], finishRevision:source.finish_revision, entryReview:source.entry_review, objects: {}, bounds_m: source.bounds_m, ceilingHeight_m: source.ceiling_height_m,
    defaultRoom: 'living-kitchen-hall', spawn: rooms.find(r => r.id === 'living-kitchen-hall').representative_point_m,
    lightPositions: rooms.map(r => r.representative_point_m),
    source: 'Archisketch room coordinates; user opening sizes; inferred walls and door operation',
  }};
}

// GLTFLoader sanitizes node names. Resolve original names via its associations.
export function bindArchisketchModel(gltf, info) {
  const categories = {floor: 'Floors', base: 'Reference', ceiling: 'Ceilings', wall: 'Structure', excluded_volume: 'Structure', kitchen_fixture:'Kitchen', storage_fixture:'Entry', bathroom_fixture:'Bathrooms', furniture:'Furniture', decoration:'Reference', lighting:'Lighting', door_accessory:'Doors_Windows'};
  gltf.scene.traverse(object => {
    if (!object.isMesh) return;
    // A multi-material Blender mesh becomes a node Group containing primitive
    // meshes. Its original identity/extras live on the Group, not its children.
    let owner=object, index;
    while(owner && (index=gltf.parser.associations.get(owner)?.nodes)===undefined)owner=owner.parent;
    const node=gltf.parser.json.nodes[index];
    if(!node?.name)throw new Error('아키스케치 메쉬 식별자를 확인하지 못했습니다.');
    const primitive=gltf.parser.associations.get(object)?.primitives;
    Object.assign(object.userData,node.extras ?? {});
    const id=owner===object ? node.name : `${node.name}/primitive-${primitive ?? object.id}`;
    object.userData.object_id=id;
    info.objects[id]={name:node.name,component:object.userData.component,
      category:categories[object.userData.component] ?? 'Doors_Windows'};
    if (object.userData.collision === false) object.userData.collisionDisabled = true;
  });
}
