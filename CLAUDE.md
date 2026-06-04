# Project Overview

Build "Lead Automation" — an n8n automation that processes incoming leads from a Google Form, validates and deduplicates them, qualifies them via Claude Haiku, routes them by budget tier, and notifies managers in a Telegram group with three inline buttons (`Взять` / `В работе` / `Завершено`).

Four workflows make up the system: lead processing, callback handler, error alerts, and stale-lead reminder. The pipeline runs on a managed **n8n Cloud** instance — not on a self-hosted server. A manager submits the Google Form (or it gets submitted via the linked form by an external lead source), and within sixty seconds the qualified lead arrives in the right Telegram chat with the three action buttons. Clicking a button updates the source Sheet and edits the original Telegram message in place.

This project is a portfolio case study — its purpose is to demonstrate architectural quality, not to be redeployed by viewers. The live n8n instance stays private; viewers see the result via screenshots, GIF demo, and the workflow JSON committed to the repo.

The technical specification lives in `project_specs.md`. Read it before any build step — it contains the node-by-node breakdown for each workflow, the data model for all three Sheet tabs, the production-grade configuration, integration rules for every external service, and the quality gates that decide when a build is done. `project_specs.md` is the single source of truth for technical decisions. Both you (Claude Code) and the operator update it as decisions get made during development.

`learnings.md` is the running log of patterns, gotchas, and reusable solutions discovered during the build. It grows over the project and seeds future projects. The operator maintains it.

---

# Required Toolchain

Both are not optional. If either is missing, stop and install it before continuing.

**n8n-MCP** is the primary tool for everything related to n8n. The MCP server is configured against the operator's n8n Cloud instance via its public API. Workflows are created via `n8n_create_workflow`, validated via `n8n_validate_workflow`, iterated via `n8n_update_partial_workflow` (diff operations only — never full replacement), and tested via `n8n_test_workflow`. There is no manual UI workflow construction, no JSON pasted into the n8n editor, no dictating clicks to the operator. The only operator-side actions in the n8n UI are creating credentials (the public API cannot create them) and toggling the Active flag after a workflow is created (the public API cannot toggle activation).

**Context7 MCP** is used for up-to-date documentation lookups when n8n, Anthropic SDK, Telegram Bot API, or any third-party library is involved. Call `Context7:resolve-library-id` first to find the right library, then `Context7:query-docs` for the answer. Use whenever uncertain about field names, error response formats, or version-specific behaviour — especially when the n8n-MCP `get_node` result lacks the detail needed.

The full configuration of both tools, including `.mcp.json` setup and environment variables, lives in `project_specs.md`.

---

# Tech Stack

- **Workflow engine:** n8n Cloud (Pro plan recommended for portfolio case — see `project_specs.md` for plan rationale)
- **Lead intake:** Google Forms linked to a Google Sheet
- **Data layer:** Google Sheets API v4 with service account auth
- **Notifications:** Telegram Bot API
- **AI qualification:** Anthropic Claude Haiku 4.5 via the native n8n Anthropic node
- **Error alerts:** Gmail SMTP via App Password
- **Function-node language:** JavaScript only (n8n Function nodes do not support TypeScript)
- **Version control:** Git, with workflow JSON exported via `n8n_get_workflow` and committed alongside `docs/`

Detailed integration rules for each technology — credential types, gotchas, error handling, retry strategies — live in `project_specs.md` → Integration Rules.

---

# Constraints

These are absolute. Violation breaks the project. They are not negotiable for any reason.

- **Never commit secrets** — `.env`, `credentials.json`, service-account JSON files, API keys, tokens. The `.gitignore` enforces this; do not bypass it.
- **Never reference credentials by inline value** in workflow JSON. Always reference by credential ID, which exists in the n8n UI before the workflow is created.
- **Never use TypeScript in Function nodes**. n8n's Function nodes only support JavaScript.
- **Never write workflows by dictating UI clicks**. All workflow construction goes through n8n-MCP. The only manual UI actions are credential creation and workflow activation.
- **Never use `n8n_update_full_workflow`** when modifying an existing workflow. Always use `n8n_update_partial_workflow` with diff operations.
- **Never let model output block a real lead** from reaching Telegram. If the AI qualification step fails to return valid JSON, the workflow must continue with a fallback value, not throw.

Infrastructure-level concerns (encryption, database engine, persistent storage, automated backups) are managed by n8n Cloud, not by the operator or by Claude Code. See `project_specs.md` → Production Configuration for the reduced operator-side responsibility model under Cloud.

---

# Development Rules

**Rule 1: Always read first.** Before any action, read `CLAUDE.md`, `project_specs.md`, and `learnings.md`. If `project_specs.md` or `learnings.md` doesn't exist, create an empty version before doing anything else.

**Rule 2: Define before you build.** Before any `n8n_create_workflow` or significant `n8n_update_partial_workflow` call, the relevant section of `project_specs.md` must be complete enough to build from. If it's incomplete or unclear, fill in what you can, list the remaining open questions, and wait for operator approval before pushing to n8n.

**Rule 3: Use MCP, not click dictation.** Every workflow is built and modified through n8n-MCP tools. The operator activates workflows in the UI and creates credentials in the UI when asked. Nothing else in the n8n editor is touched manually by the operator on your behalf.

**Rule 4: Look before you create.** Before adding any workflow, call `n8n_list_workflows` to check what already exists. Before adding any node, call `search_nodes` and `get_node` with `detail: 'standard'` and `includeExamples: true` to confirm the exact type, parameter shape, and credential type. If a template covers ≥80% of the goal, use `n8n_deploy_template` followed by `n8n_autofix_workflow` instead of building from scratch.

**Rule 5: Test before you respond.** After every `n8n_create_workflow` or `n8n_update_partial_workflow`: run `n8n_validate_workflow`, run `n8n_autofix_workflow` if there are errors, ask the operator to activate the workflow, run `n8n_test_workflow`, then read the result via `n8n_executions` to confirm every node is green. Never say "done" without a passing execution.

**Rule 6: Capture decisions in `project_specs.md`.** During every build, decisions get made that weren't in the spec — final regex chosen for phone normalization, exact wording of the Telegram message, the credential ID being referenced, which fallback value Parse AI Response uses on parse failure. Update `project_specs.md` with these decisions as they happen, before the build is declared done. Tell the operator what you added so they can review and approve.

**Core Rule:** Do exactly what's asked. Nothing more, nothing less. If unclear, ask. If a test fails, fix in place via `n8n_update_partial_workflow` and re-test — do not move forward with a failing workflow.

---

# How to Respond

Explain like you're talking to a smart engineer who understands MCP but doesn't have the n8n-MCP tool inventory memorized. No jargon dumps. No walls of text.

For every response, structure as:

- **What I just did** — plain English, one paragraph
- **MCP calls I made** — list each `n8n_*` / `validate_*` / `get_node` / `search_*` call with one-line purpose
- **What I added to `project_specs.md`** — short list of decisions captured, if any
- **What you need to do** — numbered steps for the operator (create credential, activate workflow, run manual test)
- **Why** — one sentence per non-obvious decision
- **Next step** — one clear action
- **Errors, if any** — show the failing `n8n_validate_workflow` output, what autofix did, and the exact fix applied

For external setup steps the operator handles (Google Cloud Console, BotFather, n8n Cloud, Anthropic Console), walk the exact menu path and explain what each setting does in one sentence. Be concise — less is more.

Never paste workflow JSON inline. Reference workflows by their node names from `n8n_get_workflow` with `mode: 'structure'`. Full JSON lives in `workflows/NN-name.json`, exported after the workflow is green.

---

# Project Structure

```
lead-automation/
├── workflows/                          # JSON exports of each workflow, committed to git
│   ├── 01-new-lead-processing.json
│   ├── 02-callback-handler.json
│   ├── 03-error-alerts.json
│   └── 04-stale-lead-reminder.json
├── docs/
│   ├── architecture.md                 # how the system works, for case-study viewers
│   ├── google-sheets-schema.md         # column-by-column reference for all 3 Sheet tabs
│   └── screenshots/                    # README assets including demo GIF
├── scripts/
│   ├── apps-script-webhook.gs          # optional: faster-than-polling Sheets push
│   └── demo-lead-generator.js          # optional: Faker.js for synthetic lead workflow
├── .mcp.json                           # n8n-MCP and Context7 MCP server config
├── .env.example                        # required env vars with comments
├── .gitignore                          # excludes .env, credentials.json, *.log
├── README.md                           # GIF demo, case narrative, architecture link
├── CLAUDE.md                           # this file
├── project_specs.md                    # technical specification, both read and written
└── learnings.md                        # patterns and gotchas, maintained by operator
```

One workflow file per workflow. Function-node JavaScript stays under thirty lines per node — if more, split or move to a Sub-Workflow via Execute Workflow node. Do not create new top-level folders without asking.

---

# Linked Files — What's Where

`project_specs.md` is the technical brain of the project. Architecture, node-by-node breakdowns, integration rules, production configuration, quality gates, setup procedures — everything technical lives there. It comes partially filled before development starts (with what the operator can determine in advance) and grows during development as decisions get made. Both you and the operator write to it.

`learnings.md` is the running log of project-specific knowledge: gotchas discovered, regex patterns that worked, prompts that produced clean JSON output, credential-type confusions resolved. The operator maintains it. You can suggest additions when reporting after a prompt; the operator decides what to encode.

`docs/architecture.md` is the public-facing architectural overview, written by you in Prompt 8 by pulling from `project_specs.md`. This is what a portfolio viewer reads to understand how the system works without trying to redeploy it.

`docs/google-sheets-schema.md` is the column reference for the three Sheet tabs (`leads`, `_errors`, `_config`), pulled verbatim from `project_specs.md` data model section.

`README.md` is the public face of the project, written by you in Prompt 8.

---

# Secrets & Safety

Tokens, API keys, and service-account JSON never appear in workflow JSON files. All secrets live in the n8n Credentials UI or operator-side environment variables — never inline. The `.gitignore` excludes `.env`, `credentials.json`, and any service-account file; do not bypass it. Error messages must not expose the Telegram bot token or any other secret — the Format Error Row Function node in `03-error-alerts` sanitizes payloads before logging. Ask before deleting any workflow; external webhooks (Apps Script, Telegram) may reference workflow IDs.

---

# Scope

Build only what is defined in `project_specs.md`. Features ship in the order specified there — AI qualification before smart routing before auto-reminders. Do not parallelize. If something is unclear, ask the operator before starting.

Explicitly out of scope: lead generation itself (the Google Form is the agreed-upon source), CRM integration (separate feature), multi-tenant support (single chat, single Sheet), public redeployment guide (this is a private portfolio instance, not a shippable template).
