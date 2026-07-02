require("dotenv").config();
const axios = require("axios");
const { Log } = require("../logging-middleware/logger");

// Priority weights configuration (Placement > Result > Event)
const PRIORITY_WEIGHTS = {
    "PLACEMENT": 3,
    "RESULT": 2,
    "EVENT": 1
};

// Helper function to calculate a numeric priority value or compare notifications
function getWeight(type) {
    return PRIORITY_WEIGHTS[(type || "").toUpperCase()] || 0;
}

// Compare two notifications: returns negative if a has higher priority than b
function compareNotifications(a, b) {
    const weightA = getWeight(a.Type);
    const weightB = getWeight(b.Type);
    
    if (weightA !== weightB) {
        return weightB - weightA; // Higher weight first
    }
    
    // If weights are equal, sort by recency (newest timestamp first)
    return new Date(b.Timestamp) - new Date(a.Timestamp);
}

/**
 * Min-Heap implementation to efficiently maintain the top N notifications.
 * The heap stores the "least prioritised" elements of the top N at the root.
 * This makes it O(log N) to insert new stream items.
 */
class MinHeap {
    constructor(limit = 10) {
        this.heap = [];
        this.limit = limit;
    }

    getParentIndex(i) { return Math.floor((i - 1) / 2); }
    getLeftChildIndex(i) { return 2 * i + 1; }
    getRightChildIndex(i) { return 2 * i + 2; }

    swap(i, j) {
        const temp = this.heap[i];
        this.heap[i] = this.heap[j];
        this.heap[j] = temp;
    }

    // Min priority is at the top. So parent should have lower priority (higher comparison value) than child.
    // In our case, higher comparison value means lower priority.
    insert(item) {
        if (this.heap.length < this.limit) {
            this.heap.push(item);
            this.heapUp(this.heap.length - 1);
        } else if (compareNotifications(item, this.heap[0]) < 0) {
            // If item has higher priority than the lowest-priority item in the top N, replace it
            this.heap[0] = item;
            this.heapDown(0);
        }
    }

    heapUp(index) {
        let parentIdx = this.getParentIndex(index);
        // Swap if current has higher priority (smaller compareNotifications value) than parent
        while (index > 0 && compareNotifications(this.heap[index], this.heap[parentIdx]) > 0) {
            this.swap(index, parentIdx);
            index = parentIdx;
            parentIdx = this.getParentIndex(index);
        }
    }

    heapDown(index) {
        let extremeIndex = index;
        const leftIdx = this.getLeftChildIndex(index);
        const rightIdx = this.getRightChildIndex(index);
        const length = this.heap.length;

        // Find the child with the lowest priority (highest compareNotifications value)
        if (leftIdx < length && compareNotifications(this.heap[leftIdx], this.heap[extremeIndex]) < 0) {
            extremeIndex = leftIdx;
        }
        if (rightIdx < length && compareNotifications(this.heap[rightIdx], this.heap[extremeIndex]) < 0) {
            extremeIndex = rightIdx;
        }

        if (extremeIndex !== index) {
            this.swap(index, extremeIndex);
            this.heapDown(extremeIndex);
        }
    }

    getSortedResult() {
        // Return heap elements sorted in descending order of priority
        return [...this.heap].sort(compareNotifications);
    }
}

async function runPriorityInbox() {
    const API_URL = "http://4.224.186.213/evaluation-service/notifications";
    const token = process.env.ACCESS_TOKEN;

    await Log("backend", "info", "service", "Starting priority inbox processing");

    if (!token) {
        const errMsg = "Access token is missing in .env";
        await Log("backend", "error", "service", errMsg);
        console.error(errMsg);
        process.exit(1);
    }

    try {
        console.log("Fetching notifications from protected API...");
        const response = await axios.get(API_URL, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const notifications = response.data.notifications;
        if (!notifications || !Array.isArray(notifications)) {
            throw new Error("Invalid API response structure");
        }

        console.log(`Successfully fetched ${notifications.length} notifications.`);
        await Log("backend", "info", "service", `Fetched ${notifications.length} notifications successfully`);

        // Use the Min-Heap to extract the top 10 notifications efficiently
        const topNHeap = new MinHeap(10);
        
        console.log("Streaming notifications through the priority engine...");
        notifications.forEach(notification => {
            topNHeap.insert(notification);
        });

        const top10 = topNHeap.getSortedResult();

        console.log("\n==========================================");
        console.log("      TOP 10 PRIORITY NOTIFICATIONS       ");
        console.log("==========================================");
        top10.forEach((n, idx) => {
            console.log(`${idx + 1}. [${n.Type}] - ${n.Timestamp}`);
            console.log(`   ID:      ${n.ID}`);
            console.log(`   Message: ${n.Message}`);
            console.log("------------------------------------------");
        });

        await Log("backend", "info", "service", "Successfully processed and rendered top 10 priority notifications");

    } catch (err) {
        const errorMsg = err.response?.data?.message || err.message;
        await Log("backend", "error", "service", `Priority Inbox Error: ${errorMsg}`);
        console.error("Error executing priority inbox:", errorMsg);
    }
}

runPriorityInbox();
