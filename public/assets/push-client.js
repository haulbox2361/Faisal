// HaulBoX Push Notifications Client for Capacitor Android App
// Handles native notification permissions, FCM device token registration,
// in-app notification toasts, and deep linking navigation.

(function () {
  window.HaulBoxPush = {
    isCapacitor: function () {
      return typeof window.Capacitor !== 'undefined' && window.Capacitor.isNativePlatform();
    },

    init: async function (driverAuthToken) {
      if (!this.isCapacitor()) {
        console.log('[PushClient] Running on Web / Browser. Native push listeners skipped.');
        return;
      }

      try {
        const PushNotifications = window.Capacitor.Plugins.PushNotifications;
        if (!PushNotifications) {
          console.warn('[PushClient] PushNotifications plugin not available.');
          return;
        }

        // 1. Request Permission
        let permStatus = await PushNotifications.checkPermissions();
        if (permStatus.receive === 'prompt') {
          permStatus = await PushNotifications.requestPermissions();
        }

        if (permStatus.receive !== 'granted') {
          console.log('[PushClient] Driver did not grant push notification permission.');
          return;
        }

        // 2. Register with FCM
        await PushNotifications.register();

        // 3. Listen for Device Token Registration
        await PushNotifications.addListener('registration', async (token) => {
          console.log('[PushClient] FCM Device Token received:', token.value);
          if (driverAuthToken && token.value) {
            await fetch('/api/driver/device-token', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${driverAuthToken}`,
              },
              body: JSON.stringify({
                token: token.value,
                platform: 'android',
              }),
            }).catch((err) => console.error('[PushClient] Failed to register token on server:', err));
          }
        });

        // 4. Handle Registration Errors
        await PushNotifications.addListener('registrationError', (err) => {
          console.error('[PushClient] Push registration error: ', err.error);
        });

        // 5. In-App Notification Received (App is Open / Foreground)
        await PushNotifications.addListener('pushNotificationReceived', (notification) => {
          console.log('[PushClient] In-App Notification:', notification);
          window.HaulBoxPush.showInAppToast(notification);
        });

        // 6. Deep Linking Navigation (Driver tapped notification)
        await PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
          console.log('[PushClient] Notification Action Tapped:', notification);
          const data = notification.notification.data || {};
          window.HaulBoxPush.handleDeepLink(data);
        });

        console.log('[PushClient] Push Notification system initialized successfully.');
      } catch (err) {
        console.error('[PushClient] Push init error:', err);
      }
    },

    // Handles Deep Linking to appropriate screen
    handleDeepLink: function (data) {
      if (!data) return;
      const type = data.type || '';
      console.log('[PushClient] Navigating via deep-link type:', type, data);

      if (type === 'chat') {
        if (typeof window.openChat === 'function') {
          window.openChat(data.conversationId);
        } else if (typeof window.switchTab === 'function') {
          window.switchTab('chat');
        }
      } else if (type === 'load') {
        if (typeof window.openLoadDetail === 'function' && data.loadId) {
          window.openLoadDetail(data.loadId);
        } else if (typeof window.switchTab === 'function') {
          window.switchTab('loads');
        }
      } else if (type === 'payment') {
        if (typeof window.switchTab === 'function') {
          window.switchTab('payments');
        }
      } else if (type === 'announcement' || type === 'current_load') {
        if (typeof window.switchTab === 'function') {
          window.switchTab('current_load');
        }
      }
    },

    // Non-intrusive In-App Toast for foreground notifications
    showInAppToast: function (notification) {
      const toast = document.createElement('div');
      toast.className = 'haulbox-push-toast';
      toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        max-width: 90%;
        width: 380px;
        background: #0F172A;
        border: 1px solid #1E293B;
        border-left: 4px solid #16A34A;
        color: #FFFFFF;
        padding: 12px 16px;
        border-radius: 12px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.5);
        z-index: 999999;
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        animation: slideDownToast 0.3s ease-out;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      `;

      toast.innerHTML = `
        <div style="font-size: 20px;">📦</div>
        <div style="flex: 1; overflow: hidden;">
          <div style="font-weight: 800; font-size: 13px; color: #4ADE80; margin-bottom: 2px;">${notification.title || 'HaulBoX Notification'}</div>
          <div style="font-size: 12px; color: #CBD5E1; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">${notification.body || ''}</div>
        </div>
      `;

      toast.onclick = function () {
        window.HaulBoxPush.handleDeepLink(notification.data);
        toast.remove();
      };

      document.body.appendChild(toast);
      setTimeout(() => {
        if (toast.parentNode) toast.remove();
      }, 5000);
    },

    // Removes device token on logout
    removeToken: async function (driverAuthToken) {
      if (!this.isCapacitor() || !driverAuthToken) return;
      try {
        await fetch('/api/driver/device-token/remove', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${driverAuthToken}`,
          },
          body: JSON.stringify({}),
        }).catch(() => null);
      } catch (_) {}
    }
  };
})();
