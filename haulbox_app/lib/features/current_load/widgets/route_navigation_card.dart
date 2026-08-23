import 'package:flutter/material.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_radius.dart';
import '../../../core/services/external_map_service.dart';
import '../../../shared/models/load_model.dart';

class RouteNavigationCard extends StatelessWidget {
  final LoadModel load;

  const RouteNavigationCard({super.key, required this.load});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadius.xlBorder,
        border: Border.all(color: AppColors.borderLight),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.route_outlined, size: 20, color: AppColors.emeraldDark),
                  SizedBox(width: 8),
                  Text(
                    'TRIP ROUTE & STOPS',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w900,
                      color: AppColors.emeraldDark,
                      letterSpacing: 0.6,
                    ),
                  ),
                ],
              ),
              if (load.miles != null && (load.miles ?? 0) > 0)
                Text(
                  '${load.miles} Total Miles',
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textSubtle,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 16),

          // 1. PICKUP STOP
          _buildStopRow(
            context: context,
            isOrigin: true,
            title: '1. ORIGIN / PICKUP',
            cityState: load.pickup,
            facilityName: load.pickupContact ?? 'Shipper Loading Facility',
            address: load.pickupAddress ?? '${load.pickup}, United States',
            dateTime: '${load.pickupDate} • ${load.pickupTime}',
          ),

          // Vertical dotted connector line
          Padding(
            padding: const EdgeInsets.only(left: 15),
            child: Container(
              height: 28,
              width: 2,
              decoration: const BoxDecoration(
                color: AppColors.borderLight,
              ),
            ),
          ),

          // 2. DROPOFF STOP
          _buildStopRow(
            context: context,
            isOrigin: false,
            title: '2. DESTINATION / DELIVERY',
            cityState: load.dropoff,
            facilityName: load.dropoffContact ?? 'Consignee Receiving Dock',
            address: load.dropoffAddress ?? '${load.dropoff}, United States',
            dateTime: '${load.deliveryDate} • ${load.deliveryTime}',
          ),
        ],
      ),
    );
  }

  Widget _buildStopRow({
    required BuildContext context,
    required bool isOrigin,
    required String title,
    required String cityState,
    required String facilityName,
    required String address,
    required String dateTime,
  }) {
    final pinColor = isOrigin ? AppColors.emeraldPrimary : AppColors.statusInfo;
    final pinIcon = isOrigin ? Icons.radio_button_checked : Icons.location_on_rounded;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          margin: const EdgeInsets.only(top: 2),
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(
            color: pinColor.withValues(alpha: 0.15),
            shape: BoxShape.circle,
          ),
          child: Icon(pinIcon, size: 18, color: pinColor),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w800,
                      color: pinColor,
                      letterSpacing: 0.5,
                    ),
                  ),
                  Text(
                    dateTime,
                    style: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textMuted,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 2),
              Text(
                cityState,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textDark,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                facilityName,
                style: const TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textMuted,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                address,
                style: const TextStyle(
                  fontSize: 11.5,
                  color: AppColors.textSubtle,
                ),
              ),
              const SizedBox(height: 8),
              // Map Launcher Button
              InkWell(
                onTap: () => ExternalMapService.openNavigationToAddress(address),
                borderRadius: BorderRadius.circular(8),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: AppColors.bgSecondary,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.borderLight),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.near_me_outlined, size: 14, color: AppColors.emeraldDark),
                      SizedBox(width: 5),
                      Text(
                        'Open Navigation Map',
                        style: TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.emeraldDark,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
