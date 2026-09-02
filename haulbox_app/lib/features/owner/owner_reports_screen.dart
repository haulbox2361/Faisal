import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../shared/widgets/haulbox_card.dart';
import 'owner_provider.dart';

class OwnerReportsScreen extends StatefulWidget {
  const OwnerReportsScreen({super.key});

  @override
  State<OwnerReportsScreen> createState() => _OwnerReportsScreenState();
}

class _OwnerReportsScreenState extends State<OwnerReportsScreen> {
  final _currencyFormat = NumberFormat.currency(symbol: '\$', decimalDigits: 0);

  final List<Map<String, String>> _periods = [
    {'label': 'This Month', 'val': 'this_month'},
    {'label': 'This Week', 'val': 'this_week'},
    {'label': 'Today', 'val': 'today'},
    {'label': 'Yesterday', 'val': 'yesterday'},
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Provider.of<OwnerProvider>(context, listen: false).refreshReports();
    });
  }

  @override
  Widget build(BuildContext context) {
    final ownerProvider = Provider.of<OwnerProvider>(context);
    final reports = ownerProvider.reports;
    final isLoading = ownerProvider.isLoadingReports;

    final summary = reports?['summary'] as Map<String, dynamic>?;
    final double gross = (summary?['grossRevenue'] as num?)?.toDouble() ?? 0.0;
    final double pay = (summary?['driverPay'] as num?)?.toDouble() ?? 0.0;
    final double profit = (summary?['estimatedProfit'] as num?)?.toDouble() ?? 0.0;
    final double margin = (summary?['grossMarginPct'] as num?)?.toDouble() ?? 0.0;
    final int totalLoads = summary?['totalLoads'] ?? 0;

    final statusCounts = reports?['statusCounts'] as Map<String, dynamic>? ?? {};
    final List<dynamic> drivers = reports?['driverBreakdown'] as List<dynamic>? ?? [];

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        title: const Text(
          'Financial & Fleet Reports',
          style: TextStyle(
            color: AppColors.textDark,
            fontWeight: FontWeight.w800,
            fontSize: 17,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: AppColors.navyLight),
            onPressed: () => ownerProvider.refreshReports(),
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.emeraldPrimary,
        onRefresh: () => ownerProvider.refreshReports(),
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 1. Period Selector Pills
              SizedBox(
                height: 36,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: _periods.length,
                  separatorBuilder: (context, index) => const SizedBox(width: 8),
                  itemBuilder: (context, idx) {
                    final p = _periods[idx];
                    final isSelected = ownerProvider.selectedReportPeriod == p['val'];
                    return ChoiceChip(
                      label: Text(p['label']!),
                      selected: isSelected,
                      onSelected: (sel) {
                        if (sel) ownerProvider.refreshReports(period: p['val']);
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
              ),
              const SizedBox(height: 16),

              if (isLoading && reports == null)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 40),
                    child: CircularProgressIndicator(color: AppColors.emeraldPrimary),
                  ),
                )
              else ...[
                // 2. Financial Summary Card
                HaulBoxCard(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text(
                            'PERIOD FINANCIAL SUMMARY',
                            style: TextStyle(
                              color: AppColors.textSecondary,
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.8,
                            ),
                          ),
                          Text(
                            '$totalLoads Loads Total',
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12, color: AppColors.navyDark),
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
                                const Text('Gross Revenue', style: TextStyle(color: AppColors.textSecondary, fontSize: 11.5)),
                                const SizedBox(height: 4),
                                Text(
                                  _currencyFormat.format(gross),
                                  style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 19, color: AppColors.textDark),
                                ),
                              ],
                            ),
                          ),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('Driver Pay', style: TextStyle(color: AppColors.textSecondary, fontSize: 11.5)),
                                const SizedBox(height: 4),
                                Text(
                                  _currencyFormat.format(pay),
                                  style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 19, color: Color(0xFFEA580C)),
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
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Estimated Profit', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: AppColors.textDark)),
                              Text(
                                'Margin: ${margin.toStringAsFixed(1)}%',
                                style: const TextStyle(color: AppColors.textSubtle, fontSize: 11),
                              ),
                            ],
                          ),
                          Text(
                            _currencyFormat.format(profit),
                            style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 20, color: AppColors.emeraldDark),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),

                // 3. Load Activity Summary Grid
                HaulBoxCard(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'LOAD ACTIVITY BY LIFECYCLE',
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
                          _buildActivityCol('Booked', '${statusCounts['booked'] ?? 0}', Colors.blue.shade700),
                          _buildActivityCol('Loaded', '${statusCounts['loaded'] ?? 0}', Colors.orange.shade800),
                          _buildActivityCol('Delivered', '${statusCounts['delivered'] ?? 0}', AppColors.emeraldDark),
                          _buildActivityCol('Cancelled', '${statusCounts['cancelled'] ?? 0}', Colors.red.shade700),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),

                // 4. Per-Driver Breakdown Section
                const Text(
                  'DRIVER PERFORMANCE BREAKDOWN',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.8,
                  ),
                ),
                const SizedBox(height: 10),
                if (drivers.isEmpty)
                  HaulBoxCard(
                    child: Center(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 20),
                        child: Text(
                          'No driver activity recorded for this period',
                          style: TextStyle(color: Colors.grey.shade500, fontSize: 13),
                        ),
                      ),
                    ),
                  )
                else
                  ...drivers.map((drv) {
                    final name = drv['driverName'] ?? 'Driver';
                    final truck = drv['truck'] ?? 'Truck';
                    final int loadsCount = drv['loadsCount'] ?? 0;
                    final double dGross = (drv['grossRevenue'] as num?)?.toDouble() ?? 0.0;
                    final double dPay = (drv['driverPay'] as num?)?.toDouble() ?? 0.0;
                    final double dProfit = (drv['estimatedProfit'] as num?)?.toDouble() ?? 0.0;
                    final double dMargin = (drv['grossMarginPct'] as num?)?.toDouble() ?? 0.0;

                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: HaulBoxCard(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  name,
                                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, color: AppColors.textDark),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: AppColors.bgLight,
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Text(
                                    '$loadsCount load(s)',
                                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 11, color: AppColors.navyDark),
                                  ),
                                ),
                              ],
                            ),
                            Text('Truck: $truck', style: const TextStyle(color: AppColors.textSecondary, fontSize: 11.5)),
                            const Padding(
                              padding: EdgeInsets.symmetric(vertical: 8),
                              child: Divider(height: 1, color: AppColors.divider),
                            ),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                _buildMiniDriverStat('Gross', _currencyFormat.format(dGross), AppColors.textDark),
                                _buildMiniDriverStat('Driver Pay', _currencyFormat.format(dPay), const Color(0xFFEA580C)),
                                _buildMiniDriverStat('Est. Profit', _currencyFormat.format(dProfit), AppColors.emeraldDark),
                                _buildMiniDriverStat('Margin', '${dMargin.toStringAsFixed(1)}%', AppColors.navyDark),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildActivityCol(String label, String count, Color color) {
    return Column(
      children: [
        Text(count, style: TextStyle(color: color, fontSize: 20, fontWeight: FontWeight.w900)),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11.5, fontWeight: FontWeight.w600)),
      ],
    );
  }

  Widget _buildMiniDriverStat(String label, String value, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppColors.textSubtle, fontSize: 10)),
        const SizedBox(height: 2),
        Text(value, style: TextStyle(color: color, fontWeight: FontWeight.w800, fontSize: 12.5)),
      ],
    );
  }
}
