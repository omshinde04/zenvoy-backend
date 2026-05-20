require("dotenv").config()

const fastify = require("fastify")({
    logger: {
        level: process.env.NODE_ENV === "production"
            ? "info"
            : "debug",
    },

    bodyLimit: 10 * 1024 * 1024,

    trustProxy: true,
})

// =========================================================
// ENV VALIDATION
// =========================================================

const requiredEnv = [
    "JWT_SECRET",
    "DATABASE_URL",
]

requiredEnv.forEach((key) => {
    if (!process.env[key]) {
        console.error(`❌ Missing environment variable: ${key}`)
        process.exit(1)
    }
})

// =========================================================
// ALLOWED ORIGINS
// =========================================================

const allowedOrigins = [
    "http://localhost:3000",

    "https://zapiya.com",

    "https://www.zapiya.com",

    "https://zenvoy.vercel.app",
]

console.log("🌐 Allowed Origins:", allowedOrigins)

// =========================================================
// CORS
// =========================================================

fastify.register(require("@fastify/cors"), {

    origin: (origin, cb) => {

        // Allow server-to-server requests
        if (!origin) {
            return cb(null, true)
        }

        // Allow listed origins
        if (allowedOrigins.includes(origin)) {

            console.log("✅ CORS allowed:", origin)

            return cb(null, true)
        }

        console.error("❌ CORS blocked:", origin)

        return cb(new Error("Not allowed by CORS"), false)
    },

    credentials: true,
})

// =========================================================
// COOKIE
// =========================================================

fastify.register(require("@fastify/cookie"))

// =========================================================
// JWT
// =========================================================

fastify.register(require("@fastify/jwt"), {

    secret: process.env.JWT_SECRET,

    cookie: {
        cookieName: "zenvoy_token",
        signed: false,
    },
})

// =========================================================
// REQUEST LOGGING
// =========================================================

fastify.addHook("onRequest", async (req) => {

    fastify.log.info({
        method: req.method,
        url: req.url,
        origin: req.headers.origin,
    }, "Incoming request")
})

// =========================================================
// RESPONSE LOGGING
// =========================================================

fastify.addHook("onResponse", async (req, reply) => {

    fastify.log.info({
        statusCode: reply.statusCode,
        url: req.url,
    }, "Response sent")
})

// =========================================================
// GLOBAL ERROR HANDLER
// =========================================================

fastify.setErrorHandler((error, req, reply) => {

    fastify.log.error(error)

    reply.status(error.statusCode || 500).send({
        success: false,
        message:
            process.env.NODE_ENV === "production"
                ? "Internal Server Error"
                : error.message,
    })
})

// =========================================================
// ROUTES
// =========================================================

fastify.register(require("./routes/auth"))

fastify.register(require("./routes/pdf"))

// =========================================================
// ROOT ROUTE
// =========================================================

fastify.get("/", async () => {

    return {
        success: true,
        message: "Zenvoy Backend Running 🚀",
    }
})

// =========================================================
// HEALTH CHECK
// =========================================================

fastify.get("/health", async () => {

    return {
        success: true,

        status: "ok",

        service: "Zenvoy API",

        uptime: process.uptime(),

        timestamp: new Date().toISOString(),
    }
})

// =========================================================
// KEEP-ALIVE OPTIMIZATION
// =========================================================

// Helps Render wake slightly faster
fastify.server.keepAliveTimeout = 65000
fastify.server.headersTimeout = 66000

// =========================================================
// START SERVER
// =========================================================

const start = async () => {

    try {

        const PORT = process.env.PORT || 4000

        await fastify.listen({
            port: PORT,
            host: "0.0.0.0",
        })

        console.log(`🚀 Backend running on port ${PORT}`)

        console.log("✅ Production server started successfully")

    } catch (err) {

        fastify.log.error(err)

        process.exit(1)
    }
}

start()