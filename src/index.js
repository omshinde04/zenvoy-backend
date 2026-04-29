require("dotenv").config()

const fastify = require("fastify")({
    logger: true,
    bodyLimit: 10 * 1024 * 1024,
})

// ─── CORS ────────────────────────────────────────────────

const allowedOrigins = [
    "http://localhost:3000",
    process.env.FRONTEND_URL,
].filter(Boolean)

console.log("✅ Allowed Origins:", allowedOrigins)

fastify.register(require("@fastify/cors"), {
    origin: (origin, cb) => {
        // allow server-to-server or curl requests (no origin)
        if (!origin) return cb(null, true)

        if (allowedOrigins.includes(origin)) {
            cb(null, true)
        } else {
            cb(new Error(`CORS blocked: ${origin}`), false)
        }
    },
    credentials: true,
})

// ─── COOKIE ───────────────────────────────────────────────

fastify.register(require("@fastify/cookie"))

// ─── JWT ──────────────────────────────────────────────────

fastify.register(require("@fastify/jwt"), {
    secret: process.env.JWT_SECRET,
    cookie: {
        cookieName: "zenvoy_token",
        signed: false,
    },
})

// ─── ROUTES ───────────────────────────────────────────────

fastify.register(require("./routes/auth"))
fastify.register(require("./routes/pdf"))

// ─── HEALTH CHECK ─────────────────────────────────────────

fastify.get("/health", async () => {
    return { status: "ok", service: "Zenvoy API" }
})

// ─── START SERVER ─────────────────────────────────────────

const start = async () => {
    try {
        await fastify.listen({
            port: process.env.PORT || 4000,
            host: "0.0.0.0",
        })

        console.log(`🚀 Backend running on port ${process.env.PORT || 4000}`)
    } catch (err) {
        fastify.log.error(err)
        process.exit(1)
    }
}

start()