"""Check the saved Blender scene and independently decode GLB geometry/transforms."""
import bpy
import json
import math
import struct
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion

out=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(out/'model.blend'))
elements=json.loads((out/'elements.json').read_text())
wall_by_id={w['id']:w for w in elements['walls']}
wall_objects=[bpy.data.objects[w['id']] for w in elements['walls']]
# Cast rays through each hole at nine samples, against all walls, not the glazing/leaves.
ray_checks=0
for op in elements['openings']:
    w=wall_by_id[op['host_wall']]
    a=Vector(w['start']); tangent=(Vector(w['end'])-a).normalized()
    normal=Vector((-tangent.y,tangent.x))
    for fraction in [-.40,0,.40]:
        p=Vector(op['center'])+tangent*(fraction*op['width'])
        for height_fraction in [.15,.5,.85]:
            elevation=op['sill']+op['height']*height_fraction
            origin=Vector((p.x-.35*normal.x,-p.y+.35*normal.y,elevation))
            direction=Vector((normal.x,-normal.y,0))
            for ob in wall_objects:
                inv=ob.matrix_world.inverted()
                hit,loc,norm,index=ob.ray_cast(inv@origin,inv.to_3x3()@direction,distance=.7)
                assert not hit,('Wall obstructs opening',op['id'],ob.name,fraction,height_fraction)
            ray_checks+=1
# Check actual saved swing origins, opening widths and poses against JSON conventions.
for op in elements['openings']:
    if op['type']!='swing_door':continue
    ob=bpy.data.objects[op['id']]
    w=wall_by_id[op['host_wall']]
    tangent=(Vector(w['end'])-Vector(w['start'])).normalized()
    hinge=Vector(op['center'])+tangent*((-1 if op['hinge_side']=='start' else 1)*(op['width']/2-.018))
    assert (ob.location-Vector((hinge.x,-hinge.y,0))).length<2e-5
    closed=tangent if op['hinge_side']=='start' else -tangent
    actual_world=ob.matrix_world.to_3x3()@Vector((1,0,0))
    actual_plan=Vector((actual_world.x,-actual_world.y))
    signed_cross=closed.x*actual_plan.y-closed.y*actual_plan.x
    assert abs(closed.dot(actual_plan))<1e-5
    assert signed_cross*(1 if op['swing_direction']=='clockwise' else -1)>.999
# Direct GLB parse: no re-use of the exporter's transform code.
raw=(out/'model.glb').read_bytes()
length,typ=struct.unpack_from('<I4s',raw,12)
gltf=json.loads(raw[20:20+length])
bin_length,bin_type=struct.unpack_from('<I4s',raw,20+length)
assert bin_type==b'BIN\x00'
binary=raw[28+length:28+length+bin_length]

def positions(index):
    acc=gltf['accessors'][index]; view=gltf['bufferViews'][acc['bufferView']]
    assert acc['componentType']==5126 and acc['type']=='VEC3'
    offset=acc.get('byteOffset',0)+view.get('byteOffset',0)
    stride=view.get('byteStride',12)
    return [Vector(struct.unpack_from('<3f',binary,offset+i*stride)) for i in range(acc['count'])]

worlds={}
def walk(idx,parent):
    node=gltf['nodes'][idx]
    if 'matrix' in node:
        m=Matrix([node['matrix'][i:i+4] for i in range(0,16,4)]).transposed()
    else:
        x,y,z,w=node.get('rotation',[0,0,0,1])
        m=Matrix.LocRotScale(Vector(node.get('translation',[0,0,0])),Quaternion((w,x,y,z)),
                            Vector(node.get('scale',[1,1,1])))
    matrix=parent@m; worlds[node.get('name',str(idx))]=(node,matrix)
    for child in node.get('children',[]):walk(child,matrix)
for root in gltf['scenes'][gltf.get('scene',0)]['nodes']:walk(root,Matrix.Identity(4))
wall_bounds=[]
for w in elements['walls']:
    node,matrix=worlds[w['id']]
    vertices=[]
    for primitive in gltf['meshes'][node['mesh']]['primitives']:
        vertices.extend(matrix@v for v in positions(primitive['attributes']['POSITION']))
    lo=[min(v[i] for v in vertices) for i in range(3)]
    hi=[max(v[i] for v in vertices) for i in range(3)]
    assert abs(lo[1])<2e-5 and abs(hi[1]-2.30)<2e-5,(w['id'],lo,hi)
    transverse_axis=2 if w['start'][1]==w['end'][1] else 0
    assert abs(hi[transverse_axis]-lo[transverse_axis]-.20)<2e-5
    wall_bounds.append((lo,hi))
for op in elements['openings']:
    names=[f"{op['id']}_panel_1",f"{op['id']}_panel_2"] if op['type']=='sliding_door' else [op['id']]
    assert all(name in worlds for name in names)
    if op['type']=='swing_door':
        node,matrix=worlds[op['id']]
        blender=bpy.data.objects[op['id']].location
        expected=Vector((blender.x,blender.z,-blender.y))
        assert (matrix.translation-expected).length<2e-5
for name,(node,matrix) in worlds.items():
    if not name.startswith('floor_'):continue
    vv=[matrix@v for p in gltf['meshes'][node['mesh']]['primitives'] for v in positions(p['attributes']['POSITION'])]
    top=max(v.y for v in vv)
    assert abs(top-(-.02 if name=='floor_structural_slab' else 0))<2e-5
validation=json.loads((out/'validation.json').read_text())
validation['opening_ray_checks']=ray_checks
validation['gltf_wall_face_bounds_m']={
    'min':[round(min(b[0][i] for b in wall_bounds),5) for i in range(3)],
    'max':[round(max(b[1][i] for b in wall_bounds),5) for i in range(3)]}
validation['checks_passed'].extend([
    '207 rays pass through all 23 openings without hitting any wall',
    'saved swing leaf directions and hinge locations match the JSON',
    'decoded GLB wall geometry is 0.20 m thick and 2.30 m high in Y-up space',
    'decoded GLB door origins match Blender hinges in the requested plan frame',
    'decoded GLB finished floors have Y=0'])
(out/'validation.json').write_text(json.dumps(validation,indent=2)+'\n')
print(json.dumps(validation,indent=2))
