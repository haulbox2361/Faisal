/**
 * tests/test_gps_eta_tracking.js
 * Verification test for simplified GPS tracking and 15-minute cached ETA pipeline.
 */

const assert = require('assert');
const etaEngine = require('../lib/etaEngine');
const { TrackingService } = require('../lib/trackingService');

async function runTests() {
  console.log('--- Starting GPS & ETA Tracking Pipeline Verification ---\n');

  // Test 1: City Coordinates and Haversine Distance
  console.log('Test 1: Haversine distance and geocoding');
  const dallasCoords = etaEngine.parseCoordinatesFromAddress('Dallas, TX');
  const okcCoords = etaEngine.parseCoordinatesFromAddress('Oklahoma City, OK');
  assert(dallasCoords && dallasCoords.lat, 'Dallas coordinates should resolve');
  assert(okcCoords && okcCoords.lat, 'Oklahoma City coordinates should resolve');

  const dist = etaEngine.haversineMiles(dallasCoords.lat, dallasCoords.lng, okcCoords.lat, okcCoords.lng);
  console.log(`  Dallas to OKC driving distance (with curvature): ${dist} miles`);
  assert(dist > 200 && dist < 280, `Expected distance ~240-260 miles, got ${dist}`);
  console.log('  ✓ Test 1 passed\n');

  // Test 2: ETA Computation with break times
  console.log('Test 2: ETA computation (55 mph truck speed)');
  const now = new Date('2026-09-02T12:00:00Z');
  const etaIso = etaEngine.computeEtaTimestamp(220, now);
  const etaDate = new Date(etaIso);
  const diffHours = (etaDate.getTime() - now.getTime()) / (3600 * 1000);
  console.log(`  220 miles ETA: ${diffHours.toFixed(2)} hours`);
  assert(diffHours === 4, `Expected exactly 4 hours for 220 miles at 55mph, got ${diffHours}`);
  console.log('  ✓ Test 2 passed\n');

  // Test 3: Stop normalization for Single-Stop load
  console.log('Test 3: Stop normalization for Single-Stop load');
  const singleStopLoad = {
    id: 'load_1',
    loadNumber: 'HL-1001',
    pickup: 'Dallas, TX',
    dropoff: 'Indianapolis, IN',
    status: 'In Transit',
    driverProgress: 'IN_TRANSIT'
  };
  const singleStops = etaEngine.normalizeLoadStops(singleStopLoad);
  assert.strictEqual(singleStops.length, 2, 'Single-stop load must produce exactly 2 stops');
  assert.strictEqual(singleStops[0].type, 'PICKUP', 'Stop 1 must be PICKUP');
  assert.strictEqual(singleStops[1].type, 'DELIVERY', 'Stop 2 must be DELIVERY');

  const singleNextStop = etaEngine.determineNextStop(singleStopLoad, singleStops);
  assert.strictEqual(singleNextStop.type, 'DELIVERY', 'For an In-Transit load, next stop must be DELIVERY');
  console.log(`  Single-stop next stop: ${singleNextStop.type} (${singleNextStop.city})`);
  console.log('  ✓ Test 3 passed\n');

  // Test 4: Stop normalization for Multi-Stop load
  console.log('Test 4: Stop normalization for Multi-Stop load');
  const multiStopLoad = {
    id: 'load_2',
    loadNumber: 'HL-1002',
    pickupStops: [
      { stop_number: 1, city: 'Dallas', state: 'TX', address: 'Dallas, TX', status: 'BOL_APPROVED' },
      { stop_number: 2, city: 'Fort Worth', state: 'TX', address: 'Fort Worth, TX', status: 'PENDING' }
    ],
    deliveryStops: [
      { stop_number: 1, city: 'Oklahoma City', state: 'OK', address: 'Oklahoma City, OK', status: 'PENDING' },
      { stop_number: 2, city: 'Kansas City', state: 'MO', address: 'Kansas City, MO', status: 'PENDING' }
    ],
    status: 'Booked',
    driverProgress: 'ASSIGNED'
  };
  const multiStops = etaEngine.normalizeLoadStops(multiStopLoad);
  assert.strictEqual(multiStops.length, 4, 'Multi-stop load must produce 4 stops');
  assert.strictEqual(multiStops.filter(s => s.type === 'PICKUP').length, 2, 'Should have 2 pickups');
  assert.strictEqual(multiStops.filter(s => s.type === 'DELIVERY').length, 2, 'Should have 2 deliveries');

  // Since Pickup 1 is BOL_APPROVED, next stop must be Pickup Stop 2
  const multiNextStop = etaEngine.determineNextStop(multiStopLoad, multiStops);
  assert.strictEqual(multiNextStop.type, 'PICKUP', 'Next stop should be Pickup Stop 2');
  assert.strictEqual(multiNextStop.stopNumber, 2, 'Next stop number should be 2');
  assert.strictEqual(multiNextStop.city, 'Fort Worth', 'Next stop city should be Fort Worth');
  console.log(`  Multi-stop next stop: ${multiNextStop.type} #${multiNextStop.stopNumber} in ${multiNextStop.city}`);
  console.log('  ✓ Test 4 passed\n');

  // Test 5: TrackingService Cache & Live GPS Update
  console.log('Test 5: TrackingService cache and live GPS updating');
  const trackingService = new TrackingService({ intervalMs: 15 * 60 * 1000 });
  assert.strictEqual(trackingService.isRunning, false, 'Should start in stopped state');

  // Simulate caching
  trackingService.cache = {
    lastCalculatedAt: new Date().toISOString(),
    drivers: {
      'drv_test': {
        driverId: 'drv_test',
        driverName: 'Test Driver',
        truck: 'Truck #99',
        hasGps: true,
        gps: { lat: 32.7767, lng: -96.7970, speed: 60, lastUpdated: new Date().toISOString() },
        loadId: 'load_1',
        nextStop: { type: 'DELIVERY', stopNumber: 1, city: 'Indianapolis', state: 'IN' },
        milesToNextStop: 820,
        etaText: 'Tomorrow 9:30 AM',
        lastGpsUpdateText: 'Just now'
      }
    },
    loads: {}
  };

  const summary = trackingService.getCachedSummary();
  assert(summary.drivers['drv_test'], 'Summary must include test driver');
  assert.strictEqual(summary.drivers['drv_test'].milesToNextStop, 820);
  assert.strictEqual(summary.drivers['drv_test'].etaText, 'Tomorrow 9:30 AM');

  // Simulate live GPS update (truck moves to new coordinate)
  trackingService.recordLiveGpsUpdate('drv_test', { latitude: 33.1000, longitude: -96.5000, speed: 65 });
  const updatedGps = trackingService.cache.drivers['drv_test'].gps;
  assert.strictEqual(updatedGps.lat, 33.1000, 'Latitude must update');
  assert.strictEqual(updatedGps.lng, -96.5000, 'Longitude must update');
  assert.strictEqual(updatedGps.speed, 65, 'Speed must update');
  // ETA should remain cached and untouched by the live telemetry tick
  assert.strictEqual(trackingService.cache.drivers['drv_test'].etaText, 'Tomorrow 9:30 AM', 'ETA must remain preserved from 15-min cache');

  console.log('  ✓ Test 5 passed\n');

  // Test 6: Fallback and Nominatim caching
  console.log('Test 6: Fallback geocoding dictionary & memory cache');
  etaEngine.GEOCODE_CACHE.set('smalltown, tx', { lat: 31.5, lng: -98.5 });
  const cachedLookup = etaEngine.parseCoordinatesFromAddress('Smalltown, TX');
  assert.deepStrictEqual(cachedLookup, { lat: 31.5, lng: -98.5 }, 'Cached lookup must return coordinates');
  console.log('  ✓ Test 6 passed\n');

  console.log('=== ALL TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
