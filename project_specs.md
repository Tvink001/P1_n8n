# Project Specification — Lead Automation

This is the technical source of truth for the project. Sections marked **filled** contain decisions that are known before development begins. Sections marked **TBD via Prompt N** are completed during development; Claude Code fills them after the corresponding build step, and the operator reviews.

This file is read by Claude Code on every prompt (per `CLAUDE.md` Rule 1) and written to whenever new decisions get made (per `CLAUDE.md` Rule 6). The operator approves changes before they're considered committed.

---

# 1. Product Summary [filled]

The system processes incoming leads end-to-end without manual intervention. A user (typically a customer of the operator's client) fills out a Google Form. Within sixty seconds, the lead arrives in a Telegram chat as a formatted message with three inline buttons. A manager taps one — the lead's status updates in the source Google Sheet, and the original Telegram message edits in place to reflect the new status. If the lead sits untouched for thirty minutes, the system pings the same chat once with a reminder.

The Sheet is also the operator-facing data store — managers can scan, sort, and export historical leads from there without any custom UI. The Telegram bot is the action surface; the Sheet is the record.

**Primary user (in production case):** an SMB client (a salon, dance studio, agency, etc.) who currently handles leads manually and loses 30%+ to slow response times.

**Primary user (in this portfolio instance):** the operator. The instance is private; viewers see the result through screenshots, GIF demo, and the committed workflow JSON. They do not redeploy it themselves.

**Pipeline:** Google Form → Google Sheet → n8n Cloud (validate, dedupe, AI qualify, route) → Telegram inline buttons → Sheet status update + message edit. Stale-lead reminder runs on a 15-minute cron.

---

# 2. Tech Stack [filled]

| Layer | Choice | Rationale |
|---|---|---|
| Workflow engine | n8n Cloud | Managed infrastructure, public API enabled by default, zero ops overhead for portfolio use; Pro plan recommended (see section 2.1) |
| Lead intake | Google Form linked to Google Sheet | Zero infrastructure; native binding writes form responses to sheet automatically |
| Data layer | Google Sheets API v4 (service account auth) | Service account survives token expiry, OAuth doesn't; no per-user consent flow |
| Notifications | Telegram Bot API | Free; the channel SMBs already live in; inline keyboards enable one-tap actions |
| AI qualification | Anthropic Claude Haiku 4.5 (native n8n node) | ~1 sec latency, ~$0.0001 per call, reliable JSON output mode |
| Error alerts | Gmail SMTP via App Password | Free; lands in an inbox the operator checks anyway |
| Function-node language | JavaScript only | n8n Function nodes do not support TypeScript |

## 2.1 Why n8n Cloud, not self-hosted

This is a deliberate architectural choice. Documented here so the decision survives into Project 2 planning and into the README case narrative.

The Cloud choice fits this specific project for four reasons.

**This is a portfolio case, not a shippable template.** The operator owns the live instance; viewers see the result via README + GIF + workflow JSON in git. There is no audience that needs to "redeploy from scratch." Cloud's "no ops overhead" trade-off is fully positive here — zero downside.

**n8n Cloud fully supports the public API.** Verified via official n8n docs (May 2026). The API is enabled by default on every Cloud instance, identical curl signatures to self-hosted, same `X-N8N-API-KEY` authentication, same `/api/v1/*` endpoints. This means n8n-MCP works against Cloud exactly as against self-hosted — no functional loss for the MCP-first development loop. The env var `N8N_PUBLIC_API_DISABLED` only exists on self-hosted and is the only way to disable the API; on Cloud, disabling is not possible.

**Infrastructure-grade concerns become Cloud's responsibility, not the operator's.** Encryption key management, persistent volume, database engine, automated daily backups, scheduled OS patches, TLS — all handled by Cloud. The operator's responsibility shrinks to: workflow design, credential hygiene, idempotency patterns, error trigger linkage, and AI graceful fallback. These remaining concerns are still the high-signal ones for a portfolio reviewer.

**Cost matches the use case.** Cloud Pro at ~$50/month covers expected portfolio load with significant headroom (10k+ executions/month, 5 active workflows, unlimited concurrent workflows). Self-hosting on Railway free tier would save ~$50/month but adds 10–15 hours of operational work and a non-trivial single-point-of-failure (lose the encryption key → lose all credentials, with no Cloud-managed recovery).

For a future production deployment to a paying client who requires data residency or compliance constraints, self-hosting becomes valid and the architecture transfers. The workflow JSON itself is portable between Cloud and self-hosted.

## 2.2 Deviations from Brief

The original brief (`Six_portfolio_projects.pdf`, Project 1) was written from the position of a shippable template — a client could redeploy the system on their own infrastructure. This build deliberately repositions as a private portfolio case study. The deviations below are intentional and need to be visible to anyone reviewing the project later (operator's future self, Project 2 planner, hiring reviewer).

**Deployment model.** Brief requires *"README contains a step-by-step '15-minute deploy' guide and exported JSON workflows"* as a Definition of Done item. This build keeps the exported JSON workflows in `workflows/` (DR-source + audit trail), but replaces the `docs/setup-guide.md` with `docs/architecture.md` — a portfolio-grade architectural overview, not a redeploy recipe. The live instance stays private. A reviewer reads architecture, watches the GIF, inspects the committed JSON; they do not redeploy. If a future paying client requires a redeploy package, `docs/setup-guide.md` can be produced from `project_specs.md` sections 3.1–3.5 and 9 in a few hours; nothing is locked out.

**Infrastructure target.** Brief allows both n8n Cloud (free tier, 14-day trial) and self-hosted on Railway. This build commits to Cloud Pro for the reasons documented in 2.1. Self-hosted remains a documented alternative path; the workflow JSON is portable.

**AI model version.** Brief specifies Claude 3.5 Haiku (current at the time of brief writing). This build uses `claude-haiku-4-5` — the current production model as of May 2026. This is a routine version refresh, not a meaningful deviation, but worth noting so future versions of this project can be similarly updated.

**Scope additions, not subtractions.** All three WOW features from the brief (smart routing, AI qualification, auto-reminders) are in scope. Additionally, the build introduces an Apps Script bridge as an optional polish (brief's "webhook via Apps Script" alternative path), and an optional synthetic lead generator (workflow 05) for demo recording. Neither is required by the brief.

---

# 3. Production Configuration [filled]

The Cloud variant has a much smaller operator-side configuration footprint than self-hosted, because Cloud manages infrastructure concerns. What remains is workflow-level discipline.

## 3.1 n8n Cloud instance setup

- Sign up at n8n.cloud, choose Pro plan (Starter works for the build itself but Pro's higher execution quota matters once the portfolio piece is live and being demoed)
- Note the instance URL — format `<workspace>.app.n8n.cloud`
- Enable the public API key in the UI: **Settings → n8n API → Create an API key**. Label `claude-code-mcp`. Save the key in a password manager. The API is enabled by default on every Cloud instance — no env vars to set.

## 3.2 Workflow-level execution settings (per workflow, via UI)

Configured in each workflow's **Workflow Settings** panel:

- **Timeout Workflow:** 5 minutes (300 seconds). Prevents runaway executions.
- **Save successful production executions:** false. Reduces clutter; failures are saved automatically.
- **Save failed production executions:** true.
- **Save manual executions:** false.
- **Caller policy:** "Workflow's own settings" (default).
- **Error workflow:** set to the ID of workflow `03-error-alerts` (set after workflow 03 is created in Prompt 5).

Claude Code applies these via `n8n_update_partial_workflow` with `updateSettings` op after creating each workflow.

## 3.3 Credentials — what lives in the n8n UI

Created manually by the operator before the corresponding workflow is built. IDs pasted to Claude Code in chat for use in workflow JSON.

| Credential | Type | n8n ID | Used in | Created before Prompt |
|---|---|---|---|---|
| Sheets Trigger SA | `googleSheetsTriggerOAuth2Api` | `qEKqA8Kw3WPO0o19` | Workflow 01 trigger | Prompt 3 |
| Sheets Action SA | `googleSheetsOAuth2Api` | `vPYba8prk7sfff5g` | Workflows 01, 02, 03, 04 actions | Prompt 3 |
| Telegram Bot | `telegramApi` | `zQbslAZbcF6pqKFh` | Workflows 01, 02, 04 | Prompt 3 |
| Gmail SMTP | `smtp` | `JeOMZkGm0aM2IwRG` | Workflow 03 | Prompt 5 |
| Anthropic API | `anthropicApi` | `09N35JJ0R0zrY1rS` | Workflow 01 (after Prompt 6) | Prompt 6 |

## 3.4 Backup strategy

n8n Cloud handles instance-level backups automatically — Postgres snapshots, credential encryption, persistent storage. The operator's responsibility is at the workflow-definition level:

- Every workflow build ends with `n8n_get_workflow({mode: 'full'})` → save to `workflows/NN-name.json` → commit to git
- This makes the git repo the disaster-recovery source — if the Cloud instance is ever lost, the workflow JSON can be re-imported into a fresh instance
- The committed JSON is also the audit trail: every change to a workflow surfaces as a git diff

Restore drill: once during build (after Prompt 8), confirm that re-importing one workflow JSON from git into a freshly-created test n8n instance produces a working copy. This validates that committed JSON is sufficient for recovery.

## 3.5 `.env.example` (operator-side, for local tooling)

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_DEFAULT_CHAT_ID=
TELEGRAM_SENIOR_CHAT_ID=
TELEGRAM_JUNIOR_CHAT_ID=
ANTHROPIC_API_KEY=
GMAIL_SMTP_USER=
GMAIL_SMTP_APP_PASSWORD=
GMAIL_ALERT_RECIPIENT=
N8N_MCP_API_KEY=
N8N_CLOUD_URL=https://<workspace>.app.n8n.cloud
```

`N8N_MCP_API_KEY` and `N8N_CLOUD_URL` are referenced by `.mcp.json` via shell environment. Service-account credentials (`credentials.json`) live in the n8n Credentials UI, not in `.env`.

---

# 4. MCP Setup [filled]

## 4.1 `.mcp.json` in project root

```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "npx",
      "args": ["n8n-mcp"],
      "env": {
        "MCP_MODE": "stdio",
        "LOG_LEVEL": "error",
        "DISABLE_CONSOLE_OUTPUT": "true",
        "N8N_API_URL": "${N8N_CLOUD_URL}",
        "N8N_API_KEY": "${N8N_MCP_API_KEY}"
      }
    },
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```

Both `N8N_CLOUD_URL` and `N8N_MCP_API_KEY` live in the shell environment, not in `.mcp.json`. `MCP_MODE=stdio` is required — without it, debug output corrupts the JSON-RPC stream.

## 4.2 n8n API key generation

In the n8n Cloud UI: **Settings → n8n API → Create an API key**. Label `claude-code-mcp`. Save to a password manager. No env vars on the n8n side need to change — the public API is enabled by default on Cloud and cannot be disabled.

## 4.3 Smoke test before first build prompt

After `.mcp.json` is configured and shell env is set, verify connectivity by asking Claude Code to run `tools_documentation()`, then `n8n_health_check()`, then `n8n_list_workflows()`. All three should succeed before Prompt 1.

---

# 5. MCP Build Process [filled]

This is the loop Claude Code runs inside every workflow-building prompt. It replaces any concept of manual UI assembly.

1. **Discovery.** Call `tools_documentation()` on first MCP use in a session. Then `search_templates({query: '...'})` — if a template hits ≥80% of the goal, use `get_template` → `n8n_deploy_template` → `n8n_autofix_workflow` and skip to step 5.
2. **Node research.** In parallel for every node type the workflow needs: `search_nodes` to find the exact type string, then `get_node({detail: 'standard', includeExamples: true})` to see real configuration examples.
3. **Node validation.** `validate_node({mode: 'minimal'})` on each draft node, then `validate_node({mode: 'full', profile: 'runtime'})` before assembling.
4. **Build & local validation.** Assemble the workflow JSON. Reference credentials by ID only — never inline values. Run `validate_workflow(workflow)` locally before pushing. If complex expressions are present, also `validate_workflow_connections` and `validate_workflow_expressions`.
5. **Push.** `n8n_create_workflow` to push to the Cloud instance. If errors: `n8n_autofix_workflow({id})`, then `n8n_validate_workflow({id})` again.
6. **Apply workflow settings.** `n8n_update_partial_workflow` with `updateSettings` to set timeout, execution save policy, and error workflow per section 3.2.
7. **Activation.** The public API cannot toggle the active flag. Ask the operator to activate in the UI, wait for confirmation.
8. **Test execution.** `n8n_test_workflow({workflowId})` with a sample payload matching the trigger's input shape (for triggers, use the test data parameter). For Telegram or Sheets triggers, the MCP auto-detects the trigger type.
9. **Verify.** `n8n_executions({action: 'list', workflowId})` then `n8n_executions({action: 'get', id: latest})` — every node must be green. If any node failed, read the failure detail, fix via partial update, re-test.
10. **Iterate.** Use `n8n_update_partial_workflow` with diff operations — never `n8n_update_full_workflow`. Operations available: `addNode`, `removeNode`, `updateNode`, `moveNode`, `enable/disableNode`, `add/remove/updateConnection`, `updateSettings`, `updateName`, `add/removeTag`, `cleanStaleConnections`.
11. **Export.** Once green, `n8n_get_workflow({id, mode: 'full'})` and save the result to `workflows/NN-name.json`. Commit.

---

# 6. Architecture Overview [filled]

Four workflows. Each is a pipe with the same skeleton: trigger → validation/normalization → idempotency check → business logic (with AI where applicable) → output → workflow-level error trigger pointing at `03-error-alerts`.

| # | Workflow | Trigger | Purpose |
|---|---|---|---|
| 01 | new-lead-processing | Google Sheets Trigger (`googleSheetsTriggerOAuth2Api`) on `leads` tab, polls every 1 min | Validate, dedupe, qualify via Claude, route by tier, notify Telegram |
| 02 | callback-handler | Telegram Trigger with `callback_query` in `updates` | Update Sheet status, edit original message, acknowledge callback |
| 03 | error-alerts | Error Trigger (workflow-scoped, wired from all other workflows) | Log to `_errors` tab, send sanitized email alert |
| 04 | stale-lead-reminder | Cron Trigger, every 15 minutes | Find `status='new'` rows older than 30 min, ping once, mark reminded |

Error flow: workflows 01, 02, 04 each have `settings.errorWorkflow` set to the ID of workflow 03. Workflow 03 has no error workflow itself (would create infinite recursion). All errors from anywhere in the system surface in `_errors` and in operator email.

---

# 7. Data Model [filled]

## 7.1 Sheet `leads`

| Col | Name | Type | Notes |
|---|---|---|---|
| A | timestamp | ISO datetime | Set by Google Form auto-write |
| B | name | string | From form field |
| C | phone | string | Normalized to +380XXXXXXXXX by workflow 01 |
| D | email | string | Lowercased by workflow 01 |
| E | message | string | Free-text from form |
| F | source | string | UTM source or "Instagram"/"Website"/"Referral"/"Google Ads"/"Facebook" |
| G | budget | string | "<$500" / "$500-$1500" / "$1500-$5000" / "$5000+" |
| H | status | enum | new / taken / in_progress / done |
| I | assigned_to | string | Telegram username of manager who clicked first action button |
| J | telegram_message_id | int | Captured from Telegram Send response; used by workflow 02 for `editMessageText` |
| K | telegram_chat_id | string | Which chat the message was sent to (senior or junior) |
| L | routed_to | enum | senior / junior — for workflow 04 to know where to ping reminder |
| M | score | int 1–10 | From AI qualification, populated in Prompt 6 |
| N | category | enum | hot / warm / cold |
| O | reason | string | ≤10-word AI explanation |
| P | reminder_sent_at | ISO datetime, nullable | Idempotency guard for workflow 04 |
| Q | created_at | ISO datetime | Same as A on first write |
| R | updated_at | ISO datetime | Last modification |

## 7.2 Sheet `_errors`

| Col | Name | Type |
|---|---|---|
| A | timestamp | ISO datetime |
| B | workflow_id | string |
| C | workflow_name | string |
| D | node | string |
| E | error_text | string (stack trimmed to 500 chars) |
| F | payload | JSON string (sanitized — token/key/password/secret fields redacted) |

## 7.3 Sheet `_config`

Single-row config table. Workflow 01 reads it once at the top.

| Col | Name | Type | Example |
|---|---|---|---|
| A | chat_id | string | -1001234567890 |
| B | senior_chat_id | string | -1001111111111 |
| C | junior_chat_id | string | -1002222222222 |
| D | manager_list | CSV | username1,username2 |
| E | working_hours | JSON | `{"start":"09:00","end":"22:00","tz":"Europe/Kyiv"}` |
| F | reminder_threshold_minutes | int | 30 |

---

# 8. Telegram Message Format & Callback Contract [filled]

## 8.1 Message format (Markdown)

```
{category_emoji} *{category_label} lead — {score}/10* — {reason}

👤 *{name}*
📞 `{phone}`
✉️ {email}
💬 {message}
📍 {source} · 💰 {budget}
🕐 {timestamp_formatted}
```

`category_emoji`: 🔥 hot / 🟡 warm / ⚪ cold
`category_label`: matches category
For workflow 01 minimal (before AI is added in Prompt 6), the first line is omitted.

## 8.2 Edited message after button click

The original message gets edited via `editMessageText`. The format appends a status footer:

```
{original_message}

✅ Взято: @{username} · {action_label}
```

`action_label`: "В работе" / "Завершено" depending on which button was clicked.

## 8.3 `callback_data` contract

Format: `lead_{row_id}_{action}` where:
- `row_id` is the Sheet row number of the lead (int)
- `action` ∈ `{taken, in_progress, done}`

Workflow 02 parses by splitting on `_`. Validation: if `action` is not in the allowed set, throw to error path.

## 8.4 Inline keyboard

Three buttons in a single row:
- `🟢 Взять` → `lead_{row_id}_taken`
- `⚙️ В работе` → `lead_{row_id}_in_progress`
- `✅ Завершено` → `lead_{row_id}_done`

---

# 9. Integration Rules [filled]

## 9.1 Google Sheets

- Service Account auth, not OAuth. Create in Google Cloud Console → Credentials → Service Account → download `credentials.json`. Share the Sheet with the service-account email as Editor.
- The **Sheets Trigger** uses credential type `googleSheetsTriggerOAuth2Api`. The **Sheets action** node uses `googleSheetsOAuth2Api`. These are different credential types — pasting the action credential into the trigger fails with "Forbidden."
- The Sheets Trigger requires Drive scope in addition to Sheets scope.
- First poll establishes baseline state; pre-existing rows are not emitted as new. Use "Fetch Test Event" in the UI once to seed.

## 9.2 Telegram

- Get group `chat_id` via `@getmyidbot` — negative for groups, like `-1001234567890`.
- Telegram Trigger is webhook-based. n8n Cloud auto-registers the webhook via `setWebhook` on workflow activation using the instance's Cloud URL.
- **`additionalFields.updates` must include `callback_query`** for inline buttons to fire. The default is `["message"]` only. Without `callback_query`, button clicks silently disappear. This is the single most common Telegram-trigger bug.
- One webhook URL per bot token. Two parallel workflows on the same bot conflict.
- Rate limits: 30 msg/sec globally, 1 msg/sec per chat. Use Wait node when looping.
- When sending a message that will be edited later, capture `message_id` from the Telegram node's response and write it to the Sheet row. Without it, `editMessageText` in workflow 02 has nothing to target.

## 9.3 Anthropic Claude API

- Use the native n8n Anthropic node, model `claude-haiku-4-5`.
- Wrap the `Parse AI Response` Function node in try/catch. On JSON-parse failure, default to `{score: 0, category: 'cold', reason: 'parse_error'}` and continue. Never throw — a real lead reaching Telegram is more important than a clean qualification.
- Hard-cap `max_tokens` at 256 for qualification. Prevents runaway cost on bad inputs.
- `temperature=0` for deterministic scoring.

## 9.4 Idempotency

- Dedupe on `email + phone` before any Telegram send or Sheets append. The IF "Is Duplicate" branch ends in a No-Op for duplicates — no side effect.
- For the optional Apps Script webhook variant, store a `processed_events` reference (sheet keyed by event hash) with 24–72 hour TTL.
- Webhook nodes return 200 OK immediately (Respond Mode: `Immediately`) — Telegram retries on non-2xx within minutes.
- Workflow 04 uses `reminder_sent_at` as its idempotency guard. Without setting it after a successful ping, every cron tick re-pings the same lead.

## 9.5 Retries

- HTTP nodes: `Retry On Fail=true`, `Max Tries=3`, `Wait Between Tries=2000ms`. This is linear retry, not exponential.
- For rate-limited APIs, build exponential retry manually with Code + Wait + IF: 1s → 2s → 4s → 8s, with jitter.

## 9.6 Credential gotchas to verify during every build

- `addConnection` in MCP takes four separate string params: `source`, `target`, `sourcePort`, `targetPort`. For IF nodes, also `branch: "true" | "false"` — without it, both branches silently route to the same target.
- `active: true` on `n8n_create_workflow` is silently ignored. Activation is always manual.
- All node positions default to `[0, 0]`. Use `moveNode` after create, or lay out manually in the UI.
- Credentials cannot be created via MCP. Create them in the UI first; reference by ID in workflow JSON. AI commonly generates references to credential IDs that don't exist — the workflow validates clean but fails at runtime with "Credential not found."
- Never trust node defaults. Many nodes (Slack, Telegram, Anthropic) need explicit `select` / `channelId` / model overrides, or they validate but fail at runtime.

---

# 10. Workflow 01 — New Lead Processing [filled via Prompt 1 spec]

Trigger → validate → normalize → dedupe → (AI qualify in Prompt 6) → (route in Prompt 7) → Telegram send → write message IDs to Sheet.

## 10.0a Build status (Prompt 7 architectural revisions — complete 2026-05-18)

Two structural changes shipped during Prompt 7 testing that are now part of the canonical WF01 design:

**1. Sheets Trigger event changed from `rowAdded` to `anyUpdate`.**
Reason: with `rowAdded`, the trigger captures a row as "new" as soon as ANY cell in it has a value. If the operator types row cell-by-cell directly in Google Sheets, the trigger fires for the partial row (e.g. only name + timestamp filled) and the cursor advances past that row. Subsequent typing in the same row never re-triggers, so the lead is lost. With `anyUpdate`, the trigger re-fires every time any cell in the row changes — so by the time the row is complete, a final cell-edit triggers the now-valid lead through the pipeline.

**2. Check Duplicate now has an "already processed" guard.**
Necessary because `anyUpdate` would otherwise re-fire every time WF02's callback writes back to status/assigned_to/updated_at. The guard: if the matched row's `telegram_message_id` is already populated, treat as duplicate and skip. Logic:
```javascript
const tmid = currentRow?.json.telegram_message_id;
const alreadyProcessed = tmid !== undefined && tmid !== null && String(tmid).trim() !== '';
const isDuplicate = alreadyProcessed || matches.length > 1;
```

**3. Split Leads (Split In Batches) loop added between Normalize and Check Duplicate.**
Solves the "N new rows → only first one processes" trigger-batching bug. Validate Fields now uses `$('Sheets Trigger').all()` to capture ALL new rows, Normalize maps the full array, and Split Leads iterates them one at a time through the AI/routing/Telegram body. Loop closes by routing both Skip Duplicate and Write Telegram IDs back to Split Leads's input.

**4. Validate Fields softened: no throw on empty batch.**
Trigger fires for partial rows now (per change 1), so Validate Fields drops invalid rows silently rather than throwing. Throwing would wake WF03 for what's really mid-typing user behavior. Empty batch = `return []` = workflow ends harmlessly.

**Final shipped chain:**
```
Sheets Trigger (anyUpdate) → Load Config → Validate Fields → Normalize
  ├─ Get All Rows (parallel, dead-end output, accessed via $('Get All Rows').all() inside loop)
  └─ Split Leads (batchSize=1)
       └─ Check Duplicate (skips already-processed via telegram_message_id check) → Is Duplicate
            ├─ Skip Duplicate ────────────────────────────────────────────→ back to Split Leads
            └─ Qualify Lead → Parse AI Response → Format Message → Route By Tier
                 ├─ (senior) Send Senior ──────────→ Write Telegram IDs ─┐
                 └─ (junior) Send Junior ──────────→ Write Telegram IDs ─┤
                                                              back to Split Leads
```

16 nodes total, 18 valid connections. The General `chat_id` from `_config` A2 is no longer used in the routing flow — every lead lands in either Seniors or Juniors based on AI category + budget. General remains a fallback in WF04's Build Reminder only.

## 10.0 Build status (Prompt 3 — complete)

- **Workflow ID:** `k48UMsaDfLuev3fj`
- **Active version:** 41 (as of 2026-05-18)
- **Exported JSON:** `workflows/01-new-lead-processing.json`
- **Architecture:** Linear chain (NOT parallel branches). `$('NodeName')` cannot reach across branches in n8n `executionOrder: v1`, so Load Config was moved inline:
  `Sheets Trigger → Load Config → Validate Fields → Normalize → Get All Rows → Check Duplicate → Is Duplicate → [Skip Duplicate | Send Message → Write Telegram IDs]`
- **Credential refs (live):**
  - `googleSheetsTriggerOAuth2Api`: `qEKqA8Kw3WPO0o19` ("Google Sheets Trigger account")
  - `googleSheetsOAuth2Api`: `vPYba8prk7sfff5g` ("Google Sheets account")
  - `telegramApi`: `zQbslAZbcF6pqKFh` ("Telegram account")
- **Sheets Trigger sheetName GID:** `589358449` (numeric GID of `leads` tab — name mode not supported for trigger, only `list`/`url`/`id` with numeric value)

## 10.1 Minimal build — Prompt 3 (nodes 01–10)

**Node 01 — Google Sheets Trigger**
- Type: `n8n-nodes-base.googleSheetsTrigger`
- Credential: `googleSheetsTriggerOAuth2Api`
- Params: `event: rowAdded`, `sheetName: leads`, `spreadsheetId: {{SPREADSHEET_ID}}`
- Polling: 1-minute default on n8n Cloud (cannot be changed via API — UI only)
- Output field name for row number: likely `_rowNumber` or `row_number` — verify with `get_node(n8n-nodes-base.googleSheetsTrigger)` during build; used in `callback_data`
- Gotcha: click "Fetch Test Event" in the UI once after activating to seed baseline state; without it, pre-existing rows may flood as "new" on first activation

**Node 02 — Sheets "Load Config"**
- Type: `n8n-nodes-base.googleSheets`, operation: read rows
- Credential: `googleSheetsOAuth2Api`
- Params: `sheetName: _config`, `range: A2:F2` (row 1 = headers, row 2 = data), `returnAll: false`
- Output keys: `chat_id`, `senior_chat_id`, `junior_chat_id`, `manager_list`, `working_hours`, `reminder_threshold_minutes`
- Gotcha: exact operation name (`getRows` vs `read`) — verify with `get_node(n8n-nodes-base.googleSheets, operation: read)` during build

**Node 03 — Code "Validate Fields"**
- Type: `n8n-nodes-base.code`, mode: `runOnceForAllItems`
- Receives Load Config's output as `$input` (config data), so pulls lead from `$('Sheets Trigger').first()` directly.
- JavaScript (final, shipped):
```javascript
console.log('ValidateFields start');
const d = $('Sheets Trigger').first().json;
const required = ['name', 'phone', 'email', 'message', 'budget'];
const missing = required.filter(f => !String(d[f] ?? '').trim());
if (missing.length) throw new Error('Missing required fields: ' + missing.join(', '));
console.log('ValidateFields OK:', d.email);
return [{ json: d }];
```
- Throwing here routes to WF03 (error alert) once WF03 exists. Correct — a malformed row is an error worth logging.

**Node 04 — Code "Normalize"**
- Type: `n8n-nodes-base.code`, mode: `runOnceForAllItems`
- JavaScript:
```javascript
console.log('Normalize start');
const d = { ...$input.first().json };
const digits = String(d.phone || '').replace(/\D/g, '');
if (digits.startsWith('380') && digits.length === 12) d.phone = '+' + digits;
else if (digits.startsWith('0') && digits.length === 10) d.phone = '+38' + digits;
else if (digits.length === 9) d.phone = '+380' + digits;
d.email = String(d.email || '').toLowerCase().trim();
d.name = String(d.name || '').trim();
console.log('Normalize done:', d.phone, d.email);
return [{ json: d }];
```
- Phones not matching any pattern pass through unchanged (lead still reaches Telegram; operator can fix manually)

**Node 05 — Sheets "Get All Rows"**
- Type: `n8n-nodes-base.googleSheets`, operation: `getRows` / read all, `returnAll: true`
- Credential: `googleSheetsOAuth2Api`
- Sheet: `leads` — returns every data row as a separate item with column headers as keys

**Node 06 — Code "Check Duplicate"**
- Type: `n8n-nodes-base.code`, mode: `runOnceForAllItems`
- References Normalize output via `$('Normalize')` for the current lead, and reads `$input.all()` (Get All Rows output) for the sheet rows
- Match key: **email only** (phone match-by-equality is unreliable — `lead.phone` is normalized `+380…`, sheet rows have raw `0…` / numeric form; mixing types breaks `===`)
- `row_number` extraction: extracted from the Get All Rows matched item with the highest `row_number` value. The Sheets Trigger does **not** emit `row_number`, so this is the only reliable source
- JavaScript (final, shipped):
```javascript
console.log('CheckDuplicate start');
const lead = $('Normalize').first().json;
const rows = $input.all();
const email = lead.email?.toLowerCase() || '';

const matches = rows.filter(r => r.json.email?.toLowerCase() === email);
const isDuplicate = matches.length > 1;

// row_number comes from Get All Rows (Sheets action) — Trigger doesn't emit it
const currentRow = matches.reduce((max, r) =>
  (!max || Number(r.json.row_number) > Number(max.json.row_number)) ? r : max, null);
const row_number = currentRow?.json.row_number ?? null;

console.log('CheckDuplicate:', isDuplicate, 'matches:', matches.length, 'row_number:', row_number);
return [{ json: { ...lead, isDuplicate, row_number } }];
```
- Logic: Google Form already wrote the row before the trigger fired, so `matches.length === 1` = only this row = not a dup; `> 1` = prior row exists with same email
- `row_number` of the newly added row is the largest among matches (newest at bottom of sheet)

**Node 07 — IF "Is Duplicate"**
- Type: `n8n-nodes-base.if`
- Condition: `{{ $json.isDuplicate }}` equals `true` (boolean)
- True branch → Node 08 (No-Op)
- False branch → Node 09 (Telegram Send in minimal; Anthropic Qualify in Prompt 6)

**Node 08 — No-Op "Skip Duplicate"**
- Type: `n8n-nodes-base.noOp`
- No config — execution stops silently here for duplicates; no Telegram send, no Sheet write

**Node 09 — Telegram "Send Message"** *(minimal build — replaced by Format Message + Send in Prompt 6)*
- Type: `n8n-nodes-base.telegram` (v1.2)
- Credential: `telegramApi`
- Resource: `Message`, Operation: `sendMessage`
- Params (final, shipped):
  - `chatId`: `"={{ $('Load Config').first().json.chat_id }}"` (**plain string** — do NOT wrap in `__rl`; Telegram node's `chatId` is `type: string`, not `resourceLocator`)
  - `text`: single-line n8n expression assembling section 8.1 format (no AI header yet):
    ```
    ={{ '👤 *' + $json.name + '*\n📞 `' + $json.phone + '`\n✉️ ' + $json.email + '\n💬 ' + $json.message + '\n📍 ' + ($json.source || '') + ' · 💰 ' + ($json.budget || '') + '\n🕐 ' + new Date($json.timestamp).toLocaleString('ru-RU', {timeZone: 'Europe/Kyiv'}) }}
    ```
  - `replyMarkup`: `"inlineKeyboard"` (top-level)
  - `inlineKeyboard.rows[0].row.buttons`: 3 buttons each with `text` and `additionalFields.callback_data = "={{ 'lead_' + $json.row_number + '_taken' }}"` (and `_in_progress`, `_done`)
  - `additionalFields.parse_mode`: `"Markdown"` (legacy Markdown; **not** MarkdownV2)
  - `additionalFields.appendAttribution`: `false` (suppresses the "Sent via n8n" footer)
- Gotcha (resolved): the autofix validator suggests wrapping `chatId` in resource-locator format at 50% confidence. Ignore — it breaks the field and causes "chat not found" at runtime.
- Gotcha (resolved): bot must be a member of the target Telegram group before this call works; verify via `curl -k https://api.telegram.org/bot<TOKEN>/getUpdates`.

**Node 10 — Sheets "Write Telegram IDs"**
- Type: `n8n-nodes-base.googleSheets` (v4.7), operation: `update`
- Credential: `googleSheetsOAuth2Api`
- Match row by: `row_number` (declared in `columns.matchingColumns: ["row_number"]`)
- `columns.value` (final, shipped):
  - `row_number` ← `{{ $('Check Duplicate').first().json.row_number }}` (Check Duplicate is where row_number is computed)
  - `telegram_message_id` ← `{{ $json.result.message_id }}` (from Send Message output)
  - `telegram_chat_id` ← `{{ $('Load Config').first().json.chat_id }}`
  - `status` ← `"new"`
  - `created_at` ← `{{ new Date().toISOString() }}`
  - `updated_at` ← `{{ new Date().toISOString() }}`
- The MCP `n8n_validate_workflow` validator still flags "Range required / Values required" for the v4.7 update operation — these are false positives from v3 schema logic. The shipped `columns` resourceMapper structure is the correct v4.7 format and runs cleanly.
- Gotcha: Telegram Send response field path is `result.message_id` (confirmed at runtime). Without capturing it, WF02 cannot call `editMessageText`.

## 10.2 AI Qualification additions — Prompt 6

Inserted between Node 07 false branch and Node 09 (Telegram Send).

**Node 09a — Anthropic "Qualify Lead"**
- Type: TBD — run `search_nodes("anthropic")` during build to confirm exact type string. Expected candidates: `n8n-nodes-base.anthropic` (native) or `@n8n/n8n-nodes-langchain.lmChatAnthropic` (LangChain sub-node). Use the native node — it does not require an AI chain parent.
- Credential: `anthropicApi`
- Key params: `model: claude-haiku-4-5`, `maxTokens: 256`, `temperature: 0`
- System prompt: see section 14
- User prompt: `Message: {{ $json.message }}\nBudget: {{ $json.budget }}`
- Gotcha: exact parameter names (`systemPrompt` vs `system`, `prompt` vs `userMessage`) depend on node version — verify with `get_node` during build

**Node 09b — Code "Parse AI Response"**
- Type: `n8n-nodes-base.code`, mode: `runOnceForAllItems`
- JavaScript:
```javascript
console.log('ParseAI start');
const raw = $input.first().json?.message?.content?.[0]?.text
  || $input.first().json?.content || '';
let result;
try {
  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
  result = JSON.parse(cleaned);
  if (!result.score || !result.category || !result.reason) throw new Error('incomplete');
} catch (e) {
  console.log('ParseAI fallback:', e.message);
  result = { score: 0, category: 'cold', reason: 'parse_error' };
}
const lead = $('Check Duplicate').first().json;
console.log('ParseAI done:', result.category, result.score);
return [{ json: { ...lead, score: result.score, category: result.category, reason: result.reason } }];
```
- `json?.message?.content?.[0]?.text` is the LangChain-node output path. If using the native Anthropic node, the path differs — update this after verifying the actual node output structure during build.
- NEVER throw from this node — `catch` returns fallback and the lead continues to Telegram

**Node 09c — Code "Format Message"**
- Type: `n8n-nodes-base.code`, mode: `runOnceForAllItems`
- JavaScript:
```javascript
console.log('FormatMessage start');
const d = $input.first().json;
const ts = new Date(d.timestamp).toLocaleString('ru-RU', { timeZone: 'Europe/Kyiv' });
const icons = { hot: '🔥', warm: '🟡', cold: '⚪' };
const labels = { hot: 'Горячий', warm: 'Тёплый', cold: 'Холодный' };
const header = d.score > 0
  ? `${icons[d.category]||'⚪'} *${labels[d.category]||d.category} лид — ${d.score}/10* — ${d.reason}\n\n`
  : '';
const text = `${header}👤 *${d.name}*\n📞 \`${d.phone}\`\n✉️ ${d.email}\n💬 ${d.message}\n📍 ${d.source} · 💰 ${d.budget}\n🕐 ${ts}`;
console.log('FormatMessage done, cat:', d.category);
return [{ json: { ...d, telegramText: text } }];
```
- Minimal build (Prompt 3) builds this message inline via n8n expressions in Node 09; this Code node is added in Prompt 6 when the AI header makes expressions too complex

## 10.3 Smart Routing additions — Prompt 7 — ✅ SHIPPED 2026-05-18

**Final architecture (linear chain extended):**
```
Sheets Trigger → Load Config → Validate Fields → Normalize → Get All Rows → Check Duplicate → Is Duplicate
  → (true)  Skip Duplicate
  → (false) Qualify Lead → Parse AI Response → Format Message → Route By Tier
              → (out 0 = senior) Send Senior ↘
              → (out 1 = junior) Send Junior ↗  Write Telegram IDs
```

**Routing rules (codified inside Format Message Code node, evaluated once and persisted as `$json.routed_to`):**
```javascript
const senior_budgets = ['$5000+', '$1500-$5000'];
const isSenior = (cat === 'hot') || senior_budgets.includes(d.budget);
const routed_to = isSenior ? 'senior' : 'junior';
```

Routing decisions:
- Senior gets any lead with AI category `hot` OR budget tier `$5000+` OR `$1500-$5000`. Floor + ceiling: high-value by intent OR by money.
- Junior gets everything else (warm, cold, the AI parse_error fallback).
- The decision is computed ONCE in Format Message, written into `$json.routed_to`, then both the Switch and Write Telegram IDs read it. Single source of truth.

**Switch node (`Route By Tier`):** typeVersion 3.4, rules-mode with 2 rules matching `$json.routed_to === 'senior'` (output 0) and `$json.routed_to === 'junior'` (output 1). No fallback output — every lead has `routed_to` set by Format Message so all leads route.

**Send Senior + Send Junior:** two parallel Telegram nodes, identical params except `chatId` (`={{ $('Load Config').first().json.senior_chat_id }}` vs `junior_chat_id`). Both converge directly on Write Telegram IDs (no Merge node needed — only one Switch branch fires per item, so Write Telegram IDs sees one input).

**Write Telegram IDs additions:** new columns `routed_to` (literal), plus dynamic `telegram_chat_id` using `={{ $('Format Message').first().json.routed_to === 'senior' ? $('Load Config').first().json.senior_chat_id : $('Load Config').first().json.junior_chat_id }}` so the sheet records which chat the message was actually sent to (later used by WF04 to ping the right chat).

**Legacy Node 09 → renamed in place:** the original "Send Message" was renamed to "Send Junior" via `n8n_update_partial_workflow` with `updates.name`. n8n auto-updated all referencing connections (`Send Message → Write Telegram IDs` became `Send Junior → Write Telegram IDs` automatically). Then `Send Senior` was added as a new node.



**Node 09d — Switch "Route By Tier"**
- Type: `n8n-nodes-base.switch`
- Input: `{{ $json.category }}` from Parse AI Response
- Senior branch: category `hot` OR budget `$5000+` OR `$1500-$5000`
- Junior branch: everything else (warm, cold, parse_error fallback)
- Two outputs labeled `senior` and `junior`
- Gotcha: Switch node parameter structure for multiple outputs — verify with `get_node(n8n-nodes-base.switch)` during build

**Nodes 09e / 09f — Telegram "Send Senior" / "Send Junior"**
- Same as Node 09 but `chatId` = `$('Load Config').first().json.senior_chat_id` vs `junior_chat_id`
- Both use `telegramText` from Format Message node

**Node 09g — Merge**
- Type: `n8n-nodes-base.merge`
- Mode: `append` — passes whichever branch arrived; does not wait for both (only one branch fires per lead)

**Node 10 (revised) — Sheets "Write All Fields"**
- Same as minimal Node 10 but also writes: `routed_to` (senior/junior), `score`, `category`, `reason`

## 10.4 Definition of Done — Workflow 01

**Minimal (Prompt 3) — ✅ SHIPPED 2026-05-18:**
- Form submission produces Telegram message in the correct chat ≤60s, with name, phone, email, message, source, budget, timestamp formatted per section 8.1, and 3 inline buttons ✅
- Duplicate submission (same email) produces no second Telegram message — `n8n_executions` shows Skip Duplicate path taken ✅ (dedupe key narrowed to email-only; see Node 06 spec)
- `telegram_message_id` and `telegram_chat_id` written to the `leads` row ✅
- All nodes ✓ in `n8n_executions` output (executions 30, 31 green; verified end-to-end) ✅
- Workflow settings applied per section 3.2: timeout=300, save-success=none, save-fail=all, save-manual=false ✅
- `errorWorkflow` setting: **deferred** to Prompt 5 (WF03 doesn't exist yet)
- Exported to `workflows/01-new-lead-processing.json` ✅
- Buttons fire callback queries but no handler exists yet — that's WF02 (Prompt 4)

**After Prompt 6 (AI):** Telegram message includes AI header line with emoji, category, score/10, reason. AI parse failure (bad JSON from model) defaults to cold/0 and lead still reaches Telegram.

**After Prompt 7 (Routing):** Hot/high-budget leads go to `senior_chat_id`; others to `junior_chat_id`. `routed_to` column populated in Sheet.

---

# 11. Workflow 02 — Callback Handler [filled via Prompt 1 spec]

Telegram callback → parse row_id + action → read lead row → prepare edit payload → update Sheet → edit Telegram message → answer callback (clear spinner).

No branching — all action-specific logic is centralized in Code "Prepare Update". This keeps the node count low and the flow linear.

## 11.0 Build status (Prompt 4 — complete)

- **Workflow ID:** `I1mPobKghKgjVazA`
- **Active:** yes
- **Exported JSON:** `workflows/02-callback-handler.json`
- **Architecture:** Linear chain — `Telegram Trigger → Parse Callback → Get All Rows → Prepare Update → Update Status → Edit Message Text → Answer Callback Query`
- **Credentials reused from Prompt 3:** `telegramApi` (`zQbslAZbcF6pqKFh`), `googleSheetsOAuth2Api` (`vPYba8prk7sfff5g`)
- **Webhook URL (auto-registered by Telegram on activation):** `https://onewinnerfourtytwoloosers.app.n8n.cloud/webhook/<n8n-trigger-id>/webhook` — verify via `curl -k https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
- **Verified end-to-end:** executions 37–40 all green (taken/in_progress/done all routed to Sheet + edited message)
- **Decisions made during build (resolving OQ-7, OQ-12):**
  - OQ-7 RESOLVED: `updates` is a **top-level** parameter on `telegramTrigger` v1.3, **not** nested under `additionalFields`. Type: `multiOptions`, value: `["callback_query"]`. The original spec assumption (`additionalFields.updates`) was wrong.
  - OQ-12 RESOLVED: `assigned_to` is always overwritten by the most-recent clicker (per spec "Acceptable for v1"). No guard logic added.
  - Parse Callback handles underscore-containing actions via `parts.slice(2).join('_')` rather than `parts.length === 3` — `in_progress` has 4 underscore-split parts, original spec check would have rejected it
  - `editMessageText` requires explicit `messageType: "message"` (vs `"inlineMessage"`); not documented in original spec
  - `chatId`/`messageId`/`queryId` on Telegram nodes are plain strings — ignore the validator's 50%-confidence `__rl` wrapper suggestion (same lesson as Prompt 3)
  - Get All Rows + filter-by-rowId in Code chosen over single-row range read — simpler, reuses WF01 pattern, sheet is small enough
  - When `telegram_message_id` is empty in the sheet (e.g. row was created before WF01 was fully working), `editMessageText` correctly fails with `Bad Request: message identifier is not specified` — this routes to WF03 once Prompt 5 adds it

## 11.1 Node list — Prompt 4

**Node 01 — Telegram Trigger**
- Type: `n8n-nodes-base.telegramTrigger`
- Credential: `telegramApi` (same bot as WF01 — no conflict; WF01 only sends, WF02 only listens)
- CRITICAL param: updates array must include `callback_query`. In n8n UI: Additional Fields → Updates → add "Callback Query". In workflow JSON: verify exact parameter path with `get_node(n8n-nodes-base.telegramTrigger)` during build.
- Default updates value is `["message"]` only — without adding `callback_query`, button clicks silently disappear with no error
- Webhook: n8n Cloud auto-registers via `setWebhook` on activation using the Cloud instance URL
- Output when callback fires: `$json.callback_query.data` (the button's callback_data string), `$json.callback_query.id` (must be answered), `$json.callback_query.from.username`

**Node 02 — Code "Parse Callback"**
- Type: `n8n-nodes-base.code`, mode: `runOnceForAllItems`
- JavaScript:
```javascript
console.log('ParseCallback start');
const cb = $input.first().json;
const data = cb.callback_query?.data || '';
const queryId = cb.callback_query?.id || '';
const username = cb.callback_query?.from?.username || 'unknown';
const parts = data.split('_'); // format: lead_{rowId}_{action}
if (parts[0] !== 'lead' || parts.length !== 3) throw new Error('Invalid callback_data: ' + data);
const allowed = ['taken', 'in_progress', 'done'];
const action = parts[2];
if (!allowed.includes(action)) throw new Error('Invalid action: ' + action);
console.log('ParseCallback done:', parts[1], action, username);
return [{ json: { rowId: Number(parts[1]), action, queryId, username } }];
```
- Throwing on invalid action routes to WF03. Unknown callback_data (e.g., from another bot sharing the chat) is an error worth logging, not silently ignoring.

**Node 03 — Sheets "Read Lead Row"**
- Type: `n8n-nodes-base.googleSheets`, operation: read
- Credential: `googleSheetsOAuth2Api`
- Reads the single lead row for `rowId` from `$json.rowId`
- Approach: read range `A{{ $json.rowId }}:R{{ $json.rowId }}` with `firstRowIsHeader: false`, then map columns by position (A=timestamp, B=name, ...). OR use `getRows` with returnAll + Code node filter — simpler but reads the whole sheet.
- Exact approach: verify with `get_node(n8n-nodes-base.googleSheets)` during build; choose whichever avoids full-sheet reads (see OQ-6)
- Output must include: `name`, `phone`, `email`, `message`, `source`, `budget`, `timestamp`, `telegram_message_id`, `telegram_chat_id`, `score`, `category`, `reason`

**Node 04 — Code "Prepare Update"**
- Type: `n8n-nodes-base.code`, mode: `runOnceForAllItems`
- Reads Parse Callback output via `$('Parse Callback').first().json`
- JavaScript:
```javascript
console.log('PrepareUpdate start');
const { rowId, action, queryId, username } = $('Parse Callback').first().json;
const lead = $input.first().json;
const labels = { taken: 'Взято', in_progress: 'В работе', done: 'Завершено' };
const icons = { taken: '🟢', in_progress: '⚙️', done: '✅' };
const ts = new Date(lead.timestamp).toLocaleString('ru-RU', { timeZone: 'Europe/Kyiv' });
const catIcons = { hot: '🔥', warm: '🟡', cold: '⚪' };
const header = lead.score > 0
  ? `${catIcons[lead.category]||'⚪'} *${lead.category} лид — ${lead.score}/10* — ${lead.reason}\n\n`
  : '';
const base = `${header}👤 *${lead.name}*\n📞 \`${lead.phone}\`\n✉️ ${lead.email}\n💬 ${lead.message}\n📍 ${lead.source} · 💰 ${lead.budget}\n🕐 ${ts}`;
const editedText = base + `\n\n${icons[action]} ${labels[action]}: @${username}`;
console.log('PrepareUpdate done:', rowId, action);
return [{ json: { rowId, action, queryId, username, editedText, status: action,
  telegramChatId: lead.telegram_chat_id, telegramMessageId: lead.telegram_message_id,
  updatedAt: new Date().toISOString() } }];
```
- If AI not yet added (minimal build before Prompt 6), `lead.score` is 0/null → header omitted → minimal message body rendered

**Node 05 — Sheets "Update Status"**
- Type: `n8n-nodes-base.googleSheets`, operation: `update`
- Credential: `googleSheetsOAuth2Api`
- Row: `{{ $json.rowId }}`
- Columns: `status` ← `{{ $json.status }}`, `assigned_to` ← `{{ $json.username }}`, `updated_at` ← `{{ $json.updatedAt }}`
- Note: `assigned_to` gets whoever clicked the current button. If "done" is clicked by a different person than "taken", `assigned_to` updates to the "done" clicker. Acceptable for v1 (see OQ-12).

**Node 06 — Telegram "Edit Message Text"**
- Type: `n8n-nodes-base.telegram` (v1.2)
- Resource: `message`, Operation: `editMessageText`
- `messageType: "message"` (required — distinguishes from `inlineMessage`)
- `chatId`: `={{ $('Prepare Update').first().json.telegramChatId }}` (plain string, NOT `__rl`)
- `messageId`: `={{ $('Prepare Update').first().json.telegramMessageId }}` (plain string)
- `text`: `={{ $('Prepare Update').first().json.editedText }}`
- `additionalFields.parse_mode`: `"Markdown"`
- `additionalFields.appendAttribution`: `false`
- **`replyMarkup: "inlineKeyboard"` + 3 buttons preserved** — same 3 callback buttons as WF01's original Send Message, with `callback_data` pointing to the SAME row (`$('Parse Callback').first().json.rowId`). Without this, the buttons disappear after first click and the operator can't change status further (revealed during Prompt 6 testing — fixed 2026-05-18).
- Gotcha (resolved earlier): when `telegramMessageId` is null (message_id was never captured in WF01), Telegram returns `Bad Request: message identifier is not specified` — routes to WF03 error alert. Correct fail-loud behavior.

**Node 07 — Telegram "Answer Callback Query"**
- Type: `n8n-nodes-base.telegram`
- Resource: `Callback`, Operation: `Answer Query`
- Params:
  - `queryId`: `{{ $json.queryId }}`
  - `text`: `` (empty — just clears the spinner)
  - `showAlert`: false
- Why: Telegram shows a loading spinner on the button until `answerCallbackQuery` is called. Unanswered queries show a spinner for ~5 seconds then show "Not responding". Answering with empty text clears it instantly.
- Timing: this is the last node, after the Sheet update and message edit are confirmed. If either upstream node fails, this node never runs, which is fine — WF03 handles the error.

## 11.2 Definition of Done — Workflow 02

**Prompt 4 — ✅ SHIPPED 2026-05-18:**
- Each button click updates Sheet `status` column ≤2s ✅ (executions 37–40)
- Telegram message edits in place with the status footer showing `@username` and action label ✅
- Button spinner clears (no "not responding" indicator) ✅ (`answerCallbackQuery` returned `ok: true, result: true`)
- Double-clicking the same button: idempotent (same values overwritten, no error) ✅
- Workflow settings applied per section 3.2: timeout=300, save-success=none, save-fail=all, save-manual=false ✅
- `errorWorkflow` setting: **deferred** to Prompt 5 (WF03 doesn't exist yet — WF02 will be wired to it then)
- Exported to `workflows/02-callback-handler.json` ✅

---

# 12. Workflow 03 — Error Alerts [filled via Prompt 1 spec]

Error Trigger → format + sanitize error data → append to `_errors` → email operator.

No `settings.errorWorkflow` on this workflow itself — that would cause infinite recursion if the alert email fails.

## 12.0 Build status (Prompt 5 — complete)

- **Workflow ID:** `xUPMrswt8FvHxKYU`
- **Active:** yes
- **Exported JSON:** `workflows/03-error-alerts.json`
- **Architecture:** Linear chain — `Error Trigger → Format Error Row → Append Error Row → Send Alert`
- **Credentials:** `googleSheetsOAuth2Api` (`vPYba8prk7sfff5g`), `smtp` (`JeOMZkGm0aM2IwRG`, "Gmail SMTP App Password")
- **errorWorkflow setting:** explicitly **NONE** on WF03 itself (would create infinite recursion if the alert email fails)
- **WF01 and WF02 wired:** both now have `settings.errorWorkflow = "xUPMrswt8FvHxKYU"` — any thrown error in either workflow now triggers WF03
- **Validation:** 0 errors, 7 warnings (all known false positives or cosmetic). The `append` operation in v4.7 doesn't trigger the v3-schema "Range required / Values required" false positive that `update` does
- **Decisions made during build (resolving OQ-10, OQ-11):**
  - OQ-10 RESOLVED: instead of `$execution.url` (uncertain availability in Error Trigger context), built the execution URL manually inside Format Error Row: `https://<workspace>.app.n8n.cloud/workflow/${workflowId}/executions/${executionId}` using `err.workflow.id` and `err.execution.id` from the error payload. Passed downstream as `$json.execution_url` and used in the email body.
  - OQ-11 RESOLVED: SMTP credential ID `JeOMZkGm0aM2IwRG` ("Gmail SMTP App Password"). Alert recipient = `vasilikartem@gmail.com` (same as sender for portfolio scope).
  - Email body uses `$json.execution_url` (the pre-built URL) rather than the runtime expression `$execution.url` — more robust and works without depending on Error Trigger expression context behavior.
  - Append operation works cleanly without `valueInputMode` warning being a real issue — runtime confirms columns are written.

## 12.1 Node list — Prompt 5

**Node 01 — Error Trigger**
- Type: `n8n-nodes-base.errorTrigger`
- No parameters
- Fires when any workflow with `settings.errorWorkflow = WF03_ID` throws an unhandled error
- Input structure (approximate — verify exact field paths during build by running `get_node(n8n-nodes-base.errorTrigger)` or checking a real error execution):
  ```
  {
    workflow: { id: "123", name: "01-new-lead-processing" },
    execution: {
      id: "456",
      lastNodeExecuted: "Sheets Get All Rows",
      error: { message: "401 Unauthorized", stack: "..." },
      data: { ... }
    }
  }
  ```

**Node 02 — Code "Format Error Row"**
- Type: `n8n-nodes-base.code`, mode: `runOnceForAllItems`
- JavaScript:
```javascript
console.log('FormatErrorRow start');
const err = $input.first().json;
const sensitive = /token|key|password|secret|bearer|auth/i;
const sanitize = (obj) => {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  return Object.fromEntries(Object.entries(obj).map(([k, v]) =>
    [k, sensitive.test(k) ? '[REDACTED]' : sanitize(v)]));
};
const payload = JSON.stringify(sanitize(err.execution?.data ?? {})).slice(0, 500);
const now = new Date().toISOString();
console.log('FormatErrorRow done:', err.workflow?.name);
return [{ json: {
  timestamp: now,
  workflow_id: String(err.workflow?.id ?? ''),
  workflow_name: String(err.workflow?.name ?? ''),
  node: String(err.execution?.lastNodeExecuted ?? ''),
  error_text: String(err.execution?.error?.message ?? '').slice(0, 500),
  payload
}}];
```
- Sanitization: any object key matching the regex has its value replaced with `[REDACTED]`. This catches `botToken`, `apiKey`, `password`, `bearerToken`, `authHeader`, etc. Does NOT redact the entire payload — just the sensitive fields — so the error is still debuggable.

**Node 03 — Sheets "Append Error Row"**
- Type: `n8n-nodes-base.googleSheets`, operation: `append`
- Credential: `googleSheetsOAuth2Api`
- Sheet: `_errors`
- Column mapping must match section 7.2 exactly: A=timestamp, B=workflow_id, C=workflow_name, D=node, E=error_text, F=payload
- Gotcha: if the append operation uses column headers as keys, the `_errors` sheet header row must match exactly (case-sensitive, no spaces)

**Node 04 — Email "Send Alert"**
- Type: `n8n-nodes-base.emailSend`
- Credential: `smtp` (Gmail SMTP via App Password)
- SMTP host: `smtp.gmail.com`, port: `587`, TLS: STARTTLS
- Params:
  - `fromEmail`: operator's Gmail address
  - `toEmail`: operator's alert address (can be same as fromEmail)
  - `subject`: `[n8n Error] {{ $json.workflow_name }} — {{ $json.node }} — {{ $json.timestamp.slice(0,16) }}`
  - `text`:
    ```
    Workflow: {{ $json.workflow_name }} (ID: {{ $json.workflow_id }})
    Node: {{ $json.node }}
    Time: {{ $json.timestamp }}
    Error: {{ $json.error_text }}
    
    Payload (sanitized):
    {{ $json.payload }}
    
    Execution URL: {{ $execution.url }}
    ```
  - `$execution.url` is a built-in n8n expression — verify it works in the context of an error trigger execution (see OQ-10)
- Gotcha: Gmail App Password requires 2FA enabled on the account. App Password is 16 chars, entered as SMTP password. Do not use the regular account password.

## 12.2 Definition of Done — Workflow 03

**Prompt 5 — ✅ SHIPPED 2026-05-18 (pending operator manual test):**
- WF03 built, validated (0 errors), active ✅
- WF01 and WF02 wired: both have `settings.errorWorkflow = "xUPMrswt8FvHxKYU"` ✅ (verified via partial update return)
- WF03 itself has no `settings.errorWorkflow` set ✅ (would recurse)
- Exported to `workflows/03-error-alerts.json` ✅
- **Operator manual test pending:** revoke the Sheets credential from WF01, submit a form entry, verify (a) a new row in `_errors` with correct values in all 6 columns; (b) an email in operator's inbox within 60s; (c) `_errors` payload column contains `[REDACTED]` for sensitive keys
- **Self-test already partially confirmed:** WF02 execution 41 errored at `Edit Message Text` because `telegram_message_id` was empty — this should have triggered WF03 since the wiring is now in place; the operator can check `_errors` for it

---

# 13. Workflow 04 — Stale-Lead Reminder [filled via Prompt 1 spec]

Cron every 15 min → load config → get all leads → filter stale → loop: build reminder → send Telegram → mark reminded.

## 13.0 Build status (Prompt 7 — complete)

- **Workflow ID:** `eOgPtcgoV5IbYnHu`
- **Active:** yes
- **Exported JSON:** `workflows/04-stale-lead-reminder.json`
- **Architecture (linear loop):**
  `Cron Trigger → Load Config → Get All Leads → Filter Stale → Split In Batches → Build Reminder → Send Reminder → Wait (1s) → Mark Reminded → loop back to Split In Batches`
- **Credentials:** `googleSheetsOAuth2Api` (`vPYba8prk7sfff5g`), `telegramApi` (`zQbslAZbcF6pqKFh`)
- **errorWorkflow:** wired to WF03 (`xUPMrswt8FvHxKYU`)
- **Idempotency guard:** `reminder_sent_at` column on the `leads` row. Filter Stale skips any row where this is non-empty, so the same lead never gets two reminders. Mark Reminded writes the timestamp AFTER the Send succeeds — if the send fails, the column stays empty and the next cron tick retries naturally. This pattern is reusable in any "fire-once-and-only-once" cron workflow.

## 13.1 Node list — Prompt 7

**Node 01 — Schedule Trigger**
- Type: `n8n-nodes-base.scheduleTrigger`
- Params: `triggerRules: [{ "interval": "minutes", "minutesInterval": 15 }]`
- Output: empty item (trigger metadata only — no lead data yet)

**Node 02 — Sheets "Load Config"**
- Type: `n8n-nodes-base.googleSheets`, operation: read
- Same config as WF01 Node 02 — reads `_config` row 2 for `reminder_threshold_minutes`, `manager_list`, `senior_chat_id`, `junior_chat_id`

**Node 03 — Sheets "Get All Leads"**
- Type: `n8n-nodes-base.googleSheets`, operation: `getRows`, `returnAll: true`
- Sheet: `leads`
- Output: all rows as separate items with column header keys

**Node 04 — Code "Filter Stale"**
- Type: `n8n-nodes-base.code`, mode: `runOnceForAllItems`
- JavaScript:
```javascript
console.log('FilterStale start');
const config = $('Load Config').first().json;
const thresholdMin = Number(config.reminder_threshold_minutes) || 30;
const cutoff = Date.now() - thresholdMin * 60 * 1000;
const stale = $input.all().filter(r => {
  const row = r.json;
  return row.status === 'new'
    && new Date(row.created_at).getTime() < cutoff
    && !row.reminder_sent_at;
}).map(r => ({ json: r.json }));
console.log('FilterStale done, count:', stale.length);
return stale;
```
- Returning an empty array `[]` stops execution cleanly — no Split In Batches, no Telegram sends, no errors
- `created_at` is column Q in section 7.1 (same as timestamp column A on first write)
- `reminder_sent_at` is column P — falsy when empty string or null (both indicate never reminded)

**Node 05 — Split In Batches**
- Type: `n8n-nodes-base.splitInBatches`
- `batchSize`: 1
- Processes one stale lead per iteration. Required for rate-limit compliance (1 msg/sec per Telegram chat).

**Node 06 — Code "Build Reminder"**
- Type: `n8n-nodes-base.code`, mode: `runOnceForEachItem`
- JavaScript:
```javascript
console.log('BuildReminder start');
const lead = $input.first().json;
const config = $('Load Config').first().json;
const chatId = lead.routed_to === 'senior' ? config.senior_chat_id : config.junior_chat_id;
const manager = String(config.manager_list || '').split(',')[0].trim();
const rowId = lead._rowNumber || lead.row_number;
const msg = `⏰ @${manager} — лид ${lead.name} ждёт >30 мин, возьмёт кто-то?\n📞 ${lead.phone} · 💰 ${lead.budget}`;
const keyboard = [[
  { text: '🟢 Взять', callback_data: `lead_${rowId}_taken` },
  { text: '⚙️ В работе', callback_data: `lead_${rowId}_in_progress` },
  { text: '✅ Завершено', callback_data: `lead_${rowId}_done` }
]];
console.log('BuildReminder done, chatId:', chatId, 'rowId:', rowId);
return [{ json: { ...lead, reminderChatId: chatId, reminderMsg: msg, keyboard, rowId } }];
```
- Fallback: if `routed_to` is empty (lead was created before routing was enabled), defaults to `junior_chat_id`. Flag this edge case — see OQ-13.
- `@mention` works in Telegram groups only when the mentioned user is a member. This is the entire value proposition of the WOW feature.
- `keyboard` is built with the same `callback_data` format as WF01, so clicking the reminder's buttons triggers WF02 correctly.

**Node 07 — Telegram "Send Reminder"**
- Type: `n8n-nodes-base.telegram`
- Resource: `Message`, Operation: `Send Message`
- Params:
  - `chatId`: `{{ $json.reminderChatId }}`
  - `text`: `{{ $json.reminderMsg }}`
  - `parseMode`: none — plain text (Markdown not needed; no bold/mono in reminder message)
  - Reply markup: Inline Keyboard from `{{ JSON.stringify({ inline_keyboard: $json.keyboard }) }}`
- Gotcha: same inline keyboard parameter path issue as WF01 Node 09 — verify with `get_node` during build

**Node 08 — Wait** *(rate-limit guard)*
- Type: `n8n-nodes-base.wait`
- `resume`: `timeInterval`, `amount`: 1, `unit`: `seconds`
- Prevents burst-sending when multiple stale leads exist in the same cron tick
- Position: after Telegram Send, before Sheets "Mark Reminded" — the wait gives Telegram time to process before the loop continues

**Node 09 — Sheets "Mark Reminded"**
- Type: `n8n-nodes-base.googleSheets`, operation: `update`
- Credential: `googleSheetsOAuth2Api`
- Row: `{{ $json.rowId }}`
- Column: `reminder_sent_at` ← `{{ new Date().toISOString() }}`
- This is the idempotency guard. Writing it AFTER the Telegram send (not before) ensures we only mark reminded if the send actually succeeded. If the send fails, WF03 captures the error and the next cron tick retries.

## 13.2 Definition of Done — Workflow 04

**Prompt 7 — ✅ SHIPPED 2026-05-18 (pending operator manual test):**
- WF04 built, validated (3 errors all known false positives: 2× v4.7 `update` false positive, 1× "primitive return" false positive on Filter Stale when filtered array is empty)
- 9 nodes, 9 valid connections, linear loop with Split In Batches feedback ✓
- `errorWorkflow` wired to WF03 ✓
- Exported to `workflows/04-stale-lead-reminder.json` ✓
- **Operator manual test pending:** in `_config` cell F2 set `reminder_threshold_minutes = 1`; ensure at least one lead has `status='new'`, `created_at` older than 1 min, `reminder_sent_at` empty; wait for next 15-min cron tick OR click "Execute Workflow" manually in n8n editor; verify exactly one reminder fires per stale lead with `@username` mention rendering a notification badge for the named manager; verify `reminder_sent_at` written so next tick doesn't re-ping; reset threshold to `30` after testing.

---

# 14. WOW 1 — AI Qualification [✅ SHIPPED via Prompt 6, 2026-05-18]

Inserted into workflow 01 between IF "Is Duplicate" (false branch) and Send Message. Final architecture:
`Is Duplicate (false) → Qualify Lead → Parse AI Response → Format Message → Send Message → Write Telegram IDs`

## 14.0 Build status

- **Workflow ID:** `k48UMsaDfLuev3fj` (re-exported to `workflows/01-new-lead-processing.json` with 13 nodes)
- **Anthropic credential:** `09N35JJ0R0zrY1rS` ("Anthropic account")
- **Node type chosen:** `@n8n/n8n-nodes-langchain.anthropic` (standalone — NOT `lmChatAnthropic` which requires an AI Agent parent). Resolves OQ-2.
- **Model:** `claude-haiku-4-5` (current Haiku alias, verified against Anthropic SDK type definition via Context7). Dated variant `claude-haiku-4-5-20251001` also available if pin needed.
- **Settings on the node:** `simplify: false` (returns raw Anthropic API shape so Parse AI Response can read `content[0].text` deterministically), `maxTokens: 256`, `temperature: 0`. Resolves OQ-3.

## 14.1 Final system prompt (locked in)

```
You score sales leads. Output strict JSON only — no prose, no markdown, no code fences.
Format: {"score": <int 1-10>, "category": "hot"|"warm"|"cold", "reason": "<10 words max>"}

Categories:
- hot (score 8-10): strong intent + good budget (urgent, ASAP, need, want, "хочу", "потрібен")
- warm (score 4-7): moderate interest and/or budget
- cold (score 1-3): vague, low budget, browsing ("just looking", "maybe", "later", "цікавлюсь", "можливо")

Higher budget tier weighs heavily ($5000+ rarely scores below 6). Match the user's language; "reason" can be in English, Ukrainian, or Russian.
```

**User prompt template:** `Message: {{ $json.message }}\nBudget: {{ $json.budget }}`

Multilingual cues (Ukrainian/Russian intent words inside the system prompt) were added because the production form is bilingual. Without them, Haiku tends to default-score Ukrainian leads in the warm/cold bucket regardless of urgency cues.

## 14.2 Parse AI Response — observed behavior

- Returns simplify:false output: `{ id, type, role, content: [{type:'text', text:'...'}], usage: { input_tokens, output_tokens }, ... }`
- Parse path order tried: `content[0].text` → `message.content[0].text` → string `content` → `text`
- Strips ```` ```json ... ``` ```` fences before `JSON.parse` (Haiku rarely wraps but defensive)
- Validates `typeof score === 'number'` + non-empty `category` + `reason`
- Clamps `score` to integer in [1, 10] and forces `category` into `hot|warm|cold` set
- On any failure: fallback `{ score: 0, category: 'cold', reason: 'parse_error' }` and logs to console; **never throws**

## 14.3 Observed scoring (production-grade ground truth)

| Lead | Message snippet | Budget | AI score | Category | Reason |
|------|----------------|--------|---------:|----------|--------|
| Оксана Мельник | "Хочу записатись на курс танців, стартуємо ASAP" | $500-$1500 | **9** | hot | "Strong intent (хочу) + urgent (ASAP) + adequate budget" |
| Юлія Гнатюк | "Шукаю варіанти автоматизації… найближчим часом" | $1500-$5000 | (warm range expected, ran in <40s) | warm | — |

The first row is the canonical observed case — Haiku correctly identified the Ukrainian intent word `хочу`, the urgency token `ASAP`, and weighed the moderate budget appropriately to land on 9/10. Reason text mixes English and Ukrainian as instructed.

## 14.4 Cost observed

Per qualification: well under $0.001. Claude Haiku 4.5 pricing is roughly $0.80 per million input tokens and $4 per million output tokens (verify on Anthropic Console for current rates). With ~200 input tokens (system + user prompt) and ~60 output tokens per call, cost per lead lands around **$0.0004** — squarely inside the project's $0.0001–$0.001 budget. Confirm cumulative spend in `https://console.anthropic.com/settings/usage` after a few dozen test runs.

## 14.5 Edge cases worth flagging

- **Long Cyrillic messages pasted from chat:** can split into multiple sheet rows when pasted (the trigger sees them as separate "new rows"). Not an AI issue but it's the most common failure mode for the broader pipeline. Use Google Form (production path) or direct cell input rather than paste.
- **Adversarial garbage (emoji-only, gibberish):** the AI tends to still score them — usually as cold 1-3 with a reason like "Nonsensical / no clear intent". Parse AI Response's fallback (score 0, parse_error) is rarely engaged for actual model output; it's mostly defensive against network/API failures.
- **Empty `message` field:** caught earlier by Validate Fields (throws before reaching the AI) — by design.

---

# 15. WOW 2 — Smart Routing [TBD via Prompt 7]

To be inserted into workflow 01.

- "Load Config" Sheets node right after the Trigger, reading the `_config` row
- Switch "Route By Tier" node before Telegram Send — branch on budget bracket OR AI category
- Two parallel Telegram Send branches with different `chat_id` (senior vs junior)
- Both converge on "Update Status" which writes `routed_to` column

Final tier thresholds to be recorded here after Prompt 7.

---

# 16. Optional Workflow 05 — Synthetic Lead Generator [TBD via Prompt 9, optional]

Built only if the demo Form needs to feel alive without exposing it to spam.

- Schedule Trigger every 20 min between 09:00–22:00 Europe/Kyiv
- Code node "Maybe Generate" — 40% abort chance + Faker.js-driven fake lead with `is_demo: true` flag, weighted intent (20% hot / 50% warm / 30% cold)
- Wait node 0–600 sec random jitter
- Sheets Append to `leads` tab

**Note for Cloud:** n8n Cloud blocks external npm modules in Code nodes by default — `NODE_FUNCTION_ALLOW_EXTERNAL` is a self-hosted-only env var. On Cloud, either skip this workflow, or replace Faker.js with hand-rolled fake-data generation in pure JS (workable for this scope: ~20 name templates + phone format permutations + message banks).

Workflow 01's Telegram Send gets updated to prepend `[DEMO]` when `is_demo=true` so demo leads are honestly labeled.

---

# 17. Apps Script Bridge [optional, drafted in Prompt 5]

Optional polish that replaces 60-second Sheets polling with 2–5 second push from Google Form submission. File: `scripts/apps-script-webhook.gs` — **drafted but not deployed** (Sheets polling works fine for the demo).

**What's in the script (current state):**
- `onFormSubmit(e)` trigger function — bound to the Sheet's `On form submit` event in Apps Script Triggers UI
- Reads the live header row from the sheet so the payload always matches the schema even if columns are added/renamed
- Builds a lead object keyed by header names + `row_number` + `timestamp`
- POSTs JSON `{ secret, source: "apps-script-bridge", spreadsheet_id, sheet_name, lead }` to the n8n Webhook node
- Catches and logs failures (does NOT throw — that would block the form submission's success state)

**To activate:**
1. Open the Sheet → Extensions → Apps Script → paste `scripts/apps-script-webhook.gs`
2. Fill `WEBHOOK_URL` and `WEBHOOK_SECRET` constants
3. Triggers → Add Trigger: function `onFormSubmit`, source = From spreadsheet, event = On form submit
4. In n8n, build a new workflow OR swap WF01's Sheets Trigger for a Webhook node (POST). First node checks `$json.body.secret === '<WEBHOOK_SECRET>'` and throws on mismatch.

**Security note:** the shared secret is NOT a cryptographic signature — sufficient for a private portfolio instance, not for production multi-tenant. For real client deployments, add HMAC signing.

---

# 18. Quality Gates [filled]

Three checkpoints. None of them gets skipped.

## 18.1 Per-prompt gate

After every prompt that builds or modifies a workflow:
- `n8n_validate_workflow({id})` returns no errors
- `n8n_test_workflow({workflowId})` runs to completion
- `n8n_executions({action: 'get', id: latest})` shows every node ✓
- Workflow settings applied per section 3.2 (timeout, save policy, error workflow link)
- `project_specs.md` updated with any decisions made during the build
- Operator's manual user-facing test (described at the end of each prompt in `prompts.md`) passes

## 18.2 Pipeline gate

After Prompt 8, before declaring the system shippable:
- Form submission → Telegram notification arrives ≤60s with all fields, AI category visible, smart routing applied
- Each of three inline buttons updates the Sheet ≤2s and edits the Telegram message in place
- Duplicate submission produces no second Telegram message
- Stale lead (>30 min old) gets exactly one reminder ping
- Deliberately breaking a credential surfaces in `_errors` and operator email within 60s
- All four workflows show as active in the n8n UI

## 18.3 Production readiness gate

Before linking the project from anywhere public:
- All four workflows have correct workflow-level settings (timeout=300s, save-on-success=false, save-on-error=true, error workflow linked to `03-error-alerts`)
- Every workflow has been exported to `workflows/NN-name.json` and committed to git
- Restore drill completed: re-importing one workflow JSON from git into a freshly-created test n8n instance produces a working copy (validates git as disaster-recovery source)
- README has a 30-second demo GIF and a working link to `docs/architecture.md`

Note that infrastructure concerns (encryption key, persistent volume, automated DB backups, OS patching) are n8n Cloud's responsibility under this deployment model. The operator's readiness gate focuses on workflow-design discipline and recovery via committed JSON.

---

# 19. Architecture Documentation Outline [TBD via Prompt 8]

To be expanded by Claude Code during Prompt 8 into `docs/architecture.md` as a portfolio-grade architectural overview (not a redeploy guide). Sections to include:

1. System overview — the four-workflow architecture with a Mermaid diagram
2. Data model — pulled from section 7
3. Integration points — Google Forms, Google Sheets, Telegram, Anthropic, Gmail SMTP, with credential auth model for each
4. Why n8n Cloud — pulled from section 2.1
5. Idempotency strategy — dedupe on email+phone, `reminder_sent_at` guard, `message_id` capture for editMessageText
6. AI integration pattern — Claude Haiku with try/catch fallback, max_tokens cap, why parse failures must never block real leads
7. Error handling — Error Trigger workflow linkage across all production workflows, payload sanitization regex, alert delivery via Gmail SMTP
8. Recovery model — git as disaster-recovery source, workflow JSON portability between Cloud and self-hosted
9. Trade-offs and limitations — what's out of scope (multi-tenant, CRM integration), and why

This is the document a portfolio reviewer reads to understand the system. It is not a setup guide — the operator's instance stays private.

---

# 20. README Structure [TBD via Prompt 8]

To be expanded by Claude Code during Prompt 8 into `README.md`:

- H1 + one-line value prop
- Live demo: embedded GIF, no public form link (portfolio viewer does not redeploy)
- Stack badges via shields.io (n8n Cloud, Anthropic, Telegram, Google Sheets)
- Architecture: Mermaid flowchart of the four workflows and their connections
- Three WOW features (AI qualification / smart routing / stale-lead reminder), each with a 1-line description and a screenshot of the relevant node chain
- Architecture deep-dive pointer to `docs/architecture.md`
- Project structure tree (pulled from `CLAUDE.md`)
- Case narrative — problem, architectural decisions, result
- Competencies block — Agentic Architecture, Tool Design, Context & Reliability, AI Integration

---

# 21. Open Questions / TBD

Maintained jointly. Claude Code adds questions; operator resolves before the corresponding build prompt. Questions marked **(operator)** require your input. Questions marked **(build)** are resolved via `get_node`/`search_nodes` at build time.

---

**OQ-1 (resolved 2026-05-18, revised during Prompt 3 build) — Row number field name and source**
The Sheets Trigger (`rowAdded` event) does NOT emit `row_number` in its output. The field only exists in Sheets action node (read) output. In Workflow 01, `row_number` is extracted inside Check Duplicate from `$input.all()` (Get All Rows output) by matching on email and taking the highest row_number. The value is then passed through as `$json.row_number` in all downstream expressions and `callback_data` strings.

**OQ-2 (resolved 2026-05-18) — Anthropic node exact type string**
`@n8n/n8n-nodes-langchain.anthropic` (typeVersion 1). The standalone variant — not the LangChain Chat Model (`lmChatAnthropic`) which requires an AI Agent parent. Resource `text`, operation `message`. Despite being under the langchain package, it works as a regular pipeline node and returns the raw Anthropic API response when `simplify: false`. The original spec mention of `n8n-nodes-base.anthropic` does not exist as a node type.

**OQ-3 (resolved 2026-05-18) — Anthropic node output field path**
With `simplify: false` on `@n8n/n8n-nodes-langchain.anthropic`, the output is the raw Anthropic API response: `{ id, type: 'message', role: 'assistant', content: [{ type: 'text', text: '...' }], usage: {...}, ... }`. The model's response text lives at `json.content[0].text`. With `simplify: true` the shape collapses to a single field that's less predictable, so we deliberately chose `simplify: false`. Parse AI Response tries multiple paths as a safety net: `content[0].text` → `message.content[0].text` → string `content` → `text`.

**OQ-4 (resolved 2026-05-18) — Auth method for Google Sheets credentials**
Using Managed OAuth2 (Sign in with Google) on n8n Cloud — the simplest path available to Cloud users. Credential types are confirmed: `googleSheetsTriggerOAuth2Api` for the trigger, `googleSheetsOAuth2Api` for action nodes. n8n Cloud handles token refresh automatically so the "service account survives token expiry" concern from section 9.1 does not apply here. Section 9.1 note about service account remains valid for self-hosted deployments.

**OQ-5 (resolved 2026-05-18) — Spreadsheet ID and sheet structure**
Spreadsheet ID: `1cNcXDPgsVdgmtrnBr6NLNJsyEO3Zhrt5eHvcmJqPpAk`. All three tabs (`leads`, `_errors`, `_config`) confirmed present with correct headers. `_config` row 2 is populated. Test lead row added to `leads` tab.

**OQ-6 (build) — Reading a single sheet row by row number in n8n**
WF02 Node 03 needs to read a specific lead row using `rowId` from `callback_data`. Options: (a) read range `A{rowId}:R{rowId}` with no-header mode + manual column mapping; (b) read all rows and filter in Code node. Option (a) is more efficient; option (b) is simpler. Resolve: `get_node(n8n-nodes-base.googleSheets, operation: read)` during Prompt 4 to see if a row-number read is supported natively.

**OQ-7 (resolved 2026-05-18) — Telegram Trigger `updates` parameter path in workflow JSON**
`updates` is a **top-level** parameter on `n8n-nodes-base.telegramTrigger` (typeVersion 1.3), not nested under `additionalFields`. Type: `multiOptions` (array). Value: `["callback_query"]` (or array of allowed update types). The UI labels it "Trigger On" but the JSON key is `updates`. `additionalFields` is a separate sibling collection for chat/user restrictions and image download settings.

**OQ-8 (resolved 2026-05-18) — Inline keyboard parameter path in Telegram Send node JSON**
`replyMarkup` and `inlineKeyboard` are **top-level** node parameters for `sendMessage` (not nested inside `additionalFields`). `parse_mode` IS inside `additionalFields`. `callback_data` uses snake_case. Full confirmed structure:
```json
"replyMarkup": "inlineKeyboard",
"inlineKeyboard": {
  "rows": [{ "row": { "buttons": [
    { "text": "🟢 Взять", "additionalFields": { "callback_data": "={{ 'lead_' + $json.row_number + '_taken' }}" } },
    { "text": "⚙️ В работе", "additionalFields": { "callback_data": "={{ 'lead_' + $json.row_number + '_in_progress' }}" } },
    { "text": "✅ Завершено", "additionalFields": { "callback_data": "={{ 'lead_' + $json.row_number + '_done' }}" } }
  ]}}]
},
"additionalFields": { "parse_mode": "Markdown" }
```

**OQ-9 (resolved 2026-05-18) — Telegram credential IDs and chat IDs**
- `telegramApi` credential ID: `zQbslAZbcF6pqKFh`
- Default chat ID (minimal build): `-5270803125`
- Senior chat ID: `-5132521725`
- Junior chat ID: `-5041198971`
- `googleSheetsTriggerOAuth2Api` credential ID: `qEKqA8Kw3WPO0o19`
- `googleSheetsOAuth2Api` credential ID: `vPYba8prk7sfff5g`

**OQ-10 (resolved 2026-05-18) — Execution URL in error alerts**
Bypassed `$execution.url` entirely. Format Error Row builds the URL manually using `err.workflow.id` and `err.execution.id` from the error payload: `https://onewinnerfourtytwoloosers.app.n8n.cloud/workflow/${workflowId}/executions/${executionId}`. Stored as `$json.execution_url` and referenced in the email body. This is more robust than the runtime `$execution.url` expression (whose behavior in Error Trigger context is undocumented) and survives any n8n version changes to that expression.

**OQ-11 (resolved 2026-05-18) — Gmail SMTP credential ID and alert recipient**
- SMTP credential ID: `JeOMZkGm0aM2IwRG` (display name "Gmail SMTP App Password")
- Configuration: host `smtp.gmail.com`, port `587`, STARTTLS, user `vasilikartem@gmail.com`, password = Gmail App Password
- `fromEmail`: `vasilikartem@gmail.com`
- `toEmail`: `vasilikartem@gmail.com` (self — portfolio scope, single operator)

**OQ-12 (resolved 2026-05-18) — `assigned_to` behavior on multi-step button clicks**
Decision: **always overwrite** `assigned_to` with whoever clicked the most recent button. Acceptable for v1 portfolio scope. If manager A clicks "Взять" and manager B later clicks "Завершено", `assigned_to` ends up as manager B. No guard logic. Revisit if a real client deployment needs first-claimer attribution.

**OQ-13 (resolved 2026-05-18) — Stale-lead reminder fallback chat for pre-routing leads**
Decision: **fall back to `junior_chat_id`** for leads with empty `routed_to`. Junior chat is lower-stakes than senior, and most pre-routing legacy leads were probably small ones anyway. Codified in `Build Reminder`: `const routed = lead.routed_to || 'junior';`. If a real client deployment surfaces complaints about junior-routed-by-default older leads, we can switch to `config.chat_id` (the General default) — change is one line in Build Reminder JS.

**OQ-14 (resolved 2026-05-18) — Anthropic API credential ID**
- Credential ID: `09N35JJ0R0zrY1rS` (display name "Anthropic account")
- Credential type: `anthropicApi`
- API key sourced from `.env` (`ANTHROPIC_API_KEY`)

**OQ-15 (resolved 2026-05-18) — Manager list for @mention reminder**
`_config` D2 = `HateMe302` (confirmed from earlier testing). Build Reminder takes the first CSV entry: `String(config.manager_list || '').split(',')[0].trim()`. No rotation logic — v1 always pings the first manager. For a future production version with multiple managers, rotation could be added via either: (a) round-robin using a counter stored in a `_state` sheet tab, or (b) random selection. Both are ~5 lines of JS in Build Reminder. Confirmed `@HateMe302` is a member of all 3 group chats per `getUpdates` API check.

---

# 22. Build Retrospective [filled 2026-05-18]

**Biggest gotcha hit during the build.** The `runOnceForAllItems` + `$('Sheets Trigger').first()` pattern combined with the Sheets Trigger's `rowAdded` event behavior caused a class of bugs that took three separate diagnosis cycles to fully resolve. First symptom: trigger fired with N new rows, but only the first one processed because Validate Fields used `$('Sheets Trigger').first()`. Second symptom: when the operator typed cells directly into Sheets, the trigger captured the row at the first cell's value, advanced its cursor, and never re-fired — so even rows that eventually got fully typed were silently lost. Third symptom: after switching to `anyUpdate`, WF02's status-update writes re-fired WF01 and double-sent Telegram messages. The full fix is structural — Split In Batches loop after Normalize, `anyUpdate` trigger event, `alreadyProcessed` check in Check Duplicate based on `telegram_message_id` — and represents the most expensive architectural learning of the project. Documented in `learnings.md` under several entries and codified in §10.0a.

**Biggest time-saver discovered.** The n8n-MCP `n8n_update_partial_workflow` tool with diff operations + `continueOnError: true`. Initial workflow builds went through `n8n_create_workflow`, but iterative changes (renaming a node, restructuring connections, fixing a Code node's JS, adding a new column to a Sheets update) were a single batched call away. The `continueOnError` flag in particular saved hours — when 10 of 12 ops succeed and 2 fail, n8n reports which ones, and you patch them in the next call. This is dramatically better than editing workflow JSON by hand and re-uploading wholesale via `n8n_update_full_workflow`. Combined with `n8n_validate_workflow` after every batch, it's a tight build-validate-iterate loop where the bottleneck is decision-making, not mechanics. Reusable across every n8n project going forward.

**What to do differently on Project 2.** Three things. (1) **Default to `anyUpdate` triggers from the start** for any Sheets-driven workflow that humans interact with directly — the `rowAdded` event's "fire-once-and-forget" semantics don't match real user typing behavior, and retrofitting the dedup guard mid-build is more work than designing for it day one. (2) **Build Split In Batches loops into any trigger that can emit multiple items** instead of writing single-item-assuming Code nodes. The refactor cost (3-4 ops via partial update) is small, but only if it's done before the rest of the chain hardens around the single-item assumption. (3) **Stop fighting the MCP validator's v3-v4.7 false positives on Sheets `update`** — they're a known noise, treat them as "this is the v4.7 columns resourceMapper signature, validator's stale" and move on. The first time it happened in Prompt 3 took an hour to triage; subsequent appearances took 30 seconds. Document the false-positive recognition criteria upfront in any project that uses Sheets v4.7 updates.
