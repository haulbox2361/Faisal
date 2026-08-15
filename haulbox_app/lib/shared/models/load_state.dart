enum LoadWorkflowState {
  assigned,
  accepted,
  startTrip,
  goingToPickup,
  arrivedPickup,
  bolRequired,
  bolUploaded,
  bolQualityChecking,
  bolQualityFailed,
  bolVerifying,
  bolRejected,
  bolAccepted,
  loaded,
  inTransit,
  goingToDelivery,
  arrivedDelivery,
  podRequired,
  podUploaded,
  podQualityChecking,
  podQualityFailed,
  podVerifying,
  podRejected,
  podAccepted,
  delivered,
  paid,
  paymentConfirmed,
  completed,
}

extension LoadWorkflowStateExtension on LoadWorkflowState {
  String get displayTitle {
    switch (this) {
      case LoadWorkflowState.assigned:
        return 'ASSIGNED';
      case LoadWorkflowState.accepted:
        return 'ACCEPTED';
      case LoadWorkflowState.startTrip:
        return 'READY TO START';
      case LoadWorkflowState.goingToPickup:
        return 'EN ROUTE TO PICKUP';
      case LoadWorkflowState.arrivedPickup:
      case LoadWorkflowState.bolRequired:
        return 'AT PICKUP';
      case LoadWorkflowState.bolUploaded:
      case LoadWorkflowState.bolQualityChecking:
      case LoadWorkflowState.bolVerifying:
        return 'BOL VERIFYING';
      case LoadWorkflowState.bolAccepted:
        return 'BOL APPROVED';
      case LoadWorkflowState.bolRejected:
      case LoadWorkflowState.bolQualityFailed:
        return 'BOL REJECTED';
      case LoadWorkflowState.loaded:
        return 'LOADED';
      case LoadWorkflowState.inTransit:
      case LoadWorkflowState.goingToDelivery:
        return 'IN TRANSIT';
      case LoadWorkflowState.arrivedDelivery:
      case LoadWorkflowState.podRequired:
        return 'AT DELIVERY';
      case LoadWorkflowState.podUploaded:
      case LoadWorkflowState.podQualityChecking:
      case LoadWorkflowState.podVerifying:
        return 'POD VERIFYING';
      case LoadWorkflowState.podAccepted:
        return 'POD APPROVED';
      case LoadWorkflowState.podRejected:
      case LoadWorkflowState.podQualityFailed:
        return 'POD REJECTED';
      case LoadWorkflowState.delivered:
        return 'DELIVERED';
      case LoadWorkflowState.paid:
        return 'PAYMENT RECEIVED';
      case LoadWorkflowState.paymentConfirmed:
      case LoadWorkflowState.completed:
        return 'SETTLED & CONFIRMED';
    }
  }

  String get nextActionText {
    switch (this) {
      case LoadWorkflowState.assigned:
        return 'ACCEPT LOAD';
      case LoadWorkflowState.accepted:
      case LoadWorkflowState.startTrip:
        return 'START TRIP';
      case LoadWorkflowState.goingToPickup:
        return 'ARRIVED AT PICKUP?';
      case LoadWorkflowState.arrivedPickup:
      case LoadWorkflowState.bolRequired:
        return 'UPLOAD BOL (REQUIRED)';
      case LoadWorkflowState.bolUploaded:
      case LoadWorkflowState.bolQualityChecking:
      case LoadWorkflowState.bolVerifying:
        return 'AI VERIFYING BOL...';
      case LoadWorkflowState.bolAccepted:
      case LoadWorkflowState.loaded:
        return 'MARK AS LOADED';
      case LoadWorkflowState.bolRejected:
      case LoadWorkflowState.bolQualityFailed:
        return 'RE-UPLOAD BOL';
      case LoadWorkflowState.inTransit:
      case LoadWorkflowState.goingToDelivery:
        return 'ARRIVED AT DELIVERY?';
      case LoadWorkflowState.arrivedDelivery:
      case LoadWorkflowState.podRequired:
        return 'UPLOAD POD (REQUIRED)';
      case LoadWorkflowState.podUploaded:
      case LoadWorkflowState.podQualityChecking:
      case LoadWorkflowState.podVerifying:
        return 'AI VERIFYING POD...';
      case LoadWorkflowState.podAccepted:
        return 'MARK DELIVERED';
      case LoadWorkflowState.podRejected:
      case LoadWorkflowState.podQualityFailed:
        return 'RE-UPLOAD POD';
      case LoadWorkflowState.delivered:
        return 'WAITING FOR PAYMENT';
      case LoadWorkflowState.paid:
        return 'CONFIRM PAYMENT RECEIVED';
      case LoadWorkflowState.paymentConfirmed:
      case LoadWorkflowState.completed:
        return 'LOAD COMPLETED';
    }
  }
}

class VerificationResult {
  final bool isAccepted;
  final bool isManualReview;
  final String? rejectionReason;
  final bool addressMatch;
  final bool weightOrSpecMatch;
  final bool signaturePresent;
  final bool qualityPass;

  const VerificationResult({
    required this.isAccepted,
    this.isManualReview = false,
    this.rejectionReason,
    this.addressMatch = true,
    this.weightOrSpecMatch = true,
    this.signaturePresent = true,
    this.qualityPass = true,
  });

  factory VerificationResult.accepted() => const VerificationResult(isAccepted: true);

  factory VerificationResult.rejected(String reason, {
    bool addressMatch = true,
    bool weightMatch = true,
    bool signaturePresent = true,
    bool qualityPass = true,
  }) => VerificationResult(
    isAccepted: false,
    rejectionReason: reason,
    addressMatch: addressMatch,
    weightOrSpecMatch: weightMatch,
    signaturePresent: signaturePresent,
    qualityPass: qualityPass,
  );
}
