#!/usr/bin/env python3
"""Test-only local PG17 + real HTTP application handlers; no remote URLs."""
import importlib.util,json,tempfile,os,subprocess
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
   env={**m.ENV,'PF_TEST_SOCKET':t,'PF_TEST_PSQL':str(m.PG/'psql')}
   result=subprocess.run(['node',str(m.ROOT/'tests/postgres/photo-finals-http.integration.mjs')],env=env,text=True,capture_output=True,timeout=240)
   if result.returncode:raise RuntimeError(result.stdout+result.stderr)
   proof=json.loads(result.stdout)
  finally:m.run([str(m.PG/'pg_ctl'),'-D',data,'-m','immediate','-w','stop'])
 print(json.dumps({'passed':True,'adapter':'test-only-local-http-postgresql-17','proof':proof}))
if __name__=='__main__':main()
