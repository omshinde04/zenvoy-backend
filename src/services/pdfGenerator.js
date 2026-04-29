// src/services/pdfGenerator.js

const puppeteer = require("puppeteer-core")
const chromium = require("@sparticuz/chromium")


// ── Template HTML Builders ───────────────────────────────────
// Each function takes data and returns complete HTML string
// Puppeteer renders this HTML → PDF

function getTemplateHTML(templateId, data) {
  switch (templateId) {
    case "tech-minimal":
      return buildTechMinimal(data)
    case "tech-two-column":
      return buildTechTwoColumn(data)
    case "tech-bold-header":
      return buildTechBoldHeader(data)
    default:
      throw new Error(`Unknown template: ${templateId}`)
  }
}

// ── Shared Helpers ───────────────────────────────────────────

function bulletItems(bullets = []) {
  return bullets
    .filter(Boolean)
    .map(b => `
      <div style="display:flex;font-size:12px;color:#374151;line-height:1.6;margin-bottom:3px;">
        <span style="width:14px;flex-shrink:0;margin-right:4px;">–</span>
        <span>${escHtml(b)}</span>
      </div>
    `)
    .join("")
}

function sectionHeader(title, color = "#2563EB") {
  return `
    <div style="
      font-size:10px;font-weight:700;letter-spacing:0.1em;
      color:${color};text-transform:uppercase;
      border-bottom:1px solid #E5E7EB;
      padding-bottom:4px;margin-bottom:12px;
      font-family:Inter,sans-serif;
    ">${escHtml(title)}</div>
  `
}

function escHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function baseHtml(bodyContent) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap" rel="stylesheet"/>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          width: 794px;
          height: 1123px;
          background: #fff;
          font-family: Inter, sans-serif;
          -webkit-font-smoothing: antialiased;
          overflow: hidden;
        }
      </style>
    </head>
    <body>${bodyContent}</body>
    </html>
  `
}

// ── Template 1: Tech Minimal ─────────────────────────────────

function buildTechMinimal(d) {
  const p = d.personal || {}
  const skills = d.skills || {}

  const contactItems = [p.email, p.phone, p.linkedin, p.location, p.github]
    .filter(Boolean)

  const contactHTML = contactItems
    .map((item, i) => `
      <span>${escHtml(item)}</span>
      ${i < contactItems.length - 1
        ? `<span style="margin:0 8px;color:#2563EB;font-weight:700;">·</span>`
        : ""}
    `)
    .join("")

  const skillRows = [
    skills.languages?.length > 0
      ? `<div style="font-size:12px;margin-bottom:4px;">
           <span style="font-weight:600;color:#111827;">Languages: </span>
           <span style="color:#374151;">${escHtml(skills.languages.join(", "))}</span>
         </div>` : "",
    skills.frameworks?.length > 0
      ? `<div style="font-size:12px;margin-bottom:4px;">
           <span style="font-weight:600;color:#111827;">Frameworks: </span>
           <span style="color:#374151;">${escHtml(skills.frameworks.join(", "))}</span>
         </div>` : "",
    skills.tools?.length > 0
      ? `<div style="font-size:12px;margin-bottom:4px;">
           <span style="font-weight:600;color:#111827;">Tools: </span>
           <span style="color:#374151;">${escHtml(skills.tools.join(", "))}</span>
         </div>` : "",
    skills.other?.length > 0
      ? `<div style="font-size:12px;margin-bottom:4px;">
           <span style="font-weight:600;color:#111827;">Other: </span>
           <span style="color:#374151;">${escHtml(skills.other.join(", "))}</span>
         </div>` : "",
  ].filter(Boolean).join("")

  const experienceHTML = (d.experience || []).map(exp => `
    <div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:13px;font-weight:600;color:#111827;">${escHtml(exp.role)}</span>
        <span style="font-size:11px;color:#6B7280;">
          ${escHtml(exp.startDate)}${exp.startDate ? " – " : ""}${exp.current ? "Present" : escHtml(exp.endDate)}
        </span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
        <span style="font-size:12px;color:#374151;">${escHtml(exp.company)}</span>
        <span style="font-size:11px;color:#6B7280;">${escHtml(exp.location)}</span>
      </div>
      ${bulletItems(exp.bullets)}
    </div>
  `).join("")

  const projectsHTML = (d.projects || []).map(proj => `
    <div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:13px;font-weight:600;color:#111827;">${escHtml(proj.name)}</span>
        <span style="font-size:11px;color:#6B7280;">${escHtml(proj.techStack)}</span>
      </div>
      ${proj.description
      ? `<p style="font-size:12px;color:#6B7280;font-style:italic;margin:2px 0 4px 0;">${escHtml(proj.description)}</p>`
      : ""}
      <div style="margin-left:12px;">${bulletItems(proj.bullets)}</div>
    </div>
  `).join("")

  const educationHTML = (d.education || []).map(edu => `
    <div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:13px;font-weight:600;color:#111827;">${escHtml(edu.degree)}</span>
        <span style="font-size:11px;color:#6B7280;">${escHtml(edu.endYear)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:12px;color:#374151;">${escHtml(edu.institution)}</span>
        ${edu.cgpa ? `<span style="font-size:11px;color:#6B7280;">CGPA: ${escHtml(edu.cgpa)}</span>` : ""}
      </div>
    </div>
  `).join("")

  const achievementsHTML = (d.achievements || [])
    .filter(Boolean)
    .map(a => `
      <div style="display:flex;font-size:12px;color:#374151;line-height:1.6;margin-bottom:3px;">
        <span style="width:14px;flex-shrink:0;margin-right:4px;">–</span>
        <span>${escHtml(a)}</span>
      </div>
    `).join("")

  const body = `
    <div style="width:794px;min-height:1123px;background:#fff;display:flex;flex-direction:column;">

      <!-- Header -->
      <div style="padding:40px 40px 16px 40px;border-bottom:1px solid #E5E7EB;text-align:center;">
        <h1 style="font-size:30px;font-weight:700;letter-spacing:-0.02em;color:#111827;line-height:36px;">
          ${escHtml((p.name || "YOUR NAME").toUpperCase())}
        </h1>
        <p style="font-size:13px;color:#6B7280;margin-top:4px;">${escHtml(p.role || "")}</p>
        <div style="display:flex;justify-content:center;flex-wrap:wrap;margin-top:6px;font-size:11px;color:#6B7280;">
          ${contactHTML}
        </div>
      </div>

      <!-- Body -->
      <div style="padding:24px 40px 40px 40px;display:flex;flex-direction:column;gap:20px;">

        ${skillRows ? `
          <section>
            ${sectionHeader("TECHNICAL SKILLS")}
            ${skillRows}
          </section>
        ` : ""}

        ${experienceHTML ? `
          <section>
            ${sectionHeader("PROFESSIONAL EXPERIENCE")}
            ${experienceHTML}
          </section>
        ` : ""}

        ${projectsHTML ? `
          <section>
            ${sectionHeader("PROJECTS")}
            ${projectsHTML}
          </section>
        ` : ""}

        ${educationHTML ? `
          <section>
            ${sectionHeader("EDUCATION")}
            ${educationHTML}
          </section>
        ` : ""}

        ${achievementsHTML ? `
          <section>
            ${sectionHeader("ACHIEVEMENTS")}
            ${achievementsHTML}
          </section>
        ` : ""}

      </div>
    </div>
  `

  return baseHtml(body)
}

// ── Template 2: Tech Two Column ──────────────────────────────

function buildTechTwoColumn(d) {
  const p = d.personal || {}
  const skills = d.skills || {}

  const allSkills = [
    ...(skills.languages || []),
    ...(skills.frameworks || []),
    ...(skills.tools || []),
    ...(skills.other || []),
  ]

  const contactSidebarHTML = [
    { label: "Phone", value: p.phone },
    { label: "Email", value: p.email },
    { label: "Location", value: p.location },
    { label: "LinkedIn", value: p.linkedin },
    { label: "GitHub", value: p.github },
  ].filter(c => c.value).map(c => `
    <div style="display:flex;flex-direction:column;margin-bottom:8px;">
      <span style="font-size:10px;font-weight:600;color:#334155;">${c.label}</span>
      <span style="font-size:10px;color:#475569;">${escHtml(c.value)}</span>
    </div>
  `).join("")

  const skillsHTML = allSkills.length > 0
    ? allSkills.map((s, i) => `
        <span style="font-size:10px;font-weight:600;color:#334155;">
          ${escHtml(s)}${i < allSkills.length - 1 ? " |" : ""}
        </span>
      `).join(" ")
    : ""

  const educationSideHTML = (d.education || []).map(edu => `
    <div style="margin-bottom:14px;">
      <p style="font-size:10px;font-weight:600;color:#1E293B;">${escHtml(edu.degree)}</p>
      <p style="font-size:9px;color:#64748B;margin-top:1px;">${escHtml(edu.institution)}</p>
      <p style="font-size:9px;color:#64748B;font-style:italic;margin-top:1px;">
        ${escHtml(edu.startYear)}${edu.startYear && edu.endYear ? " — " : ""}${escHtml(edu.endYear)}
      </p>
    </div>
  `).join("")

  const certHTML = (d.certifications || []).filter(c => c.name).map(cert => `
    <p style="font-size:10px;color:#475569;margin-bottom:5px;">– ${escHtml(cert.name)}</p>
  `).join("")

  const projectsMainHTML = (d.projects || []).map(proj => `
    <div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <h3 style="font-size:12px;font-weight:600;color:#0F172A;text-transform:uppercase;">${escHtml(proj.name)}</h3>
        <span style="font-size:9px;color:#64748B;">${escHtml(proj.techStack)}</span>
      </div>
      <div style="margin-top:6px;">${bulletItems(proj.bullets)}</div>
    </div>
  `).join("")

  const experienceMainHTML = (d.experience || []).map(exp => `
    <div style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <h3 style="font-size:12px;font-weight:600;color:#0F172A;text-transform:uppercase;">${escHtml(exp.role)}</h3>
        <span style="font-size:9px;color:#64748B;">
          ${escHtml(exp.company)}${exp.company ? " | " : ""}
          ${escHtml(exp.startDate)}${exp.startDate ? " — " : ""}${exp.current ? "Present" : escHtml(exp.endDate)}
        </span>
      </div>
      <div style="margin-top:6px;">${bulletItems(exp.bullets)}</div>
    </div>
  `).join("")

  const achievementsGridHTML = (d.achievements || []).filter(Boolean).map(a => `
    <div style="padding:10px;background:#F8FAFC;border-left:2px solid #2563EB;">
      <p style="font-size:10px;font-weight:600;color:#0F172A;">${escHtml(a)}</p>
    </div>
  `).join("")

  const sideSection = (title, content) => content ? `
    <div style="margin-bottom:24px;">
      <h2 style="font-size:9px;text-transform:uppercase;font-weight:700;color:#1D4ED8;letter-spacing:0.08em;margin-bottom:6px;">
        ${title}
      </h2>
      <div style="height:1px;background:#CBD5E1;margin-bottom:10px;"></div>
      ${content}
    </div>
  ` : ""

  const mainSection = (title, content) => content ? `
    <section style="margin-bottom:20px;">
      <h2 style="font-size:10px;text-transform:uppercase;font-weight:700;color:#1D4ED8;letter-spacing:0.1em;margin-bottom:6px;">
        ${title}
      </h2>
      <div style="height:1px;background:#0F172A;margin-bottom:14px;"></div>
      ${content}
    </section>
  ` : ""

  const body = `
    <div style="width:794px;height:1123px;background:#fff;display:flex;flex-direction:column;overflow:hidden;font-family:Inter,sans-serif;">

      <!-- Dark Header -->
      <header style="display:flex;flex-direction:column;justify-content:center;align-items:center;width:100%;padding:0 48px;background:#0F172A;height:120px;flex-shrink:0;">
        <h1 style="font-size:28px;font-weight:700;color:#fff;margin:0;line-height:34px;">
          ${escHtml((p.name || "YOUR NAME").toUpperCase())}
        </h1>
        <p style="font-family:Inter;text-transform:uppercase;letter-spacing:0.1em;font-size:13px;font-weight:700;color:#60A5FA;margin-top:6px;">
          ${escHtml(p.role || "")}
        </p>
        <p style="font-family:Inter;font-size:11px;color:#CBD5E1;margin-top:4px;">
          ${[p.email, p.phone, p.linkedin, p.github].filter(Boolean).join("  •  ")}
        </p>
      </header>

      <!-- Body -->
      <div style="display:flex;flex:1;overflow:hidden;">

        <!-- Sidebar -->
        <aside style="width:224px;background:#F1F5F9;border-right:1px solid #CBD5E1;padding:28px 24px;flex-shrink:0;overflow:hidden;">
          ${sideSection("CONTACT", contactSidebarHTML)}
          ${allSkills.length > 0 ? sideSection("SKILLS", `<div style="display:flex;flex-wrap:wrap;gap:3px;">${skillsHTML}</div>`) : ""}
          ${educationSideHTML ? sideSection("EDUCATION", educationSideHTML) : ""}
          ${certHTML ? sideSection("CERTIFICATIONS", certHTML) : ""}
        </aside>

        <!-- Main -->
        <main style="flex:1;background:#fff;padding:28px 32px;overflow:hidden;">
          ${mainSection("PROJECTS", projectsMainHTML)}
          ${mainSection("EXPERIENCE", experienceMainHTML)}
          ${achievementsGridHTML ? `
            <section>
              <h2 style="font-size:10px;text-transform:uppercase;font-weight:700;color:#1D4ED8;letter-spacing:0.1em;margin-bottom:6px;">ACHIEVEMENTS</h2>
              <div style="height:1px;background:#0F172A;margin-bottom:14px;"></div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                ${achievementsGridHTML}
              </div>
            </section>
          ` : ""}
        </main>
      </div>

      <!-- Footer -->
      <footer style="display:flex;justify-content:space-between;align-items:center;width:100%;padding:12px 48px;background:#fff;border-top:1px solid #E2E8F0;flex-shrink:0;">
        <p style="font-size:10px;text-transform:uppercase;color:#94A3B8;">References available upon request</p>
        <div style="display:flex;gap:16px;">
          ${p.linkedin ? `<span style="font-size:10px;text-transform:uppercase;color:#94A3B8;">LinkedIn</span>` : ""}
          ${p.github ? `<span style="font-size:10px;text-transform:uppercase;color:#94A3B8;">GitHub</span>` : ""}
        </div>
      </footer>
    </div>
  `

  return baseHtml(body)
}

// ── Template 3: Tech Bold Header ─────────────────────────────

function buildTechBoldHeader(d) {
  const p = d.personal || {}
  const skills = d.skills || {}

  const contactLine = [p.location, p.email, p.phone, p.linkedin, p.github]
    .filter(Boolean).join("  |  ")

  const skillRows = [
    skills.languages?.length > 0
      ? `<p style="font-size:13px;color:#374151;margin-bottom:4px;line-height:1.6;">
           <strong style="color:#111827;">Languages:</strong> ${escHtml(skills.languages.join(", "))}
         </p>` : "",
    skills.frameworks?.length > 0
      ? `<p style="font-size:13px;color:#374151;margin-bottom:4px;line-height:1.6;">
           <strong style="color:#111827;">Frameworks &amp; Libraries:</strong> ${escHtml(skills.frameworks.join(", "))}
         </p>` : "",
    skills.tools?.length > 0
      ? `<p style="font-size:13px;color:#374151;margin-bottom:4px;line-height:1.6;">
           <strong style="color:#111827;">Tools:</strong> ${escHtml(skills.tools.join(", "))}
         </p>` : "",
    skills.other?.length > 0
      ? `<p style="font-size:13px;color:#374151;margin-bottom:4px;line-height:1.6;">
           <strong style="color:#111827;">Other:</strong> ${escHtml(skills.other.join(", "))}
         </p>` : "",
  ].filter(Boolean).join("")

  const experienceHTML = (d.experience || []).map(exp => `
    <div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
        <h3 style="font-size:14px;font-weight:700;color:#111827;margin:0;">
          ${escHtml(exp.role)}${exp.company ? ` / ${escHtml(exp.company)}` : ""}
        </h3>
        <span style="font-size:11px;color:#6B7280;flex-shrink:0;margin-left:12px;">
          ${escHtml(exp.startDate)}${exp.startDate ? " – " : ""}${exp.current ? "Present" : escHtml(exp.endDate)}
        </span>
      </div>
      ${bulletItems(exp.bullets)}
    </div>
  `).join("")

  const projectsHTML = (d.projects || []).map(proj => `
    <div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
        <h3 style="font-size:14px;font-weight:700;color:#111827;margin:0;">${escHtml(proj.name)}</h3>
        ${proj.techStack
      ? `<span style="font-size:11px;color:#6B7280;flex-shrink:0;margin-left:12px;">${escHtml(proj.techStack)}</span>`
      : ""}
      </div>
      ${proj.description
      ? `<p style="font-size:13px;color:#374151;margin:0 0 4px 0;line-height:1.6;">${escHtml(proj.description)}</p>`
      : ""}
      ${bulletItems(proj.bullets)}
    </div>
  `).join("")

  const educationHTML = (d.education || []).map(edu => `
    <div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">
        <h3 style="font-size:14px;font-weight:700;color:#111827;margin:0;">${escHtml(edu.degree)}</h3>
        <span style="font-size:11px;color:#6B7280;flex-shrink:0;margin-left:12px;">${escHtml(edu.endYear)}</span>
      </div>
      <p style="font-size:13px;color:#374151;margin:0;">
        ${escHtml(edu.institution)}${edu.cgpa ? ` — CGPA: ${escHtml(edu.cgpa)}` : ""}
      </p>
    </div>
  `).join("")

  const achievementsHTML = (d.achievements || []).filter(Boolean)
    .map(a => `
      <div style="display:flex;font-size:13px;color:#374151;line-height:1.6;margin-bottom:3px;">
        <span style="width:14px;flex-shrink:0;margin-right:4px;">–</span>
        <span>${escHtml(a)}</span>
      </div>
    `).join("")

  const section = (title, content) => content ? `
    <section style="margin-bottom:20px;">
      ${sectionHeader(title)}
      ${content}
    </section>
  ` : ""

  const body = `
    <div style="width:794px;height:1123px;background:#fff;display:flex;flex-direction:column;overflow:hidden;font-family:Inter,sans-serif;">

      <!-- Bold Dark Header -->
      <header style="display:flex;flex-direction:column;justify-content:center;align-items:center;background:#1E3A5F;padding:28px 40px;flex-shrink:0;">
        <h1 style="font-size:30px;font-weight:900;color:#fff;letter-spacing:-0.02em;text-transform:uppercase;margin:0;line-height:36px;">
          ${escHtml(p.name || "YOUR NAME")}
        </h1>
        <p style="color:#fff;margin-top:8px;font-size:11px;letter-spacing:0.06em;opacity:0.85;">
          ${escHtml(contactLine)}
        </p>
      </header>

      <!-- Body -->
      <div style="padding:28px 40px 0 40px;display:flex;flex-direction:column;gap:0;flex:1;overflow:hidden;">
        ${section("Technical Skills", skillRows)}
        ${section("Professional Experience", experienceHTML)}
        ${section("Projects", projectsHTML)}
        ${section("Education", educationHTML)}
        ${section("Achievements", achievementsHTML)}
      </div>

      <!-- Footer -->
      <footer style="padding:14px 40px;border-top:1px solid #0F172A;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
        <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#0F172A;">
          ${escHtml(p.name || "")}
        </span>
        <div style="display:flex;gap:16px;">
          ${p.linkedin ? `<span style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#64748B;">LinkedIn</span>` : ""}
          ${p.github ? `<span style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#64748B;">GitHub</span>` : ""}
          ${p.portfolio ? `<span style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#64748B;">Portfolio</span>` : ""}
        </div>
      </footer>
    </div>
  `

  return baseHtml(body)
}

async function generatePDF(templateId, data) {
  const html = getTemplateHTML(templateId, data)

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    defaultViewport: null,
  })

  try {
    const page = await browser.newPage()

    // Load HTML
    await page.setContent(html, {
      waitUntil: "networkidle0",
      timeout: 30000,
    })

    // Wait for fonts (important for layout)
    await page.evaluateHandle("document.fonts.ready")

    // ✅ FINAL PDF CONFIG (MULTI-PAGE SUPPORT)
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "12mm",
        right: "12mm",
        bottom: "12mm",
        left: "12mm",
      },
    })

    return pdf

  } catch (err) {
    console.error("❌ PDF generation failed:", err)
    throw err
  } finally {
    await browser.close()
  }
}
module.exports = { generatePDF }