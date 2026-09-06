#!/usr/bin/env python3
"""Disposable PostgreSQL 17 lifecycle tests. No network/provider credentials."""
import os
from pathlib import Path
import runpy
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PG = Path(os.environ.get('POSTGRES_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
assert 'PostgreSQL) 17.' in subprocess.check_output([str(PG/'postgres'), '--version'], text=True)
with tempfile.TemporaryDirectory(prefix='pixel-recovery-pg-') as tmp:
    env = dict(os.environ, LC_ALL='C')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = str(sock.getsockname()[1])
    subprocess.run([str(PG/'initdb'), '-D', tmp+'/data', '-A', 'trust', '-U', 'postgres', '--no-locale'], env=env, check=True, stdout=subprocess.DEVNULL)
    subprocess.run([str(PG/'pg_ctl'), '-D', tmp+'/data', '-o', f'-F -p {port} -k {tmp} -h 127.0.0.1', '-w', 'start'], check=True, stdout=subprocess.DEVNULL)
    psql = [str(PG/'psql'), '-X', '-v', 'ON_ERROR_STOP=1', '-h', tmp, '-p', port, '-U', 'postgres', '-d', 'postgres']
    def sql(text):
        return subprocess.check_output(psql+['-Atc', text], text=True)
    def file(path):
        subprocess.run(psql+['-f', str(ROOT/path)], check=True, stdout=subprocess.DEVNULL)
    try:
        file('tests/postgres/atomic-booking-bootstrap.sql')
        sql('alter table public.bookings add column reminder_sent_at timestamptz, add column suppress_realtor_notifications boolean not null default false;')
        file('supabase/migrations/20260718202432_atomic_public_booking_outbox.sql')
        file('supabase/migrations/20260719124500_integration_outbox_recovery_reconciliation.sql')
        file('supabase/migrations/20260905100500_booking_effect_generations.sql')
        file('supabase/migrations/20260905100700_booking_reminder_recovery.sql')
        file('tests/postgres/lifecycle-recovery-fixture.sql')
        file('tests/postgres/lifecycle-recovery.behavior.sql')
        file('tests/postgres/reminder-recovery.behavior.sql')
        file('tests/postgres/reminder-recovery-edges.sql')
        runpy.run_path(str(ROOT/'tests/postgres/lifecycle-recovery-concurrency.py'), init_globals={'sql': sql, 'psql': psql})
        print('Lifecycle recovery PostgreSQL behavior/concurrency suite passed.')
    finally:
        subprocess.run([str(PG/'pg_ctl'), '-D', tmp+'/data', '-m', 'immediate', '-w', 'stop'], check=True, stdout=subprocess.DEVNULL)
