/**
 * HaulBoX ETA & Load Tracking Engine
 * Provides Haversine distance math, expanded US freight hub coordinates,
 * live OpenStreetMap Nominatim geocoding with caching, multi-stop routing,
 * and automated ETA risk classification.
 */

const https = require('https');

// Approximate coordinates for Major Freight Hubs & Distribution Centers across the US
const CITY_COORDS = {
  // Texas / South Central
  'dallas, tx': { lat: 32.7767, lng: -96.7970 },
  'fort worth, tx': { lat: 32.7555, lng: -97.3308 },
  'arlington, tx': { lat: 32.7357, lng: -97.1081 },
  'houston, tx': { lat: 29.7604, lng: -95.3698 },
  'san antonio, tx': { lat: 29.4241, lng: -98.4936 },
  'austin, tx': { lat: 30.2672, lng: -97.7431 },
  'el paso, tx': { lat: 31.7619, lng: -106.4850 },
  'laredo, tx': { lat: 27.5036, lng: -99.5076 },
  'lubbock, tx': { lat: 33.5779, lng: -101.8552 },
  'amarillo, tx': { lat: 35.2220, lng: -101.8313 },
  'oklahoma city, ok': { lat: 35.4676, lng: -97.5164 },
  'tulsa, ok': { lat: 36.1540, lng: -95.9928 },
  'little rock, ar': { lat: 34.7465, lng: -92.2896 },
  'fort smith, ar': { lat: 35.3859, lng: -94.3985 },
  'new orleans, la': { lat: 29.9511, lng: -90.0715 },
  'baton rouge, la': { lat: 30.4515, lng: -91.1871 },
  'shreveport, la': { lat: 32.5252, lng: -93.7502 },

  // Midwest
  'chicago, il': { lat: 41.8781, lng: -87.6298 },
  'joliet, il': { lat: 41.5250, lng: -88.0817 },
  'rockford, il': { lat: 42.2711, lng: -89.0940 },
  'indianapolis, in': { lat: 39.7684, lng: -86.1581 },
  'gary, in': { lat: 41.5934, lng: -87.3464 },
  'fort wayne, in': { lat: 41.0793, lng: -85.1394 },
  'columbus, oh': { lat: 39.9612, lng: -82.9988 },
  'cleveland, oh': { lat: 41.4993, lng: -81.6944 },
  'cincinnati, oh': { lat: 39.1031, lng: -84.5120 },
  'dayton, oh': { lat: 39.7589, lng: -84.1916 },
  'toledo, oh': { lat: 41.6528, lng: -83.5379 },
  'detroit, mi': { lat: 42.3314, lng: -83.0458 },
  'grand rapids, mi': { lat: 42.9634, lng: -85.6681 },
  'milwaukee, wi': { lat: 43.0389, lng: -87.9065 },
  'madison, wi': { lat: 43.0731, lng: -89.4012 },
  'green bay, wi': { lat: 44.5192, lng: -88.0198 },
  'minneapolis, mn': { lat: 44.9778, lng: -93.2650 },
  'st. paul, mn': { lat: 44.9537, lng: -93.0900 },
  'st. louis, mo': { lat: 38.6270, lng: -90.1994 },
  'kansas city, mo': { lat: 39.0997, lng: -94.5786 },
  'kansas city, ks': { lat: 39.1155, lng: -94.6268 },
  'wichita, ks': { lat: 37.6872, lng: -97.3301 },
  'des moines, ia': { lat: 41.5868, lng: -93.6250 },
  'cedar rapids, ia': { lat: 41.9779, lng: -91.6656 },
  'omaha, ne': { lat: 41.2565, lng: -95.9345 },

  // Southeast
  'atlanta, ga': { lat: 33.7490, lng: -84.3880 },
  'savannah, ga': { lat: 32.0809, lng: -81.0912 },
  'macon, ga': { lat: 32.8407, lng: -83.6324 },
  'miami, fl': { lat: 25.7617, lng: -80.1918 },
  'orlando, fl': { lat: 28.5383, lng: -81.3792 },
  'tampa, fl': { lat: 27.9506, lng: -82.4572 },
  'jacksonville, fl': { lat: 30.3322, lng: -81.6557 },
  'charlotte, nc': { lat: 35.2271, lng: -80.8431 },
  'raleigh, nc': { lat: 35.7796, lng: -78.6382 },
  'greensboro, nc': { lat: 36.0726, lng: -79.7920 },
  'greenville, sc': { lat: 34.8526, lng: -82.3940 },
  'columbia, sc': { lat: 34.0007, lng: -81.0348 },
  'charleston, sc': { lat: 32.7765, lng: -79.9311 },
  'memphis, tn': { lat: 35.1495, lng: -90.0490 },
  'nashville, tn': { lat: 36.1627, lng: -86.7816 },
  'chattanooga, tn': { lat: 35.0456, lng: -85.3097 },
  'knoxville, tn': { lat: 35.9606, lng: -83.9207 },
  'louisville, ky': { lat: 38.2527, lng: -85.7585 },
  'lexington, ky': { lat: 38.0406, lng: -84.5037 },
  'birmingham, al': { lat: 33.5186, lng: -86.8104 },
  'mobile, al': { lat: 30.6954, lng: -88.0399 },
  'huntsville, al': { lat: 34.7304, lng: -86.5861 },
  'jackson, ms': { lat: 32.2988, lng: -90.1848 },

  // Northeast / Mid-Atlantic
  'new york, ny': { lat: 40.7128, lng: -74.0060 },
  'newark, nj': { lat: 40.7357, lng: -74.1724 },
  'jersey city, nj': { lat: 40.7178, lng: -74.0431 },
  'philadelphia, pa': { lat: 39.9526, lng: -75.1652 },
  'allentown, pa': { lat: 40.6084, lng: -75.4902 },
  'harrisburg, pa': { lat: 40.2732, lng: -76.8867 },
  'pittsburgh, pa': { lat: 40.4406, lng: -79.9959 },
  'baltimore, md': { lat: 39.2904, lng: -76.6122 },
  'richmond, va': { lat: 37.5407, lng: -77.4360 },
  'norfolk, va': { lat: 36.8508, lng: -76.2859 },
  'boston, ma': { lat: 42.3601, lng: -71.0589 },

  // Mountain & West
  'denver, co': { lat: 39.7392, lng: -104.9903 },
  'salt lake city, ut': { lat: 40.7608, lng: -111.8910 },
  'phoenix, az': { lat: 33.4484, lng: -112.0740 },
  'tucson, az': { lat: 32.2226, lng: -110.9747 },
  'albuquerque, nm': { lat: 35.0844, lng: -106.6504 },
  'las vegas, nv': { lat: 36.1699, lng: -115.1398 },
  'reno, nv': { lat: 39.5296, lng: -119.8138 },
  'los angeles, ca': { lat: 34.0522, lng: -118.2437 },
  'ontario, ca': { lat: 34.0633, lng: -117.6509 },
  'riverside, ca': { lat: 33.9806, lng: -117.3755 },
  'bakersfield, ca': { lat: 35.3733, lng: -119.0187 },
  'fresno, ca': { lat: 36.7468, lng: -119.7726 },
  'oakland, ca': { lat: 37.8044, lng: -122.2712 },
  'san francisco, ca': { lat: 37.7749, lng: -122.4194 },
  'stockton, ca': { lat: 37.9577, lng: -121.2908 },
  'sacramento, ca': { lat: 38.5816, lng: -121.4944 },
  'seattle, wa': { lat: 47.6062, lng: -122.3321 },
  'tacoma, wa': { lat: 47.2529, lng: -122.4443 },
  'spokane, wa': { lat: 47.6588, lng: -117.4260 },
  'portland, or': { lat: 45.5152, lng: -122.6784 },
  'boise, id': { lat: 43.6150, lng: -116.2023 }
};

// Fallback state centroid coordinates
const STATE_COORDS = {
  AL: { lat: 32.806671, lng: -86.791130 }, AK: { lat: 61.370716, lng: -152.404419 },
  AZ: { lat: 33.729759, lng: -111.431221 }, AR: { lat: 34.969704, lng: -92.373123 },
  CA: { lat: 36.116203, lng: -119.681564 }, CO: { lat: 39.059811, lng: -105.311104 },
  CT: { lat: 41.597782, lng: -72.755371 }, DE: { lat: 39.318523, lng: -75.507141 },
  FL: { lat: 27.766279, lng: -81.686783 }, GA: { lat: 33.040619, lng: -83.643074 },
  ID: { lat: 44.240459, lng: -114.478828 }, IL: { lat: 40.349457, lng: -88.986137 },
  IN: { lat: 39.849426, lng: -86.258278 }, IA: { lat: 42.011539, lng: -93.210526 },
  KS: { lat: 38.526600, lng: -96.726486 }, KY: { lat: 37.668140, lng: -84.670067 },
  LA: { lat: 31.169546, lng: -91.867805 }, ME: { lat: 44.693947, lng: -69.381927 },
  MD: { lat: 39.063946, lng: -76.802101 }, MA: { lat: 42.230171, lng: -71.530106 },
  MI: { lat: 43.326618, lng: -84.536095 }, MN: { lat: 45.694454, lng: -93.900192 },
  MS: { lat: 32.741646, lng: -89.678696 }, MO: { lat: 38.456085, lng: -92.288368 },
  MT: { lat: 46.921925, lng: -110.454353 }, NE: { lat: 41.125370, lng: -98.268082 },
  NV: { lat: 38.313515, lng: -117.055374 }, NH: { lat: 43.452492, lng: -71.563896 },
  NJ: { lat: 40.298960, lng: -74.521011 }, NM: { lat: 34.840515, lng: -106.248482 },
  NY: { lat: 42.165726, lng: -74.948051 }, NC: { lat: 35.630066, lng: -79.806419 },
  ND: { lat: 47.528912, lng: -99.784012 }, OH: { lat: 40.388783, lng: -82.764915 },
  OK: { lat: 35.565342, lng: -96.928917 }, OR: { lat: 44.572021, lng: -122.070938 },
  PA: { lat: 40.590752, lng: -77.209755 }, RI: { lat: 41.680893, lng: -71.511780 },
  SC: { lat: 33.856892, lng: -80.945007 }, SD: { lat: 44.299782, lng: -99.438828 },
  TN: { lat: 35.747845, lng: -86.692345 }, TX: { lat: 31.054487, lng: -97.563461 },
  UT: { lat: 39.320980, lng: -111.093731 }, VT: { lat: 44.045876, lng: -72.710686 },
  VA: { lat: 37.769337, lng: -78.169968 }, WA: { lat: 47.400902, lng: -121.490494 },
  WV: { lat: 38.491226, lng: -80.954453 }, WI: { lat: 44.268543, lng: -89.616508 },
  WY: { lat: 42.755966, lng: -107.302490 }
};

// In-memory geocode cache to avoid redundant network lookups
const GEOCODE_CACHE = new Map();

/**
 * Calculates Haversine distance in miles between two coordinates (lat1, lng1) and (lat2, lng2)
 * Includes a 1.25 road curvature multiplier to reflect actual highway/driving miles.
 */
function haversineMiles(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return 0;
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const directMiles = R * c;
  return Math.round(directMiles * 1.25); // Apply 1.25 road curvature multiplier
}

/**
 * Normalizes an address string for lookup matching
 */
function cleanAddressKey(addrStr) {
  if (!addrStr) return '';
  return String(addrStr)
    .toLowerCase()
    .replace(/[^\w\s,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Synchronous geocode lookup: checks cache, then dictionary, then state centroid
 */
function parseCoordinatesFromAddress(addrStr) {
  if (!addrStr) return null;
  const str = cleanAddressKey(addrStr);

  // 1. Direct match in memory cache
  if (GEOCODE_CACHE.has(str)) {
    return GEOCODE_CACHE.get(str);
  }

  // 2. Match city, state from dictionary
  for (const [key, coords] of Object.entries(CITY_COORDS)) {
    if (str.includes(key)) {
      GEOCODE_CACHE.set(str, coords);
      return coords;
    }
  }

  // 3. Match 2-letter state code
  const stateMatch = str.match(/\b([a-z]{2})\b\s*(\d{5})?$/i) || str.match(/,\s*([a-z]{2})\b/i);
  if (stateMatch) {
    const st = stateMatch[1].toUpperCase();
    if (STATE_COORDS[st]) return STATE_COORDS[st];
  }

  return null;
}

/**
 * Asynchronous Geocoding with OpenStreetMap Nominatim:
 * Resolves real coordinates for small towns/cities not in CITY_COORDS.
 * Caches all results in-memory.
 */
async function geocodeAddressWithLookup(addrStr) {
  if (!addrStr) return null;
  const key = cleanAddressKey(addrStr);

  // Check cache first
  if (GEOCODE_CACHE.has(key)) {
    return GEOCODE_CACHE.get(key);
  }

  // Check dictionary
  for (const [cKey, coords] of Object.entries(CITY_COORDS)) {
    if (key.includes(cKey)) {
      GEOCODE_CACHE.set(key, coords);
      return coords;
    }
  }

  // Clean address for query (e.g. "Broken Arrow, OK" or "100 Main St, Broken Arrow, OK")
  const queryStr = key.replace(/,\s*usa?$/i, '').trim();

  try {
    const coords = await queryNominatim(queryStr);
    if (coords && coords.lat != null && coords.lng != null) {
      GEOCODE_CACHE.set(key, coords);
      return coords;
    }
  } catch (err) {
    // Network/API failure: gracefully proceed to fallback
  }

  // Fallback to synchronous state centroid if network lookup fails
  const fallback = parseCoordinatesFromAddress(addrStr);
  if (fallback) {
    GEOCODE_CACHE.set(key, fallback);
  }
  return fallback;
}

/**
 * Helper to query OpenStreetMap Nominatim with strict timeout
 */
function queryNominatim(query) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(query);
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&countrycodes=us&limit=1`;
    const options = {
      headers: {
        'User-Agent': 'HaulBoX-TMS/1.0 (contact: freight-ops@haulbox.com)',
        'Accept': 'application/json'
      },
      timeout: 3000
    };

    const req = https.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);
          if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].lat && parsed[0].lon) {
            return resolve({
              lat: parseFloat(parsed[0].lat),
              lng: parseFloat(parsed[0].lon)
            });
          }
          resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * Calculates ETA timestamp for a given distance in miles at 55mph average truck speed
 */
function computeEtaTimestamp(miles, fromTime = new Date()) {
  if (!miles || miles <= 0) return fromTime.toISOString();
  const speedMph = 55;
  const drivingHours = miles / speedMph;
  // Add 1 hour mandatory break for every 8 hours of driving
  const totalHours = drivingHours + Math.floor(drivingHours / 8);
  const etaMs = fromTime.getTime() + totalHours * 3600 * 1000;
  return new Date(etaMs).toISOString();
}

/**
 * Formats a Date/ISO string to human readable ETA format (e.g. "Today 4:30 PM", "Tomorrow 8:15 AM", "Aug 15 2:00 PM")
 */
function formatEtaText(isoOrDate) {
  if (!isoOrDate) return 'N/A';
  const d = new Date(isoOrDate);
  if (isNaN(d.getTime())) return String(isoOrDate);

  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  if (isToday) return `Today ${timeStr}`;
  if (isTomorrow) return `Tomorrow ${timeStr}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${timeStr}`;
}

/**
 * Classifies ETA Risk:
 * - 🟢 ON_TIME
 * - 🟡 RUNNING_LATE
 * - 🔴 DELAYED
 * - ⚪ STALE
 */
function classifyEtaRisk(etaIso, appointmentDateStr, appointmentTimeStr, lastUpdatedIso) {
  if (!lastUpdatedIso) return { riskCode: 'STALE', badge: '⚪ Location Stale', text: 'No recent GPS updates' };

  const lastUpdateAgeMs = Date.now() - new Date(lastUpdatedIso).getTime();
  if (lastUpdateAgeMs > 60 * 60 * 1000) {
    return { riskCode: 'DELAYED', badge: '🔴 Delayed', text: 'GPS updated >1 hr ago — contact driver' };
  }
  if (lastUpdateAgeMs > 30 * 60 * 1000) {
    return { riskCode: 'STALE', badge: '⚪ Location Stale', text: 'Last location update >30m ago' };
  }

  if (!appointmentDateStr || !etaIso) {
    return { riskCode: 'ON_TIME', badge: '🟢 On Time', text: 'On schedule' };
  }

  const apptTimePart = appointmentTimeStr || '23:59';
  const apptIsoStr = `${appointmentDateStr}T${apptTimePart}:00`;
  const apptDate = new Date(apptIsoStr);

  if (isNaN(apptDate.getTime())) {
    return { riskCode: 'ON_TIME', badge: '🟢 On Time', text: 'On schedule' };
  }

  const etaDate = new Date(etaIso);
  const diffMinutes = (etaDate.getTime() - apptDate.getTime()) / (60 * 1000);

  if (diffMinutes > 30) {
    return { riskCode: 'DELAYED', badge: '🔴 ETA Risk: Delayed', text: `Expected ${Math.round(diffMinutes)} mins past appointment!` };
  } else if (diffMinutes > 0) {
    return { riskCode: 'RUNNING_LATE', badge: '🟡 ETA Risk: Running Late', text: `Expected ${Math.round(diffMinutes)} mins tight on appointment.` };
  }

  return { riskCode: 'ON_TIME', badge: '🟢 On Time', text: 'On schedule' };
}

/**
 * Normalizes all stops for a load into a single ordered array
 * Supports single-stop (load.pickup / load.dropoff) and multi-stop (load.pickup_stops / load.delivery_stops)
 */
function normalizeLoadStops(load) {
  if (!load) return [];

  const rawPickups = load.pickupStops || load.pickup_stops || [];
  const rawDeliveries = load.deliveryStops || load.delivery_stops || [];

  const stops = [];

  // Pickups
  if (Array.isArray(rawPickups) && rawPickups.length > 0) {
    rawPickups.forEach((s, idx) => {
      const stopNum = s.stop_number || s.stopNumber || (idx + 1);
      const city = s.city || (s.address ? s.address.split(',')[0].trim() : '');
      const state = s.state || (s.address ? (s.address.split(',')[1] || '').trim().slice(0, 2) : '');
      stops.push({
        id: `PU_${stopNum}`,
        type: 'PICKUP',
        stopNumber: stopNum,
        facilityName: s.facility_name || s.facilityName || 'Pickup Facility',
        address: s.address || [city, state].filter(Boolean).join(', ') || load.pickup || '',
        city,
        state,
        scheduledDate: s.scheduled_date || s.scheduledDate || load.pickupDate || null,
        scheduledTime: s.scheduled_time || s.scheduledTime || load.pickupTime || null,
        status: s.status || ((load.status === 'Loaded' || load.status === 'In Transit' || load.status === 'IN_TRANSIT' || load.status === 'Drop-off' || load.status === 'Delivered' || load.driverProgress === 'LOADED' || load.driverProgress === 'IN_TRANSIT' || load.driverProgress === 'DELIVERED') ? 'BOL_APPROVED' : 'PENDING'),
        isCompleted: s.status === 'BOL_APPROVED' || s.status === 'COMPLETED' || load.status === 'Loaded' || load.status === 'In Transit' || load.status === 'IN_TRANSIT' || load.status === 'Drop-off' || load.driverProgress === 'LOADED' || load.driverProgress === 'IN_TRANSIT'
      });
    });
  } else if (load.pickup) {
    const parts = String(load.pickup).split(',');
    const city = parts[0] ? parts[0].trim() : '';
    const state = parts[1] ? parts[1].trim().slice(0, 2) : '';
    const isPuDone = (load.status === 'Loaded' || load.status === 'In Transit' || load.status === 'IN_TRANSIT' || load.status === 'Drop-off' || load.status === 'Delivered' || load.driverProgress === 'LOADED' || load.driverProgress === 'IN_TRANSIT' || load.driverProgress === 'DELIVERED');
    stops.push({
      id: 'PU_1',
      type: 'PICKUP',
      stopNumber: 1,
      facilityName: 'Pickup Facility',
      address: load.pickup,
      city,
      state,
      scheduledDate: load.pickupDate || null,
      scheduledTime: load.pickupTime || null,
      status: isPuDone ? 'BOL_APPROVED' : 'PENDING',
      isCompleted: isPuDone
    });
  }

  // Deliveries
  if (Array.isArray(rawDeliveries) && rawDeliveries.length > 0) {
    rawDeliveries.forEach((s, idx) => {
      const stopNum = s.stop_number || s.stopNumber || (idx + 1);
      const city = s.city || (s.address ? s.address.split(',')[0].trim() : '');
      const state = s.state || (s.address ? (s.address.split(',')[1] || '').trim().slice(0, 2) : '');
      stops.push({
        id: `DEL_${stopNum}`,
        type: 'DELIVERY',
        stopNumber: stopNum,
        facilityName: s.facility_name || s.facilityName || 'Delivery Facility',
        address: s.address || [city, state].filter(Boolean).join(', ') || load.dropoff || '',
        city,
        state,
        scheduledDate: s.scheduled_date || s.scheduledDate || load.deliveryDate || null,
        scheduledTime: s.scheduled_time || s.scheduledTime || load.deliveryTime || null,
        status: s.status || (load.status === 'Drop-off' || load.status === 'Delivered' || load.status === 'DELIVERED' || load.driverProgress === 'DELIVERED' ? 'POD_APPROVED' : 'PENDING'),
        isCompleted: s.status === 'POD_APPROVED' || s.status === 'COMPLETED' || load.status === 'Drop-off' || load.status === 'Delivered' || load.status === 'DELIVERED' || load.driverProgress === 'DELIVERED'
      });
    });
  } else if (load.dropoff) {
    const parts = String(load.dropoff).split(',');
    const city = parts[0] ? parts[0].trim() : '';
    const state = parts[1] ? parts[1].trim().slice(0, 2) : '';
    stops.push({
      id: 'DEL_1',
      type: 'DELIVERY',
      stopNumber: 1,
      facilityName: 'Delivery Facility',
      address: load.dropoff,
      city,
      state,
      scheduledDate: load.deliveryDate || null,
      scheduledTime: load.deliveryTime || null,
      status: (load.status === 'Drop-off' || load.status === 'Delivered' || load.driverProgress === 'DELIVERED') ? 'POD_APPROVED' : 'PENDING',
      isCompleted: (load.status === 'Drop-off' || load.status === 'Delivered' || load.driverProgress === 'DELIVERED')
    });
  }

  return stops;
}

/**
 * Determines the next active stop in the sequence that the truck is heading toward
 */
function determineNextStop(load, stops = []) {
  if (!stops || stops.length === 0) return null;

  // 1. Look for the first uncompleted stop in order
  const pendingStop = stops.find(s => !s.isCompleted);
  if (pendingStop) return pendingStop;

  // 2. If all marked completed or drop-off, return the final delivery stop
  return stops[stops.length - 1];
}

/**
 * Calculates full tracking object for a load and driver location record
 */
function calculateLoadTracking(load, driverLoc) {
  if (!load) return null;

  const currentPos = driverLoc ? {
    lat: Number(driverLoc.latitude || driverLoc.lat),
    lng: Number(driverLoc.longitude || driverLoc.lng),
    speed: driverLoc.speed != null ? Number(driverLoc.speed) : null,
    recordedAt: driverLoc.recorded_at || driverLoc.recordedAt || driverLoc.lastUpdated || new Date().toISOString()
  } : null;

  const stops = normalizeLoadStops(load);
  const nextStop = determineNextStop(load, stops);

  // Resolve coordinates for all stops
  stops.forEach(s => {
    s.coords = parseCoordinatesFromAddress(s.address || `${s.city}, ${s.state}`);
  });

  const nextStopCoords = nextStop ? (nextStop.coords || parseCoordinatesFromAddress(nextStop.address || `${nextStop.city}, ${nextStop.state}`)) : null;

  let milesToNextStop = 0;
  if (currentPos && nextStopCoords && !isNaN(currentPos.lat) && !isNaN(currentPos.lng)) {
    milesToNextStop = haversineMiles(currentPos.lat, currentPos.lng, nextStopCoords.lat, nextStopCoords.lng);
  } else if (load.miles) {
    milesToNextStop = Number(load.miles) || 0;
  }

  const now = currentPos && currentPos.recordedAt ? new Date(currentPos.recordedAt) : new Date();
  const etaIso = computeEtaTimestamp(milesToNextStop, now);
  const etaText = formatEtaText(etaIso);

  const risk = classifyEtaRisk(
    etaIso,
    nextStop ? nextStop.scheduledDate : load.deliveryDate,
    nextStop ? nextStop.scheduledTime : load.deliveryTime,
    currentPos ? currentPos.recordedAt : null
  );

  return {
    loadId: load.id,
    loadNumber: load.loadNumber,
    driverName: load.driverName,
    driverId: load.driverId,
    status: load.status,
    driverProgress: load.driverProgress || 'IN_TRANSIT',
    currentPosition: currentPos,
    stops,
    nextStop: nextStop ? {
      type: nextStop.type,
      stopNumber: nextStop.stopNumber,
      city: nextStop.city,
      state: nextStop.state,
      facilityName: nextStop.facilityName,
      address: nextStop.address,
      coords: nextStopCoords
    } : null,
    milesToNextStop,
    etaIso,
    etaText,
    risk,
    lastUpdateIso: currentPos ? currentPos.recordedAt : null
  };
}

module.exports = {
  haversineMiles,
  cleanAddressKey,
  parseCoordinatesFromAddress,
  geocodeAddressWithLookup,
  queryNominatim,
  computeEtaTimestamp,
  formatEtaText,
  classifyEtaRisk,
  normalizeLoadStops,
  determineNextStop,
  calculateLoadTracking,
  CITY_COORDS,
  STATE_COORDS,
  GEOCODE_CACHE
};
