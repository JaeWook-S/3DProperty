import { koreanAmount } from './estimate.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => Math.round(n).toLocaleString('ko-KR');
const qty = n => Number.isInteger(n) ? n.toLocaleString('ko-KR') : n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = iso => { const d = new Date(iso); return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`; };

// A self-contained, printable quote (A4 portrait). Rendered into an iframe so
// printing never includes the 3D application around it.
export function quoteHTML(quote) {
  const { estimate: e, meta } = quote, trades = new Map();
  for (const l of e.lines) { if (!trades.has(l.trade)) trades.set(l.trade, []); trades.get(l.trade).push(l); }
  const tradeLabel = id => e.trades.find(t => t.id === id)?.label ?? id;
  const rows = [...trades].map(([trade, lines]) => `
    <tr class="trade"><th colspan="10">${esc(tradeLabel(trade))}</th></tr>
    ${lines.map(l => `<tr>
      <td class="c">${l.no}</td><td>${esc(l.name)}${l.overridden ? '<sup>*</sup>' : ''}</td><td class="spec">${esc(l.spec)}</td><td class="c">${esc(l.unit)}</td>
      <td class="r">${qty(l.qty)}${l.packs ? `<small>${esc(l.packs)}</small>` : ''}</td>
      <td class="r">${num(l.material)}</td><td class="r">${num(l.labor)}</td><td class="r">${num(l.expense)}</td>
      <td class="r strong">${num(l.amount)}</td><td class="note">${esc(l.note)}${l.loss ? `${l.note ? ' · ' : ''}로스 ${Math.round(l.loss * 100)}%` : ''}</td></tr>`).join('')}
    <tr class="sub"><td colspan="8">${esc(tradeLabel(trade))} 소계</td><td class="r strong">${num(lines.reduce((s, l) => s + l.amount, 0))}</td><td></td></tr>`).join('');
  const t = e.totals, goods = e.furniture ?? [], grand = t.grand ?? t.total, furnitureTotal = t.furniture ?? 0;
  const furnitureRows = goods.map(l => `<tr><td class="c">${l.no}</td><td>${esc(l.name)}${l.overridden ? '<sup>*</sup>' : ''}</td><td class="c">${l.qty}</td><td class="r">${num(l.price)}</td><td class="r strong">${num(l.amount)}</td><td class="note">${esc(l.note)}</td></tr>`).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(meta.number)} 견적서</title>
<style>
@page{size:A4;margin:14mm 12mm}
*{box-sizing:border-box}body{margin:0;font-family:"Pretendard","Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;color:#1f2723;font-size:10.5px;line-height:1.45;background:#fff}
.sheet{max-width:186mm;margin:0 auto;padding:10px 4px}
h1{font-size:28px;letter-spacing:.6em;text-align:center;margin:6px 0 16px;font-weight:700}
.meta{display:grid;grid-template-columns:1.1fr 1fr;gap:10px;margin-bottom:10px}
.box{border:1px solid #9aa79f;border-radius:4px;padding:8px 10px}
.box dl{display:grid;grid-template-columns:62px 1fr;gap:3px 8px;margin:0}.box dt{color:#5d6b63}.box dd{margin:0}
.to{font-size:15px;font-weight:700;border-bottom:1px solid #1f2723;padding-bottom:4px;margin-bottom:6px}
.total{display:flex;justify-content:space-between;align-items:center;background:#f3f6f1;border:1px solid #9aa79f;border-radius:4px;padding:9px 12px;margin:8px 0 12px}
.total b{font-size:15px}.total span{font-size:12px}.total small{display:block;color:#5d6b63;font-size:9.5px;margin-top:2px}
h2.section{font-size:12px;margin:14px 0 6px}h2.section small{font-weight:400;color:#5d6b63;margin-left:6px}
.visual{display:grid;grid-template-columns:1.25fr 1fr;gap:8px;margin-bottom:12px}.visual figure{margin:0;border:1px solid #d6ddd6;border-radius:4px;overflow:hidden;background:#f7f8f5}
.visual img{display:block;width:100%;height:150px;object-fit:cover}.visual svg{display:block;width:100%;height:150px}.visual figcaption{padding:3px 6px;color:#5d6b63;font-size:9px}
table{width:100%;border-collapse:collapse;font-size:9.6px}th,td{border:1px solid #c7d0c9;padding:3px 4px;vertical-align:top}
thead th{background:#e9eee8;font-weight:600}tr.trade th{background:#f6f8f4;text-align:left;font-weight:700}
tr.sub td{background:#fafbf8;font-weight:600}.c{text-align:center}.r{text-align:right;white-space:nowrap}.strong{font-weight:700}
td small{display:block;color:#5d6b63}.spec{color:#3e4a44;max-width:150px}.note{color:#5d6b63;max-width:120px}
.summary{display:grid;grid-template-columns:1fr 230px;gap:12px;margin-top:10px}.summary table td{padding:4px 6px}
.notes{border:1px solid #c7d0c9;border-radius:4px;padding:8px 10px;color:#3e4a44}.notes h3{margin:0 0 4px;font-size:11px}.notes ul{margin:0;padding-left:16px}
.grand td{font-size:12px;font-weight:700;background:#e9eee8}
.stamp{margin-top:12px;display:flex;justify-content:space-between;color:#5d6b63;font-size:9px}
sup{color:#a14a2c}
</style></head><body><div class="sheet">
<h1>견적서</h1>
<div class="meta">
  <div class="box"><div class="to">${esc(meta.customer || '고객')} 귀하</div><dl>
    <dt>견적번호</dt><dd>${esc(meta.number)}</dd><dt>작성일</dt><dd>${date(meta.createdAt)}</dd><dt>유효기간</dt><dd>작성일로부터 14일</dd>
    <dt>공사명</dt><dd>${esc(meta.project)}</dd><dt>공사 범위</dt><dd>${esc(meta.scope)}</dd><dt>예상 공정</dt><dd>약 ${Math.ceil(e.days)}일 (공종 순차 진행 가정)</dd></dl></div>
  <div class="box"><dl><dt>작성</dt><dd>CORTEX 인테리어 시뮬레이터</dd><dt>단가 기준</dt><dd>${esc(e.db.version)}${e.db.overrides.length ? ` · 수정 단가 ${e.db.overrides.length}건(*)` : ''}</dd>
    <dt>구분</dt><dd>참고용 시뮬레이션 견적 · 사업자 정보 없음</dd><dt>문의</dt><dd>실측 후 시공사 정식 견적으로 확정</dd></dl></div>
</div>
<div class="total"><span>합계 금액 (부가세 포함)${furnitureTotal ? `<small>공사 ₩${num(t.total)} + 가구 ₩${num(furnitureTotal)}</small>` : ''}</span><b>일금 ${koreanAmount(grand)}원정 (₩${num(grand)})</b></div>
${meta.image || meta.plan ? `<div class="visual">${meta.image ? `<figure><img src="${meta.image}" alt="디자인 3D 미리보기"><figcaption>3D 미리보기 · 실제 시공 결과와 다를 수 있음</figcaption></figure>` : ''}${meta.plan ? `<figure>${meta.plan}<figcaption>변경 평면 · 빨간 점선 철거, 진한 선 신설 벽</figcaption></figure>` : ''}</div>` : ''}
<table><thead><tr><th>No</th><th>품명</th><th>규격</th><th>단위</th><th>수량</th><th>재료비 단가</th><th>노무비 단가</th><th>경비 단가</th><th>금액(원)</th><th>비고</th></tr></thead>
<tbody>${rows || '<tr><td colspan="10" class="c">공사 변경 항목이 없습니다.</td></tr>'}</tbody></table>
${goods.length ? `<h2 class="section">가구 <small>예시 가격 · 부가세 포함 소비자가</small></h2>
<table class="goods"><thead><tr><th>No</th><th>품명</th><th>수량</th><th>단가</th><th>금액(원)</th><th>배치</th></tr></thead>
<tbody>${furnitureRows}<tr class="sub"><td colspan="4">가구 소계</td><td class="r strong">${num(furnitureTotal)}</td><td></td></tr></tbody></table>` : ''}
<div class="summary">
  <div class="notes"><h3>특기 사항</h3><ul>
    ${e.warnings.map(w => `<li>${esc(w)}</li>`).join('')}
    <li>수량은 3D 모델의 면적 산출값(개구부 제외)이며 실측 후 변동될 수 있어요. 자재 수량에는 표기한 로스율이 포함돼요.</li>
    <li>${esc(e.db.basis)}</li>
    <li>타일 시공 방식: ${e.options.tileMethod === 'overlay' ? '기존 타일 위 덧방' : '기존 타일 철거 후 시공'}. 가구·조명·설비 기기 비용은 포함하지 않아요.</li>
    <li>예상 범위 ₩${num(t.range[0])} ~ ₩${num(t.range[1])} (현장 조건에 따른 변동 가정)</li>
  </ul></div>
  <table><tbody>
    <tr><td>직접 공사비</td><td class="r">${num(t.direct)}</td></tr>
    <tr><td>└ 재료비 / 노무비 / 경비</td><td class="r">${num(t.material)} / ${num(t.labor)} / ${num(t.expense)}</td></tr>
    <tr><td>${esc(quote.rates.overheadLabel)}</td><td class="r">${num(t.overhead)}</td></tr>
    <tr><td>${esc(quote.rates.profitLabel)}</td><td class="r">${num(t.profit)}</td></tr>
    <tr><td>단수 정리</td><td class="r">${num(t.adjustment)}</td></tr>
    <tr><td>공급가액</td><td class="r strong">${num(t.supply)}</td></tr>
    <tr><td>부가가치세 (10%)</td><td class="r">${num(t.vat)}</td></tr>
    <tr class="${furnitureTotal ? 'sub' : 'grand'}"><td>공사비 합계</td><td class="r">₩${num(t.total)}</td></tr>
    ${furnitureTotal ? `<tr><td>가구 (예시 가격)</td><td class="r">${num(furnitureTotal)}</td></tr><tr class="grand"><td>총 합계</td><td class="r">₩${num(grand)}</td></tr>` : ''}
  </tbody></table>
</div>
<div class="stamp"><span>본 문서는 CORTEX 시뮬레이션 결과로 계약서가 아닙니다.</span><span>${esc(meta.number)}</span></div>
</div></body></html>`;
}

export function quoteCSV(quote) {
  const e = quote.estimate, cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['No', '공종', '품명', '규격', '단위', '수량', '재료비단가', '노무비단가', '경비단가', '재료비', '노무비', '경비', '금액', '비고'];
  const label = id => e.trades.find(t => t.id === id)?.label ?? id;
  const rows = e.lines.map(l => [l.no, label(l.trade), l.name, l.spec, l.unit, l.qty, l.material, l.labor, l.expense, l.materialAmount, l.laborAmount, l.expenseAmount, l.amount, l.note]);
  const t = e.totals;
  for (const l of e.furniture ?? []) rows.push([`F${l.no}`, '가구', l.name, '예시 가격', l.unit, l.qty, l.price, '', '', '', '', '', l.amount, l.note]);
  rows.push([], ['', '', '직접공사비', '', '', '', '', '', '', '', '', '', t.direct], ['', '', '공과잡비', '', '', '', '', '', '', '', '', '', t.overhead], ['', '', '기업이윤', '', '', '', '', '', '', '', '', '', t.profit],
    ['', '', '공급가액', '', '', '', '', '', '', '', '', '', t.supply], ['', '', '부가세', '', '', '', '', '', '', '', '', '', t.vat], ['', '', '공사비 합계', '', '', '', '', '', '', '', '', '', t.total]);
  if (t.furniture) rows.push(['', '', '가구', '', '', '', '', '', '', '', '', '', t.furniture], ['', '', '총 합계', '', '', '', '', '', '', '', '', '', t.grand]);
  return '﻿' + [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
}
