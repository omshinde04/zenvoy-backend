// src/routes/auth.js

const pool = require("../config/db")
const bcrypt = require("bcrypt")

async function authRoutes(fastify) {

    // ─── REGISTER ───────────────────────────────────────────
    fastify.post("/api/auth/register", async (request, reply) => {
        const { name, email, password } = request.body

        // Basic validation
        if (!name || !email || !password) {
            return reply.status(400).send({
                success: false,
                message: "Name, email and password are required",
            })
        }

        if (password.length < 8) {
            return reply.status(400).send({
                success: false,
                message: "Password must be at least 8 characters",
            })
        }

        try {
            // Check if email already exists
            const existing = await pool.query(
                "SELECT id FROM users WHERE email = $1",
                [email.toLowerCase()]
            )

            if (existing.rows.length > 0) {
                return reply.status(409).send({
                    success: false,
                    message: "Email already registered. Please login.",
                })
            }

            // Hash password
            const hashedPassword = await bcrypt.hash(password, 12)

            // Insert user
            const result = await pool.query(
                `INSERT INTO users (name, email, password)
         VALUES ($1, $2, $3)
         RETURNING id, name, email, plan, created_at`,
                [name, email.toLowerCase(), hashedPassword]
            )

            const user = result.rows[0]

            // Generate JWT token
            const token = fastify.jwt.sign(
                {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    plan: user.plan,
                },
                { expiresIn: "7d" }
            )

            // Set httpOnly cookie
            reply.setCookie("zenvoy_token", token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/",
                maxAge: 60 * 60 * 24 * 7, // 7 days
            })

            return reply.status(201).send({
                success: true,
                message: "Account created successfully",
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    plan: user.plan,
                },
            })

        } catch (err) {
            console.error("Register error:", err)
            return reply.status(500).send({
                success: false,
                message: "Something went wrong. Please try again.",
            })
        }
    })

    // ─── LOGIN ──────────────────────────────────────────────
    fastify.post("/api/auth/login", async (request, reply) => {
        const { email, password } = request.body

        if (!email || !password) {
            return reply.status(400).send({
                success: false,
                message: "Email and password are required",
            })
        }

        try {
            // Find user
            const result = await pool.query(
                "SELECT * FROM users WHERE email = $1",
                [email.toLowerCase()]
            )

            if (result.rows.length === 0) {
                return reply.status(401).send({
                    success: false,
                    message: "Invalid email or password",
                })
            }

            const user = result.rows[0]

            // Compare password
            const isValid = await bcrypt.compare(password, user.password)

            if (!isValid) {
                return reply.status(401).send({
                    success: false,
                    message: "Invalid email or password",
                })
            }

            // Generate JWT token
            const token = fastify.jwt.sign(
                {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    plan: user.plan,
                },
                { expiresIn: "7d" }
            )

            // Set httpOnly cookie
            reply.setCookie("zenvoy_token", token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/",
                maxAge: 60 * 60 * 24 * 7,
            })

            return reply.send({
                success: true,
                message: "Login successful",
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    plan: user.plan,
                },
            })

        } catch (err) {
            console.error("Login error:", err)
            return reply.status(500).send({
                success: false,
                message: "Something went wrong. Please try again.",
            })
        }
    })

    // ─── LOGOUT ─────────────────────────────────────────────
    fastify.post("/api/auth/logout", async (request, reply) => {
        reply.clearCookie("zenvoy_token", { path: "/" })
        return reply.send({
            success: true,
            message: "Logged out successfully",
        })
    })

    // ─── GET CURRENT USER ───────────────────────────────────
    fastify.get("/api/auth/me", async (request, reply) => {
        try {
            const token = request.cookies.zenvoy_token

            if (!token) {
                return reply.status(401).send({
                    success: false,
                    message: "Not authenticated",
                })
            }

            const decoded = fastify.jwt.verify(token)

            return reply.send({
                success: true,
                user: {
                    id: decoded.id,
                    name: decoded.name,
                    email: decoded.email,
                    plan: decoded.plan,
                },
            })

        } catch (err) {
            return reply.status(401).send({
                success: false,
                message: "Invalid or expired session",
            })
        }
    })
}

module.exports = authRoutes