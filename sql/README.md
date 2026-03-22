# Backend SQL

`001_canonical_schema.sql` documents the workflow-compatible public schema the current backend supports.

## Canonical Booking Status Model
- `pending_admin`: student created a paid booking and uploaded a receipt, waiting for admin payment review
- `pending_teacher`: teacher needs to accept or reject the request
- `accepted`: teacher accepted and stored the class meeting link
- `rejected`: request was rejected by admin or teacher
- `cancelled`: student, teacher, or admin cancelled the request before completion
- `completed`: class finished

## Canonical Payment Proof Status Model
- `pending`
- `approved`
- `rejected`

## Workflow Summary
- Demo bookings skip payment and start in `pending_teacher`
- Paid bookings start in `pending_admin`
- Admin approval moves paid bookings to `pending_teacher`
- Teacher acceptance requires a meeting link and moves the booking to `accepted`
- Notifications are written to the `notifications` table for persistent workflow events

## Deployed Schema Notes
- The live Supabase project still enforces the legacy booking enum `pending_payment`, `payment_under_review`, `confirmed`, `completed`, and `cancelled`.
- The backend maps that legacy enum into the canonical API statuses (`pending_admin`, `pending_teacher`, `accepted`, `rejected`, `cancelled`, `completed`) so the dashboards stay consistent before a full SQL migration.
- The live project currently stores bank transfer details in `site_settings` with `bank_*` keys when a dedicated `bank_details` table is not present.
- The current backend derives `isDemo` from zero-priced bookings and demo-style notes instead of requiring a separate `bookings.is_demo` column.
- The current backend derives `receiptUrl` from the latest `payment_proofs` row instead of requiring a separate `bookings.receipt_url` column.
- Legacy tables such as `class_sessions` may still exist in the database, but the active workflow now uses `bookings`, `payment_proofs`, and `notifications`.
