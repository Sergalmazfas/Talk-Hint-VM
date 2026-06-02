#!/bin/bash
set -e

# Post-merge setup for TalkHint.
# Runs automatically after a task is merged. Must be idempotent and
# non-interactive (stdin is closed during post-merge).
#
# NOTE: We intentionally do NOT run `drizzle-kit push` here. This project's
# dev DB contains an out-of-schema `user_sessions` table (created by the
# startup schema-ensure in server/db.ts), which makes drizzle-kit push prompt
# interactively for a rename — that would hang (stdin closed) and fail the
# merge, while `--force` could truncate data. Additive schema changes are
# applied per-task via direct SQL ALTERs instead.

echo "[post-merge] Installing dependencies..."
npm install --no-audit --no-fund

echo "[post-merge] Done."
