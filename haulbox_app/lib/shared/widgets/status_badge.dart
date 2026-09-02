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

    if (['ACTIVE', 'PAID', 'PAID_CONFIRMED', 'COMPLETED', 'VERIFIED', 'VALID', 'SUCCESS', 'DELIVERED'].contains(s)) {
      bgColor = AppColors.statusSuccessSoft;
      textColor = AppColors.statusSuccess;
      dotColor = AppColors.statusSuccess;
    } else if (['READY_TO_PAY'].contains(s)) {
      bgColor = const Color(0xFFE0F2FE);
      textColor = const Color(0xFF0284C7);
      dotColor = const Color(0xFF0284C7);
    } else if (['PENDING', 'UNPAID', 'WAITING', 'LOADED', 'PROCESSING', 'EXPIRING'].contains(s)) {
      bgColor = AppColors.statusWarningSoft;
      textColor = const Color(0xFFB45309);
      dotColor = AppColors.statusWarning;
    } else if (['CANCELLED', 'REJECTED', 'FAILED', 'EXPIRED', 'ERROR', 'PAYMENT_DISPUTED', 'DISPUTED'].contains(s)) {
      bgColor = AppColors.statusDangerSoft;
      textColor = AppColors.statusDanger;
      dotColor = AppColors.statusDanger;
    } else if (['IN TRANSIT', 'GOING_TO_PICKUP', 'ARRIVED_PICKUP', 'GOING_TO_DELIVERY', 'ARRIVED_DELIVERY'].contains(s)) {
      bgColor = AppColors.statusInfoSoft;
      textColor = AppColors.statusInfo;
      dotColor = AppColors.statusInfo;
    }

    String label = status;
    if (s == 'READY_TO_PAY') {
      label = 'Ready to Pay';
    } else if (s == 'PAID_CONFIRMED') {
      label = 'Paid Confirmed';
    } else if (s == 'PAYMENT_DISPUTED') {
      label = 'Disputed';
    } else if (s == 'UNPAID') {
      label = 'Unpaid';
    } else if (s == 'IN TRANSIT') {
      label = 'In Transit';
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
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: textColor,
              fontSize: isSmall ? 10 : 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}
