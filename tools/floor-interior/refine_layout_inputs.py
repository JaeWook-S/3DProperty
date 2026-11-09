"""Consume exact GLB footprints without regenerating any model."""
import json,hashlib
from pathlib import Path
import shapely
from shapely.geometry import shape,mapping
from shapely.ops import unary_union
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'runtime/floor-interior/2026-11-02-user-models/layout'
d=json.loads((OUT/'plan-review.json').read_text())
old=json.loads((ROOT/'runtime/floor-interior/2026-11-02-inline/placement/source-geometry-footprints.json').read_text())
new=json.loads((OUT.parent/'s2/placement-geometry.json').read_text())
primary={'211a':([.1,9.964],[-1,0],3.0),'168c':([21.382,7.54],[1,0],3.4),
 '145f':([6.72,12.12],[0,1],3.93),'168d':([.1,7.056],[-1,0],3.9)}
for typ,unit in d['units'].items():
 if typ in ('145f','168d'):
  records=[m for m in new['models']if m['unit_type'].lower()==typ]
  for m in records:assert hashlib.sha256((ROOT/m['glb_path']).read_bytes()).hexdigest()==m['glb_sha256']
  footprints={m['variant']:m['footprint_geojson']['features'][0]['geometry']for m in records}
  exp=next(m for m in records if m['variant']=='expanded')
  meta=json.loads((ROOT/exp['metadata_path']).read_text())
  unit['entryNormal']=meta['entrance']['exterior_normal_xz']
  unit['source_glb_sha256']={m['variant']:m['glb_sha256']for m in records}
 else:
  footprints={m['variant']:m['actualVisibleFootprint']for m in old['units']if m['unit']==typ}
 union=unary_union([shapely.set_precision(shape(g),1e-6)for g in footprints.values()])
 unit['variantFootprints']=footprints
 unit['footprint']=mapping(union);unit['bounds']=list(union.bounds)
 unit['footprintBasis']='Union of actual visible basic and expanded GLB XZ footprints; no model changed.'
 unit['primaryGlazing']={'center':primary[typ][0],'normal':primary[typ][1],'probeWidthM':primary[typ][2],
  'role':'largest external living glazing; footprint-relative normal, not geographic direction'}
 unit.pop('wallProxyM',None)
d['computationGridM']=1e-6
(OUT/'plan-review-exact.json').write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
print('Exact GLB variant-union inputs ready; four new GLB hashes matched.')
