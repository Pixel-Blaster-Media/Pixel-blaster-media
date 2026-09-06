#!/usr/bin/env python3
"""Disposable PostgreSQL 17 only; no environment/database URLs consumed."""
import os, pathlib, shutil, socket, subprocess, tempfile
ROOT = pathlib.Path(__file__).resolve().parents[1]
PG = pathlib.Path(os.environ.get('POSTGRES_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
assert 'PostgreSQL) 17.' in subprocess.check_output([str(PG/'postgres'), '--version'], text=True)
with tempfile.TemporaryDirectory(prefix='pixel-admin-lifecycle-') as temp:
    tmp = pathlib.Path(temp)
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0)); port = str(s.getsockname()[1])
    def run(args, **kwargs):
        return subprocess.run([str(x) for x in args], check=True, **kwargs)
    run([PG/'initdb', '-D', tmp/'data', '-A', 'trust', '-U', 'postgres', '--no-locale'], stdout=subprocess.DEVNULL)
    run([PG/'pg_ctl', '-D', tmp/'data', '-o', f'-F -p {port} -k {tmp} -h 127.0.0.1', '-w', 'start'], stdout=subprocess.DEVNULL)
    psql = [PG/'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', tmp, '-p', port, '-U', 'postgres', '-d', 'postgres']
    try:
        for file in ['tests/postgres/atomic-booking-bootstrap.sql', 'supabase/migrations/20260718202432_atomic_public_booking_outbox.sql', 'supabase/migrations/20260810173824_aerial_addon_catalog_rules.sql', 'tests/postgres/admin-lifecycle-bootstrap.sql']:
            run(psql + ['-f', ROOT/file], stdout=subprocess.DEVNULL)
        migration = ROOT/'supabase/migrations/20260905100200_admin_booking_lifecycle.sql'
        if migration.exists(): run(psql + ['-f', migration], stdout=subprocess.DEVNULL)
        run(psql + ['-f', ROOT/'tests/postgres/admin-lifecycle.behavior.sql'])
    finally:
        run([PG/'pg_ctl', '-D', tmp/'data', '-m', 'immediate', '-w', 'stop'], stdout=subprocess.DEVNULL)
