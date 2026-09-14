"""Publish a compact searchable index and on-demand business evidence shards."""
import datetime as dt
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/registries'
DEST = ROOT / 'site/data/registry'
KINDS = ['sme','women','disabled','startup','severe','standard','social','cooperative']

def run():
    manifest = json.loads((SOURCE/'manifest.json').read_text(encoding='utf-8'))
    today = dt.date.today().isoformat()
    companies = {}
    for k, kind in enumerate(KINDS):
        with (SOURCE/(kind+'.jsonl')).open(encoding='utf-8') as f:
            for line in f:
                c = json.loads(line)
                dst = companies.setdefault(c['bizno'], {'names':[], 'records':[]})
                for r in c['records']:
                    if r['name'] and r['name'] not in dst['names']:
                        dst['names'].append(r['name'])
                    state = r['status']
                    if state not in ('source_cancelled','cancelled'):
                        if r.get('validFrom') and r['validFrom'] > today: state='not_started'
                        elif r.get('validUntil') and r['validUntil'] < today: state='expired'
                    dst['records'].append([k,r['source'],r['name'],r.get('representative',''),
                        r.get('phone',''),r.get('address',''),r.get('validFrom'),r.get('validUntil'),
                        r.get('cancelledAt'),state,r.get('facilityHead',''),
                        r.get('sourceFile') or r.get('sheet',''),r.get('row')])
    DEST.mkdir(parents=True,exist_ok=True)
    shards = [{} for _ in range(100)]
    indexes = [[] for _ in range(16)]
    for n,(code,c) in enumerate(sorted(companies.items())):
        masks=[0,0,0,0,0]
        for k in range(8):
            records=[r for r in c['records'] if r[0]==k]
            if not records: continue
            masks[0] |= 1<<k
            started=[r for r in records if not r[6] or r[6]<=today]
            latest=max(started or records,key=lambda r:(r[6] or '',r[8] or '',r[7] or '',r[12] or 0))
            state=latest[9]
            group=1 if state=='within_recorded_period' else 2 if state=='listed_date_unknown' else 4 if state in ('cancelled','source_cancelled') else 3
            masks[group] |= 1<<k
        indexes[n%16].append([code,c['names'][0] if c['names'] else '',*masks,' '.join(c['names'][1:])])
        shards[int(code[-2:])][code]=c
    def save(name,value):
        (DEST/name).write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    for i,rows in enumerate(indexes):save(f'index-{i:02}.json',rows)
    for i,rows in enumerate(shards):save(f'detail-{i:02}.json',rows)
    info=dict(schemaVersion=1,total=len(companies),builtAt=today,indexParts=16,
              kinds=KINDS,labels=[manifest['types'][k]['label'] for k in KINDS],
              sources=manifest['sources'],coverage=manifest['types'])
    save('manifest.json',info)
    print(json.dumps({'total':len(companies),'bytes':sum(p.stat().st_size for p in DEST.glob('*.json'))}))

if __name__=='__main__':run()
