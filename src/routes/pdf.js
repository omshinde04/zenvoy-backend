// src/routes/pdf.js

const { generatePDF } = require("../services/pdfGenerator")

const VALID_TEMPLATES = [
    "tech-minimal",
    "tech-two-column",
    "tech-bold-header",
]

async function pdfRoutes(fastify) {

    // Accept large JSON payloads
    fastify.addContentTypeParser(
        "application/json",
        { parseAs: "string", bodyLimit: 10 * 1024 * 1024 },
        function (req, body, done) {
            try {
                done(null, JSON.parse(body))
            } catch (err) {
                done(err)
            }
        }
    )

    fastify.post("/api/pdf/generate", async (request, reply) => {
        const { templateId, data } = request.body

        if (!templateId || !VALID_TEMPLATES.includes(templateId)) {
            return reply.status(400).send({
                success: false,
                message: `Invalid template: ${templateId}`,
            })
        }

        if (!data || typeof data !== "object") {
            return reply.status(400).send({
                success: false,
                message: "Resume data is required",
            })
        }

        try {
            fastify.log.info(`Generating PDF — template: ${templateId}`)

            const pdfBuffer = await generatePDF(templateId, data)

            fastify.log.info(`PDF generated — size: ${pdfBuffer.length} bytes`)

            const name = (data.personal?.name || "resume")
                .replace(/\s+/g, "-")
                .replace(/[^a-zA-Z0-9-]/g, "")
                .toLowerCase()

            const fileName = `${name}-zenvoy.pdf`

            // ✅ ONLY THESE HEADERS
            reply.raw.setHeader("Content-Type", "application/pdf")
            reply.raw.setHeader("Content-Disposition", `attachment; filename="${fileName}"`)
            reply.raw.setHeader("Content-Length", pdfBuffer.length)

            // ❌ DO NOT SET CORS HERE
            // Fastify CORS plugin already handles it

            return reply.send(pdfBuffer)

        } catch (err) {
            fastify.log.error("PDF generation error:", err)

            return reply.status(500).send({
                success: false,
                message: err.message || "PDF generation failed",
            })
        }
    })
}

module.exports = pdfRoutes