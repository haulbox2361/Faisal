import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../core/services/external_map_service.dart';
import '../../shared/models/load_model.dart';
import '../../shared/widgets/haulbox_card.dart';
import '../../shared/widgets/section_header.dart';
import '../../shared/widgets/status_badge.dart';
import '../auth/auth_provider.dart';
import '../documents/document_detail_screen.dart';

class LoadDetailScreen extends StatelessWidget {
  final LoadModel load;

  const LoadDetailScreen({super.key, required this.load});

  void _showAddNoteDialog(BuildContext context, AuthProvider auth) {
    final controller = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.lgBorder),
        title: const Text('Add Note to Load', style: TextStyle(color: AppColors.textDark, fontWeight: FontWeight.w800, fontSize: 17)),
        content: TextField(
          controller: controller,
          maxLines: 3,
          decoration: const InputDecoration(
            hintText: 'Enter dock notes, gate instructions, delay updates...',
            hintStyle: TextStyle(color: AppColors.textSubtle, fontSize: 13),
          ),
        ),
        actions: [
          TextButton(
            child: const Text('CANCEL', style: TextStyle(color: AppColors.textMuted, fontWeight: FontWeight.w700)),
            onPressed: () => Navigator.pop(ctx),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.emeraldPrimary),
            child: const Text('SAVE NOTE', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
            onPressed: () {
              if (controller.text.trim().isNotEmpty) {
                auth.addNoteToLoad(load.id, controller.text.trim());
              }
              Navigator.pop(ctx);
            },
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final rateString = load.driverPay != null ? '\$${load.driverPay!.toInt()}' : '\$1,850';

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        title: Text(load.loadNumber),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Center(
              child: StatusBadge(status: load.status, isSmall: true),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          // 1. SUMMARY CARD (Bright White)
          _buildSummaryCard(rateString),
          const SizedBox(height: 14),

          // 2. ROUTE & PICKUP/DROP-OFF SECTION (Tappable Navigation)
          _buildRouteCard(),
          const SizedBox(height: 14),

          // 3. LOAD TIMELINE
          _buildTimelineCard(),
          const SizedBox(height: 14),

          // 4. LOAD DOCUMENTS SECTION
          _buildDocumentsCard(context),
          const SizedBox(height: 14),

          // 5. LOAD PHOTOS SECTION
          _buildPhotosCard(context),
          const SizedBox(height: 14),

          // 6. LOAD NOTES SECTION
          _buildNotesCard(context, auth),
          const SizedBox(height: 14),

          // 7. PAYMENT INFORMATION
          _buildPaymentCard(rateString),
        ],
      ),
    );
  }

  // 1. SUMMARY CARD
  Widget _buildSummaryCard(String rateString) {
    return HaulBoxCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'LOAD # ${load.loadNumber}',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppColors.textDark, letterSpacing: -0.3),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Broker: ${load.brokerName}',
                    style: const TextStyle(fontSize: 12.5, color: AppColors.textMuted, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    rateString,
                    style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: AppColors.emeraldDark, letterSpacing: -0.5),
                  ),
                  const Text('RATE', style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: AppColors.textSubtle, letterSpacing: 0.5)),
                ],
              ),
            ],
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 10),
            child: Divider(color: AppColors.borderLight, height: 1),
          ),
          _buildDetailRow('Pickup Window', '${load.pickupDate} — ${load.pickupTime}'),
          _buildDetailRow('Delivery Window', '${load.deliveryDate} — ${load.deliveryTime}'),
          _buildDetailRow('Weight & Commodity', '${load.weight} • ${load.commodity}'),
          _buildDetailRow('Trailer Type', load.trailerType ?? '53ft Dry Van'),
        ],
      ),
    );
  }

  // 2. ROUTE & PICKUP/DROP-OFF CARD
  Widget _buildRouteCard() {
    return HaulBoxCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(title: 'Route & Navigation', icon: Icons.map_outlined),
          const SizedBox(height: 8),

          // Route Header Pill (Tappable)
          InkWell(
            onTap: () => ExternalMapService.openRouteNavigation(load.pickup, load.dropoff),
            borderRadius: AppRadius.mdBorder,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: AppColors.emeraldSoft,
                borderRadius: AppRadius.mdBorder,
                border: Border.all(color: AppColors.emeraldPrimary.withValues(alpha: 0.3)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.near_me_rounded, color: AppColors.emeraldDark, size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '${load.pickup} → ${load.dropoff} (${load.miles} mi)',
                      style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: AppColors.textDark),
                    ),
                  ),
                  const Icon(Icons.open_in_new_rounded, size: 14, color: AppColors.emeraldDark),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Pickup Address (Tappable)
          InkWell(
            onTap: () => ExternalMapService.openNavigationToAddress(load.pickupAddress ?? '123 Logistics Blvd, Dallas, TX 75201'),
            borderRadius: AppRadius.mdBorder,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: const BoxDecoration(color: AppColors.emeraldSoft, shape: BoxShape.circle),
                    child: const Icon(Icons.arrow_upward_rounded, size: 14, color: AppColors.emeraldDark),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          children: [
                            Text('PICKUP', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: AppColors.emeraldDark, letterSpacing: 0.5)),
                            SizedBox(width: 4),
                            Icon(Icons.location_on_rounded, size: 10, color: AppColors.emeraldDark),
                          ],
                        ),
                        Text(
                          load.pickupAddress ?? '123 Logistics Blvd, Dallas, TX 75201',
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textDark),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),

          const Padding(
            padding: EdgeInsets.symmetric(vertical: 4, horizontal: 16),
            child: Icon(Icons.arrow_downward_rounded, size: 14, color: AppColors.textSubtle),
          ),

          // Drop-off Address (Tappable)
          InkWell(
            onTap: () => ExternalMapService.openNavigationToAddress(load.dropoffAddress ?? '700 Warehouse St, Houston, TX 77001'),
            borderRadius: AppRadius.mdBorder,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: const BoxDecoration(color: AppColors.statusDangerSoft, shape: BoxShape.circle),
                    child: const Icon(Icons.arrow_downward_rounded, size: 14, color: AppColors.statusDanger),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          children: [
                            Text('DROP-OFF', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: AppColors.statusDanger, letterSpacing: 0.5)),
                            SizedBox(width: 4),
                            Icon(Icons.location_on_rounded, size: 10, color: AppColors.statusDanger),
                          ],
                        ),
                        Text(
                          load.dropoffAddress ?? '700 Warehouse St, Houston, TX 77001',
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textDark),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  // 3. LOAD TIMELINE
  Widget _buildTimelineCard() {
    final isCompleted = ['COMPLETED', 'DELIVERED'].contains(load.status.toUpperCase());

    return HaulBoxCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(title: 'Trip Progress Timeline', icon: Icons.timeline_rounded),
          const SizedBox(height: 10),
          _buildTimelineStep('Load Assigned & Dispatched', true, isPast: true),
          _buildTimelineStep('Trip Started', true, isPast: true),
          _buildTimelineStep('Arrived Pickup Facility', true, isPast: true),
          _buildTimelineStep('BOL Accepted & Verified', true, isPast: true),
          _buildTimelineStep('Going to Delivery', true, isCurrent: !isCompleted),
          _buildTimelineStep('POD Required & Verified', isCompleted, isPast: isCompleted),
          _buildTimelineStep('Load Completed & Settlement Finalized', isCompleted, isPast: isCompleted, isLast: true),
        ],
      ),
    );
  }

  Widget _buildTimelineStep(String label, bool isDone, {bool isCurrent = false, bool isPast = false, bool isSkipped = false, bool isLast = false}) {
    Color dotColor = AppColors.borderLight;
    Widget icon = const SizedBox.shrink();

    if (isSkipped) {
      dotColor = const Color(0xFF94A3B8);
      icon = const Icon(Icons.fast_forward_rounded, color: Colors.white, size: 10);
    } else if (isDone) {
      dotColor = AppColors.emeraldPrimary;
      icon = const Icon(Icons.check_rounded, color: Colors.white, size: 12);
    } else if (isCurrent) {
      dotColor = AppColors.emeraldDark;
      icon = Container(width: 6, height: 6, decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle));
    }

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            Container(
              width: 18,
              height: 18,
              decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
              child: Center(child: icon),
            ),
            if (!isLast)
              Container(
                width: 2,
                height: 22,
                color: isDone || isSkipped ? AppColors.emeraldPrimary.withValues(alpha: 0.4) : AppColors.borderLight,
              ),
          ],
        ),
        const SizedBox(width: 10),
        Padding(
          padding: const EdgeInsets.only(top: 1),
          child: Row(
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: isCurrent || isDone ? FontWeight.w700 : FontWeight.w500,
                  color: isSkipped ? const Color(0xFF64748B) : (isCurrent ? AppColors.emeraldDark : (isDone ? AppColors.textDark : AppColors.textSubtle)),
                ),
              ),
              if (isSkipped) ...[
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: const Text('↷ Skipped', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: Color(0xFF64748B))),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  // 4. LOAD DOCUMENTS
  Widget _buildDocumentsCard(BuildContext context) {
    return HaulBoxCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(title: 'Load Documents & Compliance', icon: Icons.folder_outlined),
          const SizedBox(height: 8),
          _buildDocumentTile(context, 'Rate Confirmation (RC)', 'VERIFIED ✓', 'Rate_Confirmation_RC.pdf', Icons.description_outlined),
          _buildDocumentTile(context, 'Bill of Lading (BOL)', load.bolStatus ?? '✓ APPROVED', 'BOL_HBX20241042.pdf', Icons.assignment_outlined),
          _buildDocumentTile(context, 'BOL Supporting Pictures', '3 Photos Attached', 'BOL_Photos_Cargo_Seal.zip', Icons.photo_library_outlined),
          _buildDocumentTile(context, 'Proof of Delivery (POD)', load.podStatus ?? (load.status == 'COMPLETED' ? '✓ APPROVED' : 'PENDING'), 'POD_Signed_Delivery.pdf', Icons.assignment_turned_in_outlined),
          _buildDocumentTile(context, 'POD Supporting Pictures', '4 Photos Attached', 'POD_Photos_Receiving_Dock.zip', Icons.photo_library_outlined),
        ],
      ),
    );
  }

  Widget _buildDocumentTile(BuildContext context, String title, String status, String docNumber, IconData icon) {
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
                issueDate: load.pickupDate,
                expirationDate: load.deliveryDate,
                status: status,
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
              child: Icon(icon, color: AppColors.emeraldDark, size: 16),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                title,
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.textDark),
              ),
            ),
            StatusBadge(status: status, isSmall: true),
            const SizedBox(width: 4),
            const Icon(Icons.chevron_right_rounded, color: AppColors.textSubtle, size: 18),
          ],
        ),
      ),
    );
  }

  // 5. LOAD PHOTOS
  Widget _buildPhotosCard(BuildContext context) {
    return HaulBoxCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(title: 'Loading & Cargo Photos', icon: Icons.photo_library_outlined),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: _buildPhotoThumbnail(context, 'Loading / Cargo Secured', true),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _buildPhotoThumbnail(context, 'Unloading / Seal Intact', load.status == 'COMPLETED'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildPhotoThumbnail(BuildContext context, String label, bool isAttached) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isAttached ? AppColors.emeraldSoft : AppColors.bgLight,
        borderRadius: AppRadius.mdBorder,
        border: Border.all(color: isAttached ? AppColors.emeraldPrimary.withValues(alpha: 0.4) : AppColors.borderLight),
      ),
      child: Column(
        children: [
          Icon(
            isAttached ? Icons.check_circle_outline_rounded : Icons.add_a_photo_outlined,
            color: isAttached ? AppColors.emeraldDark : AppColors.textSubtle,
            size: 24,
          ),
          const SizedBox(height: 6),
          Text(
            label,
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.textDark),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 2),
          Text(
            isAttached ? '✓ Attached' : 'Pending',
            style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: isAttached ? AppColors.emeraldDark : AppColors.textSubtle),
          ),
        ],
      ),
    );
  }

  // 6. LOAD NOTES
  Widget _buildNotesCard(BuildContext context, AuthProvider auth) {
    return HaulBoxCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const SectionHeader(title: 'Driver & Dispatch Notes', icon: Icons.notes_rounded),
              TextButton.icon(
                icon: const Icon(Icons.add_rounded, size: 16, color: AppColors.emeraldDark),
                label: const Text('Add Note', style: TextStyle(color: AppColors.emeraldDark, fontSize: 12, fontWeight: FontWeight.w800)),
                onPressed: () => _showAddNoteDialog(context, auth),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.bgSecondary,
              borderRadius: AppRadius.mdBorder,
            ),
            child: Text(
              load.notes ?? 'No special notes logged for this run.',
              style: const TextStyle(fontSize: 12.5, color: AppColors.textDark, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }

  // 7. PAYMENT INFORMATION
  Widget _buildPaymentCard(String rateString) {
    return HaulBoxCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const SectionHeader(title: 'Payment Settlement', icon: Icons.account_balance_wallet_outlined),
              StatusBadge(status: load.paymentStatus ?? 'PENDING', isSmall: true),
            ],
          ),
          const SizedBox(height: 8),
          _buildDetailRow('Agreed Rate', rateString),
          _buildDetailRow('Payment Method', 'Direct Deposit ACH (24h settlement)'),
          _buildDetailRow('Payment Date', load.paymentDate ?? 'Pending Delivery Completion'),
        ],
      ),
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 12.5, color: AppColors.textMuted, fontWeight: FontWeight.w500)),
          Flexible(
            child: Text(
              value,
              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: AppColors.textDark),
              textAlign: TextAlign.right,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
