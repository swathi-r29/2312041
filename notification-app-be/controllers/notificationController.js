exports.getAllNotifications = (req, res) => {

    const notifications = [
        {
            id: 1,
            title: "Assignment Due",
            message: "Submit before 6 PM",
            read: false
        },
        {
            id: 2,
            title: "Placement Drive",
            message: "Interview tomorrow",
            read: true
        }
    ];

    res.status(200).json({
        notifications
    });
};
