import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../shared/widgets/haulbox_card.dart';
import '../../shared/widgets/section_header.dart';

class EarningsScreen extends StatelessWidget {
  const EarningsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Earnings Analytics'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Total Year-to-Date
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF0F172A), Color(0xFF064E3B)],
              ),
              borderRadius: AppRadius.xlBorder,
              border: Border.all(color: AppColors.emeraldPrimary.withValues(alpha: 0.3)),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '2024 YEAR-TO-DATE SETTLEMENT',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.8,
                    color: AppColors.emeraldPrimary,
                  ),
                ),
                SizedBox(height: 6),
                Text(
                  '\$48,920.00',
                  style: TextStyle(
                    fontSize: 32,
                    fontWeight: FontWeight.w900,
                    color: Colors.white,
                    letterSpacing: -1,
                  ),
                ),
                SizedBox(height: 4),
                Text('26 Dispatched Runs Completed • 20,400 Total Miles', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Key Performance Metrics Grid
          Row(
            children: [
              Expanded(
                child: _buildMetricBox(
                  title: 'AVG RATE / MILE',
                  value: '\$2.37',
                  icon: Icons.speed_rounded,
                  color: AppColors.emeraldPrimary,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _buildMetricBox(
                  title: 'AVG LOAD PAY',
                  value: '\$1,881',
                  icon: Icons.account_balance_wallet_outlined,
                  color: AppColors.statusInfo,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Monthly Earnings Bar Chart
          HaulBoxCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionHeader(
                  title: 'Monthly Settlement Breakdown (2024)',
                  icon: Icons.bar_chart_rounded,
                ),
                const SizedBox(height: 16),
                _buildBarChart(),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Top Brokers / Shippers
          HaulBoxCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionHeader(
                  title: 'Top Revenue Generating Brokers',
                  icon: Icons.pie_chart_outline_rounded,
                ),
                const SizedBox(height: 8),
                _buildBrokerRow('Rapid Freight Inc.', 8, '\$14,800', 0.85),
                _buildBrokerRow('TQL Logistics', 6, '\$11,400', 0.65),
                _buildBrokerRow('Coyote Logistics', 5, '\$9,850', 0.55),
                _buildBrokerRow('CH Robinson', 4, '\$7,420', 0.40),
                _buildBrokerRow('Echo Global', 3, '\$5,450', 0.30),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMetricBox({
    required String title,
    required String value,
    required IconData icon,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: AppRadius.lgBorder,
        border: Border.all(color: AppColors.borderDark),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                title,
                style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: AppColors.textSubtle, letterSpacing: 0.5),
              ),
              Icon(icon, size: 16, color: color),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w900,
              color: Colors.white,
              letterSpacing: -0.5,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBarChart() {
    final months = [
      {'month': 'Jan', 'val': 8200, 'pct': 0.70},
      {'month': 'Feb', 'val': 7400, 'pct': 0.62},
      {'month': 'Mar', 'val': 9600, 'pct': 0.82},
      {'month': 'Apr', 'val': 8800, 'pct': 0.75},
      {'month': 'May', 'val': 10400, 'pct': 1.00},
      {'month': 'Jun', 'val': 4520, 'pct': 0.42},
    ];

    return SizedBox(
      height: 160,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: months.map((m) {
          final isMax = m['month'] == 'May';
          return Column(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              Text(
                '\$${((m['val'] as num) / 1000).toStringAsFixed(1)}k',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: isMax ? AppColors.emeraldPrimary : AppColors.textSubtle,
                ),
              ),
              const SizedBox(height: 6),
              Container(
                width: 28,
                height: 100 * (m['pct'] as double),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.bottomCenter,
                    end: Alignment.topCenter,
                    colors: isMax
                        ? [AppColors.emeraldStrong, AppColors.emeraldPrimary]
                        : [AppColors.surfaceDark, const Color(0xFF1E293B)],
                  ),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(
                    color: isMax ? AppColors.emeraldPrimary : AppColors.borderDark,
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                m['month'] as String,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: isMax ? FontWeight.w800 : FontWeight.w500,
                  color: isMax ? Colors.white : AppColors.textMuted,
                ),
              ),
            ],
          );
        }).toList(),
      ),
    );
  }

  Widget _buildBrokerRow(String name, int runs, String total, double pct) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: Colors.white)),
              Text(total, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: AppColors.emeraldPrimary)),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: pct,
                    minHeight: 5,
                    backgroundColor: AppColors.surfaceDark,
                    valueColor: const AlwaysStoppedAnimation<Color>(AppColors.emeraldPrimary),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Text('$runs runs', style: const TextStyle(fontSize: 11, color: AppColors.textSubtle)),
            ],
          ),
        ],
      ),
    );
  }
}
