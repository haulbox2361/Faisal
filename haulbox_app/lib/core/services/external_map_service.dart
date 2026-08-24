import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

class ExternalMapService {
  /// Opens Google Maps Navigation directly to the Pickup location
  static Future<void> openNavigateToPickup(String pickupAddress) async {
    await openNavigationToAddress(pickupAddress);
  }

  /// Opens Google Maps Navigation directly to the Delivery location
  static Future<void> openNavigateToDelivery(String deliveryAddress) async {
    await openNavigationToAddress(deliveryAddress);
  }

  /// Opens the phone's installed map/navigation application with the target address
  static Future<void> openNavigationToAddress(String address) async {
    if (address.trim().isEmpty) return;
    final cleanAddr = address.trim();
    final encoded = Uri.encodeComponent(cleanAddr);

    // 1. Try Native Android Google Maps navigation intent
    final googleNavUri = Uri.parse('google.navigation:q=$encoded&mode=d');
    if (!kIsWeb) {
      try {
        if (await canLaunchUrl(googleNavUri)) {
          await launchUrl(googleNavUri, mode: LaunchMode.externalApplication);
          return;
        }
      } catch (_) {}
    }

    // 2. Try Generic Geo URI
    final geoUri = Uri.parse('geo:0,0?q=$encoded');
    if (!kIsWeb) {
      try {
        if (await canLaunchUrl(geoUri)) {
          await launchUrl(geoUri, mode: LaunchMode.externalApplication);
          return;
        }
      } catch (_) {}
    }

    // 3. Fallback to HTTPS Google Maps Web/App Navigation URL
    final httpsUri = Uri.parse('https://www.google.com/maps/dir/?api=1&destination=$encoded');
    try {
      await launchUrl(httpsUri, mode: LaunchMode.externalApplication);
    } catch (e) {
      debugPrint('[ExternalMapService] Failed to open map: $e');
    }
  }

  /// Opens the route between origin and destination
  static Future<void> openRouteNavigation(String origin, String destination) async {
    final encOrigin = Uri.encodeComponent(origin.trim());
    final encDest = Uri.encodeComponent(destination.trim());
    final httpsUri = Uri.parse('https://www.google.com/maps/dir/?api=1&origin=$encOrigin&destination=$encDest');
    try {
      await launchUrl(httpsUri, mode: LaunchMode.externalApplication);
    } catch (e) {
      debugPrint('[ExternalMapService] Failed to open route map: $e');
    }
  }
}
