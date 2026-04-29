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

// Create users table if not exists
const initDB = async () => {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      plan VARCHAR(20) DEFAULT 'free',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
    console.log("✅ Users table ready")
}

initDB()

module.exports = pool