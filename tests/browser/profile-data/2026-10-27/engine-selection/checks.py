import subprocess,pathlib,sys
root=pathlib.Path('/tmp/nl-event-pr50')
for name,cmd in [('node',['node','--test','tests/browser-engines.test.mjs','tests/browser-profile.test.mjs']),('unit',['pnpm','test']),('check',['pnpm','check']),('lint',['pnpm','lint'])]:
 with (root/(name+'.log')).open('w') as log:
  result=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT)
 print(name, 'exit',result.returncode,flush=True)
 print('\n'.join((root/(name+'.log')).read_text().splitlines()[-6:]),flush=True)
 if result.returncode: sys.exit(result.returncode)
