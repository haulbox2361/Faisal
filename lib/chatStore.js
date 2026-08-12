// Backend-enforced internal messaging between drivers and the
// admin/dispatcher(s) an Admin has authorized them to contact. Participants
// are addressed as (type, id) — same scheme as notifications/google_tokens:
// ('admin','admin'), ('dispatcher', dispatcherId), ('driver', driver.id).
//
// Conversations are stored with participants in a canonical order so the
// same pair always resolves to the same row regardless of who initiated it.

const { getPool, ensureSchema } = require('./db');

function canonicalPair(a, b) {
  const key = (p) => `${p.type}:${p.id}`;
  return key(a) <= key(b) ? [a, b] : [b, a];
}

async function getOrCreateConversation(partyA, partyB) {
  await ensureSchema();
  const [a, b] = canonicalPair(partyA, partyB);
  const pool = getPool();

  const existing = await pool.query(
    `SELECT id FROM conversations
     WHERE participant_a_type=$1 AND participant_a_id=$2
       AND participant_b_type=$3 AND participant_b_id=$4`,
    [a.type, a.id, b.type, b.id]
  );
  if (existing.rows.length) return existing.rows[0].id;

  const { rows } = await pool.query(
    `INSERT INTO conversations (participant_a_type, participant_a_id, participant_b_type, participant_b_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (participant_a_type, participant_a_id, participant_b_type, participant_b_id) DO UPDATE
       SET participant_a_type = EXCLUDED.participant_a_type
     RETURNING id`,
    [a.type, a.id, b.type, b.id]
  );
  return rows[0].id;
}

// Creates a group conversation (e.g. Driver + Dispatcher + Admin/Owner).
// `members` is an array of {type, id, name}. Direct 1:1 chats keep using
// getOrCreateConversation above; this is only for 3+-party / named groups.
async function createGroupConversation(name, members) {
  await ensureSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO conversations (participant_a_type, participant_a_id, participant_b_type, participant_b_id, is_group, group_name)
     VALUES ('group', 'group', 'group', 'group', true, $1)
     RETURNING id`,
    [name || 'Group Chat']
  );
  const conversationId = rows[0].id;
  for (const m of members) {
    await pool.query(
      `INSERT INTO conversation_participants (conversation_id, participant_type, participant_id, participant_name)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [conversationId, m.type, m.id, m.name || null]
    );
  }
  return conversationId;
}

// Retrieves or creates the Driver Operations Group and ensures membership is exactly Admin, Assigned Dispatcher, and Driver.
async function getOrCreateOpsGroup(driverId, driverName, dispatcherId, dispatcherName) {
  await ensureSchema();
  const pool = getPool();
  const groupName = 'Operations Group - ' + driverId;
  
  const { rows } = await pool.query(
    `SELECT id FROM conversations WHERE is_group = true AND group_name = $1`,
    [groupName]
  );
  
  let conversationId;
  if (rows.length) {
    conversationId = rows[0].id;
  } else {
    const { rows: insertRows } = await pool.query(
      `INSERT INTO conversations (participant_a_type, participant_a_id, participant_b_type, participant_b_id, is_group, group_name)
       VALUES ('group', 'group', 'group', 'group', true, $1)
       RETURNING id`,
      [groupName]
    );
    conversationId = insertRows[0].id;
  }
  
  await pool.query(`DELETE FROM conversation_participants WHERE conversation_id = $1`, [conversationId]);
  
  const members = [
    { type: 'admin', id: 'admin', name: 'Admin' },
    { type: 'driver', id: driverId, name: driverName || 'Driver' }
  ];
  if (dispatcherId) {
    members.push({ type: 'dispatcher', id: dispatcherId, name: dispatcherName || 'Dispatcher' });
  }
  
  for (const m of members) {
    await pool.query(
      `INSERT INTO conversation_participants (conversation_id, participant_type, participant_id, participant_name)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [conversationId, m.type, m.id, m.name || null]
    );
  }
  
  return conversationId;
}

async function groupMembers(conversationId) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT participant_type, participant_id, participant_name FROM conversation_participants WHERE conversation_id=$1`,
    [conversationId]
  );
  return rows.map((r) => ({ type: r.participant_type, id: r.participant_id, name: r.participant_name }));
}

// The "other side" of a conversation, relative to `me` — used to render a
// chat list without the caller having to know the canonical ordering.
// Also includes any group conversations `me` belongs to.
async function listConversationsFor(me) {
  await ensureSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT c.id, c.participant_a_type, c.participant_a_id, c.participant_b_type, c.participant_b_id, c.is_group, c.group_name,
            (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
            (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_at,
            (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id AND NOT (m.sender_type=$1 AND m.sender_id=$2) AND m.read_at IS NULL) AS unread
     FROM conversations c
     WHERE (c.is_group = false AND ((participant_a_type=$1 AND participant_a_id=$2) OR (participant_b_type=$1 AND participant_b_id=$2)))
        OR (c.is_group = true AND EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id=c.id AND cp.participant_type=$1 AND cp.participant_id=$2))
     ORDER BY last_at DESC NULLS LAST`,
    [me.type, me.id]
  );
  const out = [];
  for (const r of rows) {
    if (r.is_group) {
      out.push({
        id: r.id,
        isGroup: true,
        groupName: r.group_name,
        members: await groupMembers(r.id),
        lastMessage: r.last_body,
        lastMessageAt: r.last_at,
        unreadCount: r.unread,
      });
    } else {
      const other = (r.participant_a_type === me.type && r.participant_a_id === me.id)
        ? { type: r.participant_b_type, id: r.participant_b_id }
        : { type: r.participant_a_type, id: r.participant_a_id };
      out.push({
        id: r.id,
        isGroup: false,
        with: other,
        lastMessage: r.last_body,
        lastMessageAt: r.last_at,
        unreadCount: r.unread,
      });
    }
  }
  return out;
}

// True only if `me` is actually a participant — every conversation-scoped
// route must call this before reading/writing messages.
async function isParticipant(conversationId, me) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT 1 FROM conversations c WHERE c.id=$1 AND (
       (c.is_group = false AND ((participant_a_type=$2 AND participant_a_id=$3) OR (participant_b_type=$2 AND participant_b_id=$3)))
       OR (c.is_group = true AND EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id=c.id AND cp.participant_type=$2 AND cp.participant_id=$3))
     )`,
    [conversationId, me.type, me.id]
  );
  return rows.length > 0;
}

async function listMessages(conversationId, { limit = 100 } = {}) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, sender_type, sender_id, sender_name, body, read_at, created_at
     FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC LIMIT $2`,
    [conversationId, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    senderType: r.sender_type,
    senderId: r.sender_id,
    senderName: r.sender_name,
    body: r.body,
    read: !!r.read_at,
    createdAt: r.created_at,
  }));
}

async function sendMessage(conversationId, sender, body) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `INSERT INTO messages (conversation_id, sender_type, sender_id, sender_name, body)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [conversationId, sender.type, sender.id, sender.name || null, body]
  );
  return { id: rows[0].id, createdAt: rows[0].created_at };
}

// Marks everything NOT sent by `me` as read (i.e. opening the thread).
async function markConversationRead(conversationId, me) {
  await ensureSchema();
  await getPool().query(
    `UPDATE messages SET read_at = now()
     WHERE conversation_id=$1 AND NOT (sender_type=$2 AND sender_id=$3) AND read_at IS NULL`,
    [conversationId, me.type, me.id]
  );
}

module.exports = {
  getOrCreateConversation,
  createGroupConversation,
  getOrCreateOpsGroup,
  groupMembers,
  listConversationsFor,
  isParticipant,
  listMessages,
  sendMessage,
  markConversationRead,
};
