import 'package:flutter/material.dart';

class AppColors {
  // 1. PRIMARY — HAULBOX EMERALD (#16A34A)
  static const Color emeraldPrimary = Color(0xFF16A34A);
  static const Color emeraldDark = Color(0xFF15803D);
  static const Color emeraldLight = Color(0xFFDCFCE7);
  static const Color emeraldSoft = Color(0xFFF0FDF4);
  static const Color emeraldStrong = Color(0xFF16A34A);
  static const Color buttonStartTrip = Color(0xFF16A34A);

  // 2. PRIMARY DARK — NAVY (#0F172A) & SECONDARY NAVY (#1E293B)
  static const Color navyDark = Color(0xFF0F172A);
  static const Color navySecondary = Color(0xFF1E293B);
  static const Color navyLight = Color(0xFF334155);

  // 3. BACKGROUNDS: #F1F5F9 (Cool Light Gray App Bg) & #FFFFFF (Card Bg)
  static const Color bgLight = Color(0xFFF1F5F9);
  static const Color bgCard = Color(0xFFFFFFFF);
  static const Color bgSecondary = Color(0xFFE2E8F0);
  static const Color bgSurface = Color(0xFFFFFFFF);

  // 4. TEXT COLORS
  static const Color textDark = Color(0xFF0F172A);
  static const Color textPrimary = Color(0xFF0F172A);
  static const Color textSecondary = Color(0xFF64748B);
  static const Color textMuted = Color(0xFF64748B);
  static const Color textSubtle = Color(0xFF94A3B8);
  static const Color textWhite = Color(0xFFFFFFFF);

  // 5. BORDERS (#CBD5E1) & DIVIDERS
  static const Color borderLight = Color(0xFFCBD5E1);
  static const Color borderSubtle = Color(0xFFE2E8F0);
  static const Color divider = Color(0xFFE2E8F0);

  // 6. STATUS COLORS
  // Success (#16A34A)
  static const Color statusSuccess = Color(0xFF16A34A);
  static const Color statusSuccessSoft = Color(0xFFDCFCE7);

  // Warning (#F59E0B)
  static const Color statusWarning = Color(0xFFF59E0B);
  static const Color statusWarningSoft = Color(0xFFFEF3C7);

  // Error (#DC2626)
  static const Color statusDanger = Color(0xFFDC2626);
  static const Color statusDangerSoft = Color(0xFFFEE2E2);

  // Info (#2563EB)
  static const Color statusInfo = Color(0xFF2563EB);
  static const Color statusInfoSoft = Color(0xFFDBEAFE);

  // Backward-compatible aliases for whole codebase
  static const Color primary = emeraldPrimary;
  static const Color primaryDark = navyDark;
  static const Color background = bgLight;
  static const Color card = bgCard;
  static const Color surface = bgSecondary;
  static const Color textLight = textDark;
  static const Color cardDark = bgCard;
  static const Color surfaceDark = bgSecondary;
  static const Color borderDark = borderLight;
}
