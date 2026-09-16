#!/usr/bin/env python3
"""Finite local prerequisite: disposable Unix socket only; no remote target option."""
import hashlib, json, os, subprocess, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
PG = Path('/opt/homebrew/opt/postgresql@17/bin')
ENV = {k: v for k, v in os.environ.items() if k in ('PATH', 'HOME', 'TMPDIR')}
ENV.update(LC_ALL='C', NEXT_TELEMETRY_DISABLED='1')

def main():
    out = Path(os.environ['PF_EVIDENCE_DIR']).resolve()
    assert out.is_dir() and out.stat().st_mode & 0o077 == 0, 'protected evidence directory required'
    os.umask(0o077)
    def run(args, **kwargs):
        r = subprocess.run(args, cwd=ROOT, env=ENV, text=True, capture_output=True, timeout=240, **kwargs)
        if r.returncode:
            raise RuntimeError(r.stdout + r.stderr)
        return r.stdout
    files = ['tests/postgres/atomic-booking-bootstrap.sql',
        'supabase/migrations/20260717211142_auth_user_metadata_update_provisioning.sql',
        'supabase/migrations/20260718202432_atomic_public_booking_outbox.sql',
        'supabase/migrations/20260720173000_persist_quiet_admin_bookings.sql',
        'supabase/migrations/20260719124500_integration_outbox_recovery_reconciliation.sql',
        'supabase/migrations/20260905100500_booking_effect_generations.sql',
        'supabase/migrations/20260905100700_booking_reminder_recovery.sql',
        'supabase/migrations/20260811225000_canonical_media_releases.sql',
        'supabase/migrations/20260912120000_photo_finals_ingest.sql',
        'supabase/migrations/20260912160000_photo_finals_packages.sql',
        'supabase/migrations/20260912200000_photo_finals_application.sql',
        'supabase/migrations/20260912210000_photo_finals_download_accounting.sql',
        'supabase/migrations/20260912220000_photo_finals_recovery.sql',
        'supabase/migrations/20260915120000_photo_finals_resume.sql']
    inputs = sorted(set(files + ['tests/postgres/canonical-media-bootstrap.sql'] + [str(p.relative_to(ROOT)) for p in (ROOT/'lib/media').rglob('*.ts')] + ['scripts/photo-finals-small-pilot.mjs','tests/postgres/photo-finals-small-pilot.integration.mjs', 'scripts/verify-photo-finals-small-pilot.py']))
    hashes = {f: hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in inputs}
    binding = hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()
    (out/'source-binding.json').write_text(json.dumps({'binding':binding,'files':hashes}, indent=2))
    with tempfile.TemporaryDirectory(prefix='pf-small-',dir='/tmp') as t:
        data = str(Path(t)/'data')
        run([str(PG/'initdb'),'-D',data,'-A','trust','-U','postgres','--no-locale'])
        run([str(PG/'pg_ctl'),'-D',data,'-l',str(Path(t)/'pg.log'),'-o',f'-F -k {t} -c listen_addresses=','-w','start'])
        try:
            cmd=[str(PG/'psql'),'-X','-qAt','-h',t,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1']
            for i,f in enumerate(files):
                run(cmd+['-f',str(ROOT/f)])
                if i == 0:
                    # Reuse the existing media bootstrap's listing relation verbatim.
                    text=(ROOT/'tests/postgres/canonical-media-bootstrap.sql').read_text()
                    listing=text[text.index('create table public.listing_websites'):text.index('grant all')]
                    run(cmd+['-c',listing+'alter table bookings add column reminder_sent_at timestamptz;'])
            ENV.update(PF_TEST_SOCKET=t,PF_TEST_PSQL=str(PG/'psql'),PF_EVIDENCE_DIR=str(out),PF_SMALL_BINDING=binding)
            print(run(['node',str(ROOT/'tests/postgres/photo-finals-small-pilot.integration.mjs')]),end='')
        finally:
            run([str(PG/'pg_ctl'),'-D',data,'-m','immediate','-w','stop'])
    assert not Path(t).exists()
    (out/'local-cleanup.json').write_text(json.dumps({'socket':t,'databaseDirectoryRemoved':True,'postgresStopped':True}))
    print('Disposable native database stopped and removed.')
if __name__ == '__main__':
    main()
