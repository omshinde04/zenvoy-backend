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

if (!process.env.FRONTEND_URL) {
    console.warn("⚠️ FRONTEND_URL not set")
}

// ─── CORS ────────────────────────────────────────────────

const allowedOrigins = [
    "http://localhost:3000",
    process.env.FRONTEND_URL,
].filter(Boolean)

console.log("🌐 Allowed Origins:", allowedOrigins)

fastify.register(require("@fastify/cors"), {
    origin: (origin, cb) => {
        const allowed = [
            "http://localhost:3000",
            process.env.FRONTEND_URL,
        ].filter(Boolean)

        if (!origin) return cb(null, true)

        const cleanOrigin = origin.replace(/\/$/, "")

        const isAllowed = allowed.some(
            (o) => o.replace(/\/$/, "") === cleanOrigin
        )

        if (isAllowed) {
            // ✅ IMPORTANT: explicitly return origin
            return cb(null, origin)
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

// ─── REQUEST LOGGING (VERY USEFUL) ─────────────────────────

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

// ─── GLOBAL ERROR HANDLER (CRITICAL) ──────────────────────

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