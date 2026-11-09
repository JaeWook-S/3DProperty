"""Read archived metric plans for a scale-preserving floor-layout review.

Writes review figures/data only. No fitting, reflection or production edits.
"""
import json, math
from pathlib import Path
from shapely.geometry import Polygon, shape, mapping
from shapely.ops import unary_union
from shapely.validation import make_valid, explain_validity
from shapely.affinity import affine_transform

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT.parent / 'AisideProject/datasets/acro-river-park'
OUT = ROOT / 'runtime/floor-interior/2026-11-02-user-models/layout'
AXIS = math.radians(28.81448195434737)

def tf(p, yaw=0, t=(0,0)):
    c,s=math.cos(yaw),math.sin(yaw)
    return [c*p[0]+s*p[1]+t[0],-s*p[0]+c*p[1]+t[1]]

def tr(g,yaw=0,t=(0,0)):
    c,s=math.cos(yaw),math.sin(yaw)
    return affine_transform(g,[c,s,-s,c,t[0],t[1]])

def load_plans():
    plans={}
    old=json.loads((ROOT/'runtime/floor-interior/2026-11-02-inline/placement/source-geometry-footprints.json').read_text())
    for typ in ('211a','168c'):
        path=ROOT/('assets/models/acro-river-park/211a/archisketch-structure-v1/expanded/model-info.json' if typ=='211a' else 'assets/models/acro-river-park/168c/archisketch-metric-v1/expanded/model-info.json')
        d=json.loads(path.read_text())
        rooms=[{'id':r['id'],'kind':r['kind'],'polygon':r['polygon_m']}for r in d['rooms']]
        poly=shape(next(x['actualVisibleFootprint']for x in old['units']if x['unit']==typ and x['variant']=='expanded'))
        openings=[{'id':o['id'],'kind':o['kind'],'center':o['center_m'],'width':o['width_m'],'yaw':o.get('source_rotation_degrees',0)}for o in d['openings']]
        entry=next(x['entry']for x in old['units']if x['unit']==typ and x['variant']=='expanded')
        plans[typ]={'rooms':rooms,'poly':poly,'entry':entry['center'],'entryNormal':entry['normalExterior'],'openings':openings,'basis':str(path.relative_to(ROOT)),'origin_mm':d.get('origin_mm'),'invalid':[]}
    for typ in ('145f','168d'):
        p=DATA/f'raw/archisketch/{typ.upper()}/expanded/2026-11-02-user-saved'
        d=json.loads((p/'project-summary.json').read_text())['data']; f=d['floorplans'][0]
        layout=json.loads((p/'furniture-layout.json').read_text())['data']
        items={x['archiId']:x for x in layout['floorplans'][0]['items']}
        points=[p for r in f['rooms']for p in r['polygon']]
        origin=[min(x[i]for x in points)-200 for i in (0,1)]
        convert=lambda p:[(p[i]-origin[i])/1000 for i in (0,1)]
        rooms=[{'id':r['archiId'],'kind':r['type'],'polygon':[convert(p)for p in r['polygon']]}for r in f['rooms']]
        invalid=[{'id':r['id'],'reason':explain_validity(Polygon(r['polygon']))}for r in rooms if not Polygon(r['polygon']).is_valid]
        poly=unary_union([make_valid(Polygon(r['polygon']))for r in rooms]).buffer(.1,join_style=2)
        openings=[]
        for o in f['openings']:
            name=d['products'][o['productId']]['name']; item=items[o['archiId']]
            kind='entrance'if 'Entrance'in name else 'window'if 'Window'in name else 'door'
            openings.append({'id':o['archiId'],'kind':kind,'center':convert([o['position'][0],o['position'][2]]),'width':item['dimensions']['width']/1000,'yaw':o['rotation'][1]})
        en=next(o for o in openings if o['kind']=='entrance')
        # The previously reviewed v2 normals are transferred by source role,
        # not from a presumed building orientation.
        prior=json.loads((DATA/f'derived/floor-puzzle/2026-11-02/opening-contract-v2/{typ.upper()}-expanded.json').read_text())
        plans[typ]={'rooms':rooms,'poly':poly,'entry':en['center'],'entryNormal':None,'openings':openings,'basis':str(p),'origin_mm':origin,'invalid':invalid,'wallProxyM':.1}
    return plans

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    plans=load_plans()
    site=json.loads((ROOT/'assets/location/acro-river-park/site-context.json').read_text())
    building=next(b for b in site['buildings']if b['id']=='100')
    parts=[tr(Polygon(p['footprint_m']),-AXIS) for p in building['parts']]
    domain=unary_union(parts)
    result={'units':{k:{**{a:b for a,b in v.items()if a!='poly'},'footprint':mapping(v['poly']),'bounds':list(v['poly'].bounds)}for k,v in plans.items()},'domain':mapping(domain),'domainBounds':list(domain.bounds),'parts':[mapping(p)for p in parts],'axisDegrees':math.degrees(AXIS),'basis':'illustration-relative candidate review, not certified as-built','productionChanged':False}
    (OUT/'plan-review.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'domain':list(domain.bounds),'units':{k:list(v['poly'].bounds)for k,v in plans.items()}},indent=2))

if __name__=='__main__':main()
