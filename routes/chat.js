// Chat endpoints for the Admin/Dispatcher (web) side — the counterpart to
// the driver-scoped routes in routes/driver.js. Uses the same accountId
// scheme as Google auth: 'admin' or a dispatcher's id. Unlike the driver
// side, Admin/Dispatcher aren't restricted in who they can message — the
// restriction (driver.allowedContacts) only applies to drivers, enforced in
// routes/driver.js.

const express = require('express');
const chat = require('../lib/chatStore');

const router = express.Router();
router.use(express.json({ limit: '2mb' }));

function requireParty(req, res) {
  const { accountId, role } = req.body || req.query || {};
  const type = role === 'dispatcher' ? 'dispatcher' : 'admin';
  const id = String(accountId || (type === 'admin' ? 'admin' : '')).trim();
  if (!id) {
    res.status(400).json({ error: 'Missing accountId' });
    return null;
  }
  return { type, id };
}

// GET /api/chat/conversations?accountId=...&role=admin|dispatcher
router.get('/api/chat/conversations', async (req, res) => {
  const me = requireParty(req, res);
  if (!me) return;
  try {
    const convos = await chat.listConversationsFor(me);
    res.json({ chats: convos });
  } catch (e) {
    console.error('chat conversations fetch failed:', e);
    res.status(500).json({ error: 'Failed to load chats' });
  }
});

// POST /api/chat/start  { accountId, role, withType, withId }
// e.g. Admin/Dispatcher starting a conversation with a given driver id.
router.post('/api/chat/start', async (req, res) => {
  const me = requireParty(req, res);
  if (!me) return;
  const { withType, withId } = req.body || {};
  if (!withType || !withId) return res.status(400).json({ error: 'Missing withType/withId' });
  try {
    const id = await chat.getOrCreateConversation(me, { type: withType, id: String(withId) });
    res.json({ ok: true, conversationId: id });
  } catch (e) {
    console.error('chat start failed:', e);
    res.status(500).json({ error: 'Failed to start chat' });
  }
});

// POST /api/chat/group  { accountId, role, name, members:[{type,id,name}] }
// Creates a group chat (e.g. Driver + Dispatcher + Admin/Owner). Creator is
// added automatically if not already included in `members`.
router.post('/api/chat/group', async (req, res) => {
  const me = requireParty(req, res);
  if (!me) return;
  const { name, members } = req.body || {};
  const list = Array.isArray(members) ? members.slice() : [];
  if (!list.some((m) => m.type === me.type && String(m.id) === me.id)) list.push({ ...me });
  if (list.length < 2) return res.status(400).json({ error: 'A group needs at least 2 members' });
  try {
    const id = await chat.createGroupConversation(name, list);
    res.json({ ok: true, conversationId: id });
  } catch (e) {
    console.error('group chat create failed:', e);
    res.status(500).json({ error: 'Failed to create group chat' });
  }
});

// GET /api/chat/conversations/:id/messages?accountId=...&role=...
router.get('/api/chat/conversations/:id/messages', async (req, res) => {
  const me = requireParty(req, res);
  if (!me) return;
  const conversationId = Number(req.params.id);
  try {
    if (!(await chat.isParticipant(conversationId, me))) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    const messages = await chat.listMessages(conversationId);
    await chat.markConversationRead(conversationId, me);
    res.json({ messages });
  } catch (e) {
    console.error('chat messages fetch failed:', e);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// POST /api/chat/conversations/:id/messages  { accountId, role, name, body }
router.post('/api/chat/conversations/:id/messages', async (req, res) => {
  const me = requireParty(req, res);
  if (!me) return;
  const { name, body } = req.body || {};
  const text = String(body || '').trim();
  if (!text) return res.status(400).json({ error: 'Message cannot be empty' });

  const conversationId = Number(req.params.id);
  try {
    if (!(await chat.isParticipant(conversationId, me))) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    const sent = await chat.sendMessage(conversationId, { ...me, name }, text);
    res.json({ ok: true, message: { id: sent.id, createdAt: sent.createdAt, senderType: me.type, senderId: me.id, body: text } });
  } catch (e) {
    console.error('chat send failed:', e);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;
