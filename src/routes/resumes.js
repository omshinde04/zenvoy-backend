// src/routes/resumes.js
const pool = require("../config/db")
const authenticate = require("../middleware/authenticate")

async function resumeRoutes(fastify) {
    // =========================================================
    // GET CURRENT USER'S RESUME
    // =========================================================
    fastify.get("/api/resumes", { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const userId = request.user.id

            const result = await pool.query(
                "SELECT template_id, data, updated_at FROM resumes WHERE user_id = $1 LIMIT 1",
                [userId]
            )

            if (result.rows.length === 0) {
                return reply.send({
                    success: true,
                    resume: null,
                })
            }

            const row = result.rows[0]
            return reply.send({
                success: true,
                resume: {
                    templateId: row.template_id,
                    data: row.data,
                    updatedAt: row.updated_at,
                },
            })
        } catch (error) {
            fastify.log.error(error, "GET RESUME ERROR")
            return reply.status(500).send({
                success: false,
                message: "Failed to fetch resume",
            })
        }
    })

    // =========================================================
    // SAVE / SYNC RESUME
    // =========================================================
    fastify.put("/api/resumes", { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const userId = request.user.id
            const { templateId = "tech-minimal", data } = request.body || {}

            if (!data || typeof data !== "object") {
                return reply.status(400).send({
                    success: false,
                    message: "Invalid or missing resume data",
                })
            }

            const result = await pool.query(
                `
                INSERT INTO resumes (user_id, template_id, data, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (user_id)
                DO UPDATE SET template_id = EXCLUDED.template_id, data = EXCLUDED.data, updated_at = NOW()
                RETURNING template_id, data, updated_at
                `,
                [userId, templateId, JSON.stringify(data)]
            )

            const saved = result.rows[0]

            return reply.send({
                success: true,
                message: "Resume synced successfully",
                resume: {
                    templateId: saved.template_id,
                    data: saved.data,
                    updatedAt: saved.updated_at,
                },
            })
        } catch (error) {
            fastify.log.error(error, "SAVE RESUME ERROR")
            return reply.status(500).send({
                success: false,
                message: "Failed to save resume",
            })
        }
    })
}

module.exports = resumeRoutes

