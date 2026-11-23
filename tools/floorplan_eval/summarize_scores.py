"""Collect score_glb.py results into the shared reporting table (one row per model).

Every team member reports GT accuracy with these columns, taken from score.json as written by score_glb.py.
Primary metric: scale-fitted wall F1@10cm (with precision and recall). The rest are secondary or reference.

Usage
  python summarize_scores.py <score_dir or score.json> [...] [--label NAME ...] [--csv table.csv]
  Labels default to the folder that holds score.json. A markdown table is printed to stdout.
"""
import argparse, csv, json, sys
from pathlib import Path

# (column, path in score.json or callable, header for the markdown table)
COLUMNS = [
    ('unit', lambda d: Path(d['gt']).parent.name, '평형'),
    ('wall_f1_10cm', 'scale_fitted.wall_f1.10cm.f1', '벽 F1@10cm (주 지표)'),
    ('wall_precision_10cm', 'scale_fitted.wall_f1.10cm.precision', 'Precision'),
    ('wall_recall_10cm', 'scale_fitted.wall_f1.10cm.recall', 'Recall'),
    ('wall_iou', 'scale_fitted.footprint.iou', '벽 IoU'),
    ('wall_centre_mae_cm', 'scale_fitted.walls_all.center_offset_mae_cm', '벽 중심 오차 cm'),
    ('wall_thickness_mae_cm', 'scale_fitted.walls_all.thickness_mae_cm', '두께 오차 cm'),
    ('wall_height_mae_cm', 'scale_fitted.walls_all.height_mae_cm', '높이 오차 cm'),
    ('walls_missing', lambda d: f"{g(d, 'scale_fitted.walls_all.missing')}/{g(d, 'scale_fitted.walls_all.scored')}",
     '빠진 벽 / 채점 벽'),
    ('openings_detected', lambda d: f"{g(d, 'scale_fitted.openings.detected')}/{g(d, 'scale_fitted.openings.gt')}",
     '문창 검출'),
    ('openings_extra', 'scale_fitted.openings.extra', '없는 문창'),
    ('opening_width_mae_cm', 'scale_fitted.openings.width_mae_cm', '문창 폭 오차 cm'),
    ('opening_centre_mae_cm', 'scale_fitted.openings.center_mae_cm', '문창 중심 오차 cm'),
    ('size_vs_gt_pct', lambda d: round(100 * (1 / g(d, 'alignment.scale_fitted.scale') - 1), 1), '정답 대비 크기 %'),
    ('rigid_wall_f1_10cm', 'rigid.wall_f1.10cm.f1', '참고: 크기 고정 벽 F1@10cm'),
    ('scorer_version', 'scorer_version', '채점기 버전'),
]


def g(d, path):
    for k in path.split('.'):
        d = d[k]
    return d


def row(d):
    return {c: (src(d) if callable(src) else g(d, src)) for c, src, _ in COLUMNS}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('scores', nargs='+', help='score_glb.py output folders or score.json files')
    ap.add_argument('--label', action='append', default=[], help='one per score, in order')
    ap.add_argument('--csv')
    a = ap.parse_args()
    if a.label and len(a.label) != len(a.scores):
        sys.exit('--label must be given once per score')
    rows = []
    for i, s in enumerate(a.scores):
        p = Path(s)
        p = p / 'score.json' if p.is_dir() else p
        d = json.loads(p.read_text())
        rows.append(dict(label=a.label[i] if a.label else p.parent.name, **row(d)))
    if len({r['scorer_version'] for r in rows}) > 1:
        print('warning: rows were scored with different scorer versions; rescore before comparing', file=sys.stderr)
    keys = ['label'] + [c for c, _, _ in COLUMNS]
    if a.csv:
        with open(a.csv, 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=keys); w.writeheader(); w.writerows(rows)
    heads = ['모델'] + [h for _, _, h in COLUMNS]
    print('| ' + ' | '.join(heads) + ' |')
    print('|' + '---|' * len(heads))
    for r in rows:
        print('| ' + ' | '.join(str(r[k]) for k in keys) + ' |')


if __name__ == '__main__':
    main()
