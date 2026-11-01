import { Vector3 } from 'three';

// Cross-section of real triangles. Bounding rectangles would cover entire rooms
// when a single concave wall mesh wraps around multiple spaces.
export function wallSlicePath(mesh, height = 1) {
  if(!mesh.isMesh){const paths=[];mesh.traverse(o=>{if(o.isMesh)paths.push(wallSlicePath(o,height));});return paths.filter(Boolean).join(' ');}
  const geometry = mesh.geometry, positions = geometry.attributes.position, index = geometry.index;
  if (!positions) return '';
  mesh.updateWorldMatrix(true, false);
  const count = index ? index.count : positions.count, segments = [];
  const vertex = i => new Vector3().fromBufferAttribute(positions, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
  for (let i = 0; i < count; i += 3) {
    const triangle = [vertex(i), vertex(i + 1), vertex(i + 2)], hits = [];
    for (let j = 0; j < 3; j++) {
      const a = triangle[j], b = triangle[(j + 1) % 3];
      if ((a.y < height) === (b.y < height) || Math.abs(a.y - b.y) < 1e-9) continue;
      hits.push(a.clone().lerp(b, (height - a.y) / (b.y - a.y)));
    }
    if (hits.length === 2 && hits[0].distanceToSquared(hits[1]) > 1e-12)
      segments.push(`M${hits[0].x},${hits[0].z}L${hits[1].x},${hits[1].z}`);
  }
  return segments.join(' ');
}

// Join triangle-cut segments into closed contours. Even-odd fill leaves room
// holes empty, including when a single wall mesh surrounds several rooms.
export function wallSectionPath(mesh, height = 1) {
  const root=mesh.parent?.userData.component==='wall' && !mesh.parent.isMesh ? mesh.parent : mesh;
  const segments=wallSlicePath(root,height).split(' ').filter(Boolean).map(s=>s.slice(1).split('L').map(p=>p.split(',').map(Number)));
  const key=p=>p.map(n=>Math.round(n*1e5)).join(','), edges=[], adjacency=new Map(), unique=new Set();
  for(const [a,b] of segments){
    const ka=key(a),kb=key(b),id=[ka,kb].sort().join('|');if(ka===kb||unique.has(id))continue;unique.add(id);
    const i=edges.length;edges.push({a,b,ka,kb});
    for(const k of [ka,kb]){if(!adjacency.has(k))adjacency.set(k,[]);adjacency.get(k).push(i);}
  }
  const used=new Set(),paths=[];
  for(let i=0;i<edges.length;i++){
    if(used.has(i))continue;
    const first=edges[i];used.add(i);const points=[first.a,first.b];let last=first.kb;
    while(last!==first.ka){
      const next=adjacency.get(last)?.find(j=>!used.has(j));if(next===undefined)break;
      used.add(next);const e=edges[next],forward=e.ka===last;points.push(forward?e.b:e.a);last=forward?e.kb:e.ka;
    }
    // Never fill an unclosed chain across a room; retain its outline instead.
    if(last===first.ka)paths.push('M'+points.map(p=>p.join(',')).join('L')+'Z');
  }
  return paths.join(' ');
}
