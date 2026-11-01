"""Prepare a two-unit illustrative floor without changing source unit dimensions."""
import hashlib
import json
import math
from pathlib import Path

from shapely import affinity
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]


def source_path(unit, variant):
    rev = 'archisketch-structure-v1' if unit == '211a' else ('archisketch-details-v2' if variant == 'basic' else 'archisketch-metric-v1')
    return ROOT / f'assets/models/acro-river-park/{unit}/{rev}/{variant}/model-info.json'


def transform(point, placement):
    x, z = point
    c, s = math.cos(placement['rotationYRadians']), math.sin(placement['rotationYRadians'])
    tx, _, tz = placement['translation']
    return [tx+c*x+s*z, tz-s*x+c*z]


def make_variant(variant):
    units, sources, regions = [], {}, []
    for unit, angle, target, line in [('211a', math.pi, [0, -4], '4호 라인 타입'), ('168c', 0, [0, 4], '5호 라인 타입')]:
        path = source_path(unit, variant)
        source = json.loads(path.read_text())
        entry = next(o for o in source['openings'] if o['id'] == 'door-00')
        x, z = entry['center_m']
        c, s = math.cos(angle), math.sin(angle)
        placement = {'id':unit, 'label':unit.upper(), 'lineLabel':line,
                     'translation':[target[0]-c*x-s*z, 0, target[1]+s*x-c*z],
                     'rotationYRadians':angle, 'scale':1, 'entryLocal':[x,z], 'targetEntryWorld':target,
                     'spawnLocal':[x+(-.7 if unit=='211a' else .7),z],
                     'sourceMetadata':str(path.relative_to(ROOT)), 'sourceGlbSha256':source['glb_sha256']}
        units.append(placement)
        sources[unit] = source
        shape=unary_union([Polygon(r['polygon_m']) for r in source['rooms']]).buffer(.20,join_style=2)
        shape=affinity.rotate(shape,-angle*180/math.pi,origin=(0,0))
        shape=affinity.translate(shape,placement['translation'][0],placement['translation'][2])
        regions.append(shape)
        assert max(abs(a-b) for a,b in zip(transform(entry['center_m'],placement),target))<1e-9
    walls=[]
    def wall(name,x,z,w,d,h=2.5,bottom=0,component='wall'):
        if w>1e-9 and d>1e-9 and h>1e-9:
            walls.append({'id':name,'center':[x,z],'size':[w,d],'height':h,'bottom':bottom,'component':component})
    for a,b in [(-4.6,-.6),(.6,4.6)]:
        wall('Corridor west '+str(a),-1.76,(a+b)/2,.12,b-a)
    doors=[(-4,sources['211a']['openings'][next(i for i,o in enumerate(sources['211a']['openings']) if o['id']=='door-00')]),(4,sources['168c']['openings'][next(i for i,o in enumerate(sources['168c']['openings']) if o['id']=='door-00')])]
    cursor=-4.6
    for center,opening in doors:
        lo,hi=center-opening['width_m']/2,center+opening['width_m']/2
        wall('Corridor east '+str(center),.06,(cursor+lo)/2,.12,lo-cursor)
        wall('Entrance lintel '+str(center),.06,center,.12,opening['width_m'],2.5-opening['height_m'],opening['height_m'])
        cursor=hi
    wall('Corridor east end',.06,(cursor+4.6)/2,.12,4.6-cursor)
    for sign in [-1,1]:
        wall('Corridor end '+str(sign),-.85,sign*4.66,1.94,.12)
        wall('Elevator connector '+str(sign),-2,sign*.66,.6,.12)
        wall('Elevator side '+str(sign),-3.35,sign*.86,2.34,.12,2.3)
        wall('Elevator jamb '+str(sign),-2.30,sign*.625,.12,.35)
    wall('Elevator back',-4.46,0,.12,1.84,2.3)
    wall('Elevator head',-2.30,0,.12,.9,.4,2.1)
    wall('Corridor ceiling',-.85,0,1.7,9.2,.1,2.5,'ceiling')
    wall('Connector ceiling',-2,0,.6,1.2,.1,2.5,'ceiling')
    wall('Elevator ceiling',-3.35,0,2.1,1.6,.1,2.3,'ceiling')
    slabs=[{'center':[-.85,0],'size':[1.7,9.2]}, {'center':[-2,0],'size':[.6,1.2]}, {'center':[-3.35,0],'size':[2.1,1.6]}]
    for center,opening in doors:
        slabs.append({'center':[.05,center],'size':[.3,opening['width_m']]})
    common={'slabs':slabs,'walls':walls,
            'elevator':{'center':[-3.35,0],'size':[2.1,1.6],'height':2.3,'doorCenter':[-2.3,0],'doorWidth':.9,'doorHeight':2.1,'doorNormal':[1,0]},
            'dimensionsBasis':'editable visual assumptions; no source building core plan',
            'hallClearWidth_m':1.7,'hallLength_m':9.2,'connectorClearWidth_m':1.2}
    hall_interior=box(-1.7,-4.6,-.22,4.6)
    check={'variant':variant,'unitsOverlap_m2':regions[0].intersection(regions[1]).area,
           'hallSourceFootprintOverlap_m2':[p.intersection(hall_interior).area for p in regions],
           'scale':[p['scale'] for p in units],'entranceWorld':[transform(p['entryLocal'],p) for p in units],
           'sources':{unit:{'metadata':str(source_path(unit,variant).relative_to(ROOT)), 'glbSha256':s['glb_sha256']} for unit,s in sources.items()}}
    check['passed']=check['unitsOverlap_m2']<1e-8 and max(check['hallSourceFootprintOverlap_m2'])<1e-8
    assert check['passed'],check
    return {'units':units,'commonArea':common,'spawns':{'hall':[-.85,0],'elevator':[-3.35,0]}},check


def main():
    fixture={'schemaVersion':1,'title':'168C · 211A 공용층 시범',
             'note':'두 세대 내부는 아키스케치 좌표 기반입니다. 세대 방향·배치와 복도·엘리베이터는 가정이며, 100동 실제 전체 층이나 현관 맞은편 관계를 재현한 것이 아닙니다.',
             'actualBuildingFloor':None,'actualOppositeEntranceVerified':False,'units':'m','variants':{}}
    checks=[]
    for variant in ['basic','expanded']:
        fixture['variants'][variant],check=make_variant(variant);checks.append(check)
    target=ROOT/'src/paired-floor/layout.json';target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(fixture,ensure_ascii=False,indent=2)+'\n')
    out=ROOT/'runtime/paired-floor/2026-10-26';out.mkdir(parents=True,exist_ok=True)
    (out/'placement-verification.json').write_text(json.dumps({'passed':all(c['passed'] for c in checks),'fixtureSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'checks':checks,'scope':'source room envelopes + 0.2m bands and hall interior; runtime collision tested separately'},ensure_ascii=False,indent=2)+'\n')
    print(target)


if __name__=='__main__':main()
