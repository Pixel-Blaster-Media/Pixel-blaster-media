#!/usr/bin/env python3
"""Real local PostgreSQL 17, synthetic canonical fixtures; no external DB/env URL.
Proves existing parent-lock contract in both orderings, NOT an approval RPC.
"""
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
PG = Path(os.environ.get('POSTGRES_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
ENV = {**os.environ, 'LC_ALL': 'C', 'PGCONNECT_TIMEOUT': '3'}
RELEASE = '71111111-1111-4111-8111-111111111102'
APPROVE = f"""update public.gallery_releases set state='approved',
 approved_by='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', approved_at=now() where id='{RELEASE}';"""
INSERT = f"""insert into public.gallery_release_items (
 organization_id, property_id, batch_id, release_id, media_version_id,
 display_derivative_id, position, display_filename) values (
 '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101',
 '31111111-1111-4111-8111-111111111101', '{RELEASE}',
 '51111111-1111-4111-8111-111111111102', '61111111-1111-4111-8111-111111111102',
 1, 'synthetic-pending.jpg');"""


def run(args, **kwargs):
    return subprocess.run(args, env=ENV, text=True, capture_output=True, timeout=30, **kwargs)


def main():
    version = run([str(PG / 'postgres'), '--version'], check=True).stdout
    if 'PostgreSQL) 17.' not in version:
        raise RuntimeError('PostgreSQL 17 is required')
    with tempfile.TemporaryDirectory(prefix='pf-race-', dir='/tmp') as temp:
        temp = Path(temp)
        data = temp / 'data'
        log = temp / 'postgres.log'
        run([str(PG / 'initdb'), '-D', str(data), '-A', 'trust', '-U', 'postgres', '--no-locale'], check=True)
        started = False
        children = []
        try:
            start = run([str(PG / 'pg_ctl'), '-D', str(data), '-l', str(log), '-o',
                         f'-F -k {temp} -c listen_addresses= -c max_connections=12', '-w', 'start'])
            if start.returncode:
                raise RuntimeError(log.read_text())
            started = True
            base = [str(PG / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', str(temp), '-U', 'postgres']
            for file in ['tests/postgres/canonical-media-bootstrap.sql',
                         'supabase/migrations/20260811225000_canonical_media_releases.sql',
                         'tests/postgres/canonical-media-schema.behavior.sql']:
                result = run(base + ['-d', 'postgres', '-v', 'commit_fixture=1', '-f', str(ROOT / file)])
                if result.returncode:
                    raise RuntimeError(result.stderr)
            proofs = []
            for index, (first, second, rejection) in enumerate([
                (APPROVE, INSERT, 'Approved release items are immutable'),
                (INSERT, APPROVE, 'Every release item must be approved before release approval'),
            ]):
                db = f'race_{index}'
                run(base + ['-d', 'postgres', '-c', f'create database {db} template postgres'], check=True)
                cmd = base + ['-d', db]
                # Holder remains in an open transaction until observer proves a lock wait.
                holder = subprocess.Popen(cmd, env=ENV, text=True, stdin=subprocess.PIPE,
                                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=1)
                children.append(holder)
                assert holder.stdin is not None and holder.stdout is not None and holder.stderr is not None
                markers = queue.Queue()
                def read_lines(stream):
                    for line in stream:
                        markers.put(line.strip())
                threading.Thread(target=read_lines, args=(holder.stdout,), daemon=True).start()
                holder.stdin.write("set role service_role; begin; set local statement_timeout='15s'; " + first + " select 'LOCK_HELD';\n")
                holder.stdin.flush()
                if markers.get(timeout=10) != 'LOCK_HELD':
                    raise RuntimeError('Holder did not reach intended mutation')
                name = f'photo_finals_contender_{index}'
                contender = subprocess.Popen(cmd + ['-c', f"set application_name='{name}'; set statement_timeout='15s'; set role service_role; " + second],
                                             env=ENV, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                children.append(contender)
                deadline = time.monotonic() + 10
                observed = False
                while time.monotonic() < deadline:
                    observation = run(cmd + ['-c', f"select count(*) from pg_stat_activity where datname='{db}' and application_name='{name}' and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0"], check=True)
                    if observation.stdout.strip() == '1':
                        observed = True
                        break
                    if contender.poll() is not None:
                        raise RuntimeError('Contender exited before observable serialization: ' + contender.communicate()[1])
                    time.sleep(0.02)
                if not observed:
                    raise RuntimeError('No observed database lock wait')
                holder.stdin.write('commit;\n\\q\n')
                holder.stdin.flush()
                holder.wait(timeout=10)
                if holder.returncode:
                    raise RuntimeError(holder.stderr.read())
                _, error = contender.communicate(timeout=10)
                if contender.returncode == 0 or '23514' not in error or rejection not in error:
                    raise RuntimeError('Wrong rejection boundary: ' + error)
                invariant = run(cmd + ['-c', f"select count(*) from public.gallery_release_items i join public.gallery_releases r on r.organization_id=i.organization_id and r.id=i.release_id where r.id='{RELEASE}' and r.state='approved' and i.approval_state<>'approved'"], check=True)
                if invariant.stdout.strip() != '0':
                    raise RuntimeError('Cross-row approval invariant violated')
                state = run(cmd + ['-c', f"select state from public.gallery_releases where id='{RELEASE}'"], check=True).stdout.strip()
                count = run(cmd + ['-c', f"select count(*) from public.gallery_release_items where release_id='{RELEASE}'"], check=True).stdout.strip()
                if (state, count) != [('approved', '1'), ('review_pending', '2')][index]:
                    raise RuntimeError(f'Unexpected final state/count: {state}/{count}')
                proofs.append({'ordering': index, 'observed_lock_wait': True, 'sqlstate': '23514', 'state': state, 'item_count': int(count)})
        finally:
            for child in children:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=5)
            if started:
                stop = run([str(PG / 'pg_ctl'), '-D', str(data), '-m', 'immediate', '-w', 'stop'])
                if stop.returncode:
                    raise RuntimeError('Disposable PostgreSQL shutdown failed')
    print(json.dumps({'passed': True, 'adapter': 'isolated-local-postgresql-17-synthetic-fixtures', 'proofs': proofs}))


if __name__ == '__main__':
    main()
