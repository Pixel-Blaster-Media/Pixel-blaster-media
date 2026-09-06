"""Local disposable PostgreSQL only: execute baseline writer SQL across commits."""
import subprocess
import sys
import json

psql = sys.argv[1:]
org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
booking = '11111111-1111-4111-8111-111111111111'
snapshot = json.dumps(dict(realtor={'email':'a@example.test'}, property={'street_address':'Test'}, lineItems=[{'description':'Photo','amountCents':10000}], defaultItemId='1'))
request = f"select request_quickbooks_invoice('{org}','{booking}');"
begin = f"select begin_quickbooks_invoice('{org}','{booking}','123','sandbox','{snapshot}');"
start = "update bookings set quickbooks_invoice_status='creating' where quickbooks_invoice_id is null and (quickbooks_invoice_status is null or quickbooks_invoice_status <> 'creating');"
clear = "update bookings set quickbooks_invoice_status=null where quickbooks_invoice_status='creating' and quickbooks_invoice_id is null;"
def sql(s):
    return subprocess.check_output(psql+['-Atq'], input='set role service_role;'+s, text=True, stderr=subprocess.STDOUT).strip()
def reset():
    subprocess.run(psql+['-q'], input='truncate quickbooks_invoice_intents; update bookings set quickbooks_invoice_id=null,quickbooks_invoice_status=null;', text=True, check=True)
def blocked():
    sql(request)
    result=json.loads(sql(begin))
    assert result['state']=='unknown' and not result.get('lease_token'), ('unsafe fresh POST authorization',result)

errors=[]
for pending in (False, True):
    reset()
    if pending: sql(request)
    sql(start)
    sql(clear)
    try: blocked()
    except AssertionError as e: errors.append(str(e))
    else: print('PASS old ambiguous clear remains blocked; preexisting pending=',pending)

# Old successful receipt is still usable by new code, without another POST.
reset()
sql(start)
sql("update bookings set quickbooks_invoice_id='991',quickbooks_invoice_status='open',quickbooks_invoice_url='https://example.test/invoice/991';")
result=json.loads(sql(begin))
assert result['state']=='confirmed' and result['invoice_id']=='991',result
print('PASS old successful receipt preserved')

# Both sessions exist while old provider work is in-flight; fixture advisory lock
# orders the handoff only, never supplies application locking or provider state.
reset()
old=subprocess.Popen(psql+['-Atq'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
assert old.stdin and old.stdout and old.stderr
old.stdin.write('set role service_role; select pg_advisory_lock(777);'+start+"select 'OLD_STARTED';\n")
old.stdin.flush()
while True:
    line=old.stdout.readline()
    if 'OLD_STARTED' in line: break
    if not line: raise RuntimeError('old session failed')
new=subprocess.Popen(psql+['-Atq'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
assert new.stdin and new.stdout and new.stderr
new.stdin.write('set role service_role; select pg_advisory_lock(777);'+request+begin+'select pg_advisory_unlock(777);\n')
new.stdin.close()
old.stdin.write(clear+'select pg_advisory_unlock(777);\n')
old.stdin.close()
old.wait(timeout=15)
new.wait(timeout=15)
out=new.stdout.read()
assert old.returncode==0 and new.returncode==0,(old.stderr.read(),new.stderr.read())
result=next(json.loads(line) for line in out.splitlines() if line.startswith('{'))
if result['state']!='unknown' or result.get('lease_token'): errors.append('two sessions: unsafe fresh POST authorization '+str(result))
else: print('PASS two-session old ambiguous/new handoff blocks fresh lease')
reset()
sql(request)
result=json.loads(sql(begin))
assert result['state']=='processing' and result['lease_token'],result
assert sql('select state from quickbooks_invoice_intents')=='processing'
print('PASS new begin retains processing lease')
assert not errors, '\n'.join(errors)
