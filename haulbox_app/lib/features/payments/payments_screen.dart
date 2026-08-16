import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../shared/models/date_range_filter.dart';
import '../../shared/models/payment_model.dart';
import '../../shared/widgets/haulbox_card.dart';
import '../../shared/widgets/range_selector.dart';
import '../../shared/widgets/status_badge.dart';
import '../auth/auth_provider.dart';
import 'payment_detail_screen.dart';

class PaymentsScreen extends StatefulWidget {
  const PaymentsScreen({super.key});

  @override
  State<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<PaymentsScreen> {
  // Default range is This Week (Current Monday -> Today)
  DateRangeFilterType _selectedDateRange = DateRangeFilterType.thisWeek;
  DateTimeRange? _customDateRange;
  String _selectedStatusFilter = 'ALL';
  String _searchQuery = '';
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  // Filter payments by date range, status, and search query
  List<PaymentModel> _filterPayments(List<PaymentModel> allPayments) {
    final range = DateRangeHelper.calculateRange(_selectedDateRange, customRange: _customDateRange);

    // 1. Date Range Filter
    List<PaymentModel> list = allPayments.where((p) {
      final pDate = p.parsedDate;
      return pDate.isAfter(range.start.subtract(const Duration(seconds: 1))) &&
          pDate.isBefore(range.end.add(const Duration(seconds: 1)));
    }).toList();

    // 2. Status Filter
    if (_selectedStatusFilter == 'PAID') {
      list = list.where((p) => p.status.toUpperCase() == 'PAID').toList();
    } else if (_selectedStatusFilter == 'PENDING') {
      list = list.where((p) => p.status.toUpperCase() == 'PENDING').toList();
    } else if (_selectedStatusFilter == 'PROCESSING') {
      list = list.where((p) => p.status.toUpperCase() == 'PROCESSING').toList();
    }

    // 3. Search Query Filter
    if (_searchQuery.trim().isNotEmpty) {
      final q = _searchQuery.toLowerCase().trim();
      list = list.where((p) {
        final numMatch = p.loadNumber.toLowerCase().contains(q);
        final brokerMatch = p.broker.toLowerCase().contains(q);
        final statusMatch = p.status.toLowerCase().contains(q);
        final amountMatch = p.amount.toString().contains(q);
        return numMatch || brokerMatch || statusMatch || amountMatch;
      }).toList();
    }

    return list;
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final allPayments = auth.payments;

    // Payments in selected date range (for hero earnings card)
    final range = DateRangeHelper.calculateRange(_selectedDateRange, customRange: _customDateRange);
    final periodPayments = allPayments.where((p) {
      final pDate = p.parsedDate;
      return pDate.isAfter(range.start.subtract(const Duration(seconds: 1))) &&
          pDate.isBefore(range.end.add(const Duration(seconds: 1)));
    }).toList();

    final filteredList = _filterPayments(allPayments);

    // Dynamic Earnings calculation based on selected period
    final periodTotalEarnings = periodPayments
        .where((p) => p.status.toUpperCase() == 'PAID')
        .fold<double>(0.0, (sum, p) => sum + p.amount);

    final periodCompletedLoads = periodPayments.where((p) => p.status.toUpperCase() == 'PAID').length;

    final periodPendingAmount = periodPayments
        .where((p) => ['PENDING', 'PROCESSING'].contains(p.status.toUpperCase()))
        .fold<double>(0.0, (sum, p) => sum + p.amount);

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        title: const Text(
          'Payments',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: -0.4),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () => auth.syncAllData(),
        color: AppColors.emeraldPrimary,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            // 1. DYNAMIC EARNINGS HERO SUMMARY CARD (Navy #0F172A)
            _buildEarningsSummaryCard(periodTotalEarnings, periodCompletedLoads, periodPendingAmount),
            const SizedBox(height: 14),

            // 2. UNIFIED RANGE SELECTOR DROPDOWN (Same control across Loads & Payments)
            RangeSelector(
              selectedType: _selectedDateRange,
              customRange: _customDateRange,
              onRangeChanged: (type, custom) {
                setState(() {
                  _selectedDateRange = type;
                  _customDateRange = custom;
                });
              },
            ),
            const SizedBox(height: 12),

            // 3. SEARCH & STATUS FILTER CHIPS
            _buildSearchBar(),
            const SizedBox(height: 10),
            _buildStatusFilterChips(),
            const SizedBox(height: 14),

            // 4. PAYMENT TRANSACTIONS LIST
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'PAYMENT TRANSACTIONS (${filteredList.length})',
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textSubtle,
                    letterSpacing: 0.6,
                  ),
                ),
                Text(
                  DateRangeHelper.getDisplayText(_selectedDateRange, customRange: _customDateRange).toUpperCase(),
                  style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: AppColors.emeraldDark),
                ),
              ],
            ),
            const SizedBox(height: 8),

            if (filteredList.isEmpty)
              _buildEmptyState()
            else
              ...filteredList.map((payment) => _buildPaymentRowCard(context, payment)),
          ],
        ),
      ),
    );
  }

  // 1. DYNAMIC EARNINGS SUMMARY HERO CARD (Navy #0F172A Premium Anchor)
  Widget _buildEarningsSummaryCard(double totalEarnings, int completedLoads, double pendingAmount) {
    final periodName = DateRangeHelper.getDisplayText(_selectedDateRange, customRange: _customDateRange);

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.navyDark,
        borderRadius: AppRadius.xlBorder,
        border: Border.all(color: const Color(0xFF1E293B)),
        boxShadow: [
          BoxShadow(
            color: AppColors.navyDark.withValues(alpha: 0.15),
            blurRadius: 14,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'TOTAL EARNINGS',
                style: TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  color: Color(0xFF94A3B8),
                  letterSpacing: 0.6,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppColors.emeraldPrimary.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.emeraldPrimary.withValues(alpha: 0.4), width: 0.8),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.check_circle_outline, size: 12, color: AppColors.emeraldPrimary),
                    const SizedBox(width: 4),
                    Text(
                      '$completedLoads Completed Loads',
                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: Color(0xFF4ADE80)),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            '\$${totalEarnings.toStringAsFixed(2)}',
            style: const TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.w900,
              color: Colors.white,
              letterSpacing: -0.8,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            periodName,
            style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8), fontWeight: FontWeight.w600),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 10),
            child: Divider(color: Color(0xFF334155), height: 1),
          ),
          Row(
            children: [
              Expanded(
                child: _buildNavyMetricCol('Settled (Paid)', '\$${totalEarnings.toStringAsFixed(2)}', const Color(0xFF4ADE80)),
              ),
              Container(width: 1, height: 28, color: const Color(0xFF334155)),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(left: 14),
                  child: _buildNavyMetricCol('Pending Settlement', '\$${pendingAmount.toStringAsFixed(2)}', const Color(0xFFFBBF24)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildNavyMetricCol(String label, String value, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8), fontWeight: FontWeight.w600)),
        const SizedBox(height: 1),
        Text(value, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: color)),
      ],
    );
  }

  // 3. SEARCH BAR
  Widget _buildSearchBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadius.lgBorder,
        border: Border.all(color: AppColors.borderLight),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: TextField(
        controller: _searchController,
        onChanged: (val) => setState(() => _searchQuery = val),
        decoration: InputDecoration(
          icon: const Icon(Icons.search_rounded, color: AppColors.textMuted, size: 20),
          hintText: 'Search payments by Load #, Broker...',
          hintStyle: const TextStyle(color: AppColors.textSubtle, fontSize: 13),
          border: InputBorder.none,
          suffixIcon: _searchQuery.isNotEmpty
              ? IconButton(
                  icon: const Icon(Icons.clear_rounded, size: 16, color: AppColors.textSubtle),
                  onPressed: () {
                    _searchController.clear();
                    setState(() => _searchQuery = '');
                  },
                )
              : null,
        ),
      ),
    );
  }

  // 4. STATUS FILTER CHIPS
  Widget _buildStatusFilterChips() {
    final filters = ['ALL', 'PAID', 'PENDING', 'PROCESSING'];

    return Row(
      children: filters.map((filter) {
        final isSelected = _selectedStatusFilter == filter;
        return Padding(
          padding: const EdgeInsets.only(right: 8),
          child: GestureDetector(
            onTap: () => setState(() => _selectedStatusFilter = filter),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: isSelected ? AppColors.emeraldPrimary : Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: isSelected ? AppColors.emeraldPrimary : AppColors.borderLight,
                ),
              ),
              child: Text(
                filter,
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: isSelected ? FontWeight.w800 : FontWeight.w600,
                  color: isSelected ? Colors.white : AppColors.textDark,
                ),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  // 5. PAYMENT TRANSACTION ROW CARD
  Widget _buildPaymentRowCard(BuildContext context, PaymentModel payment) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadius.lgBorder,
        border: Border.all(color: AppColors.borderLight),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: AppRadius.lgBorder,
        child: InkWell(
          borderRadius: AppRadius.lgBorder,
          onTap: () {
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => PaymentDetailScreen(payment: payment),
              ),
            );
          },
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                // Icon Avatar
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: payment.status == 'PAID' ? AppColors.emeraldSoft : AppColors.bgSecondary,
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: Icon(
                      payment.status == 'PAID' ? Icons.check_circle_outline_rounded : Icons.schedule_rounded,
                      color: payment.status == 'PAID' ? AppColors.emeraldDark : const Color(0xFFD97706),
                      size: 22,
                    ),
                  ),
                ),
                const SizedBox(width: 12),

                // Load Info
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        payment.loadNumber,
                        style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800, color: AppColors.textDark),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${payment.broker} • ${payment.date}',
                        style: const TextStyle(fontSize: 11.5, color: AppColors.textMuted),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        payment.paymentMethod,
                        style: const TextStyle(fontSize: 11, color: AppColors.textSubtle),
                      ),
                    ],
                  ),
                ),

                // Amount & Status Badge
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      '\$${payment.amount.toStringAsFixed(2)}',
                      style: const TextStyle(
                        fontSize: 15.5,
                        fontWeight: FontWeight.w900,
                        color: AppColors.emeraldDark,
                      ),
                    ),
                    const SizedBox(height: 4),
                    StatusBadge(status: payment.status, isSmall: true),
                  ],
                ),
                const SizedBox(width: 4),
                const Icon(Icons.chevron_right_rounded, color: AppColors.textSubtle, size: 20),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    final periodName = DateRangeHelper.getDisplayText(_selectedDateRange, customRange: _customDateRange);

    return HaulBoxCard(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Center(
          child: Column(
            children: [
              const Icon(Icons.receipt_long_outlined, size: 42, color: AppColors.textSubtle),
              const SizedBox(height: 10),
              Text(
                'No payments found for $periodName',
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: AppColors.textDark),
              ),
              const SizedBox(height: 4),
              const Text(
                'Try selecting a different date range or status filter.',
                style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
