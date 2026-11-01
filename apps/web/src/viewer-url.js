import {lookupUnit,getUnitModelVariants,variantForUnit} from '../../../src/property/unit-catalog.js';
import { writeSelection } from '../../../src/property/service-selection.js';
export const DEFAULT_VARIANT = '112a-expanded-archisketch';
export const VARIANTS = {
  '112a-basic-archisketch': {title:'112A 기본형',unitType:'112A',structureOnly:false,coordinateBased:true,subtitle:'치수 기반 실내 · 발코니 분리',description:'아키스케치 기본형 좌표를 반영했습니다. 천장 2.60m이며 문·창 높이와 벽 두께에는 임시값이 있습니다. 주방 아일랜드·욕실 설비·소파·안방 침대·서재를 배치했습니다. 집기 세부 치수는 가정값입니다.',image:'112a-archisketch-basic.png',caption:'112A 기본형 · 치수 기반 실내 모델'},
  '112a-expanded-archisketch': {title:'112A 확장형',unitType:'112A',structureOnly:false,coordinateBased:true,subtitle:'치수 기반 실내 · 확장부 반영',description:'아키스케치 확장형 좌표를 반영했습니다. 천장 2.60m이며 문·창 높이와 벽 두께에는 임시값이 있습니다. 주방 아일랜드·욕실 설비·소파·안방 침대·서재를 배치했습니다. 집기 세부 치수는 가정값입니다.',image:'112a-archisketch-expanded.png',caption:'112A 확장형 · 치수 기반 실내 모델'},
  '168c-basic-archisketch': {title:'168C 기본형',unitType:'168C',structureOnly:false,coordinateBased:true,subtitle:'치수 기반 실내 · 발코니 분리',description:'아키스케치 기본형 좌표를 반영했습니다. 천장 2.50m이며 벽 두께와 일부 창호는 가정값입니다. 확장형 VR을 참고한 주방·욕실·바닥 마감을 반영했습니다. 집기 치수는 배치 가정값입니다.',image:'168c-archisketch-basic.png',caption:'168C 기본형 · 치수 기반 실내 모델'},
  '168c-expanded-archisketch': {title:'168C 확장형',unitType:'168C',structureOnly:false,coordinateBased:true,subtitle:'치수 기반 실내 · 확장부 반영',description:'아키스케치 확장형 좌표를 반영했습니다. 천장 2.50m이며 벽 두께와 일부 창호는 가정값입니다. 확장형 VR을 참고한 주방·욕실·바닥 마감을 반영했습니다. 집기 치수는 배치 가정값입니다.',image:'168c-archisketch-expanded.png',caption:'168C 확장형 · 치수 기반 실내 모델'},
};
export function buildViewerUrl(base, variant, { entry = 'overview', selection = null, embedded = false } = {}) {
  if (!['overview', 'complex'].includes(entry)) throw new Error('지원하지 않는 시작 화면입니다.');
  variant = ({basic:'112a-basic-archisketch',expanded:'112a-expanded-archisketch','168c-basic':'168c-basic-archisketch','168c-expanded':'168c-expanded-archisketch'})[variant] || variant;
  if (!Object.hasOwn(VARIANTS, variant)) throw new Error('지원하지 않는 평면입니다.');
  const url = selection ? writeSelection(base, selection) : new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('뷰어 주소는 HTTP(S) 주소여야 합니다.');
  if(selection?.locationId==='acro-river-park'&&selection.unit&&entry!=='complex'){
    const unit=lookupUnit(selection.building,selection.floor,selection.unit);
    if(!unit||!getUnitModelVariants(unit).length)throw new Error('선택한 호수의 실내 3D는 준비 중입니다.');
    variant=variantForUnit(unit,variant);
  }
  // Explicit preset URL plus the bounded service selection contract.
  for (const [key, value] of Object.entries({ variant, studio: '1', entry, finish: 'original', lighting: 'day', quality: 'balanced' })) url.searchParams.set(key, value);
  if (embedded) url.searchParams.set('embedded','1');
  url.hash = '';
  return url.href;
}

// The prototype has assumed geometry. Selection belongs only to the return URL.
export function buildFloorAccessUrl(base, servicePage) {
  const viewer = new URL(base), service = new URL(servicePage);
  for (const url of [viewer, service]) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('연결 주소는 HTTP(S) 주소여야 합니다.');
    url.hash = '';
  }
  viewer.searchParams.delete('serviceUrl'); viewer.searchParams.delete('viewerUrl');
  service.searchParams.delete('serviceUrl'); service.searchParams.set('viewerUrl', viewer.href);
  const review = new URL('./floor-access-review.html', viewer);
  review.searchParams.set('viewerUrl', viewer.href);
  review.searchParams.set('serviceUrl', service.href);
  return review.href;
}
