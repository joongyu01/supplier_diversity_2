"""Join product evidence to the registry strictly by business registration number."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def join_offers(offers, registry):
    businesses = {}
    for offer in offers:
        code = offer.get('bizno', '')
        row = registry.get(code)
        key = code or offer['id']
        if key not in businesses:
            businesses[key] = {'bizno': code, 'name': row[1] if row and row[1] else offer['supplier'],
                               'masks': row[2:7] if row else [0] * 5, 'offers': []}
        businesses[key]['offers'].append(offer)
    return sorted(businesses.values(), key=lambda b: (not bool(b['masks'][0]), b['name'], b['bizno']))


def main():
    path = ROOT / 'data/offers'
    offers = [json.loads(line) for line in (path / 'public-offers.jsonl').read_text(encoding='utf-8').splitlines() if line]
    if not offers:
        raise ValueError('Empty collection; existing published file preserved')
    if len({r['id'] for r in offers}) != len(offers):
        raise ValueError('Duplicate source product IDs')
    wanted = {r['bizno'] for r in offers if r['bizno']}
    registry = {}
    for part in sorted((ROOT / 'site/data/registry').glob('index-*.json')):
        for row in json.loads(part.read_text(encoding='utf-8')):
            if row[0] in wanted:
                registry[row[0]] = row
    businesses = join_offers(offers, registry)
    report = json.loads((path / 'collection-report.json').read_text(encoding='utf-8'))
    manifest = json.loads((ROOT / 'site/data/registry/manifest.json').read_text(encoding='utf-8'))
    report.update({'registryBuiltAt': manifest['builtAt'], 'registryTotal': manifest['total'],
                   'matchedBusinesses': len(registry), 'matchedProducts': sum(bool(registry.get(r['bizno'])) for r in offers),
                   'unmatchedProducts': sum(not bool(registry.get(r['bizno'])) for r in offers),
                   'businessesWithUnverifiedIdentity': sum(not bool(b['bizno']) for b in businesses),
                   'byType': {label: sum(bool(b['masks'][0] & (1 << i)) for b in businesses) for i, label in enumerate(manifest['labels'])}})
    data = {'labels': manifest['labels'], 'report': report, 'businesses': businesses}
    (ROOT / 'site/data/offers.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    (path / 'join-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ('coverage','failures')}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
