"""Isolated Astra (Codex CLI) baseline runner for floorplan -> Blender 3D.

Each run:
  * fresh temporary CODEX_HOME holding only auth.json (no memories, skills, AGENTS.md, MCP servers)
  * --ignore-user-config --ignore-rules --ephemeral, web search off
  * no OS sandbox (bwrap is blocked on yj-1): danger-full-access in a scratch work dir under floorplan-runs/,
    then a post-hoc audit of every command and agent-written file; any flag marks the run invalid
  * work dir contains only the inputs of the chosen condition
  * one-shot fixed prompt, full JSONL event log kept for audit
  * audit: commands that touch outside paths, process/system inspection, forbidden tools and agent-written
    files -> leak_flags (run invalid); outside paths that only appear in command output -> review_flags
  * after the run the GLB is scored against the unit's GT with score_glb.py (GT is never staged)

Units: the shared 10-unit set (releases/2026-11-20-floorplans10/data/<unit>), e.g. 168C_expanded

Conditions
  A : floor plan image only
  B : floor plan image + floorplan_numbers.json (Archisketch source numbers: HAR base + MCP derived values,
      built from the release by build_stage2_input.py)
  C : floor plan image + 360 panoramas, no Archisketch numbers (168C_expanded only)

Usage
  python run_baseline.py --unit 168C_expanded --condition A --run r1 [--dry-run] [--no-score]
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tempfile, time
from pathlib import Path

REPO = Path('/home/nas5/kinamkim/Repos/geonwoo')          # holds .codex (not moved)
CORTEX = REPO / '11_projects/cortex'                       # 3DProperty, AisideProject, floorplan-runs
AISIDE = CORTEX / 'AisideProject'
OUT_BASE = CORTEX / '3DProperty/runtime/floorplan-accuracy/baseline'
RELEASE = AISIDE / 'datasets/acro-river-park/releases/2026-11-20-floorplans10/data'
STAGE2_ROOT = CORTEX / '3DProperty/runtime/floorplan-accuracy/inputs'
SCORER = Path(__file__).resolve().parent / 'score_glb.py'
UNITS = sorted(p.name for p in RELEASE.iterdir() if p.is_dir())
# The OS sandbox (bwrap) cannot run on yj-1 (unprivileged userns blocked by AppArmor), so the agent
# runs with danger-full-access in a scratch dir outside the project trees; leakage is checked post hoc.
RUN_ROOT = CORTEX / 'floorplan-runs'
CODEX = REPO / '.codex/bin/codex'
AUTH = REPO / '.codex/home/auth.json'
BPY_PYTHON = '/home/nas_main/kinamkim/miniconda3/envs/intern_mvsam3d/bin/python'
MODEL, EFFORT = 'gpt-6-astra', 'xhigh'

PANO_DIR = AISIDE / 'datasets/acro-river-park/raw/user-provided/168c-intake-20261025/panoramas-user-labelled-168c-expanded'

PROMPT = """You are building a 3D model of one apartment unit in Blender.

Inputs are in ./inputs:
{inputs}

Task
- Build the unit as accurately as possible in real-world metric dimensions: walls, doors and windows.
- Use Python with the bpy module: {bpy} (run your script with it; there is no Blender GUI).
- Units are meters. Floor at height 0.
- Name objects by type: wall_<n>, door_<n> (door leaf as its own object, origin at the hinge), window_<n>.
  For sliding doors use door_<n>_panel_<k>.
- Write:
  ./output/model.glb      (glTF, Y-up, export_apply transforms)
  ./output/model.blend
  ./output/elements.json  with
     walls:    [{{"id","start":[x,z],"end":[x,z],"thickness","height"}}]
     openings: [{{"id","type":"swing_door|sliding_door|window","center":[x,z],"width","height","sill","host_wall","hinge_side","swing_direction"}}]
  all lengths in meters, plan coordinates (x, z) in the same frame as model.glb.

Rules
- Use only the files in this directory. Do not read other directories and do not use the internet.
- Do not inspect other processes, users or system state (no ps, top, pgrep, /proc, env dumps).
- Do not ask questions; make reasonable assumptions and list them in ./output/assumptions.md.
- Finish with a short summary of what you built.
"""

INPUT_DESC = {
    'plan.jpg': '  - plan.jpg: the floor plan image (printed dimensions are in millimeters)',
    'floorplan_numbers.json': ('  - floorplan_numbers.json: Archisketch source floorplan numbers (mm, radians). '
                               'Units, axes and fields are described inside the file.'),
    'panoramas/': ('  - panoramas/: 30 indoor 360 panoramas of this unit as built (VR tour), equirectangular 4096x2048,\n'
                   '    camera roughly level. Camera positions and room names are not given.'),
}


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def stage_inputs(unit, cond, inp):
    inp.mkdir(parents=True)
    shutil.copy(RELEASE / unit / 'input_floorplan.jpg', inp / 'plan.jpg')
    names = ['plan.jpg']
    if cond == 'B':
        shutil.copy(STAGE2_ROOT / unit / 'stage2' / 'floorplan_numbers.json', inp / 'floorplan_numbers.json')
        names += ['floorplan_numbers.json']
    if cond == 'C':
        (inp / 'panoramas').mkdir()
        for f in sorted(PANO_DIR.glob('pano_*_cube6x1.jpg')):
            name = f.name.replace('_cube6x1', '')
            cube_to_equirect(f, inp / 'panoramas' / name)
            names.append(f'panoramas/{name}')
    return names


# Cube strip face order verified by edge continuity on the 168C set:
# [right(+x), left(-x), up(+y), down(-y), front(+z), back(-z)], horizontal ring front->right->back->left.
FACE_INDEX = dict(right=0, left=1, up=2, down=3, front=4, back=5)


def cube_to_equirect(src, dst, width=4096):
    import numpy as np
    from PIL import Image
    a = np.asarray(Image.open(src).convert('RGB'))
    n = a.shape[0]
    face = {k: a[:, i * n:(i + 1) * n] for k, i in FACE_INDEX.items()}
    h = width // 2
    th = (np.arange(width) + .5) / width * 2 * np.pi - np.pi
    ph = np.pi / 2 - (np.arange(h) + .5) / h * np.pi
    th, ph = np.meshgrid(th, ph)
    x, y, z = np.cos(ph) * np.sin(th), np.sin(ph), np.cos(ph) * np.cos(th)
    ax, ay, az = np.abs(x), np.abs(y), np.abs(z)
    out = np.zeros((h, width, 3), np.uint8)
    def put(m, k, c, r):
        ci = np.clip(((c + 1) / 2 * n).astype(int), 0, n - 1); ri = np.clip(((r + 1) / 2 * n).astype(int), 0, n - 1)
        out[m] = face[k][ri[m], ci[m]]
    zf = (az >= ax) & (az >= ay); xf = (ax > az) & (ax >= ay); yf = (ay > ax) & (ay > az)
    with np.errstate(divide='ignore', invalid='ignore'):
        put(zf & (z > 0), 'front', x / az, -y / az); put(zf & (z < 0), 'back', -x / az, -y / az)
        put(xf & (x > 0), 'right', -z / ax, -y / ax); put(xf & (x < 0), 'left', z / ax, -y / ax)
        put(yf & (y > 0), 'up', x / ay, z / ay); put(yf & (y < 0), 'down', x / ay, -z / ay)
    Image.fromarray(out).save(dst, quality=92)


ALLOWED_PREFIX = (BPY_PYTHON, str(Path(BPY_PYTHON).parents[1]), '/tmp', '/usr', '/bin', '/dev/null', '/proc/self', '/etc/ssl')
SUSPICIOUS = ('$HOME', '${HOME}', '~/', 'ls ~', 'locate ', 'os.path.expanduser', 'Path.home')
ROOT_SCAN = re.compile(r'\b(find|ls|tree|du)\s+(-\S+\s+)*/(\s|$)')
# process / system inspection (forbidden by the prompt). Shell: the tool must sit in command position
# (start, after ; | & ( ` or a quote, or after bash -c). Code: /proc/<other>, psutil, or a subprocess call of ps.
_CMDPOS = r'''(^|[;|&(`'"]|-l?c\s)\s*(sudo\s+)?'''
SYS_SCAN_CMD = re.compile(_CMDPOS + r'''((ps|top|htop|pgrep|pstree|printenv)(\s|$|[;|&)'"])|env\s*($|[;|&)'"]))'''
                          r'|/proc/(?!self\b|cpuinfo\b|meminfo\b)\w')
SYS_SCAN_CODE = re.compile(r'''/proc/(?!self\b|cpuinfo\b|meminfo\b)\w|psutil\.(process_iter|pids)'''
                           r'''|\[\s*['"](ps|top|pgrep|pstree|printenv)['"]|['"](ps|pgrep) -''')


def _scan_text(txt, work, where, flags):
    norm = txt.replace('\\n', ' ').replace('\\"', ' ')
    for tok in norm.replace('"', ' ').replace("'", ' ').replace('(', ' ').replace(')', ' ').replace(',', ' ').split():
        tok = tok.strip(';:')
        if tok.startswith(('/home', '/nas', '/root', '/mnt', '/data', '/srv')) and not tok.startswith(
                (str(work), str(work.resolve())) + ALLOWED_PREFIX):
            flags.append(f'{where}: path {tok[:160]}')
        if tok == '..' or tok.startswith('../') or '/../' in tok:
            flags.append(f'{where}: parent {tok[:160]}')
    for s in SUSPICIOUS:
        if s in norm:
            flags.append(f'{where}: pattern {s}')
    if ROOT_SCAN.search(norm):
        flags.append(f'{where}: pattern root scan')
    scan = SYS_SCAN_CMD if where == 'command' else SYS_SCAN_CODE if where.startswith(('file', 'file_change')) else None
    if scan is not None and scan.search(norm):
        flags.append(f'{where}: process/system inspection')


def audit(events_path, work):
    """Flag every hint that the agent looked outside its work dir.

    Returns (leak_flags, review_flags).
    leak_flags  : the command text itself, file changes, forbidden tools, or agent-written files point outside
                  work/, scan the file system root, or inspect processes / system state -> run invalid.
    review_flags: outside paths that only appear in command output (e.g. printed by a tool) -> human review.
    """
    flags, review = [], []
    for line in events_path.read_text(errors='ignore').splitlines():
        try:
            ev = json.loads(line)
        except Exception:
            continue
        item = ev.get('item') or {}
        t = item.get('type')
        if t in ('mcp_tool_call', 'web_search'):
            flags.append(f'event: forbidden tool {t}')
            _scan_text(json.dumps(item, ensure_ascii=False), work, 'command', flags)
        elif t == 'command_execution':
            _scan_text(item.get('command') or '', work, 'command', flags)
            _scan_text(item.get('aggregated_output') or '', work, 'output', review)
        elif t == 'file_change':
            _scan_text(json.dumps(item.get('changes'), ensure_ascii=False), work, 'file_change', flags)
    for f in work.rglob('*'):
        if f.is_file() and f.suffix in ('.py', '.sh', '.txt', '.md', '.json') and f.stat().st_size < 5_000_000:
            if f.is_relative_to(work / 'inputs'):
                continue
            _scan_text(f.read_text(errors='ignore'), work, f'file {f.relative_to(work)}', flags)
    return sorted(set(flags)), sorted(set(review))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--unit', required=True, choices=UNITS)
    ap.add_argument('--condition', required=True, choices=['A', 'B', 'C'])
    ap.add_argument('--run', required=True)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--no-score', action='store_true')
    a = ap.parse_args()
    if a.condition == 'C' and a.unit != '168C_expanded':
        raise SystemExit('condition C (panoramas) exists only for 168C_expanded')
    slug = a.unit.lower().replace('_', '-')          # 168C_expanded -> 168c-expanded
    gt = RELEASE / a.unit / 'mcp_get-floorplan-structure.json'

    run_dir = OUT_BASE / slug / a.condition / a.run
    if run_dir.exists():
        raise SystemExit(f'run dir exists, choose another --run: {run_dir}')
    run_dir.mkdir(parents=True)
    work = RUN_ROOT / slug / a.condition / a.run / 'work'
    if work.exists():
        raise SystemExit(f'scratch work dir exists: {work}')
    names = stage_inputs(a.unit, a.condition, work / 'inputs')
    (work / 'output').mkdir()
    descs = [INPUT_DESC[n] for n in names if not n.startswith('panoramas/')]
    if any(n.startswith('panoramas/') for n in names):
        descs.append(INPUT_DESC['panoramas/'])
    prompt = PROMPT.format(inputs='\n'.join(descs), bpy=BPY_PYTHON)
    (run_dir / 'prompt.md').write_text(prompt)

    meta = dict(unit=a.unit, condition=a.condition, run=a.run, gt=str(gt), model=MODEL, effort=EFFORT, codex=str(CODEX),
                inputs={n: sha(work / 'inputs' / n) for n in names}, started_kst=None)
    with tempfile.TemporaryDirectory(prefix='codex-home-') as home:
        shutil.copy(AUTH, Path(home) / 'auth.json'); os.chmod(Path(home) / 'auth.json', 0o600)
        cmd = [str(CODEX), 'exec', '--json', '--ephemeral', '--ignore-user-config', '--ignore-rules',
               '--skip-git-repo-check', '-s', 'danger-full-access', '-C', str(work),
               '-m', MODEL, '-c', f'model_reasoning_effort="{EFFORT}"', '-c', 'web_search="disabled"',
               '-i', str(work / 'inputs/plan.jpg'), '-o', str(run_dir / 'last_message.md'), '-']
        meta['command'] = ' '.join(cmd)
        if a.dry_run:
            (run_dir / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1))
            print(prompt); print('CMD:', meta['command']); print('run dir:', run_dir)
            return
        env = dict(os.environ, CODEX_HOME=home)
        from datetime import datetime, timedelta, timezone
        t0 = time.time(); meta['started_kst'] = datetime.now(timezone(timedelta(hours=9))).strftime('%Y-%m-%d %H:%M:%S')
        with open(run_dir / 'events.jsonl', 'w') as ev, open(run_dir / 'stderr.log', 'w') as er:
            p = subprocess.run(cmd, input=prompt, text=True, stdout=ev, stderr=er, env=env, cwd=work)
        meta.update(exit_code=p.returncode, elapsed_min=round((time.time() - t0) / 60, 1))
    out = work / 'output'
    meta['outputs'] = {f.name: f.stat().st_size for f in out.iterdir()} if out.exists() else {}
    meta['leak_flags'], meta['review_flags'] = audit(run_dir / 'events.jsonl', work)
    meta['valid'] = not meta['leak_flags']
    meta['needs_review'] = bool(meta['review_flags'])
    meta['scratch_work'] = str(work)
    shutil.copytree(work, run_dir / 'work')
    glb = run_dir / 'work/output/model.glb'
    if not a.no_score and glb.exists():
        r = subprocess.run([sys.executable, '-I', str(SCORER), '--glb', str(glb), '--gt', str(gt),
                            '--out', str(run_dir / 'score')], capture_output=True, text=True)
        meta['score_exit'] = r.returncode
        if r.returncode == 0:
            sc = json.loads((run_dir / 'score/score.json').read_text())['rigid']
            f = sc['wall_f1'][sc['wall_f1']['headline']]
            meta['score_rigid'] = dict(wall_f1_10cm=f['f1'], precision=f['precision'], recall=f['recall'],
                                       iou=sc['footprint']['iou'], center_mae_cm=sc['walls_all']['center_offset_mae_cm'],
                                       within_2cm=sc['walls_all']['within_2cm_ratio'],
                                       openings=f"{sc['openings']['detected']}/{sc['openings']['gt']}")
    (run_dir / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    print(json.dumps(meta, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
