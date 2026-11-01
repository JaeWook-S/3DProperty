import archisketchBasic from '../../assets/models/acro-river-park/168c/archisketch-details-v2/basic/model-info.json';
import archisketchExpanded from '../../assets/models/acro-river-park/168c/archisketch-metric-v1/expanded/model-info.json';
import archisketch112Basic from '../../assets/models/acro-river-park/112a/archisketch-metric-v1/basic/model-info.json';
import archisketch112Expanded from '../../assets/models/acro-river-park/112a/archisketch-metric-v1/expanded/model-info.json';
import { archisketchWebData, bindArchisketchModel } from './archisketch-model.js';
const archisketchNote = '아키스케치 좌표 기반 구조입니다. 천장 2.50m · 일반 문짝 0.80×2.40m. 벽 두께·일부 창호·문 개폐 방향은 가정이며 확장형 VR을 참고해 주방·욕실·마감을 재현했으며 집기 치수는 배치 가정값입니다. 기본형은 같은 마감을 구조에 맞게 적용했습니다. 가구 치수와 문 하드웨어·개폐 방식은 설계 가정/제안이며 실제 시공 상태는 확인되지 않았습니다.';

const definitions = {
  '112a-basic-archisketch': {
    label:'기본형', unitType:'112A', ...archisketchWebData(archisketch112Basic),
    prepareModel:bindArchisketchModel, structureOnly:false, coordinateBased:true,
    url:new URL('../../assets/models/acro-river-park/112a/archisketch-metric-v1/basic/acro112a-basic.glb',import.meta.url).href,
    note:'아키스케치 기본형 좌표 기반 구조입니다. 천장 2.60m. 문·창 높이는 카탈로그 기준이며 벽 두께·창틀 여유는 가정값입니다. 최신 도면과 신발장 치수로 현관을 구분하고, 참고 이미지에 맞춰 아일랜드·4인 식탁·소파·책상을 배치했습니다. 소파는 제품 규격이며 나머지 가구에는 설계 가정값이 포함됩니다. 좁은 미닫이문의 개폐 방식과 식탁 배치는 통로 확보를 위한 제안이며, 실제 시공 상태는 확인되지 않았습니다.',
  },
  '112a-expanded-archisketch': {
    label:'확장형', unitType:'112A', ...archisketchWebData(archisketch112Expanded),
    prepareModel:bindArchisketchModel, structureOnly:false, coordinateBased:true,
    url:new URL('../../assets/models/acro-river-park/112a/archisketch-metric-v1/expanded/acro112a-expanded.glb',import.meta.url).href,
    note:'아키스케치 확장형 좌표 기반 구조입니다. 천장 2.60m. 문·창 높이는 카탈로그 기준이며 벽 두께·창틀 여유는 가정값입니다. 최신 도면과 신발장 치수로 현관을 구분하고, 참고 이미지에 맞춰 아일랜드·4인 식탁·소파·책상을 배치했습니다. 소파는 제품 규격이며 나머지 가구에는 설계 가정값이 포함됩니다. 좁은 미닫이문의 개폐 방식과 식탁 배치는 통로 확보를 위한 제안이며, 실제 시공 상태는 확인되지 않았습니다.',
  },
  '168c-basic-archisketch': {
    label: '기본형', unitType: '168C', ...archisketchWebData(archisketchBasic),
    prepareModel: bindArchisketchModel, structureOnly: false, coordinateBased: true,
    url: new URL('../../assets/models/acro-river-park/168c/archisketch-details-v2/basic/acro168c-basic.glb', import.meta.url).href,
    note: archisketchNote,
  },
  '168c-expanded-archisketch': {
    label: '확장형', unitType: '168C', ...archisketchWebData(archisketchExpanded),
    prepareModel: bindArchisketchModel, structureOnly: false, coordinateBased: true,
    url: new URL('../../assets/models/acro-river-park/168c/archisketch-metric-v1/expanded/acro168c-expanded.glb', import.meta.url).href,
    note: archisketchNote,
  },
};
export const DEFAULT_VARIANT = '112a-expanded-archisketch';
export const VARIANTS = definitions;
// Existing shared links now open the corresponding current coordinate-based model.
const previousKeys = {basic:'112a-basic-archisketch',expanded:'112a-expanded-archisketch','168c-basic':'168c-basic-archisketch','168c-expanded':'168c-expanded-archisketch'};
export function resolveVariant(key) {
  const current = previousKeys[key] || key;
  return Object.hasOwn(VARIANTS,current) ? current : DEFAULT_VARIANT;
}
export const variantTitle = definition => `${definition.unitType} · ${definition.label}`;
export function populateVariantSelect(select) {
  select.replaceChildren();
  for (const [key, definition] of Object.entries(VARIANTS)) {
    const option = document.createElement('option'); option.value=key;
    option.textContent=variantTitle(definition); select.append(option);
  }
}
