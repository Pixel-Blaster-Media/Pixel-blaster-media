#!/usr/bin/env python3
"""Isolated Unix-socket PG17 only; synthetic fixtures, never remote URLs."""
import os, subprocess, tempfile, json, threading, queue, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PG=Path(os.environ.get('POSTGRES_BIN','/opt/homebrew/opt/postgresql@17/bin'))
ENV={**os.environ,'LC_ALL':'C'}
def run(args, **kw):
    r=subprocess.run(args,env=ENV,text=True,capture_output=True,timeout=90,**kw)
    if r.returncode: raise RuntimeError(r.stdout+r.stderr)
    return r.stdout

ORG='11111111-1111-4111-8111-111111111111'
ACTOR='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
BOOKING='21111111-1111-4111-8111-111111111101'
PROP='11111111-1111-4111-8111-111111111101'
REQUEST='31111111-1111-4111-8111-111111111101'
JOB='41111111-1111-4111-8111-111111111101'
def intent(n, hash_value=None, booking=BOOKING):
    return f"select (public.photo_finals_create_intent('{ORG}','{ACTOR}','{booking}','{PROP}','{REQUEST}','41111111-1111-4111-8111-{n:012d}','{hash_value or format(n,'064x')}',100)).id;"

def races(cmd):
    proofs=[]
    for index,kind in enumerate(['same-intent','same-hash','quota']):
        db='finals_race_'+str(index)
        run(cmd+['-c',f'create database {db} template postgres'])
        c=cmd+['-d',db]
        if kind=='quota':
            for n in range(2,32): run(c+['-c','set role service_role; '+intent(n)])
        first=intent(100)
        second=intent(100 if kind=='same-intent' else 101,format(100,'064x') if kind=='same-hash' else None)
        if kind=='same-hash':
            other='21111111-1111-4111-8111-111111111102'
            run(c+['-c',f"insert into bookings(id,organization_id,property_id,owner_id) values('{other}','{ORG}','{PROP}','{ACTOR}')"])
            second=intent(101,format(100,'064x'),booking=other)
        holder=subprocess.Popen(c,env=ENV,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,bufsize=1)
        contender=None
        try:
            markers=queue.Queue()
            def read():
                for line in holder.stdout: markers.put(line.strip())
            threading.Thread(target=read,daemon=True).start()
            holder.stdin.write("set role service_role; begin; set local statement_timeout='15s'; "+first+" select 'HELD';\n");holder.stdin.flush()
            while markers.get(timeout=10)!='HELD': pass
            contender=subprocess.Popen(c+['-c',"set application_name='finals_contender'; set statement_timeout='15s'; set role service_role; "+second],env=ENV,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            deadline=time.monotonic()+10
            while time.monotonic()<deadline:
                if run(c+['-c',"select count(*) from pg_stat_activity where application_name='finals_contender' and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0"]).strip()=='1': break
                if contender.poll() is not None: raise RuntimeError('contender did not block: '+contender.communicate()[1])
                time.sleep(.02)
            else: raise RuntimeError('no observed lock wait')
            holder.stdin.write('commit;\n\\q\n');holder.stdin.flush();holder.wait(timeout=10)
            assert holder.returncode==0,holder.stderr.read()
            output,error=contender.communicate(timeout=10)
            if kind=='same-intent': assert contender.returncode==0 and '41111111-1111-4111-8111-000000000100' in output,error
            else:
                state,message=('23505','finals_hash_collision') if kind=='same-hash' else ('54000','finals_tenant_quota')
                assert contender.returncode and state in error and message in error,error
            count=int(run(c+['-c','select count(*) from media_ingest_jobs']).strip())
            assert count==(32 if kind=='quota' else 2),count
            proofs.append({'case':kind,'observedLockWait':True,'count':count})
        finally:
            for p in [holder,contender]:
                if p is not None and p.poll() is None: p.kill();p.wait(timeout=5)
    return proofs

def main():
    assert 'PostgreSQL) 17.' in run([str(PG/'postgres'),'--version'])
    with tempfile.TemporaryDirectory(prefix='pf-ingest-',dir='/tmp') as t:
        data=str(Path(t)/'data')
        run([str(PG/'initdb'),'-D',data,'-A','trust','-U','postgres','--no-locale'])
        run([str(PG/'pg_ctl'),'-D',data,'-l',str(Path(t)/'pg.log'),'-o',f'-F -k {t} -c listen_addresses=','-w','start'])
        try:
            cmd=[str(PG/'psql'),'-X','-qAt','-h',t,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
            for f in ['tests/postgres/canonical-media-bootstrap.sql','supabase/migrations/20260811225000_canonical_media_releases.sql']:
                run(cmd+['-f',str(ROOT/f)])
            migration=ROOT/'supabase/migrations/20260912120000_photo_finals_ingest.sql'
            if migration.exists(): run(cmd+['-f',str(migration)])
            run(cmd+['-f',str(ROOT/'tests/postgres/photo-finals-ingest.sql')])
            run(cmd+['-f',str(ROOT/'tests/postgres/photo-finals-ingest.behavior.sql')])
            proofs=races(cmd)
            ENV['PF_TEST_SOCKET']=t
            ENV['PF_TEST_PSQL']=str(PG/'psql')
            storage_proof=json.loads(run(['node',str(ROOT/'tests/postgres/photo-finals-storage.integration.mjs')]))
        finally: run([str(PG/'pg_ctl'),'-D',data,'-m','immediate','-w','stop'])
    print(json.dumps({'passed':True,'adapter':'isolated-local-postgresql-17','concurrency':proofs,'storage':storage_proof}))
if __name__=='__main__': main()
