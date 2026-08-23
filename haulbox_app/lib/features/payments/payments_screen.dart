import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../shared/models/date_range_filter.dart';
import '../../shared/models/payment_model.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/range_selector.dart';
import '../../shared/widgets/status_badge.dart';
import '../auth/auth_provider.dart';
import '../documents/document_detail_screen.dart';
import 'payment_detail_screen.dart';

class PaymentsScreen extends StatefulWidget {
  const PaymentsScreen({super.key});

  @override
  State<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<PaymentsScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  DateRangeFilterType _selectedDateRange = DateRangeFilterType.thisWeek;
  DateTimeRange? _customDateRange;
  String _searchQuery = '';
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  List<PaymentModel> _filterPayments(List<PaymentModel> allPayments, {required bool isAvailableTab}) {
    final range = DateRangeHelper.calculateRange(_selectedDateRange, customRange: _customDateRange);

    // 1. Tab Segmentation (Available/Scheduled vs. Past Settlements)
    List<PaymentModel> list = allPayments.where((p) {
      final isPaid = p.status.toUpperCase() == 'PAID';
      return isAvailableTab ? !isPaid : isPaid;
    }).toList();

    // 2. Date Range Filter
    if (_selectedDateRange != DateRangeFilterType.allTime) {
      list = list.where((p) {
        final pDate = p.parsedDate;
        return pDate.isAfter(range.start.subtract(const Duration(seconds: 1))) &&
            pDate.isBefore(range.end.add(const Duration(seconds: 1)));
      }).toList();
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

  void _downloadSettlementPdf(PaymentModel payment) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => DocumentDetailScreen(
          title: 'Settlement Statement (Load #${payment.loadNumber})',
          documentNumber: 'ST-${payment.loadNumber}',
          issueDate: payment.date,
          status: payment.status,
          category: 'TRUCK',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final allPayments = auth.payments;

    final availablePayments = _filterPayments(allPayments, isAvailableTab: true);
    final settlementPayments = _filterPayments(allPayments, isAvailableTab: false);

    final totalAvailableAmount = availablePayments.fold<double>(0.0, (sum, p) => sum + p.amount);
    final totalSettledAmount = settlementPayments.fold<double>(0.0, (sum, p) => sum + p.amount);

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        title: const Text(
          'Payments & Settlements',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: -0.4),
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            height: 38,
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(12),
            ),
            child: TabBar(
              controller: _tabController,
              indicatorSize: TabBarIndicatorSize.tab,
              indicator: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(10),
              ),
              labelColor: AppColors.textDark,
              unselectedLabelColor: Colors.white.withValues(alpha: 0.8),
              labelStyle: const TextStyle(fontWeight: FontWeight.w900, fontSize: 12),
              unselectedLabelStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
              tabs: const [
                Tab(text: 'AVAILABLE & SCHEDULED'),
                Tab(text: 'PAST SETTLEMENTS'),
              ],
            ),
          ),
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // TAB 1: Available & Scheduled Payouts
          _buildAvailablePayoutsTab(availablePayments, totalAvailableAmount, auth),
          // TAB 2: Past Settlements with PDF Download
          _buildPastSettlementsTab(settlementPayments, totalSettledAmount, auth),
        ],
      ),
    );
  }

  Widget _buildAvailablePayoutsTab(List<PaymentModel> payments, double totalAvailable, AuthProvider auth) {
    return RefreshIndicator(
      onRefresh: () => auth.syncAllData(),
      color: AppColors.emeraldPrimary,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 32),
        children: [
          // Hero Card for Available / Pending Balance
          Container(
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF0F172A), Color(0xFF1E293B)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: AppRadius.xlBorder,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.1),
                  blurRadius: 14,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('AVAILABLE BALANCE', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 11.5, fontWeight: FontWeight.w800, letterSpacing: 0.8)),
                    Icon(Icons.account_balance_wallet_outlined, color: Color(0xFF4ADE80), size: 20),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  '\$${totalAvailable.toStringAsFixed(2)}',
                  style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: -0.5),
                ),
                const SizedBox(height: 4),
                const Text(
                  'Scheduled for ACH Direct Deposit on next Friday cutoff',
                  style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12, fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),

          const Text(
            'PENDING & IN-PROCESS PAYOUTS',
            style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w900, color: AppColors.textDark, letterSpacing: 0.6),
          ),
          const SizedBox(height: 10),

          if (payments.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 30),
              child: EmptyState(
                title: 'No Pending Payouts',
                description: 'All completed loads have been settled or are up to date.',
                icon: Icons.check_circle_outline_rounded,
              ),
            )
          else
            ...payments.map((p) => _buildPaymentCard(p, isPastSettlement: false)),
        ],
      ),
    );
  }

  Widget _buildPastSettlementsTab(List<PaymentModel> payments, double totalSettled, AuthProvider auth) {
    return RefreshIndicator(
      onRefresh: () => auth.syncAllData(),
      color: AppColors.emeraldPrimary,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 32),
        children: [
          // Filter & Search Box
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: AppRadius.lgBorder,
              border: Border.all(color: AppColors.borderLight),
            ),
            child: Column(
              children: [
                Container(
                  height: 40,
                  decoration: BoxDecoration(
                    color: AppColors.bgSecondary,
                    borderRadius: AppRadius.mdBorder,
                    border: Border.all(color: AppColors.borderLight),
                  ),
                  child: TextField(
                    controller: _searchController,
                    onChanged: (v) => setState(() => _searchQuery = v),
                    style: const TextStyle(fontSize: 13, color: AppColors.textDark, fontWeight: FontWeight.w600),
                    decoration: InputDecoration(
                      hintText: 'Search past settlements by Load #...',
                      hintStyle: const TextStyle(color: AppColors.textSubtle, fontSize: 12.5),
                      prefixIcon: const Icon(Icons.search_rounded, size: 18, color: AppColors.textMuted),
                      border: InputBorder.none,
                      contentPadding: const EdgeInsets.symmetric(vertical: 10),
                    ),
                  ),
                ),
                const SizedBox(height: 10),
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
              ],
            ),
          ),
          const SizedBox(height: 14),

          if (payments.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 30),
              child: EmptyState(
                title: 'No Past Settlements Found',
                description: 'No completed settlements match your selected range.',
                icon: Icons.history_rounded,
              ),
            )
          else
            ...payments.map((p) => _buildPaymentCard(p, isPastSettlement: true)),
        ],
      ),
    );
  }

  Widget _buildPaymentCard(PaymentModel p, {required bool isPastSettlement}) {
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
                builder: (_) => PaymentDetailScreen(payment: p),
              ),
            );
          },
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Load #${p.loadNumber}',
                          style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: AppColors.textDark),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${p.broker} • ${p.date}',
                          style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                        ),
                      ],
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          '\$${p.amount.toStringAsFixed(2)}',
                          style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: AppColors.emeraldDark),
                        ),
                        const SizedBox(height: 2),
                        StatusBadge(status: p.status, isSmall: true),
                      ],
                    ),
                  ],
                ),
                if (isPastSettlement) ...[
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 8),
                    child: Divider(color: AppColors.borderLight, height: 1),
                  ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Direct Deposit • Batch #ST-902',
                        style: TextStyle(fontSize: 11, color: AppColors.textSubtle, fontWeight: FontWeight.w600),
                      ),
                      InkWell(
                        onTap: () => _downloadSettlementPdf(p),
                        borderRadius: BorderRadius.circular(6),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFEE2E2),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.picture_as_pdf_outlined, size: 13, color: Color(0xFFDC2626)),
                              SizedBox(width: 4),
                              Text(
                                'Download PDF',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w800,
                                  color: Color(0xFFB91C1C),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
