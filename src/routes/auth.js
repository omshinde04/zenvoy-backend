// src/routes/auth.js

const pool = require("../config/db")
const bcrypt = require("bcrypt")

async function authRoutes(fastify) {

    // =========================================================
    // REGISTER
    // =========================================================

    fastify.post("/api/auth/register", async (request, reply) => {

        try {

            const { name, email, password } = request.body

            // -------------------------------------------------
            // Validation
            // -------------------------------------------------

            if (!name || !email || !password) {
                return reply.status(400).send({
                    success: false,
                    message: "All fields are required",
                })
            }

            if (password.length < 8) {
                return reply.status(400).send({
                    success: false,
                    message: "Password must be at least 8 characters",
                })
            }

            // -------------------------------------------------
            // Check Existing User
            // -------------------------------------------------

            const existingUser = await pool.query(
                "SELECT id FROM users WHERE email = $1",
                [email.toLowerCase()]
            )

            if (existingUser.rows.length > 0) {
                return reply.status(409).send({
                    success: false,
                    message: "Email already exists",
                })
            }

            // -------------------------------------------------
            // Hash Password
            // -------------------------------------------------

            const hashedPassword = await bcrypt.hash(password, 12)

            // -------------------------------------------------
            // Create User
            // -------------------------------------------------

            await pool.query(
                `
                INSERT INTO users (name, email, password)
                VALUES ($1, $2, $3)
                `,
                [
                    name,
                    email.toLowerCase(),
                    hashedPassword
                ]
            )

            // -------------------------------------------------
            // Response
            // -------------------------------------------------

            return reply.status(201).send({
                success: true,
                message: "Account created successfully. Please login.",
            })

        } catch (error) {

            console.error("REGISTER ERROR:", error)

            return reply.status(500).send({
                success: false,
                message: "Internal server error",
            })
        }
    })

    // =========================================================
    // LOGIN
    // =========================================================

    fastify.post("/api/auth/login", async (request, reply) => {

        try {

            const { email, password } = request.body

            // -------------------------------------------------
            // Validation
            // -------------------------------------------------

            if (!email || !password) {
                return reply.status(400).send({
                    success: false,
                    message: "Email and password are required",
                })
            }

            // -------------------------------------------------
            // Find User
            // -------------------------------------------------

            const result = await pool.query(
                "SELECT * FROM users WHERE email = $1",
                [email.toLowerCase()]
            )

            if (result.rows.length === 0) {
                return reply.status(401).send({
                    success: false,
                    message: "Invalid credentials",
                })
            }

            const user = result.rows[0]

            // -------------------------------------------------
            // Compare Password
            // -------------------------------------------------

            const validPassword = await bcrypt.compare(
                password,
                user.password
            )

            if (!validPassword) {
                return reply.status(401).send({
                    success: false,
                    message: "Invalid credentials",
                })
            }

            // -------------------------------------------------
            // Generate JWT
            // -------------------------------------------------

            const token = fastify.jwt.sign(
                {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    plan: user.plan,
                },
                {
                    expiresIn: "7d",
                }
            )

            // -------------------------------------------------
            // Set Cookie
            // -------------------------------------------------

            reply.setCookie("zenvoy_token", token, {

                httpOnly: true,

                secure:
                    process.env.NODE_ENV === "production",

                sameSite:
                    process.env.NODE_ENV === "production"
                        ? "none"
                        : "lax",

                path: "/",

                maxAge: 60 * 60 * 24 * 7,
            })

            // -------------------------------------------------
            // Response
            // -------------------------------------------------

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

        } catch (error) {

            console.error("LOGIN ERROR:", error)

            return reply.status(500).send({
                success: false,
                message: "Internal server error",
            })
        }
    })

    // =========================================================
    // LOGOUT
    // =========================================================

    fastify.post("/api/auth/logout", async (request, reply) => {

        reply.clearCookie("zenvoy_token", {
            path: "/",
        })

        return reply.send({
            success: true,
            message: "Logged out successfully",
        })
    })

    // =========================================================
    // CURRENT USER
    // =========================================================

    fastify.get("/api/auth/me", async (request, reply) => {

        try {

            const token = request.cookies.zenvoy_token

            if (!token) {
                return reply.status(401).send({
                    success: false,
                    message: "Unauthorized",
                })
            }

            const decoded = fastify.jwt.verify(token)

            return reply.send({
                success: true,
                user: decoded,
            })

        } catch (error) {

            return reply.status(401).send({
                success: false,
                message: "Invalid or expired token",
            })
        }
    })
}

module.exports = authRoutes