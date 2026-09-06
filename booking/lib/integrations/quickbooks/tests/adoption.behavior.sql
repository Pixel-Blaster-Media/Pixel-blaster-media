begin;
do $$
declare c jsonb; body jsonb; org uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; bid uuid:='11111111-1111-4111-8111-111111111111'; actor uuid:='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
begin
 if has_table_privilege('authenticated','public.quickbooks_invoice_intents','SELECT') or has_table_privilege('service_role','public.quickbooks_invoice_intents','UPDATE') or has_function_privilege('authenticated','public.adopt_quickbooks_invoice(uuid,uuid,uuid,text,text,text,jsonb,text,text,integer,integer)','EXECUTE') then raise exception 'browser/control-plane privileges'; end if;
 if not public.request_quickbooks_invoice(org,bid) or not public.request_quickbooks_invoice(org,bid) then raise exception 'request failed'; end if;
 if (select count(*) from quickbooks_invoice_intents)<>1 or (select quickbooks_invoice_status from bookings where id=bid)<>'billing_pending' then raise exception 'pending intent not durable/idempotent'; end if;
 c:=public.begin_quickbooks_invoice(org,bid,'123','sandbox','{"realtor":{"email":"a@example.test"},"lineItems":[{"description":"Photo","amountCents":10000}],"property":{"street_address":"Test"},"defaultItemId":"1"}');
 body:=jsonb_build_object('PrivateNote','pixel-invoice-intent:'||(c->>'id'),'CustomerRef',jsonb_build_object('value','5'),'Line',jsonb_build_array(jsonb_build_object('Amount',100)));
 if not public.stage_quickbooks_invoice(org,(c->>'id')::uuid,(c->>'lease_token')::uuid,body) then raise exception 'stage failed'; end if;
 if public.stage_quickbooks_invoice(org,(c->>'id')::uuid,(c->>'lease_token')::uuid,body) then raise exception 'body restaged'; end if;
 if public.adopt_quickbooks_invoice(org,bid,actor,'Verified invoice','123','sandbox',body,'42','INV42',10000,10000) then raise exception 'active lease adopted'; end if;
 update quickbooks_invoice_intents set lease_expires_at=now()-interval '1 second' where id=(c->>'id')::uuid;
 if public.finish_quickbooks_invoice(org,(c->>'id')::uuid,(c->>'lease_token')::uuid,'confirmed','42','INV42',10000,10000) then raise exception 'expired completion accepted'; end if;
 if public.adopt_quickbooks_invoice(org,bid,actor,'Verified invoice','456','sandbox',body,'42','INV42',10000,10000) then raise exception 'wrong realm adopted'; end if;
 if public.adopt_quickbooks_invoice(org,bid,actor,'Verified invoice','123','sandbox','{}','42','INV42',10000,10000) then raise exception 'wrong body adopted'; end if;
 begin
  perform public.adopt_quickbooks_invoice(org,bid,gen_random_uuid(),'Verified invoice','123','sandbox',body,'42','INV42',10000,10000);
  raise exception 'foreign actor adopted' using errcode='P9999';
 exception when others then if sqlerrm<>'invoice adoption unauthorized' then raise; end if; end;
 if not public.adopt_quickbooks_invoice(org,bid,actor,'Verified invoice','123','sandbox',body,'42','INV42',10000,10000) then raise exception 'safe adoption failed'; end if;
 if not public.adopt_quickbooks_invoice(org,bid,actor,'Verified invoice','123','sandbox',body,'42','INV42',10000,10000) then raise exception 'adoption replay failed'; end if;
 if public.adopt_quickbooks_invoice(org,bid,actor,'Verified invoice','123','sandbox',body,'43','INV43',10000,10000) then raise exception 'adoption changed identity'; end if;
 if (select quickbooks_invoice_id from bookings where id=bid)<>'42' or (select adopted_by from quickbooks_invoice_intents where booking_id=bid)<>actor then raise exception 'adoption evidence missing'; end if;
end $$;
rollback;

-- Force the booking update to fail: the intent must not become confirmed.
begin;
create function public.test_fail_invoice_link() returns trigger language plpgsql as $$ begin if new.quickbooks_invoice_id is not null then raise exception 'injected link failure'; end if; return new; end $$;
create trigger test_fail_invoice_link before update on public.bookings for each row execute function public.test_fail_invoice_link();
do $$
declare c jsonb; org uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; bid uuid:='11111111-1111-4111-8111-111111111111';
begin
 c:=public.begin_quickbooks_invoice(org,bid,'123','sandbox','{"realtor":{"email":"a@example.test"},"lineItems":[{"description":"Photo","amountCents":10000}],"property":{"street_address":"Test"},"defaultItemId":"1"}');
 begin
  perform public.stage_quickbooks_invoice(org,(c->>'id')::uuid,(c->>'lease_token')::uuid,jsonb_build_object('PrivateNote','pixel-invoice-intent:'||(c->>'id'),'CustomerRef',jsonb_build_object('value','5'),'Line',jsonb_build_array(jsonb_build_object('Amount',100))));
  perform public.finish_quickbooks_invoice(org,(c->>'id')::uuid,(c->>'lease_token')::uuid,'confirmed','42','INV42',10000,10000);
  raise exception 'injection not reached';
 exception when others then if sqlerrm<>'injected link failure' then raise; end if; end;
 if (select state from quickbooks_invoice_intents where booking_id=bid)<>'processing' or (select quickbooks_invoice_id from bookings where id=bid) is not null then raise exception 'partial receipt committed'; end if;
 update quickbooks_invoice_intents set lease_expires_at=now()-interval '1 second' where booking_id=bid;
 c:=public.begin_quickbooks_invoice(org,bid,'123','sandbox','{}');
 if c->>'state'<>'unknown' or c->>'lease_token' is not null then raise exception 'expired intent reauthorized'; end if;
end $$;
rollback;
