#!/usr/bin/env python3
"""PostgreSQL 17, Unix-socket-only disposable security/threshold regression.
Run: python3 scripts/verify-tenant-listing-search-postgres.py [--red]
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PG = Path(os.environ.get('POSTGRES_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
if not (PG / 'initdb').exists():
    PG = Path(shutil.which('initdb') or '/missing/initdb').parent
assert ') 17.' in subprocess.check_output([str(PG/'postgres'), '--version'], text=True), 'PostgreSQL 17 required'
A='11111111-1111-4111-8111-111111111111'
B='22222222-2222-4222-8222-222222222222'
OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
ADMIN='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
LOCAL='10000000-0000-4000-8000-000000000001'
FOREIGN='20000000-0000-4000-8000-000000000001'
MIGRATION=ROOT/'supabase/migrations/20260905100300_listing_integrity_admin_search.sql'
with tempfile.TemporaryDirectory(prefix='pixel-tenant-') as tmp, tempfile.TemporaryDirectory(prefix='pt-', dir='/tmp') as socket:
    data=Path(tmp)/'data'
    subprocess.run([str(PG/'initdb'), '-D',str(data),'-A','trust','-U','postgres','--no-locale'],check=True,stdout=subprocess.DEVNULL)
    subprocess.run([str(PG/'pg_ctl'),'-D',str(data),'-l',str(Path(tmp)/'postgres.log'),'-o',f"-F -k {socket} -c listen_addresses=''",'-w','start'],check=True,stdout=subprocess.DEVNULL)
    cmd=[str(PG/'psql'),'-X','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',socket,'-U','postgres','-d','postgres']
    def sql(text, error=None):
        p=subprocess.run(cmd+['-c',text],text=True,capture_output=True)
        if error:
            assert p.returncode != 0 and error in p.stderr, (error,p.stdout,p.stderr)
        else:
            assert p.returncode == 0, p.stderr
        return p.stdout.strip()
    def file(path):
        subprocess.run(cmd+['-f',str(path)],check=True,stdout=subprocess.DEVNULL)
    def auth(text, who=OWNER):
        return f"begin; set local role authenticated; set local request.jwt.claim.sub='{who}'; {text}; rollback;"
    def listing(prop=FOREIGN, owner=OWNER, booking='null', slug='attack'):
        return f"insert into listing_websites(organization_id,owner_id,property_id,booking_id,slug,is_published) values('{A}','{owner}','{prop}',{booking},'{slug}',true)"
    try:
        file(ROOT/'tests/postgres/tenant-listing-search-bootstrap.sql')
        baseline=(ROOT/'supabase/migrations/20260514183501_saas_tenant_isolation.sql').read_text()
        sql(baseline[baseline.index('create or replace function public.current_organization_id()'):baseline.index('-- ---------------------------------------------------------------------------',baseline.index('to authenticated;')+len('to authenticated;'))])
        sql(baseline[baseline.index('drop policy if exists "listing_websites: public published read"'):baseline.index('comment on function public.is_organization_admin')])
        # Tenant RLS on related rows cannot protect service-role listing reads.
        for table in ['profiles','properties','bookings']:
            sql(f"alter table {table} enable row level security; create policy scoped_read on {table} for select to authenticated using (organization_id=public.current_organization_id());")
        sql(auth(listing()))
        sql(auth(listing(),ADMIN))
        print('BASELINE authenticated realtor AND admin foreign-property INSERT accepted',flush=True)
        sql(auth(listing('20000000-0000-4000-8000-000000000002')), 'listing_websites_property_idx')
        print('BASELINE existing-listing unique-index counterexample rejected',flush=True)
        if '--red' in sys.argv:
            sql(auth(listing()),'23503')
        # Migration must fail atomically, not silently delete historical poison.
        sql(listing())
        migration=MIGRATION.read_text()
        sql('begin;'+migration+'commit;', '23503')
        assert sql("select count(*) from pg_constraint where conname='listing_property_owner_tenant_fk'")=='0'
        sql("delete from listing_websites where slug='attack'")
        sql('begin;'+migration+'rollback;')
        assert sql("select count(*) from pg_constraint where conname='listing_property_owner_tenant_fk'")=='0'
        sql('begin;'+migration+'commit;')
        for who in [OWNER,ADMIN]:
            sql(auth(listing(),who), '42501')
        # Service role bypasses RLS but cannot bypass structural ownership.
        sql('begin; set local role service_role;'+listing()+';rollback;', 'listing_property_owner_tenant_fk')
        sql(auth(listing(LOCAL,slug='valid')))
        sql(auth(listing(LOCAL,owner='dddddddd-dddd-4ddd-8ddd-dddddddddddd'),ADMIN), '42501')
        sql(auth(listing(LOCAL,booking="'30000000-0000-4000-8000-000000000002'")), '42501')
        sql(auth(listing(LOCAL,booking="'30000000-0000-4000-8000-000000000001'")))
        sql(listing(LOCAL,booking="'30000000-0000-4000-8000-000000000001'",slug='valid'))
        sql(auth("update listing_websites set property_id='"+FOREIGN+"' where slug='valid'"), '42501')
        sql(f"update properties set owner_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' where id='{LOCAL}'",'listing_property_owner_tenant_fk')
        sql(f"update profiles set organization_id='{B}' where id='{OWNER}'",'listing_owner_tenant_fk')
        sql("update bookings set property_id='20000000-0000-4000-8000-000000000002' where id='30000000-0000-4000-8000-000000000001'",'listing_booking_owner_tenant_fk')
        sql("delete from bookings where id='30000000-0000-4000-8000-000000000001'")
        assert sql("select booking_id is null and organization_id is not null and owner_id is not null from listing_websites where slug='valid'")=='t'
        print('GREEN structural insert/update/parent-change, policy and nullable booking deletion checks passed',flush=True)
        file(ROOT/'supabase/migrations/20260905100400_admin_search.sql')
        if '--search-red' in sys.argv:
            threshold=(ROOT/'tests/postgres/tenant-search-thresholds.sql').read_text()
            # Execute the old search-after-500 algorithm on the identical fixtures.
            threshold=threshold.replace("result:=public.admin_booking_search('11111111-1111-4111-8111-111111111111','beyond-cap','all',null);", "select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) into result from (select * from bookings where organization_id='11111111-1111-4111-8111-111111111111' order by created_at desc limit 500) b where 'beyond-cap'=any(b.services);")
            sql(threshold)
        # Check every existing display mapping in real PostgreSQL, not just SQL text.
        import re
        services=(ROOT/'lib/booking/services.ts').read_text()
        labels=dict(re.findall(r'id: "([^"]+)",\s+label: "([^"]+)"',services[:services.index('export const PREFERRED_TIMES')]))
        labels.update(re.findall(r'^  (\w+): "([^"]+)"',services,re.M))
        labels['unknown_custom_service']='unknown_custom_service'
        for slug,label in labels.items():
            quote=lambda value: "'"+value.replace("'","''")+"'"
            fixture=f"insert into bookings(id,organization_id,property_id,owner_id,status,services) select md5('label-'||g)::uuid,'{A}','{LOCAL}','{OWNER}','confirmed',array[{quote(slug)}] from generate_series(1,51) g;"
            for query in [slug,label]:
                check=f"do $$ begin if jsonb_array_length(public.admin_booking_search('{A}',{quote(query)},'all',null))<>51 then raise exception 'display-label threshold failed: {label}'; end if; end $$;"
                sql('begin;'+fixture+f"set local role authenticated; set local request.jwt.claim.sub='{ADMIN}';"+check+'rollback;')
        print('GREEN all legacy/catalog display-label and raw-slug thresholds passed',flush=True)
        file(ROOT/'tests/postgres/tenant-search-order.sql')
        file(ROOT/'tests/postgres/tenant-search-thresholds.sql')
        print('GREEN search/pagination/full-history thresholds passed',flush=True)
    finally:
        subprocess.run([str(PG/'pg_ctl'),'-D',str(data),'-m','immediate','-w','stop'],stdout=subprocess.DEVNULL,check=True)
