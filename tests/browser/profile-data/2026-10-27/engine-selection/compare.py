import json,pathlib,collections,gzip
root=pathlib.Path(__file__).parent
def load(label):
 path=root/(label+'.jsonl')
 text=path.read_text() if path.exists() else gzip.decompress(path.with_suffix('.jsonl.gz').read_bytes()).decode()
 records=[json.loads(line) for line in text.splitlines()]
 starts={r['id']:r for r in records if r['type']=='start'}
 spans={r['id']:r for r in records if r['type']=='span'}
 assert all(r.get('status')=='passed' for r in spans.values()),label
 assert starts.keys()==spans.keys(),label
 assert [r['code'] for r in records if r['type']=='browser-exit']==[0],label
 def ancestry(r):
  chain=[]
  while r:
   chain.append((r['category'],r['name']))
   r=starts.get(r.get('parentId'))
  return list(reversed(chain))
 engines=collections.defaultdict(list)
 for r in starts.values():
  chain=ancestry(r)
  if chain[0][0]=='engine' and r['category'] in ['engine','mode','scenario','fixture']:
   engines[chain[0][1]].append(chain)
 return engines,records
full,records=load('both')
assert list(full)==['chromium','webkit']
summary={}
for engine in ['chromium','webkit']:
 single,rows=load(engine)
 assert list(single)==[engine]
 assert single[engine]==full[engine],engine
 assert [r['engine'] for r in rows if r['type']=='browser']==[engine]
 summary[engine]={'orderedScenarioModeFixtureEngineRecords':len(single[engine]),'categories':dict(collections.Counter(x[-1][0] for x in single[engine])),'matchesFullSuiteBlock':True}
summary['fullEngineOrder']=list(full)
(root/'coverage-comparison.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
