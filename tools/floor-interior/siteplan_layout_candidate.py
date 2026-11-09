"""Image-guided, metric placement review. Does not change production assets.

The illustration gives relative regions, not surveyed positions. Search only
translations and rotations; no reflection, scaling, or alteration of the OSM
outline. Retain failures and distinguish an OSM fit from an as-built layout.
"""
import json, math, random, time, sys
from pathlib import Path
import numpy as np
import shapely
from shapely.geometry import shape, mapping, Point, LineString
from shapely.affinity import affine_transform, translate
from shapely.prepared import prep

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'runtime/floor-interior/2026-11-02-user-models/layout'
FACADE='--facade' in sys.argv
D=json.loads((OUT/('plan-review-exact.json' if FACADE else 'plan-review.json')).read_text())
MIN=D['domainBounds'][:2]
DOMAIN=shapely.set_precision(translate(shape(D['domain']),-MIN[0],-MIN[1]),1e-6)
PD=prep(DOMAIN.buffer(1e-7))
RELAXED='--compare-envelope' in sys.argv
def rotate(g,rad):
 c,s=math.cos(rad),math.sin(rad)
 return affine_transform(g,[c,s,-s,c,0,0])
def pt(p,rad,t):
 c,s=math.cos(rad),math.sin(rad)
 return [c*p[0]+s*p[1]+t[0],-s*p[0]+c*p[1]+t[1]]

# Coordinates are relative to the photographed illustration / aligned OSM.
# F3/F2 identification uses the illustration's 19F annotation and source CSV;
# their mutual order remains inferred, not independently verified.
REGIONS=[('1005','168c',(-1,7,0,13),(10,8)),
 ('1004','211a',(-1,10,10,24),(11,24)),
 ('1003','145f',(17,30,10,25),(28,24)),
 ('1002','145f',(29,45,12,26),(41,25)),
 ('1001','168d',(43,54,7,23),(55,22))]

def candidates(ident,typ,region,target,step=.5):
 source=D['units'][typ]; poly=shapely.set_precision(shape(source['footprint']),1e-6)
 found=[]; nearest=[]
 for degrees in [0,90,180,270]:
  rad=math.radians(degrees); rotated=rotate(poly,rad); x0,y0,x1,y1=rotated.bounds
  for x in np.arange(region[0],region[1]+.01,step):
   for y in np.arange(region[2],region[3]+.01,step):
    t=[float(x-x0),float(y-y0)]; g=shapely.set_precision(translate(rotated,*t),1e-6)
    outside=0.0 if PD.covers(g) else g.difference(DOMAIN).area
    if outside>1e-7 and not RELAXED:continue
    if outside>70:continue
    e=pt(source['entry'],rad,t)
    rays=[]
    if FACADE:
     en=pt(source['entryNormal'],rad,[0,0]); exitPoint=[e[k]+en[k]*1.5 for k in (0,1)]
     if not DOMAIN.covers(Point(exitPoint)):continue
     rays.append(LineString([[e[k]+en[k]*dist for k in (0,1)]for dist in(.35,1.5)]))
     w=source['primaryGlazing']; n=pt(w['normal'],rad,[0,0]); cc=pt(w['center'],rad,t); along=[-n[1],n[0]]
     for f in (-.35,0,.35):
      p=[cc[k]+along[k]*w['probeWidthM']*f for k in (0,1)]
      rays.append(LineString([[p[k]+n[k]*dist for k in (0,1)]for dist in (.3,8)]))
    # Rank by relative diagram location plus a mild outside-façade preference.
    cent=g.centroid
    score=outside+.02*((cent.x-target[0])**2+(cent.y-target[1])**2)
    found.append({'id':ident,'type':typ,'yawDegrees':degrees,'translation':t,
      'entry':e,'score':score,'outsideOSMm2':outside,'poly':g,'facadeRays':rays})
 return sorted(found,key=lambda c:c['score'])[:1800]

def serialize(c):
 return {**{k:v for k,v in c.items()if k not in ('poly','facadeRays')},'footprint':mapping(c['poly'])}

def main():
 start=time.time(); groups=[candidates(*r)for r in REGIONS]
 print('candidates',[(r[0],len(g))for r,g in zip(REGIONS,groups)],flush=True)
 # Rank all independent pairs with NumPy/Shapely then retain a diverse beam.
 beam=[([],0)]; history=[]
 for index,group in enumerate(groups):
  generated=[]
  for selected,cost in beam:
   polys=np.array([c['poly']for c in group],dtype=object)
   ok=np.ones(len(group),dtype=bool)
   for previous in selected:
    hits=shapely.intersects(polys,previous['poly'])
    ok[hits]&=shapely.area(shapely.intersection(polys[hits],previous['poly']))<1e-7
   for j in np.flatnonzero(ok):
    c=group[j]; extra=0
    if FACADE and any(any(r.intersects(p['poly'])for r in c['facadeRays']) or any(r.intersects(c['poly'])for r in p['facadeRays']) for p in selected):continue
    # Adjacent source entrances should approach shared space. This is ranking,
    # not an invented elevator position or a legal corridor width.
    if index==1:
     extra=.04*Point(c['entry']).distance(Point(selected[0]['entry']))**2
    generated.append((selected+[c],cost+c['score']+extra))
  generated.sort(key=lambda b:b[1]); beam=[]; keys=set()
  for b in generated:
   key=tuple((c['yawDegrees'],round(c['translation'][0]/1.5),round(c['translation'][1]/1.5))for c in b[0])
   if key in keys:continue
   keys.add(key);beam.append(b)
   if len(beam)>=160:break
  history.append({'units':index+1,'generated':len(generated),'beam':len(beam)})
  print(history[-1],flush=True)
  if not beam:break
 result={'status':('illustration_relative_candidate_with_OSM_mismatch' if RELAXED else 'metric_candidate_not_as_built') if beam and len(beam[0][0])==5 else 'no_five_unit_fit_in_this_search',
  'source':'plan-review-exact.json' if FACADE else 'plan-review.json','axisDegrees':D['axisDegrees'],'domainMin':MIN,
  'domain':mapping(DOMAIN),'regions':REGIONS,'scale':1,'reflections':False,
  'computationalGridM':1e-6,'geometryUnchangedInArtifacts':True,'gridStepM':.5,'OSMContainmentRequired':not RELAXED,'history':history,'elapsedSeconds':time.time()-start,
  'candidateCounts':{r[0]:len(g)for r,g in zip(REGIONS,groups)},
  'layouts':[{'cost':cost,'units':[serialize(c)for c in selected]}for selected,cost in beam[:12]],
  'limitations':['Illustration-relative regions only, not survey coordinates.',
   ('Actual GLB basic/expanded footprint unions; 1 micrometer computation grid only.' if FACADE else '145F/168D footprints are a 0.1m wall proxy before exact GLB readback.'),
   'OSM roof outline is not an independently verified typical-floor outline.',
   'Shared core, facade alignment and entrance paths require separate review.'],
  'primaryGlazingVisibilityM':8 if FACADE else None,'entryExitProbeM':1.5 if FACADE else None,'productionChanged':False}
 (OUT/('siteplan-facade-reviewed.json' if FACADE else 'siteplan-relative-envelope-review.json' if RELAXED else 'siteplan-placement-search.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({k:v for k,v in result.items()if k not in ('layouts','domain','regions')},indent=2))
if __name__=='__main__':main()
