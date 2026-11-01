"""Bounded OSM surroundings; no house models, private data or guessed unit positions."""
import json,math,re,hashlib,xml.etree.ElementTree as ET
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
RAW=ROOT/'runtime/site-surroundings/2026-10-25'
site=json.loads((ROOT/'assets/location/acro-river-park/site-context.json').read_text())
lon,lat=site['reference_wgs84'];mx=111320*math.cos(math.radians(lat));mz=110574
nodes={};ways={};relations={}
for name in ['osm-surroundings.osm','han-river-full.osm']:
 for e in ET.parse(RAW/name).getroot():
  if e.tag=='node':nodes[e.attrib['id']]=[(float(e.attrib['lon'])-lon)*mx,-(float(e.attrib['lat'])-lat)*mz]
  elif e.tag=='way':ways[e.attrib['id']]=e
  elif e.tag=='relation':relations[e.attrib['id']]=e
bounds=[-1050,-1180,1040,860]
def tags(e):return {t.attrib['k']:t.attrib['v'] for t in e.findall('tag')}
def refs(e):return [n.attrib['ref'] for n in e.findall('nd')]
def coords(ids):return [nodes[n] for n in ids if n in nodes]
def inside(p,poly):
 x,y=p;c=False
 for a,b in zip(poly,poly[1:]+poly[:1]):
  if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:c=not c
 return c
def area(poly):return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1])))/2

def clip(poly):
 if len(poly)>1 and poly[0]==poly[-1]:poly=poly[:-1]
 for axis,limit,greater in [(0,bounds[0],True),(0,bounds[2],False),(1,bounds[1],True),(1,bounds[3],False)]:
  out=[]
  if not poly:return []
  a=poly[-1];ain=(a[axis]>=limit if greater else a[axis]<=limit)
  for b in poly:
   bin=(b[axis]>=limit if greater else b[axis]<=limit)
   if ain!=bin:
    q=(limit-a[axis])/(b[axis]-a[axis]);out.append([a[0]+q*(b[0]-a[0]),a[1]+q*(b[1]-a[1])])
   if bin:out.append(b)
   a,ain=b,bin
  poly=out
 return [[round(x,2),round(z,2)] for x,z in poly] if len(poly)>=3 and area(poly)>1 else []
def rings(rel,role):
 chains=[refs(ways[m.attrib['ref']]) for m in rel.findall('member') if m.attrib.get('role','outer')==role and m.attrib.get('type')=='way' and m.attrib.get('ref') in ways]
 done=[]
 while chains:
  chain=chains.pop(0);progress=True
  while chain[0]!=chain[-1] and progress:
   progress=False
   for i,c in enumerate(chains):
    if chain[-1]==c[0]:chain+=c[1:]
    elif chain[-1]==c[-1]:chain+=c[-2::-1]
    elif chain[0]==c[-1]:chain=c[:-1]+chain
    elif chain[0]==c[0]:chain=c[:0:-1]+chain
    else:continue
    chains.pop(i);progress=True;break
  if chain[0]==chain[-1] and all(n in nodes for n in chain):done.append(coords(chain))
 return done

def number(v):
 try:return float(re.match(r'[0-9.]+',str(v))[0])
 except:return None
water=[];parks=[];buildings=[];roads=[]
# The complete Han River relation preserves island holes, including Seoraeseom.
for rid,rel in relations.items():
 t=tags(rel)
 if t.get('natural')!='water':continue
 holes=[p for ring in rings(rel,'inner') if (p:=clip(ring))]
 for ring in rings(rel,'outer'):
  poly=clip(ring)
  if poly:water.append({'id':'relation/'+rid,'name':t.get('name',''),'outer':poly,'holes':[h for h in holes if inside(h[0],poly)]})
for wid,w in ways.items():
 t=tags(w);ids=refs(w)
 if len(ids)<2 or any(n not in nodes for n in ids):continue
 points=coords(ids);closed=ids[0]==ids[-1]
 if closed:
  poly=clip(points)
  if not poly:continue
  if t.get('natural')=='water':water.append({'id':'way/'+wid,'name':t.get('name',''),'outer':poly,'holes':[]})
  if t.get('leisure') in ['park','garden','pitch'] or t.get('landuse') in ['grass','forest','meadow'] or t.get('natural') in ['wood','scrub']:
   parks.append({'id':'way/'+wid,'name':t.get('name',''),'kind':t.get('leisure',t.get('landuse',t.get('natural'))),'polygon':poly})
  if 'building' in t and t['building'] not in ['no','roof','construction']:
   center=[sum(p[i] for p in poly)/len(poly) for i in [0,1]]
   if inside(center,site['site_boundary_m']):continue
   height=number(t.get('height'));levels=number(t.get('building:levels'));basis='OSM height'
   if not height:height=(levels*3.1 if levels else 12);basis='OSM levels × assumed 3.1m' if levels else 'assumed 12m'
   buildings.append({'id':'way/'+wid,'polygon':poly,'height_m':round(min(180,max(3,height)),2),'height_basis':basis})
 try:
  if 'highway' in t and float(t.get('layer',0))<0:continue
 except ValueError:continue
 kind=t.get('highway')
 if kind not in ['trunk','trunk_link','primary','secondary','tertiary','residential','service','cycleway','footway','path','pedestrian','living_street']:continue
 if t.get('tunnel')=='yes' or t.get('indoor')=='yes':continue
 # Clip each line to the same rectangle; keep separate fragments, never close roads.
 segments=[]
 for a,b in zip(points,points[1:]):
  dx,dz=b[0]-a[0],b[1]-a[1];lo,hi=0.,1.;valid=True
  for p,q in [(-dx,a[0]-bounds[0]),(dx,bounds[2]-a[0]),(-dz,a[1]-bounds[1]),(dz,bounds[3]-a[1])]:
   if p==0:
    if q<0:valid=False;break
   elif p<0:lo=max(lo,q/p)
   else:hi=min(hi,q/p)
  if valid and lo<=hi:
   s=[[round(a[0]+dx*f,2),round(a[1]+dz*f,2)] for f in [lo,hi]]
   if math.dist(*s)>.1:segments.append(s)
 if segments:
  width=number(t.get('width'));lanes=number(t.get('lanes'));basis='OSM width'
  if not width:
   width=lanes*3.1 if lanes else {'trunk':14,'trunk_link':7,'primary':13,'secondary':11,'tertiary':8,'residential':6,'service':4}.get(kind,2.5);basis='OSM lanes × assumed 3.1m' if lanes else 'class-based visual assumption'
  roads.append({'id':'way/'+wid,'name':t.get('name',''),'kind':kind,'width_m':round(min(30,max(1,width)),2),'width_basis':basis,'bridge':t.get('bridge') not in [None,'no'],'segments':segments})
# Preserve deterministic source order; trees and textures are explicitly runtime decoration.
out={'schema':'cortex.surroundings.v1','site':'acro-river-park','reference_wgs84':site['reference_wgs84'],'coordinate_frame':site['coordinate_frame'],'bounds_m':bounds,'water':water,'green':parks,'buildings':buildings,'roads':roads,'provenance':{'copyright':'© OpenStreetMap contributors','license':'ODbL-1.0','license_url':'https://www.openstreetmap.org/copyright','sources':[json.loads((RAW/n).read_text()) for n in ['source-map-receipt.json','source-river-receipt.json']],'caution':'Community map geometry; missing height/road width is a declared visualization assumption. Tree positions, foliage, surface textures and water shading are decorative, not surveyed.'}}
assert any(r['id']=='relation/152336' for r in water)
path=ROOT/'assets/location/acro-river-park/surroundings-context.json';path.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n')
report={'counts':{k:len(out[k]) for k in ['water','green','buildings','roads']},'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'height_basis':{x:sum(b['height_basis']==x for b in buildings) for x in set(b['height_basis'] for b in buildings)},'water_names':[w['name'] for w in water],'passed':True}
(RAW/'derivation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
