# HaulBoX Real-Time Architecture

> Written 2026-09-06 following commit `e41893f` — egress fix and Socket.IO migration.

## Overview

HaulBoX uses a **Socket.IO event bus** for all real-time state propagation. There is **no frontend polling**. The server emits events whenever state changes; the frontend applies deltas without fetching from the server unless recovering from a disconnect.

---

## Server-Side: What Emits What

| Event | Trigger Location | Payload | Recipients |
|---|---|---|---|
| `state_update` | `lib/dataStore.js:saveFullState()` via `global.broadcastState()` | Full state (loads, drivers, brokers, etc.) | All sockets |
| `new_message` | `routes/chat.js` POST messages | `{id, body, sender, conversationId, createdAt}` | `conv_<id>` room |
| `conversation_updated` | `routes/chat.js` metadata changes | none | `conv_<id>` room |
| `user_typing` | `routes/chat.js` POST typing | `{conversationId, user, isTyping}` | `conv_<id>` room |
| `messages_read` | `routes/chat.js` POST read | `{conversationId, reader}` | `conv_<id>` room |
| `daily_note:saved` | `routes/dailyNotes.js` POST | none | All sockets |
| `document:uploaded/approved/rejected` | `routes/notifications.js` | `{loadId, docKey, driverName, ...}` | All sockets |
| `driver_location_update` | `lib/trackingService.js` | `{driverId, lat, lng, speed}` | All sockets |
| `presence_change` | `server.js` authenticate/disconnect | `{user, isOnline}` | All sockets |

---

## Frontend: What Listens to What (app.js — initSocketIO)

| Event | Handler | Views Updated |
|---|---|---|
| `state_update` | Direct STATE merge | LoadBoard, Dashboard, DocReview, DocsList |
| `new_message` | `handleIncomingSocketMessage(msg)` | Chat panel, unread badge |
| `conversation_updated` | `fetchChatConvs()` | Chat sidebar, badge |
| `daily_note:saved` | `renderDailyDriverReports()` | Daily notes panel |
| `document:*` | `pushNotification()` | Bell notification count |
| `driver_location_update` | Leaflet map update | Live tracking map |
| `user_typing` | `handleSocketTyping(data)` | Typing indicator |
| `messages_read` | `handleSocketMessagesRead(data)` | Read tick on messages |
| `reconnect` | `refreshStateFromServer(true)` | Full state (safety net) |

### Fallback: window.focus

When a tab regains focus, `refreshStateFromServer(true)` fires as a safety net. This costs 0 DB reads if the server-side 15s cache is still warm.

---

## Cache Architecture

### lib/kvstore.js — haulline:state Cache

| Property | Value |
|---|---|
| Cache type | Node.js Map (in-process) |
| Cached keys | haulline:state ONLY |
| Max entries | 1 (structurally bounded) |
| TTL | 15,000ms (15 seconds) |
| On write | Cache updated immediately after DB write |
| On delete | Cache entry cleared |

**Rationale:** Reduces kv_store SELECT calls by ~99%. A 15s TTL means any missed socket event is corrected within 15s via focus-refresh without hammering the DB.

---

## KNOWN LIMITATION: Single-Instance Only

The kvCache Map is process-local. Under a load balancer with 2+ Node.js instances, one instance will not be invalidated when another writes a new value — it may serve stale data for up to 15 seconds.

**Current risk:** Zero. HaulBoX runs as a single dyno.

**Migration path when needed:**
1. Add Redis (Upstash free tier works)
2. Replace kvCache Map with a Redis client
3. get: redis.get(key) then parse
4. set: redis.setex(key, CACHE_TTL_MS / 1000, value)
5. del: redis.del(key)
The CACHE_TTL_MS constant controls the Redis TTL with no other code changes needed.

---

## DO NOT Reintroduce Polling

The setInterval-based polling previously caused 20,568 kv_store reads in a single monitoring window and exhausted the Supabase free-tier egress quota (2 GB/month limit).

To add new real-time functionality:
1. Add socket.emit(...) in the relevant route handler
2. Add appSocket.on(...) in initSocketIO() in app.js
3. Do NOT use setInterval for anything that reads from Supabase
