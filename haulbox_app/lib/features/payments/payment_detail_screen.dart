import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../shared/models/payment_model.dart';
import '../../shared/widgets/haulbox_button.dart';
import '../../shared/widgets/haulbox_card.dart';
import '../../shared/widgets/section_header.dart';
import '../../shared/widgets/status_badge.dart';
import '../auth/auth_provider.dart';
import '../documents/document_detail_screen.dart';
import '../loads/load_detail_screen.dart';

class PaymentDetailScreen extends StatelessWidget {
  final PaymentModel payment;

  const PaymentDetailScreen({super.key, required this.payment});

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final rate = payment.rate ?? payment.amount;
    final adjustments = payment.adjustments ?? 0.0;
    final deductions = payment.deductions ?? 0.0;
    final total = rate + adjustments - deductions;

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        title: const Text('Payment Details'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Center(
              child: StatusBadge(status: payment.status, isSmall: true),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          // 1. PAYMENT SUMMARY HERO CARD (Bright White)
          HaulBoxCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      payment.loadNumber,
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppColors.textDark),
                    ),
                    Text(
                      '\$${payment.amount.toStringAsFixed(2)}',
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: AppColors.emeraldDark),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  'Broker: ${payment.broker}',
                  style: const TextStyle(fontSize: 12.5, color: AppColors.textMuted, fontWeight: FontWeight.w600),
                ),
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 10),
                  child: Divider(color: AppColors.borderLight, height: 1),
                ),
                _buildFieldRow('Settlement Date', payment.date),
                _buildFieldRow('Payment Method', payment.paymentMethod),
                _buildFieldRow('Payment Status', payment.status),
                _buildFieldRow('Processing SLA', 'ACH Direct Deposit (Next Business Day)'),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // 2. FINANCIAL BREAKDOWN CARD
          HaulBoxCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionHeader(title: 'Settlement Breakdown', icon: Icons.receipt_long_outlined),
                const SizedBox(height: 8),
                _buildBreakdownRow('Agreed Rate (from RC)', '\$${rate.toStringAsFixed(2)}', false),
                _buildBreakdownRow('Adjustments / Fuel Surcharge', '+\$${adjustments.toStringAsFixed(2)}', false),
                _buildBreakdownRow('Approved Deductions', '-\$${deductions.toStringAsFixed(2)}', false),
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Divider(color: AppColors.borderLight, height: 1),
                ),
                _buildBreakdownRow('Net Settlement Payout', '\$${total.toStringAsFixed(2)}', true),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // 3. VIEW ASSOCIATED LOAD BUTTON
          HaulBoxButton(
            text: 'VIEW ASSOCIATED LOAD',
            icon: Icons.inventory_2_outlined,
            onPressed: () {
              final associatedLoad = auth.loads.firstWhere(
                (l) => l.loadNumber == payment.loadNumber || l.id == payment.loadId,
                orElse: () => auth.loads.first,
              );
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => LoadDetailScreen(load: associatedLoad),
                ),
              );
            },
          ),
          const SizedBox(height: 14),

          // 4. PAYMENT DOCUMENTS SECTION
          HaulBoxCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionHeader(title: 'Settlement Documents', icon: Icons.folder_outlined),
                const SizedBox(height: 8),
                _buildDocItem(context, 'Rate Confirmation (RC)', 'RC_${payment.loadNumber}.pdf'),
                _buildDocItem(context, 'Settlement Slip / Statement', 'Settlement_${payment.loadNumber}.pdf'),
                _buildDocItem(context, 'Freight Invoice', 'Invoice_${payment.loadNumber}.pdf'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFieldRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 12.5, color: AppColors.textMuted, fontWeight: FontWeight.w500)),
          Text(value, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: AppColors.textDark)),
        ],
      ),
    );
  }

  Widget _buildBreakdownRow(String label, String value, bool isTotal) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: isTotal ? 14 : 12.5,
              fontWeight: isTotal ? FontWeight.w800 : FontWeight.w500,
              color: isTotal ? AppColors.textDark : AppColors.textMuted,
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: isTotal ? 16 : 13,
              fontWeight: isTotal ? FontWeight.w900 : FontWeight.w700,
              color: isTotal ? AppColors.emeraldDark : AppColors.textDark,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDocItem(BuildContext context, String title, String docNumber) {
    return Container(
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.bgLight,
        borderRadius: AppRadius.mdBorder,
        border: Border.all(color: AppColors.borderLight),
      ),
      child: InkWell(
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => DocumentDetailScreen(
                title: title,
                documentNumber: docNumber,
                issueDate: payment.date,
                status: payment.status,
                category: 'TRUCK',
              ),
            ),
          );
        },
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: const BoxDecoration(color: AppColors.emeraldSoft, shape: BoxShape.circle),
              child: const Icon(Icons.description_outlined, color: AppColors.emeraldDark, size: 16),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                title,
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.textDark),
              ),
            ),
            const Icon(Icons.chevron_right_rounded, color: AppColors.textSubtle, size: 18),
          ],
        ),
      ),
    );
  }
}
