'use strict';
const $ = id => document.getElementById(id);
const TYPES = ['', '중소기업', '여성기업', '장애인기업', '창업기업', '중증장애인생산품 생산시설', '장애인표준사업장', '사회적기업', '사회적협동조합'];
const LABELS = ['전체', '중소기업', '여성기업', '장애인기업', '창업기업', '중증장애인생산품 생산시설', '장애인표준사업장', '인증 사회적기업', '사회적협동조합'];
const STORE = 'supplier_diversity_2.procurementReviews';
const norm = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => value.toLocaleString('ko-KR');
let data, suppliers = [], matches = [], activeType = '', page = 1, reviews = [];
let storageError = false;
try { const saved = JSON.parse(localStorage.getItem(STORE) || '[]'); if (!Array.isArray(saved)) throw Error(); reviews = saved.filter(r => r && typeof r.id === 'string' && typeof r.bizno === 'string'); }
catch { storageError = true; }
const sourceLabel = key => data.sources[key]?.label || key;
const typesOf = c => [...new Set(c.evidence.filter(e => !e.validUntil || e.validUntil >= new Date().toLocaleDateString('sv-SE')).map(e => e.type))];
const contactValue = (c, key) => [...new Set((c.contacts || []).map(x => x[key]).filter(Boolean))].join(' / ');
const badge = t => `<span class="badge ${t === '사회적기업' ? 'social' : t.startsWith('중증') ? 'severe' : t === '여성기업' ? 'women' : ''}">${escapeHTML(t)}</span>`;
const termsOf = query => {
  const terms = query.trim().split(/\s+/).filter(t => !['제작','구매','주문','납품','구입','업체','기업','서비스','용역'].includes(t)).map(norm);
  return terms.length ? terms : [norm(query)].filter(Boolean);
};
function score(c, query, related) {
  const terms = termsOf(query);
  if (!terms.length) return {score: 1, label: c.items.length ? '생산품목 제공' : '사업내용 제공'};
  const contains = text => terms.every(t => norm(text).includes(t));
  if (contains(c.items.join(' '))) return {score: 100, label: '생산품목 일치'};
  if (contains(c.business)) return {score: 80, label: '사업내용 일치'};
  if (contains(c.name) || contains(c.bizno)) return {score: 70, label: '업체정보 일치'};
  if (related) {
    if (contains(c.industries.join(' '))) return {score: 30, label: '관련 업종'};
    const alternatives = {'현수막':['인쇄','광고'], '배너':['인쇄','광고'], '복사용지':['용지','종이','사무용품'], '기념품':['판촉','공예'], '청소':['위생','시설관리']};
    const corpus = norm([c.business, ...c.items, ...c.industries].join(' '));
    if (terms.every(t => corpus.includes(t) || (alternatives[t] || []).some(x => corpus.includes(x)))) return {score: 20, label: '관련 업종'};
  }
  return null;
}
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 3500); }
function persist() {
  try { localStorage.setItem(STORE, JSON.stringify(reviews)); storageError = false; }
  catch { storageError = true; toast('브라우저 저장에 실패했습니다. CSV로 내려받아 보관하세요.'); }
}
function applySearch(resetPage = true) {
  if (!data) return;
  if (resetPage) page = 1;
  const query = $('search').value.trim(), region = $('region').value, extra = $('extra-type').value;
  const candidates = suppliers.filter(c => c.currentTypes.length && (!region || c.region === region) && (!extra || c.currentTypes.includes(extra)))
    .map(c => ({c, hit: score(c, query, $('related').checked)})).filter(x => x.hit);
  $('type-tabs').innerHTML = TYPES.map((t,i) => `<button class="type-tab ${t === activeType ? 'active' : ''}" aria-pressed="${t === activeType}" data-type="${escapeHTML(t)}">${LABELS[i]} <span>${t && !data.coverage[t] ? '자료 미확보' : number(candidates.filter(x => !t || x.c.currentTypes.includes(t)).length)}</span></button>`).join('');
  matches = candidates.filter(x => !activeType || x.c.currentTypes.includes(activeType)).sort((a,b) => b.hit.score - a.hit.score || a.c.name.localeCompare(b.c.name, 'ko'));
  const pages = Math.max(1, Math.ceil(matches.length / 20)); page = Math.min(page, pages);
  $('result-title').textContent = activeType && !data.coverage[activeType] ? `${activeType} 자료 미확보` : `${query ? '“' + query + '” ' : ''}업체 ${number(matches.length)}곳`;
  $('result-context').textContent = `${region || '전국'} · ${activeType || '전체 유형'} · 공식 목록의 사업내용·생산품목 기준`;
  $('coverage-note').textContent = activeType && !data.coverage[activeType] ? `${activeType} 자격 근거 자료를 아직 확보하지 않았습니다. 다른 유형의 인증만으로 중소기업 여부를 추정하지 않습니다.` : activeType && !['사회적기업','중증장애인생산품 생산시설'].includes(activeType)
    ? `${activeType} 전체 명단 ${number(data.coverage[activeType].registryCount)}건 중 사업내용·품목을 확보한 ${number(data.coverage[activeType].searchableCount)}곳을 검색합니다. 전체 ${activeType}의 검색 결과가 아닙니다.`
    : '판매 품목이 구체적으로 기재되지 않은 업체는 사업내용을 보여드립니다. 자료 기준일 이후 변경 여부와 납품 가능 여부는 발주 전에 확인하세요.';
  $('results').innerHTML = matches.slice((page-1)*20, page*20).map(({c, hit}) => `<article class="supplier-card"><div><span class="region-tag">${escapeHTML(c.region || '지역 미기재')}</span><h3><button class="supplier-name" data-detail="${c.bizno}">${escapeHTML(c.name)}</button></h3><div class="badges">${c.currentTypes.map(badge).join('')}${c.excludedAsLargeCorp ? '<span class="badge warn">대기업 목록 중복 · 확인 필요</span>' : ''}</div><span class="match-label">${hit.label}</span><p class="description">${escapeHTML(c.items.length ? c.items.join(' · ') : c.business)}</p><p class="contact-line">${escapeHTML(contactValue(c,'representative') ? '대표자 ' + contactValue(c,'representative') : contactValue(c,'facilityHead') ? '생산시설장 ' + contactValue(c,'facilityHead') : '대표자 미기재')} · 사업자번호 ${c.bizno}</p><p class="contact-line">${escapeHTML(contactValue(c,'phone') || '연락처 미기재')}</p><p class="contact-line">${escapeHTML(contactValue(c,'address') || '상세주소 미기재')}</p></div><div class="supplier-actions"><button class="primary" data-add="${c.bizno}">검토목록에 담기 +</button><button class="secondary" data-detail="${c.bizno}">업체 상세·연락처</button></div></article>`).join('') || (activeType && !data.coverage[activeType] ? '<div class="empty"><h3>이 유형의 자료를 준비하고 있습니다</h3><p>업체가 없다는 뜻이 아닙니다. 확인된 자격 자료를 확보하면 검색에 반영합니다.</p></div>' : '<div class="empty"><h3>일치하는 업체가 없습니다</h3><p>짧은 물품명으로 검색하거나, 관련 업종까지 보기·다른 유형·전국 조건으로 넓혀보세요.</p></div>');
  $('page-label').textContent = `${page} / ${pages}`; $('prev').disabled = page === 1; $('next').disabled = page >= pages; $('export-results').disabled = !matches.length;
}
function detail(code) {
  const c = suppliers.find(c => c.bizno === code); if (!c) return;
  const row = (label, value) => `<tr><th>${label}</th><td>${escapeHTML(value || '미기재')}</td></tr>`;
  $('supplier-detail').innerHTML = `<p class="eyebrow">업체 정보 · 사업자번호 ${c.bizno}</p><h2>${escapeHTML(c.name)}</h2><div class="badges">${c.currentTypes.map(badge).join('')}</div><table>${row('생산품목', c.items.join(', '))}${row('사업내용',c.business)}${row('업종',c.industries.join(' / '))}${row('인증번호',c.certificationNo)}${row('본점·지점',c.branch)}</table><h3>공개 사업장 정보</h3>${(c.contacts || []).map(contact => `<p class="local-note">${escapeHTML(sourceLabel(contact.source))}${contact.type ? ' · ' + escapeHTML(contact.type) : ''}</p><table>${contact.representative ? row('대표자',contact.representative) : ''}${contact.facilityHead ? row('생산시설장',contact.facilityHead) : ''}${contact.phone ? row('사업장 연락처',contact.phone) : ''}${contact.address ? row('사업장 상세주소',contact.address) : ''}</table>`).join('')}<p>${c.website && /^https?:\/\//.test(c.website) ? `<a href="${escapeHTML(c.website)}" target="_blank" rel="noopener noreferrer">업체 홈페이지 ↗</a>` : '홈페이지 미기재'}</p><h3>유형별 근거</h3>${c.evidence.map(e => `<p><b>${escapeHTML(e.type)}</b><br>${escapeHTML(sourceLabel(e.source))} · 기준일 ${escapeHTML(data.sources[e.source]?.basisDate)}<br>기간: ${escapeHTML(e.validFrom || '시작일 미기재')} ~ ${escapeHTML(e.validUntil || '종료일 미기재')}${e.validUntil && !c.currentTypes.includes(e.type) ? ' · 기간 경과' : ''}</p>`).join('')}<p class="local-note">종료일 미기재는 현재 유효하다는 보증이 아닙니다. 공고 확인과 발주 전 증빙 확인이 필요합니다.</p>${c.excludedAsLargeCorp ? '<p>대기업·상호출자 목록에도 기재되어 있습니다. 우대 적용 가능 여부를 별도 확인하세요.</p>' : ''}<button class="primary" data-add="${c.bizno}">검토목록에 담기 +</button>`;
  $('supplier-dialog').showModal();
}
function addReview(code) {
  const c = suppliers.find(c => c.bizno === code); if (!c) return;
  const now = new Date(), month = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const item = $('search').value.trim() || '', type = activeType || c.currentTypes[0];
  if (reviews.some(r => r.bizno === code && r.item === item && r.month === month && r.type === type)) { toast('같은 구매 후보가 이미 담겨 있습니다.'); return; }
  reviews.push({id: crypto.randomUUID(), bizno:code, name:c.name, item, month, type}); persist(); renderReviews(); toast('검토목록에 담았습니다. 구매 월과 유형을 정리하세요.');
}
function renderReviews() {
  $('saved-count').textContent = reviews.length; $('export-review').disabled = !reviews.length;
  const counts = new Map(); reviews.forEach(r => { const k = `${r.month || '월 미정'} · ${r.type || '유형 미정'}`; counts.set(k,(counts.get(k)||0)+1); });
  $('review-summary').textContent = [...counts].sort().map(([k,v]) => `${k}: ${v}건`).join(' / ');
  $('review-list').innerHTML = (storageError ? '<p>이 브라우저의 이전 저장 내용을 읽지 못했거나 저장 공간에 문제가 있습니다. 현재 목록은 CSV로 보관하세요.</p>' : '') + (reviews.map(r => {
    const c = suppliers.find(c => c.bizno === r.bizno), types = [...new Set([...(c?.currentTypes || []), r.type].filter(Boolean))];
    return `<div class="review-row" data-review="${escapeHTML(r.id)}"><label>요청 품목<input data-field="item" value="${escapeHTML(r.item)}" placeholder="구매할 물품·서비스"></label><div><strong>${escapeHTML(c?.name || r.name)}</strong><small>${escapeHTML(r.bizno)}</small></div><label>구매 예정 월<input type="month" data-field="month" value="${escapeHTML(r.month)}"></label><label>배분 유형<select data-field="type">${types.map(t => `<option ${t === r.type ? 'selected' : ''}>${escapeHTML(t)}</option>`).join('')}</select></label><button class="remove" data-remove="${escapeHTML(r.id)}" aria-label="후보 삭제">×</button></div>`;
  }).join('') || '<div class="empty">검색 결과에서 구매 후보를 담아보세요.</div>');
}
function csvCell(value) { let s = String(value ?? ''); if (/^[=+@\-\t\r\n]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g,'""') + '"'; }
function download(rows, filename) {
  const blob = new Blob(['\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
const companyCells = c => [c.name,c.bizno,c.currentTypes.join(' / '),c.region,contactValue(c,'representative'),contactValue(c,'facilityHead'),contactValue(c,'phone'),contactValue(c,'address'),c.items.join(' / '),c.business,c.website];
const headers = ['업체명','사업자등록번호','기업유형','지역','대표자','생산시설장','사업장 연락처','사업장 상세주소','생산품목','사업내용','홈페이지'];
document.addEventListener('click', event => {
  const b = event.target.closest('button'); if (!b) return;
  if (b.hasAttribute('data-query')) { $('search').value = b.dataset.query; applySearch(); }
  if (b.hasAttribute('data-type')) { activeType = b.dataset.type; applySearch(); }
  if (b.dataset.detail) detail(b.dataset.detail);
  if (b.dataset.add) addReview(b.dataset.add);
  if (b.dataset.remove) { reviews = reviews.filter(r => r.id !== b.dataset.remove); persist(); renderReviews(); }
});
$('review-list').addEventListener('change', event => {
  const field = event.target.dataset.field, id = event.target.closest('[data-review]')?.dataset.review;
  const r = reviews.find(r => r.id === id); if (!r || !['item','month','type'].includes(field)) return;
  r[field] = event.target.value; persist(); renderReviews();
});
$('search-form').addEventListener('submit', event => { event.preventDefault(); applySearch(); });
['region','extra-type','related'].forEach(id => $(id).addEventListener('change', () => applySearch()));
$('reset').onclick = () => { $('search').value = ''; $('region').value = ''; $('extra-type').value = ''; $('related').checked = false; activeType = ''; applySearch(); };
$('prev').onclick = () => { page--; applySearch(false); $('search-section').scrollIntoView(); };
$('next').onclick = () => { page++; applySearch(false); $('search-section').scrollIntoView(); };
$('close-dialog').onclick = () => $('supplier-dialog').close();
$('export-results').onclick = () => download([headers, ...matches.map(({c}) => companyCells(c))], '구매이음-업체검색.csv');
$('export-review').onclick = () => download([['요청 품목','구매 예정 월','배분 유형',...headers], ...reviews.map(r => { const c = suppliers.find(c => c.bizno === r.bizno); return [r.item,r.month,r.type,...(c ? companyCells(c) : [r.name,r.bizno])]; })], '구매이음-검토목록.csv');
async function init() {
  try {
    const response = await fetch('./data/directory.json'); if (!response.ok) throw Error('HTTP ' + response.status);
    data = await response.json(); if (data.schemaVersion !== 1 || !Array.isArray(data.suppliers)) throw Error('자료 형식 오류');
    $('extra-type').innerHTML = '<option value="">선택 안 함</option>' + TYPES.slice(1).map((t,i) => `<option value="${escapeHTML(t)}" ${!data.coverage[t] ? 'disabled' : ''}>${LABELS[i+1]}${!data.coverage[t] ? ' (자료 미확보)' : ''}</option>`).join('');
    suppliers = data.suppliers.map(c => ({...c,currentTypes:typesOf(c)}));
    $('region').insertAdjacentHTML('beforeend', [...new Set(suppliers.map(c => c.region).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ko')).map(r => `<option>${escapeHTML(r)}</option>`).join(''));
    $('source-status').textContent = `${number(suppliers.length)}개 사업장 · 자료 기준 2026.06 ~ 07`;
    $('source-details').innerHTML = Object.entries(data.sources).map(([k,s]) => `<p><b>${escapeHTML(s.label)}</b> · 기준일 ${escapeHTML(s.basisDate)}${s.url ? ` · <a href="${escapeHTML(s.url)}" target="_blank" rel="noopener">원본 공고 ↗</a>` : ` · ${escapeHTML(s.file)}`}</p>`).join('') + `<p>명단 기간 대조일: ${escapeHTML(data.checkDate)}. 종료일이 지난 유형은 화면에서 제외합니다. 명단의 자동 갱신은 아직 제공하지 않습니다.</p><table><thead><tr><th>유형</th><th>명단 대조 건수</th><th>검색 가능 사업장</th></tr></thead><tbody>${Object.entries(data.coverage).map(([t,c]) => `<tr><td>${escapeHTML(t)}</td><td>${number(c.registryCount)}</td><td>${number(c.searchableCount)}</td></tr>`).join('')}</tbody></table><p>유형별 중복 포함. 사회적기업 명단은 본점·지점을 각각 포함합니다.</p>`;
    $('search').value = new URLSearchParams(location.search).get('q') || ''; applySearch(); renderReviews();
  } catch (error) { $('result-title').textContent = '업체 자료를 불러오지 못했습니다'; $('result-context').textContent = '잠시 후 새로고침해 주세요. (' + error.message + ')'; }
}
init();
