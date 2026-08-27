import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";

const backendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const csvPaths = [
  path.resolve(backendDir, "../frontend/public/Klaviyo Flow Data.csv"),
  path.resolve(backendDir, "../frontend/public/Klaviyo Flow Data destinatari.csv"),
];

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

const people = new Map();
for (const csvPath of csvPaths) {
  const rows = parseCsv(await fs.readFile(csvPath, "utf8"));
  for (const row of rows) {
    const email = String(row.Email || "").trim().toLowerCase();
    if (!email) continue;
    const previous = people.get(email) || {};
    people.set(email, {
      date: row["Send Time"] || row["Date Sent"] || previous.date || "",
      name: row["First Name"] || previous.name || "",
      email,
      quizResult: previous.quizResult || "",
      utmSource: previous.utmSource || "",
      utmContent: previous.utmContent || "",
      utmCampaign: previous.utmCampaign || "",
    });
  }
}

if (process.argv.includes("--dry-run")) {
  console.log(`CSV rows ready: ${people.size} unique emails`);
  process.exit(0);
}

const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL?.trim();
if (!webhookUrl) throw new Error("GOOGLE_SHEETS_WEBHOOK_URL is required");

let completed = 0;
for (const person of people.values()) {
  const response = await axios.post(webhookUrl, {
    secret: process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || "",
    ...person,
  });
  if (response.data?.ok === false) throw new Error(response.data.error || `Rejected: ${person.email}`);
  completed += 1;
  if (completed % 100 === 0) console.log(`Synced ${completed}/${people.size}`);
}

console.log(`Backfill complete: ${completed} unique people synced`);
