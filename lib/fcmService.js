// Firebase Cloud Messaging (FCM) Service for HaulBoX Native Android Push Notifications.
// Manages driver device tokens and sends targeted push notifications.

const kv = require('./kvstore');

let admin = null;
let isInitialized = false;

function initFirebase() {
  if (isInitialized) return admin;
  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountJson) {
      const firebaseAdmin = require('firebase-admin');
      const credentials = typeof serviceAccountJson === 'string'
        ? JSON.parse(serviceAccountJson)
        : serviceAccountJson;

      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(credentials),
      });
      admin = firebaseAdmin;
      isInitialized = true;
      console.log('[FCM] Firebase Admin SDK initialized successfully.');
    } else {
      console.log('[FCM] Note: FIREBASE_SERVICE_ACCOUNT not configured. FCM notifications queued in store.');
    }
  } catch (e) {
    console.warn('[FCM] Firebase Admin SDK init warning:', e.message);
  }
  return admin;
}

// 1. DEVICE TOKEN STORAGE (Associates FCM device tokens with authenticated drivers)
const TOKEN_KEY_PREFIX = 'driver:device_tokens:';

async function registerDeviceToken(driverId, token, platform = 'android') {
  if (!driverId || !token) return false;
  try {
    const key = `${TOKEN_KEY_PREFIX}${driverId}`;
    const raw = await kv.get(key).catch(() => null);
    let tokens = raw ? JSON.parse(raw) : [];
    
    // Avoid duplicate tokens
    tokens = tokens.filter(t => t.token !== token);
    tokens.push({
      token,
      platform,
      updatedAt: new Date().toISOString(),
    });

    await kv.set(key, JSON.stringify(tokens));
    console.log(`[FCM] Registered device token for Driver ${driverId}`);
    return true;
  } catch (e) {
    console.error('[FCM] registerDeviceToken error:', e);
    return false;
  }
}

async function removeDeviceToken(driverId, token) {
  if (!driverId) return false;
  try {
    const key = `${TOKEN_KEY_PREFIX}${driverId}`;
    if (!token) {
      // Clear all tokens on logout
      await kv.set(key, JSON.stringify([]));
      return true;
    }
    const raw = await kv.get(key).catch(() => null);
    if (!raw) return true;
    let tokens = JSON.parse(raw);
    tokens = tokens.filter(t => t.token !== token);
    await kv.set(key, JSON.stringify(tokens));
    return true;
  } catch (e) {
    console.error('[FCM] removeDeviceToken error:', e);
    return false;
  }
}

async function getDeviceTokens(driverId) {
  try {
    const key = `${TOKEN_KEY_PREFIX}${driverId}`;
    const raw = await kv.get(key).catch(() => null);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(p => p.token) : [];
  } catch (e) {
    return [];
  }
}

// 2. DISPATCH NOTIFICATION (Supports WhatsApp-style payload & deep-linking)
// payload structure:
// {
//   title: "📦 New Load Assigned",
//   body: "Load #HB1024 has been assigned to you.",
//   type: "load" | "chat" | "payment" | "announcement",
//   data: { loadId, conversationId, ... }
// }
async function sendToDriver(driverId, { title, body, type = 'general', data = {} }) {
  const tokens = await getDeviceTokens(driverId);
  if (!tokens || tokens.length === 0) {
    console.log(`[FCM] No active device tokens registered for driver ${driverId}`);
    return { ok: false, sentCount: 0, reason: 'No registered device tokens' };
  }

  const fb = initFirebase();
  if (!fb) {
    console.log(`[FCM Mock Delivery] [Driver ${driverId}] ${title}: ${body}`);
    return { ok: true, sentCount: tokens.length, mock: true };
  }

  // Convert all data values to strings as required by FCM
  const stringifiedData = {
    type: String(type),
    click_action: 'FLUTTER_NOTIFICATION_CLICK',
    ...Object.keys(data).reduce((acc, k) => {
      acc[k] = String(data[k] ?? '');
      return acc;
    }, {}),
  };

  const message = {
    notification: {
      title: title || 'HaulBoX Driver',
      body: body || '',
    },
    data: stringifiedData,
    android: {
      priority: 'high',
      notification: {
        channelId: 'haulbox_driver_channel',
        sound: 'default',
        defaultVibrateTimings: true,
        defaultSound: true,
        priority: 'high',
        icon: 'ic_launcher',
        color: '#16A34A',
      },
    },
    tokens,
  };

  try {
    const response = await fb.messaging().sendEachForMulticast(message);
    console.log(`[FCM] Sent notification to driver ${driverId}: ${response.successCount} succeeded, ${response.failureCount} failed.`);
    return {
      ok: true,
      sentCount: response.successCount,
      failedCount: response.failureCount,
    };
  } catch (err) {
    console.error('[FCM] Error sending multicast notification:', err);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  registerDeviceToken,
  removeDeviceToken,
  getDeviceTokens,
  sendToDriver,
  initFirebase,
};
