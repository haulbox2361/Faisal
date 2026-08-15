import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../shared/models/truck_model.dart';
import '../../shared/widgets/haulbox_card.dart';
import '../../shared/widgets/section_header.dart';
import '../../shared/widgets/status_badge.dart';

class TruckInfoScreen extends StatelessWidget {
  final TruckModel truck;

  const TruckInfoScreen({super.key, required this.truck});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('${truck.truckNumber} Information'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // 1. Truck Hero Header Card
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: AppColors.surfaceDark,
              borderRadius: AppRadius.xlBorder,
              border: Border.all(color: AppColors.borderDark),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.emeraldSoft,
                        borderRadius: AppRadius.mdBorder,
                      ),
                      child: const Icon(Icons.local_shipping_rounded, color: AppColors.emeraldPrimary, size: 28),
                    ),
                    const StatusBadge(status: 'ACTIVE RUNNING'),
                  ],
                ),
                const SizedBox(height: 14),
                Text(
                  '${truck.year} ${truck.make} ${truck.model}',
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: -0.3),
                ),
                const SizedBox(height: 2),
                Text(
                  'Unit: ${truck.truckNumber} • License Plate: ${truck.licensePlate} (${truck.state})',
                  style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // 2. Equipment Specifications Card
          HaulBoxCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionHeader(
                  title: 'Vehicle & Engine Specifications',
                  icon: Icons.speed_rounded,
                ),
                const SizedBox(height: 6),
                _buildSpecRow('Vehicle Identification (VIN)', truck.vin),
                _buildSpecRow('Current Odometer Mileage', truck.mileage),
                _buildSpecRow('Fuel Type', 'Ultra-Low Sulfur Diesel (DEF)'),
                _buildSpecRow('ELD Hardware ID', 'HBX-ELD-4091'),
                _buildSpecRow('Transponder (PrePass)', 'PASS-77281'),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // 3. Equipment Compliance & Permits
          HaulBoxCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionHeader(
                  title: 'Apportioned Permits & Compliance',
                  icon: Icons.verified_outlined,
                ),
                const SizedBox(height: 6),
                _buildComplianceTile('Vehicle Cab Card Registration', truck.registrationExpiry, true),
                _buildComplianceTile('Annual DOT Safety Inspection', truck.annualInspectionExpiry, true),
                _buildComplianceTile('IFTA Decals & License', truck.iftaExpiry, true),
                _buildComplianceTile('Commercial Truck Insurance', truck.insuranceExpiry, true),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildComplianceTile(String title, String expiry, bool isValid) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: AppRadius.mdBorder,
        border: Border.all(color: AppColors.borderDark),
      ),
      child: Row(
        children: [
          Icon(
            isValid ? Icons.check_circle_rounded : Icons.warning_rounded,
            size: 18,
            color: isValid ? AppColors.emeraldPrimary : AppColors.statusWarning,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: Colors.white)),
                Text('Valid Thru: $expiry', style: const TextStyle(fontSize: 11.5, color: AppColors.textMuted)),
              ],
            ),
          ),
          const StatusBadge(status: 'VALID', isSmall: true),
        ],
      ),
    );
  }

  Widget _buildSpecRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 13, color: AppColors.textMuted)),
          Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Colors.white)),
        ],
      ),
    );
  }
}
