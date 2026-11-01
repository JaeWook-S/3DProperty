"""112A reference-plan staging. Source-sized storage; image-guided movable furniture.
The source room polygons are never rescaled to make furniture fit.
"""
import json,math,hashlib
from pathlib import Path
import bpy
from mathutils import Vector,Matrix
from shapely.geometry import box as rect


def add_details(c,review_path):
 box,ell,begin,finish,cab=(c[k] for k in ['box','ellipse','begin','finish','cabinet'])
 rooms,polys,info=c['rooms'],c['polys'],c['info'];variant=c['variant'];origin=info['origin_mm']
 oak,white,walnut,steel,black,ceramic,glass,fabric,linen,bathstone=(c[k] for k in ['oak','white','walnut','steel','black','ceramic','glass','fabric','linen','bathstone'])
 layout=json.loads((Path(review_path)/'furniture-layout.json').read_text());items=layout['floorplans'][0]['items'];byroom={r['source_id']:r['id'] for r in rooms.values()}
 source_adjustments=[]
 def bounds(item):
  x,z=(item['position'][0]-origin[0])/1000,(item['position'][2]-origin[1])/1000
  w,d=item['dimensions']['width']/1000,item['dimensions']['depth']/1000
  if abs(math.sin(math.radians(item['rotation'][1])))>.7:w,d=d,w
  return [x-w/2,z-d/2,x+w/2,z+d/2]
 def fitted(item,rid,margin=.002):
  b=bounds(item);p=polys[rid].buffer(.012)
  if variant=='expanded' and rid=='bedroom-1' and 'PAX' in item['name']:
   from shapely.geometry import LineString
   span=polys[rid].intersection(LineString([(b[0],b[1]+.02),(b[2],b[1]+.02)]))
   right=span.bounds[2]-.006
   if b[2]>right:
    source_adjustments.append(dict(source_id=item['archiId'],name=item['name'],source_width_m=b[2]-b[0],placed_width_m=right-b[0],reason='1329mm source wardrobe no longer fits updated 1212mm niche; custom cabinet width follows current niche'))
    b[2]=right
  # The current editor contains some fixtures embedded into walls after room edits.
  # Preserve size, translate minimally into the declared room, and record the correction.
  if p.covers(rect(*b)):return b
  candidates=sorted(((dx/100,dz/100) for dx in range(-35,36) for dz in range(-35,36)),key=lambda v:v[0]**2+v[1]**2)
  for dx,dz in candidates:
   shifted=[b[0]+dx,b[1]+dz,b[2]+dx,b[3]+dz]
   if p.covers(rect(*shifted)):
    source_adjustments.append(dict(source_id=item['archiId'],name=item['name'],translation_m=[dx,dz],reason='source fixture intersects updated room boundary; preserve size, move inside'))
    return shifted
  raise ValueError(('Source fixture cannot fit without size changes',item['archiId'],rid,b))
 def metadata(f,item,b):
  f.update(source_item_id=item['archiId'],source_dimensions_mm=item['dimensions'],source_position_mm=item['position'],source_rotation_degrees=item['rotation'][1],dimension_basis='scaled_archisketch_editor_item_not_physical_measurement',source_bounds_m=bounds(item),placed_envelope_m=b)
  if any(a['source_id']==item['archiId'] and 'placed_width_m' in a for a in source_adjustments):f['dimension_basis']='source_height_depth_custom_width_to_fit_updated_niche'
  for n in f['mesh_names']:bpy.data.objects[n]['dimension_basis']=f['dimension_basis']
  return f
 # Light oak in living/bedrooms, gray tile at entry, wet rooms and balconies.
 tile=c['mat']('Reference gray porcelain tile',(.28,.29,.28),.48)
 for o in bpy.context.scene.objects:
  if o.type=='MESH' and o.get('component')=='floor':
   r=rooms.get(o.get('room_id')) or rooms.get(o.name.split('/')[-1]);m=oak if r and r['kind'] in ['living','bedroom','storage'] else tile
   o.data.materials.clear();o.data.materials.append(m)
 # Entry shoes/storage and dressing room closets use ACTUAL editor-scaled dimensions.
 storage=[]
 for it in items:
  if 'PAX' not in it['name']:continue
  rid=byroom[it['roomArchiId']];b=fitted(it,rid);front={90:'east',-90:'west',0:'south',180:'north',-180:'north'}[round(it['rotation'][1])]
  label='현관 신발장' if rid=='living-kitchen-hall' else '드레스룸 수납장' if rid=='dressing' else '침실 1 붙박이장'
  f=cab('Storage '+it['archiId'][:8],rid,b,front,max(2,round(it['dimensions']['width']/500)),height=it['dimensions']['height']/1000)
  f['title']=label;metadata(f,it,b);storage.append(f)
 living=rooms['living-kitchen-hall'];x0,z0,x1,z1=living['bounds_m']
 entry_items=[f for f in storage if f['room_id']=='living-kitchen-hall'];upper=[f for f in entry_items if f['bounds_m'][1]<3]
 gross=[1.701,2.743,3.683,4.47] if variant=='basic' else [1.612,2.462,3.535,4.224]
 begin('entry-finishes','living-kitchen-hall','decoration');cx,cz=(gross[0]+gross[2])/2,(gross[1]+gross[3])/2
 box('Entry / gray tile',cx,cz,gross[2]-gross[0],gross[3]-gross[1],.001,.006,tile,0)
 # Subtle joints, shoe threshold and a runner locate the transition to the hall.
 for i in range(1,math.ceil((gross[2]-gross[0])/.4)):
  x=gross[0]+i*.4;box('Entry / joint X',x,cz,.002,gross[3]-gross[1],.007,.0006,c['grout'],0)
 for i in range(1,math.ceil((gross[3]-gross[1])/.4)):
  z=gross[1]+i*.4;box('Entry / joint Z',cx,z,gross[2]-gross[0],.002,.007,.0006,c['grout'],0)
 box('Entry / wood threshold',cx,gross[3]-.015,gross[2]-gross[0],.03,.007,.015,walnut)
 left=max(f['placed_envelope_m'][2] for f in upper if (f['placed_envelope_m'][0]+f['placed_envelope_m'][2])/2<cx)
 right=min([f['placed_envelope_m'][0] for f in upper if (f['placed_envelope_m'][0]+f['placed_envelope_m'][2])/2>cx] or [gross[2]])
 box('Entry / runner',(left+right)/2,cz,min(.72,right-left-.16),.90,.008,.009,fabric)
 info['entry_review']={'gross_bounds_m':gross,'gross_width_m':gross[2]-gross[0],'gross_depth_m':gross[3]-gross[1],'clear_width_between_storage_m':round(right-left,6),'basis':'current_archisketch_room_vertices_and_scaled_shoe_cabinets','hall_is_not_foyer':True}
 # Kitchen silhouette follows the supplied two furnished plan images. Basic retains rear balcony.
 top=1.68 if variant=='basic' else .008;east=9.75 if variant=='basic' else 9.566
 northleft=7.82 if variant=='basic' else 7.03;end=4.11 if variant=='basic' else 2.40
 cab('Kitchen north counter','living-kitchen-hall',[northleft,top+.025,east-.025,top+.63],'south',3,sink=variant=='expanded',height=.88)
 cab('Kitchen east counter','living-kitchen-hall',[east-.63,top+.64,east-.025,end-.64],'west',3,height=.88)
 cab('Kitchen peninsula island','living-kitchen-hall',[east-1.62,end-.63,east-.025,end],'south',3,height=.88,rows=2)
 # Upper cupboards sit above the working run, with an open backsplash.
 cab('Kitchen upper cupboards','living-kitchen-hall',[east-.36,top+.65,east-.025,end-.68],'west',3,height=.69,bottom=1.60)
 fx=6.35 if variant=='basic' else 6.215;fz=2.13 if variant=='basic' else 2.09
 cab('Refrigerator housing','living-kitchen-hall',[fx,fz,fx+.73,fz+1.04],'east',2,height=2.26,fridge=True)
 begin('kitchen-appliances','living-kitchen-hall','kitchen_fixture')
 if variant=='basic':
  sx,sz=east-.325,top+1.05
  box('Sink / rim',sx,sz,.45,.65,.883,.012,steel);box('Sink / basin',sx,sz,.36,.53,.896,.006,black)
  box('Sink / tap',sx+.23,sz,.03,.03,.89,.28,steel);box('Sink / spout',sx+.15,sz,.19,.028,1.14,.024,steel)
 hz=end-.33 if variant=='basic' else top+1.07;hx=east-.33
 box('Cooktop / black surface',hx,hz,.52,.55,.885,.013,black)
 for dx in [-.13,.13]:
  for dz in [-.14,.14]:ell('Cooktop / ring',hx+dx,hz+dz,.16,.16,.899,.003,steel)
 box('Cooktop / extractor',hx,hz,.55,.59,1.53,.065,steel)
 finish('주방 싱크·쿡탑')
 # Furniture primitives are sized in meters; their placement/orientation comes from the plan image.
 def table(id,rid,x,z,w,d,h,title):
  begin(id,rid,'furniture');box(id+'/top',x,z,w,d,h-.035,.035,walnut,.018)
  for dx in [-w/2+.08,w/2-.08]:
   for dz in [-d/2+.08,d/2-.08]:box(id+'/leg',x+dx,z+dz,.045,.045,0,h-.035,walnut)
  return finish(title,True,'coffee-table' if h<.5 else 'dining-table')
 def chair(id,rid,x,z,facing,title):
  begin(id,rid,'furniture');box(id+'/seat',x,z,.43,.43,.43,.055,fabric,.035)
  bx,bz=(x,z+.20) if facing=='north' else (x,z-.20) if facing=='south' else (x+.20,z)
  box(id+'/back',bx,bz,.43 if facing!='west' else .045,.045 if facing!='west' else .43,.475,.35,fabric,.023)
  for dx in [-.17,.17]:
   for dz in [-.17,.17]:box(id+'/leg',x+dx,z+dz,.03,.03,0,.43,walnut)
  return finish(title,True,'chair')
 dx,dz=(7.24,4.07) if variant=='basic' else (7.10,4.12)
 table('dining-table','living-kitchen-hall',dx,dz,1.1,.72,.74,'4인 식탁 110 × 72cm')
 for i,(ox,oz) in enumerate([(-.27,-.62),(.27,-.62),(-.27,.62),(.27,.62)]):chair('dining-chair-'+str(i),'living-kitchen-hall',dx+ox,dz+oz,'south' if oz<0 else 'north','식탁 의자 '+str(i+1))
 # Exact catalog sofa, rotated 90 degrees: its back is against the east living wall.
 lx=x1-.04-.585;lz=z1-1.48 if variant=='basic' else z1-2.05
 begin('living-sofa','living-kitchen-hall','furniture');before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(c['ROOT']/'assets/furniture/catalog-sofa2790-stool980-v1/sofa.glb'))
 added=[o for o in bpy.data.objects if o not in before];meshes=[o for o in added if o.type=='MESH'];bpy.context.view_layer.update();vv=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
 center=Vector(((min(v.x for v in vv)+max(v.x for v in vv))/2,(min(v.y for v in vv)+max(v.y for v in vv))/2,min(v.z for v in vv)))
 # Catalog front is -Y in Blender. Rotating clockwise puts the front on -X.
 transform=Matrix.Translation(Vector((lx,-lz,0)))@Matrix.Rotation(-math.pi/2,4,'Z')@Matrix.Translation(-center)
 for o in meshes:
  matrix=transform@o.matrix_world;o.parent=None;o.matrix_world=matrix
  for k in ['asset_id','staging_id']:
   if k in o:del o[k]
  o.name='Sofa / '+o.name;c['move_col'](o);c['tag'](o)
 for o in added:
  if o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True)
 finish('소파 279 × 117cm',True,'sofa','user_catalog_dimensions_2.79x1.17x0.73_m')
 table('living-coffee-table','living-kitchen-hall',lx-1.22,lz,.58,1.1,.39,'거실 테이블 58 × 110cm')
 chair('living-lounge-chair','living-kitchen-hall',lx-.84,lz-1.80,'south','거실 보조 의자')
 # Master bed points east from the western headboard, as in the furnished plan.
 r=rooms['primary'];a,b,e,d=r['bounds_m'];bx=a+1.19;bz=b+1.86
 begin('primary-king','primary','furniture');box('King / base',bx,bz,2.17,1.78,.04,.26,walnut,.04);box('King / mattress',bx,bz,2.075,1.67,.30,.20,linen,.07);box('King / headboard',bx-1.10,bz,.075,1.84,0,1.05,fabric,.03);box('King / duvet',bx+.18,bz,1.63,1.70,.50,.08,linen,.04)
 for oz in [-.42,.42]:ell('King / pillow',bx-.73,bz+oz,.53,.66,.54,.12,white)
 finish('안방 킹 침대',True,'king','selected_king_mattress_1.67x2.075_m_frame_design')
 r=rooms['bedroom-2'];a,b,e,d=r['bounds_m'];dx=a+.34;dz=d-.71
 begin('study-desk','bedroom-2','furniture');box('Desk / top',dx,dz,.60,1.20,.71,.035,oak)
 for ox in [-.24,.24]:
  for oz in [-.54,.54]:box('Desk / leg',dx+ox,dz+oz,.04,.04,0,.71,walnut)
 # Notebook and a reading lamp give scale without pretending they were measured.
 box('Desk / notebook',dx,dz-.12,.25,.32,.75,.015,white);box('Desk / lamp base',dx-.08,dz-.43,.15,.15,.75,.025,steel);box('Desk / lamp stem',dx-.08,dz-.43,.018,.018,.77,.30,steel);ell('Desk / lamp shade',dx-.08,dz-.43,.20,.20,1.02,.10,white)
 finish('창가 책상 120 × 60cm',True,'desk');chair('study-chair','bedroom-2',dx+.63,dz,'west','책상 의자')
 # Wet fixtures: source item envelope/position, simple manufactured details inside it.
 for it in items:
  if not any(k in it['name'] for k in ['Bath Sink','Toilet','Bathtub','Shower booth']):continue
  rid=byroom[it['roomArchiId']];b=fitted(it,rid);a,n,e,s=b;x,z=(a+e)/2,(n+s)/2;w,d=e-a,s-n
  begin('Wet '+it['archiId'][:8],rid,'bathroom_fixture')
  if 'Bath Sink' in it['name']:
   box('Vanity / cabinet',x,z,w-.025,d-.025,.25,.47,walnut);box('Vanity / rim',x,z,w,d,.72,.055,ceramic)
   ell('Vanity / bowl',x,z,w-.09,d-.10,.772,.006,bathstone);wallx=e-.02 if it['rotation'][1]<0 else a+.02
   box('Vanity / tap',wallx,z,.035,.065,.775,.18,steel);box('Vanity / mirror',wallx,z,.014,d,1.04,.82,c['mirror'])
  elif 'Toilet' in it['name']:
   ell('WC / foot',x,z,w*.65,d*.68,0,.34,ceramic);ell('WC / bowl',x,z,w*.95,d*.95,.29,.17,ceramic);ell('WC / lid',x,z,w*.75,d*.92,.46,.025,white)
   tx=e-.09 if it['rotation'][1]<0 else a+.09;box('WC / tank',tx,z,.16,d*.93,.34,.43,ceramic,.04)
  elif 'Bathtub' in it['name']:
   h=it['dimensions']['height']/1000;box('Bath / tub body',x,z,w,d,0,h-.035,ceramic,.04);box('Bath / recessed bowl',x,z,w-.13,d-.14,h-.035,.008,bathstone,.03)
   for xx in [a+.035,e-.035]:box('Bath / raised rim',xx,z,.07,d,h-.035,.035,ceramic,.025)
   for zz in [n+.035,s-.035]:box('Bath / raised rim',x,zz,w-.14,.07,h-.035,.035,ceramic,.025)
  else:
   box('Shower / tray',x,z,w,d,0,.035,bathstone);box('Shower / fixed panel',e-.012,z,.014,d,.04,2.15,glass);box('Shower / access panel',x,s-.012,w,.014,.04,2.15,glass)
   box('Shower / corner post',e-.012,s-.012,.022,.022,.035,2.15,steel);box('Shower / handle',x+.16,s-.033,.02,.02,.93,.22,steel)
   box('Shower / riser',e-.055,n+.20,.022,.022,1.0,1.08,steel);box('Shower / head',e-.15,n+.20,.21,.21,2.06,.024,steel)
  metadata(finish(rooms[rid]['name']+' '+it['name']),it,b)
 # Hinge ends and swing direction are observed in the two supplied reference plans.
 for o in info['openings']:
  if o['kind']!='door':continue
  x,z=o['center_m'];op=None
  if o['id']=='door-00':op=('positive',-1,'현관: 외부로 열림')
  elif o['axis']=='x':
   op=('negative',1,'공용 욕실: 왼쪽 경첩, 욕실 안으로') if z<5 else ('positive',1,'작은 침실: 오른쪽 경첩, 방 안으로')
  elif x>9.8 and z>4.3 and z<5.5:op=('negative',1,'안방: 위쪽 경첩, 안방 안으로')
  elif x>10.5 and z>3 and z<4.5:op=('positive',1,'안방 욕실: 아래쪽 경첩, 욕실 안으로')
  elif x<8:op=('negative',-1,'다용도 발코니 쪽으로')
  else:op=('positive',1,'보조실 문: 이미지 기반 잠정 방향')
  o.update(hinge_end=op[0],swing_sign=op[1],operation_basis='furnished_reference_plan_image',operation_note=op[2])
  leaf=bpy.data.objects.get(o['id']+'/leaf')
  if leaf:
   leaf['hinge_end']=op[0];leaf['web_open_angle_degrees']=op[1]*90;leaf['operation_basis']=op[2]
 info['detail_sources']={'layout_path':str(Path(review_path)/'furniture-layout.json'),'layout_sha256':hashlib.sha256((Path(review_path)/'furniture-layout.json').read_bytes()).hexdigest(),'reference_image':f'아크로리버파크 112A_{"기본형" if variant=="basic" else "확장형"}_0.jpg','furniture_status':'image-guided staging, not a physical survey','kitchen_note':'C-shaped counters from reference image, fridge proposed in upper west housing; conflicting lower tall-cabinet run omitted to accommodate dining table','fixture_adjustments':source_adjustments}
 return lx,lz
