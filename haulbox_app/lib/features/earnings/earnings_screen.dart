import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../shared/models/payment_model.dart';
import '../../shared/widgets/haulbox_card.dart';
import '../../shared/widgets/section_header.dart';
import '../auth/auth_provider.dart';

class EarningsScreen extends StatefulWidget {
  const EarningsScreen({super.key});

  @override
  State<EarningsScreen> createState() => _EarningsScreenState();
}

class _EarningsScreenState extends State<EarningsScreen> {
  bool _isRefreshing = false;

  Future<void> _refresh(AuthProvider auth) async {
    if (_isRefreshing) return;
    setState(() => _isRefreshing = true);
    await auth.syncAllData(silent: true);
    if (mounted) setState(() => _isRefreshing = false);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final payments = auth.payments;

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        title: const Text(
          'Earnings',
          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18, letterSpacing: -0.3),
        ),
        centerTitle: true,
        elevation: 0,
        backgroundColor: Colors.white,
        foregroundColor: AppColors.textPrimary,
        actions: [
          IconButton(
            icon: _isRefreshing
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.emeraldPrimary),
                  )
                : const Icon(Icons.refresh_rounded),
            onPressed: () => _refresh(auth),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => _refresh(auth),
        child: payments.isEmpty ? _buildEmptyState() : _buildContent(payments),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.all(24),
                decoration: const BoxDecoration(color: AppColors.emeraldSoft, shape: BoxShape.circle),
                child: const Icon(Icons.account_balance_wallet_outlined, size: 52, color: AppColors.emeraldPrimary),
              ),
              const SizedBox(height: 20),
              const Text('No Earnings Yet',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: AppColors.textDark)),
              const SizedBox(height: 8),
              const Text(
                'Your settlement history will appear here\nonce you have completed loads.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13.5, color: AppColors.textMuted, height: 1.5),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildContent(List<PaymentModel> payments) {
    final double totalEarnings = payments.fold(0.0, (s, p) => s + p.amount);
    final paidList = payments.where((p) => p.status == 'PAID' || p.status == 'PAID_CONFIRMED').toList();
    final pendingList = payments.where((p) => p.status != 'PAID' && p.status != 'PAID_CONFIRMED').toList();
    final double totalPaid = paidList.fold(0.0, (s, p) => s + p.amount);
    final double totalPending = pendingList.fold(0.0, (s, p) => s + p.amount);
    final double avgPerLoad = payments.isNotEmpty ? totalEarnings / payments.length : 0.0;

    // Group by month
    final Map<String, double> monthlyTotals = {};
    for (final p in payments) {
      try {
        final dt = p.parsedDate;
        final key = '${dt.year}-${dt.month.toString().padLeft(2, '0')}';
        monthlyTotals[key] = (monthlyTotals[key] ?? 0.0) + p.amount;
      } catch (_) {}
    }
    final sortedMonths = monthlyTotals.keys.toList()..sort();
    final last6 = sortedMonths.length > 6 ? sortedMonths.sublist(sortedMonths.length - 6) : sortedMonths;

    // Group by broker
    final Map<String, double> brokerTotals = {};
    for (final p in payments) {
      if (p.broker.isNotEmpty) {
        brokerTotals[p.broker] = (brokerTotals[p.broker] ?? 0.0) + p.amount;
      }
    }
    final topBrokers = (brokerTotals.entries.toList()..sort((a, b) => b.value.compareTo(a.value))).take(5).toList();

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Hero total card
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
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('TOTAL LIFETIME EARNINGS',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.8, color: AppColors.emeraldPrimary)),
              const SizedBox(height: 6),
              Text('\$${totalEarnings.toStringAsFixed(2)}',
                  style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: -1)),
              const SizedBox(height: 4),
              Text('${payments.length} load${payments.length == 1 ? '' : 's'} total',
                  style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Metrics grid
        Row(children: [
          Expanded(child: _metricBox('TOTAL PAID', '\$${totalPaid.toStringAsFixed(2)}', Icons.check_circle_outline_rounded, AppColors.emeraldPrimary)),
          const SizedBox(width: 10),
          Expanded(child: _metricBox('PENDING', '\$${totalPending.toStringAsFixed(2)}', Icons.access_time_rounded, AppColors.statusWarning)),
        ]),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(child: _metricBox('AVG PER LOAD', '\$${avgPerLoad.toStringAsFixed(0)}', Icons.trending_up_rounded, AppColors.statusInfo)),
          const SizedBox(width: 10),
          Expanded(child: _metricBox('LOADS PAID', '${paidList.length}', Icons.receipt_long_outlined, AppColors.emeraldDark)),
        ]),
        const SizedBox(height: 16),

        // Monthly bar chart
        if (last6.isNotEmpty) ...[
          HaulBoxCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const SectionHeader(title: 'Monthly Earnings', icon: Icons.bar_chart_rounded),
              const SizedBox(height: 16),
              _buildBarChart(last6, monthlyTotals),
            ]),
          ),
          const SizedBox(height: 16),
        ],

        // Broker breakdown
        if (topBrokers.isNotEmpty) ...[
          HaulBoxCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const SectionHeader(title: 'Earnings by Broker', icon: Icons.pie_chart_outline_rounded),
              const SizedBox(height: 8),
              ...topBrokers.map((e) {
                final pct = totalEarnings > 0 ? e.value / totalEarnings : 0.0;
                final count = payments.where((p) => p.broker == e.key).length;
                return _brokerRow(e.key, count, e.value, pct);
              }),
            ]),
          ),
          const SizedBox(height: 16),
        ],

        // Settlement history
        HaulBoxCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const SectionHeader(title: 'Settlement History', icon: Icons.list_alt_rounded),
            const SizedBox(height: 8),
            ...payments.take(25).map(_settlementRow),
          ]),
        ),
      ],
    );
  }

  Widget _metricBox(String title, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: AppRadius.lgBorder,
        border: Border.all(color: AppColors.borderDark),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Flexible(child: Text(title, style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: AppColors.textSubtle, letterSpacing: 0.5))),
          Icon(icon, size: 15, color: color),
        ]),
        const SizedBox(height: 6),
        Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: -0.5)),
      ]),
    );
  }

  Widget _buildBarChart(List<String> months, Map<String, double> totals) {
    final maxVal = months.map((m) => totals[m] ?? 0.0).reduce((a, b) => a > b ? a : b);
    return SizedBox(
      height: 160,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: months.map((key) {
          final val = totals[key] ?? 0.0;
          final pct = maxVal > 0 ? val / maxVal : 0.0;
          final isMax = val == maxVal && val > 0;
          final parts = key.split('-');
          final label = parts.length == 2 ? _monthAbbr(int.tryParse(parts[1]) ?? 1) : key;
          return Column(mainAxisAlignment: MainAxisAlignment.end, children: [
            Text(
              val >= 1000 ? '\$${(val / 1000).toStringAsFixed(1)}k' : '\$${val.toStringAsFixed(0)}',
              style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: isMax ? AppColors.emeraldPrimary : AppColors.textSubtle),
            ),
            const SizedBox(height: 6),
            Container(
              width: 26,
              height: (100 * pct).clamp(4.0, 100.0),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.bottomCenter,
                  end: Alignment.topCenter,
                  colors: isMax ? [AppColors.emeraldStrong, AppColors.emeraldPrimary] : [AppColors.surfaceDark, const Color(0xFF1E293B)],
                ),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: isMax ? AppColors.emeraldPrimary : AppColors.borderDark),
              ),
            ),
            const SizedBox(height: 8),
            Text(label, style: TextStyle(fontSize: 10, fontWeight: isMax ? FontWeight.w800 : FontWeight.w500, color: isMax ? Colors.white : AppColors.textMuted)),
          ]);
        }).toList(),
      ),
    );
  }

  Widget _brokerRow(String name, int runs, double total, double pct) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Expanded(child: Text(name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: Colors.white), overflow: TextOverflow.ellipsis)),
          Text('\$${total.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: AppColors.emeraldPrimary)),
        ]),
        const SizedBox(height: 4),
        Row(children: [
          Expanded(child: ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(value: pct, minHeight: 5, backgroundColor: AppColors.surfaceDark, valueColor: const AlwaysStoppedAnimation<Color>(AppColors.emeraldPrimary)),
          )),
          const SizedBox(width: 10),
          Text('$runs run${runs == 1 ? '' : 's'}', style: const TextStyle(fontSize: 11, color: AppColors.textSubtle)),
        ]),
      ]),
    );
  }

  Widget _settlementRow(PaymentModel p) {
    final isPaid = p.status == 'PAID' || p.status == 'PAID_CONFIRMED';
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: AppRadius.mdBorder,
        border: Border.all(color: AppColors.borderDark),
      ),
      child: Row(children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: isPaid ? AppColors.emeraldSoft : const Color(0xFF1E2030),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(isPaid ? Icons.check_circle_outline_rounded : Icons.access_time_rounded, size: 15, color: isPaid ? AppColors.emeraldPrimary : AppColors.statusWarning),
        ),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Load #${p.loadNumber}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: Colors.white)),
          Text(p.broker, style: const TextStyle(fontSize: 11.5, color: AppColors.textMuted), overflow: TextOverflow.ellipsis),
        ])),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text('\$${p.amount.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: AppColors.emeraldPrimary)),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
            decoration: BoxDecoration(
              color: isPaid ? AppColors.emeraldSoft : const Color(0xFF2D2010),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(isPaid ? 'PAID' : 'PENDING', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: isPaid ? AppColors.emeraldPrimary : AppColors.statusWarning)),
          ),
        ]),
      ]),
    );
  }

  String _monthAbbr(int m) {
    const a = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return (m >= 1 && m <= 12) ? a[m - 1] : '?';
  }
}
