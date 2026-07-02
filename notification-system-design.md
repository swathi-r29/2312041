# Notification System Design

## Stage 1

### Overview

The platform needs endpoints that let a logged-in student view notifications (Placements, Events, Results), filter and paginate them, mark them read, and get realtime updates without polling.

### Core actions identified

1. List notifications (with pagination and filtering by type/status)
2. Get a single notification
3. Mark one notification as read
4. Mark all notifications as read
5. Get unread count (for a badge)
6. Receive realtime push when a new notification arrives

### Common headers (all endpoints)

| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <access_token>` | Yes |
| `Content-Type` | `application/json` | For requests with a body |
| `Accept` | `application/json` | Yes |

### Endpoints

#### 1. List notifications

`GET /api/v1/notifications`

Query parameters:

| Param | Type | Description |
|---|---|---|
| `page` | integer | Default 1 |
| `limit` | integer | Default 20, max 100 |
| `status` | `read` \| `unread` | Optional filter |
| `type` | `PLACEMENT` \| `RESULT` \| `EVENT` | Optional filter |

Response `200 OK`:

```json
{
  "data": [
    {
      "id": "a1b2c3d4-0000-0000-0000-000000000001",
      "type": "PLACEMENT",
      "title": "Placement Update",
      "message": "TCS Corporation hiring drive results out",
      "isRead": false,
      "createdAt": "2026-04-22T17:54:10Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "totalItems": 143,
    "totalPages": 8
  }
}
```

#### 2. Get single notification

`GET /api/v1/notifications/:id`

Response `200 OK`:

```json
{
  "data": {
    "id": "a1b2c3d4-0000-0000-0000-000000000001",
    "type": "PLACEMENT",
    "title": "Placement Update",
    "message": "TCS Corporation hiring drive results out",
    "isRead": false,
    "createdAt": "2026-04-22T17:54:10Z"
  }
}
```

Response `404 Not Found`:

```json
{
  "error": {
    "code": "NOTIFICATION_NOT_FOUND",
    "message": "No notification exists with the given id"
  }
}
```

#### 3. Mark one notification as read

`PATCH /api/v1/notifications/:id/read`

Request body: none required.

Response `200 OK`:

```json
{
  "data": {
    "id": "a1b2c3d4-0000-0000-0000-000000000001",
    "isRead": true,
    "readAt": "2026-04-22T18:02:31Z"
  }
}
```

#### 4. Mark all notifications as read

`PATCH /api/v1/notifications/read-all`

Response `200 OK`:

```json
{
  "data": {
    "updatedCount": 12
  }
}
```

#### 5. Get unread count

`GET /api/v1/notifications/unread-count`

Response `200 OK`:

```json
{
  "data": {
    "unreadCount": 12
  }
}
```

### Realtime notification mechanism

**Choice: WebSocket (Socket.IO) over a `/ws/notifications` channel, scoped per authenticated student.**

Reasoning:

- Polling on every page load (the anti-pattern Stage 4 asks you to fix later) hits the DB constantly for data that changes rarely per student. A push model removes that load.
- Server-Sent Events (SSE) was considered. SSE is simpler and works over plain HTTP, but it is one-directional and has weaker built-in reconnection and multiplexing support across multiple browser tabs than Socket.IO offers out of the box.
- WebSocket lets the server push a new notification the instant it's created, and lets the client send lightweight acks (for example, "I've rendered this") on the same connection if needed later.

Flow:

1. Client authenticates and opens a WebSocket connection, passing the Bearer token during the handshake.
2. Server maps `studentId` to the socket connection (a socket registry, similar in spirit to a `userSocketMap`).
3. When a new notification is created for a student, the server emits a `notification:new` event with the notification payload to that student's socket.
4. Client appends the notification to local state and increments the unread badge, without a fetch call.
5. On reconnect (network drop, tab refocus), the client calls `GET /api/v1/notifications?status=unread` once to reconcile, in case any push was missed while disconnected.

```json
// Event: notification:new
{
  "event": "notification:new",
  "data": {
    "id": "a1b2c3d4-0000-0000-0000-000000000002",
    "type": "RESULT",
    "title": "Result Declared",
    "message": "Mid-sem result declared",
    "isRead": false,
    "createdAt": "2026-04-22T17:50:58Z"
  }
}
```

## Stage 3

### 1. Query Accuracy Analysis
The original query is:
```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt ASC;
```

This query contains several significant **inaccuracies and errors** relative to the MySQL schema defined in [schema.sql](file:///d:/assessment/Campus-Evaluation-FS/notification-app-be/schema.sql):
*   **Column Case Mismatch (`studentID` vs `studentId`):** In [schema.sql](file:///d:/assessment/Campus-Evaluation-FS/notification-app-be/schema.sql#L12), the column is defined as `studentId` (camelCase with a lowercase `d`). The query uses `studentID` (uppercase `ID`). Depending on database configuration and operating system environment, this capitalization discrepancy may result in database errors (especially on Linux environments where table/column casing rules can be strictly enforced).
*   **Implicit Type Coercion (`studentId = 1042`):** The `studentId` column is defined as `CHAR(36)` (storing UUID strings), while the query filters using an integer value (`1042`). Comparing a string field to an integer forces MySQL to perform implicit type conversion.
*   **Logical Ordering Preference:** The query specifies `ORDER BY createdAt ASC` (oldest notifications first). Typically, user-facing notification feeds display the most recent items first, making `ORDER BY createdAt DESC` the correct logical ordering.

---

### 2. Performance Analysis: Why is the Query Slow?
As the database scales to **50,000 students and 5,000,000 notifications**, this query will experience severe performance degradation due to:
1.  **Implicit Type Conversion Disables Index Lookups:** When comparing a `CHAR(36)` column to an integer (`1042`), MySQL cannot directly compare the types. It resolves this by casting the string values of the column in every row to a number. Consequently, any index defined on the `studentId` column (including the composite index `idx_notifications_student_unread`) is completely bypassed.
2.  **Full Table Scan on 5 Million Rows:** Because the index is disabled by type coercion, MySQL is forced to execute a full table scan. It must read and parse all 5,000,000 records from disk/memory and perform the string-to-number cast for each row.
3.  **Expensive Filesort Operations:** Since no index is used to fetch the rows in their sorted order, MySQL must perform an $O(M \log M)$ `filesort` (where $M$ is the number of matching records) using temporary disk space or memory to satisfy the `ORDER BY` clause.
4.  **I/O Overhead from `SELECT *`:** Using `SELECT *` fetches all columns, including `message` (which is `TEXT`). In InnoDB, text fields are stored "off-page". Fetching these off-page values requires additional disk read operations, compounding the slow scan.
5.  **Lack of Pagination Limits:** The query retrieves all matching records at once without `LIMIT` or `OFFSET`. A student with many unread notifications will cause large payload transfers, high memory consumption, and network latency.

---

### 3. Proposed Modifications and Computational Cost
To optimize the query, the following structural changes are required:
1.  **Eliminate Type Coercion:** Pass the student ID as a string UUID matching the schema.
2.  **Correct Column Casing:** Change `studentID` to `studentId`.
3.  **Leverage Composite Index:** Query columns in a way that matches the defined composite index `idx_notifications_student_unread` (`studentId`, `isRead`, `createdAt DESC`).
4.  **Avoid `SELECT *`:** Retrieve only necessary fields, leaving the heavy `TEXT` fields out of the list query.
5.  **Implement Pagination:** Restrict output size using `LIMIT` and `OFFSET`.

#### Optimized Query:
```sql
SELECT id, notificationType, title, isRead, createdAt
FROM notifications
WHERE studentId = '11111111-1111-1111-1111-111111111111' 
  AND isRead = FALSE
ORDER BY createdAt DESC
LIMIT 20 OFFSET 0;
```

#### Computational Cost Comparison:
*   **Slow Query (Original):**
    *   **Time Complexity:** $O(N)$ where $N = 5,000,000$ (Full Table Scan).
    *   **Sorting Complexity:** $O(M \log M)$ filesort.
    *   **Execution Time:** Several seconds to minutes under concurrency.
*   **Optimized Query:**
    *   **Time Complexity:** $O(\log N + K)$ where $K$ is the page limit (e.g., 20).
    *   **Sorting Complexity:** $O(1)$ extra overhead (uses the pre-sorted composite index structure).
    *   **Execution Time:** $\le 1$ to 5 milliseconds.

---

### 4. Evaluation of Indexing Every Column
Adding indexes to every column to "be safe" is **highly ineffective and dangerous** in production environments:
*   **Write Performance Penalty:** Every `INSERT`, `UPDATE`, or `DELETE` requires updating the primary table and all associated indexes. With millions of notifications, write operations would become highly bottlenecked.
*   **Memory Buffer Pool Exhaustion:** Indexes must reside in memory (InnoDB Buffer Pool) to be fast. Indexing all columns will result in huge index sizes that exceed RAM capacity, causing MySQL to swap pages to disk, slowing down all queries.
*   **Inefficacy of Low-Cardinality Indexes:** Indexing fields like `isRead` (boolean) or `notificationType` (enum) is useless. The database optimizer will reject single-column indexes on low-cardinality fields because scanning the index is more expensive than scanning the table directly.
*   **Composite Index Superiority:** Standard queries filter on multiple columns (e.g. `studentId` AND `isRead`). MySQL usually uses only one index per query execution. Multiple single-column indexes are bypassed in favor of a single composite index, which filters and sorts simultaneously.

---

### 5. Last 7 Days Placement Notification Query
To retrieve all students who received a placement notification within the last 7 days, we use the following query.

#### Student Details Query (Recommended for Application Integration):
```sql
SELECT DISTINCT s.id, s.name, s.email, s.rollNo
FROM students s
JOIN notifications n ON s.id = n.studentId
WHERE n.notificationType = 'PLACEMENT'
  AND n.createdAt >= NOW() - INTERVAL 7 DAY;
```

#### Unique IDs Query (Lightweight alternative):
```sql
SELECT DISTINCT studentId
FROM notifications
WHERE notificationType = 'PLACEMENT'
  AND createdAt >= NOW() - INTERVAL 7 DAY;
```

#### Brutally Honest Observation & Missing Requirements:
*   **Enum Case Mismatch:** The prompt specifies that `notification_type` accepts values `"Event"`, `"Result"`, and `"Placement"` (PascalCase). However, the actual database schema in [schema.sql](file:///d:/assessment/Campus-Evaluation-FS/notification-app-be/schema.sql#L13) defines the values in uppercase: `'PLACEMENT'`, `'RESULT'`, `'EVENT'`. The query above uses `'PLACEMENT'` to align with the implemented schema. If the application logic relies on PascalCase, the query would fail unless the database collation is case-insensitive or the schema enum definition is modified.

---
---

## Stage 4

### 1. The Problem
Fetching the entire notification list and unread counts from the database on every page load for every student creates an immense query load. As the student base grows to 50,000+ and notifications to millions, this read-heavy traffic will saturate the database pool, leading to thread exhaustion, CPU spikes, database locking, and an overall sluggish user experience.

---

### 2. Proposed Strategies to Improve Performance

To resolve this issue, we can apply three main optimization strategies. Below is a detailed elaboration of each strategy along with their respective tradeoffs:

#### Strategy A: Memory Caching Layer (e.g., Redis / Memcached)
*   **Concept:** Store each student's unread notification counts and latest notification page in an in-memory cache (like Redis). When a student loads a page, the backend retrieves data from Redis in $O(1)$ time, bypassing the database entirely.
*   **Tradeoffs:**
    *   *Pros:*
        *   **Extremely Low Latency:** Sub-millisecond response times.
        *   **Database Offloading:** Eliminates up to 90%+ of read queries on the SQL database.
        *   **High Concurrency:** Redis can easily handle hundreds of thousands of operations per second.
    *   *Cons:*
        *   **Cache Invalidation Overhead:** Whenever a notification is marked read, deleted, or a new notification is added, the cache must be updated or invalidated synchronously or via events to prevent stale views.
        *   **Resource & Infrastructure Cost:** Requires maintaining and running a Redis cluster.
        *   **Memory Footprint:** 50,000 students' data must fit in RAM.

#### Strategy B: Real-Time Event-Driven Architecture (WebSocket Sync + Local State)
*   **Concept:** Rely on the WebSocket (`Socket.IO`) connection established in Stage 1. The client fetches the notification list only once when logging in or opening a tab. Any subsequent notification is pushed in real-time to the client. The client updates its local state (React state or IndexedDB) dynamically without calling the database.
*   **Tradeoffs:**
    *   *Pros:*
        *   **Zero Read Traffic on Page Navigation:** Reads only happen once per session instead of every page navigation.
        *   **Instant Updates:** Users get notified immediately.
    *   *Cons:*
        *   **Complex State Reconciliation:** If the user drops connection (e.g., tunnel/mobile network switch), the client must execute a handshake query on reconnect to fetch missed notifications.
        *   **State Sync Edge Cases:** High frontend state management complexity to keep unread badges and local lists in perfect synchronization with the server database.

#### Strategy C: Conditional HTTP Caching (ETags & Last-Modified Headers)
*   **Concept:** Use standard HTTP headers. When returning the notification list, the server attaches an `ETag` (e.g., a hash of the student's notification state or a timestamp of their last update). On subsequent page loads, the frontend sends an `If-None-Match` header. If nothing has changed, the server returns a lightweight `304 Not Modified` status.
*   **Tradeoffs:**
    *   *Pros:*
        *   **Saves Network Bandwidth:** Avoids transferring identical JSON payloads over the network.
        *   **Standardized Browser Behavior:** Utilizes built-in browser caching capabilities.
    *   *Cons:*
        *   **Doesn't Fully Offload DB/Server:** The server must still receive the request, authenticate the user, and check if the state has changed (which might require a fast DB query or a cache lookup to compute the ETag).

---

### 3. Recommended Approach
A hybrid solution combining **Strategy A (Redis cache for unread counts and latest feed)** and **Strategy B (WebSocket push to avoid polling)** is the industry standard. This ensures the database is queried only on initial login, while subsequent updates are pushed in real-time, and any fallback reads hit a fast in-memory cache rather than the SQL database.

---
---

## Stage 5

### 1. Shortcomings of the Current Implementation
The provided sequential loop implementation is a critical anti-pattern for large-scale operations (50,000 students):
```python
function notify_all(student_ids: array, message: string):
    for student_id in student_ids:
        send_email(student_id, message) # calls Email API
        save_to_db(student_id, message) # DB insert
        push_to_app(student_id, message) # WebSocket push
```

#### Major Flaws:
1.  **Blocking Synchronous Execution ($O(N)$ HTTP Calls):**
    Calling a third-party `send_email` API (which takes $\approx 100\text{--}300\text{ ms}$ per call) sequentially inside a loop for 50,000 students will block the server execution.
    $$\text{Total Time} \approx 50,000 \times 200\text{ ms} = 10,000\text{ seconds} \approx 2.77\text{ hours}$$
    The server will time out, experience memory leaks, or crash long before the loop completes.
2.  **No Error Handling & Cascade Failures:**
    If the email API throws an error (e.g. rate limit exceeded, network drop) on the 200th student, the function crashes. The remaining 49,800 students will never receive their notifications.
3.  **Lack of State Tracking and Recovery (The "Failed for 200" Scenario):**
    If the script fails midway, there is no built-in record indicating which students succeeded and which failed. To fix the 200 failed sends, administrators must manually reconcile email logs against the database, which is error-prone. Retrying the whole function is impossible because it would re-send duplicate emails to the 49,800 students who already received them.
4.  **No Rate-Limiting Compliance:**
    Triggering 50,000 consecutive outbound HTTP calls as fast as possible will trigger rate limits (429 Too Many Requests) on the email service provider (e.g., SendGrid, AWS SES) and socket server, causing bulk delivery failures.

---

### 2. Transactional & Coupling Analysis
**Should the process of saving to DB as well as sending the email happen together?**
*   **No, they should NOT happen together synchronously.**
*   **Reasoning:**
    *   **Loose Coupling:** Database writes and email dispatches have vastly different latencies and reliability profiles. Saving to the DB is local, highly reliable, and takes $\approx 1\text{ ms}$. Sending an email is remote, slow, prone to network issues, and depends on external vendor availability.
    *   **Resiliency:** If the email API is down, the system should still successfully write the notification to the database. The student can then see it immediately in-app. Tying them together in a single synchronous process means an email failure blocks database persistence.
    *   **Decoupled Architecture:** The database record should serve as the source of truth. Email, SMS, and Push notifications should be treated as secondary, asynchronous delivery channels that consume the database state.

---

### 3. Redesigned System Architecture (Fast & Reliable)
To scale this system safely to 50,000+ users:
1.  **Asynchronous Message Queue / Job Broker:** Enqueue tasks to a background queue system (e.g., Redis-backed BullMQ, RabbitMQ, or Celery) and return an immediate `202 Accepted` response to the client.
2.  **Batch Database Insertion:** Instead of running 50,000 individual `INSERT` queries (which overwhelms database connection pools), execute bulk inserts in chunks (e.g., 1,000 records at a time).
3.  **Idempotency & Status Tracking:** Save each notification with a status (e.g., `email_status = 'PENDING'`). Before sending, verify if the status is already `'SENT'` to prevent duplicate deliveries on worker retries.
4.  **Exponential Backoff and Retries:** Automatically retry failed email dispatches with backoff intervals. Move persistent failures to a **Dead Letter Queue (DLQ)** for inspection rather than crashing the loop.

---

### 4. Revised Pseudocode

#### Producer (API Endpoint Handler - Runs on Web Server)
```python
function notify_all_api_endpoint(student_ids: array, message: string):
    # 1. Create a parent bulk job record to track progress
    job_id = db.insert("INSERT INTO bulk_jobs (message, total_count, status) VALUES (?, ?, 'PROCESSING')", message, len(student_ids))
    
    # 2. Bulk insert notification records into DB in chunks to avoid overwhelming the database connection pool
    CHUNK_SIZE = 1000
    for chunk in partition(student_ids, CHUNK_SIZE):
        db.bulk_insert(
            "INSERT INTO notifications (id, studentId, notificationType, title, message, isRead, email_status) VALUES ...",
            [ (generate_uuid(), s_id, 'PLACEMENT', 'Placement Drive', message, FALSE, 'PENDING') for s_id in chunk ]
        )
    
    # 3. Enqueue lightweight task payloads into the asynchronous message queue
    for student_id in student_ids:
        message_queue.enqueue("send_notification_task", {
            "student_id": student_id,
            "message": message,
            "job_id": job_id,
            "retry_count": 0
        })
        
    # 4. Instantly return response to HR UI
    return {
        "status": "Accepted",
        "job_id": job_id,
        "message": "Notification dispatch started asynchronously."
    }
```

#### Consumer (Background Worker - Runs on Independent Worker Nodes)
```python
function process_send_notification_task(task):
    student_id = task.student_id
    message = task.message
    job_id = task.job_id
    
    # Idempotency check: Ensure email hasn't been sent already
    notification = db.query_one("SELECT email_status FROM notifications WHERE studentId = ? AND message = ?", student_id, message)
    if not notification or notification.email_status == 'SENT':
        return # Skip processing to prevent duplicates
        
    email_success = false
    
    # 1. Try sending the email with rate-limit friendly error handling
    try:
        send_email(student_id, message)
        email_success = true
        db.execute("UPDATE notifications SET email_status = 'SENT' WHERE studentId = ? AND message = ?", student_id, message)
    except EmailAPIError as error:
        log_error("Email delivery failed for student", student_id, error)
        if task.retry_count < MAX_RETRIES:
            # Enqueue retry with exponential backoff delay (e.g. 2^retry_count * 5 seconds)
            task.retry_count += 1
            message_queue.enqueue_with_delay("send_notification_task", task, delay=exponential_backoff(task.retry_count))
        else:
            db.execute("UPDATE notifications SET email_status = 'FAILED' WHERE studentId = ? AND message = ?", student_id, message)
            dead_letter_queue.enqueue("failed_emails", { "student_id": student_id, "job_id": job_id, "error": str(error) })
            
    # 2. Try pushing in-app notification (real-time push)
    # The socket failure is non-blocking; failure is logged but doesn't roll back database state
    if email_success:
        try:
            push_to_app(student_id, message)
        except PushError as push_error:
            log_warning("In-app socket push failed for student", student_id, push_error)
```
