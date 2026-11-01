#!/usr/bin/env python3
"""Independent planar path planning; paths must subsequently pass actual GLB collision.
Plans using source rooms + openings and measured generated fixture envelopes.
"""
import json,math,heapq
from pathlib import Path
from shapely.geometry import Polygon,Point,LineString,box
from shapely.ops import unary_union,nearest_points
from shapely.affinity import rotate,translate
ROOT=Path(__file__).resolve().parents[2];REV='archisketch-details-v2'

def run(v):
 info=json.loads((ROOT/f'assets/models/acro-river-park/168c/{REV}/{v}/model-info.json').read_text());rooms=info['rooms'];polys={r['id']:Polygon(r['polygon_m']) for r in rooms};apertures=[];leaves=[]
 for o in info['openings']:
  if o['kind'] not in ['door','sliding']:continue
  x,z=o['center_m'];w=o['width_m'];ax=o['axis']=='x'
  a=next((r for r in rooms if polys[r['id']].covers(Point(x if ax else x-.32,z-.32 if ax else z))),None)
  b=next((r for r in rooms if polys[r['id']].covers(Point(x if ax else x+.32,z+.32 if ax else z))),None)
  if not a or not b:continue
  # Clear inner aperture, with frame width and 2 cm operating margin retained.
  clear=.8 if o['kind']=='door' else w-.1
  apertures.append(box(x-clear/2,z-.25,x+clear/2,z+.25) if ax else box(x-.25,z-clear/2,x+.25,z+clear/2))
  if o['kind']=='door':
   direction=-1 if o.get('hinge_end')=='positive' else 1;side=1 if b['id']!='living-kitchen-hall' else -1 if a['id']!='living-kitchen-hall' else 1;swing=o.get('swing_sign',-side if ax else side)
   hinge=(x-direction*.4 if ax else x,z if ax else z-direction*.4)
   poly=box(x-.4,z-.035,x+.4,z+.035) if ax else box(x-.035,z-.4,x+.035,z+.4)
   leaves.append(rotate(poly,-swing*90,origin=hinge))
  elif o.get('sliding_operation'):
   off=o['sliding_operation']['closed_panel_plane_offset_m'];span=clear/2;travel=span+.025
   for sign in [-1,1]:
    p=box(x+sign*clear/4-span/2,z+off-.035,x+sign*clear/4+span/2,z+off+.035) if ax else box(x+off-.035,z+sign*clear/4-span/2,x+off+.035,z+sign*clear/4+span/2)
    leaves.append(translate(p,xoff=sign*travel if ax else 0,yoff=0 if ax else sign*travel))
  else:
   # Both leaves overlap in the positive half at full opening.
   leaves.append(box(x-.025,z-.04,x+clear/2,z+.04) if ax else box(x-.04,z-.025,x+.04,z+clear/2))
 floor=unary_union(list(polys.values())+apertures)
 fixtures=[box(*p) for f in info['fixtures'] for p in f['collision_footprints_m']]
 free=floor.difference(unary_union(fixtures+leaves)).buffer(-.27,join_style=2)
 origin=next(r['walk_start_m'] for r in rooms if r['id']=='living-kitchen-hall');start=Point(origin)
 components=list(free.geoms) if free.geom_type=='MultiPolygon' else [free];region=next((p for p in components if p.covers(start)),None);assert region is not None
 step=.08;xs=math.ceil(info['bounds_m'][2]/step);zs=math.ceil(info['bounds_m'][3]/step);cache={}
 def coord(k):return (k[0]*step,k[1]*step)
 def valid(k):
  if k not in cache:cache[k]=0<=k[0]<=xs and 0<=k[1]<=zs and region.covers(Point(coord(k)))
  return cache[k]
 def nearest(p):
  k=(round(p[0]/step),round(p[1]/step));options=[(k[0]+i,k[1]+j) for i in range(-6,7) for j in range(-6,7)];options=[q for q in options if valid(q) and region.covers(LineString([p,coord(q)]))];assert options,('no nearest',p)
  return min(options,key=lambda q:math.dist(p,coord(q)))
 def astar(p,q):
  start=nearest(p);target=nearest(q);cost={start:0};prev={};heap=[(0,start)];closed=set()
  while heap:
   _,k=heapq.heappop(heap)
   if k in closed:continue
   closed.add(k)
   if k==target:break
   for dx,dz in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,1),(1,-1),(-1,-1)]:
    n=(k[0]+dx,k[1]+dz)
    if not valid(n) or not region.covers(LineString([coord(k),coord(n)])):continue
    g=cost[k]+math.hypot(dx,dz)
    if g<cost.get(n,float('inf')):cost[n]=g;prev[n]=k;heapq.heappush(heap,(g+math.dist(n,target),n))
  assert target in cost,('disconnected',q)
  path=[target]
  while path[-1]!=start:path.append(prev[path[-1]])
  points=[p]+[coord(k) for k in reversed(path)]+[q]
  simple=[points[0]];i=0
  while i<len(points)-1:
   j=len(points)-1
   while j>i+1 and not region.covers(LineString([points[i],points[j]])):j-=1
   simple.append(points[j]);i=j
  return [[round(x,5),round(z,5)] for x,z in simple]
 results=[];failures=[]
 for r in rooms:
  if r['id']=='living-kitchen-hall':continue
  # Target an accessible part of this room, away from cabinets and opened leaves.
  area=region.intersection(polys[r['id']].buffer(-.27))
  if area.is_empty:failures.append(r['id']);continue
  p=Point(r['walk_start_m']);p=p if area.covers(p) else area.representative_point();q=[p.x,p.y]
  results.append(dict(room_id=r['id'],target=q,path=astar(origin,q)))
 # Explicit living -> kitchen -> utility path tests all cabinet aisle approaches.
 if v=='basic':waypoints=[[12.0,6.0],[11.75,7.0],[11.75,9.6],[11.828,11.15]]
 else:waypoints=[[12.0,6.0],[12.0,7.5],[12.0,10.676],[13.6,10.676],[13.65,11.10]]
 p=origin;combined=[p]
 for q in waypoints:combined.extend(astar(p,q)[1:]);p=q
 results.append(dict(room_id='kitchen-full-route',target=p,path=combined))
 out=dict(variant=v,revision=REV,body_width_m=.50,planning_radius_m=.27,origin=origin,routes=results,unreachable_rooms=failures,actual_collision_test_required=True)
 dest=ROOT/'runtime/interior/2026-10-21-168c-details';dest.mkdir(exist_ok=True,parents=True);(dest/f'{v}-routes.json').write_text(json.dumps(out,indent=2)+'\n');print(v,'routes',len(results),'unreachable',failures)
if __name__=='__main__':
 for v in ['basic','expanded']:run(v)
