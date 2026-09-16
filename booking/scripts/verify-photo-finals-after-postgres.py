#!/usr/bin/env python3
"""Built Next after + isolated PG17, no deployment/provider credentials."""
import importlib.util, tempfile, subprocess, os, socket, time, json, base64, hmac, hashlib, urllib.request, shutil
from pathlib import Path
spec=importlib.util.spec_from_file_location('ingest_runner',Path(__file__).with_name('verify-photo-finals-ingest.py'))
assert spec is not None and spec.loader is not None
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
env={k:v for k,v in os.environ.items() if k in {'PATH','HOME','TMPDIR','POSTGRES_BIN','PF_AFTER_LOG'}}
with tempfile.TemporaryDirectory(prefix='pf-after-pg-',dir='/tmp') as t:
 data=str(Path(t)/'data')
 m.run([str(m.PG/'initdb'),'-D',data,'-A','trust','-U','postgres','--no-locale'])
 m.run([str(m.PG/'pg_ctl'),'-D',data,'-l',str(Path(t)/'pg.log'),'-o',f'-F -k {t} -c listen_addresses=','-w','start'])
 try:
  cmd=[str(m.PG/'psql'),'-X','-qAt','-h',t,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1']
  for f in ['tests/postgres/canonical-media-bootstrap.sql','supabase/migrations/20260811225000_canonical_media_releases.sql','supabase/migrations/20260912120000_photo_finals_ingest.sql','tests/postgres/photo-finals-ingest.sql','supabase/migrations/20260912160000_photo_finals_packages.sql','supabase/migrations/20260912200000_photo_finals_application.sql']:
   m.run(cmd+['-f',str(m.ROOT/f)])
  binary=shutil.which('postgrest');assert binary
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
  secret='synthetic-postgrest-test-only-secret-not-a-production-key'
  encode=lambda v:base64.urlsafe_b64encode(json.dumps(v,separators=(',',':')).encode()).rstrip(b'=')
  unsigned=encode({'alg':'HS256','typ':'JWT'})+b'.'+encode({'role':'service_role','exp':int(time.time())+600})
  jwt=(unsigned+b'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),unsigned,hashlib.sha256).digest()).rstrip(b'=')).decode()
  restenv={**env,'PGRST_DB_URI':f'postgresql://postgres@/postgres?host={t}','PGRST_DB_SCHEMAS':'public','PGRST_DB_ANON_ROLE':'anon','PGRST_JWT_SECRET':secret,'PGRST_SERVER_HOST':'127.0.0.1','PGRST_SERVER_PORT':str(port)}
  with open(Path(t)/'postgrest.log','w') as log:rest=subprocess.Popen([binary],env=restenv,stdout=log,stderr=log)
  try:
   for attempt in range(100):
    try:
     with urllib.request.urlopen(f'http://127.0.0.1:{port}/',timeout=1) as response:assert response.status==200
     break
    except OSError:time.sleep(.05)
   else:raise RuntimeError('PostgREST did not start')
   env.update({'PF_TEST_POSTGREST':f'http://127.0.0.1:{port}','PF_TEST_JWT':jwt})
   result=subprocess.run(['node','scripts/verify-photo-finals-after.mjs'],cwd=m.ROOT,env={**env,'PF_TEST_SOCKET':t,'PF_TEST_PSQL':str(m.PG/'psql')},capture_output=True,text=True,timeout=180)
   if result.returncode:raise RuntimeError(result.stderr)
   print(result.stdout,end='')
   result=subprocess.run(['node','scripts/verify-photo-finals-operator-tail.mjs'],cwd=m.ROOT,env={**env,'PF_TEST_SOCKET':t,'PF_TEST_PSQL':str(m.PG/'psql')},capture_output=True,text=True,timeout=90)
  finally:rest.terminate();rest.wait(timeout=10)
  print(result.stdout,end='')
  if result.returncode:raise RuntimeError(result.stderr)
 finally:m.run([str(m.PG/'pg_ctl'),'-D',data,'-m','immediate','-w','stop'])
