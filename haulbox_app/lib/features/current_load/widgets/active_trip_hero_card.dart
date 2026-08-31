import 'package:flutter/material.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_radius.dart';
import '../../../shared/models/load_model.dart';
import '../../../shared/models/load_state.dart';

class ActiveTripHeroCard extends StatelessWidget {
  final LoadModel load;
  final LoadWorkflowState workflowState;
  final int milesRemaining;
  final String etaText;
  final String riskBadge;
  final bool isProcessing;
  final String? statusMessage;
  final VoidCallback onPrimaryAction;

  const ActiveTripHeroCard({
    super.key,
    required this.load,
    required this.workflowState,
    required this.milesRemaining,
    required this.etaText,
    required this.riskBadge,
    required this.isProcessing,
    this.statusMessage,
    required this.onPrimaryAction,
  });

  String _getActionTitle() {
    switch (workflowState) {
      case LoadWorkflowState.assigned:
        return 'ACCEPT LOAD';
      case LoadWorkflowState.accepted:
      case LoadWorkflowState.startTrip:
        return 'START TRIP TO PICKUP';
      case LoadWorkflowState.goingToPickup:
        return 'CONFIRM ARRIVAL AT PICKUP';
      case LoadWorkflowState.arrivedPickup:
      case LoadWorkflowState.bolRequired:
        return 'UPLOAD BILL OF LADING (BOL)';
      case LoadWorkflowState.bolRejected:
      case LoadWorkflowState.bolQualityFailed:
        return 'RE-UPLOAD BOL (REJECTED)';
      case LoadWorkflowState.bolUploaded:
      case LoadWorkflowState.bolQualityChecking:
      case LoadWorkflowState.bolVerifying:
        return 'BOL PENDING DISPATCH REVIEW';
      case LoadWorkflowState.bolAccepted:
      case LoadWorkflowState.loaded:
        return 'START TRANSIT TO DELIVERY';
      case LoadWorkflowState.inTransit:
      case LoadWorkflowState.goingToDelivery:
        return 'CONFIRM ARRIVAL AT RECEIVER';
      case LoadWorkflowState.arrivedDelivery:
      case LoadWorkflowState.podRequired:
        return 'UPLOAD PROOF OF DELIVERY (POD)';
      case LoadWorkflowState.podRejected:
      case LoadWorkflowState.podQualityFailed:
        return 'RE-UPLOAD POD (REJECTED)';
      case LoadWorkflowState.podUploaded:
      case LoadWorkflowState.podQualityChecking:
      case LoadWorkflowState.podVerifying:
        return 'POD PENDING DISPATCH REVIEW';
      case LoadWorkflowState.podAccepted:
      case LoadWorkflowState.delivered:
        return 'CONFIRM PAYMENT SETTLEMENT';
      case LoadWorkflowState.paid:
      case LoadWorkflowState.paymentConfirmed:
      case LoadWorkflowState.completed:
        return 'LOAD COMPLETED ✓';
    }
  }

  IconData _getActionIcon() {
    switch (workflowState) {
      case LoadWorkflowState.assigned:
        return Icons.assignment_turned_in_rounded;
      case LoadWorkflowState.accepted:
      case LoadWorkflowState.startTrip:
      case LoadWorkflowState.bolAccepted:
      case LoadWorkflowState.loaded:
        return Icons.navigation_rounded;
      case LoadWorkflowState.goingToPickup:
      case LoadWorkflowState.inTransit:
      case LoadWorkflowState.goingToDelivery:
        return Icons.check_circle_rounded;
      case LoadWorkflowState.arrivedPickup:
      case LoadWorkflowState.bolRequired:
      case LoadWorkflowState.bolRejected:
      case LoadWorkflowState.bolQualityFailed:
      case LoadWorkflowState.arrivedDelivery:
      case LoadWorkflowState.podRequired:
      case LoadWorkflowState.podRejected:
      case LoadWorkflowState.podQualityFailed:
        return Icons.camera_alt_rounded;
      case LoadWorkflowState.bolUploaded:
      case LoadWorkflowState.bolQualityChecking:
      case LoadWorkflowState.bolVerifying:
      case LoadWorkflowState.podUploaded:
      case LoadWorkflowState.podQualityChecking:
      case LoadWorkflowState.podVerifying:
        return Icons.hourglass_top_rounded;
      case LoadWorkflowState.podAccepted:
      case LoadWorkflowState.delivered:
        return Icons.attach_money_rounded;
      case LoadWorkflowState.paid:
      case LoadWorkflowState.paymentConfirmed:
      case LoadWorkflowState.completed:
        return Icons.verified_rounded;
    }
  }

  String _getSubtitleGuidance() {
    switch (workflowState) {
      case LoadWorkflowState.assigned:
        return 'Review load details and accept dispatch assignment.';
      case LoadWorkflowState.accepted:
      case LoadWorkflowState.startTrip:
        return 'Tap when driving to pickup facility in ${load.pickup}.';
      case LoadWorkflowState.goingToPickup:
        return 'En route to ${load.pickup}. Tap upon gate check-in.';
      case LoadWorkflowState.arrivedPickup:
      case LoadWorkflowState.bolRequired:
        return 'Take a clear, flat photo of signed shipper BOL.';
      case LoadWorkflowState.bolRejected:
      case LoadWorkflowState.bolQualityFailed:
        return 'BOL was rejected by Dispatch. Please take a clearer photo and resubmit.';
      case LoadWorkflowState.bolUploaded:
      case LoadWorkflowState.bolQualityChecking:
      case LoadWorkflowState.bolVerifying:
        return 'BOL submitted to Dispatch for approval. You will be notified once approved.';
      case LoadWorkflowState.bolAccepted:
      case LoadWorkflowState.loaded:
        return 'BOL approved! Ready to depart for ${load.dropoff}.';
      case LoadWorkflowState.inTransit:
      case LoadWorkflowState.goingToDelivery:
        return 'En route to ${load.dropoff}. Tap upon receiver arrival.';
      case LoadWorkflowState.arrivedDelivery:
      case LoadWorkflowState.podRequired:
        return 'Take photo of signed Delivery Receipt / POD.';
      case LoadWorkflowState.podRejected:
      case LoadWorkflowState.podQualityFailed:
        return 'POD was rejected by Dispatch. Please take a clearer photo and resubmit.';
      case LoadWorkflowState.podUploaded:
      case LoadWorkflowState.podQualityChecking:
      case LoadWorkflowState.podVerifying:
        return 'POD submitted to Dispatch for approval. You will be notified once approved.';
      case LoadWorkflowState.podAccepted:
      case LoadWorkflowState.delivered:
        return 'POD accepted. Confirm settlement to close load.';
      case LoadWorkflowState.paid:
      case LoadWorkflowState.paymentConfirmed:
      case LoadWorkflowState.completed:
        return 'Load completed and queued for settlement payout.';
    }
  }

  @override
  Widget build(BuildContext context) {
    final actionTitle = _getActionTitle();
    final actionIcon = _getActionIcon();
    final guidance = _getSubtitleGuidance();
    final isCompleted = workflowState == LoadWorkflowState.completed ||
        workflowState == LoadWorkflowState.paymentConfirmed;

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadius.xlBorder,
        border: Border.all(color: AppColors.borderLight),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 14,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 1. Stage & RC Rate Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: AppColors.bgSecondary,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.borderLight),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.navigation_rounded, size: 14, color: AppColors.emeraldDark),
                    const SizedBox(width: 5),
                    Text(
                      workflowState.displayTitle,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textDark,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: AppColors.emeraldSoft,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.emeraldPrimary.withValues(alpha: 0.2)),
                ),
                child: Text(
                  'RC: ${load.displayRcPrice}',
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w900,
                    color: AppColors.emeraldDark,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // 2. Metrics Grid (Remaining Miles, ETA, Status)
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFF8FAFC),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.borderLight),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'REMAINING MILES',
                        style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: AppColors.textMuted, letterSpacing: 0.5),
                      ),
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          const Icon(Icons.straighten_rounded, size: 16, color: AppColors.emeraldDark),
                          const SizedBox(width: 4),
                          Text(
                            '$milesRemaining mi',
                            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: AppColors.textDark),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                Container(width: 1, height: 32, color: AppColors.borderLight),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'ESTIMATED ARRIVAL',
                        style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: AppColors.textMuted, letterSpacing: 0.5),
                      ),
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          const Icon(Icons.schedule_rounded, size: 16, color: AppColors.emeraldDark),
                          const SizedBox(width: 4),
                          Flexible(
                            child: Text(
                              etaText,
                              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: AppColors.textDark),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                Container(width: 1, height: 32, color: AppColors.borderLight),
                const SizedBox(width: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text(
                      'STATUS',
                      style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: AppColors.textMuted, letterSpacing: 0.5),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      riskBadge,
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // 3. High-Contrast Hero Primary Action Button (56px minimum height)
          SizedBox(
            width: double.infinity,
            height: 56,
            child: ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: isCompleted
                    ? const Color(0xFF0F172A)
                    : (isProcessing
                        ? AppColors.statusInfo
                        : (workflowState == LoadWorkflowState.bolUploaded ||
                                workflowState == LoadWorkflowState.podUploaded ||
                                workflowState == LoadWorkflowState.bolVerifying ||
                                workflowState == LoadWorkflowState.podVerifying
                            ? const Color(0xFFD97706)
                            : (workflowState == LoadWorkflowState.bolRejected ||
                                    workflowState == LoadWorkflowState.podRejected ||
                                    workflowState == LoadWorkflowState.bolQualityFailed ||
                                    workflowState == LoadWorkflowState.podQualityFailed
                                ? const Color(0xFFDC2626)
                                : AppColors.emeraldPrimary))),
                foregroundColor: Colors.white,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              onPressed: isProcessing ? null : onPrimaryAction,
              icon: isProcessing
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                    )
                  : Icon(actionIcon, size: 22),
              label: Text(
                actionTitle,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 0.5,
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),

          // 3. Step-by-Step Guidance Text
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.info_outline_rounded, size: 16, color: AppColors.textMuted),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  statusMessage ?? guidance,
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: AppColors.textMuted,
                    fontWeight: FontWeight.w500,
                    height: 1.35,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
