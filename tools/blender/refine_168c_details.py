#!/usr/bin/env python3
"""VR-guided 168C details and circulation. Saved Archisketch structure is immutable.
Run with bpy 4.5.3 and shapely 2.1.2. VR is expanded-only; basic is an adaptation.
Cabinet sizes and hardware are design proposals, not measured installations.
"""
import argparse, json, math, hashlib, unicodedata
from pathlib import Path
import bpy
from mathutils import Vector
from shapely.geometry import Polygon, Point, box as rect, LineString
from shapely.ops import unary_union
from refine_112a_kitchen import ROOT, geo, envelope, sha, dump
from acro168c_kitchen import add_kitchen
REV='archisketch-details-v2'
BASE=ROOT/'assets/models/acro-river-park/168c'
STRUCTURE={'floor','wall','ceiling','base','excluded_volume','opening_frame','door_leaf','glass','sliding_panel'}

def build(variant):
 src=BASE/'archisketch-interiors-v1'/variant;out=BASE/REV/variant;out.mkdir(parents=True,exist_ok=True);stem='acro168c-'+variant
 original=json.loads((src/'model-info.json').read_text());info=json.loads((src/'model-info.json').read_text())
 bpy.ops.wm.open_mainfile(filepath=str(src/(stem+'.blend')),use_scripts=False);scene=bpy.context.scene;bpy.context.view_layer.update()
 structural={o.name:geo(o) for o in scene.objects if o.type=='MESH' and o.get('component') in STRUCTURE}
 old_mesh_count=sum(o.type=='MESH' for o in scene.objects);rooms={r['id']:r for r in info['rooms']};polys={k:Polygon(r['polygon_m']) for k,r in rooms.items()}
 col=bpy.data.collections['06_Interiors'];fixture_id='';room_id='';component='';made=[];new_fixtures=[];removed=[]
 replace_ids={f['id'] for f in info['fixtures'] if f['component'] in ['kitchen_fixture','bathroom_fixture'] or f['id'] in ['dressing built-in','hall-pantry built-in','entry-storage built-in']}
 for f in info['fixtures']:
  if f['id'] in replace_ids:
   for n in f['mesh_names']:
    if bpy.data.objects.get(n):removed.append(n);bpy.data.objects.remove(bpy.data.objects[n],do_unlink=True)
 info['fixtures']=[f for f in info['fixtures'] if f['id'] not in replace_ids]
 def mat(s):return bpy.data.materials['168C / '+s]
 steel=mat('brushed nickel');stone=mat('VR beige stone wall');wood=mat('Smoked oak door');white=mat('Lacquer warm white');ceramic=mat('Porcelain');mirror=mat('Mirror');dark=mat('Charcoal lacquer');black=mat('Black glass');glass=mat('Clear neutral glazing');light=mat('Warm light diffuser');bath=mat('Travertine bathroom')
 def uv(o):
  o.data.update();layer=o.data.uv_layers.active or o.data.uv_layers.new(name='MetricUV')
  for f in o.data.polygons:
   a=max(range(3),key=lambda i:abs(f.normal[i]))
   for j in f.loop_indices:
    p=o.matrix_world@o.data.vertices[o.data.loops[j].vertex_index].co
    layer.data[j].uv=(p.x/1.2,-p.y/1.2) if a==2 else ((-p.y/1.2,p.z/1.2) if a==0 else (p.x/1.2,p.z/1.2))
 def tag(o,name):
  o.name=name
  for c in list(o.users_collection):c.objects.unlink(o)
  col.objects.link(o);o['fixture_id']=fixture_id;o['room_id']=room_id;o['component']=component;o['dimension_basis']='VR_guided_design_dimensions_not_surveyed'
  if component=='decoration':o['collision']=False
  made.append(o);return o
 def box(name,x,z,w,d,b,h,m,bevel=.005):
  assert min(w,d,h)>0,(name,w,d,h)
  bpy.ops.mesh.primitive_cube_add(size=1,location=(x,-z,b+h/2));o=tag(bpy.context.object,fixture_id+'/'+name);o.dimensions=(w,d,h);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
  if bevel:
   mod=o.modifiers.new('Manufactured edge','BEVEL');mod.width=min(bevel,w/4,d/4,h/4);mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name)
  bpy.context.view_layer.update();uv(o);return o
 def ell(name,x,z,w,d,b,h,m):
  bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,location=(x,-z,b+h/2));o=tag(bpy.context.object,fixture_id+'/'+name);o.scale=(w/2,d/2,h/2);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
  for f in o.data.polygons:f.use_smooth=True
  return o
 def begin(id,r,c):
  nonlocal fixture_id,room_id,component,made
  fixture_id=id;room_id=r;component=c;made=[]
 def finish(title):
  bpy.context.view_layer.update();bs=[envelope(o) for o in made];fp=[[b[0],-b[4],b[3],-b[1]] for b in bs]
  f=dict(id=fixture_id,title=title,room_id=room_id,component=component,bounds_m=[min(p[0] for p in fp),min(p[1] for p in fp),max(p[2] for p in fp),max(p[3] for p in fp)],bottom_m=min(b[2] for b in bs),top_m=max(b[5] for b in bs),footprints_m=fp,collision_footprints_m=[p for p,b in zip(fp,bs) if b[5]>.12 and b[2]<1.72 and component!='decoration'],mesh_names=[o.name for o in made],movable=False,dimension_basis='VR_guided_design_dimensions_not_surveyed',reference_variant='expanded',reference_relation='same_layout_qualitative_reference' if variant=='expanded' else 'adaptation_to_basic_source_polygon')
  f['outside_room_m2']=unary_union([rect(*p) for p in fp]).difference(polys[room_id].buffer(.015)).area
  assert f['outside_room_m2']<.001,(fixture_id,f['outside_room_m2'])
  new_fixtures.append(f);return f
 def cabinet(id,r,bounds,front,modules,h=.9,b=0,finishmat=None):
  begin(id,r,'kitchen_fixture' if r=='living-kitchen-hall' else 'storage_fixture')
  def piece(n,size,loc,m):
   if front=='south':loc=(loc[0],-(bounds[1]+bounds[3])-loc[1],loc[2])
   if finishmat and ('front' in n or n in ['carcass','cap']):m=finishmat
   return box(n,loc[0],-loc[1],size[0],size[1],loc[2]-size[2]/2,size[2],m)
  add_kitchen(dict(kind='kitchen_cabinet',height_m=h,bottom_m=b,front=front,modules=modules,drawer_rows=1,countertop=h<1.1 and b==0),bounds,piece)
  return made
 def bowl(name,x,z,w,d,top,depth,m):
  # Open bowl with a continuous rim, sloped sides and bottom. No painted solid top.
  verts=[]
  for ww,dd,yy in [(w,d,top),(w-.07,d-.07,top),(w-.16,d-.16,top-depth)]:
   verts.extend([(x-ww/2,-z-dd/2,yy),(x+ww/2,-z-dd/2,yy),(x+ww/2,-z+dd/2,yy),(x-ww/2,-z+dd/2,yy)])
  faces=[]
  for ring in range(2):
   for j in range(4):faces.append((ring*4+j,ring*4+(j+1)%4,(ring+1)*4+(j+1)%4,(ring+1)*4+j))
  faces.append((8,9,10,11));me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(fixture_id+'/'+name,me);col.objects.link(o);tag(o,fixture_id+'/'+name);me.materials.append(m);uv(o)
  box('drain',x,z,.045,.045,top-depth+.001,.002,steel)
  return o
 def sink(x,z,w,d,top,orientation='north'):
  # Cut the containing cabinet top + carcass, retaining all external dimensions.
  targets=[o for o in made if o.name.endswith('/countertop') or o.name.endswith('/carcass')]
  cut=box('temporary sink cut',x,z,w-.07,d-.07,top-.23,.27,steel,0)
  for o in targets:
   bpy.context.view_layer.objects.active=o;mod=o.modifiers.new('Sink recess','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cut;bpy.ops.object.modifier_apply(modifier=mod.name);uv(o)
  made.remove(cut);bpy.data.objects.remove(cut,do_unlink=True);bowl('recessed sink',x,z,w,d,top+.004,.18,steel)
  tx,tz=(x-.22,z) if orientation=='east' else (x,z+.245)
  box('tap column',tx,tz,.035,.035,top,.28,steel);box('tap spout',(tx+x)/2,(tz+z)/2,max(.035,abs(tx-x)+.035),max(.035,abs(tz-z)+.035),top+.245,.032,steel)
 # Rebuild the kitchen from its door clearance, not its room bounding rectangle.
 living='living-kitchen-hall';west=rooms['bedroom-3']['bounds_m'][2]+.235;north=rooms['bedroom-3']['bounds_m'][1]+.70
 if variant=='basic':
  end=10.49;island=[12.20,6.50,13.10,8.30];fridge=[13.20,8.40,14.05,9.48]
 else:
  end=11.47;island=[12.65,6.95,13.55,8.55];fridge=[13.20,8.55,14.05,9.85]
 cabinet('Kitchen west base',living,[west,north,west+.62,end],'east',5)
 if variant=='basic':sink(west+.31,9.61,.48,.79,.9,'east')
 # Hob/oven clear of the sink and door; correct counter-relative dimensions.
 hz=north+1.12;box('induction',west+.32,hz,.52,.62,.90,.014,black)
 for dz in [-.16,.16]:
  for dx in [-.13,.13]:ell('burner',west+.32+dx,hz+dz,.13,.13,.915,.002,steel)
 box('oven glass',west+.627,hz,.018,.57,.23,.40,black);box('oven handle',west+.66,hz,.028,.44,.62,.025,steel)
 finish('주방 조리대·오븐'+('·싱크대' if variant=='basic' else ''))
 # Split upper cabinets around the hood, avoiding duplicated overlapping volumes.
 for i,(a,b) in enumerate([(north,hz-.40),(hz+.40,end)]):
  cabinet('Kitchen upper '+str(i),living,[west,a,west+.36,b],'east',max(1,round((b-a)/.6)),h=.65,b=1.62);finish('주방 상부장')
 begin('Kitchen hood and backsplash',living,'kitchen_fixture');box('hood',west+.30,hz,.54,.72,1.55,.065,steel);box('hood chimney',west+.15,hz,.25,.32,1.615,.65,steel)
 box('splashback',west+.007,(north+end)/2,.013,end-north,.91,.64,dark)
 box('under cabinet light',west+.33,(north+end)/2,.022,end-north,1.59,.012,light);finish('후드·벽 마감·하부 조명')
 if variant=='expanded':
  cabinet('Kitchen sink run',living,[west,11.516,12.919,12.116],'north',3);sink(11.95,11.816,.78,.48,.9);finish('창 아래 싱크대')
 cabinet('Living kitchen island',living,island,'east',3);finish('주방 아일랜드')
 begin('Refrigerator housing',living,'kitchen_fixture');a,b,c,d=fridge;box('body',(a+c)/2,(b+d)/2,c-a,d-b,0,2.22,dark)
 for i in range(2):
  z=b+(d-b)*(i+.5)/2;box('steel door '+str(i),c+.013,z,.026,(d-b)/2-.009,.14,1.99,steel);box('handle '+str(i),c+.05,(b+d)/2+(-.045 if i==0 else .045),.04,.025,.83,.70,steel)
 finish('냉장고 수납장')
 # Expanded-only utility screenshot: lower cabinet below the window and shallow
 # wall shelves; keep the west entrance and central standing area entirely clear.
 utility='kitchen-pantry' if variant=='expanded' else 'kitchen-balcony';r=rooms[utility];a,b,c,d=r['bounds_m']
 if variant=='expanded':
  cabinet('Utility low cabinet',utility,[13.23,11.64,14.10,12.11],'north',2,h=.84);finish('다용도실 창 아래 수납장')
  begin('Utility shelves',utility,'storage_fixture')
  for h in [1.10,1.42,1.74]:box('shelf',14.96,10.60,.70,.24,h,.026,wood)
 else:
  begin('Utility shelves',utility,'storage_fixture')
  for h in [1.10,1.42,1.74]:box('shelf',13.38,10.88,.65,.22,h,.026,wood)
 finish('다용도실 선반')
 begin('Utility drain',utility,'decoration');p=polys[utility].representative_point();box('floor drain',p.x,p.y,.09,.09,.002,.003,steel,0);finish('다용도실 배수구')
 # Bathroom arrangement read together with the VR mini map. WC and vanity share
 # the north wall in bath 1, south wall in primary bath. Both doors stay clear.
 for rid in ['bathroom-1','primary-bath']:
  a,b,c,d=rooms[rid]['bounds_m'];common=rid=='bathroom-1';wet=.76
  begin(rid+'-fixtures',rid,'bathroom_fixture');cx=a+.03+wet/2;cz=(b+d)/2
  if common:
   box('shower tray',cx,cz,wet,d-b-.08,0,.028,bath)
   # Fixed screen only at the rear; the remaining .8m opening is walkable.
   box('shower screen',a+wet+.03,b+.30,.012,.52,.03,2.06,glass)
   box('shower rail',a+wet+.03,b+.30,.020,.52,2.08,.02,steel)
   box('shower head',a+.30,b+.20,.20,.19,2.02,.03,steel)
   box('shower riser',a+.30,b+.05,.025,.03,.98,1.04,steel)
   vz=b+.26;tz=b+.36;wallz=b+.035;sign=1
  else:
   # A rim + recessed shell instead of the old solid tub-shaped box.
   box('tub apron',a+wet+.02,cz,.045,d-b-.08,0,.53,stone)
   box('tub west apron',a+.04,cz,.04,d-b-.08,0,.53,ceramic)
   for zz in [b+.045,d-.045]:box('tub end',cx,zz,wet,.04,0,.53,ceramic)
   bowl('recessed bathtub',cx,cz,wet,d-b-.08,.54,.38,ceramic)
   box('tub mixer',a+.12,b+.22,.09,.04,.67,.04,steel)
   vz=d-.26;tz=d-.36;wallz=d-.035;sign=-1
  vx=a+1.18;tx=c-.40
  box('vanity cabinet',vx,vz,.65,.45,.20,.51,wood)
  # Open porcelain basin (carcass below bowl bottom).
  bowl('porcelain basin',vx,vz,.69,.47,.85,.12,ceramic)
  box('basin tap',vx,wallz+sign*.07,.03,.10,.85,.14,steel)
  # Mirrors are mounted on the actual room wall, not floating in front of basin.
  mx=(a+wet+.10+c-.08)/2;mw=c-.08-(a+wet+.10)
  box('mirror',mx,wallz,mw,.02,1.07,.96,mirror);box('mirror light',mx,wallz+sign*.03,mw,.02,2.06,.02,light)
  box('stone shelf',mx,wallz+sign*.07,mw,.12,1.00,.035,stone)
  ell('wc pedestal',tx,tz,.28,.44,0,.34,ceramic);ell('wc bowl',tx,tz,.38,.60,.27,.18,ceramic);ell('wc lid',tx,tz+sign*.015,.37,.49,.45,.025,white)
  box('wc tank',tx,tz-sign*.23,.36,.13,.33,.40,ceramic,.025)
  finish(rooms[rid]['name']+' 위생기구·거울')
 # Shallow cabinets leave usable entrances; their volumes are not room dimensions.
 for rid,depth in [('entry-storage',.28),('hall-pantry',.28)]:
  a,b,c,d=rooms[rid]['bounds_m'];cabinet(rid+' built-in',rid,[a+.03,b+.035,c-.04,b+depth],'south',3,h=2.30,finishmat=white);finish(rooms[rid]['name']+' 수납장')
 # Dressing reference: wood wardrobe at the deep end and a low dresser / mirror.
 a,b,c,d=rooms['dressing']['bounds_m'];cabinet('Dressing deep wardrobe','dressing',[a+.03,b+.08,a+.55,d-.05],'east',3,h=2.30,finishmat=wood);finish('드레스룸 안쪽 옷장')
 cabinet('Dressing vanity','dressing',[a+.60,b+.035,c-.06,b+.46],'south',3,h=.78,finishmat=wood)
 box('mirror',(a+.60+c-.06)/2,b+.05,c-a-.72,.018,1.00,1.08,mirror);box('vanity light',(a+.60+c-.06)/2,b+.07,c-a-.72,.018,2.13,.02,light);finish('드레스룸 화장대')
 # Skirting on real polygon boundaries; remove opening intervals. Pure trim is
 # not a new collision wall and never alters the measured room polygon.
 for rid,r in rooms.items():
  if r['kind'] not in ['bedroom','living','storage']:continue
  begin('Skirting '+rid,rid,'decoration');poly=polys[rid];cuts=unary_union([Point(*o['center_m']).buffer(o['width_m']/2+.04) for o in info['openings'] if o['bottom_m']<.12])
  edges=poly.buffer(-.014,join_style=2).boundary.difference(cuts)
  for line in ([edges] if edges.geom_type=='LineString' else edges.geoms):
   for p,q in zip(list(line.coords),list(line.coords)[1:]):
    dx,dz=q[0]-p[0],q[1]-p[1]
    if min(abs(dx),abs(dz))>.005 or math.hypot(dx,dz)<.05:continue
    box('profile',(p[0]+q[0])/2,(p[1]+q[1])/2,max(.016,abs(dx)),max(.016,abs(dz)),.003,.055,wood if r['kind']=='bedroom' else white,0)
  if made:finish(r['name']+' 걸레받이')
 # Preserve furniture dimensions except for the explicitly reviewed coffee height.
 for f in info['fixtures']:
  if f['id']!='living-coffee-table':continue
  for n in f['mesh_names']:
   o=bpy.data.objects[n]
   if n.endswith('/top'):o.location.z+=.07
   else:
    inv=o.matrix_world.inverted();matrix=o.matrix_world.copy()
    for v in o.data.vertices:
     p=matrix@v.co;p.z*=.41/.34;v.co=inv@p
    o.data.update()
  f['height_revision']={'previous_m':.38,'new_m':.45,'basis':'design_height_for_existing_staging_furniture'}
 # Surface sliding hardware for source-scaled narrow products. Keep openings and
 # frames exact; stow leaves outside the wall plane instead of into solid masonry.
 sliding=[];intentional=set()
 # The original glass already has two tracks (+/-18mm), but its animated
 # 80mm-deep central stile intersects the stationary pane. Give the moving stile
 # its own 20mm profile on glass-0's track; keep the opening and outer frame exact.
 joinery=[]
 for op in info['openings']:
  if op['kind']!='sliding':continue
  x,z=op['center_m'];ax=op['axis']=='x'
  adjacent=[any(poly.covers(Point(x if ax else x+side*.32,z+side*.32 if ax else z)) for poly in polys.values()) for side in [-1,1]]
  if not all(adjacent):continue
  name=op['id']+'/mullion';obj=bpy.data.objects[name];normal=1 if ax else 0;center=-z if ax else x;matrix=obj.matrix_world.copy();inv=matrix.inverted()
  for vert in obj.data.vertices:
   p=matrix@vert.co;p[normal]=center+(p[normal]-center)*.25+(.018 if ax else -.018);vert.co=inv@p
  obj.data.update();uv(obj);intentional.add(name);joinery.append({'id':op['id'],'mesh':name,'profile_depth_m':.020,'normal_track_m':-.018,'basis':'provisional_nonintersecting_sliding_profile'})
 ids=['sliding-20','sliding-22','sliding-26'] if variant=='basic' else ['sliding-09','sliding-10','dressing-door']
 for id in ids:
  o=next(o for o in info['openings'] if o['id']==id);axis=o['axis'];clear=o['width_m']-.1;offset=.14
  names=[id+'/glass-0',id+'/glass-1',id+'/mullion']
  for n in names:
   obj=bpy.data.objects[n]
   if axis=='x':obj.location.y-=offset
   else:obj.location.x+=offset
   obj['operation_basis']='design_proposal_not_verified_as_built';intentional.add(n)
  groups=[{'objects':[names[0],names[2]],'travel_m':round(-clear/2-.025,6)},{'objects':[names[1]],'travel_m':round(clear/2+.025,6)}]
  o['sliding_operation']=dict(kind='biparting_surface_slide',axis=axis,panel_groups=groups,clear_opening_m=round(clear,6),closed_panel_plane_offset_m=offset,basis='design_proposal_keep_source_opening_dimensions',as_built_hardware_verified=False)
  sliding.append({'id':id,'old_clear_m':clear/2-.02,'new_clear_m':clear})
 # Review hinges against adjacent corners and fixture sweep; original source did
 # not contain hinge orientation. Hardware may be revised after walkthrough tests.
 hinge_choices={'door-05':('positive',1),'door-06':('positive',1),
                ('door-08' if variant=='basic' else 'door-07'):('positive',1),
                ('door-03' if variant=='basic' else 'door-02'):('positive',1),
                ('door-02' if variant=='basic' else 'door-03'):('positive',-1)}
 for id,(hinge,swing) in hinge_choices.items():
  op=next(o for o in info['openings'] if o['id']==id);op.update(hinge_end=hinge,swing_sign=swing,operation_basis='VR_plan_review_provisional_hinge_not_surveyed')
  # Reposition exported lever ends together with changed hinge side.
  for n in info['door_accessories'][id]:
   obj=bpy.data.objects[n];center=op['center_m'][0 if op['axis']=='x' else 1];bs=envelope(obj);pos=(bs[0]+bs[3])/2 if op['axis']=='x' else -(bs[1]+bs[4])/2;delta=2*(center-pos)
   if op['axis']=='x':obj.location.x+=delta
   else:obj.location.y-=delta
 # Recompute metadata from saved mesh geometry, including all new fixture parts.
 info['fixtures']+=new_fixtures;bpy.context.view_layer.update()
 for f in info['fixtures']:
  bs=[envelope(bpy.data.objects[n]) for n in f['mesh_names']];fp=[[b[0],-b[4],b[3],-b[1]] for b in bs]
  f.update(bounds_m=[min(p[0] for p in fp),min(p[1] for p in fp),max(p[2] for p in fp),max(p[3] for p in fp)],bottom_m=min(b[2] for b in bs),top_m=max(b[5] for b in bs),footprints_m=fp,collision_footprints_m=[p for p,b in zip(fp,bs) if b[5]>.12 and b[2]<1.72 and f['component']!='decoration'])
  f['outside_room_m2']=unary_union([rect(*p) for p in fp]).difference(polys[f['room_id']].buffer(.015)).area;assert f['outside_room_m2']<.001,(f['id'],f['outside_room_m2'])
 solids=unary_union([rect(*p) for f in info['fixtures'] for p in f['collision_footprints_m']])
 for r in info['rooms']:
  free=polys[r['id']].buffer(-.27).difference(solids.buffer(.27))
  if free.is_empty:r['navigable']=False;continue
  p=Point(r['walk_start_m']);p=p if free.covers(p) else free.representative_point();r['walk_start_m']=[round(p.x,5),round(p.y,5)]
  if r['id']=='living-kitchen-hall':r['viewTarget']=[12.4,9.0]
 changed=[n for n,h in structural.items() if n not in intentional and geo(bpy.data.objects[n])!=h];assert not changed,changed
 for old,new in zip(original['rooms'],info['rooms']):
  for k in ['source_id','polygon_m','source_polygon_mm','bounds_m','ceiling_height_m']:assert old[k]==new[k],(old['id'],k)
 for old,new in zip(original['openings'],info['openings']):
  for k in ['source_id','center_m','axis','width_m','height_m','bottom_m']:assert old[k]==new[k],(old['id'],k)
 refs=ROOT.parent/'AisideProject/references/week-07/acro-river-park/naver/vr/168C/screenshots/expanded'
 references=[{'file':str(p.relative_to(ROOT.parent)),'sha256':sha(p),'name':unicodedata.normalize('NFC',p.name)} for p in sorted(refs.glob('*.png'))]
 info['detail_review']=dict(parent_revision='archisketch-interiors-v1',parent_blend_sha256=sha(src/(stem+'.blend')),reference_variant='expanded',basic_reference_status='adapted_not_photographically_verified',source_coordinates_preserved=True,hardware_verified_as_built=False,fixture_sizes_measured=False,sliding=sliding,body_default_width_m=.44,validation_body_width_m=.50,references=references)
 info['joinery_review']=joinery
 info['fixture_dimensions_status']='catalog_sofa_exact_other_fixture_dimensions_design_assumptions'
 # Export visible ceiling geometry, then leave the BLEND in an inspectable cutaway.
 exported=[o for o in scene.objects if o.type=='MESH' and o.get('component')];bpy.ops.object.select_all(action='DESELECT')
 for o in exported:o.hide_set(False);o.select_set(True)
 for o in col.objects:
  if o.type=='EMPTY':o.select_set(True)
 glb=out/(stem+'.glb');bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_cameras=False,export_lights=False)
 bpy.ops.object.select_all(action='DESELECT')
 for o in exported:
  if o.get('component')=='ceiling':o.hide_render=True;o.hide_set(True)
 scene['revision']=REV;scene.cycles.samples=64;scene.cycles.use_denoising=True
 # Blender interior preview lighting only. GLB export_lights=False above leaves
 # S3's runtime lighting untouched. Watts are design values, not measured lux.
 for lamp in scene.objects:
  if lamp.type=='LIGHT' and lamp.name.startswith('Interior '):lamp.data.energy=120 if 'living-kitchen' in lamp.name else 35
 for name,x,z,energy,size in [('Kitchen task light',11.95,9.4,75,2.0),('Living fill',17.2,8.4,100,3.0)]:
  data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.size=size;data.color=(1,.92,.82);obj=bpy.data.objects.new(name,data);scene.collection.children.get('07_Interior_Lighting').objects.link(obj);obj.location=(x,-z,2.39)
 scene.view_settings.exposure=0
 # Named review cameras persist in the deliverable.
 for name,pos,target in [('Kitchen review',(12.0,-6.3,1.60),(11.9,-10.5,1.15)),('Living review',(19.0,-6.4,1.60),(12.9,-8.5,1.10))]:
  data=bpy.data.cameras.new(name);cam=bpy.data.objects.new(name,data);scene.collection.objects.link(cam);cam.location=pos;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();data.lens=24
 blend=out/(stem+'.blend');bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(blend))
 info.update(finish_revision=REV,mesh_count=len(exported),glb_sha256=sha(glb),blend_sha256=sha(blend));dump(out/'model-info.json',info)
 dump(out/'preservation.json',dict(passed=True,variant=variant,source_sha256=sha(src/(stem+'.blend')),protected_structural_meshes=len(structural)-len(intentional),unexpected_changes=changed,source_room_opening_coordinates_unchanged=True,sliding_panels_offset=sorted(intentional),replaced_fixture_meshes=len(removed),old_meshes=old_mesh_count,new_meshes=len(exported),browser_validation_pending=True))
 print(json.dumps({'variant':variant,'path':str(out),'meshes':len(exported),'fixtures':len(info['fixtures']),'sliding':sliding}),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--variant',choices=['basic','expanded','both'],default='both');a=p.parse_args()
 for v in ['basic','expanded'] if a.variant=='both' else [a.variant]:build(v)
