// src/services/pdfGenerator.js
// Production-grade PDF engine — works locally (Mac/Linux) and on Render/Railway
// Root cause of "37,80,68,70,45" bug: Fastify was JSON-serializing the Buffer.
// Fix is in pdf.js route — we use reply.raw.write(buffer) directly.
// This file focuses purely on generating a valid binary PDF Buffer.

"use strict"

const chromium = require("@sparticuz/chromium")

const isProduction =
  process.env.NODE_ENV === "production"

let puppeteer

// ── Constants ─────────────────────────────────────────────────────────────────
const FONT_TIMEOUT_MS = 5000
const LAYOUT_DELAY_MS = 300
const MIN_PDF_BYTES = 5000
const MAX_RETRIES = 2

// ── HTML escape ───────────────────────────────────────────────────────────────
function esc(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

// ── Shared snippets ───────────────────────────────────────────────────────────
function bulletRows(items = []) {
  return items.filter(Boolean).map(b => `
    <div class="bullet-row">
      <span class="bullet-dash">&#8211;</span>
      <span>${esc(b)}</span>
    </div>`
  ).join("")
}

function secHead(title, color = "#2563EB") {
  return `<div class="sec-head" style="color:${color};">${esc(title)}</div>`
}

function sec(title, html, color = "#2563EB") {
  if (!html || !html.trim()) return ""
  return `
    <section style="margin-bottom:18px;">
      ${secHead(title, color)}
      ${html}
    </section>`
}

// ── Base HTML wrapper ─────────────────────────────────────────────────────────
// Rules that MUST never be broken:
//   @page { size: A4; margin: 0 }  — Chromium owns page geometry
//   body width in mm, never px     — DPI-independent
//   NO height on body or containers — content flows freely to next page
//   NO overflow:hidden anywhere    — nothing clips
//   -webkit-print-color-adjust:exact — backgrounds print
function baseHtml(bodyContent, extraCss = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <link rel="preconnect" href="https://fonts.googleapis.com" crossorigin/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap" rel="stylesheet"/>
  <style>
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 400 900;
      src: local('Inter'), local('Helvetica Neue'), local('Arial');
      font-display: swap;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    @page {
      size: A4;
      margin: 0;
    }

    html { width: 210mm; }

    body {
      width: 210mm;
      font-family: Inter, 'Helvetica Neue', Arial, sans-serif;
      font-size: 12px;
      line-height: 1.55;
      color: #111827;
      background: #ffffff;
      -webkit-font-smoothing: antialiased;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    /* ── Universal page-break rules — apply to ALL templates ── */
    section, .entry, .no-break {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .sec-head, h1, h2, h3 {
      break-after: avoid;
      page-break-after: avoid;
    }
    .bullet-row {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    /* ── Shared component styles ── */
    .sec-head {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.10em;
      text-transform: uppercase;
      border-bottom: 1.5px solid #E5E7EB;
      padding-bottom: 4px;
      margin-bottom: 10px;
    }
    .entry { margin-bottom: 12px; }
    .entry:last-child { margin-bottom: 0; }
    .bullet-row {
      display: flex;
      font-size: 12px;
      color: #374151;
      line-height: 1.6;
      margin-bottom: 3px;
    }
    .bullet-dash { width: 14px; flex-shrink: 0; margin-right: 4px; }
    .row-between { display: flex; justify-content: space-between; align-items: baseline; }
    .t-title  { font-size: 13px; font-weight: 600; color: #111827; }
    .t-sub    { font-size: 12px; color: #374151; }
    .t-date   { font-size: 11px; color: #6B7280; white-space: nowrap; margin-left: 10px; flex-shrink: 0; }
    .t-meta   { font-size: 11px; color: #6B7280; }
    .sk { font-weight: 600; color: #111827; }
    .sv { color: #374151; }

    ${extraCss}
  </style>
</head>
<body>${bodyContent}</body>
</html>`
}

// ── TEMPLATE 1: Tech Minimal ──────────────────────────────────────────────────
function buildTechMinimal(d) {
  const p = d.personal || {}
  const sk = d.skills || {}

  const contacts = [p.email, p.phone, p.linkedin, p.location, p.github].filter(Boolean)
  const contactHtml = contacts.map((c, i) =>
    `<span>${esc(c)}</span>${i < contacts.length - 1
      ? `<span style="margin:0 7px;color:#2563EB;font-weight:700;">&#183;</span>` : ""}`
  ).join("")

  const skillsHtml = [
    sk.languages?.length ? `<div class="entry" style="font-size:12px;"><span class="sk">Languages: </span><span class="sv">${esc(sk.languages.join(", "))}</span></div>` : "",
    sk.frameworks?.length ? `<div class="entry" style="font-size:12px;"><span class="sk">Frameworks: </span><span class="sv">${esc(sk.frameworks.join(", "))}</span></div>` : "",
    sk.tools?.length ? `<div class="entry" style="font-size:12px;"><span class="sk">Tools: </span><span class="sv">${esc(sk.tools.join(", "))}</span></div>` : "",
    sk.other?.length ? `<div class="entry" style="font-size:12px;"><span class="sk">Other: </span><span class="sv">${esc(sk.other.join(", "))}</span></div>` : "",
  ].filter(Boolean).join("")

  const expHtml = (d.experience || []).map(exp => `
    <div class="entry">
      <div class="row-between">
        <span class="t-title">${esc(exp.role)}</span>
        <span class="t-date">${esc(exp.startDate)}${exp.startDate ? " &#8211; " : ""}${exp.current ? "Present" : esc(exp.endDate)}</span>
      </div>
      <div class="row-between" style="margin-bottom:5px;">
        <span class="t-sub">${esc(exp.company)}</span>
        <span class="t-meta">${esc(exp.location)}</span>
      </div>
      ${bulletRows(exp.bullets)}
    </div>`
  ).join("")

  const projHtml = (d.projects || []).map(proj => `
    <div class="entry">
      <div class="row-between">
        <span class="t-title">${esc(proj.name)}</span>
        <span class="t-date">${esc(proj.techStack)}</span>
      </div>
      ${proj.description ? `<p style="font-size:12px;color:#6B7280;font-style:italic;margin:2px 0 4px 0;">${esc(proj.description)}</p>` : ""}
      <div style="margin-left:10px;">${bulletRows(proj.bullets)}</div>
    </div>`
  ).join("")

  const eduHtml = (d.education || []).map(edu => `
    <div class="entry">
      <div class="row-between">
        <span class="t-title">${esc(edu.degree)}</span>
        <span class="t-date">${esc(edu.endYear)}</span>
      </div>
      <div class="row-between">
        <span class="t-sub">${esc(edu.institution)}</span>
        ${edu.cgpa ? `<span class="t-meta">CGPA: ${esc(edu.cgpa)}</span>` : ""}
      </div>
    </div>`
  ).join("")

  const achieveHtml = (d.achievements || []).filter(Boolean)
    .map(a => `<div class="bullet-row"><span class="bullet-dash">&#8211;</span><span>${esc(a)}</span></div>`).join("")

  const certHtml = (d.certifications || []).filter(c => c.name)
    .map(c => `<div class="bullet-row"><span class="bullet-dash">&#8211;</span><span>${esc(c.name)}${c.issuer ? ` &#183; ${esc(c.issuer)}` : ""}${c.year ? ` (${esc(c.year)})` : ""}</span></div>`).join("")

  const body = `
    <div style="padding:36px 44px 44px 44px;">
      <div class="no-break" style="text-align:center;padding-bottom:16px;border-bottom:1px solid #E5E7EB;margin-bottom:22px;">
        <div style="font-size:30px;font-weight:700;letter-spacing:-0.02em;color:#111827;line-height:1.15;">
          ${esc((p.name || "YOUR NAME").toUpperCase())}
        </div>
        ${p.role ? `<div style="font-size:13px;color:#6B7280;margin-top:4px;">${esc(p.role)}</div>` : ""}
        <div style="display:flex;justify-content:center;flex-wrap:wrap;margin-top:6px;font-size:11px;color:#6B7280;">
          ${contactHtml}
        </div>
      </div>
      ${sec("Technical Skills", skillsHtml)}
      ${sec("Professional Experience", expHtml)}
      ${sec("Projects", projHtml)}
      ${sec("Education", eduHtml)}
      ${sec("Achievements", achieveHtml)}
      ${sec("Certifications", certHtml)}
    </div>`

  return baseHtml(body)
}

// ── TEMPLATE 2: Tech Two Column ───────────────────────────────────────────────
// Uses CSS floats NOT flex/grid — floats survive print page breaks.
// Sidebar background is extended via a thick left border on the wrapper div.
function buildTechTwoColumn(d) {
  const p = d.personal || {}
  const sk = d.skills || {}
  const SW = "198px" // sidebar width — must match border-left below

  const allSkills = [
    ...(sk.languages || []),
    ...(sk.frameworks || []),
    ...(sk.tools || []),
    ...(sk.other || []),
  ]

  const contactSide = [
    { label: "Phone", value: p.phone },
    { label: "Email", value: p.email },
    { label: "Location", value: p.location },
    { label: "LinkedIn", value: p.linkedin },
    { label: "GitHub", value: p.github },
  ].filter(c => c.value).map(c => `
    <div style="margin-bottom:8px;">
      <div style="font-size:10px;font-weight:600;color:#334155;">${esc(c.label)}</div>
      <div style="font-size:10px;color:#475569;word-break:break-all;">${esc(c.value)}</div>
    </div>`
  ).join("")

  const skillChips = allSkills.map(s =>
    `<span style="display:inline-block;font-size:10px;font-weight:500;color:#334155;background:#E2E8F0;padding:2px 6px;border-radius:3px;margin:2px 2px 2px 0;">${esc(s)}</span>`
  ).join("")

  const eduSide = (d.education || []).map(edu => `
    <div style="margin-bottom:12px;" class="no-break">
      <div style="font-size:10px;font-weight:600;color:#1E293B;">${esc(edu.degree)}</div>
      <div style="font-size:9px;color:#64748B;margin-top:1px;">${esc(edu.institution)}</div>
      <div style="font-size:9px;color:#64748B;font-style:italic;margin-top:1px;">
        ${esc(edu.startYear)}${edu.startYear && edu.endYear ? " &#8212; " : ""}${esc(edu.endYear)}
        ${edu.cgpa ? ` &#183; CGPA: ${esc(edu.cgpa)}` : ""}
      </div>
    </div>`
  ).join("")

  const certSide = (d.certifications || []).filter(c => c.name)
    .map(c => `<div style="font-size:10px;color:#475569;margin-bottom:5px;">&#8211; ${esc(c.name)}</div>`).join("")

  const sideSec = (title, content) => !content || !content.trim() ? "" : `
    <div style="margin-bottom:20px;" class="no-break">
      <div style="font-size:9px;text-transform:uppercase;font-weight:700;color:#1D4ED8;letter-spacing:0.08em;margin-bottom:5px;">${esc(title)}</div>
      <div style="height:1px;background:#CBD5E1;margin-bottom:8px;"></div>
      ${content}
    </div>`

  const projMain = (d.projects || []).map(proj => `
    <div class="entry">
      <div class="row-between">
        <div style="font-size:12px;font-weight:600;color:#0F172A;text-transform:uppercase;">${esc(proj.name)}</div>
        <span class="t-date">${esc(proj.techStack)}</span>
      </div>
      ${proj.description ? `<div style="font-size:11px;color:#6B7280;font-style:italic;margin:2px 0 4px 0;">${esc(proj.description)}</div>` : ""}
      ${bulletRows(proj.bullets)}
    </div>`
  ).join("")

  const expMain = (d.experience || []).map(exp => `
    <div class="entry">
      <div class="row-between">
        <div style="font-size:12px;font-weight:600;color:#0F172A;text-transform:uppercase;">${esc(exp.role)}</div>
        <span style="font-size:9px;color:#64748B;white-space:nowrap;margin-left:8px;flex-shrink:0;">
          ${esc(exp.company)}${exp.company ? " | " : ""}${esc(exp.startDate)}${exp.startDate ? " &#8212; " : ""}${exp.current ? "Present" : esc(exp.endDate)}
        </span>
      </div>
      ${bulletRows(exp.bullets)}
    </div>`
  ).join("")

  const achieveMain = (d.achievements || []).filter(Boolean).map(a => `
    <div style="padding:8px 10px;background:#F8FAFC;border-left:2px solid #2563EB;margin-bottom:8px;" class="no-break">
      <div style="font-size:11px;font-weight:600;color:#0F172A;">${esc(a)}</div>
    </div>`
  ).join("")

  const mainSec = (title, content) => !content || !content.trim() ? "" : `
    <section style="margin-bottom:18px;">
      <div style="font-size:10px;text-transform:uppercase;font-weight:700;color:#1D4ED8;letter-spacing:0.1em;margin-bottom:5px;">${esc(title)}</div>
      <div style="height:1px;background:#0F172A;margin-bottom:12px;"></div>
      ${content}
    </section>`

  const extraCss = `
    .tc-wrap::after { content:""; display:table; clear:both; }
    .tc-sidebar { float:left; width:${SW}; padding:28px 18px 28px 20px; }
    .tc-main    { margin-left:${SW}; padding:28px 28px 28px 22px; border-left:1px solid #CBD5E1; }
  `

  // Thick left border on wrapper = sidebar background colour across ALL pages
  const wrapStyle = `border-left:${SW} solid #F1F5F9;margin-left:-${SW};padding-left:${SW};`

  const body = `
    <div class="no-break" style="background:#0F172A;padding:22px 48px;text-align:center;">
      <div style="font-size:26px;font-weight:700;color:#fff;line-height:1.15;letter-spacing:-0.01em;">
        ${esc((p.name || "YOUR NAME").toUpperCase())}
      </div>
      ${p.role ? `<div style="text-transform:uppercase;letter-spacing:0.10em;font-size:12px;font-weight:700;color:#60A5FA;margin-top:6px;">${esc(p.role)}</div>` : ""}
      <div style="font-size:11px;color:#CBD5E1;margin-top:5px;">
        ${[p.email, p.phone, p.linkedin, p.github].filter(Boolean).map(esc).join("  &#183;  ")}
      </div>
    </div>

    <div class="tc-wrap" style="${wrapStyle}">
      <div class="tc-sidebar">
        ${sideSec("Contact", contactSide)}
        ${allSkills.length ? sideSec("Skills", `<div style="display:flex;flex-wrap:wrap;">${skillChips}</div>`) : ""}
        ${sideSec("Education", eduSide)}
        ${sideSec("Certifications", certSide)}
      </div>
      <div class="tc-main">
        ${mainSec("Projects", projMain)}
        ${mainSec("Experience", expMain)}
        ${achieveMain ? mainSec("Achievements", achieveMain) : ""}
      </div>
    </div>`

  return baseHtml(body, extraCss)
}

// ── TEMPLATE 3: Tech Bold Header ──────────────────────────────────────────────
function buildTechBoldHeader(d) {
  const p = d.personal || {}
  const sk = d.skills || {}

  const contactLine = [p.location, p.email, p.phone, p.linkedin, p.github]
    .filter(Boolean).join("  |  ")

  const skillsHtml = [
    sk.languages?.length ? `<div class="entry" style="font-size:13px;color:#374151;line-height:1.6;"><strong style="color:#111827;">Languages:</strong> ${esc(sk.languages.join(", "))}</div>` : "",
    sk.frameworks?.length ? `<div class="entry" style="font-size:13px;color:#374151;line-height:1.6;"><strong style="color:#111827;">Frameworks &amp; Libraries:</strong> ${esc(sk.frameworks.join(", "))}</div>` : "",
    sk.tools?.length ? `<div class="entry" style="font-size:13px;color:#374151;line-height:1.6;"><strong style="color:#111827;">Tools:</strong> ${esc(sk.tools.join(", "))}</div>` : "",
    sk.other?.length ? `<div class="entry" style="font-size:13px;color:#374151;line-height:1.6;"><strong style="color:#111827;">Other:</strong> ${esc(sk.other.join(", "))}</div>` : "",
  ].filter(Boolean).join("")

  const expHtml = (d.experience || []).map(exp => `
    <div class="entry">
      <div class="row-between">
        <div style="font-size:14px;font-weight:700;color:#111827;">
          ${esc(exp.role)}${exp.company ? ` / ${esc(exp.company)}` : ""}
        </div>
        <span class="t-date">${esc(exp.startDate)}${exp.startDate ? " &#8211; " : ""}${exp.current ? "Present" : esc(exp.endDate)}</span>
      </div>
      <div style="margin-top:4px;">${bulletRows(exp.bullets)}</div>
    </div>`
  ).join("")

  const projHtml = (d.projects || []).map(proj => `
    <div class="entry">
      <div class="row-between">
        <div style="font-size:14px;font-weight:700;color:#111827;">${esc(proj.name)}</div>
        ${proj.techStack ? `<span class="t-date">${esc(proj.techStack)}</span>` : ""}
      </div>
      ${proj.description ? `<p style="font-size:13px;color:#374151;margin:2px 0 4px 0;line-height:1.6;">${esc(proj.description)}</p>` : ""}
      ${bulletRows(proj.bullets)}
    </div>`
  ).join("")

  const eduHtml = (d.education || []).map(edu => `
    <div class="entry">
      <div class="row-between">
        <div style="font-size:14px;font-weight:700;color:#111827;">${esc(edu.degree)}</div>
        <span class="t-date">${esc(edu.endYear)}</span>
      </div>
      <div style="font-size:13px;color:#374151;">
        ${esc(edu.institution)}${edu.cgpa ? ` &#8212; CGPA: ${esc(edu.cgpa)}` : ""}
      </div>
    </div>`
  ).join("")

  const achieveHtml = (d.achievements || []).filter(Boolean)
    .map(a => `<div class="bullet-row"><span class="bullet-dash">&#8211;</span><span>${esc(a)}</span></div>`).join("")

  const certHtml = (d.certifications || []).filter(c => c.name)
    .map(c => `<div class="bullet-row"><span class="bullet-dash">&#8211;</span><span>${esc(c.name)}${c.issuer ? ` &#183; ${esc(c.issuer)}` : ""}${c.year ? ` (${esc(c.year)})` : ""}</span></div>`).join("")

  const body = `
    <div class="no-break" style="background:#1E3A5F;padding:26px 40px;text-align:center;">
      <div style="font-size:30px;font-weight:900;color:#fff;letter-spacing:-0.02em;text-transform:uppercase;line-height:1.15;">
        ${esc(p.name || "YOUR NAME")}
      </div>
      ${p.role ? `<div style="font-size:12px;font-weight:600;color:#93C5FD;letter-spacing:0.06em;text-transform:uppercase;margin-top:5px;">${esc(p.role)}</div>` : ""}
      <div style="color:rgba(255,255,255,0.80);margin-top:7px;font-size:11px;letter-spacing:0.04em;">
        ${esc(contactLine)}
      </div>
    </div>
    <div style="padding:28px 40px 40px 40px;">
      ${sec("Technical Skills", skillsHtml)}
      ${sec("Professional Experience", expHtml)}
      ${sec("Projects", projHtml)}
      ${sec("Education", eduHtml)}
      ${sec("Achievements", achieveHtml)}
      ${sec("Certifications", certHtml)}
    </div>`

  return baseHtml(body)
}

// ── Template router ───────────────────────────────────────────────────────────
function getTemplateHTML(templateId, data) {
  switch (templateId) {
    case "tech-minimal": return buildTechMinimal(data)
    case "tech-two-column": return buildTechTwoColumn(data)
    case "tech-bold-header": return buildTechBoldHeader(data)
    default: throw new Error(`Unknown template: "${templateId}"`)
  }
}

// ── PDF render — single attempt ───────────────────────────────────────────────
async function renderOnce(html) {

  // =====================================================
  // PRODUCTION (RENDER)
  // =====================================================

  if (isProduction) {

    puppeteer = require("puppeteer-core")

    const browser = await puppeteer.launch({

      args: chromium.args,

      defaultViewport: chromium.defaultViewport,

      executablePath:
        await chromium.executablePath(),

      headless: true,

      ignoreHTTPSErrors: true,
    })

    try {

      const page = await browser.newPage()

      await page.setViewport({
        width: 794,
        height: 1123,
        deviceScaleFactor: 1,
      })

      await page.setContent(html, {
        waitUntil: "networkidle0",
        timeout: 30000,
      })

      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      })

      return Buffer.from(pdf)

    } finally {

      await browser.close()
    }
  }

  // =====================================================
  // LOCAL DEVELOPMENT
  // =====================================================

  // =====================================================
  // LOCAL DEVELOPMENT
  // =====================================================

  puppeteer = require("puppeteer")

  const browser = await puppeteer.launch({

    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",

    headless: true,

    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  })

  try {

    const page = await browser.newPage()

    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 1,
    })

    await page.setContent(html, {
      waitUntil: "networkidle0",
      timeout: 30000,
    })

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    })

    return Buffer.from(pdf)

  } finally {

    await browser.close()
  }
}
// ── Validate output ───────────────────────────────────────────────────────────
function validate(buf, attempt) {
  if (!buf || buf.length < MIN_PDF_BYTES) {
    throw new Error(`Attempt ${attempt}: buffer too small (${buf?.length ?? 0} bytes)`)
  }
  // Check PDF magic bytes — must be %PDF-
  const magic = buf.slice(0, 5).toString("binary")
  if (!magic.startsWith("%PDF")) {
    throw new Error(
      `Attempt ${attempt}: bad PDF header. Got bytes: ${Array.from(buf.slice(0, 5)).join(",")}. ` +
      `Buffer may have been JSON-serialized — check route handler.`
    )
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
async function generatePDF(templateId, data) {
  const html = getTemplateHTML(templateId, data)
  let lastErr = null

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      console.log(`[PDF] attempt=${attempt} template="${templateId}"`)
      const buf = await renderOnce(html)
      validate(buf, attempt)
      console.log(`[PDF] ok — ${buf.length.toLocaleString()} bytes`)
      return buf  // always a proper Buffer
    } catch (err) {
      lastErr = err
      console.error(`[PDF] attempt=${attempt} FAILED: ${err.message}`)
      if (attempt <= MAX_RETRIES) {
        await new Promise(r => setTimeout(r, attempt * 500))
      }
    }
  }

  throw new Error(
    `PDF generation failed after ${MAX_RETRIES + 1} attempts. Last: ${lastErr?.message}`
  )
}

module.exports = { generatePDF }