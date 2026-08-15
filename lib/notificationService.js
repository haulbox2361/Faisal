// lib/notificationService.js
// Production Multi-Channel Push & In-App Notification Engine for HaulBoX

const notifications = require('./notificationStore');
const fcm = require('./fcmService');

// In-memory anti-spam deduplication cache: key -> expiresAt (timestamp)
const _dedupMap = new Map();

function isSpam(dedupKey, cooldownMs = 60000) {
  if (!dedupKey) return false;
  const now = Date.now();
  const expiresAt = _dedupMap.get(dedupKey);
  if (expiresAt && expiresAt > now) {
    return true; // Suppress duplicate
  }
  _dedupMap.set(dedupKey, now + cooldownMs);
  return false;
}

// Clean up expired dedup keys periodically
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _dedupMap.entries()) {
    if (v < now) _dedupMap.delete(k);
  }
}, 300000);

async function dispatchNotification({
  recipientType, // 'driver' | 'dispatcher' | 'admin'
  recipientId,
  type,
  title,
  body,
  data = {},
  dedupKey = null,
  cooldownMs = 60000,
}) {
  if (dedupKey && isSpam(dedupKey, cooldownMs)) {
    console.log(`[NotificationService] Suppressed duplicate notification for ${recipientType}:${recipientId} (${dedupKey})`);
    return null;
  }

  try {
    // 1. Persist notification to PostgreSQL database
    const created = await notifications.create(recipientType, String(recipientId), {
      type,
      title,
      body,
      data,
    });

    // 2. Dispatch native FCM Push Notification to Driver if recipient is driver
    if (recipientType === 'driver') {
      fcm.sendToDriver(String(recipientId), {
        title,
        body,
        type,
        data: { ...data, notificationId: String(created.id) },
      }).catch((err) => console.error('[FCM Push Error]:', err));
    }

    return created;
  } catch (err) {
    console.error(`[NotificationService] Failed to dispatch ${type} to ${recipientType}:${recipientId}:`, err);
    return null;
  }
}

// ==========================================
// 1. DRIVER NOTIFICATION EVENTS
// ==========================================

async function notifyDriverNewLoad(driverId, load) {
  return dispatchNotification({
    recipientType: 'driver',
    recipientId: driverId,
    type: 'NEW_LOAD_ASSIGNED',
    title: `📦 New Load Assigned: #${load.loadNumber}`,
    body: `${load.pickup} ➔ ${load.dropoff} • Pay: $${load.driverPay || load.rate || '1,250'}. Tap to review & accept.`,
    data: { loadId: String(load.id || load.loadNumber), screen: 'load_detail' },
    dedupKey: `driver:${driverId}:new_load:${load.id}`,
    cooldownMs: 300000,
  });
}

async function notifyDriverPickupReminder(driverId, load) {
  return dispatchNotification({
    recipientType: 'driver',
    recipientId: driverId,
    type: 'PICKUP_REMINDER',
    title: `⏰ Pickup Window Reminder: #${load.loadNumber}`,
    body: `Pickup scheduled at ${load.pickupTime || '08:00 AM'}. Please proceed to ${load.pickupAddress || load.pickup}.`,
    data: { loadId: String(load.id || load.loadNumber), screen: 'current_load' },
    dedupKey: `driver:${driverId}:pickup_remind:${load.id}`,
    cooldownMs: 1800000, // 30 min cooldown
  });
}

async function notifyDriverDeliveryReminder(driverId, load) {
  return dispatchNotification({
    recipientType: 'driver',
    recipientId: driverId,
    type: 'DELIVERY_REMINDER',
    title: `🏁 Delivery Appointment: #${load.loadNumber}`,
    body: `Approaching destination in ${load.dropoff}. Prepare delivery paperwork & consignee signature.`,
    data: { loadId: String(load.id || load.loadNumber), screen: 'current_load' },
    dedupKey: `driver:${driverId}:deliv_remind:${load.id}`,
    cooldownMs: 1800000,
  });
}

async function notifyDriverDispatcherMessage(driverId, dispatcherName, messageText) {
  const snippet = messageText.length > 80 ? messageText.substring(0, 77) + '...' : messageText;
  return dispatchNotification({
    recipientType: 'driver',
    recipientId: driverId,
    type: 'DISPATCHER_MESSAGE',
    title: `💬 ${dispatcherName || 'Dispatcher'}`,
    body: snippet,
    data: { screen: 'chat' },
  });
}

async function notifyDriverDocCorrectionRequired(driverId, load, docType, reason) {
  return dispatchNotification({
    recipientType: 'driver',
    recipientId: driverId,
    type: 'DOC_CORRECTION_REQUIRED',
    title: `⚠️ ${docType.toUpperCase()} Retake Required: #${load.loadNumber}`,
    body: reason || 'Document image was blurry or cropped. Tap to retake photo.',
    data: { loadId: String(load.id || load.loadNumber), docType, screen: 'current_load' },
    dedupKey: `driver:${driverId}:doc_reject:${docType}:${load.id}`,
    cooldownMs: 60000,
  });
}

async function notifyDriverPaymentReceived(driverId, load, amount) {
  return dispatchNotification({
    recipientType: 'driver',
    recipientId: driverId,
    type: 'PAYMENT_RECEIVED',
    title: `💰 Payment Received: $${amount}`,
    body: `Direct deposit settlement for Load #${load.loadNumber} processed successfully.`,
    data: { loadId: String(load.id || load.loadNumber), screen: 'payments' },
    dedupKey: `driver:${driverId}:paid:${load.id}`,
    cooldownMs: 300000,
  });
}

// ==========================================
// 2. DISPATCHER NOTIFICATION EVENTS
// ==========================================

async function notifyDispatcherDriverAccepted(dispatcherId, load, driver) {
  return dispatchNotification({
    recipientType: 'dispatcher',
    recipientId: dispatcherId || 'admin',
    type: 'DRIVER_ACCEPTED_LOAD',
    title: `✅ Load Accepted: #${load.loadNumber}`,
    body: `${driver.name || 'Driver'} accepted load ${load.pickup} ➔ ${load.dropoff}.`,
    data: { loadId: String(load.id || load.loadNumber), driverId: String(driver.id) },
  });
}

async function notifyDispatcherDriverArrivedPickup(dispatcherId, load, driver) {
  return dispatchNotification({
    recipientType: 'dispatcher',
    recipientId: dispatcherId || 'admin',
    type: 'DRIVER_ARRIVED_PICKUP',
    title: `📍 Driver at Shipper: #${load.loadNumber}`,
    body: `${driver.name || 'Driver'} arrived at pickup facility in ${load.pickup}.`,
    data: { loadId: String(load.id || load.loadNumber), driverId: String(driver.id) },
    dedupKey: `disp:${dispatcherId}:arrived_pu:${load.id}`,
    cooldownMs: 300000,
  });
}

async function notifyDispatcherBolUploaded(dispatcherId, load, driver) {
  return dispatchNotification({
    recipientType: 'dispatcher',
    recipientId: dispatcherId || 'admin',
    type: 'DRIVER_UPLOADED_BOL',
    title: `📄 BOL Uploaded: #${load.loadNumber}`,
    body: `${driver.name || 'Driver'} uploaded and verified BOL. Load marked LOADED.`,
    data: { loadId: String(load.id || load.loadNumber), driverId: String(driver.id) },
  });
}

async function notifyDispatcherDriverArrivedDelivery(dispatcherId, load, driver) {
  return dispatchNotification({
    recipientType: 'dispatcher',
    recipientId: dispatcherId || 'admin',
    type: 'DRIVER_ARRIVED_DELIVERY',
    title: `📍 Driver at Consignee: #${load.loadNumber}`,
    body: `${driver.name || 'Driver'} arrived at delivery destination in ${load.dropoff}.`,
    data: { loadId: String(load.id || load.loadNumber), driverId: String(driver.id) },
    dedupKey: `disp:${dispatcherId}:arrived_do:${load.id}`,
    cooldownMs: 300000,
  });
}

async function notifyDispatcherPodUploaded(dispatcherId, load, driver) {
  return dispatchNotification({
    recipientType: 'dispatcher',
    recipientId: dispatcherId || 'admin',
    type: 'DRIVER_UPLOADED_POD',
    title: `📋 POD Uploaded: #${load.loadNumber}`,
    body: `${driver.name || 'Driver'} uploaded and verified signed POD. Load DELIVERED.`,
    data: { loadId: String(load.id || load.loadNumber), driverId: String(driver.id) },
  });
}

async function notifyDispatcherLoadCompleted(dispatcherId, load, driver) {
  return dispatchNotification({
    recipientType: 'dispatcher',
    recipientId: dispatcherId || 'admin',
    type: 'LOAD_COMPLETED',
    title: `🎉 Load Settled: #${load.loadNumber}`,
    body: `Driver ${driver.name || ''} confirmed payment settlement. Load finalized.`,
    data: { loadId: String(load.id || load.loadNumber), driverId: String(driver.id) },
  });
}

// ==========================================
// 3. ADMIN NOTIFICATION EVENTS
// ==========================================

async function notifyAdminCriticalDelay(load, driver, delayMinutes) {
  return dispatchNotification({
    recipientType: 'admin',
    recipientId: 'admin',
    type: 'CRITICAL_DELAY_ALERT',
    title: `🚨 Severe Delay Alert: #${load.loadNumber}`,
    body: `Driver ${driver ? driver.name : 'assigned'} is running +${delayMinutes} mins behind scheduled appointment.`,
    data: { loadId: String(load.id || load.loadNumber), delayMinutes },
    dedupKey: `admin:delay:${load.id}`,
    cooldownMs: 1800000, // 30 min cooldown
  });
}

async function notifyAdminFailedUpload(load, driver, docType, reason) {
  return dispatchNotification({
    recipientType: 'admin',
    recipientId: 'admin',
    type: 'DOC_UPLOAD_FAILURE',
    title: `⚠️ Document Failure: Load #${load.loadNumber}`,
    body: `Repeated validation failure for ${docType}: ${reason}`,
    data: { loadId: String(load.id || load.loadNumber), docType },
  });
}

async function notifyAdminSecurityAlert(title, body, meta = {}) {
  return dispatchNotification({
    recipientType: 'admin',
    recipientId: 'admin',
    type: 'SECURITY_ALERT',
    title: `🔒 ${title}`,
    body: body,
    data: meta,
  });
}

module.exports = {
  dispatchNotification,
  notifyDriverNewLoad,
  notifyDriverPickupReminder,
  notifyDriverDeliveryReminder,
  notifyDriverDispatcherMessage,
  notifyDriverDocCorrectionRequired,
  notifyDriverPaymentReceived,
  notifyDispatcherDriverAccepted,
  notifyDispatcherDriverArrivedPickup,
  notifyDispatcherBolUploaded,
  notifyDispatcherDriverArrivedDelivery,
  notifyDispatcherPodUploaded,
  notifyDispatcherLoadCompleted,
  notifyAdminCriticalDelay,
  notifyAdminFailedUpload,
  notifyAdminSecurityAlert,
};
