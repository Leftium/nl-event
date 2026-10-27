import json,pathlib,collections
root=pathlib.Path(__file__).resolve().parent
for label in ['warmup','before','after-1','after-2']:
 p=root/(label+'.jsonl')
 command=root/(label+'-command.json')
 if not p.exists() or not command.exists():continue
 rows=[json.loads(l) for l in p.read_text().splitlines()]
 spans=[r for r in rows if r['type']=='span']
 byid={r['id']:r for r in spans}
 def ancestors(r):
  while r:
   yield r
   r=byid.get(r.get('parentId'))
 def scope(r,category):
  return next((a['name'] for a in ancestors(r) if a.get('category')==category),None)
 def seconds(rs):return round(sum(r.get('durationMs',r['endMs']-r['startMs']) for r in rs)/1000,6)
 def waits(rs):return {'count':len(rs),'seconds':seconds(rs)}
 selection=[r for r in spans if r['name']=='checkSelectionActions']
 parses=[r for r in spans if r['name']=='parse-status predicate']
 selection_parses=[r for r in parses if any(a['name']=='checkSelectionActions' for a in ancestors(r))]
 summary=json.loads(command.read_text())
 summary.update(engines={r['name']:seconds([r]) for r in spans if r.get('category')=='engine'},selectionSeconds=seconds(selection),selectionByMode={scope(r,'engine')+'/'+scope(r,'mode'):seconds([r]) for r in selection},parseWaits=waits(parses),selectionParseWaits=waits(selection_parses),selectionWaitsByMode={scope(r,'engine')+'/'+scope(r,'mode'):waits([w for w in selection_parses if any(a['id']==r['id'] for a in ancestors(w))]) for r in selection},counts=dict(collections.Counter(r['category'] for r in spans)),failures=[r['name'] for r in spans if r.get('status')!='passed'],unfinished=sorted(set(r['id'] for r in rows if r['type']=='start')-set(byid)))
 (root/(label+'-metrics.json')).write_text(json.dumps(summary,indent=2)+'\n')
 print(json.dumps(summary))
