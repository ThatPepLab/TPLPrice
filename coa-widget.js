(() => {
  const SOURCE = location.pathname.toLowerCase().includes("/tplprice/") ? "coa-data.json" : "https://raw.githubusercontent.com/ThatPepLab/TPLPrice/main/coa-data.json?updated=" + Date.now();
  let snapshot = { completed: [], pending: [], updatedAt: null };
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const vendorKey = (value) => {
    const key = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (key.includes("globalwellness")) return "globalwellness";
    if (key.includes("innopeptideus")) return "innopeptideus";
    if (key.includes("innopeptide")) return "innopeptide";
    if (key.includes("kerui")) return "kerui";
    if (key.includes("sqpept")) return "sqpeptide";
    if (key.includes("wanshun")) return "wanshun";
    if (key.includes("lunivo") || key.includes("luvino")) return key.includes("us") ? "lunivous" : "lunivo";
    if (key.includes("marvelus")) return "marvelus";
    if (key.includes("marvel")) return "marvel";
    if (key.includes("lilipeptide")) return "lilipeptide";
    if (key.includes("crushresearch")) return "crushresearch";
    if (key.includes("peptidelab")) return "peptidelab";
    return key.replace(/(?:peptides?|laborator(?:y|ies)|labs?|warehouse|international|usa|china)/g, "");
  };
  const productKey = (value) => String(value || "").toLowerCase()
    .replace(/\d+(?:\.\d+)?\s*(?:mg|mcg|iu|ml)\b/g, "")
    .replace(/semaglutide|glp[\s-]*1sg/g, "glp1sg")
    .replace(/tirzepatide|trizepatide|glp[\s-]*2tz/g, "glp2tz")
    .replace(/retatrutide|glp[\s-]*3rt/g, "glp3rt")
    .replace(/thymosin\s*beta[\s-]*[45](?:\s*acetate)?|tb[\s-]*500/g, "tb500")
    .replace(/bpc[\s-]*157/g, "bpc157")
    .replace(/ghk[\s-]*cu/g, "ghkcu")
    .replace(/[^a-z0-9]+/g, "");
  const strengthKey = (value) => {
    const text = String(value || "").toLowerCase().replace(/,/g, "");
    const found = text.match(/(\d+(?:\.\d+)?)\s*(mcg|mg|g|iu|ml)\b/);
    if (!found) return text.replace(/\s+/g, "");
    let amount = Number(found[1]), unit = found[2];
    if (unit === "mcg") { amount /= 1000; unit = "mg"; }
    if (unit === "g") { amount *= 1000; unit = "mg"; }
    return Number(amount.toFixed(6)) + unit;
  };
  const dateValue = (value) => { const time = Date.parse(String(value || "")); return Number.isFinite(time) ? time : 0; };
  const prettyDate = (value) => { const date = new Date(String(value || "")); return Number.isNaN(date.getTime()) ? String(value || "Date not listed") : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date); };
  const matches = (product, strength, vendor) => {
    const productId = productKey(product), strengthId = strengthKey(strength), vendorId = vendorKey(vendor || "");
    const accepts = (record) => productKey(record.product) === productId && strengthKey(record.strength) === strengthId && (!vendorId || vendorKey(record.vendor) === vendorId);
    return {
      completed: (snapshot.completed || []).filter(accepts).sort((a, b) => dateValue(b.analysisDate) - dateValue(a.analysisDate)),
      pending: (snapshot.pending || []).filter(accepts).sort((a, b) => dateValue(b.dateSent) - dateValue(a.dateSent))
    };
  };
  const markup = (product, strength, vendor) => {
    const result = matches(product, strength, vendor);
    if (!result.completed.length && !result.pending.length) return "";
    const attrs = ' data-coa-product="' + esc(product) + '" data-coa-strength="' + esc(strength) + '" data-coa-vendor="' + esc(vendor || "") + '"';
    if (result.completed.length) {
      const newerPending = result.pending.some((pending) => dateValue(pending.dateSent) > dateValue(result.completed[0].analysisDate));
      const vendors = new Set(result.completed.map((record) => vendorKey(record.vendor))).size;
      const label = vendor ? "COA · " + prettyDate(result.completed[0].analysisDate) : "COA Available" + (vendors > 1 ? " · " + vendors + " vendors" : "");
      return '<button type="button" class="coa-status coa-complete"' + attrs + ">" + esc(label) + (newerPending ? "<span>Newer test pending</span>" : "") + "</button>";
    }
    return '<button type="button" class="coa-status coa-pending"' + attrs + ">COA Pending</button>";
  };
  function ensureModal() {
    if (document.querySelector("#coa-directory-modal")) return;
    document.body.insertAdjacentHTML("beforeend", '<dialog id="coa-directory-modal" class="coa-modal"><div class="coa-modal-head"><div><p>PUBLIC TESTING RECORDS</p><h2 id="coa-modal-title">Certificate of Analysis</h2></div><button type="button" class="coa-modal-close" aria-label="Close COA details">×</button></div><div id="coa-modal-body"></div><p class="coa-source-note">Testing records are linked from the <a href="https://coa.reta-unfiltered.com/#directory" target="_blank" rel="noopener noreferrer">RU Inner Circle COA Library</a>. Confirm the vendor, product, vial size, date, and verification page.</p></dialog>');
  }
  function open(product, strength, vendor) {
    ensureModal();
    const result = matches(product, strength, vendor);
    const modal = document.querySelector("#coa-directory-modal");
    document.querySelector("#coa-modal-title").textContent = product + " · " + strength;
    const completeCards = result.completed.map((record) => {
      const report = record.reportUrl ? '<a class="coa-report-link" href="' + esc(record.reportUrl) + '" target="_blank" rel="noopener noreferrer">Open Official COA</a>' : '<span class="coa-unavailable">Verification link not listed</span>';
      const preview = record.previewUrl ? '<details class="coa-report-preview"><summary>Preview report</summary><iframe title="COA preview" src="' + esc(record.previewUrl) + '" loading="lazy"></iframe></details>' : "";
      return '<article class="coa-record"><div class="coa-record-heading"><strong>' + esc(record.vendor) + "</strong><span>Completed " + esc(prettyDate(record.analysisDate)) + "</span></div><dl><div><dt>Testing lab</dt><dd>" + esc(record.lab || "Not listed") + "</dd></div><div><dt>Purity</dt><dd>" + esc(record.purity || "Not listed") + "</dd></div><div><dt>Net content</dt><dd>" + esc(record.netContent || "Not listed") + "</dd></div></dl>" + report + preview + "</article>";
    }).join("");
    const pendingCards = result.pending.map((record) => '<article class="coa-record coa-record-pending"><div class="coa-record-heading"><strong>' + esc(record.vendor) + "</strong><span>COA Pending</span></div><dl><div><dt>Expected</dt><dd>" + esc(prettyDate(record.expectedDate)) + "</dd></div></dl></article>").join("");
    document.querySelector("#coa-modal-body").innerHTML = completeCards + pendingCards || '<p class="coa-empty">No matching completed or pending test is listed.</p>';
    modal.showModal();
  }
  function addStyles() {
    const style = document.createElement("style");
    style.textContent = ".coa-status{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;margin:10px 0 0;padding:8px 11px;border-radius:999px;font:800 12px/1.1 system-ui,sans-serif;cursor:pointer}.coa-status span{font-size:10px}.coa-complete{background:#e65300;color:#fff;border:2px solid #ff9a61}.coa-pending{background:#fff7ed;color:#8a3b00;border:2px solid #e65300}.coa-modal{width:min(780px,calc(100% - 28px));max-height:88vh;padding:0;border:3px solid #e65300;border-radius:18px;color:#10233f;background:#fff;box-shadow:0 24px 80px #0007}.coa-modal::backdrop{background:#00142dcc}.coa-modal-head{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;padding:18px 20px;background:#071b35;color:#fff}.coa-modal-head p{margin:0 0 4px;color:#ff8a3d;font-size:11px;font-weight:900;letter-spacing:.14em}.coa-modal-head h2{margin:0;font-size:23px}.coa-modal-close{width:42px;height:42px;border:2px solid #fff;border-radius:50%;background:transparent;color:#fff;font-size:28px;cursor:pointer}#coa-modal-body{display:grid;gap:13px;padding:18px}.coa-record{border:2px solid #203d62;border-radius:13px;padding:15px;background:#f8fbff}.coa-record-pending{border-style:dashed;border-color:#e65300;background:#fff7ed}.coa-record-heading{display:flex;justify-content:space-between;gap:14px}.coa-record-heading strong{font-size:17px}.coa-record-heading span{font-size:12px;font-weight:800;color:#9a4000}.coa-record dl{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:13px 0}.coa-record dl div{padding:9px;background:#fff;border:1px solid #ccd7e5;border-radius:8px}.coa-record dt{font-size:10px;font-weight:900;text-transform:uppercase;color:#617087}.coa-record dd{margin:3px 0 0;font-weight:750}.coa-report-link{display:inline-block;padding:10px 13px;border-radius:8px;background:#e65300;color:#fff!important;font-weight:900;text-decoration:none}.coa-report-preview summary{margin-top:12px;cursor:pointer;font-weight:800}.coa-report-preview iframe{width:100%;height:460px;margin-top:8px;border:1px solid #ccd7e5;border-radius:8px}.coa-source-note{margin:0;padding:0 18px 18px;font-size:12px;color:#5b687b}.coa-source-note a{color:#b84400}.coa-empty{padding:20px;text-align:center}@media(max-width:620px){.coa-record dl{grid-template-columns:1fr}.coa-record-heading{display:block}.coa-record-heading span{display:block;margin-top:4px}.coa-report-preview iframe{height:390px}}";
    document.head.append(style);
  }
  addStyles();
  document.addEventListener("click", (event) => {
    const button = event.target.closest && event.target.closest("[data-coa-product]");
    if (button) { event.preventDefault(); open(button.dataset.coaProduct, button.dataset.coaStrength, button.dataset.coaVendor || ""); return; }
    if (event.target.closest && event.target.closest(".coa-modal-close")) document.querySelector("#coa-directory-modal")?.close();
    if (event.target.id === "coa-directory-modal") event.target.close();
  });
  window.COARegistry = { markup, matches, open, get updatedAt() { return snapshot.updatedAt; } };
  fetch(SOURCE, { cache: "no-store" }).then((response) => { if (!response.ok) throw new Error("COA data " + response.status); return response.json(); }).then((data) => { snapshot = data && typeof data === "object" ? data : snapshot; document.dispatchEvent(new CustomEvent("coa-data-updated")); }).catch((error) => console.warn("COA directory unavailable", error));
})();
