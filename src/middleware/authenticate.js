// src/middleware/authenticate.js

const authenticate = async (request, reply) => {
    try {
        await request.jwtVerify()
    } catch (err) {
        reply.status(401).send({
            success: false,
            message: "Unauthorized. Please login.",
        })
    }
}

module.exports = authenticate