// src/index.js

require("dotenv").config()

// src/index.js — update this line at the top

const fastify = require("fastify")({
    logger: true,
    bodyLimit: 10 * 1024 * 1024, // 10MB limit for resume JSON
})

// ─── PLUGINS ────────────────────────────────────────────────

// CORS
fastify.register(require("@fastify/cors"), {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
})

// Cookie
fastify.register(require("@fastify/cookie"))

// JWT
fastify.register(require("@fastify/jwt"), {
    secret: process.env.JWT_SECRET,
    cookie: {
        cookieName: "zenvoy_token",
        signed: false,
    },
})

// ─── ROUTES ─────────────────────────────────────────────────

fastify.register(require("./routes/auth"))
fastify.register(require("./routes/pdf"))

// Health check
fastify.get("/health", async () => {
    return { status: "ok", service: "Zenvoy API" }
})

// ─── START ──────────────────────────────────────────────────

const start = async () => {
    try {
        await fastify.listen({
            port: process.env.PORT || 4000,
            host: "0.0.0.0",
        })
        console.log(`🚀 Zenvoy backend running on port ${process.env.PORT || 4000}`)
    } catch (err) {
        fastify.log.error(err)
        process.exit(1)
    }
}

start()