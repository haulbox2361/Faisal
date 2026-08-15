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

const kv = require('../lib/kvstore');

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

// GET /api/chat/contacts?accountId=...&role=admin|dispatcher
router.get('/api/chat/contacts', async (req, res) => {
  const me = requireParty(req, res);
  if (!me) return;
  try {
    const raw = await kv.get('haulline:state');
    let state = {};
    try { if (raw) state = JSON.parse(raw); } catch (e) {}
    
    const contacts = [];
    
    if (me.type === 'admin') {
      // Admin can message everyone: all dispatchers, all drivers, and all Ops groups
      (state.dispatchers || []).forEach(d => {
        contacts.push({ type: 'dispatcher', id: String(d.id), name: d.name || 'Dispatcher', role: 'Dispatcher' });
      });
      (state.drivers || []).forEach(d => {
        contacts.push({ type: 'driver', id: String(d.id), name: d.name || 'Driver', role: 'Driver' });
        contacts.push({ type: 'ops', id: String(d.id), name: `Operations - ${d.name || 'Driver'}`, role: 'Group' });
      });
    } else {
      // Dispatcher can ONLY message:
      // 1. Admin
      // 2. Their assigned drivers
      // 3. Operations groups for their assigned drivers
      contacts.push({ type: 'admin', id: 'admin', name: (state.settings && state.settings.companyName) ? state.settings.companyName + ' (Admin)' : 'Admin', role: 'Owner / Admin' });
      
      (state.drivers || []).forEach(d => {
        if (String(d.dispatcherId) === String(me.id)) {
          contacts.push({ type: 'driver', id: String(d.id), name: d.name || 'Driver', role: 'Driver' });
          contacts.push({ type: 'ops', id: String(d.id), name: `Operations - ${d.name || 'Driver'}`, role: 'Group' });
        }
      });
    }

    res.json({ contacts });
  } catch (e) {
    console.error('chat contacts failed:', e);
    res.status(500).json({ error: 'Failed to load contacts' });
  }
});

// POST /api/chat/start  { accountId, role, withType, withId }
router.post('/api/chat/start', async (req, res) => {
  const me = requireParty(req, res);
  if (!me) return;
  const { withType, withId } = req.body || {};
  if (!withType || !withId) return res.status(400).json({ error: 'Missing withType/withId' });
  try {
    const raw = await kv.get('haulline:state');
    let state = {};
    try { if (raw) state = JSON.parse(raw); } catch (e) {}

    // Authorization check for Dispatchers:
    if (me.type === 'dispatcher') {
      if (withType === 'driver' || withType === 'ops') {
        const driver = (state.drivers || []).find(d => String(d.id) === String(withId));
        if (!driver || String(driver.dispatcherId) !== String(me.id)) {
          return res.status(403).json({ error: 'You are only authorized to message your assigned drivers.' });
        }
      } else if (withType === 'dispatcher' && String(withId) !== String(me.id)) {
        return res.status(403).json({ error: 'Dispatchers can only direct message Admin and their assigned drivers.' });
      }
    }

    let id;
    if (withType === 'ops') {
      const driver = (state.drivers || []).find(d => String(d.id) === String(withId));
      const disp = driver && driver.dispatcherId ? (state.dispatchers || []).find(d => String(d.id) === String(driver.dispatcherId)) : null;
      id = await chat.getOrCreateOpsGroup(driver ? driver.id : withId, driver ? driver.name : 'Driver', driver ? driver.dispatcherId : null, disp ? disp.name : 'Dispatcher');
    } else {
      id = await chat.getOrCreateConversation(me, { type: withType, id: String(withId) });
    }
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
async function getMessagesHandler(req, res) {
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
}
router.get('/api/chat/conversations/:id/messages', getMessagesHandler);
router.get('/api/chat/messages/:id', getMessagesHandler);

// POST /api/chat/conversations/:id/messages  { accountId, role, name, body, loadId, loadNumber, attachment }
async function postMessageHandler(req, res) {
  const me = requireParty(req, res);
  if (!me) return;
  const { name, body, loadId, loadNumber, attachment } = req.body || {};
  const text = String(body || '').trim();
  // Allow empty body if there is an attachment
  if (!text && !attachment) return res.status(400).json({ error: 'Message cannot be empty' });

  const conversationId = Number(req.params.id);
  try {
    if (!(await chat.isParticipant(conversationId, me))) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    // Pass attachment metadata to sendMessage (stored as JSON in the body column if no text)
    const effectiveText = text || (attachment ? `[File: ${attachment.name || 'attachment'}]` : '');
    const sent = await chat.sendMessage(conversationId, { ...me, name }, effectiveText, loadId, loadNumber, attachment);
    res.json({ ok: true, message: { id: sent.id, createdAt: sent.createdAt, senderType: me.type, senderId: me.id, body: text, loadId, loadNumber, attachment } });
  } catch (e) {
    console.error('chat send failed:', e);
    res.status(500).json({ error: 'Failed to send message' });
  }
}
router.post('/api/chat/conversations/:id/messages', postMessageHandler);
router.post('/api/chat/messages/:id', postMessageHandler);

// POST /api/chat/read/:id
router.post('/api/chat/read/:id', async (req, res) => {
  const me = requireParty(req, res);
  if (!me) return;
  const conversationId = Number(req.params.id);
  try {
    if (await chat.isParticipant(conversationId, me)) {
      await chat.markConversationRead(conversationId, me);
    }
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: true });
  }
});

// GET /api/chat/search?q=...&conversationId=...
router.get('/api/chat/search', async (req, res) => {
  const me = requireParty(req, res);
  if (!me) return;
  const { q, conversationId } = req.query || {};
  try {
    const messages = await chat.searchMessages(q, me, conversationId ? Number(conversationId) : null);
    res.json({ ok: true, count: messages.length, messages });
  } catch (e) {
    console.error('chat search failed:', e);
    res.status(500).json({ error: 'Failed to search messages' });
  }
});

// POST /api/chat/typing { accountId, role, conversationId, isTyping }
router.post('/api/chat/typing', async (req, res) => {
  const me = requireParty(req, res);
  if (!me) return;
  const { conversationId, isTyping } = req.body || {};
  if (!conversationId) return res.status(400).json({ error: 'Missing conversationId' });
  try {
    chat.setTypingStatus(Number(conversationId), me, !!isTyping);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: true });
  }
});

// GET /api/chat/typing/:id?accountId=...&role=...
router.get('/api/chat/typing/:id', async (req, res) => {
  const me = requireParty(req, res);
  if (!me) return;
  const conversationId = Number(req.params.id);
  try {
    const typingUsers = chat.getTypingUsers(conversationId, me);
    res.json({ ok: true, typing: typingUsers.length > 0, users: typingUsers });
  } catch (e) {
    res.json({ ok: true, typing: false, users: [] });
  }
});

// POST /api/chat/presence { accountId, role, isOnline }
router.post('/api/chat/presence', async (req, res) => {
  const me = requireParty(req, res);
  if (!me) return;
  const { isOnline } = req.body || {};
  chat.setUserPresence(me, isOnline !== false);
  res.json({ ok: true });
});

// GET /api/chat/presence?type=...&id=...
router.get('/api/chat/presence', async (req, res) => {
  const { type = 'driver', id = '' } = req.query || {};
  const presence = chat.getUserPresence(type, id);
  res.json({ ok: true, presence });
});

module.exports = router;

