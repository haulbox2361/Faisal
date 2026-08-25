import 'package:flutter/material.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_radius.dart';
import '../../../shared/models/load_model.dart';
import '../../documents/document_detail_screen.dart';

class TripDocStatusStrip extends StatelessWidget {
  final LoadModel load;
  final VoidCallback onUploadBol;
  final VoidCallback onUploadPod;
  final void Function(int stopNumber)? onUploadStopBol;
  final void Function(int stopNumber)? onUploadStopPod;

  const TripDocStatusStrip({
    super.key,
    required this.load,
    required this.onUploadBol,
    required this.onUploadPod,
    this.onUploadStopBol,
    this.onUploadStopPod,
  });

  @override
  Widget build(BuildContext context) {
    if (load.isMultiStop) {
      return _buildMultiStopStrip(context);
    }
    return _buildSingleStopStrip(context);
  }

  Widget _buildSingleStopStrip(BuildContext context) {
    final isBolUploaded = load.bolStatus != null && load.bolStatus != 'PENDING';
    final isPodUploaded = load.podStatus != null && load.podStatus != 'PENDING';

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
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Icon(Icons.folder_shared_outlined, size: 18, color: AppColors.emeraldDark),
                  SizedBox(width: 8),
                  Text(
                    'TRIP DOCUMENTS & POD',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w900,
                      color: AppColors.emeraldDark,
                      letterSpacing: 0.6,
                    ),
                  ),
                ],
              ),
              Text(
                '3 Required',
                style: TextStyle(fontSize: 11.5, color: AppColors.textSubtle, fontWeight: FontWeight.w600),
              ),
            ],
          ),
          const SizedBox(height: 12),

          Row(
            children: [
              // 1. Rate Con
              Expanded(
                child: _buildDocPill(
                  context: context,
                  title: 'Rate Con',
                  status: 'VERIFIED',
                  icon: Icons.description_outlined,
                  isComplete: true,
                  onTap: () => _openDocPreview(
                    context,
                    title: 'Rate Confirmation (RC)',
                    docNumber: 'RC-${load.loadNumber}',
                    status: 'VERIFIED',
                    docKey: 'RC',
                  ),
                ),
              ),
              const SizedBox(width: 8),

              // 2. BOL
              Expanded(
                child: _buildDocPill(
                  context: context,
                  title: 'Shipper BOL',
                  status: load.bolStatus ?? 'REQUIRED',
                  icon: Icons.assignment_outlined,
                  isComplete: isBolUploaded,
                  onTap: isBolUploaded
                      ? () => _openDocPreview(
                            context,
                            title: 'Bill of Lading (BOL)',
                            docNumber: 'BOL-${load.loadNumber}',
                            status: load.bolStatus ?? 'APPROVED',
                            docKey: 'BOL',
                          )
                      : onUploadBol,
                ),
              ),
              const SizedBox(width: 8),

              // 3. POD
              Expanded(
                child: _buildDocPill(
                  context: context,
                  title: 'Receiver POD',
                  status: load.podStatus ?? (load.status == 'COMPLETED' ? 'APPROVED' : 'REQUIRED'),
                  icon: Icons.assignment_turned_in_outlined,
                  isComplete: isPodUploaded || load.status == 'COMPLETED',
                  onTap: (isPodUploaded || load.status == 'COMPLETED')
                      ? () => _openDocPreview(
                            context,
                            title: 'Proof of Delivery (POD)',
                            docNumber: 'POD-${load.loadNumber}',
                            status: load.podStatus ?? 'APPROVED',
                            docKey: 'POD',
                          )
                      : onUploadPod,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMultiStopStrip(BuildContext context) {
    final totalStops = load.pickupStops.length + load.deliveryStops.length;

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
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.folder_shared_outlined, size: 18, color: AppColors.emeraldDark),
                  SizedBox(width: 8),
                  Text(
                    'MULTI-STOP TRIP PAPERS',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w900,
                      color: AppColors.emeraldDark,
                      letterSpacing: 0.6,
                    ),
                  ),
                ],
              ),
              Text(
                '${totalStops + 1} Required',
                style: const TextStyle(fontSize: 11.5, color: AppColors.textSubtle, fontWeight: FontWeight.w600),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Horizontal scrollable pills for all multi-stop documents
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                // 1. Rate Con
                SizedBox(
                  width: 105,
                  child: _buildDocPill(
                    context: context,
                    title: 'Rate Con',
                    status: 'VERIFIED',
                    icon: Icons.description_outlined,
                    isComplete: true,
                    onTap: () => _openDocPreview(
                      context,
                      title: 'Rate Confirmation (RC)',
                      docNumber: 'RC-${load.loadNumber}',
                      status: 'VERIFIED',
                      docKey: 'RC',
                    ),
                  ),
                ),
                const SizedBox(width: 8),

                // 2. Pickups
                ...load.pickupStops.map((s) {
                  final isDone = s.status == 'BOL_APPROVED';
                  final docKey = s.stopNumber > 1 ? 'BOL_${s.stopNumber}' : 'BOL';
                  return Container(
                    width: 115,
                    margin: const EdgeInsets.only(right: 8),
                    child: _buildDocPill(
                      context: context,
                      title: 'Pickup ${s.stopNumber} BOL',
                      status: isDone ? 'VERIFIED' : (s.status == 'BOL_REJECTED' ? 'REJECTED' : 'REQUIRED'),
                      icon: Icons.assignment_outlined,
                      isComplete: isDone,
                      onTap: isDone
                          ? () => _openDocPreview(
                                context,
                                title: 'Pickup ${s.stopNumber} BOL (${s.city})',
                                docNumber: 'BOL-${load.loadNumber}-S${s.stopNumber}',
                                status: 'APPROVED',
                                docKey: docKey,
                              )
                          : () {
                              if (onUploadStopBol != null) {
                                onUploadStopBol!(s.stopNumber);
                              } else {
                                onUploadBol();
                              }
                            },
                    ),
                  );
                }),

                // 3. Deliveries
                ...load.deliveryStops.map((s) {
                  final isDone = s.status == 'POD_APPROVED' || load.status == 'COMPLETED';
                  final docKey = s.stopNumber > 1 ? 'POD_${s.stopNumber}' : 'POD';
                  return Container(
                    width: 115,
                    margin: const EdgeInsets.only(right: 8),
                    child: _buildDocPill(
                      context: context,
                      title: 'Delivery ${s.stopNumber} POD',
                      status: isDone ? 'VERIFIED' : (s.status == 'POD_REJECTED' ? 'REJECTED' : 'REQUIRED'),
                      icon: Icons.assignment_turned_in_outlined,
                      isComplete: isDone,
                      onTap: isDone
                          ? () => _openDocPreview(
                                context,
                                title: 'Delivery ${s.stopNumber} POD (${s.city})',
                                docNumber: 'POD-${load.loadNumber}-S${s.stopNumber}',
                                status: 'APPROVED',
                                docKey: docKey,
                              )
                          : () {
                              if (onUploadStopPod != null) {
                                onUploadStopPod!(s.stopNumber);
                              } else {
                                onUploadPod();
                              }
                            },
                    ),
                  );
                }),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDocPill({
    required BuildContext context,
    required String title,
    required String status,
    required IconData icon,
    required bool isComplete,
    required VoidCallback onTap,
  }) {
    final statusColor = isComplete ? AppColors.emeraldDark : const Color(0xFFD97706);
    final statusBg = isComplete ? AppColors.emeraldSoft : const Color(0xFFFEF3C7);

    return InkWell(
      onTap: onTap,
      borderRadius: AppRadius.mdBorder,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.bgSecondary,
          borderRadius: AppRadius.mdBorder,
          border: Border.all(
            color: isComplete ? AppColors.emeraldPrimary.withValues(alpha: 0.3) : AppColors.borderLight,
          ),
        ),
        child: Column(
          children: [
            Icon(icon, size: 18, color: statusColor),
            const SizedBox(height: 5),
            Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.textDark),
            ),
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: statusBg,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                isComplete ? '✓ $status' : '▲ $status',
                maxLines: 1,
                style: TextStyle(
                  fontSize: 9.5,
                  fontWeight: FontWeight.w800,
                  color: statusColor,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _openDocPreview(
    BuildContext context, {
    required String title,
    required String docNumber,
    required String status,
    required String docKey,
  }) {
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
          loadId: load.id,
          docKey: docKey,
          load: load,
        ),
      ),
    );
  }
}
