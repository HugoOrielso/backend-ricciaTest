import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";

const backendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const csvPath = path.resolve(backendDir, "public/Klaviyo Flow Data.csv");
const batchSize = Math.min(Math.max(Number(process.env.SHEET_BACKFILL_BATCH_SIZE) || 25, 1), 100);
const isDryRun = process.argv.includes("--dry-run");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function loadCsvPeople() {
  const people = new Map();
  const rows = parseCsv(await fs.readFile(csvPath, "utf8"));
  for (const row of rows) {
    const email = String(row.Email || "").trim().toLowerCase();
    if (!email) continue;
    const csvName = [row["First Name"], row["Last Name"]]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ");
    people.set(email, {
      date: row["Date Sent"] || "",
      name: csvName,
      email,
      quizResult: "",
      utmSource: "",
      utmContent: "",
      utmCampaign: "",
    });
  }
  return [...people.values()];
}

async function main() {
  const people = await loadCsvPeople();
  const batches = chunks(people, batchSize);
  const backendApiUrl = process.env.BACKEND_API_URL?.trim().replace(/\/$/, "");
  const adminSecret = process.env.SHEET_BACKFILL_ADMIN_SECRET?.trim();
  if (!backendApiUrl) throw new Error("BACKEND_API_URL is required");
  if (!adminSecret) throw new Error("SHEET_BACKFILL_ADMIN_SECRET is required");

  let processed = 0;
  let matched = 0;
  let inserted = 0;
  let updated = 0;

  for (let index = 0; index < batches.length; index += 1) {
    const response = await axios.post(
      `${backendApiUrl}/api/admin/google-sheets/backfill`,
      { entries: batches[index], dryRun: isDryRun },
      {
        headers: { "x-backfill-secret": adminSecret },
        timeout: 30000,
      }
    );
    if (response.data?.success === false) {
      throw new Error(response.data.message || `Batch ${index + 1} rejected`);
    }

    matched += Number(response.data?.matched || 0);
    inserted += Number(response.data?.sheet?.inserted || 0);
    updated += Number(response.data?.sheet?.updated || 0);
    processed += Number(response.data?.processed || batches[index].length);
    console.log(`Batch ${index + 1}/${batches.length}: ${processed}/${people.length} processed`);
  }

  console.log(
    isDryRun
      ? `Dry run complete: ${people.length} unique emails, ${matched} matched in database, ${people.length - matched} CSV-only`
      : `Backfill complete: ${processed} processed, ${matched} enriched from database, ${inserted} inserted, ${updated} updated`
  );
}

await main();
