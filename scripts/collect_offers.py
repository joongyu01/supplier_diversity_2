"""Public SEPP / goods.go.kr product evidence, resumable and rate limited.

Only collect public catalog fields. Never use portal footer business numbers.
The default is a disclosed first batch, not an exhaustive catalog snapshot.
Increase --sepp-pages / --goods-pages to extend coverage; --refresh refetches cache.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import re
import threading
import time
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'private/offer-cache'
OUT = ROOT / 'data/offers'
DAY = datetime.now().date().isoformat()
LOCK = threading.Lock()
NEXT = {}


def clean(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def bizno(s):
    value = re.sub(r'\D', '', s or '')
    return value if len(value) == 10 else ''


def fetch(url, refresh=False):
    key = hashlib.sha256(url.encode()).hexdigest()
    path = CACHE / (key + '.json')
    if path.exists() and not refresh:
        try:
            saved = json.loads(path.read_text(encoding='utf-8'))
            return BeautifulSoup(saved['html'], 'html.parser'), saved['observedAt']
        except (ValueError, KeyError):
            pass  # A partial cache write must not make every later retry fail.
    host = urlparse(url).hostname
    for attempt in range(3):
        with LOCK:
            wait = max(0, NEXT.get(host, 0) - time.monotonic())
            NEXT[host] = time.monotonic() + wait + .35
        time.sleep(wait)
        try:
            with urlopen(Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; SupplierDirectory/1.0)', 'Accept': 'text/html'}), timeout=35) as r:
                html = r.read().decode('utf-8')
            if '<html' not in html.lower() and '<form' not in html.lower():
                raise ValueError('Unexpected page format')
            CACHE.mkdir(parents=True, exist_ok=True)
            temp = CACHE / (key + f'.{threading.get_ident()}.tmp')
            temp.write_text(json.dumps({'url': url, 'observedAt': DAY, 'html': html}, ensure_ascii=False), encoding='utf-8')
            temp.replace(path)
            return BeautifulSoup(html, 'html.parser'), DAY
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def field_pairs(soup, kind):
    result = {}
    if kind == 'goods':
        for field in soup.select('.f_field'):
            key, val = field.select_one('.ff_title'), field.select_one('.ff_wrap')
            if key and val:
                result[clean(key.get_text(' ', strip=True))] = clean(val.get_text(' ', strip=True))
    else:
        for dt in soup.select('dt'):
            dd = dt.find_next_sibling('dd')
            if dd:
                result[clean(dt.get_text(' ', strip=True))] = clean(dd.get_text(' ', strip=True))
    return result


def goods_detail(code, refresh=False):
    url = f'https://www.goods.go.kr/pp/pd/product/view.do?goodsCode={code}&menuNo=1205000'
    soup, observed = fetch(url, refresh)
    f = field_pairs(soup, 'goods')
    if f.get('상품코드') != code or not f.get('상품명'):
        raise ValueError('Product identity missing or different')
    return {'id': 'goods:' + code, 'source': 'goods', 'title': f['상품명'],
            'category': f.get('상품 분류', ''), 'bizno': bizno(f.get('사업자등록번호')),
            'supplier': f.get('시설명', f.get('생산시설명', '')), 'phone': f.get('전화번호', ''),
            'address': f.get('주소', ''), 'url': url, 'observedAt': observed}


def sepp_detail(code, refresh=False):
    url = f'https://www.sepp.or.kr/goods/value/prdctDtl?goodsNo={code}'
    soup, observed = fetch(url, refresh)
    ld = soup.select_one('script[type="application/ld+json"]')
    product = json.loads(ld.get_text()) if ld else {}
    seller = soup.select_one('a[href*="/main/value/sclentIntrDtl?slrNo="]')
    if not product.get('name') or not seller:
        raise ValueError('Product name or seller link missing')
    sid = parse_qs(urlparse(seller['href']).query)['slrNo'][0]
    seller_url = 'https://www.sepp.or.kr/main/value/sclentIntrDtl?slrNo=' + sid
    seller_soup, seller_observed = fetch(seller_url, refresh)
    f = field_pairs(seller_soup, 'sepp')
    if not f.get('기업명'):
        raise ValueError('Seller page unavailable')
    return {'id': 'sepp:' + code, 'source': 'sepp', 'title': clean(product['name']),
            'category': '', 'bizno': bizno(f.get('사업자번호')), 'supplier': f['기업명'],
            'phone': f.get('대표번호', ''), 'address': f.get('주소', ''),
            'url': url, 'sellerUrl': seller_url, 'observedAt': observed,
            'sellerObservedAt': seller_observed}


def listing(soup, source):
    param = 'goodsNo' if source == 'sepp' else 'goodsCode'
    ids = []
    for a in soup.select(f'a[href*="{param}="]'):
        value = parse_qs(urlparse(a['href']).query).get(param, [''])[0]
        if value.isdigit() and value not in ids:
            ids.append(value)
    if source == 'sepp':
        total = soup.select_one('.total strong')
        total = int(total.get_text().replace(',', '')) if total else None
    else:
        m = re.search(r'총\s*([\d,]+)\s*개의', soup.get_text(' ', strip=True))
        total = int(m[1].replace(',', '')) if m else None
    if total is None or (total and not ids):
        raise ValueError('Catalog total or product links missing')
    return ids, total


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sepp-pages', type=int, default=50)
    parser.add_argument('--goods-pages', type=int, default=55)
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    groups = [('sepp', '가치장터 인기 상품', None),
              ('goods', '인쇄/광고', '1208000'), ('goods', '서비스', '1213000')]
    jobs, coverage, failures = {}, [], []
    for source, label, menu in groups:
        seed = 'https://www.sepp.or.kr/main/sclentIntrGdsLst' if source == 'sepp' else f'https://www.goods.go.kr/pp/index.do?menuNo={menu}'
        soup, observed = fetch(seed, args.refresh)
        ids, total = listing(soup, source)
        limit = args.sepp_pages if source == 'sepp' else args.goods_pages
        pages = min(limit, math.ceil(total / 10))
        if source == 'goods':
            category = soup.select_one('input[name="condition.goodsLclasCode"]')['value']
        urls = []
        for page in range(2, pages + 1):
            urls.append(f'{seed}?page={page}' if source == 'sepp' else
                        f'https://www.goods.go.kr/pp/pd/product/list.do?menuNo={menu}&condition.pageType=D&condition.goodsLclasCode={category}&maxPageItems=10&pagerOffset={(page-1)*10}')
        seen = set(ids)
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(fetch, u, args.refresh): u for u in urls}
            for future in as_completed(futures):
                try:
                    page_ids, _ = listing(future.result()[0], source)
                    seen.update(page_ids)
                except Exception as e:
                    failures.append({'source': source, 'url': futures[future], 'error': type(e).__name__})
        coverage.append({'source': source, 'label': label, 'url': seed, 'observedAt': observed,
                         'sourceTotal': total, 'pageLimit': limit, 'listedProducts': len(seen),
                         'scopeComplete': len(seen) == total})
        for code in sorted(seen):
            jobs[(source, code)] = code
        print(label, 'sourceTotal', total, 'selected', len(seen), flush=True)
    rows = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(sepp_detail if src == 'sepp' else goods_detail, code, args.refresh): (src, code)
                   for src, code in jobs}
        for i, future in enumerate(as_completed(futures), 1):
            src, code = futures[future]
            try:
                rows.append(future.result())
            except Exception as e:
                failures.append({'source': src, 'id': code, 'error': type(e).__name__})
            if i % 100 == 0:
                print('details', i, '/', len(jobs), 'failures', len(failures), flush=True)
    rows.sort(key=lambda x: x['id'])
    if not rows:
        raise RuntimeError('No valid products collected; previous output preserved')
    # Atomic replacement; caches preserve previous successful responses for retries.
    target = OUT / 'public-offers.jsonl'
    temp = target.with_suffix('.tmp')
    temp.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows), encoding='utf-8')
    temp.replace(target)
    report = {'builtAt': DAY, 'scope': 'first_batch', 'coverage': coverage, 'selectedProducts': len(jobs),
              'collectedProducts': len(rows), 'failures': failures}
    (OUT / 'collection-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k != 'coverage'}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
