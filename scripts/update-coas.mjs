import fs from "node:fs/promises";
import { chromium } from "playwright";

const SOURCE_URL = "https://coa.reta-unfiltered.com/#directory";
const OUTPUT_PATH = new URL("../coa-data.json", import.meta.url);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const canonicalVendor = (value) => {
  const key = clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (key.includes("globalwellness")) return "Global Wellness Lab";
  if (key.includes("innopeptideus")) return "Innopeptide US";
  if (key.includes("innopeptide")) return "Innopeptide";
  if (key.includes("kerui")) return "Kerui Peptides";
  if (key.includes("sqpept")) return "SQ Peptide";
  if (key.includes("wanshun")) return "WanShun";
  if (key.includes("lunivo") || key.includes("luvino")) return key.includes("us") ? "Lunivo US" : "Lunivo";
  if (key.includes("marvelus")) return "Marvel US";
  if (key.includes("marvel")) return "Marvel Peptides";
  if (key.includes("lilipeptide")) return "Lilipeptide";
  if (key.includes("crushresearch")) return "Crush Research";
  if (key.includes("peptidelab")) return "Peptide Lab";
  return clean(value);
};

const canonicalProduct = (value) => {
  const original = clean(value);
  const key = original.toLowerCase().replace(/[^a-z0-9+]+/g, "");
  if (/^(semaglutide|glp1sg)$/.test(key)) return "GLP-1SG";
  if (/^(tirzepatide|trizepatide|glp2tz)$/.test(key)) return "GLP-2TZ";
  if (/^(retatrutide|reta|glp3rt|rt\d*)$/.test(key)) return "GLP-3RT";
  if (/^(tb500|tb5|thymosinbeta4|thymosinbeta5acetate)$/.test(key)) return "TB500";
  if (/^(ghkcu|ghk-cu)$/.test(key)) return "GHK-Cu";
  if (/^bpc157$/.test(key)) return "BPC-157";
  if (/^nad\+?$/.test(key)) return "NAD+";
  return original;
};

const normalizedStrength = (value) => clean(value).toLowerCase().replace(/\s+/g, "");
const dateValue = (value) => {
  const time = Date.parse(clean(value));
  return Number.isFinite(time) ? time : 0;
};
const latestPerKey = (records, dateField) => {
  const latest = new Map();
  for (const record of records) {
    const key = [record.vendor, record.product, normalizedStrength(record.strength)].join("|").toLowerCase();
    const prior = latest.get(key);
    if (!prior || dateValue(record[dateField]) >= dateValue(prior[dateField])) latest.set(key, record);
  }
  return [...latest.values()].sort((a, b) => a.vendor.localeCompare(b.vendor) || a.product.localeCompare(b.product) || normalizedStrength(a.strength).localeCompare(normalizedStrength(b.strength), undefined, { numeric: true }));
};

async function tableRows(page, requiredHeaders) {
  return page.locator("table").evaluateAll((tables, required) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const table = tables.find((candidate) => {
      const headers = [...candidate.querySelectorAll("thead th")].map((cell) => normalize(cell.textContent));
      return required.every((header) => headers.some((value) => value.includes(header)));
    });
    if (!table) return [];
    const headers = [...table.querySelectorAll("thead th")].map((cell) => normalize(cell.textContent));
    return [...table.querySelectorAll("tbody tr")].map((row) => {
      const cells = [...row.querySelectorAll("td")];
      const result = {};
      headers.forEach((header, index) => {
        const cell = cells[index];
        if (!cell) return;
        result[header] = String(cell.innerText || "").replace(/\s+/g, " ").trim();
        const link = cell.querySelector("a[href]");
        if (link) result[`${header}__href`] = link.href;
      });
      return result;
    });
  }, requiredHeaders);
}

const field = (row, name) => {
  const key = Object.keys(row).find((candidate) => !candidate.endsWith("__href") && candidate.includes(name));
  return key ? clean(row[key]) : "";
};
const hrefField = (row, name) => {
  const key = Object.keys(row).find((candidate) => candidate.endsWith("__href") && candidate.includes(name));
  return key ? clean(row[key]) : "";
};

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.goto(SOURCE_URL, { waitUntil: "networkidle", timeout: 120000 });
  await page.getByText(/\d+\s+COA records/i).first().waitFor({ timeout: 60000 });

  const completedRows = await tableRows(page, ["vendor", "product", "purity", "analysis date"]);
  if (completedRows.length < 100) throw new Error(`Only ${completedRows.length} completed rows were found; refusing to replace the last good snapshot.`);
  const completed = latestPerKey(completedRows.map((row) => {
    const reportUrl = hrefField(row, "verify") || hrefField(row, "report") || hrefField(row, "coa");
    return {
      vendor: canonicalVendor(field(row, "vendor")),
      product: canonicalProduct(field(row, "product")),
      strength: field(row, "vial size") || field(row, "size"),
      netContent: field(row, "net content"),
      purity: field(row, "purity"),
      lab: field(row, "testing lab") || field(row, "lab"),
      analysisDate: field(row, "analysis date") || field(row, "date"),
      reportUrl,
      previewUrl: /\.(?:pdf|png|jpe?g)(?:[?#]|$)/i.test(reportUrl) ? reportUrl : ""
    };
  }).filter((record) => record.vendor && record.product && record.strength), "analysisDate");

  const pendingButton = page.getByRole("button", { name: /view pending tests/i }).first();
  await pendingButton.click();
  await page.getByRole("dialog").waitFor({ timeout: 30000 });
  const pendingRows = await tableRows(page, ["vendor", "product", "date sent", "expected results"]);
  const pending = latestPerKey(pendingRows.map((row) => ({
    vendor: canonicalVendor(field(row, "vendor")),
    product: canonicalProduct(field(row, "product")),
    strength: field(row, "vial size") || field(row, "size"),
    dateSent: field(row, "date sent"),
    expectedDate: field(row, "expected results")
  })).filter((record) => record.vendor && record.product && record.strength), "dateSent");

  let previous = {};
  try { previous = JSON.parse(await fs.readFile(OUTPUT_PATH, "utf8")); } catch {}
  const unchanged = JSON.stringify(previous.completed || []) === JSON.stringify(completed) && JSON.stringify(previous.pending || []) === JSON.stringify(pending);
  const output = {
    source: SOURCE_URL,
    attribution: "RU Inner Circle COA Library",
    updatedAt: unchanged ? previous.updatedAt || null : new Date().toISOString(),
    counts: { completed: completed.length, pending: pending.length },
    completed,
    pending
  };
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Saved ${completed.length} current completed COAs and ${pending.length} pending tests.`);
} finally {
  await browser.close();
}
