const SHEET_NAME = "Klaviyo Flow";
const HEADERS = [
  "DATA",
  "NOME",
  "EMAIL",
  "RISULTATO QUIZ [KIT CONSIGLIATO]",
  "UTM_SOURCE",
  "UTM_CONTENT",
  "UTM_CAMPAIGN",
];

function doGet() {
  return jsonResponse_({ ok: true, service: "Klaviyo Flow Sheet webhook" });
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const expectedSecret = PropertiesService.getScriptProperties().getProperty("KLAVIYO_SHEET_SECRET") || "";
    if (expectedSecret && payload.secret !== expectedSecret) {
      return jsonResponse_({ ok: false, error: "Unauthorized" });
    }

    const email = String(payload.email || "").trim().toLowerCase();
    if (!email) return jsonResponse_({ ok: false, error: "Email is required" });

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
      ensureHeaders_(sheet);

      const row = [
        payload.date ? new Date(payload.date) : new Date(),
        payload.name || "",
        email,
        payload.quizResult || "",
        payload.utmSource || "",
        payload.utmContent || "",
        payload.utmCampaign || "",
      ];
      const existingRow = findEmailRow_(sheet, email);

      if (existingRow) {
        sheet.getRange(existingRow, 1, 1, HEADERS.length).setValues([row]);
        return jsonResponse_({ ok: true, action: "updated", row: existingRow });
      }

      sheet.appendRow(row);
      return jsonResponse_({ ok: true, action: "inserted", row: sheet.getLastRow() });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return jsonResponse_({ ok: false, error: String(error && error.message || error) });
  }
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }

  const current = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
  if (current.join("|") !== HEADERS.join("|")) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  sheet.setFrozenRows(1);
}

function findEmailRow_(sheet, email) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const match = sheet
    .getRange(2, 3, lastRow - 1, 1)
    .createTextFinder(email)
    .matchEntireCell(true)
    .matchCase(false)
    .findNext();
  return match ? match.getRow() : 0;
}

function jsonResponse_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
