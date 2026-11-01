#!/usr/bin/env python3
"""Furnish the four coordinate-based homes without moving their structural vertices.
168C expanded: qualitative VR finish/fixture reference; other layouts adapted.
Unmeasured fixtures have explicit design dimensions, never promoted to survey data.
"""
import argparse, hashlib, json, math
from pathlib import Path
import bpy
from mathutils import Vector
from shapely.geometry import Polygon, box as rect, Point
from shapely.ops import unary_union
from acro168c_kitchen import add_kitchen
ROOT=Path(__file__).resolve().parents[2]
REV='archisketch-interiors-v1'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def dump(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def build(unit,variant,render=False,detail_review=None):
 revision="archisketch-details-v2" if detail_review else REV
 structure_revision="archisketch-structure-v2" if detail_review else "archisketch-structure-v1"
 key=unit.lower();source=ROOT/f'assets/models/acro-river-park/{key}/{structure_revision}/{variant}'
 out=ROOT/f'assets/models/acro-river-park/{key}/{revision}/{variant}';out.mkdir(parents=True,exist_ok=True)
 stem=f'acro{key}-{variant}';source_stem=stem+'-archisketch'
 info=json.loads((source/'model-info.json').read_text());rooms={r['id']:r for r in info['rooms']};height=info['ceiling_height_m']
 bpy.ops.wm.open_mainfile(filepath=str(source/(source_stem+'.blend')));scene=bpy.context.scene;bpy.context.view_layer.update()
 def geo(o):return {'vertices':[tuple(o.matrix_world@v.co) for v in o.data.vertices],'faces':[tuple(p.vertices) for p in o.data.polygons]}
 original={o.name:geo(o) for o in scene.objects if o.type=='MESH' and o.get('component')}
 original_hash={k:hashlib.sha256(json.dumps(v).encode()).hexdigest() for k,v in original.items()}
 col=bpy.data.collections.new('06_Interiors');scene.collection.children.link(col)
 lights=bpy.data.collections.new('07_Interior_Lighting');scene.collection.children.link(lights)
 textures={k:bpy.data.images.load(str(ROOT/'assets/materials/generated-v1'/f),check_existing=True) for k,f in [('stone','limestone.png'),('oak','oak.png')]}
 for im in textures.values():im.pack()
 def mat(name,color,rough=.6,metal=0,texture=None,alpha=1,emission=0):
  m=bpy.data.materials.new(unit+' / '+name);m.use_nodes=True;m.diffuse_color=(*color,alpha);m['texture_repeat_m']=1.2
  n=m.node_tree.nodes['Principled BSDF'];n.inputs['Base Color'].default_value=(*color,1);n.inputs['Roughness'].default_value=rough;n.inputs['Metallic'].default_value=metal;n.inputs['Alpha'].default_value=alpha
  if texture:
   t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=textures[texture];m.node_tree.links.new(t.outputs['Color'],n.inputs['Base Color'])
  if alpha<1:m.surface_render_method='DITHERED'
  if emission:n.inputs['Emission Color'].default_value=(*color,1);n.inputs['Emission Strength'].default_value=emission
  return m
 stone=mat('VR polished stone floor',(.76,.70,.58),.27,texture='stone');oak=mat('Bedroom light oak',(.6,.42,.24),.44,texture='oak')
 wall=mat('Warm ivory plaster',(.78,.755,.7),.82);wallstone=mat('VR beige stone wall',(.7,.65,.55),.36,texture='stone');gray=mat('VR warm gray plaster',(.43,.42,.40),.85)
 bathstone=mat('Travertine bathroom',(.59,.57,.51),.4,texture='stone');ceiling=mat('Ceiling warm white',(.88,.87,.84),.85)
 walnut=mat('Smoked oak door',(.28,.21,.14),.4,texture='oak');white=mat('Lacquer warm white',(.83,.81,.75),.38)
 dark=mat('Charcoal lacquer',(.055,.063,.071),.3);black=mat('Black glass',(.013,.018,.023),.19,.12);steel=mat('brushed nickel',(.58,.62,.65),.24,.83)
 ceramic=mat('Porcelain',(.88,.89,.86),.18);mirror=mat('Mirror',(.83,.87,.90),.055,.98);glass=mat('Clear neutral glazing',(.79,.86,.88),.08,alpha=.18)
 grout=mat('Stone joints',(.43,.40,.35),.8);fabric=mat('Ivory woven linen',(.72,.69,.60),.95);linen=mat('Offwhite bed linen',(.86,.835,.77),.95);diffuser=mat('Warm light diffuser',(1,.88,.69),.5,emission=2)
 def uv(o):
  layer=o.data.uv_layers.active or o.data.uv_layers.new(name='MetricUV')
  for face in o.data.polygons:
   axis=max(range(3),key=lambda i:abs(face.normal[i]))
   for j in face.loop_indices:
    v=o.matrix_world@o.data.vertices[o.data.loops[j].vertex_index].co
    layer.data[j].uv=(v.x/1.2,-v.y/1.2) if axis==2 else ((-v.y/1.2,v.z/1.2) if axis==0 else (v.x/1.2,v.z/1.2))
 polys={r['id']:Polygon(r['polygon_m']) for r in rooms.values()}
 def room_at(x,z):return next((r for r in rooms.values() if polys[r['id']].buffer(.001).covers(Point(x,z))),None)
 for o in list(scene.objects):
  if o.type!='MESH' or not o.get('component'):continue
  c=o['component'];m=None
  if c=='floor':
   r=rooms.get(o.get('room_id')) or rooms.get(o.name.split('/')[-1]);m=oak if r and r['kind'] in ['bedroom','storage'] else bathstone if r and r['kind']=='wet' else stone
  elif c=='wall':
   palette=[wall,wallstone,gray,bathstone];o.data.materials.clear()
   for m in palette:o.data.materials.append(m)
   for f in o.data.polygons:
    pt=o.matrix_world@f.center;n=o.matrix_world.to_3x3()@f.normal;r=room_at(pt.x+n.x*.06,-pt.y-n.y*.06)
    chosen=bathstone if r and r['kind']=='wet' else gray if unit=='168C' and r and r['id'] in ['bedroom-2','bedroom-3'] else wallstone if unit=='168C' and r and r['kind']=='living' else wall
    f.material_index=palette.index(chosen)
   m=None
  elif c=='ceiling':m=ceiling
  elif c in ['glass','sliding_panel']:m=glass
  elif c=='door_leaf':m=walnut if unit=='168C' else white
  elif c=='opening_frame':m=walnut if '/jamb' in o.name and unit=='168C' else white
  elif c=='excluded_volume':m=wall
  elif c=='base':m=wall
  if m:o.data.materials.clear();o.data.materials.append(m)
  uv(o)
 fixtures=[];active_id=None;active_component='decoration';active_room=None;active_parts=[]
 def move_col(o):
  for collection in list(o.users_collection):collection.objects.unlink(o)
  col.objects.link(o)
 def tag(o):
  o['component']=active_component;o['fixture_id']=active_id or o.name;o['dimension_basis']='design_assumption';o['room_id']=active_room or ''
  if active_component in ['decoration','lighting']:o['collision']=False
  active_parts.append(o);return o
 def box(name,x,z,w,d,b,h,m,bevel=.008):
  bpy.ops.mesh.primitive_cube_add(size=1,location=(x,-z,b+h/2));o=bpy.context.object;o.name=name;o.dimensions=(w,d,h);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);move_col(o);o.data.materials.append(m)
  if bevel:
   mod=o.modifiers.new('Soft manufactured edges','BEVEL');mod.width=min(bevel,w/5,d/5,h/5);mod.segments=2
   bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
  uv(o);return tag(o)
 def ellipse(name,x,z,w,d,b,h,m):
  bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,location=(x,-z,b+h/2));o=bpy.context.object;o.name=name;o.scale=(w/2,d/2,h/2);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);move_col(o);o.data.materials.append(m)
  for f in o.data.polygons:f.use_smooth=True
  return tag(o)
 def begin(id,room,component):
  nonlocal active_id,active_room,active_component,active_parts
  active_id=id;active_room=room;active_component=component;active_parts=[]
 def finish(title,movable=False,kind=None,basis='reference_guided_design_dimensions'):
  bpy.context.view_layer.update();parts=list(active_parts)
  verts=[o.matrix_world@v.co for o in parts for v in o.data.vertices];bounds=[min(v.x for v in verts),min(-v.y for v in verts),max(v.x for v in verts),max(-v.y for v in verts)];bottom=min(v.z for v in verts);top=max(v.z for v in verts)
  if movable:
   group=bpy.data.objects.new(active_id,None);col.objects.link(group);group['staging_id']=active_id;group['staging_title']=title;group['staging_kind']=kind
   for o in parts:o.parent=group
  footprints=[];all_footprints=[]
  for part in parts:
   pv=[part.matrix_world@v.co for v in part.data.vertices]
   all_footprints.append([min(v.x for v in pv),min(-v.y for v in pv),max(v.x for v in pv),max(-v.y for v in pv)])
   if max(v.z for v in pv)>.12 and min(v.z for v in pv)<1.75:
    footprints.append([min(v.x for v in pv),min(-v.y for v in pv),max(v.x for v in pv),max(-v.y for v in pv)])
  fixtures.append(dict(footprints_m=all_footprints,collision_footprints_m=footprints,id=active_id,title=title,room_id=active_room,component=active_component,bounds_m=bounds,bottom_m=bottom,top_m=top,movable=movable,dimension_basis=basis,mesh_names=[o.name for o in parts]))
  return fixtures[-1]
 def cabinet(id,room,bounds,front,modules,height=.9,bottom=0,sink=False,hob=False,fridge=False,rows=1):
  begin(id,room,'kitchen_fixture' if room=='living-kitchen-hall' else 'storage_fixture')
  spec=dict(kind='kitchen_fridge' if fridge else 'kitchen_cabinet',height_m=height,bottom_m=bottom,front=front,modules=modules,drawer_rows=rows,countertop=height<1.1 and bottom==0,sink=sink,hob=hob)
  def piece(n,size,loc,m):
   # Keep the established detailed cabinet geometry; adapt its footprint only to the current room coordinates.
   chosen=m
   if ('front' in n or 'carcass' in n or (unit=='168C' and n=='cap')):
    if room!='living-kitchen-hall':chosen=walnut if room=='dressing' and unit=='168C' else white
    elif unit=='112A':chosen=white
   if 'countertop' in n:chosen=stone if unit=='112A' else m
   return box(id+'/'+n,loc[0],-loc[1],size[0],size[1],loc[2]-size[2]/2,size[2],chosen)
  if fridge:
   x0,z0,x1,z1=bounds;cx=(x0+x1)/2;cz=(z0+z1)/2
   box(id+'/housing',cx,cz,x1-x0,z1-z0,0,height,dark)
   # Refrigerator doors face the open kitchen aisle.
   for i in range(2):
    zz=z0+(z1-z0)*(i+.5)/2
    box(id+'/steel door '+str(i),x1+.012,zz,.025,(z1-z0)/2-.008,.13,height-.20,steel)
    box(id+'/handle '+str(i),x1+.05,cz+(-.04 if i==0 else .04),.055,.022,.82,.72,steel)
  else:
   def oriented_piece(n,size,loc,m):
    if front=='south':loc=(loc[0],-(bounds[1]+bounds[3])-loc[1],loc[2])
    return piece(n,size,loc,m)
   add_kitchen(spec,bounds,oriented_piece)
   if hob:
    x0,z0,x1,z1=bounds;cx=(x0+x1)/2;cz=(z0+z1)/2
    box(id+'/induction',cx,cz,min(.50,x1-x0-.06),.64,height,.015,black)
    for ox in [-.13,.13]:
     for oz in [-.17,.17]:ellipse(id+'/burner',cx+ox,cz+oz,.16,.16,height+.015,.003,steel)
    box(id+'/hood',cx,cz,min(.50,x1-x0-.06),.70,1.47,.07,steel)
  return finish(id)
 if detail_review:
  from acro112a_reference_details import add_details
  lx,lz=add_details(dict(locals(),ROOT=ROOT),detail_review)
 else:
  # Kitchen layout is located from current polygons. Footprints have independent design sizes.
  living=rooms['living-kitchen-hall'];a,b,c,d=living['bounds_m']
  if unit=='168C':
   west=rooms['bedroom-3']['bounds_m'][2]+.20;south=max(p[1] for p in living['polygon_m'] if p[0]<west+2.6);south=min(south,d)
   pantry=rooms.get('kitchen-pantry') or rooms['kitchen-balcony'];north=rooms['bedroom-3']['bounds_m'][1]+.70
   counter_end=south-.68
   cabinet('Kitchen west base','living-kitchen-hall',[west+.035,north,west+.655,counter_end],'east',5,hob=True)
   cabinet('Kitchen west wall units','living-kitchen-hall',[west+.035,north,west+.395,counter_end],'east',5,height=.68,bottom=1.52)
   cabinet('Kitchen sink run','living-kitchen-hall',[west+.035,south-.635,pantry['bounds_m'][0]-.235 if variant=='expanded' else west+2.01,south-.035],'north',3,sink=True)
   ix=west+2.15;iz=rooms['bedroom-3']['bounds_m'][1]+.80
   cabinet('Living kitchen island','living-kitchen-hall',[ix-.48,iz-.95,ix+.48,iz+.95],'east',3,rows=2)
   fridge_end=9.86 if variant=='expanded' else 9.48
   cabinet('Refrigerator housing','living-kitchen-hall',[ix+.05,fridge_end-1.18,ix+.91,fridge_end],'east',2,height=2.22,fridge=True)
   lx=min(c-2.5,18.0);lz=8.0 if variant=='expanded' else 7.3
  else:
   east=min(p[0] for p in living['polygon_m'] if p[0]>8.5);east=min(c,east)
   # The kitchen occupies the upper central branch; preserve the circulation below it.
   kitchen_top=.2 if variant=='expanded' else 1.68;right=9.68 if variant=='expanded' else 9.72
   cabinet('Kitchen rear sink','living-kitchen-hall',[7.80 if variant=='basic' else 7.10,kitchen_top+.04,right,kitchen_top+.66],'south',3,sink=True)
   cabinet('Kitchen east base','living-kitchen-hall',[right-.62,kitchen_top+.70,right,3.55],'west',4,hob=True)
   cabinet('Kitchen east wall units','living-kitchen-hall',[right-.36,kitchen_top+.70,right,3.55],'west',4,height=.66,bottom=1.57)
   cabinet('Refrigerator housing','living-kitchen-hall',[6.42,2.35,7.18,3.32],'east',2,height=2.18,fridge=True)
   cabinet('Kitchen peninsula island','living-kitchen-hall',[7.73,3.39,9.38,4.09],'south',3,rows=2)
   lx=7.4;lz=6.65 if variant=='basic' else 7.4
  # Product-sized sofa reused without scaling. Its placement is a proposed staging layout.
  begin('living-sofa','living-kitchen-hall','furniture')
  before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/furniture/catalog-sofa2790-stool980-v1/sofa.glb'))
  added=[o for o in bpy.data.objects if o not in before];meshes=[o for o in added if o.type=='MESH'];bpy.context.view_layer.update()
  vv=[o.matrix_world@v.co for o in meshes for v in o.data.vertices];cx=(min(v.x for v in vv)+max(v.x for v in vv))/2;cy=(min(v.y for v in vv)+max(v.y for v in vv))/2;floor=min(v.z for v in vv)
  for o in meshes:
   for extra in ['asset_id','staging_id']:
    if extra in o:del o[extra]
   matrix=o.matrix_world.copy();o.parent=None;o.matrix_world=matrix;o.location+=Vector((lx-cx,-lz-cy,-floor));o.name='Sofa / '+o.name;move_col(o);tag(o)
  for o in added:
   if o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True)
  finish('소파 279 × 117cm',True,'sofa','user_catalog_dimensions_2.79x1.17x0.73_m')
  begin('living-coffee-table','living-kitchen-hall','furniture')
  tx=lx;tz=lz-1.3;box('Coffee / top',tx,tz,1.1,.58,.34,.04,walnut,.025)
  for dx in [-.43,.43]:
   for dz in [-.19,.19]:box('Coffee / leg',tx+dx,tz+dz,.045,.045,0,.34,black)
  finish('거실 테이블 110 × 58cm',True,'coffee-table')
  # Bathrooms: shower/tub, vanity, toilet, mirror. No structural wall changes.
  for rid in ['bathroom-1','primary-bath']:
   r=rooms[rid];x0,z0,x1,z1=r['bounds_m'];w=x1-x0;dep=z1-z0
   begin(rid+'-fixtures',rid,'bathroom_fixture')
   if unit=='168C':
    # Shower/tub on the west side, leaving the entrance on the east clear.
    wetw=.78;wetd=dep-.08;wx=x0+wetw/2+.025;wz=(z0+z1)/2
    if rid=='primary-bath':
     box('Bath / tub base',wx,wz,wetw,wetd,0,.52,ceramic,.06);box('Bath / tub recess',wx,wz,wetw-.13,wetd-.17,.51,.014,bathstone,.07)
     box('Bath / tub waterline',wx,wz,wetw-.18,wetd-.22,.524,.012,white,.06)
    else:
     box('Shower / tray',wx,wz,wetw,wetd,0,.045,bathstone)
     box('Shower / fixed glass',x0+wetw+.03,z0+.46,.015,.78,.06,2.05,glass)
     box('Shower / chrome post',x0+wetw+.03,z0+.84,.018,.018,0,2.12,steel)
     box('Shower / head',x0+.34,z0+.17,.23,.18,2.03,.028,steel)
     box('Shower / riser',x0+.34,z0+.06,.022,.03,.95,1.08,steel)
    vx=x0+1.31;vz=z1-.265;vw=.62;vd=.45;tx=x1-.32;tz=z0+.65
   else:
    upper_right=min(p[0] for p in r['polygon_m'] if p[0]>x0+.10 and p[1]<z0+.1)
    wetw=upper_right-x0-.06;wetd=.70;wx=x0+.03+wetw/2;wz=z0+.38
    box('Shower / tray',wx,wz,wetw,wetd,0,.035,bathstone)
    box('Shower / fixed glass',x0+.27,z0+.75,.48,.015,.05,2.0,glass)
    box('Shower / head',x0+wetw-.20,z0+.15,.20,.18,2.03,.025,steel)
    box('Shower / riser',x0+wetw-.20,z0+.04,.025,.025,1,1.04,steel)
    if rid=='bathroom-1':vx=x0+.25;vz=z0+1.02;vw=.45;vd=.38;tx=x1-.26;tz=z0+1.47
    else:vx=x1-.35;vz=z1-.25;vw=.60;vd=.40;tx=x0+.26;tz=z1-.42
   box('Vanity / body',vx,vz,vw,vd,.23,.48,walnut);box('Vanity / porcelain rim',vx,vz,vw+.02,vd+.02,.71,.08,ceramic)
   ellipse('Vanity / bowl',vx,vz,vw-.12,vd-.11,.765,.025,bathstone);box('Vanity / tap',vx,vz-.12,.025,.07,.8,.18,steel)
   box('Vanity / mirror',vx,vz-.215,vw,.015,1.05,.85,mirror);box('Vanity / mirror light',vx,vz-.23,vw,.028,1.92,.025,diffuser)
   ellipse('WC / foot',tx,tz,.28,.46,0,.34,ceramic);ellipse('WC / bowl',tx,tz,.38,.62,.25,.19,ceramic);ellipse('WC / lid',tx,tz+.025,.37,.50,.43,.025,white);box('WC / tank',tx,tz-.25,.37,.15,.34,.42,ceramic,.04)
   finish(r['name']+' 위생기구')
  # Storage: use the deeper side so door clearances and the room starts remain free.
  for rid in ['dressing','hall-pantry','entry-storage']:
   if rid not in rooms:continue
   r=rooms[rid];x0,z0,x1,z1=r['bounds_m'];depth=.45 if z1-z0>.95 else .30
   cabinet(rid+' built-in',rid,[x0+.03,z0+.04,x1-.05,z0+depth], 'south',max(2,round((x1-x0)/.55)),height=min(2.32,height-.08))
  # 112A master bed and study restored as editable, exact design-sized furniture.
  if unit=='112A':
   r=rooms['primary'];x0,z0,x1,z1=r['bounds_m'];bx=x1-1.13;bz=z1-1.30
   begin('primary-king','primary','furniture');box('King / base',bx,bz,2.17,1.78,.04,.26,walnut,.04);box('King / mattress',bx,bz,2.075,1.67,.30,.20,linen,.07);box('King / headboard',bx-1.10,bz,.075,1.84,0,1.05,fabric,.03);box('King / duvet',bx+.18,bz,1.63,1.70,.50,.08,linen,.04)
   for dz in [-.42,.42]:ellipse('King / pillow',bx-.73,bz+dz,.53,.66,.54,.12,white)
   finish('안방 킹 침대',True,'king')
   r=rooms['bedroom-2'];x0,z0,x1,z1=r['bounds_m'];dx=x0+.64;dz=z0+.40
   begin('study-desk','bedroom-2','furniture');box('Desk / top',dx,dz,1.20,.60,.71,.03,oak)
   for ox in [-.54,.54]:
    for oz in [-.24,.24]:box('Desk / leg',dx+ox,dz+oz,.04,.04,0,.71,white)
   finish('작은 방 책상',True,'desk')
   begin('study-chair','bedroom-2','furniture');box('Chair / seat',dx,dz+.66,.45,.45,.43,.04,fabric,.035);box('Chair / back',dx,dz+.86,.45,.05,.47,.35,fabric,.025)
   for ox in [-.19,.19]:
    for oz in [-.19,.19]:box('Chair / leg',dx+ox,dz+.66+oz,.025,.025,0,.43,walnut)
   finish('작은 방 의자',True,'chair')
  else:
   # Bedroom 3 has a tall storage wall in the reference, other small bedrooms are empty.
   r=rooms['bedroom-3'];x0,z0,x1,z1=r['bounds_m'];cabinet('Bedroom 3 wardrobe','bedroom-3',[x1-.53,z0+.12,x1-.035,9.238 if variant=='expanded' else z1-.10],'west',4,height=min(2.32,height-.10))
 # Door levers move with the leaf through explicit accessory IDs in the web adapter.
 door_accessories={}
 for opening in info['openings']:
  if opening['kind']!='door':continue
  begin('handle-'+opening['id'],None,'door_accessory');x,z=opening['center_m'];w=opening.get('leaf_width_m',.8);handle_sign=-1 if opening.get('hinge_end')=='positive' else 1;along=opening['axis']=='x'
  for side in [-1,1]:
   box(opening['id']+f'/lever-{side}',x+(handle_sign*w*.34 if along else side*.045),z+(side*.045 if along else handle_sign*w*.34),.115 if along else .022,.022 if along else .115,.99,.018,steel,.006)
  door_accessories[opening['id']]=[o.name for o in active_parts]
 # Trim, tile joints and lighting add visual depth while retaining the floor/ceiling planes.
 begin('surface-details',None,'decoration')
 for r in rooms.values():
  if r['kind']=='living' and unit=='168C' or r['kind']=='wet':
   poly=polys[r['id']];x0,z0,x1,z1=r['bounds_m']
   from shapely.geometry import LineString
   for axis in [0,1]:
    start=x0 if axis==0 else z0;end=x1 if axis==0 else z1
    for i in range(math.ceil(start/.6),math.floor(end/.6)+1):
     t=i*.6;line=LineString([(t,z0),(t,z1)] if axis==0 else [(x0,t),(x1,t)]).intersection(poly)
     segments=[line] if line.geom_type=='LineString' else list(getattr(line,'geoms',[]))
     for seg in segments:
      if seg.geom_type!='LineString' or seg.length<.02:continue
      a,b=seg.coords[0],seg.coords[-1];box('Tile / fine joint',(a[0]+b[0])/2,(a[1]+b[1])/2,max(.0015,abs(b[0]-a[0])),max(.0015,abs(b[1]-a[1])),.001,.0008,grout,0)
  if r['kind'] not in ['balcony','utility']:
   x,z=r['representative_point_m'];box('Ceiling / light panel',x,z,.48,.48,height-.037,.025,diffuser)
 # VR living rings and a shallow recessed cove, all below the existing 2.50m ceiling.
 if unit=='168C':
  for i,(x,z,rad) in enumerate([(lx-.1,lz-.55,.26),(lx-1.3,lz+.3,.30),(lx+.45,lz+.6,.22)]):
   bpy.ops.mesh.primitive_torus_add(major_radius=rad,minor_radius=.026,major_segments=40,minor_segments=8,location=(x,-z,height-.20));o=bpy.context.object;o.name='Living / pendant ring '+str(i);move_col(o);o.data.materials.append(diffuser);tag(o)
  for x,z,w,d in [(lx,lz-2.05,4.25,.10),(lx,lz+1.7,4.25,.10),(lx-2.15,lz,.10,3.7),(lx+2.15,lz,.10,3.7)]:
   if polys['living-kitchen-hall'].covers(rect(x-w/2,z-d/2,x+w/2,z+d/2)):
    box('Living / ceiling cove',x,z,w,d,height-.10,.085,ceiling);box('Living / cove strip',x,z,w*.96,d*.4,height-.105,.008,diffuser)
 # Source structure geometry must be byte-for-byte equivalent as world-space vertex/face lists.
 bpy.context.view_layer.update();changed=[]
 for name,expected in original_hash.items():
  if hashlib.sha256(json.dumps(geo(bpy.data.objects[name])).encode()).hexdigest()!=expected:changed.append(name)
 assert not changed,changed
 outside=[]
 for f in fixtures:
  poly=polys[f['room_id']];over=unary_union([rect(*b) for b in f['footprints_m']]).difference(poly.buffer(.015)).area
  f['outside_room_m2']=round(over,6)
  if over>.001:outside.append({'id':f['id'],'outside_room_m2':over})
 assert not outside, outside
 # Choose free walk starts independently of the unchanged polygon representative points.
 solids=[rect(*footprint).buffer(.25) for f in fixtures for footprint in f['collision_footprints_m']]
 for r in info['rooms']:
  clear=polys[r['id']].buffer(-.25).difference(unary_union(solids))
  if not clear.is_empty:
   old=Point(r['representative_point_m']);p=old if clear.covers(old) else clear.representative_point();r['walk_start_m']=[round(p.x,5),round(p.y,5)]
   r['viewTarget']=[lx,lz] if r['id']=='living-kitchen-hall' else r['representative_point_m']
  elif r.get('navigable',True):r['navigable']=False
 exported=[o for o in scene.objects if o.type=='MESH' and o.get('component')]
 bpy.ops.object.select_all(action='DESELECT')
 for o in exported:o.hide_set(False);o.select_set(True)
 for o in col.objects:
  if o.type=='EMPTY':o.select_set(True)
 for o in bpy.data.collections.get('90_Review').objects:o.hide_render=True
 scene['revision']=revision;scene['structure_revision']=structure_revision
 glb=out/(stem+'.glb');bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_cameras=False,export_lights=False)
 bpy.ops.object.select_all(action='DESELECT')
 for o in exported:
  if o.get('component')=='ceiling':o.hide_render=True;o.hide_set(True)
 scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.4
 for r in rooms.values():
  if r['kind'] in ['balcony','utility']:continue
  x,z=r['representative_point_m'];data=bpy.data.lights.new('Interior '+r['id'],'AREA');data.energy=45 if r['kind']=='living' else 25;data.size=1.4;data.color=(1,.90,.76);o=bpy.data.objects.new(data.name,data);lights.objects.link(o);o.location=(x,-z,height-.12)
 scene.camera=bpy.data.objects['Isometric'];scene.camera.data.ortho_scale=18 if unit=='112A' else 27
 scene.render.resolution_x=1280;scene.render.resolution_y=850;scene.cycles.samples=16
 bpy.context.preferences.filepaths.save_version=0;blend=out/(stem+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(blend))
 info.update(finish_revision=revision,revision=structure_revision,fixture_dimensions_status='per_fixture_source_or_design_basis' if detail_review else 'design_assumptions_except_catalog_sofa_and_selected_king_mattress',fixtures=fixtures,door_accessories=door_accessories,mesh_count=len(exported),glb_sha256=sha(glb),blend_sha256=sha(blend))
 dump(out/'model-info.json',info);dump(out/'preservation.json',{'passed':True,'structural_meshes_checked':len(original),'comparison':'exact world vertex and polygon index lists','changed':changed,'source_blend_sha256':sha(source/(source_stem+'.blend')),'source_glb_sha256':sha(source/(source_stem+'.glb')),'outside_fixture_footprints':outside})
 if render:
  for name in ['Isometric','Plan']:
   if detail_review:
    for obj in scene.objects:
     if obj.type=='MESH' and obj.get('component')=='wall':obj.hide_render=name=='Plan' and obj.get('layer_bottom_m',0)>1.3
     if obj.name.startswith('Ceiling /'):obj.hide_render=name=='Plan'
   scene.camera=bpy.data.objects[name];scene.camera.data.ortho_scale=18 if unit=='112A' else 27;scene.render.filepath=str(out/('isometric.png' if name=='Isometric' else 'top-view.png'));bpy.ops.render.render(write_still=True)
 print(json.dumps({'unit':unit,'variant':variant,'meshes':len(exported),'fixtures':len(fixtures),'outside':outside,'out':str(out)},ensure_ascii=False),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--unit-type',choices=['112A','168C','all'],default='all');p.add_argument('--variant',choices=['basic','expanded','both'],default='both');p.add_argument('--render',action='store_true');p.add_argument('--detail-sources',type=Path);a=p.parse_args();detail_sources=json.loads(a.detail_sources.read_text()) if a.detail_sources else {};detail_sources={k:str(Path(v) if Path(v).is_absolute() else ROOT.parent/v) for k,v in detail_sources.items()}
 for u in ['112A','168C'] if a.unit_type=='all' else [a.unit_type]:
  for v in ['basic','expanded'] if a.variant=='both' else [a.variant]:build(u,v,a.render,detail_sources.get(v) if u=='112A' else None)
