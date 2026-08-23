import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';

enum HaulBoxButtonType { primary, secondary, outline, danger }

class HaulBoxButton extends StatelessWidget {
  final String text;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool isLoading;
  final HaulBoxButtonType type;
  final double? height;

  const HaulBoxButton({
    super.key,
    required this.text,
    required this.onPressed,
    this.icon,
    this.isLoading = false,
    this.type = HaulBoxButtonType.primary,
    this.height = 56,
  });

  @override
  Widget build(BuildContext context) {
    Color bg;
    Color fg;
    BorderSide border = BorderSide.none;

    switch (type) {
      case HaulBoxButtonType.primary:
        bg = AppColors.emeraldPrimary;
        fg = Colors.white;
        break;
      case HaulBoxButtonType.secondary:
        bg = AppColors.bgSecondary;
        fg = AppColors.textDark;
        border = const BorderSide(color: AppColors.borderLight);
        break;
      case HaulBoxButtonType.outline:
        bg = Colors.transparent;
        fg = AppColors.emeraldDark;
        border = const BorderSide(color: AppColors.emeraldPrimary, width: 1.5);
        break;
      case HaulBoxButtonType.danger:
        bg = AppColors.statusDangerSoft;
        fg = AppColors.statusDanger;
        border = BorderSide(color: AppColors.statusDanger.withValues(alpha: 0.3));
        break;
    }

    return SizedBox(
      height: height,
      child: ElevatedButton(
        style: ElevatedButton.styleFrom(
          backgroundColor: bg,
          foregroundColor: fg,
          elevation: 0,
          side: border,
          shape: RoundedRectangleBorder(borderRadius: AppRadius.lgBorder),
          padding: const EdgeInsets.symmetric(horizontal: 18),
        ),
        onPressed: isLoading ? null : onPressed,
        child: isLoading
            ? SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  color: fg,
                ),
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (icon != null) ...[
                    Icon(icon, size: 20, color: fg),
                    const SizedBox(width: 8),
                  ],
                  Text(
                    text,
                    style: TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 15,
                      letterSpacing: 0.2,
                      color: fg,
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}
