const axios = require("axios");

async function Log(stack, level, packageName, message) {
    // Output to console locally for real-time visibility
    console.log(`[${new Date().toISOString()}] [${stack}] [${level.toUpperCase()}] [${packageName}] ${message}`);

    const token = process.env.ACCESS_TOKEN;
    if (!token) {
        console.warn("WARNING: ACCESS_TOKEN not found in environment variables (.env). Remote logging skipped.");
        return;
    }

    // The remote log server enforces a strict constraint: message must be at most 48 characters.
    const apiMessage = message.length > 48 ? message.substring(0, 45) + "..." : message;

    try {
        await axios.post(
            process.env.LOG_API || "http://4.224.186.213/evaluation-service/logs",
            {
                stack,
                level,
                package: packageName,
                message: apiMessage
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                }
            }
        );
    } catch (err) {
        console.error("Failed to send log to remote service:", err.response?.data?.message || err.message);
    }
}

module.exports = { Log };
