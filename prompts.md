# Project 1 — Lead Automation: Prompt Sequence

Sequential prompts for Claude Code. Each prompt is one atomic build unit: Claude Code reads context, executes via n8n-MCP against your n8n Cloud instance, tests, and reports back with what it changed in `project_specs.md` and what now lives in n8n.

Each prompt depends on the previous — never run them out of order. If a prompt fails its test step, fix in place via `n8n_update_partial_workflow` and only then move on.

---

## How this file works

**Claude Code's side (inside each prompt):**
- Reads `CLAUDE.md`, `project_specs.md`, `learnings.md`
- Builds, validates, tests, and iterates workflows via n8n-MCP tools against your Cloud instance
- Updates `project_specs.md` with decisions made during the build (regex chosen, final message templates, credential ID references)
- Reports back: what's done, what was added to the spec, what's next

**Operator's side (between prompts):**
- Plan, review, and encode learnings using your own tooling (Compound Engineering plugin, your own notes — Claude Code is unaware of this layer)
- Create credentials in the n8n Cloud UI when Claude Code asks; paste IDs to Claude Code
- Toggle workflow `Active` in the n8n Cloud UI when Claude Code asks (the n8n public API cannot do this)
- Run the manual user-facing tests described at the end of each prompt
- Approve `project_specs.md` updates before moving to the next prompt

**Prerequisite:** Step 0 external setup is complete and `CLAUDE.md` + `project_specs.md` exist in project root.

---

## Step 0 — External setup (manual, in browser)

Browser tabs only — Claude Code can describe the path but cannot execute clicks. Do these first so credentials are ready when prompts reference them.

1. **Google Cloud Console** → new project → enable Google Sheets API + Google Drive API → IAM & Admin → Service Accounts → create one → Keys → Create new key → JSON → save `credentials.json` somewhere safe outside this repo. Copy the service-account email.

2. **Google Sheet** named `lead-automation-prod` → share with the service-account email as Editor → create three tabs: `leads`, `_errors`, `_config`. Column schema lives in `project_specs.md` data model section.

3. **Google Form** with 6 fields per `project_specs.md` (Name, Phone, Email, Message, Source, Budget) → link to the sheet via Form → Responses → Sheet icon → Select existing → `lead-automation-prod`. Disable "Verified responder / CAPTCHA" if you'll test with synthetic leads later.

4. **Telegram BotFather** → `/newbot` → save token. Create private group "Lead Test", add bot as admin. Add `@getmyidbot` → `/my_id @your_bot_username` → save the negative `chat_id`.

5. **Anthropic Console** → API Keys → Create Key → save it.

6. **Gmail App Password** at myaccount.google.com → Security → 2-Step Verification (must be on) → App passwords → Generate → save it.

7. **n8n Cloud** — if you don't already have an instance, sign up at n8n.cloud and choose the Pro plan (Starter works for the build but Pro is recommended once the case is live and being demoed; see `project_specs.md` section 2.1 for plan rationale). Note your instance URL — format `<workspace>.app.n8n.cloud`.

8. **n8n Cloud UI → Settings → n8n API → Create an API key** — label `claude-code-mcp`. Save it. The public API is enabled by default on every Cloud instance — no env vars to configure on the n8n side.

9. **Export shell environment variables:**
   ```bash
   export N8N_CLOUD_URL="https://<workspace>.app.n8n.cloud"
   export N8N_MCP_API_KEY="eyJhbGc..."
   ```
   These are referenced by `.mcp.json` so the config file stays git-safe.

10. **Create `.mcp.json`** in your project root with `n8n-mcp` and `context7` servers configured (full block in `project_specs.md` → section 4.1).

11. **Smoke-test MCP connectivity** before Prompt 1 by asking Claude Code to run:
    - `tools_documentation()` — confirms n8n-MCP loaded
    - `n8n_health_check()` — confirms Cloud API connectivity
    - `n8n_list_workflows()` — should return empty list

Keep all credentials in a temporary password manager until they go into the n8n Credentials UI. **None of these go into workflow JSON.**

---

## Prompt 1 — Planning: complete `project_specs.md`

```
Read CLAUDE.md, project_specs.md, learnings.md (create empty learnings.md
if missing).

I've already filled the parts of project_specs.md that are clear before
development starts — product summary, tech stack with Why-Cloud rationale,
production configuration (much smaller under Cloud than self-hosted), data
model for the three Sheet tabs, the Telegram message format, callback_data
contract, integration rules. Read what's there.

Complete the remaining sections of project_specs.md:
- Workflow-by-workflow node breakdown (input → transform → output) for
  all four workflows. Use n8n-MCP search_nodes and get_node to confirm
  exact node types and parameter shapes before writing the spec.
- For each Function node, draft the JavaScript logic in the spec (≤30
  lines per node, console.log at start and end).
- For each external integration, list any non-obvious parameters or
  gotchas (e.g., Telegram Trigger callback_query field, Sheets trigger
  credential type) — verify via n8n-MCP and/or Context7 if unsure.
- Definition of Done for each workflow.
- Open Questions / TBD section listing anything you couldn't decide
  without my input.

Do not call n8n_create_workflow yet. This prompt only writes spec; the
next prompt builds.

When done: show me the completed project_specs.md diff and the Open
Questions list. Wait for my approval before moving on.
```

**After this prompt:** I review the diff, answer any Open Questions, approve. I optionally run my compound-engineering workflow to encode planning learnings.

---

## Prompt 2 — File scaffolding

```
Read CLAUDE.md, project_specs.md, learnings.md.

Create the file structure per CLAUDE.md → Project Structure. Use
create_file. Do NOT call any n8n-MCP tools in this prompt — workflows
come in Prompt 3.

What to create:
- workflows/ folder with four empty placeholder JSON files (literally {}):
  01-new-lead-processing.json, 02-callback-handler.json,
  03-error-alerts.json, 04-stale-lead-reminder.json.
  These get overwritten after each workflow is built and exported.
- docs/architecture.md — section headings only (filled in Prompt 8).
- docs/google-sheets-schema.md — full column reference for all 3 tabs,
  copy verbatim from project_specs.md data model section.
- docs/screenshots/ with a .gitkeep file.
- scripts/apps-script-webhook.gs — header comment placeholder.
- .env.example — variables listed in project_specs.md section 3.5.
- .gitignore — .env, credentials.json, *.log, .DS_Store, node_modules.
- README.md — skeleton (filled in Prompt 8).

Verify .mcp.json is already in place from Step 0.

When done: show the tree (view on project root).
```

**After this prompt:** Optional — I encode anything non-obvious about the layout in my own notes.

---

## Prompt 3 — Workflow 01 minimal pipeline (no AI yet)

```
Read CLAUDE.md, project_specs.md, learnings.md.

Build the minimal version of workflow 01 per project_specs.md section
"Workflow 01 — Node Breakdown". Minimal means: no AI qualification, no
smart routing yet. Just Sheets Trigger → Validate → Normalize → Lookup
Existing → IF duplicate → Telegram Send → Sheets Update. AI and routing
ship in Prompts 6 and 7.

Before any MCP write call: I'll create these credentials in the n8n Cloud
UI manually and paste their IDs in chat. Wait for them:
- googleSheetsTriggerOAuth2Api → "Sheets Trigger SA"
- googleSheetsOAuth2Api → "Sheets Action SA"
- telegramApi → "Telegram Bot"

MCP execution flow per project_specs.md section 5:
1. Discovery: search_templates → near-fit check. If none, search_nodes +
   get_node({detail:'standard', includeExamples:true}) in parallel for
   every node type. validate_node minimal then full.
2. Build: assemble workflow JSON referencing credentials by ID.
   validate_workflow locally before push.
3. Push: n8n_create_workflow → n8n_validate_workflow({id}) →
   n8n_autofix_workflow if errors → re-validate.
4. Apply workflow settings per project_specs.md section 3.2: timeout=300s,
   save-on-success=false, save-on-error=true, errorWorkflow=<TBD until
   workflow 03 exists, leave empty for now and wire in Prompt 5>.
5. Activation: tell me "Activate workflow 01 in the n8n Cloud UI, then
   confirm." Wait for my "active".
6. Test: n8n_test_workflow with a sample lead payload matching the
   leads-tab schema. Then n8n_executions({action:'list'}) and
   n8n_executions({action:'get', id:latest}) — verify every node is ✓.
7. Iterate via n8n_update_partial_workflow (diff ops only — never
   n8n_update_full_workflow) until every node is green.

If anything in project_specs.md was incomplete or you discovered a better
approach during the build (e.g., final phone regex, exact Telegram
markdown template, credential ID references), update the spec before
exporting.

After green:
- n8n_get_workflow({id, mode:'full'}) → save to
  workflows/01-new-lead-processing.json
- Report what was built, what changed in project_specs.md, and any
  gotchas you hit (so I can encode them in my notes).

Manual test I'll run before approving move to Prompt 4:
- Submit a Google Form entry → Telegram message arrives ≤60s with all
  six fields and three inline buttons.
- Submit same row again (same email+phone) → no second Telegram message.
```

**After this prompt:** I run the manual user-facing test, encode gotchas in my notes, and approve move to Prompt 4.

---

## Prompt 4 — Workflow 02 callback handler

```
Read CLAUDE.md, project_specs.md, learnings.md.

Build workflow 02 per project_specs.md section "Workflow 02 — Callback
Handler". Reuse the existing telegramApi credential from Prompt 3 — I'll
paste the ID if you don't already have it.

Critical gotcha to verify in build: Telegram Trigger's
additionalFields.updates must include "callback_query". Default is just
["message"] — without callback_query, button clicks silently disappear.
This is documented in project_specs.md but it's the single biggest
Telegram-trigger bug in n8n, so double-check the workflow JSON before
pushing.

MCP execution flow: same shape as Prompt 3.
- Discovery: search_nodes + get_node for telegramTrigger, function,
  switch, googleSheets (update), telegram (editMessageText), telegram
  (answerCallbackQuery). validate_node on each.
- Build & push: validate_workflow → n8n_create_workflow →
  n8n_validate_workflow → n8n_autofix_workflow if needed.
- Apply workflow settings per project_specs.md section 3.2.
- Activation: tell me to activate workflow 02. Wait for confirmation.
- Test: n8n_test_workflow with a synthetic callback_query payload
  (use the schema from Telegram's Bot API — if uncertain about the
  exact field shape, query Context7 for the bot API docs).
- Iterate via n8n_update_partial_workflow until green.

Update project_specs.md if any node-level decisions were made during
the build (e.g., exact text of the edited message after "Взять" click,
how unknown actions are handled).

After green: export to workflows/02-callback-handler.json. Report what
was built and what was added to the spec.

Manual test I'll run:
- Workflow 01 must be active. Submit a fresh Form entry.
- Click "Взять" → Sheet status changes to 'taken' within 2 seconds AND
  Telegram message text updates AND callback spinner clears.
- Repeat for "В работе" and "Завершено".
- Click any button twice — should be idempotent (no double-update).
```

---

## Prompt 5 — Workflow 03 error alerts + optional Apps Script bridge

```
Read CLAUDE.md, project_specs.md, learnings.md.

Build workflow 03 per project_specs.md section "Workflow 03 — Error
Alerts". I'll create the smtp credential ("Gmail SMTP App Password")
in the n8n Cloud UI and paste the ID — wait for it.

MCP execution flow:
- Discovery: search_nodes + get_node for errorTrigger, function,
  googleSheets (append), emailSend. validate_node on each.
- Build & push: standard flow.
- Apply workflow settings — note workflow 03 itself does NOT get an
  errorWorkflow link (would create infinite recursion).
- Activation: tell me to activate workflow 03. Wait for confirmation.
- Test: n8n_test_workflow with a fake error payload that matches the
  Error Trigger schema (use get_node({mode:'info', detail:'full'}) if
  the schema isn't obvious).
- Iterate until green.

After workflow 03 is green: wire workflows 01 and 02 to send their
errors here. Use n8n_update_partial_workflow with updateSettings →
errorWorkflow = <id of workflow 03>. Re-validate both 01 and 02 after.

Separately, fill in scripts/apps-script-webhook.gs per project_specs.md
section "Apps Script Bridge". This is optional polish (Sheets polling
works fine for the demo) but the bridge cuts ingest latency from ~60s
to ~2–5s. Use create_file or str_replace.

After green: export workflows/03-error-alerts.json. Update
project_specs.md if anything was decided during build. Report.

Manual test I'll run:
- Workflow 01 must be active. Temporarily revoke the Sheets credential
  in the UI (or rename the linked sheet). Submit a Form entry.
- Within 60s: a row appears in _errors AND an email arrives at the
  operator email.
- Restore credential, verify pipeline resumes.
```

---

## Prompt 6 — WOW 1: AI qualification via Claude Haiku

```
Read CLAUDE.md, project_specs.md, learnings.md.

Inject AI qualification into workflow 01 per project_specs.md section
"WOW 1 — AI Qualification". I'll create the anthropicApi credential
in the n8n Cloud UI and paste the ID — wait for it.

MCP execution flow:
- Discovery: search_nodes + get_node for anthropic node. validate_node.
  If uncertain about the latest Haiku model string or the exact JSON-mode
  request shape, query Context7 for Anthropic SDK docs.
- Build: use n8n_update_partial_workflow on workflow 01 to insert:
  - Anthropic "Qualify Lead" node between IF (false branch) and
    "Telegram Send" — model claude-haiku-4-5, max_tokens=256,
    temperature=0, prompts per project_specs.md.
  - Function "Parse AI Response" — with try/catch fallback to
    score=0, category='cold', reason='parse_error'. Must never throw.
  Then updateNode on "Telegram Send" to prepend category emoji + score,
  and updateNode on "Sheets Update" to write score, category, reason
  to the row.
- Validate: n8n_validate_workflow → autofix if needed.
- Activation: tell me to re-activate if the update required toggle.
- Test: n8n_test_workflow with three injected payloads — hot, cold,
  and adversarial garbage (e.g. message="🤖🤖🤖"). Verify hot scores
  ≥8, cold scores ≤3, and garbage does NOT crash the workflow
  (parse_error fallback engaged).
- Iterate via partial updates until green.

Critical: the workflow must never throw on bad model output. If your
first test of the adversarial case crashes, fix the Parse AI Response
node before declaring done.

Update project_specs.md with the final prompt that worked best, the
observed cost per qualification (from Anthropic Console), and any edge
cases that initially broke JSON parsing.

After green: export workflow 01 again (overwriting the file). Report.

Manual test I'll run: submit the three test scenarios via the real
Google Form, verify emoji/score in Telegram, check Anthropic Console
shows cost in $0.0001–$0.001 range per qualification.
```

---

## Prompt 7 — WOW 2 + 3: smart routing + stale-lead reminder

```
Read CLAUDE.md, project_specs.md, learnings.md.

Two coupled features:

PART A — Smart routing in workflow 01 (per project_specs.md section
"WOW 2 — Smart Routing"):
- Insert Sheets "Load Config" node right after Trigger to read _config
  tab once. Pass values through downstream via Merge or Set node.
- Insert Switch "Route By Tier" before Telegram Send — branch on
  budget bracket OR AI category.
- Duplicate Telegram Send into two branches with different chat_ids
  (senior_chat_id vs junior_chat_id from Load Config).
- Both branches converge on Sheets Update which now writes routed_to.

Use n8n_update_partial_workflow with diff ops. Re-validate, re-test.

PART B — New workflow 04 stale-lead-reminder (per project_specs.md
section "Workflow 04 — Stale-Lead Reminder"):
- Cron Trigger every 15 minutes.
- Sheets Read "Stale Leads" filtered to status='new' AND created_at <
  now - reminder_threshold_minutes AND reminder_sent_at IS NULL.
- Sheets Read "Load Config" to get manager_list (CSV of telegram
  usernames) for the @mention in the reminder text. This is the
  detail that makes the WOW feature actually wow: the message uses
  @username to trigger a personal Telegram notification badge for
  the named manager, per the brief's "повторное уведомление с
  упоминанием менеджера". Without @mention this is just a regular
  message in the group chat — easy to miss.
- Split In Batches (batchSize=1) over stale leads.
- Telegram Send to routed_to chat with reminder text per
  project_specs.md section 13 format (includes @{manager_username}
  and the full inline_keyboard so action still works via workflow 02).
- Sheets Update set reminder_sent_at=ISO now (idempotency guard).
- Apply workflow settings per project_specs.md section 3.2, including
  errorWorkflow link to workflow 03.

MCP execution flow for both: discovery → build → push → activate
(both 01 update and 04 new) → test → iterate.

For workflow 04 testing: temporarily lower reminder_threshold_minutes
in _config to 1 minute, fire test, verify exactly one reminder fires,
verify the @mention renders correctly and pings the named manager,
and reminder_sent_at gets set so the next cron tick doesn't re-ping.
Reset threshold to 30 after.

Update project_specs.md with the final Load Config pattern, the exact
routing thresholds, the manager_list rotation logic (if you implemented
rotation beyond "always first manager"), and the reminder idempotency
pattern (this last one is reusable in future projects — flag it as
such in the spec).

After green: export both workflows. Report.

Manual test I'll run:
- High-budget Form entry routes to senior chat. Low-budget cold-message
  entry routes to junior chat.
- Un-claimed lead gets exactly one reminder after 30 min, never two.
- Reminder message includes @username mention that surfaces a personal
  notification badge on the named manager's Telegram client.
- Clicking "Взять" on a reminder message still triggers workflow 02
  correctly.
```

---

## Prompt 8 — Architecture doc + README + demo + final QA gates

```
Read CLAUDE.md, project_specs.md, learnings.md.

Three deliverables. No n8n_create_workflow calls — this prompt is docs
and QA.

DELIVERABLE A — docs/architecture.md as a portfolio-grade architectural
overview (NOT a redeploy guide — the instance stays private). Use
str_replace to fill the skeleton. Content per project_specs.md section
"Architecture Documentation Outline":
- System overview with Mermaid diagram of the four workflows
- Data model summary
- Integration points and credential auth model
- Why n8n Cloud (pull from project_specs.md section 2.1)
- Idempotency strategy
- AI integration pattern
- Error handling
- Recovery model (git as DR source)
- Trade-offs and limitations

This is the document a reviewer reads to understand the system. It is
NOT a step-by-step setup guide.

DELIVERABLE B — demo recording:
- Tell me what to record: a 30–60 second screen capture showing Form
  submit → Telegram message → button click → Sheet update + message
  edit. I record, convert to GIF ≤8 MB, place at
  docs/screenshots/demo.gif.
- Also list 3 static screenshots I should capture (architecture node
  graph, sample Sheet data, Telegram chat with rendered buttons) and
  where to place them.

DELIVERABLE C — README.md per project_specs.md section "README
Structure". Use str_replace to replace the skeleton. Reference the
architecture doc rather than duplicating its content.

Then: run the production-readiness check defined in project_specs.md
section 18.3:
- All four workflows have correct workflow-level settings (timeout,
  save policy, errorWorkflow link) — verify via n8n-MCP by reading
  each workflow's settings and reporting.
- Every workflow exported to workflows/NN-name.json and committed.
- Restore drill: pick one workflow JSON, ask me to create a brand-new
  test workspace at n8n.cloud (or use an existing scratch instance),
  import the JSON, and confirm it loads cleanly. Report result.
- README has demo GIF + architecture doc link.

After green: tell me to push to a public GitHub repo and verify
rendering on github.com (Mermaid diagram, GIF, badges).

Final update to project_specs.md: add a "Build Retrospective" section
with one paragraph each on biggest gotcha hit, biggest time-saver,
and what to do differently for Project 2.
```

---

## Optional Prompt 9 — Synthetic lead generator

Skip if you'll be the only person demoing the bot. Useful if you want the live Form to feel alive for screen-recording sessions.

```
Read CLAUDE.md, project_specs.md, learnings.md.

Note from project_specs.md section 16: n8n Cloud blocks external npm
modules in Code nodes — Faker.js is not available. Build the synthetic
generator with hand-rolled JS using arrays of fake names, phone format
permutations, and message banks. ~50 lines of data + ~20 lines of logic
is sufficient.

Build workflow 05 per project_specs.md section "Optional Workflow 05 —
Synthetic Lead Generator":
- Schedule Trigger every 20 min between 09:00–22:00 Kyiv time.
- Code node "Maybe Generate" — 40% abort chance + weighted intent
  (20% hot / 50% warm / 30% cold), is_demo:true flag, fake data drawn
  from hardcoded banks (no external npm).
- Wait node 0–600 sec random jitter.
- Sheets Append to leads tab.

MCP execution flow: standard discovery → build → push → activate → test.

Then n8n_update_partial_workflow on workflow 01 to prepend "[DEMO]" or
a flag emoji to the Telegram message when is_demo=true. This is the
honesty principle — reviewers value transparency over fooled realism.

Update docs/google-sheets-schema.md to add the is_demo column. Update
README.md with a one-line note about synthetic demo leads.

After green: export workflow 05, report.
```

---

## Closing notes

- Prompts 1–5 are strictly linear.
- Prompts 6 and 7 each modify workflow 01 in sequence — also linear.
- Prompt 8 is the final QA gate.
- Prompt 9 is independent.

Between every prompt, three things happen on the operator's side: review what Claude Code reported, run the manual user-facing test described at the end of the prompt, and encode any new learnings into `learnings.md` (or via your compound-engineering tooling). Only then move to the next prompt.

If a manual test fails, do not move to the next prompt. Tell Claude Code what failed; let it diagnose via `n8n_executions({action:'get', id})` and fix in place via `n8n_update_partial_workflow`. Re-test before moving on.
