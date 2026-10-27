import json,pathlib,collections,hashlib
root=pathlib.Path('/tmp/nl-event-pr48')
for label in ['warmup','before','after-1','after-2']:
 p=root/(label+'.jsonl')
 command=root/(label+'-command.json')
 if not p.exists() or not command.exists():continue
 rows=[json.loads(l) for l in p.read_text().splitlines()]
 spans=[r for r in rows if r['type']=='span']
 byid={r['id']:r for r in spans}
 def engine(r):
  while r:
   if r.get('category')=='engine':return r['name']
   r=byid.get(r.get('parentId'))
  return None
 fixtures=[r for r in spans if r['category']=='fixture']
 summary=json.loads(command.read_text())
 summary['engines']={r['name']:round(r['durationMs']/1000,6) for r in spans if r['category']=='engine'}
 summary['modes']={engine(r)+'/'+r['name']:round(r['durationMs']/1000,6) for r in spans if r['category']=='mode'}
 summary['fixtureCounts']=dict(collections.Counter(engine(r) for r in fixtures))
 summary['fixtureSeconds']=round(sum(r['durationMs'] for r in fixtures)/1000,6)
 summary['candidatesSeconds']=round(sum(r['durationMs'] for r in spans if r['name']=='checkCandidates')/1000,6)
 summary['commandSeconds']=next(r['endMs']/1000 for r in spans if r['id']=='command')
 summary['compileSeconds']=next(r['durationMs']/1000 for r in spans if r['id']=='compile')
 summary['runnerSeconds']=next(r['durationMs']/1000 for r in spans if r['id']=='runner')
 summary['fixtureIds']=list(dict.fromkeys(r['name'] for r in fixtures))
 summary['failures']=[r['name'] for r in spans if r['status']!='passed']
 (root/(label+'-metrics.json')).write_text(json.dumps(summary,indent=2)+'\n')
 print(json.dumps(summary))
