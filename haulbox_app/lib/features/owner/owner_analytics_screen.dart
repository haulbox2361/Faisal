import 'dart:math';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../shared/widgets/haulbox_card.dart';
import 'owner_provider.dart';

class OwnerAnalyticsScreen extends StatefulWidget {
  const OwnerAnalyticsScreen({super.key});

  @override
  State<OwnerAnalyticsScreen> createState() => _OwnerAnalyticsScreenState();
}

class _OwnerAnalyticsScreenState extends State<OwnerAnalyticsScreen> {
  final _currencyFormat = NumberFormat.currency(symbol: '\$', decimalDigits: 0);

  final List<Map<String, String>> _ranges = [
    {'label': '7 Days', 'val': '7d'},
    {'label': '30 Days', 'val': '30d'},
    {'label': '3 Months', 'val': '3mo'},
    {'label': '12 Months', 'val': '12mo'},
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Provider.of<OwnerProvider>(context, listen: false).refreshAnalytics();
    });
  }

  @override
  Widget build(BuildContext context) {
    final ownerProvider = Provider.of<OwnerProvider>(context);
    final analytics = ownerProvider.analytics;
    final isLoading = ownerProvider.isLoadingAnalytics;

    final avgs = analytics?['businessAverages'] as Map<String, dynamic>?;
    final double revPerLoad = (avgs?['revenuePerLoad'] as num?)?.toDouble() ?? 0.0;
    final double payPerLoad = (avgs?['driverPayPerLoad'] as num?)?.toDouble() ?? 0.0;
    final double profitPerLoad = (avgs?['estimatedProfitPerLoad'] as num?)?.toDouble() ?? 0.0;

    final forecast = analytics?['forecast'] as Map<String, dynamic>?;
    final bool hasReliableForecast = forecast?['hasReliableEstimate'] == true;

    final List<dynamic> timeSeries = analytics?['timeSeries'] as List<dynamic>? ?? [];

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        title: const Text(
          'Business Analytics & Trends',
          style: TextStyle(
            color: AppColors.textDark,
            fontWeight: FontWeight.w800,
            fontSize: 17,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: AppColors.navyLight),
            onPressed: () => ownerProvider.refreshAnalytics(),
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.emeraldPrimary,
        onRefresh: () => ownerProvider.refreshAnalytics(),
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 1. Time Range Selector
              SizedBox(
                height: 36,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: _ranges.length,
                  separatorBuilder: (context, index) => const SizedBox(width: 8),
                  itemBuilder: (context, idx) {
                    final r = _ranges[idx];
                    final isSelected = ownerProvider.selectedAnalyticsRange == r['val'];

                    return ChoiceChip(
                      label: Text(r['label']!),
                      selected: isSelected,
                      onSelected: (sel) {
                        if (sel) ownerProvider.refreshAnalytics(range: r['val']);
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
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    );
                  },
                ),
              ),
              const SizedBox(height: 16),

              if (isLoading && analytics == null)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 40),
                    child: CircularProgressIndicator(color: AppColors.emeraldPrimary),
                  ),
                )
              else ...[
                // 2. Business Averages Card
                HaulBoxCard(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'BUSINESS UNIT ECONOMICS',
                        style: TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.8,
                        ),
                      ),
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          Expanded(
                            child: _buildAvgItem('Avg Rev / Load', _currencyFormat.format(revPerLoad), AppColors.textDark),
                          ),
                          Expanded(
                            child: _buildAvgItem('Avg Pay / Load', _currencyFormat.format(payPerLoad), const Color(0xFFEA580C)),
                          ),
                          Expanded(
                            child: _buildAvgItem('Avg Profit / Load', _currencyFormat.format(profitPerLoad), AppColors.emeraldDark),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),

                // 3. Time-Series Trend Visualization
                _buildTimeSeriesChartCard(timeSeries),
                const SizedBox(height: 16),

                // 4. Honest Projection & Forecast Card
                _buildForecastCard(forecast, hasReliableForecast),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildAvgItem(String label, String value, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(color: AppColors.textSubtle, fontSize: 10.5, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: TextStyle(color: color, fontSize: 15, fontWeight: FontWeight.w900),
        ),
      ],
    );
  }

  Widget _buildTimeSeriesChartCard(List<dynamic> buckets) {
    if (buckets.isEmpty) {
      return HaulBoxCard(
        padding: const EdgeInsets.all(16),
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 20),
            child: Text('No historical trends available for this range', style: TextStyle(color: Colors.grey.shade500, fontSize: 13)),
          ),
        ),
      );
    }

    double maxVal = 1.0;
    for (final b in buckets) {
      final double gross = (b['grossRevenue'] as num?)?.toDouble() ?? 0.0;
      if (gross > maxVal) maxVal = gross;
    }

    return HaulBoxCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'REVENUE & PROFIT TREND',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.8,
                ),
              ),
              Row(
                children: [
                  Container(width: 8, height: 8, decoration: BoxDecoration(color: AppColors.navyDark, borderRadius: BorderRadius.circular(2))),
                  const SizedBox(width: 4),
                  const Text('Revenue', style: TextStyle(fontSize: 10.5, color: AppColors.textSecondary)),
                  const SizedBox(width: 8),
                  Container(width: 8, height: 8, decoration: BoxDecoration(color: AppColors.emeraldPrimary, borderRadius: BorderRadius.circular(2))),
                  const SizedBox(width: 4),
                  const Text('Est. Profit', style: TextStyle(fontSize: 10.5, color: AppColors.textSecondary)),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Bar visualization
          SizedBox(
            height: 140,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: buckets.take(12).map((bucket) {
                final double rev = (bucket['grossRevenue'] as num?)?.toDouble() ?? 0.0;
                final double profit = max(0.0, (bucket['estimatedProfit'] as num?)?.toDouble() ?? 0.0);
                final String label = bucket['period'] ?? '';
                final double revHeight = (rev / maxVal) * 100;
                final double profitHeight = (profit / maxVal) * 100;

                return Column(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Container(
                          width: 8,
                          height: max(4.0, revHeight),
                          decoration: BoxDecoration(
                            color: AppColors.navyDark,
                            borderRadius: BorderRadius.circular(2),
                          ),
                        ),
                        const SizedBox(width: 2),
                        Container(
                          width: 8,
                          height: max(4.0, profitHeight),
                          decoration: BoxDecoration(
                            color: AppColors.emeraldPrimary,
                            borderRadius: BorderRadius.circular(2),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      label.length > 5 ? label.substring(label.length - 5) : label,
                      style: const TextStyle(fontSize: 9.5, color: AppColors.textSubtle),
                    ),
                  ],
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildForecastCard(Map<String, dynamic>? forecast, bool hasReliable) {
    final double estRev = (forecast?['estimatedMonthlyRevenue'] as num?)?.toDouble() ?? 0.0;
    final double estPay = (forecast?['estimatedMonthlyDriverPay'] as num?)?.toDouble() ?? 0.0;
    final double estProfit = (forecast?['estimatedMonthlyProfit'] as num?)?.toDouble() ?? 0.0;
    final String note = forecast?['note'] ?? 'Projections require at least 3 operating days of historical data.';

    return HaulBoxCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'ESTIMATED MONTHLY FORECAST',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.8,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: hasReliable ? AppColors.emeraldSoft : Colors.amber.shade50,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  hasReliable ? 'ESTIMATED' : 'INSUFFICIENT DATA',
                  style: TextStyle(
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                    color: hasReliable ? AppColors.emeraldDark : Colors.amber.shade900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (!hasReliable)
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.amber.shade50,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.amber.shade200),
              ),
              child: Row(
                children: [
                  Icon(Icons.info_outline, color: Colors.amber.shade900, size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      note,
                      style: TextStyle(color: Colors.amber.shade900, fontSize: 11.5, fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            )
          else ...[
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildAvgItem('Est. Monthly Gross', _currencyFormat.format(estRev), AppColors.textDark),
                _buildAvgItem('Est. Driver Pay', _currencyFormat.format(estPay), const Color(0xFFEA580C)),
                _buildAvgItem('Est. Profit', _currencyFormat.format(estProfit), AppColors.emeraldDark),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              note,
              style: const TextStyle(color: AppColors.textSubtle, fontSize: 10.5, fontStyle: FontStyle.italic),
            ),
          ],
        ],
      ),
    );
  }
}
