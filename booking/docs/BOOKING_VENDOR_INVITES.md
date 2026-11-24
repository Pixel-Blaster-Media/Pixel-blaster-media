# Vendor invites

On the admin calendar, open a manual shoot and use **Add vendor**. Choose a
saved vendor or type an email. A saved vendor can include an optional direct
HTTPS logo image URL, shown only in admin. Existing shoots offer the same
control in **Vendor invites**, where an admin can attach more vendors, cancel
an individual invitation, or retry an unsynced change.

The existing booking calendar connection sends a separate event to each
vendor. Only the property address, schedule, and explicitly entered vendor
instructions are copied. The underlying booking event, guest list, client
information, billing and unrelated notes are not shared. The vendor events
do not block extra availability. Booking moves and cancellations synchronize
attached invitations; a failed update is surfaced as pending and can be
retried from the booking.

## Release checks

Apply the additive vendor migration to the verified target before deploying
the app. Do not apply the full bootstrap to live data. Follow the existing
production release and review gate. Validate the admin Calendar and booking
detail entry points in staging with a controlled test calendar and recipient;
verify create, move and cancellation and confirm the regular client invite is
unchanged. Do not use real client or vendor addresses in release smoke tests.
