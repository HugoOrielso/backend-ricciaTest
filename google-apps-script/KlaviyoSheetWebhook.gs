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
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("KLAVIYO_SPREADSHEET_ID") || "";
  return jsonResponse_({
    ok: true,
    service: "Klaviyo Flow Sheet webhook",
    spreadsheetConfigured: Boolean(spreadsheetId),
  });
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const expectedSecret = PropertiesService.getScriptProperties().getProperty("KLAVIYO_SHEET_SECRET") || "";
    if (expectedSecret && payload.secret !== expectedSecret) {
      return jsonResponse_({ ok: false, error: "Unauthorized" });
    }

    const entries = (Array.isArray(payload.entries) ? payload.entries : [payload])
      .map(normalizeEntry_)
      .filter(function (entry) { return entry.email; });
    if (!entries.length) return jsonResponse_({ ok: false, error: "At least one email is required" });

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const spreadsheetId = PropertiesService.getScriptProperties().getProperty("KLAVIYO_SPREADSHEET_ID") || "";
      if (!spreadsheetId) throw new Error("KLAVIYO_SPREADSHEET_ID is not configured");
      const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
      ensureHeaders_(sheet);

      const existingRows = getEmailRows_(sheet);
      const rowsToAppend = [];
      let updated = 0;

      entries.forEach(function (entry) {
        const row = entryToRow_(entry);
        const existingRow = existingRows[entry.email];
        if (existingRow) {
          const range = sheet.getRange(existingRow, 1, 1, HEADERS.length);
          const currentRow = range.getValues()[0];
          const mergedRow = row.map(function (value, index) {
            return value === "" || value === null || typeof value === "undefined"
              ? currentRow[index]
              : value;
          });
          range.setValues([mergedRow]);
          updated += 1;
        } else {
          rowsToAppend.push(row);
        }
      });

      if (rowsToAppend.length) {
        sheet
          .getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, HEADERS.length)
          .setValues(rowsToAppend);
      }

      return jsonResponse_({
        ok: true,
        action: entries.length === 1 ? (updated ? "updated" : "inserted") : "batch",
        processed: entries.length,
        inserted: rowsToAppend.length,
        updated: updated,
      });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return jsonResponse_({ ok: false, error: String(error && error.message || error) });
  }
}

function normalizeEntry_(entry) {
  return {
    date: entry.date || "",
    name: entry.name || "",
    email: String(entry.email || "").trim().toLowerCase(),
    quizResult: entry.quizResult || "",
    utmSource: entry.utmSource || "",
    utmContent: entry.utmContent || "",
    utmCampaign: entry.utmCampaign || "",
  };
}

function entryToRow_(entry) {
  return [
    entry.date ? new Date(entry.date) : new Date(),
    entry.name,
    entry.email,
    entry.quizResult,
    entry.utmSource,
    entry.utmContent,
    entry.utmCampaign,
  ];
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

function getEmailRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  return sheet
    .getRange(2, 3, lastRow - 1, 1)
    .getDisplayValues()
    .reduce(function (rows, values, index) {
      const email = String(values[0] || "").trim().toLowerCase();
      if (email && !rows[email]) rows[email] = index + 2;
      return rows;
    }, {});
}

function jsonResponse_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
