require("dotenv").config()

const fastify = require("fastify")({
    logger: {
        level: "info",
    },
    bodyLimit: 10 * 1024 * 1024,
})

// ─── ENV VALIDATION ───────────────────────────────────────

if (!process.env.JWT_SECRET) {
    console.error("❌ Missing JWT_SECRET")
    process.exit(1)
}

// ─── CORS ────────────────────────────────────────────────

// ✅ FINAL ALLOWED ORIGINS
const allowedOrigins = [
    "http://localhost:3000",
    "https://zapiya.com",
    "https://www.zapiya.com",
]

console.log("🌐 Allowed Origins:", allowedOrigins)

// ✅ SIMPLE + RELIABLE CORS
fastify.register(require("@fastify/cors"), {
    origin: (origin, cb) => {
        if (!origin) return cb(null, true)

        if (allowedOrigins.includes(origin)) {
            console.log("✅ CORS allowed:", origin)
            return cb(null, true)
        }

        console.error("❌ CORS blocked:", origin)
        return cb(new Error("Not allowed"), false)
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

// ─── REQUEST LOGGING ─────────────────────────────────────

fastify.addHook("onRequest", async (req, reply) => {
    fastify.log.info({
        method: req.method,
        url: req.url,
        origin: req.headers.origin,
    }, "Incoming request")
})

// ─── RESPONSE LOGGING ─────────────────────────────────────

fastify.addHook("onResponse", async (req, reply) => {
    fastify.log.info({
        statusCode: reply.statusCode,
        url: req.url,
    }, "Response sent")
})

// ─── GLOBAL ERROR HANDLER ────────────────────────────────

fastify.setErrorHandler((error, req, reply) => {
    fastify.log.error("🔥 Server Error:", error)

    reply.status(500).send({
        success: false,
        message: error.message || "Internal Server Error",
    })
})

// ─── ROUTES ───────────────────────────────────────────────

fastify.register(require("./routes/auth"))
fastify.register(require("./routes/pdf"))

// ─── HEALTH CHECK ─────────────────────────────────────────

fastify.get("/health", async () => {
    return {
        status: "ok",
        service: "Zenvoy API",
        time: new Date().toISOString(),
    }
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