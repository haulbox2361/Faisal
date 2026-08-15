// HaulBoX One-Time Location Permission Flow
// Prompts the driver on first app launch with educational disclosure.
// Stores permission state and avoids repeated prompt loops.

(function () {
  const STORAGE_KEY_PROMPTED = 'haulbox_location_permission_prompted';
  const STORAGE_KEY_GRANTED = 'haulbox_location_permission_granted';

  window.HaulBoxLocation = {
    checkInitialPermission: async function () {
      const alreadyPrompted = localStorage.getItem(STORAGE_KEY_PROMPTED);
      if (alreadyPrompted === 'true') {
        return; // Already prompted, never ask repeatedly on app launch
      }

      // Show one-time clean modal
      this.showDisclosureModal();
    },

    showDisclosureModal: function () {
      const overlay = document.createElement('div');
      overlay.id = 'haulbox-loc-modal';
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.75);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        z-index: 9999999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      `;

      overlay.innerHTML = `
        <div style="background: #0F172A; border: 1px solid #1E293B; border-radius: 20px; max-width: 380px; width: 100%; padding: 24px; color: #F8FAFC; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7);">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px;">
            <div style="width: 40px; height: 40px; border-radius: 12px; background: rgba(22, 163, 74, 0.15); color: #16A34A; display: flex; align-items: center; justify-content: center; font-size: 20px;">
              📍
            </div>
            <div>
              <div style="font-weight: 800; font-size: 16px; color: #FFFFFF;">Location Access</div>
              <div style="font-size: 11px; color: #94A3B8;">HaulBoX Driver Navigation</div>
            </div>
          </div>
          <p style="font-size: 13px; line-height: 1.5; color: #CBD5E1; margin: 0 0 14px;">
            HaulBoX uses your location to calculate arrival ETAs, display remaining trip mileage, and launch Google Maps navigation to your pickup and delivery facilities.
          </p>
          <div style="background: #1E293B; border-radius: 10px; padding: 10px 12px; font-size: 11.5px; color: #94A3B8; margin-bottom: 20px; display: flex; align-items: center; gap: 8px;">
            <span>🛡️</span>
            <span>Location is only accessed during active trips for navigation and route calculations.</span>
          </div>
          <div style="display: flex; gap: 10px;">
            <button id="hb-loc-deny" style="flex: 1; padding: 11px; border-radius: 10px; border: 1px solid #334155; background: transparent; color: #94A3B8; font-weight: 700; font-size: 13px; cursor: pointer;">
              Not Now
            </button>
            <button id="hb-loc-allow" style="flex: 1.3; padding: 11px; border-radius: 10px; border: none; background: #16A34A; color: #FFFFFF; font-weight: 800; font-size: 13px; cursor: pointer;">
              Allow Location
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      document.getElementById('hb-loc-deny').onclick = () => {
        localStorage.setItem(STORAGE_KEY_PROMPTED, 'true');
        localStorage.setItem(STORAGE_KEY_GRANTED, 'false');
        overlay.remove();
      };

      document.getElementById('hb-loc-allow').onclick = () => {
        localStorage.setItem(STORAGE_KEY_PROMPTED, 'true');
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              localStorage.setItem(STORAGE_KEY_GRANTED, 'true');
              overlay.remove();
            },
            (err) => {
              localStorage.setItem(STORAGE_KEY_GRANTED, 'false');
              overlay.remove();
            },
            { enableHighAccuracy: true, timeout: 10000 }
          );
        } else {
          localStorage.setItem(STORAGE_KEY_GRANTED, 'true');
          overlay.remove();
        }
      };
    }
  };

  // Auto-check on DOM loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.HaulBoxLocation.checkInitialPermission());
  } else {
    window.HaulBoxLocation.checkInitialPermission();
  }
})();
