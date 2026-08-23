import 'package:flutter/material.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_radius.dart';
import '../../../shared/models/load_model.dart';

class LoadSpecsCard extends StatelessWidget {
  final LoadModel load;
  final VoidCallback? onAddNote;
  final VoidCallback? onMessageDispatcher;

  const LoadSpecsCard({
    super.key,
    required this.load,
    this.onAddNote,
    this.onMessageDispatcher,
  });

  void _callPhone(BuildContext context, String? phone) {
    if (phone == null || phone.isEmpty) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Calling Dispatch Operations: $phone'),
        backgroundColor: AppColors.emeraldPrimary,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final weightStr = load.weight != null ? '${load.weight} lbs' : '42,000 lbs';
    final commodityStr = load.commodity ?? 'General Freight / Dry Goods';
    final trailerStr = load.trailerType ?? '53ft Dry Van';
    final rateStr = load.driverPay != null ? '\$${load.driverPay!.toInt()}' : '\$1,850';

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadius.xlBorder,
        border: Border.all(color: AppColors.borderLight),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.inventory_2_outlined, size: 19, color: AppColors.emeraldDark),
                  SizedBox(width: 8),
                  Text(
                    'LOAD SPECIFICATIONS',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w900,
                      color: AppColors.emeraldDark,
                      letterSpacing: 0.6,
                    ),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppColors.emeraldSoft,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  'PAY: $rateStr',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
                    color: AppColors.emeraldDark,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),

          // Specs Grid
          Row(
            children: [
              Expanded(
                child: _buildSpecItem('Commodity', commodityStr, Icons.category_outlined),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _buildSpecItem('Weight', weightStr, Icons.scale_outlined),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _buildSpecItem('Trailer', trailerStr, Icons.local_shipping_outlined),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _buildSpecItem('Broker', load.brokerName, Icons.business_outlined),
              ),
            ],
          ),

          if (load.notes != null && load.notes!.isNotEmpty) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFFFFBEB),
                borderRadius: AppRadius.mdBorder,
                border: Border.all(color: const Color(0xFFFDE68A)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.sticky_note_2_outlined, size: 16, color: Color(0xFFD97706)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Special Instructions: ${load.notes}',
                      style: const TextStyle(fontSize: 11.5, color: Color(0xFF92400E), fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),
          ],

          const Padding(
            padding: EdgeInsets.symmetric(vertical: 14),
            child: Divider(color: AppColors.borderLight, height: 1),
          ),

          // Action Bar: Call Dispatcher, Message Ops, Add Note
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    side: const BorderSide(color: AppColors.borderLight),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  onPressed: () => _callPhone(context, load.pickupPhone ?? '(214) 555-0199'),
                  icon: const Icon(Icons.call_outlined, size: 16, color: AppColors.emeraldDark),
                  label: const Text('Call Ops', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textDark)),
                ),
              ),
              const SizedBox(width: 8),
              if (onMessageDispatcher != null) ...[
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      side: const BorderSide(color: AppColors.borderLight),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    onPressed: onMessageDispatcher,
                    icon: const Icon(Icons.chat_bubble_outline_rounded, size: 16, color: AppColors.statusInfo),
                    label: const Text('Message', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textDark)),
                  ),
                ),
                const SizedBox(width: 8),
              ],
              if (onAddNote != null)
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      side: const BorderSide(color: AppColors.borderLight),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    onPressed: onAddNote,
                    icon: const Icon(Icons.edit_note_rounded, size: 17, color: AppColors.textPrimary),
                    label: const Text('Add Note', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textDark)),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSpecItem(String label, String value, IconData icon) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.bgSecondary,
        borderRadius: AppRadius.mdBorder,
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Row(
        children: [
          Icon(icon, size: 16, color: AppColors.emeraldDark),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label.toUpperCase(),
                  style: const TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: AppColors.textSubtle),
                ),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textDark),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
