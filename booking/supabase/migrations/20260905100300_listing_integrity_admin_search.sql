-- Additive: fail the transaction on historical inconsistency; never repair/delete rows.
create unique index listing_profile_tenant_key on public.profiles(id, organization_id);
create unique index listing_property_owner_tenant_key on public.properties(id, owner_id, organization_id);
create unique index listing_booking_owner_tenant_key on public.bookings(id, property_id, owner_id, organization_id);
alter table public.listing_websites
  add constraint listing_owner_tenant_fk foreign key(owner_id, organization_id)
    references public.profiles(id, organization_id),
  add constraint listing_property_owner_tenant_fk foreign key(property_id, owner_id, organization_id)
    references public.properties(id, owner_id, organization_id) on delete cascade,
  add constraint listing_booking_owner_tenant_fk foreign key(booking_id, property_id, owner_id, organization_id)
    references public.bookings(id, property_id, owner_id, organization_id) on delete set null (booking_id);

-- Policies are invoker-scoped; constraints also fence privileged writers/parent changes.
drop policy "listing_websites: owner or org admin insert" on public.listing_websites;
drop policy "listing_websites: owner or org admin update" on public.listing_websites;
create policy "listing_websites: owner or org admin insert" on public.listing_websites for insert to authenticated
with check (
 ((owner_id=auth.uid() and organization_id=public.current_organization_id()) or public.is_organization_admin(organization_id))
 and exists(select 1 from public.profiles p where p.id=owner_id and p.organization_id=listing_websites.organization_id)
 and exists(select 1 from public.properties p where p.id=property_id and p.owner_id=listing_websites.owner_id and p.organization_id=listing_websites.organization_id)
 and (booking_id is null or exists(select 1 from public.bookings b where b.id=booking_id and b.property_id=listing_websites.property_id and b.owner_id=listing_websites.owner_id and b.organization_id=listing_websites.organization_id))
);
create policy "listing_websites: owner or org admin update" on public.listing_websites for update to authenticated
using ((owner_id=auth.uid() and organization_id=public.current_organization_id()) or public.is_organization_admin(organization_id))
with check (
 ((owner_id=auth.uid() and organization_id=public.current_organization_id()) or public.is_organization_admin(organization_id))
 and exists(select 1 from public.profiles p where p.id=owner_id and p.organization_id=listing_websites.organization_id)
 and exists(select 1 from public.properties p where p.id=property_id and p.owner_id=listing_websites.owner_id and p.organization_id=listing_websites.organization_id)
 and (booking_id is null or exists(select 1 from public.bookings b where b.id=booking_id and b.property_id=listing_websites.property_id and b.owner_id=listing_websites.owner_id and b.organization_id=listing_websites.organization_id))
);
