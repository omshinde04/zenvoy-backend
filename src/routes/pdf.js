// src/routes/pdf.js
// ── THE ROOT CAUSE FIX ────────────────────────────────────────────────────────
//
//  Error "37,80,68,70,45" = Buffer JSON-serialized as comma-separated integers.
//  This happens when you pass a Buffer to Fastify's reply.send() —
//  Fastify's default JSON serializer converts it to { type:"Buffer", data:[...] }
//  which the route then sends as a JSON string, not binary.
//
//  THE FIX: bypass Fastify's serializer completely.
//  Use reply.raw (Node.js http.ServerResponse) to write the binary directly.
//  reply.raw.write() / reply.raw.end() never serializes — it sends bytes as-is.
//
// ─────────────────────────────────────────────────────────────────────────────

"use strict"

const { generatePDF } = require("../services/pdfGenerator")

const VALID_TEMPLATES = [
    "tech-minimal",
    "tech-two-column",
    "tech-bold-header",
]

async function pdfRoutes(fastify) {

    // Increase body size limit for large resume JSON payloads
    fastify.addContentTypeParser(
        "application/json",
        { parseAs: "string", bodyLimit: 5 * 1024 * 1024 },
        (req, body, done) => {
            try { done(null, JSON.parse(body)) }
            catch (err) { done(err) }
        }
    )

    fastify.post("/api/pdf/generate", async (request, reply) => {
        const { templateId, data } = request.body || {}

        // ── Validate inputs ────────────────────────────────────────────────
        if (!templateId || !VALID_TEMPLATES.includes(templateId)) {
            reply.status(400)
            return reply.send({ success: false, message: `Invalid template: "${templateId}"` })
        }
        if (!data || typeof data !== "object") {
            reply.status(400)
            return reply.send({ success: false, message: "Resume data is required" })
        }

        // ── Generate PDF ───────────────────────────────────────────────────
        let pdfBuffer
        try {
            fastify.log.info(`[PDF] generating  template="${templateId}"`)
            pdfBuffer = await generatePDF(templateId, data)
            fastify.log.info(`[PDF] done  bytes=${pdfBuffer.length}`)
        } catch (err) {
            fastify.log.error(`[PDF] error: ${err.message}`)
            reply.status(500)
            return reply.send({ success: false, message: err.message })
        }

        // ── Sanity check — make sure we really have a Buffer ──────────────
        if (!Buffer.isBuffer(pdfBuffer)) {
            // Uint8Array from newer Puppeteer versions — convert
            pdfBuffer = Buffer.from(pdfBuffer)
        }

        // ── Build filename ─────────────────────────────────────────────────
        const rawName = (data.personal?.name || "resume")
            .replace(/\s+/g, "-")
            .replace(/[^a-zA-Z0-9-]/g, "")
            .toLowerCase()
            .slice(0, 60) || "resume"
        const fileName = `${rawName}-zenvoy.pdf`

        // ── Send binary response via reply.raw ────────────────────────────
        //
        //  WHY reply.raw and NOT reply.send()?
        //  ─────────────────────────────────────
        //  reply.send(buffer) → Fastify serializes → JSON string of integers
        //  reply.raw.end(buffer) → Node.js http layer → raw bytes, no touching
        //
        //  We set headers on reply.raw (Node ServerResponse) directly,
        //  then write the buffer and end the response ourselves.
        //  Fastify never sees the body, so it can never corrupt it.
        //
        reply.hijack()   // tell Fastify: "I'm handling this response myself"

        const res = reply.raw
        res.statusCode = 200
        res.setHeader("Content-Type", "application/pdf")
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`)
        res.setHeader("Content-Length", pdfBuffer.length)
        res.setHeader("Cache-Control", "no-store")

        // CORS — allow the Next.js frontend origin
        const origin = request.headers.origin || "http://localhost:3000"
        res.setHeader("Access-Control-Allow-Origin", origin)
        res.setHeader("Access-Control-Allow-Credentials", "true")
        res.setHeader("Access-Control-Expose-Headers", "Content-Disposition")

        res.end(pdfBuffer)   // write binary — no serialization, no corruption
    })

    // ── Preflight OPTIONS for the PDF route ───────────────────────────────────
    fastify.options("/api/pdf/generate", async (request, reply) => {
        const origin = request.headers.origin || "http://localhost:3000"
        reply
            .status(204)
            .header("Access-Control-Allow-Origin", origin)
            .header("Access-Control-Allow-Methods", "POST, OPTIONS")
            .header("Access-Control-Allow-Headers", "Content-Type")
            .header("Access-Control-Allow-Credentials", "true")
            .send()
    })
}

module.exports = pdfRoutes