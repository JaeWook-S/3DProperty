import expandedInfo from './model-info.json';
import expandedDoors from './doors.json';
import basicInfo from './basic-info.json';
import basicDoors from './basic-doors.json';

export const VARIANTS = {
  expanded: {
    label: '확장형', info: expandedInfo, doors: expandedDoors,
    url: new URL('../../assets/models/acro-river-park/112a/dimensioned-v3/expanded/acro112a-expanded.glb', import.meta.url).href,
    note: '확장부는 도면을 바탕으로 구성한 시나리오입니다.',
  },
  basic: {
    label: '기본형', info: basicInfo, doors: basicDoors,
    url: new URL('../../assets/models/acro-river-park/112a/dimensioned-v3/basic/acro112a-basic.glb', import.meta.url).href,
    note: '실내와 발코니가 분리된 기본형입니다.',
  },
};
