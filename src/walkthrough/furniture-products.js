import { parse } from 'yaml';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const EXAMPLE_PRODUCTS = Object.freeze({
  version: 1,
  defaults: { price: 199000, currency: 'KRW', seller: '임시 판매처', url: 'https://example.com/', placeholder: true },
  products: {},
});

function validateEntry(entry, key) {
  if (!record(entry)) throw new Error(`${key}: 상품 정보를 들여쓰기된 목록으로 작성해 주세요.`);
  for (const field of ['name', 'seller', 'url', 'currency']) {
    if (entry[field] !== undefined && typeof entry[field] !== 'string') throw new Error(`${key}.${field}: 따옴표로 감싼 문자열을 입력해 주세요.`);
  }
  if (entry.price !== undefined && entry.price !== null && (!Number.isFinite(entry.price) || entry.price < 0)) {
    throw new Error(`${key}.price: 쉼표 없는 0 이상의 숫자 또는 null을 입력해 주세요.`);
  }
  if (entry.placeholder !== undefined && typeof entry.placeholder !== 'boolean') throw new Error(`${key}.placeholder: true 또는 false를 입력해 주세요.`);
  if (entry.currency !== undefined) {
    try { new Intl.NumberFormat('ko-KR', { style: 'currency', currency: entry.currency }); }
    catch { throw new Error(`${key}.currency: KRW 같은 통화 코드를 입력해 주세요.`); }
  }
}

export function parseFurnitureProducts(source) {
  const config = parse(source, { maxAliasCount: 0 });
  if (!record(config) || config.version !== 1 || !record(config.products)) throw new Error('version: 1과 products 항목을 확인해 주세요.');
  validateEntry(config.defaults ?? {}, 'defaults');
  for (const [key, entry] of Object.entries(config.products)) validateEntry(entry, `products.${key}`);
  return { ...config, defaults: { ...EXAMPLE_PRODUCTS.defaults, ...config.defaults } };
}

export function safeProductUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function resolveFurnitureProduct(config, item) {
  const candidates = [item.id, item.group?.userData.catalog_id, item.kind];
  const key = candidates.find(id => id && Object.hasOwn(config.products, id));
  const product = { ...config.defaults, ...(key ? config.products[key] : {}) };
  return {
    ...product,
    key: key ?? item.kind ?? item.id,
    name: product.name || `${item.title} · 임시 상품`,
    url: safeProductUrl(product.url),
    priceLabel: product.price === null ? '판매처에서 가격 확인' : new Intl.NumberFormat('ko-KR', {
      style: 'currency', currency: product.currency,
    }).format(product.price),
  };
}
