// src/services/pdfGenerator.js
//
// ── Architecture notes ────────────────────────────────────────────────────────
//
//  SCREEN vs PRINT coordinate systems
//  ───────────────────────────────────
//  Screen layout: pixels, fixed dimensions, overflow:hidden → clips content
//  Print layout:  mm / %, no fixed heights, content flows to next page freely
//
//  The previous version mixed both.  This file is 100% print-first:
//
//  · @page { size: A4; margin: 0 }  → Chromium owns page geometry
//  · body { width: 210mm }          → NOT 794px — DPI-independent
//  · NO height constraints anywhere → content flows freely across pages
//  · NO overflow:hidden anywhere    → nothing clips
//  · Puppeteer margin: all "0mm"    → zero unintentional white borders
//  · preferCSSPageSize: true        → honours @page { size: A4 }
//
//  TWO-COLUMN print problem & solution
//  ─────────────────────────────────────
//  CSS flex/grid containers create a Block Formatting Context (BFC) that
//  does NOT span page boundaries.  The result: the sidebar height resets
//  to zero on page 2, the background colour disappears, and columns collapse.
//
//  Fix (W3C-standard, used by WeasyPrint / wkhtmltopdf templates):
//  · Float the sidebar and main column — CSS floats DO survive page breaks.
//  · Extend the sidebar background via a thick left border on the wrapper div
//    (same width as the sidebar).  This fills the full-height background on
//    every page regardless of content length.
//  · Main column uses margin-left = sidebar width to sit beside the float.
//
// ─────────────────────────────────────────────────────────────────────────────

"use strict"

const puppeteer = require("puppeteer-core")
const chromium = require("@sparticuz/chromium")

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_PDF_BYTES = 8_000    // anything smaller is corrupt / empty
const LAYOUT_DELAY_MS = 400      // wait after fonts resolve for reflow to settle
const FONT_TIMEOUT_MS = 6_000    // max wait for Google Fonts before swap fallback
const PDF_TIMEOUT_MS = 45_000   // combined budget for setContent + pdf()
const MAX_RETRIES = 2        // retry count on transient Chromium failure

// ── HTML escape ───────────────────────────────────────────────────────────────

function esc(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

// ── Shared HTML snippets ──────────────────────────────────────────────────────

function bulletRows(items = []) {
  return items.filter(Boolean).map(b => `
        <div class="bullet-row">
            <span class="bullet-dash">&#8211;</span>
            <span>${esc(b)}</span>
        </div>`
  ).join("")
}

function sectionHead(title, color = "#2563EB") {
  return `
        <div class="sec-head" style="color:${color};">
            ${esc(title)}
        </div>`
}

// ── baseHtml() ────────────────────────────────────────────────────────────────
//
//  Every template calls this wrapper.  Rules that must never change:
//  · @page { size: A4; margin: 0 }  — Chromium page geometry, no CSS margin boxes
//  · body width in mm, never px
//  · NO height on body or any layout container
//  · -webkit-print-color-adjust: exact  so coloured backgrounds print

function baseHtml(body, extraCss = "") {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>

    <link rel="preconnect" href="https://fonts.googleapis.com" crossorigin/>
    <link rel="preconnect" href="https://fonts.gstatic.com"    crossorigin/>
    <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap"
        rel="stylesheet"
    />

    <style>
        /* Offline / firewall fallback — layout never hangs without network */
        @font-face {
            font-family: 'Inter';
            font-style:  normal;
            font-weight: 400 900;
            src:         local('Inter'), local('Helvetica Neue'), local('Arial');
            font-display: swap;
        }

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /*
         * @page
         * ─────
         * size: A4             → Chromium renders at exact A4 dimensions
         * margin: 0            → ALL whitespace comes from HTML padding,
         *                        giving us full-bleed headers and zero borders.
         *
         * DO NOT add @bottom-right / @top-left margin boxes here.
         * Chromium has never implemented CSS margin boxes — they silently
         * corrupt the @page rule and can produce damaged PDFs.
         * Use Puppeteer's footerTemplate for page numbers instead.
         */
        @page {
            size:   A4;
            margin: 0;
        }

        html { width: 210mm; }  /* A4 width — DPI-independent, never 794px */

        body {
            width:                          210mm;
            /* NO height — content length determines page count */
            font-family:                    Inter, 'Helvetica Neue', Arial, sans-serif;
            font-size:                      12px;
            line-height:                    1.55;
            color:                          #111827;
            background:                     #ffffff;
            -webkit-font-smoothing:         antialiased;
            -webkit-print-color-adjust:     exact;   /* print backgrounds */
            print-color-adjust:             exact;
        }

        /*
         * Global print pagination rules
         * ─────────────────────────────
         * Prevents individual entries from being split mid-content across pages.
         * Apply break-inside:avoid to every discrete block (entry, section).
         */
        section, .entry, .no-break {
            break-inside:      avoid;
            page-break-inside: avoid;
        }
        h1, h2, h3, .sec-head {
            break-after:       avoid;
            page-break-after:  avoid;
        }
        .bullet-row {
            break-inside:      avoid;
            page-break-inside: avoid;
        }

        /* Shared typography */
        .sec-head {
            font-size:      10px;
            font-weight:    700;
            letter-spacing: 0.10em;
            text-transform: uppercase;
            border-bottom:  1.5px solid #E5E7EB;
            padding-bottom: 4px;
            margin-bottom:  10px;
        }
        .entry         { margin-bottom: 12px; }
        .entry:last-child { margin-bottom: 0; }
        .bullet-row    { display: flex; font-size: 12px; color: #374151; line-height: 1.6; margin-bottom: 3px; }
        .bullet-dash   { width: 14px; flex-shrink: 0; margin-right: 4px; }
        .row-between   { display: flex; justify-content: space-between; align-items: baseline; }
        .t-title  { font-size: 13px; font-weight: 600; color: #111827; }
        .t-sub    { font-size: 12px; color: #374151; }
        .t-date   { font-size: 11px; color: #6B7280; white-space: nowrap; margin-left: 10px; flex-shrink: 0; }
        .t-meta   { font-size: 11px; color: #6B7280; }
        .t-skill-k{ font-weight: 600; color: #111827; }
        .t-skill-v{ color: #374151; }

        ${extraCss}
    </style>
</head>
<body>${body}</body>
</html>`
}

// ── Template 1 — Tech Minimal ─────────────────────────────────────────────────
// Single-column, centred header, ATS-friendly, clean pagination.

function buildTechMinimal(d) {
  const p = d.personal || {}
  const sk = d.skills || {}

  const contacts = [p.email, p.phone, p.linkedin, p.location, p.github].filter(Boolean)
  const contactHtml = contacts.map((c, i) =>
    `<span>${esc(c)}</span>${i < contacts.length - 1 ? `<span style="margin:0 7px;color:#2563EB;font-weight:700;">&#183;</span>` : ""}`
  ).join("")

  const skillsHtml = [
    sk.languages?.length ? `<div class="entry" style="font-size:12px;"><span class="t-skill-k">Languages: </span><span class="t-skill-v">${esc(sk.languages.join(", "))}</span></div>` : "",
    sk.frameworks?.length ? `<div class="entry" style="font-size:12px;"><span class="t-skill-k">Frameworks: </span><span class="t-skill-v">${esc(sk.frameworks.join(", "))}</span></div>` : "",
    sk.tools?.length ? `<div class="entry" style="font-size:12px;"><span class="t-skill-k">Tools: </span><span class="t-skill-v">${esc(sk.tools.join(", "))}</span></div>` : "",
    sk.other?.length ? `<div class="entry" style="font-size:12px;"><span class="t-skill-k">Other: </span><span class="t-skill-v">${esc(sk.other.join(", "))}</span></div>` : "",
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

  const sec = (title, html) => html.trim() ? `
        <section style="margin-bottom:18px;">
            ${sectionHead(title)}
            ${html}
        </section>` : ""

  const body = `
        <div style="padding:36px 44px 44px 44px;">
            <div style="text-align:center;padding-bottom:16px;border-bottom:1px solid #E5E7EB;margin-bottom:22px;" class="no-break">
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

// ── Template 2 — Tech Two Column ──────────────────────────────────────────────
//
//  WHY FLOATS (not flex/grid):
//  ───────────────────────────
//  Flex and grid containers establish a BFC that does NOT cross page boundaries.
//  On page 2+, the flex/grid container height resets: sidebar background
//  disappears, columns collapse.
//
//  CSS floats are the only layout mechanism guaranteed to survive page breaks
//  in Chromium's print engine (also used by WeasyPrint, wkhtmltopdf).
//
//  SIDEBAR BACKGROUND ACROSS ALL PAGES:
//  ─────────────────────────────────────
//  A float does not extend its parent's height, so setting background on a
//  floated sidebar only fills the first page.  We work around this by setting
//  a thick left border on the clearfix wrapper — same colour as the sidebar,
//  same width as the sidebar — so the background colour fills every page.

function buildTechTwoColumn(d) {
  const p = d.personal || {}
  const sk = d.skills || {}

  // Sidebar width — must match the border-left width in wrapStyle below
  const SW = "198px"

  const allSkills = [...(sk.languages || []), ...(sk.frameworks || []), ...(sk.tools || []), ...(sk.other || [])]

  // ── Sidebar content ──
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
        </div>`).join("")

  const skillsSide = allSkills.map(s =>
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
        </div>`).join("")

  const certSide = (d.certifications || []).filter(c => c.name)
    .map(c => `<div style="font-size:10px;color:#475569;margin-bottom:5px;">&#8211; ${esc(c.name)}</div>`).join("")

  const sideSec = (title, content) => !content.trim() ? "" : `
        <div style="margin-bottom:20px;" class="no-break">
            <div style="font-size:9px;text-transform:uppercase;font-weight:700;color:#1D4ED8;letter-spacing:0.08em;margin-bottom:5px;">${esc(title)}</div>
            <div style="height:1px;background:#CBD5E1;margin-bottom:8px;"></div>
            ${content}
        </div>`

  // ── Main column content ──
  const projMain = (d.projects || []).map(proj => `
        <div class="entry">
            <div class="row-between">
                <div style="font-size:12px;font-weight:600;color:#0F172A;text-transform:uppercase;">${esc(proj.name)}</div>
                <span class="t-date">${esc(proj.techStack)}</span>
            </div>
            ${proj.description ? `<div style="font-size:11px;color:#6B7280;font-style:italic;margin:2px 0 4px 0;">${esc(proj.description)}</div>` : ""}
            ${bulletRows(proj.bullets)}
        </div>`).join("")

  const expMain = (d.experience || []).map(exp => `
        <div class="entry">
            <div class="row-between">
                <div style="font-size:12px;font-weight:600;color:#0F172A;text-transform:uppercase;">${esc(exp.role)}</div>
                <span style="font-size:9px;color:#64748B;white-space:nowrap;margin-left:8px;flex-shrink:0;">
                    ${esc(exp.company)}${exp.company ? " | " : ""}${esc(exp.startDate)}${exp.startDate ? " &#8212; " : ""}${exp.current ? "Present" : esc(exp.endDate)}
                </span>
            </div>
            ${bulletRows(exp.bullets)}
        </div>`).join("")

  const achieveMain = (d.achievements || []).filter(Boolean).map(a => `
        <div style="padding:8px 10px;background:#F8FAFC;border-left:2px solid #2563EB;margin-bottom:8px;" class="no-break">
            <div style="font-size:11px;font-weight:600;color:#0F172A;">${esc(a)}</div>
        </div>`).join("")

  const mainSec = (title, content) => !content.trim() ? "" : `
        <section style="margin-bottom:18px;">
            <div style="font-size:10px;text-transform:uppercase;font-weight:700;color:#1D4ED8;letter-spacing:0.1em;margin-bottom:5px;">${esc(title)}</div>
            <div style="height:1px;background:#0F172A;margin-bottom:12px;"></div>
            ${content}
        </section>`

  // Float-based layout CSS
  const extraCss = `
        /* Clearfix — floats don't expand parent height, so we clear manually */
        .tc-wrap::after { content:""; display:table; clear:both; }

        .tc-sidebar {
            float:   left;
            width:   ${SW};
            padding: 28px 18px 28px 20px;
        }
        .tc-main {
            /* margin-left pushes content past the floated sidebar */
            margin-left: ${SW};
            padding:     28px 28px 28px 22px;
            border-left: 1px solid #CBD5E1;
        }
    `

  // The sidebar background fills all pages via a left border on the wrapper.
  // border-left width MUST equal SW exactly.
  const wrapStyle = [
    `border-left: ${SW} solid #F1F5F9`,
    `margin-left: -${SW}`,
    `padding-left: ${SW}`,
  ].join(";")

  const body = `
        <!-- Full-bleed dark header -->
        <div style="background:#0F172A;padding:22px 48px;text-align:center;" class="no-break">
            <div style="font-size:26px;font-weight:700;color:#fff;line-height:1.15;letter-spacing:-0.01em;">
                ${esc((p.name || "YOUR NAME").toUpperCase())}
            </div>
            ${p.role ? `<div style="text-transform:uppercase;letter-spacing:0.10em;font-size:12px;font-weight:700;color:#60A5FA;margin-top:6px;">${esc(p.role)}</div>` : ""}
            <div style="font-size:11px;color:#CBD5E1;margin-top:5px;">
                ${[p.email, p.phone, p.linkedin, p.github].filter(Boolean).map(esc).join("  &#183;  ")}
            </div>
        </div>

        <!-- Float-based two-column body — survives page breaks -->
        <div class="tc-wrap" style="${wrapStyle}">
            <div class="tc-sidebar">
                ${sideSec("Contact", contactSide)}
                ${skillsSide ? sideSec("Skills", `<div style="display:flex;flex-wrap:wrap;">${skillsSide}</div>`) : ""}
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

// ── Template 3 — Tech Bold Header ────────────────────────────────────────────

function buildTechBoldHeader(d) {
  const p = d.personal || {}
  const sk = d.skills || {}

  const contactLine = [p.location, p.email, p.phone, p.linkedin, p.github].filter(Boolean).join("  |  ")

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
        </div>`).join("")

  const projHtml = (d.projects || []).map(proj => `
        <div class="entry">
            <div class="row-between">
                <div style="font-size:14px;font-weight:700;color:#111827;">${esc(proj.name)}</div>
                ${proj.techStack ? `<span class="t-date">${esc(proj.techStack)}</span>` : ""}
            </div>
            ${proj.description ? `<p style="font-size:13px;color:#374151;margin:2px 0 4px 0;line-height:1.6;">${esc(proj.description)}</p>` : ""}
            ${bulletRows(proj.bullets)}
        </div>`).join("")

  const eduHtml = (d.education || []).map(edu => `
        <div class="entry">
            <div class="row-between">
                <div style="font-size:14px;font-weight:700;color:#111827;">${esc(edu.degree)}</div>
                <span class="t-date">${esc(edu.endYear)}</span>
            </div>
            <div style="font-size:13px;color:#374151;">
                ${esc(edu.institution)}${edu.cgpa ? ` &#8212; CGPA: ${esc(edu.cgpa)}` : ""}
            </div>
        </div>`).join("")

  const achieveHtml = (d.achievements || []).filter(Boolean)
    .map(a => `<div class="bullet-row"><span class="bullet-dash">&#8211;</span><span>${esc(a)}</span></div>`).join("")

  const certHtml = (d.certifications || []).filter(c => c.name)
    .map(c => `<div class="bullet-row"><span class="bullet-dash">&#8211;</span><span>${esc(c.name)}${c.issuer ? ` &#183; ${esc(c.issuer)}` : ""}${c.year ? ` (${esc(c.year)})` : ""}</span></div>`).join("")

  const sec = (title, content) => !content.trim() ? "" : `
        <section style="margin-bottom:18px;">
            ${sectionHead(title)}
            ${content}
        </section>`

  const body = `
        <div style="background:#1E3A5F;padding:26px 40px;text-align:center;" class="no-break">
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

// ── Puppeteer browser args ────────────────────────────────────────────────────

async function getBrowserArgs() {
  const base = await chromium.args
  const extra = [
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",        // prevents OOM in Docker / Lambda
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-sync",
    "--no-first-run",
    "--font-render-hinting=none",     // deterministic glyph rendering
    "--js-flags=--max-old-space-size=512",
  ]
  const seen = new Set(base)
  const merged = [...base]
  for (const a of extra) { if (!seen.has(a)) { merged.push(a); seen.add(a) } }
  return merged
}

// ── Single-attempt render ─────────────────────────────────────────────────────

async function renderPDF(html) {
  const args = await getBrowserArgs()

  const browser = await puppeteer.launch({
    args,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 1 },
  })

  try {
    const page = await browser.newPage()

    // ── 1. Load HTML ────────────────────────────────────────────────────
    // domcontentloaded is fast and reliable.
    // networkidle0 hangs in offline/firewalled environments because it
    // waits for ALL network activity to cease — including failed font
    // requests that never resolve.
    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: PDF_TIMEOUT_MS,
    })

    // ── 2. Wait for fonts ───────────────────────────────────────────────
    // document.fonts.ready resolves when every @font-face referenced by
    // CSS has either loaded or triggered its swap fallback.
    // We race with a hard timeout so we never block indefinitely.
    await page.evaluate(async (timeout) => {
      await Promise.race([
        document.fonts.ready,
        new Promise(r => setTimeout(r, timeout)),
      ])
    }, FONT_TIMEOUT_MS)

    // ── 3. Layout stabilisation ─────────────────────────────────────────
    // After fonts resolve, Chromium runs a synchronous reflow.
    // This delay guarantees the reflow has finished before we capture.
    // Without it, float columns can be caught mid-reflow = misalignment.
    await new Promise(r => setTimeout(r, LAYOUT_DELAY_MS))

    // ── 4. Generate PDF ─────────────────────────────────────────────────
    //
    //  margin all "0mm"          → zero white borders; our HTML padding
    //                              acts as the page margin
    //  printBackground: true     → coloured headers/sidebars print
    //  preferCSSPageSize: true   → respects @page { size: A4 }
    //
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
      displayHeaderFooter: false,

      // ── Page numbers (uncomment to enable) ─────────────────────────
      // displayHeaderFooter: true,
      // headerTemplate: "<span></span>",
      // footerTemplate: `
      //   <div style="width:100%;text-align:right;font-size:9px;
      //     color:#9CA3AF;padding:0 12mm;font-family:Inter,sans-serif;">
      //     <span class="pageNumber"></span> / <span class="totalPages"></span>
      //   </div>`,
      // margin: { top:"0mm", right:"0mm", bottom:"12mm", left:"0mm" },
      // ───────────────────────────────────────────────────────────────

      timeout: PDF_TIMEOUT_MS,
    })

    return pdf

  } finally {
    await browser.close()   // always close — prevents zombie processes
  }
}

// ── Output validation ─────────────────────────────────────────────────────────

function validatePDF(buffer, attempt) {
  if (!buffer || buffer.length < MIN_PDF_BYTES) {
    throw new Error(
      `[PDF] Attempt ${attempt}: buffer too small (${buffer?.length ?? 0} bytes). ` +
      `Chromium may have crashed or page failed to render.`
    )
  }
  const magic = buffer.slice(0, 5).toString("ascii")
  if (magic !== "%PDF-") {
    throw new Error(
      `[PDF] Attempt ${attempt}: invalid PDF header "${magic}". ` +
      `Expected "%PDF-". HTML may not have loaded correctly.`
    )
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

async function generatePDF(templateId, data) {
  const html = getTemplateHTML(templateId, data)
  let lastError = null

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      console.log(`[PDF] Attempt ${attempt}/${MAX_RETRIES + 1}  template="${templateId}"`)
      const pdf = await renderPDF(html)
      validatePDF(pdf, attempt)
      console.log(`[PDF] ✓ Success  ${pdf.length.toLocaleString()} bytes  attempt=${attempt}`)
      return pdf
    } catch (err) {
      lastError = err
      console.error(`[PDF] ✗ Attempt ${attempt} failed: ${err.message}`)
      if (attempt <= MAX_RETRIES) {
        const wait = attempt * 600
        console.log(`[PDF] Retrying in ${wait}ms…`)
        await new Promise(r => setTimeout(r, wait))
      }
    }
  }

  throw new Error(
    `[PDF] All ${MAX_RETRIES + 1} attempts failed for template="${templateId}". ` +
    `Last error: ${lastError?.message}`
  )
}

module.exports = { generatePDF }