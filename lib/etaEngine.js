/**
 * HaulBoX ETA & Load Tracking Engine
 * Provides Haversine distance math, US city/state geocoordinate fallbacks,
 * real-time miles remaining math, and automated ETA risk classification.
 */

// Approximate coordinates for US State Capitals & Major Freight Hubs
const CITY_COORDS = {
  'dallas, tx': { lat: 32.7767, lng: -96.7970 },
  'fort worth, tx': { lat: 32.7555, lng: -97.3308 },
  'houston, tx': { lat: 29.7604, lng: -95.3698 },
  'san antonio, tx': { lat: 29.4241, lng: -98.4936 },
  'austin, tx': { lat: 30.2672, lng: -97.7431 },
  'el paso, tx': { lat: 31.7619, lng: -106.4850 },
  'chicago, il': { lat: 41.8781, lng: -87.6298 },
  'atlanta, ga': { lat: 33.7490, lng: -84.3880 },
  'los angeles, ca': { lat: 34.0522, lng: -118.2437 },
  'ontario, ca': { lat: 34.0633, lng: -117.6509 },
  'phoenix, az': { lat: 33.4484, lng: -112.0740 },
  'denver, co': { lat: 39.7392, lng: -104.9903 },
  'miami, fl': { lat: 25.7617, lng: -80.1918 },
  'jacksonville, fl': { lat: 30.3322, lng: -81.6557 },
  'memphis, tn': { lat: 35.1495, lng: -90.0490 },
  'nashville, tn': { lat: 36.1627, lng: -86.7816 },
  'indianapolis, in': { lat: 39.7684, lng: -86.1581 },
  'columbus, oh': { lat: 39.9612, lng: -82.9988 },
  'kansas city, mo': { lat: 39.0997, lng: -94.5786 },
  'st. louis, mo': { lat: 38.6270, lng: -90.1994 },
  'seattle, wa': { lat: 47.6062, lng: -122.3321 },
  'portland, or': { lat: 45.5152, lng: -122.6784 },
  'las vegas, nv': { lat: 36.1699, lng: -115.1398 },
  'salt lake city, ut': { lat: 40.7608, lng: -111.8910 },
  'minneapolis, mn': { lat: 44.9778, lng: -93.2650 },
  'detroit, mi': { lat: 42.3314, lng: -83.0458 },
  'charlotte, nc': { lat: 35.2271, lng: -80.8431 },
  'philadelphia, pa': { lat: 39.9526, lng: -75.1652 },
  'new york, ny': { lat: 40.7128, lng: -74.0060 },
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

/**
 * Calculates Haversine distance in miles between two coordinates (lat1, lng1) and (lat2, lng2)
 * Includes a 1.25 road curvature multiplier to reflect actual driving miles.
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
 * Geocodes an address string to { lat, lng } using city & state lookup tables
 */
function parseCoordinatesFromAddress(addrStr) {
  if (!addrStr) return null;
  const str = String(addrStr).toLowerCase().trim();

  // Try matching city, state
  for (const [key, coords] of Object.entries(CITY_COORDS)) {
    if (str.includes(key)) return coords;
  }

  // Try matching state code (e.g. TX, IL, CA)
  const stateMatch = str.match(/\b([a-z]{2})\b\s*(\d{5})?$/i) || str.match(/,\s*([a-z]{2})\b/i);
  if (stateMatch) {
    const st = stateMatch[1].toUpperCase();
    if (STATE_COORDS[st]) return STATE_COORDS[st];
  }

  return null;
}

/**
 * Calculates ETA timestamp for a given distance in miles at 55mph average truck speed
 */
function computeEtaTimestamp(miles, fromTime = new Date()) {
  if (!miles || miles <= 0) return fromTime.toISOString();
  const speedMph = 55;
  const drivingHours = miles / speedMph;
  // Add 1 hour break for every 8 hours of driving
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
 * - 🔴 DELAYED (Missed appointment risk / location >60m stale)
 * - ⚪ STALE (Location >30m old)
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

  // Parse appointment cutoff date/time
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
 * Calculates full tracking object for a load and driver location record
 */
function calculateLoadTracking(load, driverLoc) {
  if (!load) return null;
  const currentPos = driverLoc ? { lat: driverLoc.latitude, lng: driverLoc.longitude, recordedAt: driverLoc.recorded_at } : null;

  const puCoords = parseCoordinatesFromAddress(load.pickup);
  const doCoords = parseCoordinatesFromAddress(load.dropoff);

  let milesToPickup = 0;
  let milesToDelivery = Number(load.miles) || 0;
  let totalRemainingMiles = Number(load.miles) || 0;

  if (currentPos && puCoords) {
    milesToPickup = haversineMiles(currentPos.lat, currentPos.lng, puCoords.lat, puCoords.lng);
  }
  if (currentPos && doCoords) {
    milesToDelivery = haversineMiles(currentPos.lat, currentPos.lng, doCoords.lat, doCoords.lng);
    totalRemainingMiles = milesToDelivery;
  }

  const now = currentPos ? new Date(currentPos.recordedAt) : new Date();
  const etaPickupIso = computeEtaTimestamp(milesToPickup, now);
  const etaDeliveryIso = computeEtaTimestamp(totalRemainingMiles, now);

  const pickupRisk = classifyEtaRisk(etaPickupIso, load.pickupDate, load.pickupTime, currentPos ? currentPos.recordedAt : null);
  const deliveryRisk = classifyEtaRisk(etaDeliveryIso, load.deliveryDate, load.deliveryTime, currentPos ? currentPos.recordedAt : null);

  const overallRisk = (deliveryRisk.riskCode === 'DELAYED' || pickupRisk.riskCode === 'DELAYED') ? deliveryRisk
                    : (deliveryRisk.riskCode === 'RUNNING_LATE' || pickupRisk.riskCode === 'RUNNING_LATE') ? deliveryRisk
                    : (deliveryRisk.riskCode === 'STALE') ? deliveryRisk
                    : pickupRisk;

  return {
    loadId: load.id,
    loadNumber: load.loadNumber,
    driverName: load.driverName,
    driverId: load.driverId,
    status: load.status,
    driverProgress: load.driverProgress || 'ASSIGNED',
    currentPosition: currentPos,
    pickupLocation: load.pickup,
    deliveryLocation: load.dropoff,
    pickupCoords: puCoords,
    deliveryCoords: doCoords,
    milesToPickup,
    milesToDelivery,
    milesRemaining: totalRemainingMiles,
    etaPickupIso,
    etaPickupText: formatEtaText(etaPickupIso),
    etaDeliveryIso,
    etaDeliveryText: formatEtaText(etaDeliveryIso),
    risk: overallRisk,
    lastUpdateIso: currentPos ? currentPos.recordedAt : null,
  };
}

module.exports = {
  haversineMiles,
  parseCoordinatesFromAddress,
  computeEtaTimestamp,
  formatEtaText,
  classifyEtaRisk,
  calculateLoadTracking,
};
