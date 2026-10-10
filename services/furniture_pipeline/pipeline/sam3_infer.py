"""SAM3 worker: runs in its own NumPy 1.x / CUDA environment."""
import argparse
import json
from pathlib import Path
import numpy as np
import torch
from PIL import Image
from sam3.model_builder import build_sam3_image_model
from sam3.model.sam3_image_processor import Sam3Processor


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




def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--settings', required=True)
    parser.add_argument('--image', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--prompts-json', required=True)
    parser.add_argument('--threshold', type=float, required=True)
    parser.add_argument('--checkpoint', default='')
    args = parser.parse_args()
    if not torch.cuda.is_available():
        raise RuntimeError('SAM3 환경에서 CUDA GPU가 보이지 않습니다.')
    if args.checkpoint and not Path(args.checkpoint).is_file():
        raise FileNotFoundError(args.checkpoint)
    image = Image.open(args.image).convert('RGB')
    model = build_sam3_image_model(
        device='cuda', eval_mode=True,
        checkpoint_path=args.checkpoint or None,
        load_from_HF=not bool(args.checkpoint),
    ).eval()
    processor = Sam3Processor(model, device='cuda', confidence_threshold=args.threshold)
    masks, scores, boxes, labels = [], [], [], []
    # SAM3의 image transform은 BF16 activation을 만들지만 일부 Linear weight는
    # FP32로 유지됩니다. CUDA autocast가 없으면 mat1/mat2 dtype mismatch가 납니다.
    amp_dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    with torch.inference_mode(), torch.autocast(device_type='cuda', dtype=amp_dtype):
        state = processor.set_image(image)
        for prompt in json.loads(args.prompts_json):
            processor.reset_all_prompts(state)
            result = processor.set_text_prompt(state=state, prompt=prompt)
            pmasks = result['masks'].detach().cpu().numpy()
            if pmasks.ndim == 4 and pmasks.shape[1] == 1:
                pmasks = pmasks[:, 0]
            if pmasks.shape[1:] != (image.height, image.width):
                raise RuntimeError(f'SAM3 mask resolution mismatch: {pmasks.shape}')
            pscores = result['scores'].detach().float().cpu().numpy().reshape(-1)
            pboxes = result['boxes'].detach().float().cpu().numpy().reshape(-1, 4)
            for mask, score, box in zip(pmasks, pscores, pboxes):
                if np.isfinite(score) and score >= args.threshold and mask.any():
                    masks.append(mask.astype(bool))
                    scores.append(float(score))
                    boxes.append(box)
                    labels.append(prompt)
    data = {
        "masks": np.stack(masks) if masks else np.empty((0, image.height, image.width), dtype=bool),
        "scores": np.asarray(scores, dtype=np.float32),
        "boxes": np.asarray(boxes, dtype=np.float32).reshape(-1, 4),
        "labels": np.asarray(labels, dtype=str),
    }
    # Duplicate prompts (e.g. table/desk) must not create duplicate furniture.
    options = json.loads(Path(args.settings).read_text(encoding="utf-8"))
    data = deduplicate_masks(data, options["min_mask_pixels"], options["mask_nms_iou"])
    # allow_pickle=False로 읽을 수 있는 numeric/string 배열만 저장.
    np.savez_compressed(
        args.output,
        **data,
    )
    print(f'SAM3: {len(scores)} raw masks, {len(data["scores"])} after NMS', flush=True)


if __name__ == '__main__':
    main()
