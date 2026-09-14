'use strict';
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=n=>n.toLocaleString('ko-KR'),norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\-]/g,'');
const sources={sepp:'가치장터',goods:'꿈드래'};let data,page=1;
function badge(b){return data.labels.map((label,i)=>{const bit=1<<i;if(!(b.masks[0]&bit))return '';const state=b.masks[1]&bit?'period':b.masks[2]&bit?'unknown':b.masks[4]&bit?'cancelled':'expired';return `<span class="status-badge ${state}">${esc(label)} · ${{period:'기간 내',unknown:'기간 정보 부족',cancelled:'취소 기록',expired:'기간 확인 필요'}[state]}</span>`;}).join('')||'<span class="status-badge unknown">사업장 명단 미연결 · 유형 미확인</span>';}
function safeLink(url){try{const u=new URL(url);return u.protocol==='https:'&&['www.sepp.or.kr','www.goods.go.kr'].includes(u.hostname)?esc(u.href):'';}catch{return '';}}
function render(reset=true){
 if(!data)return;if(reset)page=1;renderCategoryButtons();
 const q=norm($('q').value),rawTerms=$('q').value.trim().split(/\s+/).map(norm).filter(Boolean),specific=rawTerms.filter(t=>!['제작','구매','주문','주문제작','납품'].includes(t)),terms=specific.length?specific:rawTerms,type=Number($('type').value),extra=Number($('extra').value),state=Number($('status').value),source=$('source').value;
 const score=o=>{const title=norm(o.title),needle=terms.join('');return !needle?0:title===needle?100:title.startsWith(needle)?70:terms.every(t=>title.includes(t))?40:10;};
 const results=[];
 for(const b of data.businesses){
  if(!b.masks[0]&&!$('pending').checked)continue;
  const mask=b.masks[state];if((state>0&&!mask)||(type>=0&&!(mask&(1<<type)))||(extra>=0&&!(mask&(1<<extra))))continue;
  const businessMatch=q&&norm(b.name+' '+b.bizno).includes(q);
  const offers=b.offers.filter(o=>(source==='all'||o.source===source)&&categoryMatches(o,$('category').value,$('subcategory').value)&&(!q||businessMatch||terms.every(t=>norm(o.title+' '+o.category+' '+o.supplier).includes(t))));
  if(offers.length){offers.sort((a,b)=>score(b)-score(a));results.push({b,offers,score:score(offers[0])});}
 }
 results.sort((a,b)=>b.score-a.score||a.b.name.localeCompare(b.b.name,'ko'));
 const group=PURCHASE_CATEGORIES.find(c=>c.id===$('category').value), selectedItem=group?.items.find(i=>i.id===$('subcategory').value);
 $('category-note').textContent=group?`${group.name}${selectedItem?' → '+selectedItem.name:''} · 공개 상품명의 관련 표현으로 연결합니다. 검색어와 사업장 유형을 추가하면 결과가 좁혀집니다.`:'분류는 탐색을 돕는 기준입니다. 실제 규격과 공급 가능 여부는 상품 원문에서 확인하세요.';
 const pages=Math.max(1,Math.ceil(results.length/15));page=Math.min(page,pages);
 $('title').textContent=`업체 ${num(results.length)}곳 · 상품·서비스 ${num(results.reduce((n,r)=>n+r.offers.length,0))}건`;
 $('context').textContent='상품명 일치 순 · 사업자번호로 업체 연결 · '+(terms.length<rawTerms.length?'제작·구매 등 주문 표현을 제외하고 검색합니다.':'상품 제목과 원본 분류를 검색합니다.');
 const item=o=>`<li><a href="${safeLink(o.url)}" target="_blank" rel="noopener">${esc(o.title)} ↗</a><small>${esc(sources[o.source])}${o.category?' · '+esc(o.category):''} · 확인 ${esc(o.observedAt)}</small></li>`;
 $('results').innerHTML=results.slice((page-1)*15,page*15).map(({b,offers})=>{
  const contacts=[...new Map(offers.map(o=>[[o.source,o.phone,o.address,o.supplier].join('|'),o])).values()];
  return `<article class="supplier-card offer-card"><h3>${esc(b.name||'업체명 미기재')}</h3><div>${badge(b)}</div><p class="source-note">사업자번호 ${esc(b.bizno||'원본 미기재')}${b.masks[0]?` · <a href="./?q=${encodeURIComponent(b.bizno)}#search-section">사업장 명단·인증 이력 →</a>`:''}</p><ul class="offer-list">${offers.slice(0,5).map(item).join('')}</ul>${offers.length>5?`<details><summary>일치하는 상품 ${num(offers.length-5)}건 더 보기</summary><ul class="offer-list">${offers.slice(5).map(item).join('')}</ul></details>`:''}<details><summary>사업장 연락처·주소 보기</summary>${contacts.map(o=>`<p class="offer-contact"><strong>${esc(o.supplier)}</strong> · ${esc(sources[o.source])}<span>전화 ${esc(o.phone||'원본 미기재')}</span><span>주소 ${esc(o.address||'원본 미기재')}</span><a href="${safeLink(o.sellerUrl||o.url)}" target="_blank" rel="noopener">연락처 출처 ↗</a></p>`).join('')}</details></article>`;
 }).join('')||'<div class="offer-empty">수집된 판매정보에서 일치하는 업체를 찾지 못했습니다. 검색어를 짧게 바꾸거나 유형·기간 조건을 조정해 보세요. 해당 품목의 판매업체가 없다는 뜻은 아닙니다.</div>';
 $('page-label').textContent=`${page} / ${pages}`;$('prev').disabled=page<=1;$('next').disabled=page>=pages;
 const params=new URLSearchParams();if($('category').value)params.set('category',$('category').value);if($('subcategory').value)params.set('item',$('subcategory').value);if($('q').value)params.set('q',$('q').value);history.replaceState(null,'',location.pathname+(params.size?'?'+params.toString():''));
}
async function load(){try{
 const r=await fetch('./data/offers.json');if(!r.ok)throw Error('판매정보 파일을 받지 못했습니다');data=await r.json();
 const p=data.report;$('summary').textContent=`연결 업체 ${num(p.matchedBusinesses)}곳 · 연결 상품 ${num(p.matchedProducts)}건`;
 $('coverage').textContent=`${p.builtAt} 1차 수집: ${num(p.collectedProducts)}개 상품·서비스. 기존 명단에 연결되지 않은 ${num(p.unmatchedProducts)}건은 기본 검색에서 제외합니다. 전체 44만 업체의 판매품목을 확보한 것은 아닙니다.`;
 for(const id of ['q','submit','type','extra','status','source','pending','reset','category','subcategory','category-search'])$(id).disabled=false;
 for(const id of ['type','extra'])$(id).innerHTML=`<option value="-1">${id==='type'?'전체 유형':'선택 안 함'}</option>`+data.labels.map((l,i)=>`<option value="${i}">${esc(l)}</option>`).join('');
 $('source-details').innerHTML=`<p>명단 기준일 ${esc(p.registryBuiltAt)} · 수집 오류 ${p.failures.length}건 · 사업자번호 미확인 판매자 ${p.businessesWithUnverifiedIdentity}곳</p><table><thead><tr><th>수집 범위</th><th>원본 목록</th><th>이번 수집 대상</th><th>목록 확보</th></tr></thead><tbody>${p.coverage.map(c=>`<tr><td><a href="${safeLink(c.url)}" target="_blank" rel="noopener">${esc(c.label)} ↗</a></td><td>${num(c.sourceTotal)}</td><td>${num(c.listedProducts)}</td><td>${c.scopeComplete?'해당 범위 전체':'일부'}</td></tr>`).join('')}</tbody></table><p>상품별 확인일은 원문을 실제 수집한 날짜입니다. 수집 범위 밖의 상품·업체는 결과에 포함되지 않을 수 있습니다.</p>`;
 const params=new URLSearchParams(location.search);
 $('category').innerHTML='<option value="">전체 구매군</option>'+PURCHASE_CATEGORIES.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
 $('category').value=PURCHASE_CATEGORIES.some(c=>c.id===params.get('category'))?params.get('category'):'';updateSubcategories();
 const selected=PURCHASE_CATEGORIES.find(c=>c.id===$('category').value);if(selected?.items.some(i=>i.id===params.get('item')))$('subcategory').value=params.get('item');
 $('q').value=params.get('q')||'';render();
 }catch(e){$('title').textContent='판매정보를 불러오지 못했습니다';$('coverage').textContent=e.message+' · 새로고침해 주세요.';}}
function renderCategoryButtons(){
 const query=norm($('category-search').value), selected=$('category').value, item=$('subcategory').value;
 const matches=i=>norm(i.name+' '+i.terms.join(' ')).includes(query);
 const groups=PURCHASE_CATEGORIES.filter(c=>!query||norm(c.name).includes(query)||c.items.some(matches));
 const button=(label,group,leaf,active)=>`<button type="button" data-group="${group}" data-item="${leaf}" aria-pressed="${active}">${esc(label)}</button>`;
 $('category-buttons').innerHTML=button('전체 구매군','','',!selected)+groups.map(c=>button(c.name,c.id,'',selected===c.id)).join('');
 const shown=query?groups:PURCHASE_CATEGORIES.filter(c=>c.id===selected);
 $('subcategory-buttons').innerHTML=shown.map(c=>`<div class="subcategory-section"><h3>${esc(c.name)} · 세부품목</h3><div class="category-buttons">${!query?button('전체 세부품목',c.id,'',!item):''}${c.items.filter(i=>!query||norm(c.name).includes(query)||matches(i)).map(i=>button(i.name,c.id,i.id,selected===c.id&&item===i.id)).join('')}</div></div>`).join('');
 $('category-search-status').textContent=query&&!groups.length?'일치하는 분류가 없습니다. 다른 분류명으로 검색하거나 아래 상품·업체 검색을 이용하세요.':'';
}
$('category-search').oninput=()=>renderCategoryButtons();
for(const id of ['category-buttons','subcategory-buttons'])$(id).onclick=e=>{
 const b=e.target.closest('button[data-group]');if(!b||!data)return;
 const group=b.dataset.group,item=b.dataset.item;
 $('category').value=group;updateSubcategories();$('subcategory').value=item;render();
 $(id).querySelector(`button[data-group="${group}"][data-item="${item}"]`)?.focus();
};
function updateSubcategories(){
 const group=PURCHASE_CATEGORIES.find(c=>c.id===$('category').value);
 $('subcategory').innerHTML='<option value="">전체 세부품목</option>'+(group?group.items.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join(''):'');
 $('subcategory').disabled=!group;
}
$('category').onchange=()=>{updateSubcategories();render();};$('subcategory').onchange=()=>render();
$('offer-search').onsubmit=e=>{e.preventDefault();render();};for(const id of ['type','extra','status','source','pending'])$(id).onchange=()=>render();
document.addEventListener('click',e=>{const b=e.target.closest('[data-query]');if(b&&data){$('category').value='';updateSubcategories();$('q').value=b.dataset.query;render();}});
$('reset').onclick=()=>{$('category-search').value='';$('category').value='';updateSubcategories();$('q').value='';$('type').value=$('extra').value='-1';$('status').value='0';$('source').value='all';$('pending').checked=false;render();};
$('prev').onclick=()=>{page--;render(false);};$('next').onclick=()=>{page++;render(false);};load();
