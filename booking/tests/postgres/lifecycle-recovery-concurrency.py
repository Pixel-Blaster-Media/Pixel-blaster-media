"""Real two-session claim serialization; require observed parent row lock wait."""
import json
import os
import subprocess
import time

# Explicit injected disposable-cluster context from the checked-in runner.
sql = globals()['sql']
psql = globals()['psql']

booking_id = sql('select id from public.bookings').strip()
org_id = '11111111-1111-4111-8111-111111111111'
# Fixture initially exactly 24h ahead: move inside reminder window.
sql("update public.bookings set scheduled_at=now()+interval '12 hours',scheduled_ends_at=now()+interval '14 hours'")
version = sql('select schedule_version from public.bookings').strip()
claim = f"select public.claim_booking_reminder('{org_id}','{booking_id}',{version},'70000000-0000-4000-8000-000000000001')"
first = subprocess.Popen(psql+['-At'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
first.stdin.write('begin;\n'+claim+';\n'); first.stdin.flush()
assert first.stdout.readline().strip() == 'BEGIN'
held = json.loads(first.stdout.readline())
assert held['id']
second_env = dict(os.environ, PGAPPNAME='recovery-claim-contender')
second = subprocess.Popen(psql+['-Atc', claim.replace('000000000001','000000000002')], env=second_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
try:
    deadline = time.monotonic()+5
    while time.monotonic()<deadline:
        waiting = sql("select count(*) from pg_stat_activity where application_name='recovery-claim-contender' and wait_event_type='Lock'").strip()
        if waiting == '1':
            break
        assert second.poll() is None, 'contender exited before reaching intended row lock'
        time.sleep(.02)
    else:
        raise AssertionError('contender never observed in Lock wait')
    first.stdin.write('commit;\n\\q\n'); first.stdin.flush()
    assert first.wait(timeout=5)==0
    output, error = second.communicate(timeout=5)
    assert second.returncode==0, error
    assert output.strip() == '', 'second session must not receive an active reminder lease'
    assert sql("select count(*) from public.booking_reminder_jobs where status='processing'").strip()=='1'
    print('Observed PostgreSQL Lock wait: concurrent reminder claimant fenced.')
finally:
    if first.poll() is None: first.kill(); first.wait()
    if second.poll() is None: second.kill(); second.wait()
