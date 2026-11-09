"""Review illustration, never a certified floorplan."""
import json, math, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'runtime/floor-interior/2026-11-02-user-models/layout'
facade='--facade' in sys.argv
d=json.loads((OUT/('plan-review-exact.json'if facade else 'plan-review.json')).read_text())
c=json.loads((OUT/('siteplan-facade-reviewed.json'if facade else 'siteplan-relative-envelope-review.json')).read_text())
layout=c['layouts'][0]
im=Image.new('RGB',(1640,1020),'#faf9f5'); draw=ImageDraw.Draw(im)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',22)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',15)
S=23; OR=(50,110)
def pos(p):return (OR[0]+p[0]*S,OR[1]+p[1]*S)
def transform(p,u):
 a=math.radians(u['yawDegrees']);x,z=p;t=u['translation']
 return [math.cos(a)*x+math.sin(a)*z+t[0],-math.sin(a)*x+math.cos(a)*z+t[1]]
def rings(g):return [g['coordinates']]if g['type']=='Polygon'else g['coordinates']
def plot(g,fill,stroke,width=1):
 for rr in rings(g):
  p=list(map(pos,rr[0]));draw.polygon(p,fill=fill);draw.line(p+[p[0]],fill=stroke,width=width)
  for r in rr[1:]:draw.polygon(list(map(pos,r)),fill='#faf9f5')
plot(c['domain'],'#ddddda','#797975',3)
colors=['#e1c4a0','#e3d9bb','#b9ceba','#bad4cd','#c6c4dc']
for i,u in enumerate(layout['units']):
 source=d['units'][u['type']]
 plot(u['footprint'],colors[i],'#3d4944',2)
 for r in source['rooms']:
  poly=[transform(p,u)for p in r['polygon']]
  plot({'type':'Polygon','coordinates':[poly]},'#f2eee2','#737d74')
 for o in source['openings']:
  a=math.radians(o['yaw']);x,z=o['center'];h=o['width']/2
  points=[transform([x+t*h*math.cos(a),z-t*h*math.sin(a)],u)for t in(-1,1)]
  draw.line(list(map(pos,points)),fill='#3686aa'if o['kind']=='window'else '#b8936d',width=3)
 x,y=pos(u['entry']);draw.ellipse((x-5,y-5,x+5,y+5),fill='#ba473b')
 draw.text((x+6,y-20),u['id']+' ENTRY',font=small,fill='#a12d28')
 # label under each footprint, without obscuring rooms
 pts=[p for rr in rings(u['footprint'])for p in rr[0]]
 x=min(p[0]for p in pts);y=max(p[1]for p in pts)
 draw.text(pos([x,y+.3]),u['id']+' '+u['type'].upper()+' / '+str(u['yawDegrees'])+' deg',font=small,fill='#24352f')
# Repeat OSM as a thin orange outline over the actual metric units.
for rr in rings(c['domain']):draw.line(list(map(pos,rr[0])),fill='#d77721',width=3)
draw.text((50,25),'100 / 10F  |  Illustration-relative placement candidate  |  scale 1',font=font,fill='#24352f')
draw.text((50,60),'Orange: existing OSM envelope. Red: unit entrances. No reflection / no inferred elevator.',font=small,fill='#555')
draw.text((50,925),'Relative positions inferred from the supplied site diagram; rotation and common core are NOT verified.',font=small,fill='#a12d28')
draw.text((50,955),'OSM overflow: %.2f m2 (review geometry). Internal overlap: 0 in sampled placement.'%sum(u['outsideOSMm2']for u in layout['units']),font=small,fill='#444')
im.save(OUT/('siteplan-facade-candidate.png'if facade else 'siteplan-relative-candidate.png'))
print(OUT/('siteplan-facade-candidate.png'if facade else 'siteplan-relative-candidate.png'))
