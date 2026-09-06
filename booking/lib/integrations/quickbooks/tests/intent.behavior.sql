begin;
set local role service_role;
do $$
declare c jsonb; second_claim jsonb; bad jsonb;
begin
 for bad in select value from jsonb_array_elements('[{"realtor":null,"property":{},"lineItems":[{}],"defaultItemId":"1"},{"realtor":{"email":true},"property":{"street_address":"Test"},"lineItems":[{"description":"Photo","amountCents":100}],"defaultItemId":"1"}]') loop
  begin
   perform public.begin_quickbooks_invoice('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','123','sandbox',bad);
   raise exception 'malformed snapshot accepted' using errcode='P9999';
  exception when others then if sqlstate='P9999' then raise; end if; end;
 end loop;
 c := public.begin_quickbooks_invoice('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','123','sandbox','{"realtor":{"email":"a@example.test"},"lineItems":[{"description":"Photo","amountCents":10000}],"property":{"street_address":"Test"},"defaultItemId":"1"}');
 if c->>'state' <> 'processing' or c->>'lease_token' is null then raise exception 'no durable lease'; end if;
 second_claim := public.begin_quickbooks_invoice('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','123','sandbox','{}');
 if second_claim->>'lease_token' is not null then raise exception 'duplicate claimed'; end if;
 if (select quickbooks_invoice_status from bookings limit 1) <> 'creating' then raise exception 'creating not atomic'; end if;
 begin
  perform public.finish_quickbooks_invoice('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(c->>'id')::uuid,(c->>'lease_token')::uuid,'confirmed','42','INV42',10000,10000);
  raise exception 'unstaged receipt accepted' using errcode='P9999';
 exception when others then if sqlstate='P9999' then raise; end if; end;
 perform public.stage_quickbooks_invoice('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(c->>'id')::uuid,(c->>'lease_token')::uuid,jsonb_build_object('PrivateNote','pixel-invoice-intent:'||(c->>'id'),'CustomerRef',jsonb_build_object('value','5'),'Line',jsonb_build_array(jsonb_build_object('Amount',100))));
 if public.finish_quickbooks_invoice('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(c->>'id')::uuid,gen_random_uuid(),'confirmed','42','INV42',10000,10000) then raise exception 'wrong lease accepted'; end if;
 if not public.finish_quickbooks_invoice('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(c->>'id')::uuid,(c->>'lease_token')::uuid,'confirmed','42','INV42',10000,10000) then raise exception 'receipt failed'; end if;
 if (select quickbooks_invoice_id from bookings limit 1) <> '42' or (select state from quickbooks_invoice_intents limit 1) <> 'confirmed' then raise exception 'receipt/link not atomic'; end if;
 if public.finish_quickbooks_invoice('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(c->>'id')::uuid,(c->>'lease_token')::uuid,'confirmed','43','INV43',10000,10000) then raise exception 'terminal receipt overwritten'; end if;
end $$;
rollback;
