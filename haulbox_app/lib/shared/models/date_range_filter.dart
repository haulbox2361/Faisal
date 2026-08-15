import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

enum DateRangeFilterType {
  thisWeek,
  lastWeek,
  thisMonth,
  lastMonth,
  allTime,
  custom,
}

class DateRangeHelper {
  static DateTimeRange calculateRange(DateRangeFilterType type, {DateTimeRange? customRange}) {
    final now = DateTime.now();
    final todayEnd = DateTime(now.year, now.month, now.day, 23, 59, 59);

    switch (type) {
      case DateRangeFilterType.thisWeek:
        // Current Monday 00:00:00 -> Today 23:59:59
        final thisMonday = DateTime(now.year, now.month, now.day).subtract(Duration(days: now.weekday - DateTime.monday));
        return DateTimeRange(
          start: DateTime(thisMonday.year, thisMonday.month, thisMonday.day, 0, 0, 0),
          end: todayEnd,
        );

      case DateRangeFilterType.lastWeek:
        // Previous Monday 00:00:00 -> Previous Sunday 23:59:59
        final thisMonday = DateTime(now.year, now.month, now.day).subtract(Duration(days: now.weekday - DateTime.monday));
        final lastMonday = thisMonday.subtract(const Duration(days: 7));
        final lastSunday = thisMonday.subtract(const Duration(days: 1));
        return DateTimeRange(
          start: DateTime(lastMonday.year, lastMonday.month, lastMonday.day, 0, 0, 0),
          end: DateTime(lastSunday.year, lastSunday.month, lastSunday.day, 23, 59, 59),
        );

      case DateRangeFilterType.thisMonth:
        // 1st of Current Month 00:00:00 -> Today 23:59:59
        return DateTimeRange(
          start: DateTime(now.year, now.month, 1, 0, 0, 0),
          end: todayEnd,
        );

      case DateRangeFilterType.lastMonth:
        // 1st of Previous Month 00:00:00 -> Last day of Previous Month 23:59:59
        final prevYear = now.month == 1 ? now.year - 1 : now.year;
        final prevMonth = now.month == 1 ? 12 : now.month - 1;
        return DateTimeRange(
          start: DateTime(prevYear, prevMonth, 1, 0, 0, 0),
          end: DateTime(now.year, now.month, 0, 23, 59, 59),
        );

      case DateRangeFilterType.allTime:
        return DateTimeRange(
          start: DateTime(2000, 1, 1),
          end: DateTime(2100, 12, 31),
        );

      case DateRangeFilterType.custom:
        if (customRange != null) {
          return DateTimeRange(
            start: DateTime(customRange.start.year, customRange.start.month, customRange.start.day, 0, 0, 0),
            end: DateTime(customRange.end.year, customRange.end.month, customRange.end.day, 23, 59, 59),
          );
        }
        return DateTimeRange(start: DateTime(2000, 1, 1), end: DateTime(2100, 12, 31));
    }
  }

  static String getDisplayText(DateRangeFilterType type, {DateTimeRange? customRange}) {
    switch (type) {
      case DateRangeFilterType.thisWeek:
        return 'This Week';
      case DateRangeFilterType.lastWeek:
        return 'Last Week';
      case DateRangeFilterType.thisMonth:
        return 'This Month';
      case DateRangeFilterType.lastMonth:
        return 'Last Month';
      case DateRangeFilterType.allTime:
        return 'All Time';
      case DateRangeFilterType.custom:
        if (customRange != null) {
          final df = DateFormat('MMM d');
          return '${df.format(customRange.start)} – ${df.format(customRange.end)}';
        }
        return 'Custom Date';
    }
  }

  static DateTime parseFlexibleDate(String dateStr) {
    try {
      return DateFormat('MMMM d, yyyy').parse(dateStr);
    } catch (_) {
      try {
        return DateFormat('MMM d, yyyy').parse(dateStr);
      } catch (_) {
        try {
          return DateTime.parse(dateStr);
        } catch (_) {
          return DateTime.now();
        }
      }
    }
  }
}
