import subprocess,time,json,os,sys,pathlib
label=sys.argv[1]
root=pathlib.Path('/tmp/nl-event-pr48')
env=dict(os.environ,NL_EVENT_PROFILE_SERVER='Agent-started Vite dev server on 127.0.0.1:5173; same process/dependencies for all PR48 samples; warmup excluded from comparison')
start=time.perf_counter()
with (root/(label+'.log')).open('x') as log:
 result=subprocess.run(['pnpm','test:browser:profile',str(root/(label+'.jsonl'))],stdout=log,stderr=subprocess.STDOUT,env=env)
metrics={'label':label,'wallSeconds':time.perf_counter()-start,'exitCode':result.returncode}
(root/(label+'-command.json')).write_text(json.dumps(metrics,indent=2)+'\n')
print(json.dumps(metrics),flush=True)
print('\n'.join((root/(label+'.log')).read_text().splitlines()[-8:]),flush=True)
sys.exit(result.returncode)
