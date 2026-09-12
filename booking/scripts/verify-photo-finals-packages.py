#!/usr/bin/env python3
"""Disposable local PG17 approval/ZIP processor integration. No remote URL."""
import importlib.util,json,tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('ingest_runner',Path(__file__).with_name('verify-photo-finals-ingest.py'))
assert spec is not None and spec.loader is not None
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def main():
 assert 'PostgreSQL) 17.' in m.run([str(m.PG/'postgres'),'--version'])
 with tempfile.TemporaryDirectory(prefix='pf-package-',dir='/tmp') as t:
  data=str(Path(t)/'data');m.run([str(m.PG/'initdb'),'-D',data,'-A','trust','-U','postgres','--no-locale'])
  m.run([str(m.PG/'pg_ctl'),'-D',data,'-l',str(Path(t)/'pg.log'),'-o',f'-F -k {t} -c listen_addresses=','-w','start'])
  try:
   cmd=[str(m.PG/'psql'),'-X','-qAt','-h',t,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1']
   for f in ['tests/postgres/canonical-media-bootstrap.sql','supabase/migrations/20260811225000_canonical_media_releases.sql','supabase/migrations/20260912120000_photo_finals_ingest.sql','tests/postgres/photo-finals-ingest.sql']:
    m.run(cmd+['-f',str(m.ROOT/f)])
   migration=m.ROOT/'supabase/migrations/20260912160000_photo_finals_packages.sql'
   if migration.exists():m.run(cmd+['-f',str(migration)])
   m.ENV['PF_TEST_SOCKET']=t;m.ENV['PF_TEST_PSQL']=str(m.PG/'psql')
   proof=json.loads(m.run(['node',str(m.ROOT/'tests/postgres/photo-finals-packages.integration.mjs')]))
  finally:m.run([str(m.PG/'pg_ctl'),'-D',data,'-m','immediate','-w','stop'])
 print(json.dumps({'passed':True,'adapter':'isolated-local-postgresql-17','proof':proof}))
if __name__=='__main__':main()
