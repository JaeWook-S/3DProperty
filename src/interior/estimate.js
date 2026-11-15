// Quantity takeoff → priced quote. Pure: the price DB, user overrides and the
// measured quantities come in; numbered lines and totals come out.
import { finishById, finishPriceCode } from './finish-catalog.js';
import { PARTITION_TYPES } from './wall-plan.js';

const round10 = n => Math.round(n / 10) * 10;
const fixed = (n, d = 2) => Number(n.toFixed(d));

export function priceTable(db, overrides = new Map()) {
  const table = new Map();
  for (const item of db.items) {
    const o = overrides.get?.(item.code) ?? overrides[item.code];
    table.set(item.code, o ? { ...item, ...pick(o, ['material', 'labor', 'expense']), overridden: true } : { ...item });
  }
  return table;
}
const pick = (o, keys) => Object.fromEntries(keys.filter(k => Number.isFinite(Number(o[k]))).map(k => [k, Number(o[k])]));
const overrideOf = (overrides, code) => overrides?.get?.(code) ?? overrides?.[code] ?? null;

// Product-level material price (원/m²) for a finish; labour, expense and loss
// stay with the installation item of its price code.
export function productMaterial(db, overrides, finishId) {
  const o = overrideOf(overrides, finishId), base = db.products?.[finishId]?.material;
  if (o && Number.isFinite(Number(o.material))) return { material: Number(o.material), overridden: true };
  return Number.isFinite(base) ? { material: base, overridden: false } : null;
}
// Installed unit price (material + labour + expense) of one finish on a surface.
export function finishUnitPrice(db, overrides, finish, surface) {
  const code = finishPriceCode(finish, surface), item = db.items.find(i => i.code === code);
  if (!item) return null;
  const o = overrideOf(overrides, code), merged = o ? { ...item, ...pick(o, ['material', 'labor', 'expense']) } : item;
  const product = productMaterial(db, overrides, finish.id);
  return (product?.material ?? merged.material) + merged.labor + merged.expense;
}

function line(table, code, qty, extra = {}) {
  const item = table.get(code);
  if (!item) throw Error(`단가표에 없는 항목입니다: ${code}`);
  if (!(qty > 0)) return null;
  const loss = extra.loss ?? item.loss ?? 0, material = extra.material ?? item.material;
  // Components are rounded first so material + labor + expense always equals the amount.
  const materialAmount = round10(qty * (1 + loss) * material), expenseAmount = round10(qty * item.expense);
  let laborAmount = round10(qty * item.labor), amount = materialAmount + laborAmount + expenseAmount, note = extra.note ?? '';
  // A minimum charge is a labour call-out: the shortfall is booked as labour.
  if (item.minimum && amount < item.minimum) { laborAmount += item.minimum - amount; amount = item.minimum; note = [note, `최소 ${item.minimum.toLocaleString('ko-KR')}원 적용`].filter(Boolean).join(' · '); }
  const packs = item.pack ? Math.ceil(qty * (1 + loss) / item.pack.size) : null;
  return { code, trade: item.trade, name: extra.name ?? item.name, spec: extra.spec ?? item.spec, unit: item.unit, qty: fixed(qty, item.unit === 'm²' || item.unit === 'm' || item.unit === 'm³' ? 2 : 0),
    loss, packs: packs ? `${packs}${item.pack.label}` : null, material, labor: item.labor, expense: item.expense,
    materialAmount, laborAmount, expenseAmount, amount, note, overridden: Boolean(item.overridden || extra.overridden), perDay: item.perDay ?? null };
}

function places(list, max = 3) {
  const names = [...new Set(list)];
  return names.length > max ? `${names.slice(0, max).join(', ')} 외 ${names.length - max}곳` : names.join(', ');
}

// finishes: [{key, surface:'wall'|'floor', roomName, label, area, finishId, original:'wallpaper'|'tile'|'wood'}]
// structure: structureQuantities() result.
// furniture: [{key, name, price, roomName}] — consumer prices (VAT included), added after the construction total.
export function buildEstimate({ db, overrides, structure = { demolition: [], partitions: [] }, finishes = [], furniture = [], options = {} }) {
  const table = priceTable(db, overrides), lines = [], warnings = [];
  const add = l => { if (l) lines.push(l); };
  const tileMethod = options.tileMethod === 'remove' ? 'remove' : 'overlay';

  // 철거 + 보수 ------------------------------------------------------------------
  const demo = structure.demolition;
  if (demo.length) {
    const area = demo.reduce((s, d) => s + d.area, 0), volume = demo.reduce((s, d) => s + d.volume, 0), length = demo.reduce((s, d) => s + d.length, 0);
    const where = places(demo.map(d => d.label));
    add(line(table, 'DM-WALL', area, { note: where }));
    add(line(table, 'DM-DOOR', demo.reduce((s, d) => s + d.doors, 0)));
    add(line(table, 'DM-SASH', demo.reduce((s, d) => s + d.sashes, 0), { note: '발코니 경계 창호' }));
    add(line(table, 'DM-WASTE', volume * 1.3, { note: '벽체 체적 × 1.3 (부피 증가 가정)' }));
    add(line(table, 'RP-FLOOR', length, { note: '철거 벽 아래 바닥 연결' }));
    add(line(table, 'RP-CEIL', length));
    add(line(table, 'RP-END', demo.length * 2, { note: `${demo.length}구간 × 양 끝` }));
    add(line(table, 'RP-ELEC', demo.length));
    const wet = demo.filter(d => d.caution === 'wet');
    add(line(table, 'RP-WET', wet.reduce((s, d) => s + d.length, 0), { note: '욕실 인접 벽' }));
    add(line(table, 'RP-STRUCT', 1, { note: '내력벽은 철거할 수 없어요' }));
    warnings.push('벽 철거 전 구조 확인이 필요해요. 공동주택의 내력벽은 철거할 수 없고, 비내력벽도 관리주체 신고 대상일 수 있어요.');
    if (wet.length) warnings.push('욕실과 맞닿은 벽을 철거하면 방수층 보강과 배관 확인이 필요해요.');
    if (demo.some(d => d.caution === 'balcony')) warnings.push('발코니 경계 벽·창호 철거는 확장 공사로, 단열·결로 대책과 행위 허가 확인이 필요해요.');
  }

  // 가벽 -----------------------------------------------------------------------------
  const parts = structure.partitions;
  for (const type of Object.keys(PARTITION_TYPES)) {
    const own = parts.filter(p => p.type === type);
    if (!own.length) continue;
    const area = own.reduce((s, p) => s + p.area, 0), length = own.reduce((s, p) => s + p.length, 0);
    add(line(table, PARTITION_TYPES[type].priceCode, area, { note: `${own.length}개 · 길이 ${length.toFixed(2)}m${own.some(p => p.movedFrom) ? ' · 옮긴 벽 포함' : ''}` }));
  }
  const finishable = parts.filter(p => p.type !== 'glass');
  add(line(table, 'PT-FINISH', finishable.reduce((s, p) => s + p.area * 2, 0), { note: '양면 면적' }));
  add(line(table, 'PT-DOOR', parts.filter(p => p.door).length));

  // 마감 -----------------------------------------------------------------------------
  const removal = new Map(), byCode = new Map();
  for (const f of finishes) {
    const finish = finishById(f.finishId); if (!finish || !(f.area > 0)) continue;
    const code = finishPriceCode(finish, f.surface), key = `${code}|${finish.id}`;
    if (!byCode.has(key)) byCode.set(key, { code, finish, area: 0, places: [] });
    const entry = byCode.get(key); entry.area += f.area; entry.places.push(f.roomName ? `${f.roomName} ${f.surface === 'floor' ? '바닥' : f.label}` : f.label);
    // Existing surface preparation follows what is being covered.
    let prep = null;
    if (f.original === 'tile') prep = finish.category === 'tile' && tileMethod === 'overlay' ? 'TL-OVERLAY' : 'DM-FIN-TILE';
    else if (f.original === 'wood') prep = 'DM-FIN-FLOOR';
    else if (f.surface === 'wall') prep = 'DM-FIN-WP';
    if (prep) removal.set(prep, (removal.get(prep) ?? 0) + f.area);
  }
  for (const [code, area] of removal) add(line(table, code, area, { note: code === 'TL-OVERLAY' ? '기존 타일 위 덧방 시공' : '' }));
  for (const { code, finish, area, places: where } of byCode.values()) {
    const product = productMaterial(db, overrides, finish.id);
    add(line(table, code, area, { name: `${table.get(code).name}`, spec: `${finish.name} · ${finish.detail}`, note: places(where), material: product?.material, overridden: product?.overridden }));
  }

  // 공통 + 최소 인건비 -------------------------------------------------------------
  const worked = lines.length > 0;
  if (worked) {
    const touched = finishes.reduce((s, f) => s + f.area, 0) + demo.reduce((s, d) => s + d.length * 2, 0) + parts.reduce((s, p) => s + p.area, 0);
    add(line(table, 'GN-PROTECT', 1));
    add(line(table, 'GN-CLEAN', Math.max(1, touched)));
  }
  for (const [trade, info] of Object.entries(db.trades)) {
    if (!info.minLabor) continue;
    const labor = lines.filter(l => l.trade === trade).reduce((s, l) => s + l.laborAmount, 0);
    if (labor > 0 && labor < info.minLabor) {
      const gap = round10(info.minLabor - labor);
      lines.push({ code: `MIN-${trade}`, trade, name: `${info.label} 최소 인건비 보정`, spec: '소규모 시공 1일 기준', unit: '식', qty: 1, loss: 0, packs: null, material: 0, labor: gap, expense: 0,
        materialAmount: 0, laborAmount: gap, expenseAmount: 0, amount: gap, note: `${info.minLabor.toLocaleString('ko-KR')}원 미만 보정`, overridden: false });
    }
  }

  lines.sort((a, b) => db.trades[a.trade].order - db.trades[b.trade].order);
  lines.forEach((l, i) => { l.no = i + 1; });
  const direct = lines.reduce((s, l) => s + l.amount, 0);
  const material = lines.reduce((s, l) => s + l.materialAmount, 0), labor = lines.reduce((s, l) => s + l.laborAmount, 0);
  const overhead = round10(direct * db.rates.overhead), profit = round10(direct * db.rates.profit);
  const supplyRaw = direct + overhead + profit, truncate = db.rates.truncate ?? 1000;
  const supply = Math.floor(supplyRaw / truncate) * truncate, adjustment = supply - supplyRaw;
  const vat = round10(supply * db.rates.vat), total = supply + vat;
  const trades = Object.entries(db.trades).map(([id, info]) => ({ id, label: info.label, amount: lines.filter(l => l.trade === id).reduce((s, l) => s + l.amount, 0),
    days: workDays(lines.filter(l => l.trade === id), info) })).filter(t => t.amount > 0);
  const days = worked ? trades.reduce((s, t) => s + t.days, 0) + 1 : 0;
  // Furniture: one line per product, quantities merged.
  const goods = new Map();
  for (const f of furniture) {
    if (!(f.price >= 0)) continue;
    const o = overrideOf(overrides, `FN:${f.key}`), price = o && Number.isFinite(Number(o.price)) ? Number(o.price) : f.price;
    if (!goods.has(f.key)) goods.set(f.key, { key: f.key, name: f.name, price, qty: 0, rooms: [], overridden: Boolean(o) });
    const g = goods.get(f.key); g.qty++; if (f.roomName) g.rooms.push(f.roomName);
  }
  const furnitureLines = [...goods.values()].map((g, i) => ({ no: i + 1, key: g.key, name: g.name, unit: '개', qty: g.qty, price: g.price, amount: g.price * g.qty, note: places(g.rooms), overridden: g.overridden }));
  const furnitureTotal = furnitureLines.reduce((s, l) => s + l.amount, 0);
  return { lines, trades, warnings, furniture: furnitureLines, totals: { direct, material, labor, expense: direct - material - labor, overhead, profit, adjustment, supply, vat, total,
    furniture: furnitureTotal, grand: total + furnitureTotal,
    range: [Math.round(total * db.rates.rangeLow / 10000) * 10000, Math.round(total * db.rates.rangeHigh / 10000) * 10000] }, days,
    options: { tileMethod }, db: { version: db.version, basis: db.basis, overrides: lines.filter(l => l.overridden).map(l => l.code) } };
}

function workDays(lines, info) {
  if (!info.productivity || !lines.length) return 0;
  const days = lines.filter(l => l.unit === info.productivity.unit && !l.code.startsWith('MIN-')).reduce((s, l) => s + l.qty / (l.perDay ?? info.productivity.perDay), 0) || 0.5;
  return Math.max(0.5, Math.ceil(days * 2) / 2);
}

const DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'], SMALL = ['', '십', '백', '천'], LARGE = ['', '만', '억', '조'];
export function koreanAmount(value) {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return '영';
  const groups = [];
  while (n > 0) { groups.push(n % 10000); n = Math.floor(n / 10000); }
  return groups.map((g, gi) => {
    if (!g) return '';
    let text = '';
    String(g).padStart(4, '0').split('').forEach((d, i) => { const digit = Number(d); if (digit) text += DIGITS[digit] + SMALL[3 - i]; });
    return text + LARGE[gi];
  }).reverse().join('');
}
export const won = n => `${Math.round(n).toLocaleString('ko-KR')}원`;
