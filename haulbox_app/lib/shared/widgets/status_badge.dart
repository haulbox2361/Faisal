import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';

class StatusBadge extends StatelessWidget {
  final String status;
  final bool isSmall;

  const StatusBadge({
    super.key,
    required this.status,
    this.isSmall = false,
  });

  @override
  Widget build(BuildContext context) {
    final s = status.toUpperCase();

    Color bgColor = AppColors.bgSecondary;
    Color textColor = AppColors.navyLight;
    Color dotColor = AppColors.navyLight;

    if (['ACTIVE', 'PAID', 'COMPLETED', 'VERIFIED', 'VALID', 'SUCCESS', 'DELIVERED'].contains(s)) {
      bgColor = AppColors.statusSuccessSoft;
      textColor = AppColors.statusSuccess;
      dotColor = AppColors.statusSuccess;
    } else if (['PENDING', 'WAITING', 'LOADED', 'PROCESSING', 'EXPIRING'].contains(s)) {
      bgColor = AppColors.statusWarningSoft;
      textColor = const Color(0xFFB45309);
      dotColor = AppColors.statusWarning;
    } else if (['CANCELLED', 'REJECTED', 'FAILED', 'EXPIRED', 'ERROR'].contains(s)) {
      bgColor = AppColors.statusDangerSoft;
      textColor = AppColors.statusDanger;
      dotColor = AppColors.statusDanger;
    } else if (['IN TRANSIT', 'GOING_TO_PICKUP', 'ARRIVED_PICKUP', 'GOING_TO_DELIVERY', 'ARRIVED_DELIVERY'].contains(s)) {
      bgColor = AppColors.statusInfoSoft;
      textColor = AppColors.statusInfo;
      dotColor = AppColors.statusInfo;
    }

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: isSmall ? 8 : 10,
        vertical: isSmall ? 3 : 5,
      ),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: textColor.withValues(alpha: 0.2), width: 0.8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: isSmall ? 5 : 6,
            height: isSmall ? 5 : 6,
            decoration: BoxDecoration(
              color: dotColor,
              shape: BoxShape.circle,
            ),
          ),
          SizedBox(width: isSmall ? 4 : 6),
          Text(
            status.replaceAll('_', ' '),
            style: TextStyle(
              color: textColor,
              fontWeight: FontWeight.w800,
              fontSize: isSmall ? 10.5 : 12,
              letterSpacing: 0.3,
            ),
          ),
        ],
      ),
    );
  }
}
