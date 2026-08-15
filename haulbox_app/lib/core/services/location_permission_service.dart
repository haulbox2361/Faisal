import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../constants/app_colors.dart';
import '../constants/app_radius.dart';

class LocationPermissionService {
  static const String _prefKeyAsked = 'haulbox_location_permission_prompted';
  static const String _prefKeyGranted = 'haulbox_location_permission_granted';

  /// Checks if location permission should be requested on first launch
  static Future<void> checkInitialLocationPermission(BuildContext context) async {
    final prefs = await SharedPreferences.getInstance();
    final hasBeenPrompted = prefs.getBool(_prefKeyAsked) ?? false;

    // If already prompted previously, do not interrupt the driver on app launch
    if (hasBeenPrompted) {
      return;
    }

    // Show initial one-time educational disclosure dialog
    if (context.mounted) {
      _showFirstTimeLocationDialog(context);
    }
  }

  static void _showFirstTimeLocationDialog(BuildContext context) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) {
        return AlertDialog(
          backgroundColor: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: AppRadius.xlBorder),
          title: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: const BoxDecoration(
                  color: AppColors.emeraldSoft,
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.location_on_rounded, color: AppColors.emeraldDark, size: 22),
              ),
              const SizedBox(width: 10),
              const Expanded(
                child: Text(
                  'Location Access',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: AppColors.textDark),
                ),
              ),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'HaulBoX uses your location to calculate accurate arrival ETAs, display remaining route mileage, and launch turn-by-turn navigation to pickup and delivery facilities.',
                style: TextStyle(fontSize: 13.5, color: AppColors.textSecondary, height: 1.45),
              ),
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppColors.bgSecondary,
                  borderRadius: AppRadius.mdBorder,
                ),
                child: const Row(
                  children: [
                    Icon(Icons.shield_outlined, size: 16, color: AppColors.emeraldDark),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Location is only accessed for active trip navigation and route calculations.',
                        style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: AppColors.textDark),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () async {
                final prefs = await SharedPreferences.getInstance();
                await prefs.setBool(_prefKeyAsked, true);
                await prefs.setBool(_prefKeyGranted, false);
                if (ctx.mounted) Navigator.of(ctx).pop();
              },
              child: const Text('Not Now', style: TextStyle(color: AppColors.textMuted, fontWeight: FontWeight.w700)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.emeraldPrimary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              ),
              onPressed: () async {
                final prefs = await SharedPreferences.getInstance();
                await prefs.setBool(_prefKeyAsked, true);
                await prefs.setBool(_prefKeyGranted, true);
                if (ctx.mounted) Navigator.of(ctx).pop();
              },
              child: const Text('Allow While Using App', style: TextStyle(fontWeight: FontWeight.w800)),
            ),
          ],
        );
      },
    );
  }

  /// Called when a location-dependent feature (e.g. navigation) is triggered
  static Future<bool> isLocationEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_prefKeyGranted) ?? true;
  }

  /// Shows friendly denied banner / dialog with Settings button if needed
  static void showPermissionSettingsDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          backgroundColor: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: AppRadius.xlBorder),
          title: const Text('Location Required', style: TextStyle(fontWeight: FontWeight.w800, color: AppColors.textDark)),
          content: const Text(
            'Turn-by-turn navigation and ETA calculations require location access. You can enable it anytime in your device Settings.',
            style: TextStyle(fontSize: 13.5, color: AppColors.textSecondary),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel', style: TextStyle(color: AppColors.textMuted)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.emeraldPrimary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              onPressed: () {
                Navigator.of(ctx).pop();
              },
              child: const Text('OK', style: TextStyle(fontWeight: FontWeight.w800)),
            ),
          ],
        );
      },
    );
  }
}
