import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);

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

const hasFailedText = (value) => /\bfail(?:ed)?\b/i.test(String(value || ""));
const hasFailedIdentity = (value) => {
  const text = String(value || "");
  if (/\bnot\s+identif(?:iable|ied)\b/i.test(text)) return true;
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  return lines.some((line, index) => {
    if (!/\bidentity\b/i.test(line)) return false;
    const identitySection = lines.slice(index, index + 6).join(" ");
    return /\bnot\b/i.test(identitySection);
  });
};
const isFailedReportText = (value) => hasFailedText(value) || hasFailedIdentity(value);

async function extractReportText(reportUrl) {
  if (!reportUrl) return { checked: false, text: "" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let folder = "";
  try {
    const response = await fetch(reportUrl, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) return { checked: false, text: "" };
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const isPdf = contentType.includes("application/pdf") || /\.pdf(?:[?#]|$)/i.test(reportUrl);
    const isImage = contentType.startsWith("image/") || /\.(?:png|jpe?g|webp)(?:[?#]|$)/i.test(reportUrl);
    if (!isPdf && !isImage) return { checked: false, text: "" };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 25 * 1024 * 1024) return { checked: false, text: "" };
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "coa-scan-"));
    if (isPdf) {
      const pdfPath = path.join(folder, "report.pdf");
      await fs.writeFile(pdfPath, bytes);
      try {
        const { stdout } = await execFileAsync("pdftotext", [pdfPath, "-"], { maxBuffer: 10 * 1024 * 1024 });
        if (clean(stdout)) return { checked: true, text: stdout };
      } catch {}
      const imageBase = path.join(folder, "page");
      await execFileAsync("pdftoppm", ["-f", "1", "-singlefile", "-png", "-r", "200", pdfPath, imageBase], { maxBuffer: 10 * 1024 * 1024 });
      const { stdout } = await execFileAsync("tesseract", [imageBase + ".png", "stdout"], { maxBuffer: 10 * 1024 * 1024 });
      return { checked: true, text: stdout };
    }
    const imagePath = path.join(folder, "report-image");
    await fs.writeFile(imagePath, bytes);
    const { stdout } = await execFileAsync("tesseract", [imagePath, "stdout"], { maxBuffer: 10 * 1024 * 1024 });
    return { checked: true, text: stdout };
  } catch (error) {
    console.warn("COA status check unavailable:", reportUrl, error?.message || error);
    return { checked: false, text: "" };
  } finally {
    clearTimeout(timeout);
    if (folder) await fs.rm(folder, { recursive: true, force: true });
  }
}

async function coaStatus(record) {
  if (isFailedReportText(record.sourceText)) return "Failed";
  const scan = await extractReportText(record.reportUrl);
  if (!scan.checked) return "Unchecked";
  return isFailedReportText(scan.text) ? "Failed" : "Passed";
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

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
  await page.goto(SOURCE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByText(/\d+\s+COA records/i).first().waitFor({ timeout: 60000 });

  const pendingCountElement = page.locator(".pending-teaser-count strong").first();
  await pendingCountElement.waitFor({ timeout: 60000 });
  await page.waitForFunction(() => {
    const value = document.querySelector(".pending-teaser-count strong")?.textContent?.trim();
    return Boolean(value && /^\d+$/.test(value));
  }, { timeout: 60000 });
  const advertisedPendingCount = Number.parseInt(await pendingCountElement.innerText(), 10);

  const completedRows = await tableRows(page, ["vendor", "product", "purity", "analysis date"]);
  if (completedRows.length < 100) throw new Error(`Only ${completedRows.length} completed rows were found; refusing to replace the last good snapshot.`);
  const completedBase = latestPerKey(completedRows.map((row) => {
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
      previewUrl: /\.(?:pdf|png|jpe?g)(?:[?#]|$)/i.test(reportUrl) ? reportUrl : "",
      sourceText: Object.values(row).join(" ")
    };
  }).filter((record) => record.vendor && record.product && record.strength), "analysisDate");

  const completed = await mapWithConcurrency(completedBase, 4, async (record) => {
    const status = await coaStatus(record);
    const { sourceText, ...savedRecord } = record;
    return { ...savedRecord, status };
  });

  const pendingButton = page.getByRole("button", { name: /view pending tests/i }).first();
  await pendingButton.click();
  await page.locator(".pending-modal").waitFor({ timeout: 30000 });
  if (advertisedPendingCount > 0) {
    await page.locator(".pending-table-wrap tbody tr").first().waitFor({ timeout: 60000 });
  } else {
    await page.locator(".pending-empty").last().waitFor({ timeout: 60000 });
  }
  const pendingRows = await tableRows(page, ["vendor", "product", "date sent", "expected results"]);
  if (pendingRows.length < advertisedPendingCount) {
    throw new Error(`The source advertises ${advertisedPendingCount} pending tests, but only ${pendingRows.length} rows were captured; refusing to replace the last good snapshot.`);
  }
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
