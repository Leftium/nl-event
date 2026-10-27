import subprocess,time,json,pathlib,os,sys
root=pathlib.Path('/tmp/nl-event-pr50')
for label,cmd,engine in [('profile-chromium',['pnpm','test:browser:profile',str(root/'profile-chromium.jsonl')],'chromium'),('profile-webkit',['pnpm','test:browser:profile',str(root/'profile-webkit.jsonl')],'webkit')]:
 env=dict(os.environ,NL_EVENT_BROWSER_ENGINE=engine,NL_EVENT_PROFILE_SERVER='Same warmed agent-started Vite server localhost:5173; after public command measurements')
 start=time.perf_counter()
 with (root/(label+'.log')).open('x') as log:
  r=subprocess.run(cmd,env=env,stdout=log,stderr=subprocess.STDOUT)
 metrics=dict(label=label,wallSeconds=time.perf_counter()-start,exitCode=r.returncode)
 (root/(label+'-command.json')).write_text(json.dumps(metrics,indent=2)+'\n')
 rows=[json.loads(x) for x in (root/(label+'.jsonl')).read_text().splitlines()]
 assert rows[0]['selectedEngines']==[engine]
 assert [x['engine'] for x in rows if x['type']=='browser']==[engine]
 assert r.returncode==0
 print(json.dumps(metrics),flush=True)
