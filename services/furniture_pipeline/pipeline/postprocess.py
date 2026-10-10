"""Visible-surface measurement math ported from SAM3_MoGe3.ipynb.

Camera axes: X right, Y down, Z forward. Output lengths are meters.
"""
import csv
import json
from pathlib import Path

import cv2
import numpy as np
from scipy.spatial import cKDTree

def deduplicate_masks(data, min_pixels=100, iou_threshold=0.8):
    masks = np.asarray(data['masks'], dtype=bool)
    areas = masks.reshape(len(masks), -1).sum(axis=1) if len(masks) else np.empty(0)
    keep = []
    for idx in np.argsort(-data['scores'], kind='stable'):
        if areas[idx] < min_pixels:
            continue
        duplicate = False
        for other in keep:
            intersection = np.count_nonzero(masks[idx] & masks[other])
            union = int(areas[idx] + areas[other] - intersection)
            if union and intersection / union >= iou_threshold:
                duplicate = True
                break
        if not duplicate:
            keep.append(int(idx))
    return {key: values[keep] for key, values in data.items()}



def unit_vector(value, name):
    vector = np.asarray(value, dtype=np.float64)
    if vector.shape != (3,) or not np.isfinite(vector).all() or np.linalg.norm(vector) < 1e-8:
        raise ValueError(f'{name}: 유한한 3D 방향 벡터가 필요합니다.')
    return vector / np.linalg.norm(vector)


def masked_points(point_map, valid_mask, object_mask, colors, *, min_points=100,
                  erode_pixels=0, knn_std=3.0):
    if point_map.shape != (*object_mask.shape, 3) or valid_mask.shape != object_mask.shape:
        raise ValueError('mask/point map shape mismatch')
    if not isinstance(erode_pixels, int) or erode_pixels < 0:
        raise ValueError('erode_pixels는 0 이상의 정수여야 합니다.')
    mask = object_mask.astype(np.uint8)
    if erode_pixels:
        kernel = np.ones((2 * erode_pixels + 1,) * 2, dtype=np.uint8)
        mask = cv2.erode(mask, kernel, borderType=cv2.BORDER_CONSTANT, borderValue=0)
    mask = (mask > 0) & valid_mask.astype(bool)
    mask &= np.isfinite(point_map).all(axis=-1) & (point_map[..., 2] > 0)
    ys, xs = np.nonzero(mask)
    points = point_map[ys, xs].astype(np.float64)
    colors = colors[ys, xs]
    if len(points) < min_points:
        raise ValueError(f'유효 점 부족: {len(points)} < {min_points}')
    if knn_std is not None:
        if not np.isfinite(knn_std) or knn_std <= 0:
            raise ValueError('knn_std는 양수 또는 None이어야 합니다.')
        tree = cKDTree(points)
        # 청크 단위 질의로 고해상도 마스크에서도 임시 메모리를 제한합니다.
        distances = np.concatenate([
            tree.query(points[start:start + 20000], k=min(17, len(points)), workers=-1)[0][:, 1:].mean(axis=1)
            for start in range(0, len(points), 20000)
        ])
        keep = distances <= distances.mean() + knn_std * distances.std()
        points, colors, ys, xs = points[keep], colors[keep], ys[keep], xs[keep]
    if len(points) < min_points:
        raise ValueError(f'이상점 제거 후 점 부족: {len(points)} < {min_points}')
    return points, colors, np.column_stack([xs, ys])


def estimate_up_from_ground(point_map, valid_mask, object_masks, fallback_up=(0, -1, 0),
                            lower_image_fraction=0.45, iterations=256,
                            distance_ratio=0.008, max_points=50000):
    """화면 아래쪽 비객체 점에서 RANSAC 바닥 평면을 찾고 camera 좌표의 위쪽 법선을 반환합니다."""
    point_map = np.asarray(point_map, dtype=np.float64)
    valid = np.asarray(valid_mask, dtype=bool).copy()
    h, w = valid.shape
    if point_map.shape != (h, w, 3):
        raise ValueError('ground estimation point-map shape mismatch')
    valid[:int(round(h * lower_image_fraction))] = False
    valid &= np.isfinite(point_map).all(axis=-1) & (point_map[..., 2] > 0)

    masks = np.asarray(object_masks, dtype=bool)
    if masks.size:
        union = masks.any(axis=0).astype(np.uint8)
        # 물체 경계의 depth bleeding도 바닥 후보에서 제외합니다.
        union = cv2.dilate(union, np.ones((11, 11), np.uint8)) > 0
        valid &= ~union

    points = point_map[valid]
    if len(points) < 500:
        raise ValueError(f'바닥 후보점 부족: {len(points)}')
    rng = np.random.default_rng(42)
    if len(points) > max_points:
        points = points[rng.choice(len(points), max_points, replace=False)]

    fallback = unit_vector(fallback_up, 'fallback_up')
    threshold = max(0.01, float(np.median(points[:, 2])) * float(distance_ratio))
    min_up_cos = np.cos(np.deg2rad(60.0))
    best_inliers = None
    best_count = 0
    for _ in range(int(iterations)):
        a, b, c = points[rng.choice(len(points), 3, replace=False)]
        normal = np.cross(b - a, c - a)
        norm = np.linalg.norm(normal)
        if norm < 1e-8:
            continue
        normal /= norm
        if np.dot(normal, fallback) < 0:
            normal = -normal
        if np.dot(normal, fallback) < min_up_cos:
            continue
        offset = -float(np.dot(normal, a))
        inliers = np.abs(np.einsum('ij,j->i', points, normal) + offset) <= threshold
        count = int(inliers.sum())
        if count > best_count:
            best_count, best_inliers = count, inliers

    if best_inliers is None or best_count < max(200, int(0.08 * len(points))):
        raise ValueError(f'신뢰할 바닥 평면 없음: best={best_count}/{len(points)}')

    plane_points = points[best_inliers]
    centroid = plane_points.mean(axis=0)
    _, _, vh = np.linalg.svd(plane_points - centroid, full_matrices=False)
    normal = vh[-1]
    if np.dot(normal, fallback) < 0:
        normal = -normal
    normal = unit_vector(normal, 'estimated_ground_up')
    residuals = np.abs(np.einsum('ij,j->i', points - centroid, normal))
    refined = residuals <= threshold
    if refined.sum() >= 200:
        plane_points = points[refined]
        centroid = plane_points.mean(axis=0)
        _, _, vh = np.linalg.svd(plane_points - centroid, full_matrices=False)
        normal = vh[-1]
        if np.dot(normal, fallback) < 0:
            normal = -normal
        normal = unit_vector(normal, 'estimated_ground_up')
        residuals = np.abs(np.einsum('ij,j->i', points - centroid, normal))

    info = {
        'candidate_points': int(len(points)),
        'inlier_points': int(np.count_nonzero(residuals <= threshold)),
        'distance_threshold_m': float(threshold),
        'median_residual_m': float(np.median(residuals[residuals <= threshold])),
    }
    return normal, info


def fit_upright_obb(points, up=(0, -1, 0), width_direction=None,
                    trim_percent=0.0, swap_width_depth=False):
    points = np.asarray(points, dtype=np.float64)
    if points.ndim != 2 or points.shape[1] != 3 or len(points) < 4 or not np.isfinite(points).all():
        raise ValueError('유한한 (N,3) 점군이 필요합니다.')
    if not 0 <= trim_percent < 25:
        raise ValueError('trim_percent는 [0,25) 범위여야 합니다.')
    up = unit_vector(up, 'up')
    right = np.array([1., 0., 0.])
    right -= np.dot(right, up) * up
    if np.linalg.norm(right) < 1e-6:
        right = np.array([0., 0., 1.])
        right -= np.dot(right, up) * up
    right = unit_vector(right, 'projected camera right')
    forward = unit_vector(np.cross(up, right), 'forward')
    origin = np.median(points, axis=0)
    centered = points - origin
    if width_direction is None:
        horizontal = np.column_stack([np.einsum('ij,j->i', centered, right), np.einsum('ij,j->i', centered, forward)]).astype(np.float32)
        rect = cv2.minAreaRect(horizontal)
        rect_corners = cv2.boxPoints(rect).astype(np.float64)
        edges = [rect_corners[1] - rect_corners[0], rect_corners[2] - rect_corners[1]]
        if min(np.linalg.norm(e) for e in edges) < 1e-6:
            raise ValueError('수평면의 점들이 거의 일직선이라 깊이/너비를 정할 수 없습니다.')
        edges = [e / np.linalg.norm(e) for e in edges]
        edge = max(edges, key=lambda e: abs(e[0]))
        width_axis = edge[0] * right + edge[1] * forward
        axis_source = 'minimum_area_rectangle_camera_right_heuristic'
    else:
        width_axis = unit_vector(width_direction, 'width_direction')
        width_axis -= np.dot(width_axis, up) * up
        width_axis = unit_vector(width_axis, 'horizontal width_direction')
        axis_source = 'user_width_direction'
    if np.dot(width_axis, right) < 0:
        width_axis = -width_axis
    depth_axis = unit_vector(np.cross(up, width_axis), 'depth_axis')
    if swap_width_depth:
        width_axis, depth_axis = depth_axis, -width_axis
        axis_source += '_swapped'
    basis = np.column_stack([width_axis, up, depth_axis])  # W,H,D columns
    local = np.einsum('ij,jk->ik', centered, basis)
    lower, upper = np.percentile(local, [trim_percent, 100 - trim_percent], axis=0)
    extent = upper - lower
    if not np.isfinite(extent).all() or np.any(extent <= 1e-5):
        raise ValueError('퇴화한 점군입니다. 일부 치수를 단일 영상에서 복원할 수 없습니다.')
    signs = np.array([[0,0,0], [1,0,0], [1,1,0], [0,1,0],
                      [0,0,1], [1,0,1], [1,1,1], [0,1,1]], dtype=float)
    corners = (lower + signs * extent) @ basis.T + origin
    return {
        'depth_m': float(extent[2]), 'height_m': float(extent[1]), 'width_m': float(extent[0]),
        'center_camera_m': (((lower + upper) / 2) @ basis.T + origin).tolist(),
        'corners_camera_m': corners.tolist(), 'axes_whd_camera': basis.tolist(),
        'axis_source': axis_source,
    }


def dimension_array(records):
    """성공한 객체만 [depth, height, width], meters. 빈 결과는 (0, 3)."""
    return np.asarray([
        [r['depth_m'], r['height_m'], r['width_m']]
        for r in records if r['status'] == 'ok'
    ], dtype=np.float64).reshape(-1, 3)


def save_measurements(records, metadata, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    payload = {'metadata': metadata, 'objects': records}
    (directory / 'measurements.json').write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8'
    )
    columns = ['object_id', 'label', 'score', 'status', 'depth_m', 'height_m', 'width_m']
    with (directory / 'measurements.csv').open('w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(records)
    np.save(directory / 'dimensions_dhw_m.npy', dimension_array(records))
