"""CPU diagram from metric JSON; not a rendering or an edited source image."""
import json, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'runtime/floor-interior/2026-11-02-user-models/layout'
d=json.loads((OUT/'plan-review.json').read_text())
im=Image.new('RGB',(1640,1080),'#f9f8f3');draw=ImageDraw.Draw(im)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',12)
def polygons(g):
    return [g['coordinates']]if g['type']=='Polygon'else g['coordinates']
def plot(g,origin,scale,fill,stroke='#405148'):
    for rings in polygons(g):
        pts=[(origin[0]+p[0]*scale,origin[1]+p[1]*scale)for p in rings[0]]
        draw.polygon(pts,fill=fill);draw.line(pts+[pts[0]],fill=stroke,width=2)
        for ring in rings[1:]:draw.polygon([(origin[0]+p[0]*scale,origin[1]+p[1]*scale)for p in ring],fill='#f9f8f3')
b=d['domainBounds']; origin=(40-b[0]*15,60-b[1]*15)
plot(d['domain'],origin,15,'#e4e6de');draw.text((40,15),'100 building OSM outline, axis aligned | 1 m = 15 px',font=font,fill='#222')
for i,g in enumerate(d['parts']):
    for rings in polygons(g):
        pts=[(origin[0]+p[0]*15,origin[1]+p[1]*15)for p in rings[0]]
        draw.line(pts+[pts[0]],fill=['#908d8e','#bd9a66','#88a9b9'][i],width=2)
for k in range(0,61,5):
    x=40+k*15;draw.line((x,60,x,555),fill='#c9cdc5');draw.text((x,560),str(k)+'m',font=small,fill='#444')
for j,(key,v)in enumerate(d['units'].items()):
    ox=40+j*400;oy=710;s=17
    draw.text((ox,630),key.upper()+' source, 1 m = 17 px',font=font,fill='#222')
    plot(v['footprint'],(ox,oy),s,'#c9c8c3')
    for r in v['rooms']:
        col='#e4cba0'if r['kind']in('bedroom','침실')else '#d3e3e5'if r['kind']in('wet','욕실')else '#e7e1d0'
        plot({'type':'Polygon','coordinates':[r['polygon']]},(ox,oy),s,col)
    for o in v['openings']:
        x,z=o['center'];a=math.radians(o['yaw']);h=o['width']/2
        p=[(ox+(x+t*h*math.cos(a))*s,oy+(z-t*h*math.sin(a))*s)for t in (-1,1)]
        draw.line(p,fill='#2f85b9'if o['kind']in('window','sliding')else '#9d6c46',width=3)
    x,z=v['entry'];x=ox+x*s;z=oy+z*s
    draw.ellipse((x-5,z-5,x+5,z+5),fill='#bd4236');draw.text((x+6,z-15),'ENTRY',font=small,fill='#bd4236')
    draw.text((ox,665),'bounds %.2f x %.2f m'% (v['bounds'][2]-v['bounds'][0],v['bounds'][3]-v['bounds'][1]),font=small,fill='#444')
im.save(OUT/'source-scale-review.png')
print(OUT/'source-scale-review.png')
