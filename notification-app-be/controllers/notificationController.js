const axios = require("axios");

exports.getAllNotifications = async (req, res) => {
    const { page, limit, notification_type } = req.query;
    const token = process.env.ACCESS_TOKEN;
    const remoteUrl = "http://4.224.186.213/evaluation-service/notifications";

    try {
        const response = await axios.get(remoteUrl, {
            params: { page, limit, notification_type },
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        res.status(200).json(response.data);
    } catch (err) {
        console.error("Backend proxy notifications fetch failed:", err.response?.data || err.message);
        res.status(err.response?.status || 500).json({
            message: "Failed to fetch notifications from remote server",
            error: err.response?.data?.message || err.message
        });
    }
};
