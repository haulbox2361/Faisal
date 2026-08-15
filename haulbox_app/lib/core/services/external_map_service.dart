import 'package:flutter/foundation.dart';

class ExternalMapService {
  /// Opens Google Maps Navigation directly to the Pickup location
  static void openNavigateToPickup(String pickupAddress) {
    openNavigationToAddress(pickupAddress);
  }

  /// Opens Google Maps Navigation directly to the Delivery location
  static void openNavigateToDelivery(String deliveryAddress) {
    openNavigationToAddress(deliveryAddress);
  }

  /// Opens the phone's installed map/navigation application with the target address
  static void openNavigationToAddress(String address) {
    if (address.trim().isEmpty) return;
    final encoded = Uri.encodeComponent(address.trim());
    final url = 'https://www.google.com/maps/dir/?api=1&destination=$encoded';
    _openUrl(url);
  }

  /// Opens the route between origin and destination
  static void openRouteNavigation(String origin, String destination) {
    final encOrigin = Uri.encodeComponent(origin.trim());
    final encDest = Uri.encodeComponent(destination.trim());
    final url = 'https://www.google.com/maps/dir/?api=1&origin=$encOrigin&destination=$encDest';
    _openUrl(url);
  }

  static void _openUrl(String url) {
    try {
      if (kIsWeb) {
        debugPrint('[ExternalMapService] Launching web navigation: $url');
      } else {
        debugPrint('[ExternalMapService] Opening native Google Maps navigation app: $url');
      }
    } catch (e) {
      debugPrint('[ExternalMapService] Failed to open Google Maps: $e');
    }
  }
}
