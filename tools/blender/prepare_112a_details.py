"""Prepare a versioned 112A structure from an explicitly selected MCP review snapshot."""
import argparse,json
from pathlib import Path
from prepare_acro112a_archisketch import normalize,LABELS,ROOT
from build_acro168c_archisketch import build
LABELS['expanded'].update({'fcbff9a5':('bedroom-2-balcony','침실 2 앞 발코니','balcony'),'c70554d6':('service-balcony','다용도 발코니','utility'),'8941873d':('primary-balcony','안방 발코니','balcony'),'362856b2':('primary-balcony-storage','안방 발코니 보조실','utility'),'6058660c':('rear-storage','후면 보조실','utility')})
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--sources',type=Path,required=True);a=p.parse_args()
 for variant,path in json.loads(a.sources.read_text()).items():
  origin=json.loads((ROOT/f'tools/blender/specs/acro112a-{variant}-archisketch-v1.json').read_text())['origin_mm']
  path=Path(path);path=path if path.is_absolute() else ROOT.parent/path;spec=normalize(variant,path/'project-summary.json',revision='archisketch-structure-v2',layout_path=path/'furniture-layout.json',origin_override=origin,repair_small_source_loops=True)
  if variant=='expanded':
   data=json.loads(spec.read_text());bands=[r for r in data['rooms'] if r.get('source_id','')[:8] in ['a9b16410','713b731f','16bf7114','bffa9a85','1f277f19','aead0ef0','a28b6b46','0aaa58ec','80c990a9']]
   data['structural_bands']=[dict(r,classification_basis='8–80mm strip between source rooms: wall band, not independent shaft; infer wall and cut source openings') for r in bands]
   data['wall_inference']['opening_cut_half_depth_m']=.35
   data['rooms']=[r for r in data['rooms'] if r not in bands];spec.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
  build(variant,True,'112A',spec,'archisketch-structure-v2')
