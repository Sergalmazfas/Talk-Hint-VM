# Secretary release checklist

The `secretary_tasks` table and indexes are declared in `shared/schema.ts`.
They have been applied to the **development** database and verified by the
startup schema-drift check. A missing table or column must be treated as a
release blocker: task creation, reports and notifications require it.

## Production database

This project uses Replit-managed PostgreSQL. **Publish** computes the
development-to-production schema diff and applies it to the production database.
Publish this version before using Secretary on the deployed app. Confirm the
schema diff in the Publish UI, then check startup logs for `database schema OK`.
Do not add a production DDL script, invoke `db:push` in a deployment build, or
create the table at server startup: those bypass the managed Publish flow.

## iOS notification

The Secretary report is always stored before a notification is attempted.
Normal alert APNs requires a separate Apple Push Notification Service
certificate/key pair in `APNS_ALERT_CERT_PEM` and `APNS_ALERT_KEY_PEM`. The VoIP
Services certificate and PushKit token are **only** for incoming calls and
cannot deliver a report notification. Without a registered alert token and a
working APNs certificate the saved report can still be opened from the
Secretary tab, but the ordinary push has not been delivered.

## Controlled end-to-end check

Build the iOS target in Xcode, use a real device for APNs, and place a
controlled test call **only after** the owner of the recipient number agrees.
Verify PREPARE confirmation, the review/start action, the Twilio call and
AI disclosure, cloned speech, a soft follow-up answer, persisted transcript,
the report at the top of its detail screen, and the report notification.
Neither a live PSTN call nor an iOS build has been run in this workspace.