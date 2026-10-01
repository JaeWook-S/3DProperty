export const VARIANTS = {
  expanded: { title: '확장형', subtitle: '발코니를 확장한 공간', description: '기본형 치수와 확장형 이미지를 조합한 시나리오입니다.', image: 'expanded.jpg' },
  basic: { title: '기본형', subtitle: '실내와 발코니가 분리된 구조', description: '치수가 있는 기본형 도면을 바탕으로 구성했습니다.', image: 'basic.jpg' },
};
export function buildViewerUrl(base, variant) {
  if (!Object.hasOwn(VARIANTS, variant)) throw new Error('지원하지 않는 평면입니다.');
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('뷰어 주소는 HTTP(S) 주소여야 합니다.');
  // No embedded control API: only the viewer\'s implemented preset query contract.
  for (const [key, value] of Object.entries({ variant, finish: 'original', lighting: 'day', quality: 'high' })) url.searchParams.set(key, value);
  url.hash = '';
  return url.href;
}
