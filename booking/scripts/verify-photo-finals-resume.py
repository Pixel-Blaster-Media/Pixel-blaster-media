#!/usr/bin/env python3
"""Seventh-migration isolated PostgreSQL integration; Unix socket, no remote access."""
import importlib.util, tempfile, subprocess, json, os
from pathlib import Path
spec=importlib.util.spec_from_file_location('base',Path(__file__).with_name('verify-photo-finals-ingest.py'))
assert spec is not None and spec.loader is not None
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.ENV={k:v for k,v in os.environ.items() if k in {'PATH','HOME','TMPDIR','POSTGRES_BIN','PF_RESUME_INTEGRATION','PF_RESUME_BROWSER','PF_EVIDENCE_DIR','PF_PLAYWRIGHT_MODULE','PF_CHROME_PATH'}}
m.ENV['LC_ALL']='C'
def main():
 with tempfile.TemporaryDirectory(prefix='pf-resume-',dir='/tmp') as t:
  data=str(Path(t)/'data');m.run([str(m.PG/'initdb'),'-D',data,'-A','trust','-U','postgres','--no-locale'])
  m.run([str(m.PG/'pg_ctl'),'-D',data,'-l',str(Path(t)/'pg.log'),'-o',f'-F -k {t} -c listen_addresses=','-w','start'])
  try:
   cmd=[str(m.PG/'psql'),'-X','-qAt','-h',t,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1']
   files=['tests/postgres/canonical-media-bootstrap.sql','supabase/migrations/20260811225000_canonical_media_releases.sql','supabase/migrations/20260912120000_photo_finals_ingest.sql','tests/postgres/photo-finals-ingest.sql','supabase/migrations/20260912160000_photo_finals_packages.sql','supabase/migrations/20260912200000_photo_finals_application.sql','supabase/migrations/20260912210000_photo_finals_download_accounting.sql','supabase/migrations/20260912220000_photo_finals_recovery.sql']
   for f in files:m.run(cmd+['-f',str(m.ROOT/f)])
   migration=m.ROOT/'supabase/migrations/20260915120000_photo_finals_resume.sql'
   if migration.exists():m.run(cmd+['-f',str(migration)])
   env={**m.ENV,'PF_TEST_SOCKET':t,'PF_TEST_PSQL':str(m.PG/'psql')}
   r=subprocess.run(['node',str(m.ROOT/'tests/postgres/photo-finals-resume-sql.integration.mjs')],env=env,text=True,capture_output=True,timeout=180)
   print(r.stdout,end='');print(r.stderr,end='')
   if r.returncode:raise RuntimeError('resume integration failed')
   if os.environ.get('PF_RESUME_INTEGRATION'):
    target=(m.ROOT/os.environ['PF_RESUME_INTEGRATION']).resolve()
    assert target == (m.ROOT/'tests/postgres/photo-finals-resume.integration.mjs').resolve(), 'unexpected integration hook'
    r=subprocess.run(['node',str(target)],env=env,text=True,capture_output=True,timeout=180)
    print(r.stdout,end='');print(r.stderr,end='')
    if r.returncode:raise RuntimeError('parent resume integration failed')
  finally:m.run([str(m.PG/'pg_ctl'),'-D',data,'-m','immediate','-w','stop'])
if __name__=='__main__':main()
