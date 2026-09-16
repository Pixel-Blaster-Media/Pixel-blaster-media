#!/usr/bin/env python3
"""Test-only local PG17 + real HTTP application handlers; no remote URLs."""
import importlib.util,json,tempfile,os,subprocess,socket,time,urllib.request,urllib.error,base64,hmac,hashlib,shutil
from pathlib import Path
spec=importlib.util.spec_from_file_location('ingest_runner',Path(__file__).with_name('verify-photo-finals-ingest.py'))
assert spec is not None and spec.loader is not None
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
# No deployment/provider credentials enter the isolated server or browser process.
m.__dict__['ENV']={k:v for k,v in os.environ.items() if k in {'PATH','HOME','TMPDIR','POSTGRES_BIN','PF_PLAYWRIGHT_MODULE','PF_CHROME_PATH','PF_EVIDENCE_DIR'}}
m.ENV['LC_ALL']='C'
def main():
 with tempfile.TemporaryDirectory(prefix='pf-http-',dir='/tmp') as t:
  data=str(Path(t)/'data');m.run([str(m.PG/'initdb'),'-D',data,'-A','trust','-U','postgres','--no-locale'])
  m.run([str(m.PG/'pg_ctl'),'-D',data,'-l',str(Path(t)/'pg.log'),'-o',f'-F -k {t} -c listen_addresses=','-w','start'])
  try:
   cmd=[str(m.PG/'psql'),'-X','-qAt','-h',t,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1']
   for f in ['tests/postgres/canonical-media-bootstrap.sql','supabase/migrations/20260811225000_canonical_media_releases.sql','supabase/migrations/20260912120000_photo_finals_ingest.sql','tests/postgres/photo-finals-ingest.sql','supabase/migrations/20260912160000_photo_finals_packages.sql']:
    m.run(cmd+['-f',str(m.ROOT/f)])
   extra=m.ROOT/'supabase/migrations/20260912200000_photo_finals_application.sql'
   if extra.exists():m.run(cmd+['-f',str(extra)])
   m.run(cmd+['-f',str(m.ROOT/'supabase/migrations/20260912210000_photo_finals_download_accounting.sql')])
   m.run(cmd+['-f',str(m.ROOT/'supabase/migrations/20260912220000_photo_finals_recovery.sql')])
   env={**m.ENV,'PF_TEST_SOCKET':t,'PF_TEST_PSQL':str(m.PG/'psql')}
   rest=None
   try:
    if os.environ.get('PF_REAL_POSTGREST')=='1':
     binary=shutil.which('postgrest');assert binary,'Install local PostgREST before this gate'
     with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
     secret='synthetic-postgrest-test-only-secret-not-a-production-key'
     encode=lambda v:base64.urlsafe_b64encode(json.dumps(v,separators=(',',':')).encode()).rstrip(b'=')
     unsigned=encode({'alg':'HS256','typ':'JWT'})+b'.'+encode({'role':'service_role','exp':int(time.time())+600})
     jwt=(unsigned+b'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),unsigned,hashlib.sha256).digest()).rstrip(b'=')).decode()
     restenv={**m.ENV,'PGRST_DB_URI':f'postgresql://postgres@/postgres?host={t}','PGRST_DB_SCHEMAS':'public','PGRST_DB_ANON_ROLE':'anon','PGRST_JWT_SECRET':secret,'PGRST_SERVER_HOST':'127.0.0.1','PGRST_SERVER_PORT':str(port)}
     with open(Path(t)/'postgrest.log','w') as log:rest=subprocess.Popen([binary],env=restenv,stdout=log,stderr=log)
     env.update({'PF_TEST_POSTGREST':f'http://127.0.0.1:{port}','PF_TEST_JWT':jwt})
     ready=False
     for attempt in range(100):
      if rest.poll() is not None:raise RuntimeError((Path(t)/'postgrest.log').read_text())
      try:
       with urllib.request.urlopen(env['PF_TEST_POSTGREST']+'/',timeout=1) as response:ready=response.status==200
       if ready:break
      except (OSError,urllib.error.URLError):time.sleep(.05)
     assert ready,'Local PostgREST not ready'
    result=subprocess.run(['node',str(m.ROOT/'tests/postgres/photo-finals-http.integration.mjs')],env=env,text=True,capture_output=True,timeout=240)
   finally:
    if rest:rest.terminate();rest.wait(timeout=10)
   if result.returncode:raise RuntimeError(result.stdout+result.stderr)
   proof=json.loads(result.stdout)
  finally:m.run([str(m.PG/'pg_ctl'),'-D',data,'-m','immediate','-w','stop'])
 print(json.dumps({'passed':True,'adapter':'local-postgrest-postgresql-17' if os.environ.get('PF_REAL_POSTGREST')=='1' else 'test-only-local-http-postgresql-17','proof':proof}))
if __name__=='__main__':main()
