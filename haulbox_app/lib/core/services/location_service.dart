import 'dart:async';
import 'dart:convert';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:battery_plus/battery_plus.dart';
import '../network/api_client.dart';

enum LocationPermissionState { granted, denied, restricted, undetermined }
enum EtaRiskLevel { onTime, runningLate, delayed, stale }

class DriverLocationUpdate {
  final double latitude;
  final double longitude;
  final double speedMph;
  final double heading;
  final DateTime timestamp;
  final int milesRemaining;
  final String etaText;
  final DateTime etaDateTime;
  final EtaRiskLevel riskLevel;
  final String riskBadge;
  final bool isNearPickup;
  final bool isNearDelivery;

  const DriverLocationUpdate({
    required this.latitude,
    required this.longitude,
    required this.speedMph,
    required this.heading,
    required this.timestamp,
    required this.milesRemaining,
    required this.etaText,
    required this.etaDateTime,
    required this.riskLevel,
    required this.riskBadge,
    this.isNearPickup = false,
    this.isNearDelivery = false,
  });
}

class LocationService {
  static final LocationService _instance = LocationService._internal();
  factory LocationService() => _instance;
  LocationService._internal();

  bool _isTracking = false;
  StreamSubscription<Position>? _positionStream;
  LocationPermissionState _permissionState = LocationPermissionState.undetermined;

  final StreamController<DriverLocationUpdate> _locationController =
      StreamController<DriverLocationUpdate>.broadcast();

  Stream<DriverLocationUpdate> get locationStream => _locationController.stream;
  bool get isTracking => _isTracking;
  LocationPermissionState get permissionState => _permissionState;

  final Battery _battery = Battery();
  String? _currentLoadId;
  String? _currentToken;

  Future<bool> requestLocationPermission() async {
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      _permissionState = LocationPermissionState.denied;
      return false;
    }

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        _permissionState = LocationPermissionState.denied;
        return false;
      }
    }
    
    if (permission == LocationPermission.deniedForever) {
      _permissionState = LocationPermissionState.denied;
      return false;
    }

    _permissionState = LocationPermissionState.granted;
    return true;
  }

  Future<void> startTripTracking({
    required String loadId,
    required String token,
  }) async {
    if (_isTracking) return;

    final hasPermission = await requestLocationPermission();
    if (!hasPermission) return;

    _isTracking = true;
    _currentLoadId = loadId;
    _currentToken = token;

    try {
      final initialPos = await Geolocator.getCurrentPosition();
      _handleNewPosition(initialPos);
    } catch (_) {}

    final locationSettings = const LocationSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 50, // Update every 50 meters
    );

    _positionStream = Geolocator.getPositionStream(locationSettings: locationSettings)
        .listen((Position position) {
      _handleNewPosition(position);
    });
    
    Timer.periodic(const Duration(minutes: 5), (timer) async {
      if (!_isTracking) {
        timer.cancel();
        return;
      }
      try {
        final pos = await Geolocator.getCurrentPosition();
        _handleNewPosition(pos);
      } catch (_) {}
    });
  }

  EtaRiskLevel _parseRiskLevel(String? riskCode) {
    if (riskCode == 'DELAYED') return EtaRiskLevel.delayed;
    if (riskCode == 'RUNNING_LATE') return EtaRiskLevel.runningLate;
    if (riskCode == 'STALE') return EtaRiskLevel.stale;
    return EtaRiskLevel.onTime;
  }

  Future<void> _handleNewPosition(Position position) async {
    if (_currentToken == null || !_isTracking) return;

    int? batteryLevel;
    try {
      batteryLevel = await _battery.batteryLevel;
    } catch (_) {}

    final speedMph = position.speed * 2.23694;

    final data = {
      'latitude': position.latitude,
      'longitude': position.longitude,
      'speed': speedMph,
      'heading': position.heading,
      'timestamp': DateTime.now().toUtc().toIso8601String(),
      'batteryLevel': batteryLevel,
      'loadId': _currentLoadId,
    };

    final response = await ApiClient.updateLocation(_currentToken!, data);
    
    if (response == null) {
      await _cacheLocationOffline(data);
    } else {
      await _syncOfflineLocations();

      final tracking = response['tracking'];
      if (tracking != null) {
        final update = DriverLocationUpdate(
          latitude: position.latitude,
          longitude: position.longitude,
          speedMph: speedMph,
          heading: position.heading,
          timestamp: DateTime.now(),
          milesRemaining: tracking['milesRemaining']?.toInt() ?? 0,
          etaText: (tracking['milesToPickup'] != null && tracking['milesToPickup'] > 0) 
            ? tracking['etaPickupText'] ?? '' 
            : tracking['etaDeliveryText'] ?? '',
          etaDateTime: DateTime.tryParse(tracking['etaDeliveryIso'] ?? '') ?? DateTime.now(),
          riskLevel: _parseRiskLevel(tracking['risk']?['riskCode']),
          riskBadge: tracking['risk']?['badge'] ?? '🟢 On Time',
          isNearPickup: (tracking['milesToPickup'] != null && tracking['milesToPickup'] <= 0.3),
          isNearDelivery: (tracking['milesToDelivery'] != null && tracking['milesToDelivery'] <= 0.3),
        );
        _locationController.add(update);
      }
    }
  }

  Future<void> _cacheLocationOffline(Map<String, dynamic> data) async {
    final prefs = await SharedPreferences.getInstance();
    final cached = prefs.getStringList('offline_locations') ?? [];
    cached.add(jsonEncode(data));
    await prefs.setStringList('offline_locations', cached);
  }

  Future<void> _syncOfflineLocations() async {
    if (_currentToken == null) return;
    final prefs = await SharedPreferences.getInstance();
    final cached = prefs.getStringList('offline_locations') ?? [];
    if (cached.isEmpty) return;

    List<Map<String, dynamic>> toSync = cached.map((e) => jsonDecode(e) as Map<String, dynamic>).toList();
    final success = await ApiClient.syncOfflineLocations(_currentToken!, toSync);
    if (success) {
      await prefs.remove('offline_locations');
    }
  }

  void stopTripTracking() {
    _isTracking = false;
    _positionStream?.cancel();
    _positionStream = null;
    _currentLoadId = null;
  }

  void dispose() {
    stopTripTracking();
    _locationController.close();
  }
}
