'use strict';
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),num=n=>n.toLocaleString('ko-KR');
const worker=new Worker('./registry-worker.js');let manifest,type=-1,page=1,request=0,detailRequest=0;
const cache=new Map(),statuses={within_recorded_period:'기록된 기간 내',listed_date_unknown:'기간 정보 부족',expired:'기간 만료',not_started:'시작 전',cancelled:'취소·반납 기록',source_cancelled:'원본 취소 기록',source_date_mismatch:'날짜 확인 필요'};
const sourceName=k=>({smpp:'SMPP 중소기업 확인서',policy:'정부권장정책 사업장 명단',social:'인증 사회적기업 누적 명단'}[k]||k);
function query(reset=true){if(!manifest)return;if(reset)page=1;worker.postMessage({action:'search',id:++request,query:$('search').value,type,extra:Number($('extra').value),status:$('status').value,page});$('result-context').textContent='검색 중…';}
function badges(r){return manifest.labels.map((t,i)=>{const bit=1<<i;if(!(r[2]&bit))return '';const cls=r[3]&bit?'period':r[4]&bit?'unknown':r[6]&bit?'cancelled':'expired';return `<span class="status-badge ${cls}">${esc(t)} · ${{period:'기간 내',unknown:'기간 정보 부족',cancelled:'취소 기록',expired:'기간 확인 필요'}[cls]}</span>`;}).join('');}
worker.onmessage=({data:d})=>{
 if(d.action==='progress'){$('result-context').textContent=`명단 ${d.done}/${d.total} 묶음 로딩 중`;return;}
 if(d.action==='error'){$('result-title').textContent='명단을 불러오지 못했습니다';$('result-context').textContent=d.message+' · 새로고침해 주세요.';return;}
 if(d.action==='ready'){
  manifest=d.manifest;for(const id of ['search','search-button','status','extra','reset'])$(id).disabled=false;
  $('extra').innerHTML='<option value="-1">선택 안 함</option>'+manifest.labels.map((s,i)=>`<option value="${i}">${esc(s)}</option>`).join('');
  $('source-status').textContent=`${num(manifest.total)}개 사업자 · 기간 대조 ${manifest.builtAt}`;
  const sm=manifest.coverage.sme;$('coverage-note').textContent=`중소기업은 SMPP ${sm.observedAt} 전국 조회 ${num(sm.publicListTotalObserved)}건 중 ${num(sm.sourceRows)}건을 확보했습니다. 미확보 ${num(sm.uncollectedSourceRows)}건이 있으며, 통합 명단은 과거·만료·취소 이력을 포함합니다.`;
  $('source-details').innerHTML='<table><thead><tr><th>유형</th><th>고유 사업자번호</th><th>원본 기준일</th></tr></thead><tbody>'+manifest.kinds.map((k,i)=>`<tr><td>${esc(manifest.labels[i])}</td><td>${num(manifest.coverage[k].uniqueBusinessNumbers)}</td><td>${esc(k==='sme'?sm.observedAt:k==='social'?manifest.sources.social.basisDate:manifest.sources.policy.basisDate)}</td></tr>`).join('')+'</tbody></table>'+Object.entries(manifest.sources).map(([k,s])=>`<p>${esc(sourceName(k))} · ${esc(s.basisDate)} ${s.url&&/^https:\/\//.test(s.url)?`<a href="${esc(s.url)}" target="_blank" rel="noopener">출처 ↗</a>`:''}</p>`).join('');
  $('search').value=new URLSearchParams(location.search).get('q')||'';query();return;
 }
 if(d.action==='results'&&d.id===request){
  page=d.page;$('type-tabs').innerHTML=[`<button class="type-tab ${type<0?'active':''}" data-type="-1" aria-pressed="${type<0}">전체 유형</button>`,...manifest.labels.map((t,i)=>`<button class="type-tab ${type===i?'active':''}" data-type="${i}" aria-pressed="${type===i}">${esc(t)}<span>${num(d.counts[i])}</span></button>`)].join('');
  $('result-title').textContent=`사업장 ${num(d.total)}곳`;$('result-context').textContent=`${type<0?'전체 유형':manifest.labels[type]} · ${$('status').selectedOptions[0].text} · 사업자번호 순`;
  $('results').innerHTML=d.rows.map(r=>`<article class="supplier-card"><div><h3><button class="supplier-name" data-detail="${r[0]}">${esc(r[1]||'업체명 미기재')}</button></h3><p class="contact-line">사업자번호 ${r[0].replace(/(\d{3})(\d{2})(\d{5})/,'$1-$2-$3')}</p><div>${badges(r)}</div></div><div class="supplier-actions"><button class="secondary" data-detail="${r[0]}">연락처·주소·인증 이력</button></div></article>`).join('')||'<div class="empty">일치하는 사업장이 없습니다. 업체명 일부나 사업자번호로 다시 검색해 보세요.</div>';
  $('page-label').textContent=`${num(page)} / ${num(d.pages)}`;$('prev').disabled=page<=1;$('next').disabled=page>=d.pages;
 }
};
async function details(code){
 const id=++detailRequest;$('supplier-detail').innerHTML='<p>사업장 근거와 연락처를 불러오는 중입니다.</p>';if(!$('supplier-dialog').open)$('supplier-dialog').showModal();
 try{const shard=code.slice(-2);if(!cache.has(shard)){const promise=fetch(`./data/registry/detail-${shard}.json`).then(r=>{if(!r.ok)throw Error('상세 파일을 받지 못했습니다');return r.json();});cache.set(shard,promise);promise.catch(()=>cache.delete(shard));}
  const c=(await cache.get(shard))[code];if(id!==detailRequest)return;if(!c)throw Error('상세 기록이 없습니다');
  const row=(k,v)=>`<tr><th>${k}</th><td>${esc(v||'원본 미기재')}</td></tr>`;
  $('supplier-detail').innerHTML=`<p class="eyebrow">사업자번호 ${code}</p><h2>${esc(c.names[0]||'업체명 미기재')}</h2>${c.names.length>1?`<p>원본의 다른 업체명: ${esc(c.names.slice(1).join(' / '))}</p>`:''}<p class="local-note">같은 사업자번호의 유형별 원본 기록입니다. 연락처와 주소가 다르면 각 출처의 기준일을 확인하세요.</p>`+c.records.map(r=>{const s=manifest.sources[r[1]];return `<section class="record"><h3>${esc(manifest.labels[r[0]])} · ${esc(statuses[r[9]]||r[9])}</h3><p>${esc(sourceName(r[1]))} · 기준일 ${esc(s?.basisDate)}${s?.url&&/^https:\/\//.test(s.url)?` · <a class="source-link" href="${esc(s.url)}" target="_blank" rel="noopener">원본 출처 ↗</a>`:''}</p><table>${row('원본 업체명',r[2])}${row('대표자',r[3])}${r[10]?row('생산시설장',r[10]):''}${row('사업장 연락처',r[4])}${row('사업장 상세주소',r[5])}${row('시작일',r[6])}${row('종료일',r[7])}${r[8]?row('취소일',r[8]):''}</table></section>`;}).join('');
 }catch(e){if(id===detailRequest)$('supplier-detail').innerHTML=`<p class="detail-error">${esc(e.message)}. 창을 닫고 다시 열어주세요.</p>`;}
}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-type')){type=Number(b.dataset.type);query();}if(b.dataset.detail)details(b.dataset.detail);});
$('search-form').onsubmit=e=>{e.preventDefault();query();};for(const id of ['status','extra'])$(id).onchange=()=>query();
$('reset').onclick=()=>{$('search').value='';$('status').value='all';$('extra').value='-1';type=-1;query();};
$('prev').onclick=()=>{page--;query(false);};$('next').onclick=()=>{page++;query(false);};$('close-dialog').onclick=()=>{detailRequest++;$('supplier-dialog').close();};
worker.onerror=()=>{$('result-title').textContent='검색 기능을 시작하지 못했습니다';$('result-context').textContent='새로고침 후 다시 시도해 주세요.';};worker.postMessage({action:'load'});
