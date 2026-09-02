import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../shared/widgets/haulbox_card.dart';
import '../../shared/widgets/status_badge.dart';
import 'owner_provider.dart';

class OwnerHomeScreen extends StatefulWidget {
  final Function(int)? onNavigateTab;
  final VoidCallback? onLogout;
  const OwnerHomeScreen({super.key, this.onNavigateTab, this.onLogout});

  @override
  State<OwnerHomeScreen> createState() => _OwnerHomeScreenState();
}

class _OwnerHomeScreenState extends State<OwnerHomeScreen> {
  final _currencyFormat = NumberFormat.currency(symbol: '\$', decimalDigits: 0);

  final List<Map<String, String>> _periods = [
    {'label': 'All Time', 'val': 'all'},
    {'label': 'Today', 'val': 'today'},
    {'label': 'Yesterday', 'val': 'yesterday'},
    {'label': 'This Week', 'val': 'this_week'},
    {'label': 'This Month', 'val': 'this_month'},
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Provider.of<OwnerProvider>(context, listen: false).refreshSummary();
    });
  }

  @override
  Widget build(BuildContext context) {
    final ownerProvider = Provider.of<OwnerProvider>(context);
    final summary = ownerProvider.summary;
    final isLoading = ownerProvider.isLoadingSummary;

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: AppColors.navyDark,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.business_center, color: Colors.white, size: 18),
            ),
            const SizedBox(width: 10),
            const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Owner Dashboard',
                  style: TextStyle(
                    color: AppColors.textDark,
                    fontWeight: FontWeight.w800,
                    fontSize: 17,
                  ),
                ),
                Text(
                  'Executive Fleet & Financial Overview',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontWeight: FontWeight.w500,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: AppColors.navyLight),
            onPressed: () => ownerProvider.refreshSummary(),
          ),
          if (widget.onLogout != null)
            IconButton(
              icon: const Icon(Icons.logout, color: AppColors.navyLight),
              onPressed: widget.onLogout,
            ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.emeraldPrimary,
        onRefresh: () => ownerProvider.refreshSummary(),
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 1. Period Selector Pills
              _buildPeriodSelector(ownerProvider),
              const SizedBox(height: 16),

              if (isLoading && summary == null)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 40),
                    child: CircularProgressIndicator(color: AppColors.emeraldPrimary),
                  ),
                )
              else ...[
                // 2. Financial Overview KPI Card
                _buildFinancialOverviewCard(summary),
                const SizedBox(height: 16),

                // 3. Operational Quick KPIs (Active Loads & Drivers)
                _buildOperationalKpis(summary),
                const SizedBox(height: 16),

                // 4. Driver Availability Summary
                _buildDriverAvailabilityCard(summary),
                const SizedBox(height: 16),

                // 5. Payment Summary Card
                _buildPaymentSummaryCard(summary),
                const SizedBox(height: 20),

                // 6. Active Loads Preview Section
                _buildActiveLoadsPreview(summary),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPeriodSelector(OwnerProvider provider) {
    return SizedBox(
      height: 36,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: _periods.length,
        separatorBuilder: (context, index) => const SizedBox(width: 8),
        itemBuilder: (context, idx) {
          final p = _periods[idx];
          final isSelected = provider.selectedPeriod == p['val'];
          return ChoiceChip(
            label: Text(p['label']!),
            selected: isSelected,
            onSelected: (sel) {
              if (sel) provider.refreshSummary(period: p['val']);
            },
            selectedColor: AppColors.navyDark,
            backgroundColor: Colors.white,
            labelStyle: TextStyle(
              color: isSelected ? Colors.white : AppColors.navyLight,
              fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
              fontSize: 12,
            ),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(18),
              side: BorderSide(
                color: isSelected ? AppColors.navyDark : AppColors.borderLight,
                width: 1,
              ),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 10),
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
          );
        },
      ),
    );
  }

  Widget _buildFinancialOverviewCard(Map<String, dynamic>? s) {
    final double gross = (s?['grossRevenue'] as num?)?.toDouble() ?? 0.0;
    final double pay = (s?['driverPay'] as num?)?.toDouble() ?? 0.0;
    final double profit = (s?['estimatedProfit'] as num?)?.toDouble() ?? 0.0;
    final double margin = (s?['grossMarginPct'] as num?)?.toDouble() ?? 0.0;

    return HaulBoxCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'ESTIMATED FINANCIALS',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.8,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppColors.emeraldSoft,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.emeraldLight),
                ),
                child: Text(
                  'Margin: ${margin.toStringAsFixed(1)}%',
                  style: const TextStyle(
                    color: AppColors.emeraldDark,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Gross Revenue',
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _currencyFormat.format(gross),
                      style: const TextStyle(
                        color: AppColors.textDark,
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
              Container(width: 1, height: 40, color: AppColors.borderSubtle),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Driver Pay',
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _currencyFormat.format(pay),
                      style: const TextStyle(
                        color: Color(0xFFEA580C),
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Divider(height: 1, color: AppColors.divider),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  const Icon(Icons.insights, color: AppColors.emeraldPrimary, size: 18),
                  const SizedBox(width: 6),
                  const Text(
                    'Estimated Profit',
                    style: TextStyle(
                      color: AppColors.textDark,
                      fontWeight: FontWeight.w700,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
              Text(
                _currencyFormat.format(profit),
                style: const TextStyle(
                  color: AppColors.emeraldDark,
                  fontWeight: FontWeight.w900,
                  fontSize: 19,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'Gross Revenue minus Driver Pay. Excludes fuel, tolls & maintenance.',
            style: TextStyle(color: AppColors.textSubtle, fontSize: 10.5),
          ),
        ],
      ),
    );
  }

  Widget _buildOperationalKpis(Map<String, dynamic>? s) {
    final activeLoads = s?['activeLoadsCount'] ?? 0;
    final totalDrivers = s?['totalDrivers'] ?? 0;
    final availableDrivers = s?['availableDrivers'] ?? 0;

    return Row(
      children: [
        Expanded(
          child: HaulBoxCard(
            onTap: () => widget.onNavigateTab?.call(2), // Navigate to Loads tab
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'ACTIVE LOADS',
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 10.5,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.5,
                      ),
                    ),
                    Icon(Icons.local_shipping, size: 16, color: Colors.blue.shade700),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  '$activeLoads',
                  style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w900,
                    color: AppColors.textDark,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'In Transit / Booked',
                  style: TextStyle(fontSize: 11, color: Colors.blue.shade700, fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: HaulBoxCard(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'DRIVERS READY',
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 10.5,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.5,
                      ),
                    ),
                    const Icon(Icons.people, size: 16, color: AppColors.emeraldPrimary),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  '$availableDrivers / $totalDrivers',
                  style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w900,
                    color: AppColors.textDark,
                  ),
                ),
                const SizedBox(height: 4),
                const Text(
                  'Available for Loads',
                  style: TextStyle(fontSize: 11, color: AppColors.emeraldDark, fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildDriverAvailabilityCard(Map<String, dynamic>? s) {
    final avail = s?['driversAvailability'] as Map<String, dynamic>?;
    final int ready = avail?['available'] ?? 0;
    final int onLoad = avail?['onLoad'] ?? 0;
    final int atPickup = avail?['atPickup'] ?? 0;
    final int atDelivery = avail?['atDelivery'] ?? 0;

    return HaulBoxCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'FLEET DRIVER STATUS',
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(height: 14),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _buildStatusPill('Available', '$ready', const Color(0xFF16A34A), const Color(0xFFDCFCE7)),
              _buildStatusPill('On Road', '$onLoad', const Color(0xFF2563EB), const Color(0xFFDBEAFE)),
              _buildStatusPill('At Pickup', '$atPickup', const Color(0xFFD97706), const Color(0xFFFEF3C7)),
              _buildStatusPill('At Delivery', '$atDelivery', const Color(0xFF7C3AED), const Color(0xFFEDE9FE)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStatusPill(String label, String count, Color color, Color bgColor) {
    return Column(
      children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: bgColor,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Center(
            child: Text(
              count,
              style: TextStyle(color: color, fontWeight: FontWeight.w900, fontSize: 18),
            ),
          ),
        ),
        const SizedBox(height: 6),
        Text(
          label,
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w600),
        ),
      ],
    );
  }

  Widget _buildPaymentSummaryCard(Map<String, dynamic>? s) {
    final pay = s?['paymentSummary'] as Map<String, dynamic>?;
    final double readyAmt = (pay?['readyToPayAmount'] as num?)?.toDouble() ?? 0.0;
    final int readyCount = pay?['readyToPayCount'] ?? 0;
    final double paidAmt = (pay?['paidAmount'] as num?)?.toDouble() ?? 0.0;
    final int paidCount = pay?['paidCount'] ?? 0;
    final double disputedAmt = (pay?['disputedAmount'] as num?)?.toDouble() ?? 0.0;
    final int disputedCount = pay?['disputedCount'] ?? 0;

    return HaulBoxCard(
      onTap: () => widget.onNavigateTab?.call(1), // Navigate to Payments tab
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'PAYMENT SUMMARY',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.8,
                ),
              ),
              Row(
                children: [
                  Text(
                    'View Details',
                    style: TextStyle(color: Colors.blue.shade700, fontWeight: FontWeight.w700, fontSize: 12),
                  ),
                  Icon(Icons.chevron_right, size: 16, color: Colors.blue.shade700),
                ],
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF0FDF4),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: const Color(0xFFBBF7D0)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Ready to Pay',
                        style: TextStyle(color: Color(0xFF15803D), fontSize: 11.5, fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _currencyFormat.format(readyAmt),
                        style: const TextStyle(color: Color(0xFF15803D), fontSize: 17, fontWeight: FontWeight.w900),
                      ),
                      Text('$readyCount load(s)', style: const TextStyle(color: Color(0xFF166534), fontSize: 10.5)),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.borderLight),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Total Paid',
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 11.5, fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _currencyFormat.format(paidAmt),
                        style: const TextStyle(color: AppColors.textDark, fontSize: 17, fontWeight: FontWeight.w900),
                      ),
                      Text('$paidCount load(s)', style: const TextStyle(color: AppColors.textSubtle, fontSize: 10.5)),
                    ],
                  ),
                ),
              ),
            ],
          ),

          // Disputed payment warning alert (if any exist)
          if (disputedCount > 0) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF2F2),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xFFFECACA)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.warning_amber_rounded, color: Color(0xFFDC2626), size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Action Required: $disputedCount disputed payment(s) (${_currencyFormat.format(disputedAmt)})',
                      style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 11.5, fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildActiveLoadsPreview(Map<String, dynamic>? s) {
    final List<dynamic> list = s?['activeLoadsPreview'] as List<dynamic>? ?? [];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'ACTIVE LOADS PREVIEW',
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: 11,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.8,
              ),
            ),
            GestureDetector(
              onTap: () => widget.onNavigateTab?.call(2), // Navigate to Loads tab
              child: Text(
                'View All Loads',
                style: TextStyle(color: Colors.blue.shade700, fontWeight: FontWeight.w700, fontSize: 12),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        if (list.isEmpty)
          HaulBoxCard(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 20),
                child: Text(
                  'No active loads currently in progress',
                  style: TextStyle(color: Colors.grey.shade500, fontSize: 13),
                ),
              ),
            ),
          )
        else
          ...list.map((load) {
            final loadNum = load['loadNumber'] ?? 'Load';
            final pickup = load['pickup'] ?? 'Pickup';
            final dropoff = load['dropoff'] ?? 'Dropoff';
            final drv = load['driverName'] ?? 'Unassigned';
            final rate = (load['rate'] as num?)?.toDouble() ?? 0.0;
            final pay = (load['driverPay'] as num?)?.toDouble() ?? 0.0;
            final status = load['status'] ?? 'In Transit';

            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: HaulBoxCard(
                onTap: () => widget.onNavigateTab?.call(2),
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.blue.shade50,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Icon(Icons.route, color: Colors.blue.shade700, size: 20),
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
                                '#$loadNum',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w800,
                                  fontSize: 14,
                                  color: AppColors.textDark,
                                ),
                              ),
                              StatusBadge(status: status, isSmall: true),
                            ],
                          ),
                          const SizedBox(height: 3),
                          Text(
                            '$pickup → $dropoff',
                            style: const TextStyle(
                              color: AppColors.textSecondary,
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                'Driver: $drv',
                                style: const TextStyle(fontSize: 11, color: AppColors.textSubtle),
                              ),
                              Text(
                                '${_currencyFormat.format(rate)} (Pay: ${_currencyFormat.format(pay)})',
                                style: const TextStyle(
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.textDark,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          }),
      ],
    );
  }
}
