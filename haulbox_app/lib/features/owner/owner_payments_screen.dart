import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../shared/widgets/haulbox_card.dart';
import 'driver_payment_detail_sheet.dart';
import 'owner_provider.dart';

class OwnerPaymentsScreen extends StatefulWidget {
  const OwnerPaymentsScreen({super.key});

  @override
  State<OwnerPaymentsScreen> createState() => _OwnerPaymentsScreenState();
}

class _OwnerPaymentsScreenState extends State<OwnerPaymentsScreen> {
  final _currencyFormat = NumberFormat.currency(symbol: '\$', decimalDigits: 0);
  final _searchController = TextEditingController();

  final List<Map<String, String>> _categories = [
    {'label': 'All Drivers', 'val': 'all'},
    {'label': 'Ready to Pay', 'val': 'ready_to_pay'},
    {'label': 'Unpaid', 'val': 'unpaid'},
    {'label': 'Paid', 'val': 'paid'},
    {'label': 'Disputed ⚠️', 'val': 'disputed'},
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Provider.of<OwnerProvider>(context, listen: false).refreshPayments();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _openDriverPaymentDetail(Map<String, dynamic> driver) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => DriverPaymentDetailSheet(driverData: driver),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ownerProvider = Provider.of<OwnerProvider>(context);
    final drivers = ownerProvider.paymentDrivers;
    final isLoading = ownerProvider.isLoadingPayments;

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        title: const Text(
          'Driver Payments & Settlements',
          style: TextStyle(
            color: AppColors.textDark,
            fontWeight: FontWeight.w800,
            fontSize: 17,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: AppColors.navyLight),
            onPressed: () => ownerProvider.refreshPayments(),
          ),
        ],
      ),
      body: Column(
        children: [
          // Search & Filter Header
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: Column(
              children: [
                // Search Input
                TextField(
                  controller: _searchController,
                  onChanged: (val) {
                    ownerProvider.refreshPayments(search: val.trim());
                  },
                  decoration: InputDecoration(
                    hintText: 'Search by driver, truck, or phone...',
                    hintStyle: const TextStyle(fontSize: 13, color: AppColors.textSubtle),
                    prefixIcon: const Icon(Icons.search, size: 20, color: AppColors.textSubtle),
                    suffixIcon: _searchController.text.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear, size: 18),
                            onPressed: () {
                              _searchController.clear();
                              ownerProvider.refreshPayments(search: '');
                            },
                          )
                        : null,
                    filled: true,
                    fillColor: AppColors.bgLight,
                    contentPadding: const EdgeInsets.symmetric(vertical: 0, horizontal: 12),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
                const SizedBox(height: 10),

                // Category Filter Pills
                SizedBox(
                  height: 34,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: _categories.length,
                    separatorBuilder: (context, index) => const SizedBox(width: 8),
                    itemBuilder: (context, idx) {
                      final cat = _categories[idx];
                      final isSelected = ownerProvider.selectedPaymentFilter == cat['val'];
                      final isDisputed = cat['val'] == 'disputed';

                      return ChoiceChip(
                        label: Text(cat['label']!),
                        selected: isSelected,
                        onSelected: (sel) {
                          if (sel) ownerProvider.refreshPayments(filter: cat['val']);
                        },
                        selectedColor: isDisputed ? const Color(0xFFDC2626) : AppColors.navyDark,
                        backgroundColor: Colors.white,
                        labelStyle: TextStyle(
                          color: isSelected
                              ? Colors.white
                              : (isDisputed ? const Color(0xFFDC2626) : AppColors.navyLight),
                          fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                          fontSize: 11.5,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                          side: BorderSide(
                            color: isSelected
                                ? (isDisputed ? const Color(0xFFDC2626) : AppColors.navyDark)
                                : AppColors.borderLight,
                            width: 1,
                          ),
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      );
                    },
                  ),
                ),
              ],
            ),
          ),

          // Drivers List
          Expanded(
            child: RefreshIndicator(
              color: AppColors.emeraldPrimary,
              onRefresh: () => ownerProvider.refreshPayments(),
              child: isLoading && drivers.isEmpty
                  ? const Center(
                      child: CircularProgressIndicator(color: AppColors.emeraldPrimary),
                    )
                  : drivers.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.payment, size: 48, color: Colors.grey.shade400),
                              const SizedBox(height: 12),
                              Text(
                                'No driver payment records found',
                                style: TextStyle(color: Colors.grey.shade600, fontSize: 14),
                              ),
                            ],
                          ),
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: drivers.length,
                          separatorBuilder: (context, index) => const SizedBox(height: 12),
                          itemBuilder: (context, idx) {
                            final d = drivers[idx] as Map<String, dynamic>;
                            final String name = d['driverName'] ?? 'Driver';
                            final String truck = d['truck'] ?? 'HL-101';
                            final double totalAmt = (d['totalEarnings'] as num?)?.toDouble() ?? 0.0;
                            final double readyAmt = (d['readyToPay'] as num?)?.toDouble() ?? 0.0;
                            final double paidAmt = (d['paid'] as num?)?.toDouble() ?? 0.0;
                            final double unpaidAmt = (d['unpaid'] as num?)?.toDouble() ?? 0.0;
                            final bool hasDisputed = d['hasDisputed'] == true;
                            final int count = d['paymentsCount'] ?? 0;

                            return HaulBoxCard(
                              onTap: () => _openDriverPaymentDetail(d),
                              padding: const EdgeInsets.all(14),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      CircleAvatar(
                                        radius: 18,
                                        backgroundColor: AppColors.navyDark,
                                        child: Text(
                                          name.split(' ').map((p) => p.isNotEmpty ? p[0] : '').take(2).join(),
                                          style: const TextStyle(
                                            color: Colors.white,
                                            fontWeight: FontWeight.w800,
                                            fontSize: 12,
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Row(
                                              children: [
                                                Text(
                                                  name,
                                                  style: const TextStyle(
                                                    fontWeight: FontWeight.w800,
                                                    fontSize: 14.5,
                                                    color: AppColors.textDark,
                                                  ),
                                                ),
                                                if (hasDisputed) ...[
                                                  const SizedBox(width: 6),
                                                  Container(
                                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                    decoration: BoxDecoration(
                                                      color: const Color(0xFFFEE2E2),
                                                      borderRadius: BorderRadius.circular(6),
                                                    ),
                                                    child: const Text(
                                                      'DISPUTED',
                                                      style: TextStyle(
                                                        color: Color(0xFFDC2626),
                                                        fontSize: 9.5,
                                                        fontWeight: FontWeight.w800,
                                                      ),
                                                    ),
                                                  ),
                                                ],
                                              ],
                                            ),
                                            Text(
                                              'Truck: $truck • $count loads',
                                              style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                                            ),
                                          ],
                                        ),
                                      ),
                                      Column(
                                        crossAxisAlignment: CrossAxisAlignment.end,
                                        children: [
                                          const Text(
                                            'Total Earnings',
                                            style: TextStyle(color: AppColors.textSubtle, fontSize: 10),
                                          ),
                                          Text(
                                            _currencyFormat.format(totalAmt),
                                            style: const TextStyle(
                                              fontWeight: FontWeight.w900,
                                              fontSize: 15,
                                              color: AppColors.textDark,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                  const Padding(
                                    padding: EdgeInsets.symmetric(vertical: 10),
                                    child: Divider(height: 1, color: AppColors.divider),
                                  ),
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      _buildStatusPill('Ready to Pay', _currencyFormat.format(readyAmt), const Color(0xFF15803D), readyAmt > 0),
                                      _buildStatusPill('Paid', _currencyFormat.format(paidAmt), AppColors.navyDark, false),
                                      _buildStatusPill('Unpaid', _currencyFormat.format(unpaidAmt), const Color(0xFFB45309), false),
                                      const Icon(Icons.chevron_right, size: 18, color: AppColors.textSubtle),
                                    ],
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusPill(String label, String amount, Color color, bool isHighlighted) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: isHighlighted ? const Color(0xFFDCFCE7) : AppColors.bgLight,
        borderRadius: BorderRadius.circular(6),
        border: isHighlighted ? Border.all(color: const Color(0xFF86EFAC)) : null,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            '$label: ',
            style: const TextStyle(fontSize: 10.5, color: AppColors.textSecondary, fontWeight: FontWeight.w600),
          ),
          Text(
            amount,
            style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}
