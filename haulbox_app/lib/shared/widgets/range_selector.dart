import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../models/date_range_filter.dart';

class RangeSelector extends StatelessWidget {
  final DateRangeFilterType selectedType;
  final DateTimeRange? customRange;
  final void Function(DateRangeFilterType type, DateTimeRange? customRange) onRangeChanged;

  const RangeSelector({
    super.key,
    required this.selectedType,
    this.customRange,
    required this.onRangeChanged,
  });

  Future<void> _handleCustomDatePick(BuildContext context) async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime(2030),
      initialDateRange: customRange ?? DateTimeRange(
        start: now.subtract(const Duration(days: 7)),
        end: now,
      ),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.light(
              primary: AppColors.emeraldPrimary,
              onPrimary: Colors.white,
              surface: Colors.white,
              onSurface: AppColors.textDark,
            ),
          ),
          child: child!,
        );
      },
    );

    if (picked != null) {
      onRangeChanged(DateRangeFilterType.custom, picked);
    }
  }

  @override
  Widget build(BuildContext context) {
    final displayText = DateRangeHelper.getDisplayText(selectedType, customRange: customRange);

    return PopupMenuButton<DateRangeFilterType>(
      tooltip: 'Select Date Range',
      offset: const Offset(0, 48),
      elevation: 6,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: AppColors.borderLight),
      ),
      onSelected: (DateRangeFilterType type) {
        if (type == DateRangeFilterType.custom) {
          _handleCustomDatePick(context);
        } else {
          onRangeChanged(type, null);
        }
      },
      itemBuilder: (BuildContext context) {
        return [
          _buildPopupItem(DateRangeFilterType.thisWeek, 'This Week'),
          _buildPopupItem(DateRangeFilterType.lastWeek, 'Last Week'),
          _buildPopupItem(DateRangeFilterType.thisMonth, 'This Month'),
          _buildPopupItem(DateRangeFilterType.lastMonth, 'Last Month'),
          _buildPopupItem(DateRangeFilterType.allTime, 'All Time'),
          const PopupMenuDivider(height: 1),
          _buildPopupItem(DateRangeFilterType.custom, 'Custom Date', isCustom: true),
        ];
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.borderLight, width: 1),
          boxShadow: [
            BoxShadow(
              color: const Color(0xFF0F172A).withValues(alpha: 0.02),
              blurRadius: 6,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                const Icon(Icons.calendar_month_outlined, size: 16, color: AppColors.emeraldPrimary),
                const SizedBox(width: 8),
                Text(
                  'Range: ',
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary,
                  ),
                ),
                Text(
                  displayText,
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textDark,
                  ),
                ),
              ],
            ),
            const Icon(
              Icons.keyboard_arrow_down_rounded,
              size: 20,
              color: AppColors.textSecondary,
            ),
          ],
        ),
      ),
    );
  }

  PopupMenuItem<DateRangeFilterType> _buildPopupItem(DateRangeFilterType type, String label, {bool isCustom = false}) {
    final isSelected = selectedType == type;

    return PopupMenuItem<DateRangeFilterType>(
      value: type,
      height: 40,
      padding: const EdgeInsets.symmetric(horizontal: 14),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.emeraldLight : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 18,
              child: isSelected
                  ? const Icon(Icons.check_rounded, size: 16, color: AppColors.emeraldPrimary)
                  : (isCustom ? const Icon(Icons.edit_calendar_rounded, size: 14, color: AppColors.textSubtle) : null),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: isSelected ? FontWeight.w800 : FontWeight.w600,
                  color: isSelected ? AppColors.emeraldPrimary : AppColors.textDark,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
