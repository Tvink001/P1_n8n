# Architecture — Lead Automation

> Portfolio-grade architectural overview. This document explains how the system works for the reader — it is **not** a step-by-step setup guide. The live n8n Cloud instance is private; viewers see the result via this doc, the demo GIF, and the committed workflow JSON in `workflows/`.

---

## 1. System Overview

Four workflows process leads end-to-end, from Google Form submit to Telegram action button → status synced back to the source Sheet — without manual intervention. Two workflows live on the lead's happy path, one handles operator actions, and one fires stale-lead reminders. A separate error-handling workflow is wired to all of them.

```mermaid
flowchart LR
    Form[Google Form] --> Sheet[(Google Sheets<br/>leads tab)]

    Sheet -. anyUpdate poll .-> WF01[Workflow 01<br/>New Lead Processing]
    WF01 -->|Claude Haiku scores hot/warm/cold| AI{AI Qualify}
    AI -->|hot OR mid+high budget| TS[Telegram: Seniors]
    AI -->|warm/cold + low budget| TJ[Telegram: Juniors]
    TS --> Btns[3 inline buttons]
    TJ --> Btns

    Btns -.callback_query.-> WF02[Workflow 02<br/>Callback Handler]
    WF02 -->|update status,assigned_to| Sheet
    WF02 -->|editMessageText| TS
    WF02 -->|editMessageText| TJ

    Cron((15-min cron)) --> WF04[Workflow 04<br/>Stale Lead Reminder]
    WF04 -->|status=new AND created_at > threshold| Sheet
    WF04 -->|@mention manager| TS
    WF04 -->|@mention manager| TJ

    WF01 -. errorWorkflow .-> WF03[Workflow 03<br/>Error Alerts]
    WF02 -. errorWorkflow .-> WF03
    WF04 -. errorWorkflow .-> WF03
    WF03 -->|sanitize + append| Errors[(_errors tab)]
    WF03 -->|Gmail SMTP| Inbox[Operator Inbox]

    classDef wf fill:#fff4d6,stroke:#d4a017,stroke-width:2px;
    classDef store fill:#e8f4fd,stroke:#1f77b4;
    classDef ext fill:#f0f0f0,stroke:#666;
    class WF01,WF02,WF03,WF04 wf
    class Sheet,Errors store
    class Form,TS,TJ,Btns,Cron,Inbox,AI ext
```

| # | Workflow | Trigger | Purpose | Node count |
|---|----------|---------|---------|-----------:|
| 01 | New Lead Processing | Google Sheets `anyUpdate` (1-min poll) | Validate → dedupe → AI qualify → smart-route → Telegram | 16 |
| 02 | Callback Handler | Telegram callback_query webhook | Parse → update Sheet status → edit Telegram message in place → answer query | 7 |
| 03 | Error Alerts | n8n Error Trigger (called by 01/02/04) | Sanitize payload → log to `_errors` Sheet → email operator | 4 |
| 04 | Stale Lead Reminder | Schedule Trigger every 15 min | Find `status=new` rows older than 30 min → ping `@manager` in routed chat with full keyboard | 9 |

---

## 2. Data Model

A single Google Spreadsheet acts as both the system-of-record and the operator-facing UI. Three tabs:

**`leads`** — 18 columns. Google Form auto-writes `timestamp / name / phone / email / message / sourse / budget` on submit. WF01 fills `status / telegram_message_id / telegram_chat_id / routed_to / score / category / reason / created_at / updated_at` after processing. WF02 updates `status / assigned_to / updated_at` on each button click. WF04 stamps `reminder_sent_at` after pinging.

**`_errors`** — 6 columns. `timestamp / workflow_id / workflow_name / node / error_text / payload`. Payload is JSON-serialized with sensitive fields (anything matching `token|key|password|secret|bearer|auth`) replaced with `[REDACTED]`.

**`_config`** — 1 data row, 6 columns. `chat_id / senior_chat_id / junior_chat_id / manager_list / working_hours / reminder_threshold_minutes`. Read by every workflow on startup so routing rules and timing can be tuned without touching workflow JSON.

Full column-by-column reference in [`google-sheets-schema.md`](google-sheets-schema.md). Conceptual reference in `project_specs.md` §7.

---

## 3. Integration Points

| Service | Purpose | Auth model | Credential type in n8n |
|---------|---------|------------|------------------------|
| Google Forms | Lead intake | Native Sheet binding (no API call from n8n) | — |
| Google Sheets | Data store + operator UI | Managed OAuth2 (n8n Cloud) | `googleSheetsTriggerOAuth2Api` (trigger), `googleSheetsOAuth2Api` (actions) |
| Telegram Bot API | Notifications + callback receiver | Bot token | `telegramApi` |
| Anthropic Claude Haiku 4.5 | Lead scoring (hot/warm/cold + reason) | API key | `anthropicApi` |
| Gmail SMTP | Error alert email | App Password | `smtp` |

Credentials are stored in the n8n Credentials UI and referenced by ID from workflow JSON — **never inlined**. Workflow JSON committed to git therefore contains no secrets. The Google Sheets credentials use Managed OAuth2 (n8n Cloud's "Sign in with Google" flow) which delegates token refresh to the platform — service account JSON is not required for the Cloud deployment.

---

## 4. Why n8n Cloud

**Architectural choice, not a default.** Reasoning carried through from `project_specs.md` §2.1:

- **This is a portfolio case, not a shippable template.** The operator owns the live instance; viewers see the result via this README + GIF + workflow JSON in git. Nobody redeploys it. Cloud's "no ops overhead" trade-off becomes fully positive.
- **n8n Cloud fully supports the public API.** Verified via official docs — API enabled by default on Cloud, identical curl signatures to self-hosted, same `X-N8N-API-KEY` auth, same `/api/v1/*` endpoints. The MCP-first development loop works against Cloud exactly as against self-hosted.
- **Infrastructure-grade concerns become Cloud's responsibility:** encryption key management, persistent volume, Postgres engine, automated daily backups, TLS, OS patches. The operator's responsibility shrinks to workflow design, credential hygiene, idempotency, error linkage, and AI graceful fallback — which are exactly the high-signal concerns for a portfolio reviewer to evaluate.
- **Cost matches scope.** Cloud Pro at ~$50/month covers projected portfolio demo load with significant headroom. Self-hosting on Railway free tier would save ~$50/month but adds 10–15 hours of operational work and a non-trivial single-point-of-failure (lose encryption key → lose all credentials).

For a future paying-client deployment requiring data residency or compliance, the workflow JSON is portable to self-hosted with no logic changes.

---

## 5. Idempotency Strategy

Three independent guards, each addressing a specific re-entrance scenario:

**5.1 New lead dedup (WF01 — Check Duplicate node).** Matches by email against all existing sheet rows. A new lead with a unique email passes. A re-fired trigger for the same row finds 1 match → not duplicate. Multiple rows with the same email → duplicate, routed to Skip Duplicate. Additional guard introduced after switching to `anyUpdate` trigger: if the matched row's `telegram_message_id` is already populated, the row was already processed — skip silently. Prevents WF02's status-update writes from re-firing WF01.

**5.2 Stale-lead reminder guard (WF04 — `reminder_sent_at` column).** Filter Stale skips any row where `reminder_sent_at` is non-empty. Mark Reminded writes the ISO timestamp **after** the Telegram send succeeds — never before. If the send fails, the column stays empty and the next 15-min cron tick retries naturally. No external state store needed; the Sheet is the durable state.

**5.3 Telegram `message_id` capture (WF01 → WF02 contract).** Write Telegram IDs records `telegram_message_id` and `telegram_chat_id` immediately after Send Senior/Junior succeeds. WF02's Edit Message Text needs both to call `editMessageText`. If they're missing, WF02 throws → routes to WF03 → operator gets an email about the broken message link. The error is loud rather than silent.

The "write after success" pattern from 5.2 and 5.3 is reusable for any cron-based "fire-once-and-only-once" workflow.

---

## 6. AI Integration Pattern

Anthropic Claude Haiku 4.5 scores each new lead between Check Duplicate and Send Message. The integration is deliberately small-surface and fail-soft:

- **System prompt** locks Haiku to strict JSON output: `{"score": int 1-10, "category": "hot"|"warm"|"cold", "reason": "<10 words>"}`. No prose, no markdown, no code fences. Categories and weighting (hot ≥ 8, warm 4–7, cold ≤ 3; high budget skews up) are spelled out in the prompt with bilingual cues (`хочу`, `потрібен`, `цікавлюсь`) so Cyrillic leads score correctly.
- **Hard caps:** `max_tokens: 256` (output is ~60-80 tokens in practice), `temperature: 0` (deterministic). Observed cost per qualification: ~$0.0004 (well inside the $0.0001–$0.001 design budget).
- **Parse AI Response** wraps `JSON.parse` in try/catch. On any failure (malformed JSON, missing field, unexpected response shape, network blip), it returns `{ score: 0, category: 'cold', reason: 'parse_error' }` and continues. **The node never throws.** The principle: a real lead reaching a manager's Telegram chat is more important than a clean AI label.
- **Format Message** treats `score === 0` as "no header" — the AI-prefix line is omitted entirely so the operator sees a clean lead message and can qualify manually. With `score > 0`, the prefix renders as `🔥 *Горячий лид — 9/10* — Strong intent + ASAP`.
- **Node choice:** `@n8n/n8n-nodes-langchain.anthropic` (the standalone variant) with `simplify: false` so the response is the raw Anthropic API shape (`{ content: [{ type: 'text', text: '...' }], usage }`) — predictable to parse.

The AI is an enhancement layer, not a critical-path dependency: the workflow degrades gracefully to "lead without score" if Anthropic is unreachable.

---

## 7. Error Handling

A single error-handling workflow (WF03) is wired to all three production workflows via the `settings.errorWorkflow` field. WF03 itself has **no** error workflow (recursion guard). Architecture:

1. Any unhandled throw in WF01/02/04 invokes the n8n Error Trigger in WF03.
2. **Format Error Row** (Code) extracts `workflow.id`, `workflow.name`, `execution.lastNodeExecuted`, `execution.error.message`, and a sanitized `execution.data` payload. Sensitive keys (`token|key|password|secret|bearer|auth`, case-insensitive regex) have their values replaced with `[REDACTED]` — payload structure is preserved so errors stay debuggable.
3. **Append Error Row** writes the formatted row to the `_errors` Sheet tab.
4. **Send Alert** emails the operator via Gmail SMTP with a subject like `[n8n Error] 01 — New Lead Processing — Validate Fields — 2026-05-18T01:30` and a body that includes the failing node, error text, sanitized payload, and a direct URL to the failed execution in n8n Cloud.

The execution URL is built manually in Format Error Row from `err.workflow.id + err.execution.id` rather than relying on `$execution.url` — more robust against n8n expression-context quirks in Error Trigger.

---

## 8. Recovery Model

Git is the disaster-recovery source. The committed workflow JSON in `workflows/` is the canonical record — it survives whatever happens to the live Cloud instance.

- Every workflow build ends with `n8n_get_workflow({ mode: 'full' })` → save to `workflows/NN-name.json` → commit.
- This makes every change visible as a git diff (audit trail) and re-importable if needed (DR).
- A restore drill validates the round-trip: re-importing a committed JSON into a freshly-created test n8n workspace produces a working copy.

The workflow JSON references credentials by ID — restoring into a fresh workspace requires re-creating those credentials and remapping the IDs (a one-time setup task), but the workflow logic is unchanged. The same JSON is portable to a self-hosted n8n instance for a future paying-client deployment.

---

## 9. Trade-offs and Limitations

**Explicitly out of scope.**

| Limitation | Why |
|------------|-----|
| Lead generation itself | Google Form is the agreed lead source; the project starts at the form-submit moment |
| CRM integration | Not in scope for v1; would be a separate workflow consuming the same `leads` Sheet |
| Multi-tenant support | Single Telegram chat, single Sheet, single operator. Multi-tenant would require namespacing + RBAC + per-tenant credentials |
| Public redeploy guide | This is a private portfolio instance, not a shippable template. The workflow JSON is portable but operator-side setup (credentials, sheets, bot) is not documented as a quickstart |
| Bulk-import via paste | The `anyUpdate` Sheets Trigger handles cell-by-cell typing; large pastes still work but the production path is the Google Form, which writes atomic rows |
| Apps Script push (sub-5-second latency) | Drafted in `scripts/apps-script-webhook.gs` but not deployed. Current 1-minute polling is adequate for portfolio demos |

**Known limitations of the live build.**

- `runOnceForAllItems` Code nodes use a Split In Batches loop after Normalize to process multiple leads per trigger fire. The loop runs leads serially (one Anthropic call per iteration). For a real client with high lead velocity, batch-aware AI calls and parallel Telegram sends would be the upgrade path.
- Sheets `update` operations in n8n v4.7 trigger two MCP-validator false positives (`Range required` / `Values required`) that don't reflect runtime behavior. These are validator-side and have been confirmed harmless across every deployment of this project.
- The General Telegram chat in `_config.chat_id` is no longer used by WF01 after smart routing landed — every new lead goes to Seniors or Juniors. General remains a documented fallback option in WF04's reminder logic only.
