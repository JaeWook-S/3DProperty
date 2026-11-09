"""Deterministic, metre-based OSM derivative. No photographs are redistributed."""
import argparse, hashlib, json, math, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
a=argparse.ArgumentParser();a.add_argument('--input',type=Path,default=ROOT/'assets/location/inha-university/source.osm.json');a.add_argument('--output',type=Path,default=ROOT/'assets/location/inha-university/campus-context.json');args=a.parse_args()
raw=args.input.read_bytes();data=json.loads(raw);elements=data['elements'];origin=[126.6537133,37.4501371]
def xy(p):return [round((p['lon']-origin[0])*111320*math.cos(math.radians(origin[1])),3),round((origin[1]-p['lat'])*111320,3)]
def area(p):return sum(p[i][0]*p[(i+1)%len(p)][1]-p[(i+1)%len(p)][0]*p[i][1] for i in range(len(p)))/2

def inside(q,p):
 x,y=q;yes=False
 for (a,b),(c,d) in zip(p,p[1:]+p[:1]):
  if (b>y)!=(d>y) and x<(c-a)*(y-b)/(d-b)+a:yes=not yes
 return yes

def ring(g):
 p=[xy(x) for x in g if 'lat'in x and 'lon'in x]
 if len(p)>1 and p[0]==p[-1]:p.pop()
 return p

def polygons(e):
 if e['type']=='way':
  g=e.get('geometry',[])
  if len(g)>3 and g[0]==g[-1]:return [{'outer':ring(g),'holes':[]}]
  return []
 out=[];holes=[]
 for m in e.get('members',[]):
  p=ring(m.get('geometry',[]))
  if len(p)<3:continue
  if m.get('role')=='inner':holes.append(p)
  elif m.get('role')=='outer':out.append({'outer':p,'holes':[]})
 for h in holes:
  for p in out:
   if inside(h[0],p['outer']):p['holes'].append(h);break
 return out

def centre(p):return [round(sum(x[i] for x in p)/len(p),3) for i in (0,1)]
def number(x):
 m=re.match(r'^\s*([0-9]+(?:\.[0-9]+)?)',str(x or ''))
 return float(m[1]) if m else None
boundary=polygons(next(e for e in elements if e['id']==472447787))[0]['outer']
landmarks={217958071:('main','본관',20,5),217958067:('library','정석학술정보관',40,7),218189298:('anniversary','60주년기념관',50.4,14),218081857:('hightech','하이테크센터',54,15),3149246:('building5','5호관',18,5),218264623:('lake','인경호',0,0)}
member_ids={m['ref'] for e in elements if e['type']=='relation' and 'building'in e.get('tags',{}) for m in e.get('members',[])}
buildings=[];surfaces=[];roads=[]
for e in elements:
 t=e.get('tags',{});p=polygons(e);id=f"{e['type']}/{e['id']}"
 if ('building'in t or 'building:part'in t) and p and e['id'] not in member_ids:
  c=centre(p[0]['outer']);campus=inside(c,boundary);height=number(t.get('height'));levels=number(t.get('building:levels'));mark=landmarks.get(e['id']);basis='osm_height' if height else 'osm_levels_assumed_storey' if levels else 'visual_assumption'
  if not height:height=levels*(3.6 if campus else 3.1) if levels else mark[2] if mark else 14.4 if campus else 10.5
  visual_levels=int(levels or (mark[3] if mark else max(1,round(height/(3.6 if campus else 3.1)))))
  buildings.append({'id':id,'name':t.get('name:ko') or t.get('name',''),'campus':campus,'landmark':mark[0] if mark else None,'polygons':p,'center':c,'height_m':round(height,2),'height_basis':basis,'levels':int(levels) if levels else None,'facade_rows_assumed':visual_levels,'source_tags':{k:t[k] for k in ['building','height','building:levels','name','surface'] if k in t}})
 if p and (t.get('natural') in ['water','wood'] or t.get('leisure') in ['park','garden','pitch','playground'] or t.get('landuse') in ['forest','grass','meadow']):
  surfaces.append({'id':id,'kind':'water' if t.get('natural')=='water' else 'pitch' if t.get('leisure')=='pitch' else 'green','name':t.get('name',''),'sport':t.get('sport'),'wood':t.get('natural')=='wood' or t.get('landuse')=='forest','polygons':p})
 if 'highway'in t and len(e.get('geometry',[]))>1:
  kind=t['highway'];width=number(t.get('width'));basis='osm_width' if width else 'visual_assumption'
  if not width:width={'primary':18,'secondary':14,'tertiary':11,'residential':6,'service':4.8,'pedestrian':6,'footway':2.8,'path':2.2,'steps':2.6,'cycleway':2.5}.get(kind,5)
  roads.append({'id':id,'kind':kind,'name':t.get('name',''),'points':[xy(p) for p in e['geometry']],'width_m':width,'width_basis':basis})
result={'schema':'cortex.campus-context.v1','id':'inha-university','name':'인하대학교 본캠퍼스','origin_lon_lat':origin,'coordinates':'metres; X east, Z south, Y up; local equirectangular projection','boundary':boundary,'buildings':buildings,'surfaces':surfaces,'roads':roads,'sources':{'osm':'https://www.openstreetmap.org/way/472447787','license':'https://www.openstreetmap.org/copyright','raw_sha256':hashlib.sha256(raw).hexdigest(),'osm_timestamp':data.get('osm3s',{}).get('timestamp_osm_base'),'official_map':'https://www.inha.ac.kr/kr/963/subview.do','official_buildings':'https://www.inha.ac.kr/kr/964/subview.do','official_address':'https://www.inha.ac.kr/kr/970/subview.do'},'assumptions':['OSM is community mapping, not a measured building survey.','Missing heights and all facade/window/roof details are visualization assumptions; do not use for surveying.','Tower/podium subdivisions of High-Tech and Anniversary Hall are photo-informed approximations inside the original footprint.','Trees are decorative placements; terrain is flat. Campus interiors are unavailable.','Official photos/maps are reference-only and not embedded.'],'stats':{'buildings':len(buildings),'campus_buildings':sum(b['campus'] for b in buildings),'roads':len(roads),'surfaces':len(surfaces)}}
args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n');print(json.dumps(result['stats']));print(args.output.stat().st_size)
