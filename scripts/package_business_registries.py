"""Reconcile registry exports to source CSVs and package the acquired lists."""
import csv
import json
import re
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/registries'

def run():
    manifest = json.loads((OUT / 'manifest.json').read_text(encoding='utf-8'))
    asof = manifest['types']['sme']['observedAt']
    all_codes = set()
    expected_memberships = Counter()
    sme_rows = set()
    counts = {}
    for kind, info in manifest['types'].items():
        codes = set()
        with (OUT / info['file']).open(encoding='utf-8') as f:
            for line in f:
                c = json.loads(line)
                code = c['bizno']
                assert re.fullmatch(r'\d{10}', code)
                assert code not in codes
                codes.add(code)
                expected_memberships[(code, info['label'])] += 1
                if kind == 'sme':
                    for r in c['records']:
                        sme_rows.add((r['sourceFile'], r['row'], code, r['name'], r['phone'],
                                      r['validFrom'].replace('-', ''), r['validUntil'].replace('-', '')))
        assert len(codes) == info['uniqueBusinessNumbers']
        counts[kind] = len(codes)
        all_codes.update(codes)
    actual_memberships = Counter()
    master_codes = set()
    with (OUT / 'businesses.jsonl').open(encoding='utf-8') as f:
        for line in f:
            m = json.loads(line)
            assert m['bizno'] not in master_codes
            master_codes.add(m['bizno'])
            for t in m['types']:
                actual_memberships[(m['bizno'], t['type'])] += 1
    assert master_codes == all_codes
    assert actual_memberships == expected_memberships
    assert len(master_codes) == manifest['uniqueBusinessNumbers']
    raw_rows = set()
    for info in manifest['types']['sme']['downloads']:
        path = ROOT / 'private/sources/smpp' / asof / info['file']
        with path.open(encoding='cp949', newline='') as f:
            rows = list(csv.reader(f))
        assert len(rows) - 1 == info['rows']
        for n, r in enumerate(rows[1:], 2):
            raw_rows.add((path.name, n, r[3], r[4].strip(), r[5].strip(), r[1], r[2]))
    assert raw_rows == sme_rows, 'Source row, business number, name, phone, or dates changed'
    sme = manifest['types']['sme']
    assert len(raw_rows) == sme['sourceRows']
    report = dict(checkedAt=asof, sourceRowsMatched=len(raw_rows),
                  allRegistryMembershipsMatched=True, combinedUnique=len(all_codes),
                  uniqueByType=counts, uncollectedSourceRows=sme['uncollectedSourceRows'])
    (OUT / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    table = '\n'.join(f"| {v['label']} | {v['uniqueBusinessNumbers']:,} | {v.get('observedAt', '기존 원본 기준')} |" for v in manifest['types'].values())
    readme = f'''# 우선구매 대상 사업장 명단

사업자번호 기준 통합 **{len(all_codes):,}개**. 한 사업자가 여러 유형에 해당할 수 있습니다.

| 유형 | 고유 사업자번호 | 확인 기준 |
|---|---:|---|
{table}

## 중소기업 확보 범위

- SMPP 조회일: {asof}. 공공기관 입찰용 확인서, 유효 필터.
- 전국 조회 {sme['publicListTotalObserved']:,}건 중 CSV {sme['sourceRows']:,}건 확보.
- 중복 제거 후 {sme['uniqueBusinessNumbers']:,}개 사업자번호.
- **미확보 {sme['uncollectedSourceRows']:,}건**. 소상공인 전국 조회와 화면에서 선택 가능한 모든 시도의 합계가 다릅니다. 원인은 미확인입니다.
- 중기업·소기업은 전국 전체, 소상공인은 16개 시도 선택지를 각각 다운로드했습니다.
- 전화번호 수록 사업자 {sme['businessesWithPhone']:,}개. 원본 업체명 공란 {sme['sourceRowsWithMissingName']:,}행은 번호와 함께 보존했습니다.
- 대표자명·상세주소는 이 CSV가 제공하지 않습니다. 기존 7개 유형 원본에 있는 값은 각 유형 파일에 유지했습니다.
- 출처: https://www.smpp.go.kr/cop/middlsslentrschtwr/selectMiddlSslentrSchtwrListVw.do

## 파일과 상태

`businesses.jsonl`은 사업자번호와 유형을 연결하는 통합 색인입니다. 각 유형의 JSONL에는 출처별 원본 기록, 공개 연락처, 유효기간이 있습니다. `manifest.json`에는 원본 기준일·해시·건수, `verification.json`에는 대조 결과가 있습니다.

기존 7개 유형은 2026-06-30 정부권장정책 자료와 2026-07-14 사회적기업 자료를 사용합니다. 과거·만료·취소 이력도 보존하므로 통합 건수를 현재 유효한 기업 수로 해석하면 안 됩니다. `within_recorded_period`는 해당 자료의 기록된 기간 기준이며 실시간 인증 확인 결과가 아닙니다.

제품·판매품목·가격·제품별 인증은 수집하지 않았습니다. 동명 회사는 합치지 않고 사업자번호로만 연결했습니다.
'''
    (OUT / 'README.md').write_text(readme, encoding='utf-8')
    dest = ROOT / 'data' / f'business-registries-{asof}.zip'
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for path in sorted(OUT.iterdir()):
            if path.suffix in ('.jsonl', '.json', '.md'):
                z.write(path, 'registries/' + path.name)
    print(json.dumps(dict(report, zip=str(dest), bytes=dest.stat().st_size), ensure_ascii=True))

if __name__ == '__main__':
    run()
