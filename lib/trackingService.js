/**
 * lib/trackingService.js
 * Server-Side GPS Tracking & ETA Cache Engine for HaulBoX Dispatcher TMS
 * 
 * Features:
 * - Runs a fixed 15-minute recomputation job in the background (setInterval).
 * - Executes immediately at server startup (no initial gap on Render deploy/restart).
 * - Caches computed ETAs and GPS telemetry for high-performance O(1) serving.
 * - Resolves next-stop targeting for both single-stop and multi-stop loads.
 * - Supports live GPS telemetry updates while serving cached ETA intervals.
 */

const etaEngine = require('./etaEngine');
const kv = require('./kvstore');
const db = require('./db');

class TrackingService {
  constructor(options = {}) {
    this.intervalMs = options.intervalMs || 15 * 60 * 1000; // Fixed 15-minute interval
    this.timer = null;
    this.isRunning = false;
    this.cache = {
      lastCalculatedAt: null,
      drivers: {},
      loads: {}
    };
  }

  /**
   * Starts the background 15-minute interval job.
   * Runs immediately on startup so dispatchers never wait 15 minutes after deployment/restart.
   */
  start() {
    if (this.timer) return;
    this.isRunning = true;
    console.log(`[TrackingService] Initializing server-side ETA & GPS tracking cache (15-min interval)...`);

    // Run immediately at startup
    this.recalculateAll().catch(err => {
      console.error('[TrackingService] Error on startup recalculation:', err);
    });

    // Arm fixed 15-minute interval
    this.timer = setInterval(() => {
      this.recalculateAll().catch(err => {
        console.error('[TrackingService] Periodic ETA recalculation error:', err);
      });
    }, this.intervalMs);
  }

  /**
   * Stops the background interval
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.isRunning = false;
      console.log('[TrackingService] Tracking service stopped.');
    }
  }

  /**
   * Returns a friendly "X min ago" string
   */
  formatTimeAgo(isoString) {
    if (!isoString) return 'No updates';
    const ms = Date.now() - new Date(isoString).getTime();
    if (isNaN(ms) || ms < 0) return 'Just now';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes === 1) return '1 min ago';
    if (minutes < 60) return `${minutes} mins ago`;
    const hours = Math.floor(minutes / 60);
    if (hours === 1) return '1 hr ago';
    if (hours < 24) return `${hours} hrs ago`;
    return `${Math.floor(hours / 24)} days ago`;
  }

  /**
   * Full recomputation cycle for all active loads & drivers
   */
  async recalculateAll() {
    try {
      // 1. Fetch current application state from KV store
      let state = null;
      try {
        const rawState = await kv.get('haulline:state');
        if (rawState) {
          state = typeof rawState === 'string' ? JSON.parse(rawState) : rawState;
        }
      } catch (e) {
        // kv read failure
      }

      if (!state) {
        state = { drivers: [], loads: [] };
      }

      const drivers = Array.isArray(state.drivers) ? state.drivers : [];
      const loads = Array.isArray(state.loads) ? state.loads : [];

      // 2. Fetch latest GPS breadcrumbs for all drivers from Postgres
      let dbLocationsMap = new Map();
      try {
        await db.ensureSchema();
        const pool = db.getPool();
        const locRes = await pool.query(
          `SELECT DISTINCT ON (driver_id) * FROM driver_locations ORDER BY driver_id, recorded_at DESC`
        );
        if (locRes && Array.isArray(locRes.rows)) {
          locRes.rows.forEach(r => {
            dbLocationsMap.set(String(r.driver_id), r);
          });
        }
      } catch (dbErr) {
        // Fallback to in-memory/state if DB query fails
      }

      const calculatedDrivers = {};
      const calculatedLoads = {};
      const calculationTime = new Date().toISOString();

      // 3. Process each driver and associated active load
      for (const driver of drivers) {
        const driverId = String(driver.id);
        const dbLoc = dbLocationsMap.get(driverId);

        // Determine effective GPS location (prefer latest DB breadcrumb, fallback to driver.location)
        let lat = null;
        let lng = null;
        let speed = null;
        let heading = null;
        let recordedAt = null;

        if (dbLoc && dbLoc.latitude != null && dbLoc.longitude != null) {
          lat = Number(dbLoc.latitude);
          lng = Number(dbLoc.longitude);
          speed = dbLoc.speed != null ? Number(dbLoc.speed) : null;
          heading = dbLoc.heading != null ? Number(dbLoc.heading) : null;
          recordedAt = dbLoc.recorded_at ? new Date(dbLoc.recorded_at).toISOString() : null;
        } else if (driver.location && (driver.location.lat != null || driver.location.latitude != null)) {
          lat = Number(driver.location.lat || driver.location.latitude);
          lng = Number(driver.location.lng || driver.location.longitude);
          speed = driver.location.speed != null ? Number(driver.location.speed) : null;
          heading = driver.location.heading != null ? Number(driver.location.heading) : null;
          recordedAt = driver.location.lastUpdated || driver.location.recordedAt || null;
        }

        const gps = (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) ? {
          lat,
          lng,
          speed,
          heading,
          lastUpdated: recordedAt || calculationTime
        } : null;

        // Find active load for this driver
        const activeLoad = loads.find(l => 
          String(l.driverId) === driverId && 
          l.status !== 'Drop-off' && 
          l.status !== 'Delivered' && 
          l.status !== 'Cancelled'
        );

        if (activeLoad) {
          // Normalize stops (both single-stop and multi-stop)
          const stops = etaEngine.normalizeLoadStops(activeLoad);

          // Resolve coordinates for all stops (async geocode with cache)
          for (const stop of stops) {
            stop.coords = await etaEngine.geocodeAddressWithLookup(stop.address || `${stop.city}, ${stop.state}`);
          }

          // Determine next stop
          const nextStop = etaEngine.determineNextStop(activeLoad, stops);

          // Calculate ETA & remaining miles to next stop from real GPS
          let milesToNextStop = 0;
          let etaIso = null;
          let etaText = 'On Schedule';

          if (gps && nextStop && nextStop.coords) {
            milesToNextStop = etaEngine.haversineMiles(gps.lat, gps.lng, nextStop.coords.lat, nextStop.coords.lng);
            etaIso = etaEngine.computeEtaTimestamp(milesToNextStop, new Date());
            etaText = etaEngine.formatEtaText(etaIso);
          } else if (activeLoad.miles) {
            milesToNextStop = Number(activeLoad.miles) || 0;
            etaIso = etaEngine.computeEtaTimestamp(milesToNextStop, new Date());
            etaText = etaEngine.formatEtaText(etaIso);
          }

          const risk = etaEngine.classifyEtaRisk(
            etaIso,
            nextStop ? nextStop.scheduledDate : activeLoad.deliveryDate,
            nextStop ? nextStop.scheduledTime : activeLoad.deliveryTime,
            gps ? gps.lastUpdated : null
          );

          // Is it single stop or multi stop?
          const isMultiStop = stops.length > 2 || 
            (activeLoad.pickupStops && activeLoad.pickupStops.length > 1) || 
            (activeLoad.deliveryStops && activeLoad.deliveryStops.length > 1);

          const driverTrackingData = {
            driverId,
            driverName: driver.name,
            driverCode: driver.code || driver.id,
            truck: driver.truck || 'Truck #' + (driver.code || '101'),
            hasGps: Boolean(gps),
            gps,
            loadId: activeLoad.id,
            loadNumber: activeLoad.loadNumber,
            loadStatus: activeLoad.status || 'In Transit',
            driverProgress: activeLoad.driverProgress || 'IN_TRANSIT',
            isMultiStop,
            stops,
            nextStop: nextStop ? {
              type: nextStop.type,
              stopNumber: nextStop.stopNumber,
              facilityName: nextStop.facilityName,
              address: nextStop.address,
              city: nextStop.city,
              state: nextStop.state,
              coords: nextStop.coords
            } : null,
            milesToNextStop,
            etaIso,
            etaText,
            risk,
            lastGpsUpdateText: this.formatTimeAgo(gps ? gps.lastUpdated : null),
            cachedAt: calculationTime
          };

          calculatedDrivers[driverId] = driverTrackingData;
          calculatedLoads[String(activeLoad.id)] = driverTrackingData;
        } else {
          // Driver available / no active load
          calculatedDrivers[driverId] = {
            driverId,
            driverName: driver.name,
            driverCode: driver.code || driver.id,
            truck: driver.truck || 'Truck #' + (driver.code || '101'),
            hasGps: Boolean(gps),
            gps,
            loadId: null,
            loadNumber: null,
            loadStatus: 'Available',
            isMultiStop: false,
            stops: [],
            nextStop: null,
            milesToNextStop: null,
            etaIso: null,
            etaText: null,
            risk: null,
            lastGpsUpdateText: this.formatTimeAgo(gps ? gps.lastUpdated : null),
            cachedAt: calculationTime
          };
        }
      }

      this.cache = {
        lastCalculatedAt: calculationTime,
        drivers: calculatedDrivers,
        loads: calculatedLoads
      };

      console.log(`[TrackingService] Cache refreshed successfully (${Object.keys(calculatedDrivers).length} drivers, ${Object.keys(calculatedLoads).length} active loads).`);
    } catch (err) {
      console.error('[TrackingService] Recalculation cycle failed:', err);
    }
  }

  /**
   * Updates driver coordinates when live GPS ping arrives via POST /api/driver/location
   * Updates coordinates immediately so marker moves without recalculating ETA outside 15-min window.
   */
  recordLiveGpsUpdate(driverId, locData = {}, loadId = null) {
    if (!driverId) return;
    const strDriverId = String(driverId);
    const lat = Number(locData.latitude || locData.lat);
    const lng = Number(locData.longitude || locData.lng);
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) return;

    const nowIso = new Date().toISOString();
    const updatedGps = {
      lat,
      lng,
      speed: locData.speed != null ? Number(locData.speed) : null,
      heading: locData.heading != null ? Number(locData.heading) : null,
      lastUpdated: nowIso
    };

    if (this.cache.drivers[strDriverId]) {
      const entry = this.cache.drivers[strDriverId];
      entry.gps = updatedGps;
      entry.hasGps = true;
      entry.lastGpsUpdateText = 'Just now';
    } else {
      this.cache.drivers[strDriverId] = {
        driverId: strDriverId,
        hasGps: true,
        gps: updatedGps,
        lastGpsUpdateText: 'Just now',
        cachedAt: nowIso
      };
    }

    if (loadId && this.cache.loads[String(loadId)]) {
      this.cache.loads[String(loadId)].gps = updatedGps;
      this.cache.loads[String(loadId)].hasGps = true;
      this.cache.loads[String(loadId)].lastGpsUpdateText = 'Just now';
    }
  }

  /**
   * Returns cached summary for the web portal
   */
  getCachedSummary() {
    const summary = {
      lastCalculatedAt: this.cache.lastCalculatedAt,
      lastCalculatedAgoText: this.formatTimeAgo(this.cache.lastCalculatedAt),
      drivers: {}
    };

    for (const [id, d] of Object.entries(this.cache.drivers)) {
      summary.drivers[id] = {
        ...d,
        lastGpsUpdateText: this.formatTimeAgo(d.gps ? d.gps.lastUpdated : null)
      };
    }

    return summary;
  }
}

// Export singleton instance
const trackingService = new TrackingService();
module.exports = {
  TrackingService,
  trackingService
};
