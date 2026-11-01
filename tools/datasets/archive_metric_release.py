#!/usr/bin/env python3
"""Archive validated metric models without modifying previous releases or sources.

Run only after reading the S3 browser result and confirming active served hashes.
All staging and temporary files stay in the workspace.
Interrupted publication: --recover complete (finish) or --recover rollback.
Recovery preserves the release bytes and refuses unrelated dataset changes.
An interruption before transaction preparation leaves only an unactivated staging
directory; preserve/move that directory aside before a newly reviewed attempt.
"""
import argparse,copy,fcntl,hashlib,importlib.util,json,os,shutil,tempfile,urllib.request
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];WORK=ROOT.parent
DATA=WORK/'AisideProject/datasets/acro-river-park'
HAND=WORK/'AisideProject/realestate-spatial-ai/docs/session-handoffs/service-readiness-20261023'
AUDIT=WORK/'AisideProject/realestate-spatial-ai/experiments/service-readiness/2026-10-23'
RID='2026-10-23-metric-v1'
CASES=[('112A','basic'),('112A','expanded'),('168C','expanded')]

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def require(condition,message):
 if not condition:raise RuntimeError(message)
def json_bytes(value):return (json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode()
def sync_dir(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def atomic_write(path,data):
 require(path.resolve().is_relative_to(WORK.resolve()),'Write escapes workspace: '+str(path))
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,name=tempfile.mkstemp(prefix='.'+path.name+'.'+RID+'.',dir=path.parent)
 try:
  if path.exists():os.fchmod(fd,path.stat().st_mode&0o777)
  with os.fdopen(fd,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
  os.replace(name,path);sync_dir(path.parent)
 finally:
  if os.path.exists(name):os.unlink(name)
def dump(p,value):atomic_write(p,json_bytes(value))
def verifier():
 spec=importlib.util.spec_from_file_location('dataset_verify',WORK/'AisideProject/datasets/tools/verify_dataset.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def archive_matches(folder,records):
 require(folder.is_dir() and not folder.is_symlink(),'Missing or symlinked archive: '+str(folder))
 expected={str(Path(r['path']).relative_to(Path('releases')/RID)):r for r in records}
 files={str(p.relative_to(folder)):p for p in folder.rglob('*') if p.is_file()}
 require(set(files)==set(expected),'Archive file inventory changed: '+str(folder))
 for name,path in files.items():
  require(not path.is_symlink() and path.resolve().is_relative_to(folder.resolve()),'Archive symlink/escape: '+str(path))
  require(path.stat().st_size==expected[name]['bytes'] and sha(path)==expected[name]['sha256'],'Archive bytes changed: '+name)
def transact(transaction,action):
 # Before/after bytes make each metadata replacement independently recoverable.
 # The lock serializes cooperating writers; CAS-style checks reject observed
 # changes by other writers. Other dataset writers must honor the same lock.
 require(transaction.is_dir() and not transaction.is_symlink() and transaction.resolve().is_relative_to((DATA/'.staging').resolve()),'Invalid recovery journal location')
 plan=json.loads((transaction/'plan.json').read_text());require(plan['release_id']==RID,'Wrong recovery release')
 require(set(plan['payload_sha256'])=={'dataset.before.json','dataset.after.json','assets.before.jsonl','assets.after.jsonl'},'Unexpected recovery payload names')
 blobs={name:(transaction/name).read_bytes() for name in plan['payload_sha256']}
 require(all(hashlib.sha256(blobs[k]).hexdigest()==v for k,v in plan['payload_sha256'].items()),'Recovery payload changed')
 meta=DATA/'dataset.json';index=DATA/'manifests/assets.jsonl';stage=DATA/'.staging'/RID;final=DATA/'releases'/RID
 def current_state():
  require(meta.read_bytes() in [blobs['dataset.before.json'],blobs['dataset.after.json']],'Dataset changed outside this transaction; preserve journal and reconcile manually')
  require(index.read_bytes() in [blobs['assets.before.jsonl'],blobs['assets.after.jsonl']],'Inventory changed outside this transaction; preserve journal and reconcile manually')
 current_state();require(stage.exists()!=final.exists(),'Expected exactly one staged or published release; preserve both paths for review')
 archive_matches(final if final.exists() else stage,plan['records'])
 dump(transaction/'status.json',{'state':'publishing' if action=='complete' else 'rolling_back','release_id':RID})
 if action=='rollback':
  current_state();atomic_write(meta,blobs['dataset.before.json'])
  current_state();atomic_write(index,blobs['assets.before.jsonl'])
  if final.exists():
   require(not stage.exists(),'Staging path unexpectedly exists');os.rename(final,stage);sync_dir(final.parent);sync_dir(stage.parent)
  dump(transaction/'status.json',{'state':'rolled_back','release_id':RID,'preserved_archive':str(stage.relative_to(WORK))})
  verified=verifier().verify(DATA);require(verified['passed'] and not verified['unindexed_files'],'Rollback restored metadata but dataset verification needs review')
  dump(DATA/'manifests/latest-verification.json',verified)
  result={'passed':True,'rolled_back':True,'release_id':RID,'current_release':json.loads(blobs['dataset.before.json'])['current_release'],'archive_preserved':str(stage.relative_to(WORK)),'dataset_verification':verified}
  dump(HAND/'dataset-alignment.json',result);print(json.dumps(result,ensure_ascii=False,indent=2));return
 if stage.exists():
  require(not final.exists(),'Release already exists; never overwrite it');os.rename(stage,final);sync_dir(stage.parent);sync_dir(final.parent)
 current_state();atomic_write(index,blobs['assets.after.jsonl'])
 current_state();atomic_write(meta,blobs['dataset.after.json'])
 result=verifier().verify(DATA)
 if not result['passed'] or result['unindexed_files']:
  dump(transaction/'verification-failure.json',result)
  raise RuntimeError('Post-publication verification failed; transaction retained. Inspect then use --recover complete or --recover rollback')
 dump(DATA/'manifests/latest-verification.json',result)
 report={'passed':True,'release_id':RID,'added_files':len(plan['records']),'old_inventory_prefix_preserved':index.read_bytes().startswith(blobs['assets.before.jsonl']),'dataset_verification':result,'served':plan['served'],'mac_updated':False,'GPU_used':False,'recovery_journal':str(transaction.relative_to(WORK))}
 dump(HAND/'dataset-alignment.json',report);dump(transaction/'status.json',{'state':'complete','release_id':RID});print(json.dumps(report,ensure_ascii=False,indent=2))

def archive(args):
 assert args.reviewed_browser_pass,'Read the actual browser report before archival activation'
 assert args.browser_record is not None and args.browser_record.resolve().is_relative_to(WORK) and args.browser_record.is_file()
 args.browser_record=args.browser_record.resolve()
 pins={};trees=[]
 def pin(path):
  path=path.resolve();require(path.is_file() and path.is_relative_to(WORK.resolve()),'Source is missing or outside workspace: '+str(path));digest=sha(path)
  require(path not in pins or pins[path]==digest,'Source changed during capture: '+str(path));pins[path]=digest;return digest
 def capture(path):
  body=path.read_bytes();require(hashlib.sha256(body).hexdigest()==pin(path),'Source changed while reading: '+str(path));return body
 browser=json.loads(capture(args.browser_record));require(browser.get('passed') is True,'Browser activation record must explicitly report passed=true')
 meta=DATA/'dataset.json';index=DATA/'manifests/assets.jsonl';old_meta=meta.read_bytes();old_index=index.read_bytes();old=json.loads(old_meta)
 assert old['current_release']=='2026-10-23-168c-kitchen-detail-v1'
 baseline=verifier().verify(DATA);require(baseline['passed'] and not baseline['unindexed_files'],'Existing dataset must verify before archival')
 check_path=AUDIT/'metric-audit/independent-candidate-verification.json';check=json.loads(capture(check_path));assert check['passed']
 approved={c['candidate']:c for c in check['candidates']}
 variants=ROOT/'src/walkthrough/variants.js';text=capture(variants).decode();variants_sha=pins[variants.resolve()]
 served=[]
 for unit,variant in CASES:
  folder=f'assets/models/acro-river-park/{unit.lower()}/archisketch-metric-v1/{variant}'
  info_path=ROOT/folder/'model-info.json';info=json.loads(capture(info_path));stem=f'acro{unit.lower()}-{variant}'
  evidence=approved.get(f'{unit.lower()}-{variant}',{});require(evidence.get('passed') is True and evidence.get('candidate_glb_sha256')==info['glb_sha256'],'Independent evidence does not identify the exact candidate: '+folder)
  assert folder+'/'+stem+'.glb' in text and folder+'/model-info.json' in text
  for filename in [stem+'.blend',stem+'.glb']:
   assert pin(ROOT/folder/filename)==info['blend_sha256' if filename.endswith('.blend') else 'glb_sha256']
  for filename in [stem+'.glb','model-info.json']:
   url='http://127.0.0.1:5173/'+folder+'/'+filename
   with urllib.request.urlopen(url,timeout=60) as response:
    assert response.status==200;remote=hashlib.sha256(response.read()).hexdigest()
   assert remote==sha(ROOT/folder/filename)
   served.append({'url':url,'sha256':remote,'http':200})
 stage=DATA/'.staging'/RID;final=DATA/'releases'/RID;transaction=DATA/'.staging'/(RID+'.transaction')
 require(not transaction.exists(),'A recovery journal exists; use --recover complete/rollback or inspect the preserved transaction')
 assert not final.exists() and not stage.exists();stage.mkdir(parents=True)
 records=[];now=datetime.now(timezone.utc).isoformat()
 def cp(src,relative,kind='validation',unit=None,variant=None,provider='cortex'):
  assert src.is_file() and not src.is_symlink(),src
  src=src.resolve();before=pin(src);relative=Path(relative);require(not relative.is_absolute() and '..' not in relative.parts,'Invalid archive destination')
  dst=stage/relative;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst);assert sha(dst)==before==pin(src)
  with dst.open('rb') as copied:os.fsync(copied.fileno())
  records.append({'path':f'releases/{RID}/{Path(relative).as_posix()}','original_path':str(src.relative_to(WORK)),'sha256':before,'bytes':dst.stat().st_size,'origin_mtime_utc':datetime.fromtimestamp(src.stat().st_mtime,timezone.utc).isoformat(),'unit_type':unit,'variant':variant,'asset_kind':kind,'provider':provider,'storage_action':'copy_versioned_release','recorded_at_utc':now})
 def tree(src,relative,kind='validation',**kwargs):
  require(src.is_dir() and not src.is_symlink() and src.resolve().is_relative_to(WORK.resolve()),'Missing/invalid source tree: '+str(src))
  files=[p for p in sorted(src.rglob('*')) if p.is_file() and '__pycache__' not in p.parts];require(bool(files),'Empty source tree: '+str(src));trees.append((src,[str(p.relative_to(src)) for p in files]))
  for p in files:cp(p,Path(relative)/p.relative_to(src),kind,**kwargs)
 for unit,variant in CASES:
  tree(ROOT/f'assets/models/acro-river-park/{unit.lower()}/archisketch-metric-v1/{variant}',f'models/{unit}/{variant}','model',unit=unit,variant=variant)
 for p in ['tools/datasets/archive_metric_release.py','tools/blender/refine_opening_metrics.py','tools/blender/archisketch_metrics.py','tools/blender/prepare_acro112a_archisketch.py','tools/blender/prepare_112a_uv_p0.py','tools/blender/build_acro168c_archisketch.py','tests/test_archisketch_metrics.py','src/walkthrough/space-measurements.js','tests/space-measurements.test.js','src/walkthrough/catalog-furniture.js','tests/catalog-furniture.test.js','tools/assets/prepare_cc0_furniture.py','tools/measurements/build_review.mjs','src/walkthrough/variants.js']:
  cp(ROOT/p,Path('code')/p,'code')
 tree(ROOT/'assets/furniture/cc0/modern-arm-chair-01','furniture/modern-arm-chair-01','furniture',provider='polyhaven-cc0')
 tree(AUDIT/'metric-audit','validation/metric-audit')
 tree(AUDIT/'archisketch-live/20261023T130327Z','sources/reviewed-live-captures','source-audit',provider='archisketch')
 for name in ['source-authority.json','metric-candidates.json','cc0-chair-ready.json','confirm-needed.json','USER-ACTIONS.md']:
  cp(HAND/name,Path('provenance')/name,'provenance')
 for name in ['normalization-verification.json','chair-web-verification.json','chair-web.png','dimension-review.html','dimension-review.png','dimension-review-verification.json']:
  cp(ROOT/'runtime/service-readiness/2026-10-23'/name,Path('validation')/name)
 cp(args.browser_record,'validation/browser-activation.json')
 tree(ROOT/'runtime/interior/2026-10-23-metric-candidate/artifacts','validation/browser-candidates')
 tree(ROOT/'runtime/interior/2026-10-23-metric-activation','validation/web-activation')
 cp(ROOT/'runtime/service-map/2026-10-23/verification.json','validation/service-map.json')
 cp(ROOT/'runtime/service-map/2026-10-23/site-first/verification.json','validation/service-site-first.json')
 atomic_write(stage/'dataset-before.json',old_meta)
 release={'release_id':RID,'created_at_utc':now,'parent_release':old['current_release'],'status':'active_local_web_verified_mac_not_updated','models':[f'models/{u}/{v}' for u,v in CASES],'corrections':'Four opening widths from placed Archisketch instances; rooms/furniture geometry and original PBR image bytes preserved.','source_authority':'Archisketch coordinates are primary current geometric evidence; source-model agreement is not independent as-built measurement.','source_exceptions':['Current112A-basic added detached thirdbath not imported.','Current168C-basic project is an expanded copy; archivedbasic retained.'],'chair':'CC0 source model dimensions; optional catalog asset, not physical measurement.','served':served,'GPU_used':False,'browser_activation':'validation/browser-activation.json','rebuild':'Run archived code in the3DProperty workspace layout with parent artifacts available; this archive is not a standalone environment.'}
 dump(stage/'release.json',release)
 for name in ['dataset-before.json','release.json']:
  p=stage/name;records.append({'path':f'releases/{RID}/{name}','original_path':None,'sha256':sha(p),'bytes':p.stat().st_size,'asset_kind':'release_metadata','provider':'cortex','storage_action':'create_release_record','recorded_at_utc':now})
 new=copy.deepcopy(old)
 for u in new['units']:
  key=(u['unit_type'],u['variant'])
  if key in CASES:
   u.update(parent_model_revision=u['model_revision'],model_revision='archisketch-metric-v1',model_directory=f'releases/{RID}/models/{key[0]}/{key[1]}',generator=f'releases/{RID}/code/tools/blender/refine_opening_metrics.py',metric_verification=f'releases/{RID}/validation/metric-audit/independent-candidate-verification.json',metric_activation_evidence=f'releases/{RID}/validation/browser-activation.json')
  else:assert u==next(x for x in old['units'] if (x['unit_type'],x['variant'])==key)
 old_rows=[json.loads(line) for line in old_index.splitlines() if line.strip()]
 assert len({r['path'] for r in old_rows+records})==len(old_rows)+len(records)
 new.update(current_release=RID,previous_release=old['current_release'],updated_at_utc=now,files=len(old_rows)+len(records),bytes=sum(r['bytes'] for r in old_rows+records))
 assert meta.read_bytes()==old_meta and index.read_bytes()==old_index and sha(variants)==variants_sha,'Concurrent source/dataset change; retry review'
 require(all(sha(p)==digest for p,digest in pins.items()),'A copied/reviewed input changed; keep staging and repeat review')
 for source,names in trees:
  require(names==[str(p.relative_to(source)) for p in sorted(source.rglob('*')) if p.is_file() and '__pycache__' not in p.parts],'Source tree membership changed: '+str(source))
 archive_matches(stage,records)
 for directory in sorted([stage,*[p for p in stage.rglob('*') if p.is_dir()]],key=lambda p:len(p.parts),reverse=True):sync_dir(directory)
 # Prepare durable recovery payloads before the first publication mutation.
 transaction.mkdir();sync_dir(transaction.parent)
 new_index=old_index+(b'' if old_index.endswith(b'\n') else b'\n')+''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in records).encode()
 payloads={'dataset.before.json':old_meta,'dataset.after.json':json_bytes(new),'assets.before.jsonl':old_index,'assets.after.jsonl':new_index}
 for name,body in payloads.items():atomic_write(transaction/name,body)
 plan={'release_id':RID,'records':records,'served':served,'reviewed_browser_record_sha256':pins[args.browser_record],'source_sha256':{str(p.relative_to(WORK)):h for p,h in pins.items()},'payload_sha256':{name:hashlib.sha256(body).hexdigest() for name,body in payloads.items()}}
 dump(transaction/'plan.json',plan);sync_dir(stage);sync_dir(transaction)
 require(all(sha(p)==digest for p,digest in pins.items()),'Source changed before publication; preserved prepared transaction requires renewed review')
 transact(transaction,'complete')

def main():
 if not __debug__:raise RuntimeError('Do not run archival with Python assertions disabled')
 a=argparse.ArgumentParser(description=__doc__);a.add_argument('--browser-record',type=Path);a.add_argument('--reviewed-browser-pass',action='store_true');a.add_argument('--recover',choices=['complete','rollback']);args=a.parse_args()
 require(DATA.resolve().is_relative_to(WORK.resolve()),'Dataset escapes workspace')
 locks=DATA/'.staging';require(not locks.is_symlink() and locks.resolve().is_relative_to(DATA.resolve()),'Invalid staging directory');locks.mkdir(parents=True,exist_ok=True)
 require(not (DATA/'dataset.json').is_symlink() and not (DATA/'manifests/assets.jsonl').is_symlink(),'Dataset control files must not be symlinks')
 lock=locks/'metric-archive.lock';require(not lock.is_symlink(),'Archive lock must not be a symlink')
 with lock.open('a+') as handle:
  try:fcntl.flock(handle.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise RuntimeError('Another metric archival transaction is running') from None
  if args.recover:transact(locks/(RID+'.transaction'),args.recover)
  else:archive(args)
if __name__=='__main__':main()
