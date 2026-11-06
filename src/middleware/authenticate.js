// src/middleware/authenticate.js

const authenticate = async (request, reply) => {
    try {
        const token =
            request.cookies?.zenvoy_token ||
            request.headers.authorization?.replace(/^Bearer\s+/i, "")

        if (!token) {
            return reply.status(401).send({
                success: false,
                message: "Unauthorized. Please login.",
            })
        }

        const decoded = request.server.jwt.verify(token)
        request.user = decoded
    } catch (err) {
        return reply.status(401).send({
            success: false,
            message: "Unauthorized. Please login.",
        })
    }
}

module.exports = authenticate
