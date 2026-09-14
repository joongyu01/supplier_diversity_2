"""Import official SMPP CSV exports; reconcile coverage without name-only joins."""
import argparse
import csv
import datetime as dt
import hashlib
import json
import re
import shutil
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://www.smpp.go.kr/cop/middlsslentrschtwr/selectMiddlSslentrSchtwrListVw.do'
HEADERS = ['인증기관', '인증일', '마감일', '사업자등록번호', '업체명', '전화번호', '기업규모', '경쟁입찰참여제한']

def write_jsonl(path, rows):
    temp = path.with_suffix('.tmp')
    with temp.open('w', encoding='utf-8') as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n')
    temp.replace(path)

def import_exports(source, asof, expected):
    dt.date.fromisoformat(asof)
    out = ROOT / 'data/registries'
    archive = ROOT / 'private/sources/smpp' / asof
    archive.mkdir(parents=True, exist_ok=True)
    files = sorted(source.glob('중소기업확인서_*.csv'))
    # The small Jeju test overlaps the nationwide medium-business export.
    files = [p for p in files if p.name.endswith('_소상공인.csv') or p.name in
             ('중소기업확인서_전체_중기업.csv', '중소기업확인서_전체_소기업.csv')]
    if not files:
        raise ValueError('No source exports')
    companies = {}
    sources = []
    scales = Counter()
    raw_count = 0
    for path in files:
        count = 0
        with path.open(encoding='cp949', newline='') as f:
            reader = csv.reader(f)
            if next(reader) != HEADERS:
                raise ValueError(f'Unexpected CSV schema: {path.name}')
            for line, row in enumerate(reader, 2):
                if len(row) != 8:
                    raise ValueError(f'Column mismatch: {path.name}:{line}')
                agency, start, end, code, name, phone, scale, restricted = row
                if not re.fullmatch(r'\d{10}', code):
                    raise ValueError(f'Invalid business identity: {path.name}:{line}')
                start = dt.datetime.strptime(start, '%Y%m%d').date().isoformat()
                end = dt.datetime.strptime(end, '%Y%m%d').date().isoformat()
                if scale not in ('중기업', '소기업', '소상공인'):
                    raise ValueError(f'Unexpected scale: {scale}')
                status = 'within_recorded_period' if start <= asof <= end else 'source_date_mismatch'
                rec = dict(source='smpp', sourceFile=path.name, row=line, name=name.strip(),
                           representative='', address='', phone=phone.strip(),
                           validFrom=start, validUntil=end, cancelledAt=None,
                           status=status, checkedAt=asof, sourceUrl=URL,
                           issuingAgency=agency, businessScale=scale,
                           biddingRestriction=restricted, sourceValidityFilter='유효',
                           sourceNameMissing=not bool(name.strip()))
                company = companies.setdefault(code, dict(bizno=code, type='중소기업', records=[]))
                company['records'].append(rec)
                count += 1
                scales[scale] += 1
        saved = archive / path.name
        if saved.resolve() != path.resolve():
            shutil.copy2(path, saved)
        sources.append(dict(file=path.name, rows=count,
                            sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
        raw_count += count
    master = {}
    statuses = Counter()
    for c in companies.values():
        latest = max(c['records'], key=lambda r: (r['validFrom'], r['validUntil']))
        c.update(name=latest['name'], status=latest['status'])
        statuses[c['status']] += 1
    for path in sorted(out.glob('*.jsonl')):
        if path.name in ('businesses.jsonl', 'sme.jsonl'):
            continue
        with path.open(encoding='utf-8') as f:
            for line in f:
                c = json.loads(line)
                m = master.setdefault(c['bizno'], dict(bizno=c['bizno'], names=[], types=[]))
                for r in c['records']:
                    if r['name'] and r['name'] not in m['names']:
                        m['names'].append(r['name'])
                m['types'].append(dict(type=c['type'], status=c['status'], file=path.name))
    for code, c in companies.items():
        m = master.setdefault(code, dict(bizno=code, names=[], types=[]))
        for r in c['records']:
            if r['name'] and r['name'] not in m['names']:
                m['names'].append(r['name'])
        m['types'].append(dict(type='중소기업', status=c['status'], file='sme.jsonl'))
    manifest = json.loads((out / 'manifest.json').read_text(encoding='utf-8'))
    info = dict(label='중소기업', status='extracted' if raw_count == expected else 'extracted_partial',
                sourceRows=raw_count, uniqueBusinessNumbers=len(companies),
                duplicateBusinessNumberRows=raw_count-len(companies),
                sourceRowsWithMissingName=sum(not r['name'] for c in companies.values() for r in c['records']),
                businessesWithPhone=sum(any(r['phone'] for r in c['records']) for c in companies.values()),
                publicListTotalObserved=expected, uncollectedSourceRows=expected-raw_count,
                observedAt=asof, recordStatusCounts=dict(statuses), file='sme.jsonl', url=URL,
                rowsByBusinessScale=dict(scales), downloads=sources,
                note='SMPP public-institution bidding-purpose certificates, validity filter Y. '
                     'Regional small-business exports do not cover every nationwide result. '
                     'Source rows are not unique companies. No product or industry filter. '
                     'Other seven registry source dates and statuses remain unchanged.')
    if raw_count > expected:
        raise ValueError('Source total exceeded; check overlapping files before import')
    manifest['types']['sme'] = info
    manifest['sources']['smpp'] = dict(url=URL, basisDate=asof, scope='공공기관 입찰용, 유효 필터', files=sources)
    manifest['uniqueBusinessNumbers'] = len(master)
    manifest['updatedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
    write_jsonl(out / 'sme.jsonl', (companies[k] for k in sorted(companies)))
    write_jsonl(out / 'businesses.jsonl', (master[k] for k in sorted(master)))
    temp = out / 'manifest.tmp'
    temp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(out / 'manifest.json')
    print(json.dumps(dict(sourceRows=raw_count, smeUnique=len(companies),
                          combinedUnique=len(master), missing=expected-raw_count,
                          statusCounts=dict(statuses)), ensure_ascii=True))

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--as-of', required=True)
    p.add_argument('--expected', type=int, required=True)
    a = p.parse_args()
    import_exports(a.source, a.as_of, a.expected)
