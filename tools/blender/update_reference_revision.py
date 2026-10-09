"""Create v3 from the preserved v2 models and week-06 metadata.
uv run --offline --python 3.11 --with bpy==4.5.3 python tools/blender/update_reference_revision.py
Architectural floor dimensions remain unchanged. Furnishing dimensions not printed
in the source image remain explicit design assumptions.
"""
import csv, hashlib, json, math, subprocess
from pathlib import Path
from xml.sax.saxutils import escape
import bpy
from mathutils import Vector, Matrix

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'assets/models/acro-river-park/112a'
OUT=BASE/'dimensioned-v3'
report={'revision':'dimensioned-v3','basis':'Supplied basic/expanded _0.jpg furnishing reference; existing dimensioned calibration retained',
        'assumptions':['Desk 1200 x 600 x 740 mm and chair outer size 540 x 550 x 850 mm are design sizes, not extracted measurements.',
                       'Balcony enclosure follows the reference image; glazing height and profiles are assumed.',
                       'Expanded footprint retains the v2 inferred expansion scenario; no independent expanded dimension drawing supplied.'], 'variants':{}}

def baseline(path):
    return json.loads(subprocess.check_output(['git','show',f'week-06-presentation:{path}'],cwd=ROOT))
def bounds(o):
    pts=[o.matrix_world@Vector(p) for p in o.bound_box]
    return [[min(p[a] for p in pts) for a in range(3)],[max(p[a] for p in pts) for a in range(3)]]
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()

for variant,info_file,door_file in [('basic','basic-info.json','basic-doors.json'),('expanded','model-info.json','doors.json')]:
    source=BASE/'dimensioned-v2'/variant/f'acro112a-{variant}.blend'
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene=bpy.context.scene;scene.name=f'ACRO112A_{variant.upper()}_REFERENCE_V3'
    scene['revision']='dimensioned-v3'
    scene['reference_changes']='West bedroom empty; center study; king bed rotated; enclosed front balconies; right-hinged small bedroom doors'
    info=baseline(f'src/walkthrough/{info_file}')
    doors=baseline(f'src/walkthrough/{door_file}')
    floors_before={o.name:bounds(o) for o in scene.objects if o.type=='MESH' and 'floor' in o.name.lower()}
    removed=[]
    for o in list(scene.objects):
        if o.name.startswith(('West staged','Center staged')) or 'balcony glass guard' in o.name or 'balcony handrail' in o.name:
            removed.append(o.name);bpy.data.objects.remove(o,do_unlink=True)
    # King headboard against the west side, as shown in the furnished plan.
    mattress=bpy.data.objects['Master staged mattress'];old=mattress.location.copy()
    center=Vector((11.34,-6.32,0));rotation=Matrix.Rotation(math.pi/2,4,'Z')
    for o in scene.objects:
        if o.name.startswith('Master staged'):
            p=o.location.copy();relative=Vector((p.x-old.x,p.y-old.y,0));q=rotation@relative
            o.location.x=center.x+q.x;o.location.y=center.y+q.y;o.rotation_euler.z+=math.pi/2
            o['placement_basis']='reference image orientation; selected K mattress size retained'
    # Printed/illustrated small-bedroom doors swing at their right jamb.
    for d in doors:
        if d['sourceObject'] in ['Bedroom west north open door','Bedroom center north open door']:
            d['hinge'][0]+=d['width'];d['hingeSide']='right'
            d['source']='Right hinge interpreted from provided basic/expanded plan image; opening size remains assumed'
            bpy.data.objects[d['sourceObject']].location.x+=d['width']

    serial=0
    def box(name,center,size,mat,category='Bedrooms_Inferred',parent=None,bevel=.006):
        global serial
        bpy.ops.mesh.primitive_cube_add(size=1,location=(center[0],-center[1],center[2]))
        o=bpy.context.object;o.name=name;o.dimensions=size
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        if bevel:
            m=o.modifiers.new('Rounded edges','BEVEL');m.width=bevel;m.segments=3
        o.data.materials.append(bpy.data.materials[mat])
        for c in list(o.users_collection):c.objects.unlink(o)
        bpy.data.collections[category].objects.link(o)
        serial+=1;o['object_id']=f'ref3_{serial:04d}';o['dimension_basis']='reference_shape_assumed_detail'
        if parent:o.parent=parent
        return o
    def furniture_group(id,title,kind):
        o=bpy.data.objects.new(id,None);bpy.data.collections['Bedrooms_Inferred'].objects.link(o)
        o['staging_id']=id;o['staging_kind']=kind;o['staging_title']=title
        o['dimension_basis']='selected_design_size_not_measured';return o
    desk=furniture_group('reference-study-desk','작은 방 2 책상','desk')
    cx,cz=3.3583338316050555,7.43
    box('Reference desk top',(cx,cz,.72),(.60,1.20,.04),'ACRO_Smoked oak cabinet',parent=desk,bevel=.012)
    for dx in [-.24,.24]:
        for dz in [-.54,.54]:box('Reference desk leg',(cx+dx,cz+dz,.35),(.045,.045,.70),'ACRO_Charcoal fittings',parent=desk)
    box('Reference desk drawer',(cx-.11,cz-.36,.60),(.34,.36,.20),'ACRO_Smoked oak cabinet',parent=desk)
    chair=furniture_group('reference-study-chair','작은 방 2 의자','chair')
    cx=4.08
    box('Reference chair seat',(cx,cz,.44),(.48,.49,.08),'ACRO_Oatmeal textile',parent=chair,bevel=.035)
    box('Reference chair back',(cx+.235,cz,.66),(.07,.50,.38),'ACRO_Oatmeal textile',parent=chair,bevel=.028)
    for dx in [-.2475,.2475]:
        for dz in [-.2525,.2525]:box('Reference chair leg',(cx+dx,cz+dz,.20),(.045,.045,.40),'ACRO_Charcoal fittings',parent=chair)
    # Complete the glazed balconies visible at the bottom of both references.
    for label,room_id in [('West','West open balcony'),('Center','Center open balcony')]:
        r=next(r for r in info['rooms'] if r['id']==room_id);x1,z1,x2,z2=r['bounds_m'];w=x2-x1;cx=(x1+x2)/2
        parapet=bpy.data.objects[f'{label} balcony parapet'];parapet.location.z=.07;parapet.scale.z*=.14/.32
        front=-parapet.location.y
        box(f'{label} reference exterior balcony glass',(cx,front,1.24),(w,.012,2.20),'ACRO_Window glass','Doors_Windows',bevel=0)
        for x in [x1,x1+w/3,x1+2*w/3,x2]:box(f'{label} reference balcony mullion',(x,front,1.24),(.035,.055,2.20),'ACRO_Lacquer warm white','Doors_Windows')
        for h in [.14,2.34]:box(f'{label} reference balcony rail',(cx,front,h),(w,.055,.04),'ACRO_Lacquer warm white','Doors_Windows')
        box(f'{label} reference balcony ceiling',(cx,(z1+z2)/2,2.64),(w,z2-z1,.08),'ACRO_Lacquer warm white','Ceilings',bevel=0)
        r['name_ko']='작은 방 1 발코니' if label=='West' else '작은 방 2 발코니'
        r['kind']='balcony';r['source']+='; enclosing glazing follows furnished reference, heights assumed'

    # Include the already-existing polygonal utility balcony in navigation metadata.
    bpy.context.view_layer.update()
    lo,hi=bounds(bpy.data.objects['Service balcony floor'])
    info['rooms'].append({'id':'Service balcony','name_ko':'다용도 발코니','bounds_m':[lo[0],-hi[1],hi[0],-lo[1]],'width_m':hi[0]-lo[0],'depth_m':hi[1]-lo[1],'kind':'balcony','source':'Bounding rectangle of existing L-shaped polygon; not a room area measurement','floor_object':'Service balcony floor'})
    info['objects']={o['object_id']:{'name':o.name,'category':o.users_collection[0].name} for o in scene.objects if o.get('object_id')}
    floors_after={o.name:bounds(o) for o in scene.objects if o.type=='MESH' and 'floor' in o.name.lower()}
    assert floors_before==floors_after,'Architectural floor geometry must not change'
    info['source']=f'dimensioned-v3/{variant}; Blender (x,y,z) -> glTF (x,z,-y)'
    info['layout_revision']='reference-v3'
    info['beds']=[dict(info['beds'][0],placement='Headboard west; 90 degree rotation')]
    info['furnishing_notes']={'Bedroom west':'Unfurnished, matching supplied image','Bedroom center':'Desk and chair with assumed design sizes','Master bedroom':'Existing king mattress retained, placement revised'}
    out=OUT/variant;out.mkdir(parents=True,exist_ok=True)
    for o in scene.objects:o.hide_set(False)
    glb=out/f'acro112a-{variant}.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_active_scene=True,use_visible=False,export_apply=True,export_extras=True,export_lights=False)
    info['glbSha256']=digest(glb)
    for o in scene.objects:
        if o.users_collection and o.users_collection[0].name=='Ceilings':o.hide_set(True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out/f'acro112a-{variant}.blend'))
    (out/'model-info.json').write_text(json.dumps(info,ensure_ascii=False,indent=2)+'\n')
    (out/'doors.json').write_text(json.dumps(doors,ensure_ascii=False,indent=2)+'\n')
    (ROOT/'src/walkthrough'/info_file).write_text(json.dumps(info,ensure_ascii=False,indent=2)+'\n')
    (ROOT/'src/walkthrough'/door_file).write_text(json.dumps(doors,ensure_ascii=False,indent=2)+'\n')
    with (out/'room-dimensions.csv').open('w') as f:
        w=csv.writer(f);w.writerow(['id','name_ko','width_mm','depth_mm','basis'])
        for r in info['rooms']:w.writerow([r['id'],r['name_ko'],round(r['width_m']*1000,2),round(r['depth_m']*1000,2),r['source']])
    # A measured-coordinate diagram; explicitly derived from the model, not a new survey.
    parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1100" viewBox="-0.7 -1 15.2 12.5">','<rect x="-0.7" y="-1" width="15.2" height="12.5" fill="#fafaf7"/>',f'<text x="0" y="-.5" font-size=".24">112A {variant} v3 — model-derived dimensions (mm)</text>']
    for r in info['rooms']:
        x1,z1,x2,z2=r['bounds_m'];color='#daeaf1' if r.get('kind')!='interior' else '#e9ecdf'
        parts+=[f'<rect x="{x1}" y="{z1}" width="{x2-x1}" height="{z2-z1}" fill="{color}" stroke="#506a64" stroke-width=".025"/>',f'<text x="{(x1+x2)/2}" y="{(z1+z2)/2-.08}" text-anchor="middle" font-size=".12">{escape(r["name_ko"])}</text>',f'<text x="{(x1+x2)/2}" y="{(z1+z2)/2+.13}" text-anchor="middle" font-size=".12">{r["width_m"]*1000:.0f} × {r["depth_m"]*1000:.0f}</text>']
    parts+=['<text x="0" y="10.65" font-size=".16">Selected printed dimensions + interpolated spans. Expanded geometry is inferred.</text>','<text x="0" y="10.95" font-size=".16">Rectangular room zones are not a surveyed complete wall plan or exclusive-area calculation.</text>','</svg>']
    (out/'dimensioned-plan.svg').write_text('\n'.join(parts))
    report['variants'][variant]={'source_sha256':digest(source),'glb_sha256':digest(glb),'floor_bounds_unchanged':True,'floor_objects_checked':len(floors_before),'removed_objects':removed,'floors_blender_xyz_m':floors_after,'mattress_intrinsic_size_m':list(mattress.dimensions),'mattress_world_size_m':[bounds(mattress)[1][a]-bounds(mattress)[0][a] for a in range(3)],'desk_nominal_m':[1.20,.60,.74],'chair_nominal_m':[.54,.55,.85]}
    if variant=='expanded':
        bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/furniture/catalog-sofa2790-stool980-v1/living-furniture.glb'))
        scene.name='ACRO112A_EXPANDED_REFERENCE_V3_STAGED'
        bpy.ops.wm.save_as_mainfile(filepath=str(out/'acro112a-expanded-staged.blend'))
OUT.mkdir(exist_ok=True,parents=True)
(OUT/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('REFERENCE_V3_OK')
