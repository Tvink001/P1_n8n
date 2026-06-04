# Google Sheets Schema — Lead Automation

Column-by-column reference for all three Sheet tabs. Source of truth is `project_specs.md` section 7 — this file is a published copy for portfolio viewers.

---

## Tab: `leads`

| Col | Name | Type | Notes |
|-----|------|------|-------|
| A | timestamp | ISO datetime | Set by Google Form auto-write |
| B | name | string | From form field |
| C | phone | string | Normalized to +380XXXXXXXXX by workflow 01 |
| D | email | string | Lowercased by workflow 01 |
| E | message | string | Free-text from form |
| F | source | string | UTM source or "Instagram" / "Website" / "Referral" / "Google Ads" / "Facebook" |
| G | budget | string | "<$500" / "$500-$1500" / "$1500-$5000" / "$5000+" |
| H | status | enum | new / taken / in_progress / done |
| I | assigned_to | string | Telegram username of manager who clicked the first action button |
| J | telegram_message_id | int | Captured from Telegram Send response; used by workflow 02 for `editMessageText` |
| K | telegram_chat_id | string | Which chat the message was sent to (senior or junior) |
| L | routed_to | enum | senior / junior — used by workflow 04 to know where to send the reminder |
| M | score | int 1–10 | From AI qualification (workflow 01 after Prompt 6) |
| N | category | enum | hot / warm / cold |
| O | reason | string | ≤10-word AI explanation |
| P | reminder_sent_at | ISO datetime, nullable | Idempotency guard for workflow 04 — empty until reminder is sent |
| Q | created_at | ISO datetime | Same as column A on first write |
| R | updated_at | ISO datetime | Last modification timestamp |

---

## Tab: `_errors`

Append-only error log. Written by workflow 03 (Error Alerts) whenever any workflow throws.

| Col | Name | Type | Notes |
|-----|------|------|-------|
| A | timestamp | ISO datetime | Time the error was captured |
| B | workflow_id | string | n8n workflow ID |
| C | workflow_name | string | Human-readable workflow name |
| D | node | string | Last node that executed before the error |
| E | error_text | string | Error message, trimmed to 500 chars |
| F | payload | JSON string | Sanitized execution data — token/key/password/secret fields replaced with [REDACTED] |

---

## Tab: `_config`

Single-row config table. Row 1 = headers, Row 2 = values. Read by workflows 01 and 04.

| Col | Name | Type | Example |
|-----|------|------|---------|
| A | chat_id | string | -1001234567890 |
| B | senior_chat_id | string | -1001111111111 |
| C | junior_chat_id | string | -1002222222222 |
| D | manager_list | CSV | username1,username2 |
| E | working_hours | JSON | `{"start":"09:00","end":"22:00","tz":"Europe/Kyiv"}` |
| F | reminder_threshold_minutes | int | 30 |

> **Heads-up for portfolio viewers:** All chat IDs are negative integers for Telegram groups. `manager_list` usernames are without the `@` prefix. The `working_hours` column is reserved for a future business-hours gate — workflow 04 does not yet read it in v1.
