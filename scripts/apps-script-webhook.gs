/**
 * apps-script-webhook.gs
 *
 * Optional Apps Script bridge — replaces the 60-second Google Sheets polling
 * trigger with a 2–5 second push notification to n8n on Google Form submission.
 *
 * Setup:
 *   1. Open the linked Google Sheet → Extensions → Apps Script
 *   2. Paste this file (replacing any existing content)
 *   3. Set WEBHOOK_URL and WEBHOOK_SECRET constants below
 *   4. Triggers (clock icon) → Add Trigger:
 *        - Function: onFormSubmit
 *        - Event source: From spreadsheet
 *        - Event type: On form submit
 *   5. In n8n, build a new workflow with a Webhook node (POST, path of your choice).
 *      In the workflow's first Code/IF node, validate that the shared secret matches:
 *          if ($json.body?.secret !== '<WEBHOOK_SECRET>') throw new Error('Unauthorized');
 *      Then continue to Validate Fields → Normalize → … (same pipeline as WF01,
 *      but skip the Google Sheets Trigger — input is the POST payload instead).
 *
 * Security: the shared secret prevents random unauthorized POSTs from triggering
 * the workflow. It is NOT a cryptographic signature — sufficient for a private
 * portfolio instance, not for production multi-tenant deployments.
 *
 * Idempotency: each submit is uniquely identified by `row_number`. The n8n
 * workflow should dedupe on email (same pattern as WF01 Check Duplicate).
 *
 * Latency: typical end-to-end (form submit → Telegram message) drops from
 * ~60 seconds (polling worst case) to ~2–5 seconds (push + n8n execution).
 */

// CONFIG — fill before deploying
var WEBHOOK_URL = '';      // e.g. 'https://onewinnerfourtytwoloosers.app.n8n.cloud/webhook/<webhook-id>'
var WEBHOOK_SECRET = '';   // generate via `openssl rand -hex 32` or any long random string

function onFormSubmit(e) {
  if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
    Logger.log('Apps Script bridge not configured — set WEBHOOK_URL and WEBHOOK_SECRET');
    return;
  }

  // e.values is the row's cell values in column order. e.range gives the row number.
  // Headers (column A → R) are pulled live so the payload always matches the sheet schema.
  var sheet = e.range.getSheet();
  var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowValues = e.values || sheet.getRange(e.range.getRow(), 1, 1, sheet.getLastColumn()).getValues()[0];

  var lead = {};
  headerRow.forEach(function (header, idx) {
    if (header) lead[header] = rowValues[idx];
  });
  lead.row_number = e.range.getRow();
  lead.timestamp = lead.timestamp || new Date().toISOString();

  var payload = {
    secret: WEBHOOK_SECRET,
    source: 'apps-script-bridge',
    spreadsheet_id: sheet.getParent().getId(),
    sheet_name: sheet.getName(),
    lead: lead
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    followRedirects: true
  };

  try {
    var resp = UrlFetchApp.fetch(WEBHOOK_URL, options);
    Logger.log('n8n webhook responded ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 200));
  } catch (err) {
    // Surface failures so they show up in Apps Script Executions UI.
    // Don't rethrow — failing here would block the form submission's success state.
    Logger.log('Webhook POST failed: ' + err);
  }
}
