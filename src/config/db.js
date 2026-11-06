// src/db.js

const { Pool } = require("pg")
require("dotenv").config()

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false,
})

// Test connection on startup
pool.connect((err, client, release) => {
    if (err) {
        console.error("❌ Database connection failed:", err.message)
        return
    }
    console.log("✅ PostgreSQL connected successfully")
    release()
})

// Create users and resumes tables if not exist
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(150) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                plan VARCHAR(20) DEFAULT 'free',
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS resumes (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                template_id VARCHAR(50) DEFAULT 'tech-minimal',
                data JSONB NOT NULL,
                updated_at TIMESTAMP DEFAULT NOW(),
                created_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT unique_user_resume UNIQUE (user_id)
            );
        `)
        console.log("✅ Database tables (users, resumes) ready")
    } catch (err) {
        console.error("❌ Database init error:", err.message)
    }
}

initDB()

module.exports = pool