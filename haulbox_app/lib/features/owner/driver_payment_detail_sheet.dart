import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../shared/widgets/haulbox_card.dart';
import '../../shared/widgets/status_badge.dart';
import 'owner_provider.dart';

class DriverPaymentDetailSheet extends StatefulWidget {
  final Map<String, dynamic> driverData;

  const DriverPaymentDetailSheet({super.key, required this.driverData});

  @override
  State<DriverPaymentDetailSheet> createState() => _DriverPaymentDetailSheetState();
}

class _DriverPaymentDetailSheetState extends State<DriverPaymentDetailSheet> {
  final _currencyFormat = NumberFormat.currency(symbol: '\$', decimalDigits: 0);
  bool _isProcessing = false;

  void _showMarkPaidConfirmation(Map<String, dynamic> record) {
    final loadNum = record['loadNumber'] ?? 'Load';
    final amount = (record['amount'] as num?)?.toDouble() ?? 0.0;
    final drvName = widget.driverData['driverName'] ?? 'Driver';

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            const Icon(Icons.check_circle_outline, color: AppColors.emeraldPrimary, size: 24),
            const SizedBox(width: 8),
            const Text(
              'Confirm Payment',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
            ),
          ],
        ),
        content: Text(
          'Mark ${_currencyFormat.format(amount)} payment for $drvName (Load #$loadNum) as paid?\n\nThis will record the payment in the audit log and notify the driver.',
          style: const TextStyle(fontSize: 13, color: AppColors.textDark, height: 1.4),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel', style: TextStyle(color: AppColors.textSecondary)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.emeraldPrimary,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            onPressed: () async {
              Navigator.of(ctx).pop();
              _executeMarkPaid(record['loadId']);
            },
            child: const Text('Confirm & Pay', style: TextStyle(fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }

  Future<void> _executeMarkPaid(String loadId) async {
    setState(() => _isProcessing = true);
    final provider = Provider.of<OwnerProvider>(context, listen: false);
    final result = await provider.markPaymentAsPaid(loadId);
    setState(() => _isProcessing = false);

    if (!mounted) return;

    if (result['success'] == true) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(result['message'] ?? 'Payment marked as paid'),
          backgroundColor: AppColors.emeraldDark,
        ),
      );
      Navigator.of(context).pop(); // Close sheet to let updated list refresh
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(result['error'] ?? 'Failed to mark payment'),
          backgroundColor: AppColors.statusDanger,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.driverData;
    final String name = d['driverName'] ?? 'Driver';
    final String truck = d['truck'] ?? 'HL-101';
    final String phone = d['phone'] ?? '';
    final double readyAmt = (d['readyToPay'] as num?)?.toDouble() ?? 0.0;
    final double paidAmt = (d['paid'] as num?)?.toDouble() ?? 0.0;
    final double totalAmt = (d['totalEarnings'] as num?)?.toDouble() ?? 0.0;
    final List<dynamic> records = d['records'] as List<dynamic>? ?? [];

    return Container(
      height: MediaQuery.of(context).size.height * 0.85,
      decoration: const BoxDecoration(
        color: AppColors.bgLight,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        children: [
          // Header Bar
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
              border: Border(bottom: BorderSide(color: AppColors.borderLight)),
            ),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 20,
                  backgroundColor: AppColors.navyDark,
                  child: Text(
                    name.split(' ').map((p) => p.isNotEmpty ? p[0] : '').take(2).join(),
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textDark,
                        ),
                      ),
                      Text(
                        'Truck: $truck ${phone.isNotEmpty ? "• $phone" : ""}',
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 11.5),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, color: AppColors.navyLight),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),

          // Settlement KPI Row
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
            child: Row(
              children: [
                Expanded(
                  child: _buildMiniStat('Total Earnings', _currencyFormat.format(totalAmt), AppColors.textDark),
                ),
                Expanded(
                  child: _buildMiniStat('Ready to Pay', _currencyFormat.format(readyAmt), const Color(0xFF15803D)),
                ),
                Expanded(
                  child: _buildMiniStat('Total Paid', _currencyFormat.format(paidAmt), AppColors.textSecondary),
                ),
              ],
            ),
          ),

          // Loads List
          Expanded(
            child: records.isEmpty
                ? const Center(
                    child: Text(
                      'No payment records found for this driver',
                      style: TextStyle(color: AppColors.textSecondary),
                    ),
                  )
                : ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: records.length,
                    separatorBuilder: (context, index) => const SizedBox(height: 10),
                    itemBuilder: (context, idx) {
                      final r = records[idx];
                      final loadNum = r['loadNumber'] ?? 'Load';
                      final pickup = r['pickup'] ?? '';
                      final dropoff = r['dropoff'] ?? '';
                      final amount = (r['amount'] as num?)?.toDouble() ?? 0.0;
                      final payStatus = r['paymentStatus'] ?? 'UNPAID';
                      final bool isEligible = r['isEligibleToPay'] == true;

                      return HaulBoxCard(
                        padding: const EdgeInsets.all(14),
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
                                    fontSize: 14.5,
                                    color: AppColors.textDark,
                                  ),
                                ),
                                StatusBadge(status: payStatus, isSmall: true),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '$pickup → $dropoff',
                              style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const Padding(
                              padding: EdgeInsets.symmetric(vertical: 8),
                              child: Divider(height: 1, color: AppColors.divider),
                            ),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text(
                                      'Driver Settlement',
                                      style: TextStyle(color: AppColors.textSubtle, fontSize: 10.5),
                                    ),
                                    Text(
                                      _currencyFormat.format(amount),
                                      style: const TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w900,
                                        color: AppColors.textDark,
                                      ),
                                    ),
                                  ],
                                ),
                                if (isEligible)
                                  ElevatedButton.icon(
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: AppColors.emeraldPrimary,
                                      foregroundColor: Colors.white,
                                      elevation: 0,
                                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                    ),
                                    icon: const Icon(Icons.check, size: 16),
                                    label: const Text(
                                      'Mark as Paid',
                                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                                    ),
                                    onPressed: _isProcessing ? null : () => _showMarkPaidConfirmation(r),
                                  )
                                else if (payStatus == 'PAID' || payStatus == 'PAID_CONFIRMED')
                                  Row(
                                    children: [
                                      const Icon(Icons.done_all, color: AppColors.emeraldPrimary, size: 16),
                                      const SizedBox(width: 4),
                                      Text(
                                        payStatus == 'PAID_CONFIRMED' ? 'Confirmed by Driver' : 'Paid',
                                        style: const TextStyle(
                                          color: AppColors.emeraldDark,
                                          fontSize: 11.5,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ],
                                  )
                                else if (payStatus == 'PAYMENT_DISPUTED')
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFFEE2E2),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: const Text(
                                      'Disputed — Resolve in Admin',
                                      style: TextStyle(color: Color(0xFFDC2626), fontSize: 11, fontWeight: FontWeight.w700),
                                    ),
                                  )
                                else
                                  Text(
                                    'Pending Delivery',
                                    style: TextStyle(color: Colors.amber.shade800, fontSize: 11.5, fontWeight: FontWeight.w600),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildMiniStat(String label, String value, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(color: AppColors.textSubtle, fontSize: 10.5, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: TextStyle(color: color, fontSize: 14.5, fontWeight: FontWeight.w800),
        ),
      ],
    );
  }
}
