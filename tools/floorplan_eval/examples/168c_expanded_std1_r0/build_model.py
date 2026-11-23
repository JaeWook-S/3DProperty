"""Build the apartment from the supplied raster, in meters, with no external assets.
Run with the Python executable specified in the task. Blender Z-up is exported as
Y-up glTF: (Blender x, Blender y, Blender z) -> (plan x, elevation, plan z).
"""
import bpy
import math
import json
import struct
from pathlib import Path
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

OUT = Path(__file__).resolve().parent
THICKNESS = 0.20
WALL_HEIGHT = 2.30
# Piecewise dimensional calibration. All positions below are traced image pixels.
X_ANCHORS = [(89.5,0.0),(234.0,3.84),(337.5,6.70),(460.5,10.16),
             (785.5,19.00),(836.5,20.50)]
Z_ANCHORS = [(124.0,0.0),(250.5,3.340),(274.0,4.015),(291.5,4.430),
             (339.5,5.765),(452.0,8.800),(494.5,10.060),
             (505.5,10.300),(549.0,11.510)]

def interp(p, anchors):
    for (a,u),(b,v) in zip(anchors,anchors[1:]):
        if p <= b:
            return u+(p-a)*(v-u)/(b-a)
    a,u=anchors[-2]; b,v=anchors[-1]
    return u+(p-a)*(v-u)/(b-a)

def point(pixel):
    return (interp(pixel[0],X_ANCHORS),interp(pixel[1],Z_ANCHORS))

def vec(p, h=0):
    return (p[0],-p[1],h)

def r(v):
    return round(float(v),6)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for data in list(bpy.data.materials):
    bpy.data.materials.remove(data)
scene = bpy.context.scene
scene.unit_settings.system='METRIC'
scene.unit_settings.scale_length=1.0
scene.unit_settings.length_unit='METERS'
scene['source']='inputs/plan.jpg'
scene['plan_frame']='glTF x=east/right in image; y=elevation; z=south/down in image. Floor y=0.'
scene['dimension_basis']='Lower 20.50 m horizontal chain; 11.51 m vertical dimension.'

collections={}
for name in ['Walls','Swing doors','Sliding doors','Windows','Door frames','Floors','Balcony railing','Presentation']:
    col=bpy.data.collections.new(name)
    scene.collection.children.link(col)
    collections[name]=col

def material(name,color,roughness=.6,metallic=0):
    m=bpy.data.materials.new(name); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Roughness'].default_value=roughness
    bs.inputs['Metallic'].default_value=metallic
    m.diffuse_color=(*color,1)
    return m

wallmat=material('Warm white plaster',(0.80,0.78,0.72),.8)
wood=material('Oak door leaves',(0.50,0.30,0.145),.5)
closetmat=material('Storage sliding panels',(0.81,0.80,0.74),.55)
entrancemat=material('Entrance graphite finish',(0.12,0.15,0.17),.45,.25)
framemat=material('Off white window and door frames',(0.76,0.79,0.79),.30,.32)
metal=material('Satin metal fittings',(0.35,0.40,0.43),.25,.7)
glass=material('Clear glazing',(0.73,0.87,0.91),.08)
bs=glass.node_tree.nodes.get('Principled BSDF')
bs.inputs['Transmission Weight'].default_value=1.0
bs.inputs['IOR'].default_value=1.45
bs.inputs['Alpha'].default_value=.28
glass.diffuse_color=(.73,.87,.91,.28)
glass.surface_render_method='DITHERED'
concrete=material('Slab and shaft floor',(0.40,0.43,0.44),.85)
roomwood=material('Bedroom natural oak',(0.66,0.53,0.34),.68)
hallwood=material('Living and corridor oak',(0.55,0.34,0.17),.6)
wetmat=material('Bathroom cool tile',(0.64,0.76,0.78),.65)
foyermat=material('Foyer light tile',(0.71,0.73,0.73),.75)
balconymat=material('Balcony limestone tile',(0.75,0.70,0.59),.8)
# Fine procedural floor variation, no textures or external resources required.
for mat,scale in [(roomwood,4),(hallwood,4),(wetmat,1.8),(foyermat,1.8),(balconymat,1.8)]:
    nt=mat.node_tree; bs=nt.nodes.get('Principled BSDF')
    tex=nt.nodes.new('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value=scale
    tex.inputs['Detail'].default_value=2
    bump=nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.08
    bump.inputs['Distance'].default_value=.015
    nt.links.new(tex.outputs['Fac'],bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'],bs.inputs['Normal'])

class MeshBuilder:
    def __init__(self): self.vertices=[]; self.faces=[]; self.mats=[]
    def box(self,lo,hi,mat=0):
        x0,y0,z0=lo; x1,y1,z1=hi
        if min(x1-x0,y1-y0,z1-z0)<1e-7:return
        k=len(self.vertices)
        self.vertices.extend([(x0,y0,z0),(x1,y0,z0),(x1,y1,z0),(x0,y1,z0),
                              (x0,y0,z1),(x1,y0,z1),(x1,y1,z1),(x0,y1,z1)])
        self.faces.extend([tuple(k+i for i in f) for f in
            [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]])
        self.mats.extend([mat]*6)
    def make(self,name,materials,collection,origin=(0,0,0),rotation=0):
        mesh=bpy.data.meshes.new(name+'_mesh')
        mesh.from_pydata(self.vertices,[],self.faces); mesh.update()
        ob=bpy.data.objects.new(name,mesh); collections[collection].objects.link(ob)
        for m in materials:mesh.materials.append(m)
        for poly,mi in zip(mesh.polygons,self.mats):poly.material_index=mi
        ob.location=origin; ob.rotation_euler[2]=rotation
        return ob

walls=[]; openings=[]; wall_lookup={}; room_areas={}

def wall(a,b,label):
    a=point(a); b=point(b)
    ident=f'wall_{len(walls)+1}'
    record={'id':ident,'start':[r(v) for v in a],'end':[r(v) for v in b],
            'thickness':THICKNESS,'height':WALL_HEIGHT}
    walls.append(record); wall_lookup[ident]={'data':record,'label':label,'openings':[]}
    return ident

# Exterior and stepped outline.
west=wall((89.5,250.5),(89.5,505.5),'West exterior')
nw=wall((89.5,250.5),(373.5,250.5),'North exterior of west wing')
entry_w=wall((373.5,159.5),(373.5,291.5),'Entrance and foyer west')
entry_n=wall((373.5,159.5),(441.5,159.5),'Foyer north step / shaft south')
shaft_w=wall((407.5,124),(407.5,159.5),'Northwest service shaft west')
north=wall((407.5,124),(816.5,124),'North exterior')
ne=wall((816.5,124),(816.5,277.5),'East exterior of upper balcony and service room')
east_step=wall((765,277.5),(836.5,277.5),'Upper balcony south / east exterior step')
east=wall((836.5,277.5),(836.5,494.5),'Living room east exterior')
living_s=wall((650.5,494.5),(836.5,494.5),'Living room south / balcony glazing')
return_e=wall((650.5,471.5),(650.5,494.5),'Living room south return')
utility_n=wall((543.5,471.5),(650.5,471.5),'Kitchen utility north')
south=wall((460.5,549),(629.5,549),'Kitchen and utility south exterior')
west_bed_s=wall((89.5,505.5),(460.5,505.5),'Three bedrooms south exterior')
# West wing and corridor.
bedrooms_n=wall((89.5,339.5),(490.5,339.5),'Bedroom doors / corridor south')
bed12=wall((234,339.5),(234,505.5),'West / middle bedroom partition')
bed23=wall((337.5,339.5),(337.5,505.5),'Middle / east bedroom partition')
kitchen_w=wall((460.5,339.5),(460.5,549),'East bedroom / kitchen and kitchen exterior west')
left_bath_n=wall((89.5,274),(191.5,274),'Shared bathroom north / service shaft')
left_bath_e=wall((191.5,250.5),(191.5,339.5),'Shared bathroom east / service shaft')
left_core_s=wall((191.5,291.5),(373.5,291.5),'West corridor north storage and shafts')
core_a=wall((246,250.5),(246,291.5),'West storage niche west')
core_b=wall((323.5,250.5),(323.5,291.5),'West storage niche east')
foyer_storage_s=wall((373.5,198.5),(441.5,198.5),'Foyer storage front')
core_e=wall((441.5,124),(441.5,291.5),'Foyer east / master service core west')
# Master suite / dressing area / second bathroom.
dressing_step=wall((441.5,211.5),(495.5,211.5),'Dressing closet south step / shaft north')
bath_n=wall((495.5,193.5),(589.5,193.5),'Master bathroom north')
dressing_partition=wall((543.5,124),(543.5,193.5),'Walk in storage east')
bath_w=wall((495.5,193.5),(495.5,259.5),'Master bathroom west / shaft')
bath_s=wall((441.5,259.5),(589.5,259.5),'Master bathroom and shaft south')
bath_e=wall((589.5,193.5),(589.5,291.5),'Master bathroom / bedroom partition')
master_s=wall((441.5,291.5),(836.5,291.5),'Master suite and storage / corridor north')
master_e=wall((765,124),(765,291.5),'Master bedroom / east balcony')
balcony_service_s=wall((765,179.5),(816.5,179.5),'Upper balcony service room door')
# Kitchen service shaft and southern utility / balcony.
kitchen_shaft_s=wall((460.5,364.5),(490.5,364.5),'Kitchen service shaft south')
kitchen_shaft_e=wall((490.5,339.5),(490.5,364.5),'Kitchen service shaft east')
utility_w=wall((543.5,471.5),(543.5,549),'Kitchen / utility door wall')
utility_e=wall((629.5,471.5),(629.5,549),'Utility / south balcony partition')
south_shaft_n=wall((593.5,517),(629.5,517),'South utility shaft north')
south_shaft_w=wall((593.5,517),(593.5,549),'South utility shaft west')

next_door=0; next_window=0

def add_opening(host,typ,center_pixel,width,height,sill=0,hinge=None,swing=None,label='',glazed=False):
    global next_door,next_window
    if typ=='window':
        next_window+=1; ident=f'window_{next_window}'
    else:
        next_door+=1; ident=f'door_{next_door}'
    p=point(center_pixel)
    rec={'id':ident,'type':typ,'center':[r(v) for v in p],'width':r(width),'height':height,
         'sill':sill,'host_wall':host,'hinge_side':hinge,'swing_direction':swing}
    openings.append(rec)
    wall_lookup[host]['openings'].append(rec)
    rec_extra[ident]={'label':label,'glazed':glazed}
    return rec

rec_extra={}

def swing(host,p,width=.90,entrance=False,hinge='start',direction='counterclockwise',label=''):
    return add_opening(host,'swing_door',p,width,2.30 if entrance else 2.12,
                       hinge=hinge,swing=direction,label=label)

def span_opening(host,typ,ends,glazed=False,label=''):
    a,b=map(point,ends)
    width=math.dist(a,b)
    center=((a[0]+b[0])/2,(a[1]+b[1])/2)
    if typ=='window': height,sill=1.75,.425
    elif glazed: height,sill=2.30,0
    else: height,sill=1.98,0
    pixel_center=((ends[0][0]+ends[1][0])/2,(ends[0][1]+ends[1][1])/2)
    rec=add_opening(host,typ,pixel_center,width,height,sill,label=label,glazed=glazed)
    rec['center']=[r(v) for v in center] # metric midpoint, even across calibration intervals
    return rec

# Swing leaves are posed at 90 degrees as drawn, and each object's origin is its hinge.
swing(entry_w,(373.5,225.5),1.00,True,'end','counterclockwise','Apartment entrance: opens outward west')
swing(left_bath_e,(191.5,320.5),hinge='end',direction='counterclockwise',label='Shared bathroom: opens west')
swing(bedrooms_n,(215.5,339.5),hinge='end',direction='counterclockwise',label='West bedroom: opens south')
swing(bedrooms_n,(317.5,339.5),hinge='end',direction='counterclockwise',label='Middle bedroom: opens south')
swing(bedrooms_n,(360,339.5),hinge='start',direction='clockwise',label='East bedroom: opens south')
swing(master_s,(630,291.5),hinge='start',direction='counterclockwise',label='Master bedroom: opens north')
swing(bath_n,(571,193.5),hinge='end',direction='counterclockwise',label='Master bathroom: opens south')
swing(balcony_service_s,(793.5,179.5),hinge='start',direction='clockwise',label='Upper balcony service room: opens south')
swing(utility_w,(543.5,492.5),hinge='start',direction='counterclockwise',label='Kitchen utility: opens east')
# Double-line symbols without arcs are reconstructed as sliding openings.
span_opening(left_core_s,'sliding_door',((264,291.5),(306,291.5)),label='West corridor storage sliding doors')
span_opening(foyer_storage_s,'sliding_door',((390,198.5),(422,198.5)),label='Foyer storage sliding doors')
span_opening(dressing_partition,'sliding_door',((543.5,152),(543.5,186)),label='Dressing storage sliding doors')
span_opening(master_s,'sliding_door',((484,291.5),(551,291.5)),label='Central corridor storage sliding doors')
span_opening(master_e,'sliding_door',((765,193),(765,262)),True,'Master bedroom balcony full height glazing')
span_opening(living_s,'sliding_door',((659,494.5),(770,494.5)),True,'Living room balcony full height glazing')
# Windows use the default 1.75 m height and 0.425 m sill.
span_opening(west_bed_s,'window',((121,505.5),(199,505.5)),label='West bedroom window')
span_opening(west_bed_s,'window',((254,505.5),(320,505.5)),label='Middle bedroom window')
span_opening(west_bed_s,'window',((369,505.5),(435,505.5)),label='East bedroom window')
span_opening(east,'window',((836.5,311),(836.5,455)),label='Living room picture window')
span_opening(ne,'window',((816.5,132),(816.5,173)),label='Upper service room window')
span_opening(ne,'window',((816.5,193),(816.5,262)),label='East balcony outer window')
span_opening(south,'window',((494,549),(538,549)),label='Kitchen south window')
span_opening(south,'window',((554,549),(585,549)),label='South utility window')

# Retain the drawn hinge-side jamb positions when imposing the standard width.
# This avoids moving a leaf into the adjoining perpendicular partition.
drawn_hinge_jambs={
    'door_1':(373.5,240.5), 'door_2':(191.5,335.5),
    'door_3':(229,339.5), 'door_4':(332,339.5),
    'door_5':(347,339.5), 'door_6':(616.5,291.5),
    'door_7':(585,193.5), 'door_8':(779,179.5), 'door_9':(543.5,479),
}
for op in openings:
    if op['id'] in drawn_hinge_jambs:
        w=wall_lookup[op['host_wall']]['data']
        tangent=(Vector(w['end'])-Vector(w['start'])).normalized()
        jamb=Vector(point(drawn_hinge_jambs[op['id']]))
        center=jamb+tangent*(op['width']/2 if op['hinge_side']=='start' else -op['width']/2)
        op['center']=[r(v) for v in center]

def wall_basis(w):
    a=Vector(w['start']); b=Vector(w['end']); t=(b-a).normalized()
    return a,t,(b-a).length,math.atan2(-t.y,t.x)

# Walls are explicit solid sections around the holes, rather than solids hidden by doors.
for w in walls:
    a,t,L,rot=wall_basis(w)
    holes=[]
    for op in wall_lookup[w['id']]['openings']:
        c=(Vector(op['center'])-a).dot(t)
        u,v=c-op['width']/2,c+op['width']/2
        assert u>=-.00001 and v<=L+.00001,(w['id'],op['id'],u,v,L)
        holes.append((u,v,op['sill'],op['sill']+op['height']))
    # Continuous horizontal courses own the junction volumes. Vertical courses
    # meet their faces, eliminating coincident top faces and overlapping solids.
    horizontal=abs(t.y)<1e-7
    exclusions=[]
    if not horizontal:
        for other in walls:
            if abs(other['start'][1]-other['end'][1])<1e-7:
                x0,x1=sorted([other['start'][0],other['end'][0]])
                if x0-.1-1e-6<=a.x<=x1+.1+1e-6:
                    distance=other['start'][1]-a.y
                    lo,hi=max(0,distance-.1),min(L,distance+.1)
                    if hi>lo:exclusions.append((lo,hi))
    cuts=sorted(set(([-.1,L+.1] if horizontal else [0,L])
                    +[v for h in holes for v in h[:2]]
                    +[v for interval in exclusions for v in interval]))
    mb=MeshBuilder()
    for u,v in zip(cuts,cuts[1:]):
        mid=(u+v)/2
        if any(lo<mid<hi for lo,hi in exclusions):continue
        h=next((h for h in holes if h[0]<mid<h[1]),None)
        if h:
            mb.box((u,-.1,0),(v,.1,h[2]))
            mb.box((u,-.1,h[3]),(v,.1,WALL_HEIGHT))
        else:mb.box((u,-.1,0),(v,.1,WALL_HEIGHT))
    ob=mb.make(w['id'],[wallmat],'Walls',vec(a),rot)
    ob['type']='wall'; ob['thickness']=THICKNESS; ob['height']=WALL_HEIGHT
    ob['description']=wall_lookup[w['id']]['label']
    ob['plan_start']=w['start']; ob['plan_end']=w['end']
    ob['opening_ids']=[o['id'] for o in wall_lookup[w['id']]['openings']]

# Door frames and each swing leaf are separate meshes; the leaf origin remains at the hinge.
for op in openings:
    w=wall_lookup[op['host_wall']]['data']; a,t,L,rot=wall_basis(w)
    c=Vector(op['center']); width=op['width']; height=op['height']; sill=op['sill']
    label=rec_extra[op['id']]['label']
    if op['type']=='swing_door':
        mb=MeshBuilder(); jamb=.018
        mb.box((-width/2,-.112,0),(-width/2+jamb,.112,height))
        mb.box((width/2-jamb,-.112,0),(width/2,.112,height))
        if height<2.30:mb.box((-width/2,-.112,height-.025),(width/2,.112,height))
        frame=mb.make(op['id']+'_frame',[framemat],'Door frames',vec(c),rot)
        frame['host_wall']=op['host_wall']
        start=op['hinge_side']=='start'
        hinge=c+t*(-width/2+jamb if start else width/2-jamb)
        closed_angle=math.atan2(t.y,t.x)+(0 if start else math.pi)
        delta=math.pi/2 if op['swing_direction']=='clockwise' else -math.pi/2
        open_angle=closed_angle+delta
        leaf_width=width-2*jamb-.005
        mb=MeshBuilder()
        mb.box((0,-.021,.012),(leaf_width,.021,height-.016))
        ob=mb.make(op['id'],[entrancemat if op['id']=='door_1' else wood],
                   'Swing doors',vec(hinge),-open_angle)
        ob['type']='swing_door'; ob['host_wall']=op['host_wall']; ob['description']=label
        ob['opening_width']=width; ob['opening_height']=height
        ob['hinge_side']=op['hinge_side']; ob['swing_direction']=op['swing_direction']
        ob['open_angle_degrees']=90.0
        ob['hinge_plan']=[r(hinge.x),r(hinge.y)]
        # Lever hardware is parented to the movable leaf.
        hm=MeshBuilder()
        for side in [-1,1]:
            if side==1:
                hm.box((leaf_width-.14,.021,.99),(leaf_width-.10,.045,1.06))
                hm.box((leaf_width-.22,.039,1.025),(leaf_width-.11,.060,1.045))
            else:
                hm.box((leaf_width-.14,-.045,.99),(leaf_width-.10,-.021,1.06))
                hm.box((leaf_width-.22,-.060,1.025),(leaf_width-.11,-.039,1.045))
        handle=hm.make(op['id']+'_hardware',[metal],'Swing doors')
        handle.parent=ob
    elif op['type']=='sliding_door':
        # Head and side tracks sit inside the actual opening. No bottom obstruction.
        mb=MeshBuilder(); rail=.028
        mb.box((-width/2,-.095,0),(-width/2+rail,.095,height))
        mb.box((width/2-rail,-.095,0),(width/2,.095,height))
        mb.box((-width/2,-.095,height-rail),(width/2,.095,height))
        frame=mb.make(op['id']+'_frame',[framemat],'Door frames',vec(c),rot)
        frame['host_wall']=op['host_wall']
        glazed=rec_extra[op['id']]['glazed']; overlap=.032
        usable=width-2*rail; panelw=usable/2+overlap/2
        for k in range(2):
            # Closed bypass sliders, with a small overlap on separate tracks.
            x0=-usable/2 if k==0 else -overlap/2
            x1=x0+panelw; depth=-.035 if k==0 else .035
            mb=MeshBuilder(); f=.038; bottom=.012; top=height-rail-.008
            if glazed:
                mb.box((x0,depth-.019,bottom),(x0+f,depth+.019,top))
                mb.box((x1-f,depth-.019,bottom),(x1,depth+.019,top))
                mb.box((x0+f,depth-.019,bottom),(x1-f,depth+.019,bottom+f))
                mb.box((x0+f,depth-.019,top-f),(x1-f,depth+.019,top))
                mb.box((x0+f,depth-.005,bottom+f),(x1-f,depth+.005,top-f),1)
            else:
                mb.box((x0,depth-.018,bottom),(x1,depth+.018,top))
            ob=mb.make(f"{op['id']}_panel_{k+1}",[framemat if glazed else closetmat,glass],
                        'Sliding doors',vec(c),rot)
            ob['type']='sliding_door_panel'; ob['opening_id']=op['id']; ob['host_wall']=op['host_wall']
            ob['description']=label; ob['panel_index']=k+1; ob['pose']='closed, two bypass tracks'
    else:
        mb=MeshBuilder(); f=.045; dep=.075
        mb.box((-width/2,-dep,sill),(-width/2+f,dep,sill+height))
        mb.box((width/2-f,-dep,sill),(width/2,dep,sill+height))
        mb.box((-width/2+f,-dep,sill),(width/2-f,dep,sill+f))
        mb.box((-width/2+f,-dep,sill+height-f),(width/2-f,dep,sill+height))
        mb.box((-.018,-dep,sill+f),(.018,dep,sill+height-f))
        for u,v in [(-width/2+f,-.018),(.018,width/2-f)]:
            mb.box((u,-.006,sill+f),(v,.006,sill+height-f),1)
        ob=mb.make(op['id'],[framemat,glass],'Windows',vec(c),rot)
        for key in ['type','width','height','sill','host_wall']:ob[key]=op[key]
        ob['description']=label

# Plan polygon slabs, top face exactly at the specified floor height.
def polygon_slab(name,pixels,top,thickness,mat,collection='Floors'):
    pp=[point(p) for p in pixels]
    xy=[Vector((p[0],-p[1],top)) for p in pp]
    n=len(xy); verts=[tuple(v) for v in xy]+[(v.x,v.y,top-thickness) for v in xy]
    faces=[]
    for tri in tessellate_polygon([xy]):
        ids=[v if isinstance(v,int) else min(range(n),key=lambda i:(xy[i]-v).length_squared) for v in tri]
        # Winding should face upwards for the floor surface.
        if (xy[ids[1]]-xy[ids[0]]).cross(xy[ids[2]]-xy[ids[0]]).z<0:ids.reverse()
        faces.append(tuple(ids)); faces.append(tuple(i+n for i in reversed(ids)))
    for i in range(n):
        j=(i+1)%n; faces.append((i,j,j+n,i+n))
    mb=MeshBuilder(); mb.vertices=verts; mb.faces=faces; mb.mats=[0]*len(faces)
    ob=mb.make(name,[mat],collection)
    area=abs(sum(pp[i][0]*pp[(i+1)%n][1]-pp[(i+1)%n][0]*pp[i][1] for i in range(n)))/2
    ob['plan_area_m2']=area
    return ob

def room(name,pixels,mat):
    ob=polygon_slab('floor_'+name,pixels,0,.02,mat)
    room_areas[name]=round(ob['plan_area_m2'],3)
    return ob

def rect(x0,y0,x1,y1):return [(x0,y0),(x1,y0),(x1,y1),(x0,y1)]

outline=[(89.5,250.5),(373.5,250.5),(373.5,159.5),(407.5,159.5),
 (407.5,124),(816.5,124),(816.5,277.5),(836.5,277.5),(836.5,494.5),
 (785.5,494.5),(785.5,545.5),(629.5,545.5),(629.5,549),
 (460.5,549),(460.5,505.5),(89.5,505.5)]
slab=polygon_slab('floor_structural_slab',outline,-.02,.16,concrete)
# A neutral finish under the partitions, with individual room finishes at the same level.
# Subdivide the plan into nonoverlapping regions, including service voids.
room('west_bedroom',rect(89.5,339.5,234,505.5),roomwood)
room('middle_bedroom',rect(234,339.5,337.5,505.5),roomwood)
room('east_bedroom',rect(337.5,339.5,460.5,505.5),roomwood)
room('shared_bathroom',rect(89.5,274,191.5,339.5),wetmat)
room('master_bedroom_and_dressing',[(543.5,124),(765,124),(765,291.5),
 (589.5,291.5),(589.5,193.5),(543.5,193.5)],roomwood)
room('master_bathroom',rect(495.5,193.5,589.5,259.5),wetmat)
room('dressing_storage',[(441.5,124),(543.5,124),(543.5,193.5),
 (495.5,193.5),(495.5,211.5),(441.5,211.5)],foyermat)
room('foyer',rect(373.5,198.5,441.5,291.5),foyermat)
room('foyer_storage',rect(373.5,159.5,441.5,198.5),foyermat)
room('corridor_storage_west',rect(246,250.5,323.5,291.5),foyermat)
room('corridor_storage_centre',rect(441.5,259.5,589.5,291.5),foyermat)
room('living_kitchen_corridor',[(191.5,291.5),(836.5,291.5),(836.5,494.5),
 (650.5,494.5),(650.5,471.5),(543.5,471.5),(543.5,549),(460.5,549),
 (460.5,364.5),(490.5,364.5),(490.5,339.5),(191.5,339.5)],hallwood)
room('east_balcony',rect(765,179.5,816.5,277.5),balconymat)
room('upper_service_room',rect(765,124,816.5,179.5),foyermat)
room('south_utility',[(543.5,471.5),(629.5,471.5),(629.5,517),
 (593.5,517),(593.5,549),(543.5,549)],balconymat)
room('south_balcony',rect(629.5,494.5,785.5,545.5),balconymat)
for i,poly in enumerate([rect(89.5,250.5,191.5,274),rect(191.5,250.5,246,291.5),
 rect(323.5,250.5,373.5,291.5),rect(407.5,124,441.5,159.5),
 rect(441.5,211.5,495.5,259.5),rect(765,277.5,836.5,291.5),
 rect(460.5,339.5,490.5,364.5),rect(629.5,471.5,650.5,494.5),
 rect(593.5,517,629.5,549)],1):
    room('service_void_'+str(i),poly,concrete)

# The thin south balcony perimeter is interpreted as a guard, not an extra opaque wall.
for i,(p0,p1) in enumerate([((629.5,545.5),(785.5,545.5)),
                            ((785.5,494.5),(785.5,545.5))],1):
    a,b=map(point,[p0,p1]); t=Vector(b)-Vector(a); length=t.length
    mb=MeshBuilder(); h=1.05
    mb.box((0,-.025,h-.045),(length,.025,h))
    count=max(1,math.ceil(length/1.2))
    for j in range(count+1):
        x=length*j/count
        mb.box((max(0,x-.02),-.025,0),(min(length,x+.02),.025,h))
    for j in range(count):
        x0=length*j/count+.025; x1=length*(j+1)/count-.025
        mb.box((x0,-.006,.10),(x1,.006,h-.06),1)
    ob=mb.make(f'railing_{i}',[framemat,glass],'Balcony railing',vec(a),math.atan2(-t.y,t.x))
    ob['description']='Assumed open balcony guard at the thin double line perimeter'

# Exported metadata is deliberately limited to the requested schema.
elements={'walls':walls,'openings':openings}
(OUT/'elements.json').write_text(json.dumps(elements,indent=2)+'\n')
(OUT/'trace.json').write_text(json.dumps({
    'source':'inputs/plan.jpg','x_calibration_pixels_to_meters':X_ANCHORS,
    'z_calibration_pixels_to_meters':Z_ANCHORS,
    'wall_descriptions':{w['id']:wall_lookup[w['id']]['label'] for w in walls},
    'opening_descriptions':rec_extra,'floor_regions_area_m2':room_areas,
    'gross_centerline_footprint_m2':round(slab['plan_area_m2'],3)},indent=2)+'\n')

# Consistency checks: all host walls, openings, hinge origins and uniform dimensions.
for op in openings:
    w=wall_lookup[op['host_wall']]['data']; a,t,L,rot=wall_basis(w)
    c=Vector(op['center']); d=c-a
    assert abs(d.x*t.y-d.y*t.x)<.00002
    assert 0<=op['sill'] and op['sill']+op['height']<=WALL_HEIGHT+.00001
    if op['type']=='swing_door':
        ob=bpy.data.objects[op['id']]
        assert abs(ob.location.z)<1e-7
        assert ob.data.vertices[0].co.x==0
    elif op['type']=='sliding_door':
        assert all(bpy.data.objects.get(f"{op['id']}_panel_{k}") for k in [1,2])
    else:assert bpy.data.objects.get(op['id'])

# Presentation cameras and area lights remain in the .blend; GLB contains geometry only.
world=scene.world
world.use_nodes=True
world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.78,.83,.9,1)
world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.65

def camera(name,location,target,ortho):
    data=bpy.data.cameras.new(name); ob=bpy.data.objects.new(name,data)
    collections['Presentation'].objects.link(ob); ob.location=location
    ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()
    data.type='ORTHO'; data.ortho_scale=ortho; data.lens=50
    return ob

cam=camera('Overview_camera',(29,-32,35),(10,-5.6,.1),27)
topcam=camera('Plan_camera',(10.25,-5.755,36),(10.25,-5.755,0),23)
for name,loc,energy,size in [('Key',(5,-7,20),2400,12),('Fill',(17,4,14),1800,10),('Rim',(-4,-6,10),1200,8)]:
    data=bpy.data.lights.new(name,'AREA'); data.energy=energy; data.shape='DISK'; data.size=size
    ob=bpy.data.objects.new(name,data); collections['Presentation'].objects.link(ob)
    ob.location=loc; ob.rotation_euler=(Vector((10,-5,0))-ob.location).to_track_quat('-Z','Y').to_euler()
scene.camera=cam
scene.render.engine='CYCLES'
scene.cycles.samples=32
scene.cycles.use_denoising=True
scene.render.resolution_x=1800; scene.render.resolution_y=1300; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=False
scene.view_settings.view_transform='AgX'
# Useful initial .blend viewport.
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_distance=26
            area.spaces.active.region_3d.view_location=(10,-5.7,.7)
            area.spaces.active.region_3d.view_rotation=cam.rotation_euler.to_quaternion()
            area.spaces.active.clip_end=300
bpy.ops.object.select_all(action='DESELECT')
for ob in scene.objects:
    if ob.type=='MESH':ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'model.glb'),export_format='GLB',
    use_selection=True,export_yup=True,export_apply=True,export_extras=True,
    export_cameras=False,export_lights=False,export_materials='EXPORT')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'model.blend'))
# Verify the actual GLB header, axes and wall mesh position transforms.
raw=(OUT/'model.glb').read_bytes()
magic,version,total=struct.unpack_from('<4sII',raw,0)
assert magic==b'glTF' and version==2 and total==len(raw)
chunk_length,chunk_type=struct.unpack_from('<I4s',raw,12)
gltf=json.loads(raw[20:20+chunk_length])
assert chunk_type==b'JSON'
node_names={n.get('name'):n for n in gltf['nodes']}
for w in walls:
    assert w['id'] in node_names
    trans=node_names[w['id']].get('translation',[0,0,0])
    assert math.dist(trans,[w['start'][0],0,w['start'][1]])<.00005,(w['id'],trans)
validation={
    'wall_count':len(walls),'swing_door_count':sum(o['type']=='swing_door' for o in openings),
    'sliding_door_opening_count':sum(o['type']=='sliding_door' for o in openings),
    'window_count':sum(o['type']=='window' for o in openings),
    'mesh_object_count':sum(o.type=='MESH' for o in scene.objects),
    'all_walls_thickness_m':THICKNESS,'all_walls_height_m':WALL_HEIGHT,
    'floor_elevation_m':0,'gltf_up_axis':'Y','export_apply':True,
    'centreline_bounds_x_m':[0,20.5],'centreline_bounds_z_m':[0,11.51],
    'gross_centerline_footprint_m2':round(slab['plan_area_m2'],3),
    'checks_passed':['all openings lie on their host wall','all openings fit wall length and height',
        'swing door origins are at hinges at floor level','sliding panels are separately named',
        'GLB header and JSON valid','GLB wall origins match the JSON x,z coordinates']}
(OUT/'validation.json').write_text(json.dumps(validation,indent=2)+'\n')
print('BUILD_AND_EXPORT_COMPLETE',json.dumps(validation),flush=True)
scene.render.filepath=str(OUT/'preview.png')
bpy.ops.render.render(write_still=True)
scene.camera=topcam
scene.render.resolution_x=2000; scene.render.resolution_y=1250
scene.render.filepath=str(OUT/'top_view.png')
bpy.ops.render.render(write_still=True)
scene.camera=cam
scene.render.resolution_x=1800; scene.render.resolution_y=1300
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'model.blend'))
print('RENDERS_COMPLETE',flush=True)
