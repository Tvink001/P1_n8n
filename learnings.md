# Learnings

Running log of project-specific patterns, gotchas, and reusable solutions.

**Format:** dated entry, 3–10 lines, tagged by domain. Tags I use: `#n8n`, `#telegram`, `#sheets`, `#claude-api`, `#mcp`, `#cloud`, `#error-handling`, `#routing`, `#debugging`, `#portfolio-polish`. Grep-friendly so future projects can pull patterns by tag (`grep "#sheets" learnings.md`).

**Maintenance:** operator-side discipline. Claude Code reads this file via Rule 1 on every prompt but does not write to it directly — it surfaces suggested entries at the end of each prompt report; operator decides what to encode.

---

## 2026-05 — Project setup

### Claude model version refresh `#claude-api`

The original PDF brief specifies "Claude-3.5 Haiku" for AI qualification (correct at the time of brief writing). This build uses `claude-haiku-4-5` — the current production Haiku model as of May 2026. Routine version refresh, no architectural impact. For future projects:
- Always verify current Anthropic model strings via Context7 before pinning a version in workflow JSON
- Brief-specified model strings are timestamps, not specifications

---

_(Entries below this line are added as the build progresses. Use `/ce-compound` (operator-side) to encode new entries after each completed prompt.)_

---

## 2026-05-18 — Workflow 01 build (Prompt 3)

### `$('NodeName')` only works within the same execution path `#n8n` `#routing` `#debugging`

In n8n's `executionOrder: v1` model, `$('NodeName')` can only reference nodes that ran in the **same execution branch**. Parallel branches do not share data. Original design had `Load Config` as a parallel branch from `Sheets Trigger` — `$('Load Config')` was inaccessible from `Send Message` (threw "Node hasn't been executed"). Fix: moved `Load Config` into the main linear chain (`Sheets Trigger → Load Config → Validate Fields → …`). Downstream Code nodes reference `$('Sheets Trigger').first()` for trigger data directly.

### Sheets Trigger does NOT output `row_number` — only Sheets action nodes do `#sheets` `#n8n` `#debugging`

The `learnings.md` entry for OQ-1 confirmed `row_number` exists in the Sheets action schema as a `readOnly` field. At runtime, the **Sheets Trigger** (`rowAdded` event) does NOT include `row_number` in its output JSON. The field is only present in rows returned by the Google Sheets **action** node (Get Row(s), etc.). Fix: extract `row_number` inside Check Duplicate from the `$input.all()` items (which come from Get All Rows), matching by email and taking the highest row_number.

### Telegram `chatId` must be a plain string — not wrapped in `__rl` resource locator `#telegram` `#n8n` `#debugging`

The n8n-MCP validator suggested wrapping `chatId` in `{ "__rl": true, "value": "...", "mode": "expression" }` (50% confidence autofix). This causes "chat not found" at runtime because the Telegram node's `chatId` is a plain `string` type, not a `resourceLocator`. Always set `chatId` as a bare string or expression string. The 50% confidence `__rl` suggestion is incorrect for this field.

### Telegram groups: chat IDs from `@getmyidbot` are correct, no `-100` prefix needed `#telegram` `#debugging`

Standard Telegram groups (type `"group"`) use the raw negative ID (e.g. `-5270803125`). Only supergroups need the `-100XXXXXXXXXX` format. Adding `-100` to a basic group ID causes "chat not found". Verify group type via `getUpdates` API call — if `"type": "group"`, use the raw ID as-is.

### Bot must be added to Telegram group before it can send messages — "chat not found" otherwise `#telegram` `#debugging`

Telegram returns `400 Bad Request: chat not found` when the bot is not yet a member of the target group, even if the chat ID is correct. Add the bot to each group (General, Seniors, Juniors) via Telegram before activating the workflow. Confirmed via `getUpdates` that `status: "member"` is required.

### Parallel branch architecture doesn't work for shared config in n8n v1 — use linear chain `#n8n` `#routing`

Intended design: `Sheets Trigger → [Load Config branch, Validate Fields branch]`. Runtime behavior: `$('Load Config')` inaccessible from `Send Message` (cross-branch data isolation). Final working architecture: `Sheets Trigger → Load Config → Validate Fields → Normalize → Get All Rows → Check Duplicate → IS Duplicate → [Skip | Send Message → Write Telegram IDs]`. Code nodes reference `$('Sheets Trigger').first()` for lead data since `$input` in that chain carries config data from Load Config.

---

## 2026-05-18 — Workflow 02 build (Prompt 4)

### Telegram Trigger `updates` is top-level, not in `additionalFields` `#telegram` `#n8n`

`telegramTrigger` v1.3 has `updates` as a **top-level** `multiOptions` parameter (UI label: "Trigger On"). Value is an array like `["callback_query"]` or `["message", "callback_query"]`. The original assumption that it sits under `additionalFields.updates` is wrong — `additionalFields` is a sibling collection for chat/user ID restrictions and image download settings. Verified via `get_node(telegramTrigger, full)`.

### Telegram callback_data with underscores in action requires `parts.slice(2).join('_')` `#telegram` `#n8n`

Callback data format `lead_{rowId}_{action}` works fine for `taken` and `done`, but `in_progress` itself contains an underscore. Splitting `lead_5_in_progress` by `_` yields 4 parts, not 3. The original spec check `parts.length !== 3` would have rejected `in_progress` callbacks. Fix: `parts.length < 3` for the lower bound and `parts.slice(2).join('_')` to reconstruct multi-word actions. Apply to all callback parsers in the project.

### Telegram `editMessageText` requires explicit `messageType: "message"` `#telegram` `#n8n`

The Telegram node's `editMessageText` operation has a `messageType` parameter with values `"message"` or `"inlineMessage"`. There's no default applied at runtime — without setting it explicitly, the node won't know which schema branch to use for `chatId` vs `inlineMessageId`. Always set `messageType: "message"` when editing a regular message that has a `chat_id` and `message_id`.

### Telegram bot webhook auto-registers to n8n on workflow activation `#telegram` `#n8n` `#cloud`

When a workflow with `telegramTrigger` is activated, n8n Cloud auto-registers the bot's webhook via `setWebhook` to point at the n8n trigger URL. Verify via `curl -k https://api.telegram.org/bot<TOKEN>/getWebhookInfo` — should show `url: https://<workspace>.app.n8n.cloud/webhook/<trigger-id>/webhook` and `allowed_updates: ["callback_query"]` (or whatever was set in the trigger's `updates` field). If the webhook URL doesn't match, activation may have failed silently.

### Sheets Trigger fires for newly-added rows only AFTER first baseline poll `#sheets` `#n8n` `#debugging`

Confirmed via repeated test cycles: the Sheets Trigger marks all existing rows as "seen" on its first poll after activation. Rows added BEFORE that first poll won't fire the trigger. Every workflow re-activation (including updates that toggle active state) re-establishes the baseline. To test: activate workflow, wait ~10s for first poll, then add a brand new row.

### Manual executions in n8n editor differ from polling-trigger executions `#n8n` `#debugging`

Clicking "Execute Workflow" in the n8n editor creates a `mode: "manual"` execution that may use cached/pinned trigger data. This can yield misleading results during debugging — e.g., Send Message may run with 0 input items but still try to resolve expressions. Always validate behavior with `mode: "trigger"` (automatic polling) or `mode: "webhook"` (actual callback) executions, not manual editor runs.

---

## 2026-05-18 — Workflow 03 build (Prompt 5)

### `errorWorkflow` on the error-handler workflow itself → infinite recursion `#n8n` `#error-handling`

WF03 (error alerts) must NOT have its own `settings.errorWorkflow` set. If the Sheets append or email send inside WF03 fails, an `errorWorkflow` setting would trigger another instance of WF03, which might fail in the same way, ad infinitum. The Cloud instance would eventually rate-limit but you'd burn execution quota and spam your inbox. Production-ready pattern: error-handler workflows are the leaf of the error-handling tree.

### Build the execution URL manually instead of relying on `$execution.url` in Error Trigger context `#n8n` `#error-handling`

The runtime expression `$execution.url` may or may not resolve correctly when evaluated from a workflow triggered by the Error Trigger (it might return WF03's own execution URL rather than the failing workflow's). More robust: build the URL string in the Format Error Row Code node using `err.workflow.id` and `err.execution.id` directly: `https://<workspace>.app.n8n.cloud/workflow/${workflowId}/executions/${executionId}`. Pass downstream as `$json.execution_url` and reference it in the email body. Avoids dependency on undocumented expression behavior.

### `n8n_update_partial_workflow` with `updateSettings` MUST include ALL settings — partial merge doesn't work `#n8n` `#mcp`

When using `updateSettings` op in `n8n_update_partial_workflow`, you must pass the full settings object including `executionOrder`, `executionTimeout`, save policies, etc. — not just the field you want to change. Otherwise the missing fields get reset to n8n defaults. To add `errorWorkflow` to WF01 without resetting the production settings, the call was:
```json
{ "type": "updateSettings", "settings": { "executionOrder": "v1", "executionTimeout": 300, "saveDataSuccessExecution": "none", "saveDataErrorExecution": "all", "saveManualExecutions": false, "errorWorkflow": "xUPMrswt8FvHxKYU" } }
```

### `append` operation on Sheets v4.7 validates cleanly — only `update` triggers the v3-schema false positive `#sheets` `#n8n`

The MCP validator's "Range required for update operation" and "Values are required" false positives ONLY hit the `update` operation. The `append` operation uses the same `columns` resourceMapper structure but validates clean — 0 errors. So workflow build cost is lower for append-heavy flows (e.g. event logging) than update-heavy flows.

### Wire `errorWorkflow` only AFTER the target workflow exists `#n8n` `#routing`

The build order matters: build WF03 first, get its workflow ID, then wire WF01 and WF02 via `updateSettings.errorWorkflow = <WF03_id>`. Doing it in the other order (setting `errorWorkflow` to a placeholder ID, then creating WF03) leaves a broken reference. Per spec section 18, all workflows' definitions of done include checking this linkage was applied AFTER WF03 was built.

---

## 2026-05-18 — AI Qualification injection (Prompt 6)

### Native Anthropic node is `@n8n/n8n-nodes-langchain.anthropic`, NOT `n8n-nodes-base.anthropic` `#claude-api` `#n8n`

The standalone non-Agent Anthropic node lives under the LangChain package despite working as a regular pipeline node (no AI Agent parent required). Resource `text`, operation `message`. The often-assumed `n8n-nodes-base.anthropic` doesn't exist. The other variants in this package (`lmChatAnthropic`, `lmChatAnthropicTool`, `anthropicTool`) all require AI Agent context and won't work standalone.

### Set `simplify: false` on Anthropic node for predictable JSON parsing `#claude-api` `#n8n`

With `simplify: true` (default), the n8n Anthropic node collapses the response into a shape that varies depending on the request type. With `simplify: false`, you get the raw Anthropic API response: `{ id, type, role, content: [{ type: 'text', text: '...' }], usage, stop_reason, ... }`. The model output text is reliably at `json.content[0].text`. Use simplify:false whenever a downstream Code node must parse the response.

### Bilingual cues in the system prompt dramatically improve Ukrainian/Russian lead scoring `#claude-api`

Without explicit Ukrainian/Russian intent vocabulary in the system prompt, Haiku tended to default-score Cyrillic leads into warm/cold regardless of urgency cues. Adding `"хочу"`, `"потрібен"`, `"ASAP"` to the "hot" examples and `"цікавлюсь"`, `"можливо"` to the "cold" examples in the system prompt fixed it — Оксана's "Хочу записатись… стартуємо ASAP" now correctly scores 9/10 hot.

### `temperature: 0` + `max_tokens: 256` is sufficient for structured JSON scoring tasks `#claude-api`

Haiku 4.5 reliably emits clean JSON (no code fences, no preamble) when instructed clearly and given temperature 0. 256 max_tokens is plenty for `{"score": N, "category": "x", "reason": "10 words"}` — observed output is ~60-80 tokens. Don't over-allocate max_tokens for tasks like this; lower caps fail safer and cheaper.

### Confirm Claude model strings via Context7 against the Anthropic SDK type definition `#claude-api` `#mcp`

The Anthropic SDK TypeScript repo's `messages.ts` file exports the `Model` type union. Pulling it via Context7 (`/anthropics/anthropic-sdk-typescript`) reveals the current valid model aliases (`claude-haiku-4-5`, `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-7`, etc.) without guessing. The undated alias auto-tracks the latest dated revision in that family.

### Format Message Code node beats inline expressions once the AI header lands `#n8n` `#portfolio-polish`

The pre-AI text expression in Send Message was already at the edge of readability. Adding the conditional `score > 0` AI header (`{emoji} *{label} лид — {score}/10* — {reason}`) pushed inline expressions into unmaintainable territory. Splitting Format Message into its own Code node keeps Send Message clean (`={{ $json.telegramText }}`) and centralizes formatting logic where it can be unit-tested if needed.

### `runOnceForAllItems` + `$('NodeName').first()` is a single-lead-per-batch pattern — adding rows in bulk silently drops all but the first `#n8n` `#sheets`

Confirmed by the Maria-paste-split incident: when the Sheets Trigger fires with N new items, the chain only processes the FIRST one because Validate Fields uses `$('Sheets Trigger').first()`. The other N-1 items get silently dropped (n8n moves the trigger cursor past them). For this portfolio scope the workaround is "tell the operator to add rows one at a time" — for a production version with high lead velocity, we'd need to switch the Code nodes to `runOnceForEachItem` and update `$('Get All Rows').all()` in Check Duplicate to compensate.

---

## 2026-05-18 — Smart Routing + Stale-Lead Reminder (Prompt 7)

### `n8n_update_partial_workflow` `addConnection` uses `sourceOutput`/`targetInput`, NOT `sourcePort`/`targetPort` for Switch branches `#n8n` `#mcp` `#routing`

To wire a Switch node's output 1 (or 2, or N) to a downstream node via the MCP API, the correct param names are `sourceOutput: 1` and `targetInput: 0`. The intuitive-sounding `sourcePort` is silently ignored (or treated as 0), so both addConnection calls end up on output 0 with both targets firing together. This silent failure was caught only by `n8n_validate_workflow`'s warning: "Switch has 2 connections on output 0 but no connections on any other outputs". Diagnostic recipe: always validate after Switch wiring, look for the multi-target-on-same-output warning. Lesson encoded for all future Switch/IF branching in the project.

### Renaming nodes via `updateNode { updates: { name: "..." } }` auto-updates existing connections `#n8n` `#mcp`

When renaming "Send Message" → "Send Junior" via partial update, n8n auto-renamed the connection key in the workflow's `connections` object so `"Send Message → Write Telegram IDs"` became `"Send Junior → Write Telegram IDs"` without explicit operation. Saves a manual `removeConnection`+`addConnection` round-trip. BUT: any subsequent `removeConnection` referencing the OLD name will fail with "No connection exists from X to Y" — must use the new name. Use `continueOnError: true` on the batch to survive these stale-name failures.

### Idempotent "fire-once-and-only-once" cron pattern: write-after-success guard column `#n8n` `#error-handling`

For any cron-triggered workflow that must fire exactly once per matching record (notifications, reminders, follow-ups), the pattern is:
1. Read all candidate records.
2. Filter to those WITHOUT the guard column set (e.g. `!row.reminder_sent_at`).
3. Loop over each (Split In Batches batchSize=1).
4. Fire the side effect (send the notification).
5. ONLY after the side effect succeeds, write the guard column with a timestamp.

If step 4 fails, the workflow errors → step 5 never runs → the next cron tick retries the same record. If it succeeds, the guard column is set → next tick skips it. This avoids the need for an external state store and gracefully handles transient failures (network blip, rate limit). Reusable across any "send reminder / send digest / poll status / nudge user" scenario.

### Split In Batches output index convention: main[0] = done, main[1] = each batch `#n8n`

Sheet/loop pattern in n8n: Split In Batches has 2 outputs. Output 0 (`main[0]`) fires once when all batches are done — typically left empty or connected to a final aggregation. Output 1 (`main[1]`) fires per batch — that's where the loop body connects. The loop closes by routing the last node of the loop body back to Split In Batches's input. n8n handles iteration internally; no explicit counter needed.

### Sheets `update` operation false positive in the MCP validator: also fires for Sheets v4.7 in WF04 `#sheets` `#mcp`

Same v3-vs-v4.7 schema mismatch we documented in Prompt 3 (Write Telegram IDs in WF01). It strikes every `update` operation node we build. By contrast, `append` (used in WF03's Append Error Row) validates clean. Treat any pair of `Range is required for update operation` + `Values are required for update operation` errors on a Sheets v4.7 update node as known false positives — confirmed working at runtime each time.

---

## 2026-05-18 — WF01 stability fixes (Prompt 7 testing fallout)

### Sheets Trigger `rowAdded` event captures partial rows during cell-by-cell typing `#sheets` `#n8n` `#debugging`

When the operator types lead data directly into Google Sheets cell-by-cell, `rowAdded` event captures the row the moment the FIRST cell gets a value. The trigger's cursor advances past that row immediately. Subsequent typing in that same row never re-triggers the workflow. Result: lead silently lost. The default polling interval (1 minute on Cloud) is much shorter than typical typing speed for a 7-column row. Switch to `anyUpdate` event when leads are added via direct sheet editing instead of via a Google Form (which writes the whole row atomically).

### `anyUpdate` Sheets Trigger requires an "already processed" guard in Check Duplicate `#sheets` `#n8n` `#idempotency`

With `anyUpdate`, every cell change re-fires the workflow. Without a guard, WF02's callback writes (`status`, `assigned_to`, `updated_at`) would cause WF01 to re-process the same lead and send another Telegram message. The guard: check if the matched row's `telegram_message_id` is already populated. If yes, mark as duplicate and skip. Combined with the email-multi-match dedup, this handles both new rows and edits cleanly. Pattern is reusable for any "trigger on edit, but process only once per record" scenario.

### "Process each item independently" via Split In Batches `batchSize=1` after data-fan-in `#n8n` `#routing`

To solve "N new items from trigger → only first processes" in `runOnceForAllItems` chains where downstream nodes use `$('UpstreamNode').first()`: insert Split In Batches (batchSize=1) right after the data is shaped, and loop the tail of the chain back to Split In Batches's input. Topology:
```
Trigger → Validate (returns all valid items) → Normalize (maps all items) → [parallel: Get All Rows for sheet lookup]
                                                                          → Split In Batches batchSize=1
                                                                              → loop body (Code nodes use $input.first() since each iteration has one item)
                                                                              → all loop-body exits route back to Split In Batches's input
                                                                          → main[0] (done output) → end
```
Both the happy path AND any branch endpoints (e.g. Skip Duplicate for filtered-out items) must route back to Split In Batches's input, otherwise the loop stalls.

### `Normalize → [Get All Rows (parallel, dead-end), Split Leads (main path)]` works for shared-read-then-iterate `#n8n` `#routing`

When the loop body needs to read from a sheet that should be queried once (not per-iteration), put the Sheets Read node in a parallel branch from the same upstream that feeds Split In Batches. In n8n v1 execution order, depth-first traversal runs the parallel-branch Sheets Read first; its output is dead-end (no further connections) but the data is accessible via `$('NodeName').all()` from inside the loop body. This is more efficient than putting Sheets Read inside the loop (which would re-query the sheet N times for N items).

### Don't throw from Code nodes when the trigger fires for incomplete user input `#n8n` `#error-handling`

If the trigger event semantics mean partial/incomplete data WILL legitimately arrive (e.g. `anyUpdate` on a sheet being edited cell-by-cell), the validation Code node should silently skip invalid items by returning `[]` rather than throwing. Throwing fires the linked errorWorkflow (WF03), which would email the operator for what's really just normal user typing — noise that drowns out real failures.

---

## 2026-05-18 — MCP + n8n Cloud connectivity on Windows

### n8n-mcp must be installed globally, not run via npx `#mcp` `#n8n` `#debugging`

Running `npx n8n-mcp` in `.mcp.json` causes a 30-second timeout in Claude Code. `npx` downloads the package fresh each run, exceeding the MCP startup window. Fix: `npm install -g n8n-mcp` once, then point `.mcp.json` command at the installed binary directly (`C:\Users\Admin\AppData\Roaming\npm\n8n-mcp.cmd`, args: `[]`). For future projects on Windows: always pre-install MCP server packages globally before wiring them into `.mcp.json`.

### SSL certificate errors block both npm and n8n-mcp on this machine `#mcp` `#n8n` `#cloud` `#debugging`

This Windows environment intercepts TLS traffic (corporate-style cert chain). Symptoms: `npm UNABLE_TO_VERIFY_LEAF_SIGNATURE` and n8n-mcp "No response from n8n server" despite correct URL/key. Same root cause, two fixes needed:
- npm install: `npm config set strict-ssl false` → install → `npm config set strict-ssl true`
- n8n-mcp runtime: add `"NODE_TLS_REJECT_UNAUTHORIZED": "0"` to the env block in `.mcp.json`

Without the runtime fix, n8n-mcp starts but silently fails every API call.

### `.mcp.json` must have secrets inlined on Windows; add it to `.gitignore` `#mcp` `#n8n`

Claude Code's `${VAR}` syntax in `.mcp.json` resolves from shell environment variables, not from `.env` files. On Windows PowerShell, `.env` values are not auto-exported to the shell. Solution: inline real values directly into `.mcp.json` and add `.mcp.json` to `.gitignore`. Keep the original `${VAR}` version documented in `project_specs.md` as the template reference.

---

## 2026-05-18 — Node structure discoveries (Prompt 3 research)

### Telegram inline keyboard: top-level params, not inside additionalFields `#telegram` `#n8n`

For `sendMessage`, `replyMarkup` and `inlineKeyboard` are **top-level** node parameters (shown alongside `chatId`, `text`). `parse_mode` lives inside `additionalFields`. The `inlineKeyboard` structure in workflow JSON:
```json
"replyMarkup": "inlineKeyboard",
"inlineKeyboard": {
  "rows": [{ "row": { "buttons": [
    { "text": "🟢 Взять", "additionalFields": { "callback_data": "lead_5_taken" } }
  ]}}]
}
```
`callback_data` uses snake_case (not camelCase). `parse_mode` value for legacy Markdown is `"Markdown"` (not `"MarkdownV2"`).

### Google Sheets Trigger outputs `row_number`, not `_rowNumber` `#sheets` `#n8n`

The Google Sheets Trigger emits the sheet row number as `row_number` (confirmed from the Sheets action node schema where it appears as a `readOnly` field). Use `$json.row_number` in expressions and in `callback_data` construction. Verified node versions for this build: `googleSheetsTrigger` v1, `googleSheets` v4.7, `telegram` v1.2, `if` v2.3.

### n8n Cloud instance sleeps when idle `#n8n` `#cloud`

Opening `https://<workspace>.app.n8n.cloud` in a browser wakes it. The MCP health check will fail with "No response from n8n server" while the instance is sleeping. Always wake the instance before starting a build session.
