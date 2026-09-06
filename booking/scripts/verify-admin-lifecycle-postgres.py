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
        # Two independent backend sessions; observe a real Lock wait before
        # releasing the winning transaction (no sleep-as-proof oracle).
        import time, json
        def query(sql):
            return subprocess.check_output(psql + ['-At'], input=sql, text=True).strip()
        booking = json.loads(query("select public.test_admin_save('00000000-0000-4000-8000-000000000201');"))['booking_id']
        for commit in (True, False):
            version = query(f"select lifecycle_version from public.bookings where id='{booking}';")
            a = subprocess.Popen(psql + ['-At'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            a.stdin.write(f"begin; select public.test_admin_save(gen_random_uuid(),'{booking}',{version},'{{\"client_notes\":\"winner\"}}');\\echo LOCKED\n")
            a.stdin.flush()
            while a.stdout.readline().strip() != 'LOCKED':
                assert a.poll() is None, 'first backend exited before lock'
            b = subprocess.Popen(psql + ['-At'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            b.stdin.write(f"set application_name='lifecycle_cas_waiter'; select public.test_admin_save(gen_random_uuid(),'{booking}',{version},'{{\"client_notes\":\"second\"}}');\n")
            b.stdin.close(); b.stdin = None
            deadline = time.monotonic()+10
            while query("select count(*) from pg_stat_activity where application_name='lifecycle_cas_waiter' and wait_event_type='Lock';") != '1':
                assert time.monotonic()<deadline, 'second backend did not block'
                time.sleep(.02)
            a.stdin.write('commit;\n' if commit else 'rollback;\n'); a.stdin.close(); a.stdin=None
            a.communicate(timeout=10)
            out, err = b.communicate(timeout=10)
            if commit:
                assert b.returncode != 0 and 'Booking changed; reload' in err, err
                assert query(f"select client_notes from public.bookings where id='{booking}';") == 'winner'
            else:
                assert b.returncode == 0, err
                assert query(f"select client_notes from public.bookings where id='{booking}';") == 'second'
        print('PASS observed two-session CAS conflict and rollback releases contender')
        recovery = pathlib.Path(os.environ.get('RECOVERY_MIGRATIONS', str(ROOT/'supabase/migrations')))
        effects = recovery/'20260905100500_booking_effect_generations.sql'
        assert effects.is_file(), 'required recovery migration missing'
        run(psql + ['-f', effects], stdout=subprocess.DEVNULL)
        run(psql + ['-f', ROOT/'tests/postgres/admin-lifecycle-integrated.sql'])
    finally:
        run([PG/'pg_ctl', '-D', tmp/'data', '-m', 'immediate', '-w', 'stop'], stdout=subprocess.DEVNULL)
