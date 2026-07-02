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