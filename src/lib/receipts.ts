// Receipt upload, SVG generation and export (no third-party dependencies).
// Transaction ledger receipts are uploaded scans; payment/contribution
// receipts are generated as SVG.

import { getSupabase } from "./supabase";

export type ReceiptFormat = "svg" | "png" | "jpg";

const MAX_UPLOADED_RECEIPT_BYTES = 10 * 1024 * 1024;

/** Uploads a scanned receipt (PDF/image) to the receipts bucket; returns its public URL. */
export async function uploadReceiptFile(file: File): Promise<string> {
  if (
    file.type !== "application/pdf" &&
    !file.type.toLowerCase().startsWith("image/")
  ) {
    throw new Error("Receipt must be a PDF or an image file.");
  }
  if (file.size > MAX_UPLOADED_RECEIPT_BYTES) {
    throw new Error("Receipt files must be 10 MB or smaller.");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return uploadToBucket(`manual/${crypto.randomUUID()}-${safeName || "receipt"}`, file, file.type);
}

async function uploadToBucket(path: string, body: Blob, contentType: string): Promise<string> {
  const bucket = getSupabase().storage.from("receipts");
  const { error } = await bucket.upload(path, body, { upsert: false, contentType });
  if (error) throw new Error(error.message);
  return bucket.getPublicUrl(path).data.publicUrl;
}

/** Base64 data URIs for the two official logos embedded in every receipt. */
interface ReceiptLogoData {
  lsc: string;
  dssc: string;
}

let logoCache: ReceiptLogoData | null = null;

/** Fetches a public image, fits it within `maxDim` px and returns a PNG data URI. */
async function imageToDataUri(path: string, maxDim: number): Promise<string> {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`Failed to fetch logo ${path}: ${resp.status}`);
  const blob = await resp.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Failed to decode logo: ${path}`));
      img.src = objectUrl;
    });
    const scale = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight, 1);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    ctx.drawImage(img, 0, 0, w, h);
    return new Promise<string>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (!b) {
          reject(new Error(`Failed to encode logo: ${path}`));
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error(`Failed to read encoded logo: ${path}`));
        reader.readAsDataURL(b);
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Cached logo data URIs (≤100px keeps the SVG receipts light). */
async function getReceiptLogos(): Promise<ReceiptLogoData> {
  if (logoCache) return logoCache;
  const [lsc, dssc] = await Promise.all([
    imageToDataUri("/lsc-logo.jpg", 100),
    imageToDataUri("/DSSC-logo.png", 100),
  ]);
  logoCache = { lsc, dssc };
  return logoCache;
}

/** Logo markup; `xlink:href` keeps the images visible in older SVG viewers. */
function receiptLogoMarkup(logos: ReceiptLogoData): string {
  return [
    `<image href="${logos.lsc}" xlink:href="${logos.lsc}" x="10" y="10" width="70" height="70" preserveAspectRatio="xMidYMid meet"/>`,
    `<image href="${logos.dssc}" xlink:href="${logos.dssc}" x="520" y="10" width="70" height="70" preserveAspectRatio="xMidYMid meet"/>`,
  ].join("\n  ");
}

export interface ReceiptDetails {
  /** Small caption shown under the big title, e.g. "PAYMENT" / "EXPENSE". */
  tag?: string;
  /** Official Receipt number, e.g. "OR-2026-000001". */
  receiptNumber: string;
  /** Who the receipt is for (student name or supplier). */
  issuedTo: string;
  eventName?: string;
  description?: string;
  amount: number;
  type: "income" | "expense";
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Officer that issued the receipt. */
  recordedBy: string;
  fiscalYear?: string;
  /** Contribution-record receipts only: required contribution amount. */
  requiredAmount?: number;
  /** Contribution-record receipts only: outstanding balance (required - paid). */
  remainingBalance?: number;
  /** Contribution-record receipts only: status label (Unpaid / Partial / Fully Paid). */
  statusLabel?: string;
}

const xml = (s: string): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const formatAmount = (n: number): string =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatDateHuman = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function threeDigits(n: number): string {
  const words: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) words.push(`${ONES[hundreds]} Hundred`);
  if (rest > 0) {
    if (rest < 20) words.push(ONES[rest]);
    else words.push(`${TENS[Math.floor(rest / 10)]}${rest % 10 ? "-" + ONES[rest % 10] : ""}`);
  }
  return words.join(" ");
}

function amountInWords(amount: number): string {
  if (!Number.isFinite(amount)) return "";
  const whole = Math.floor(Math.abs(amount));
  const cents = Math.round((Math.abs(amount) - whole) * 100);
  const scales = ["", " Thousand", " Million", " Billion", " Trillion"];
  let n = whole;
  const chunks: string[] = [];
  let scale = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk > 0) chunks.unshift(`${threeDigits(chunk)}${scale === 0 ? "" : scales[scale]}`);
    n = Math.floor(n / 1000);
    scale += 1;
  }
  const wholeText = chunks.length ? chunks.join(", ") : "Zero";
  const centsText = cents > 0 ? ` and ${String(cents).padStart(2, "0")}/100` : "";
  return `${wholeText} Pesos${centsText} only`;
}

function buildReceiptSvg(details: ReceiptDetails, logos?: ReceiptLogoData): string {
  const typeColor = details.type === "income" ? "#0f766e" : "#b91c1c";
  const typeLabel = details.type === "income" ? "COLLECTION" : "EXPENSE";
  const tag = details.tag ? xml(details.tag) : typeLabel;

  const isContribution = details.requiredAmount !== undefined;
  const rows = [
    ["RECEIVED FROM / PAID TO", xml(details.issuedTo) || "—"],
    ["EVENT / PURPOSE", xml(details.eventName || details.description || "—")],
    ...(details.description && details.eventName
      ? [["DETAILS", xml(details.description)] as const]
      : []),
    ...(isContribution
      ? [
          ["REQUIRED AMOUNT", `₱${formatAmount(details.requiredAmount ?? 0)}`],
          ["AMOUNT PAID", `₱${formatAmount(details.amount)}`],
          ["REMAINING BALANCE", `₱${formatAmount(details.remainingBalance ?? 0)}`],
          ["STATUS", xml(details.statusLabel || "—")],
        ]
      : []),
  ];

  // Layout grows with the row count so the total and footer stay inside the box.
  const ROWS_START = 352;              // y of the first detail label
  const ROW_PITCH = 64;                // vertical space per label/value pair
  const lineY = ROWS_START + rows.length * ROW_PITCH - 12; // separator above TOTAL
  const boxBottom = lineY + 148;       // bottom edge of the details box
  const footerLine = boxBottom + 26;   // divider under the box
  const thankYouTop = footerLine + 70; // green thank-you band
  const height = thankYouTop + 92;     // page height
  const boxHeight = boxBottom - 272 + 18;
  const words = xml(amountInWords(details.amount));
  const wordsShort = words.length > 86 ? words.slice(0, 83) + "..." : words;

  const rowsSvg = rows
    .map(([label, value], index) => {
      const ry = ROWS_START + index * ROW_PITCH;
      return `<text x="60" y="${ry}" font-family="Arial, Helvetica, sans-serif" font-size="12" letter-spacing="1" fill="#6b7280">${label}</text>\n    <text x="60" y="${ry + 26}" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="bold" fill="#111827">${value}</text>`;
    })
    .join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="600" height="${height}" viewBox="0 0 600 ${height}">
  <rect width="600" height="${height}" fill="#ffffff"/>
  <!-- header band -->
  <rect width="600" height="96" fill="${typeColor}"/>
  <text x="300" y="46" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="bold" fill="#ffffff" text-anchor="middle" letter-spacing="2">OFFICIAL RECEIPT</text>
  <text x="300" y="76" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#ffe4ea" text-anchor="middle" letter-spacing="1">LOCAL STUDENT COUNCIL — DIGITAL TRANSPARENCY</text>
  ${logos ? receiptLogoMarkup(logos) : ""}
  <!-- org block -->
  <text x="40" y="132" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#1f2937">Local Student Council — Digital Transparency Board</text>
  <text x="40" y="156" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#6b7280">${xml(details.fiscalYear || dynamicSchoolYear())}</text>
  <line x1="40" y1="176" x2="560" y2="176" stroke="#e5e7eb" stroke-width="2"/>
  <!-- meta -->
  <text x="40" y="212" font-family="monospace" font-size="13" fill="#374151">${xml(details.receiptNumber)}</text>
  <text x="40" y="236" font-family="monospace" font-size="13" fill="#374151">Date: ${xml(formatDateHuman(details.date))}</text>
  <text x="40" y="262" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="bold" fill="${typeColor}" letter-spacing="2">${tag}</text>
  <!-- details box -->
  <rect x="40" y="272" width="520" height="${boxHeight}" rx="8" fill="#f8fafc" stroke="#e2e8f0"/>
${rowsSvg}
  <line x1="60" y1="${lineY}" x2="540" y2="${lineY}" stroke="#e5e7eb" stroke-width="1"/>
  <text x="60" y="${lineY + 40}" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#374151">${isContribution ? "AMOUNT PAID" : "TOTAL AMOUNT"}</text>
  <text x="540" y="${lineY + 46}" font-family="monospace" font-size="26" font-weight="bold" fill="${typeColor}" text-anchor="end">PHP ${xml(formatAmount(details.amount))}</text>
  <text x="60" y="${lineY + 88}" font-family="monospace" font-size="11" fill="#6b7280">${wordsShort}</text>
  <text x="60" y="${lineY + 114}" font-family="monospace" font-size="11" fill="#9ca3af">PREPARED BY: ${xml(details.recordedBy || "Council Officer")}</text>
  <!-- footer -->
  <line x1="40" y1="${footerLine}" x2="560" y2="${footerLine}" stroke="#e5e7eb" stroke-width="2"/>
  <text x="40" y="${footerLine + 36}" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="#6b7280">Authorized signature: ________________________</text>
  <text x="40" y="${footerLine + 56}" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="#6b7280">Recorded by: ${xml(details.recordedBy || "Council Officer")}</text>
  <rect x="40" y="${thankYouTop}" width="520" height="56" rx="6" fill="${typeColor}"/>
  <text x="300" y="${thankYouTop + 35}" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="bold" fill="#ffffff" text-anchor="middle" letter-spacing="3">THANK YOU FOR YOUR SUPPORT!</text>
</svg>`;
}

/** Renders an SVG string onto a canvas (white background, 2x for crispness). */
async function svgToCanvas(svg: string, scale = 2): Promise<HTMLCanvasElement> {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Unable to render the receipt image."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth * scale;
    canvas.height = image.naturalHeight * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not supported in this browser.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Rasterizes an SVG receipt to PNG or JPG. */
async function svgToImageBlob(svg: string, format: "png" | "jpg"): Promise<Blob> {
  const canvas = await svgToCanvas(svg);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`${format.toUpperCase()} export failed.`))),
      format === "png" ? "image/png" : "image/jpeg",
      0.92,
    );
  });
}

/** Triggers a browser download for a blob. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export const isSvgUrl = (url: string): boolean => {
  const normalizedUrl = url.split("?")[0].toLowerCase();
  return normalizedUrl.endsWith(".svg") || normalizedUrl.startsWith("data:image/svg+xml");
};

/** Adds the logos to old SVG receipts generated before logos were embedded. */
async function ensureReceiptLogos(svg: string): Promise<string> {
  if (/<image\b/i.test(svg)) return svg;

  const logos = await getReceiptLogos();
  const logoMarkup = receiptLogoMarkup(logos);

  return svg.replace(/(<rect[^>]*width=["']600["'][^>]*height=["']96["'][^>]*\/?>)/i, `$1\n  ${logoMarkup}`);
}

/** Offline-only fallback for the OR sequence (the RPC is authoritative). */
let orFallbackSequence = 0;

/** e.g. "School Year 2026 – 2027"; used when no fiscal year is supplied. */
function dynamicSchoolYear(): string {
  const year = new Date().getFullYear();
  return `School Year ${year} – ${year + 1}`;
}

/**
 * Next Official Receipt number (OR-YYYY-NNNNNN), allocated atomically by the
 * `get_next_or_number()` RPC; falls back to a local counter when offline.
 */
export async function officialReceiptNumber(): Promise<string> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("get_next_or_number");
    if (!error && typeof data === "string" && data.length > 0) {
      return data;
    }
    if (error) {
      console.warn("get_next_or_number RPC failed:", error.message);
    }
  } catch (err) {
    console.warn("get_next_or_number RPC error:", err);
  }
  orFallbackSequence += 1;
  return `OR-${new Date().getFullYear()}-${String(orFallbackSequence).padStart(6, "0")}`;
}

/** Generates an SVG receipt, uploads it to the "receipts" bucket and returns its public URL. */
export async function autoCreateReceipt(details: ReceiptDetails): Promise<string> {
  const svg = buildReceiptSvg(details, await getReceiptLogos());
  return uploadToBucket(`auto/${crypto.randomUUID()}.svg`, new Blob([svg], { type: "image/svg+xml" }), "image/svg+xml");
}

/** Downloads a receipt URL; SVG receipts can be converted to PNG/JPG, other files download as-is. */
export async function downloadReceipt(url: string, format: ReceiptFormat): Promise<string> {
  const fileName = url.split("/").pop()?.split("?")[0] || "receipt";
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  if (!isSvgUrl(url)) {
    downloadBlob(await response.blob(), `${baseName}.${url.split(".").pop()?.split("?")[0] || "png"}`);
    return "Receipt downloaded";
  }
  const svg = await ensureReceiptLogos(await response.text());
  if (format === "svg") {
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${baseName}.svg`);
    return "Receipt downloaded";
  }
  downloadBlob(await svgToImageBlob(svg, format), `${baseName}.${format}`);
  return `Receipt downloaded as ${format.toUpperCase()}`;
}

/** Builds a contribution receipt locally (no upload); only for records with a payment. */
async function buildContributionReceipt(details: ReceiptDetails): Promise<string> {
  if (details.amount <= 0) {
    throw new Error("Receipt is only available when the paid amount is greater than zero.");
  }
  return buildReceiptSvg(details, await getReceiptLogos());
}

/** Downloads a contribution-record receipt (works offline). Returns a toast message. */
export async function downloadContributionReceipt(
  details: ReceiptDetails,
  format: ReceiptFormat = "svg",
): Promise<string> {
  const svg = await buildContributionReceipt(details);
  const blob = format === "svg" ? new Blob([svg], { type: "image/svg+xml" }) : await svgToImageBlob(svg, format);
  downloadBlob(blob, `contribution-receipt-${details.receiptNumber}.${format}`);
  return `Contribution receipt downloaded (${format.toUpperCase()})`;
}

/** In-memory data URL for previewing a contribution-record receipt. */
export async function createContributionReceiptPreview(details: ReceiptDetails): Promise<string> {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await buildContributionReceipt(details))}`;
}