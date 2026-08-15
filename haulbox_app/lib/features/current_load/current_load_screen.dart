import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../core/services/document_verification_service.dart';
import '../../core/services/external_map_service.dart';
import '../../core/services/location_permission_service.dart';
import '../../core/services/location_service.dart';
import '../../shared/models/load_model.dart';
import '../../shared/models/load_state.dart';
import '../../shared/widgets/haulbox_button.dart';
import '../auth/auth_provider.dart';

class CurrentLoadScreen extends StatefulWidget {
  final Function(int)? onNavigateTab;

  const CurrentLoadScreen({super.key, this.onNavigateTab});

  @override
  State<CurrentLoadScreen> createState() => _CurrentLoadScreenState();
}

class _CurrentLoadScreenState extends State<CurrentLoadScreen> with SingleTickerProviderStateMixin {
  // Load State Machine
  LoadWorkflowState _workflowState = LoadWorkflowState.startTrip;
  
  // Trip Progress & Tracking
  int _milesRemaining = 245;
  String _currentEtaText = '04:30 PM';
  String _riskBadge = '🟢 On Time';
  bool _isDelayed = false;
  StreamSubscription<DriverLocationUpdate>? _locationSub;

  // Verification & Quality States
  bool _isProcessing = false;
  String? _statusMessage;

  // Completion Animation Controller
  late AnimationController _celebrationController;
  late Animation<double> _scaleAnimation;
  bool _showCelebration = false;

  // Driver Online/Offline & Notifications State
  bool _isOnline = true;
  int _unreadNotifications = 3;

  @override
  void initState() {
    super.initState();
    _celebrationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _scaleAnimation = CurvedAnimation(
      parent: _celebrationController,
      curve: Curves.elasticOut,
    );

    // One-time initial location permission prompt & auto-assignment modal
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        LocationPermissionService.checkInitialLocationPermission(context);
        final load = Provider.of<AuthProvider>(context, listen: false).currentLoad;
        if (load != null && (load.status.toUpperCase() == 'ASSIGNED' || _workflowState == LoadWorkflowState.assigned)) {
          _showNewLoadAssignmentModal(load);
        }
      }
    });
  }

  @override
  void dispose() {
    _locationSub?.cancel();
    _celebrationController.dispose();
    super.dispose();
  }

  // 1. LOAD ASSIGNMENT FLOW — Full-screen modal on new load assignment
  void _showNewLoadAssignmentModal(LoadModel load) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.borderLight,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: AppColors.statusInfoSoft,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: AppColors.statusInfo.withValues(alpha: 0.3)),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.assignment_turned_in_rounded, size: 16, color: AppColors.statusInfo),
                    SizedBox(width: 6),
                    Text(
                      'NEW LOAD ASSIGNED',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w900,
                        color: AppColors.statusInfo,
                        letterSpacing: 0.6,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              Text(
                'Load #${load.loadNumber}',
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: AppColors.textDark),
              ),
              const SizedBox(height: 4),
              Text(
                'Broker: ${load.brokerName}',
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.textSecondary),
              ),
              const SizedBox(height: 20),

              // Route & Dates Card
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppColors.bgSecondary.withValues(alpha: 0.6),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.borderLight),
                ),
                child: Column(
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.arrow_upward_rounded, color: AppColors.emeraldDark, size: 20),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('PICKUP', style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: AppColors.textSubtle)),
                              Text(load.pickup, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: AppColors.textDark)),
                              Text(load.pickupDate, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary, fontWeight: FontWeight.w600)),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 10),
                      child: Divider(color: AppColors.borderLight, height: 1),
                    ),
                    Row(
                      children: [
                        const Icon(Icons.arrow_downward_rounded, color: AppColors.statusDanger, size: 20),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('DELIVERY', style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: AppColors.textSubtle)),
                              Text(load.dropoff, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: AppColors.textDark)),
                              Text(load.deliveryDate, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary, fontWeight: FontWeight.w600)),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),

              // Rate Summary Row
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  color: AppColors.emeraldSoft,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppColors.emeraldPrimary.withValues(alpha: 0.3)),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('DRIVER PAY RATE', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: AppColors.emeraldDark)),
                    Text(
                      '\$${load.driverPay != null ? load.driverPay!.toInt() : 1250}',
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: AppColors.emeraldDark),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),

              // 3 Buttons: View Full Details, Accept Load, Decline Load
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    side: const BorderSide(color: AppColors.borderLight, width: 1.5),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  onPressed: () {
                    Navigator.pop(ctx);
                    _openLoadDetailsScreen(load);
                  },
                  child: const Text('VIEW FULL DETAILS', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: AppColors.textDark)),
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.emeraldPrimary,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    elevation: 0,
                  ),
                  onPressed: () {
                    Navigator.pop(ctx);
                    _handleAcceptLoad(load);
                  },
                  child: const Text('ACCEPT LOAD', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, letterSpacing: 0.5)),
                ),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: () {
                  Navigator.pop(ctx);
                  _handleDeclineLoad(load);
                },
                child: const Text('DECLINE LOAD', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: AppColors.statusDanger)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // 2. LOAD DETAILS FULL BREAKDOWN SCREEN
  void _openLoadDetailsScreen(LoadModel load) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.88,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        expand: false,
        builder: (_, scrollController) => SafeArea(
          child: ListView(
            controller: scrollController,
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
            children: [
              Center(
                child: Container(
                  width: 44,
                  height: 4,
                  decoration: BoxDecoration(color: AppColors.borderLight, borderRadius: BorderRadius.circular(2)),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Load #${load.loadNumber}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: AppColors.textDark)),
                      Text('Broker: ${load.brokerName}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textSecondary)),
                    ],
                  ),
                  Text('\$${load.driverPay != null ? load.driverPay!.toInt() : 1250}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: AppColors.emeraldDark)),
                ],
              ),
              const SizedBox(height: 16),
              const Divider(color: AppColors.borderLight, height: 1),
              const SizedBox(height: 16),

              // Pickup Details
              const Text('PICKUP DETAILS', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: AppColors.emeraldDark, letterSpacing: 0.8)),
              const SizedBox(height: 6),
              Text(load.pickupAddress ?? '${load.pickup}, 123 Logistics Blvd', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.textDark)),
              Text('Date & Time: ${load.pickupDate} • ${load.pickupTime}', style: const TextStyle(fontSize: 13, color: AppColors.textSecondary, fontWeight: FontWeight.w600)),
              const SizedBox(height: 16),

              // Delivery Details
              const Text('DELIVERY DETAILS', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: AppColors.statusDanger, letterSpacing: 0.8)),
              const SizedBox(height: 6),
              Text(load.dropoffAddress ?? '${load.dropoff}, 700 Warehouse St', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.textDark)),
              Text('Date & Time: ${load.deliveryDate} • ${load.deliveryTime}', style: const TextStyle(fontSize: 13, color: AppColors.textSecondary, fontWeight: FontWeight.w600)),
              const SizedBox(height: 16),

              // Load Specs: Weight, Commodity, Miles
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.bgSecondary.withValues(alpha: 0.5),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppColors.borderLight),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    Column(children: [
                      const Text('WEIGHT', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: AppColors.textSubtle)),
                      Text(load.weight?.toString() ?? '42,500 lbs', style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: AppColors.textDark)),
                    ]),
                    Column(children: [
                      const Text('COMMODITY', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: AppColors.textSubtle)),
                      Text(load.commodity ?? 'Freight', style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: AppColors.textDark)),
                    ]),
                    Column(children: [
                      const Text('MILES', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: AppColors.textSubtle)),
                      Text('${load.miles ?? 245} mi', style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: AppColors.textDark)),
                    ]),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // Special Instructions & Notes
              const Text('SPECIAL INSTRUCTIONS & NOTES', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: AppColors.textSubtle, letterSpacing: 0.8)),
              const SizedBox(height: 6),
              Text(load.notes?.isNotEmpty == true ? load.notes! : 'Maintain temperature between 34-36°F. Check in at security gate 2 on arrival.', style: const TextStyle(fontSize: 13, color: AppColors.textDark, height: 1.4)),
              const SizedBox(height: 16),

              // Dispatcher & Emergency Contacts
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        side: const BorderSide(color: AppColors.borderLight),
                      ),
                      icon: const Icon(Icons.support_agent_rounded, size: 16, color: AppColors.statusInfo),
                      label: const Text('Dispatcher', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: AppColors.textDark)),
                      onPressed: () {
                        Navigator.pop(ctx);
                        if (widget.onNavigateTab != null) widget.onNavigateTab!(3);
                      },
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        side: const BorderSide(color: AppColors.borderLight),
                      ),
                      icon: const Icon(Icons.phone_in_talk_rounded, size: 16, color: AppColors.statusDanger),
                      label: const Text('24/7 Support', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: AppColors.textDark)),
                      onPressed: () {},
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),

              // Bottom Accept Button
              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.emeraldPrimary,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  onPressed: () {
                    Navigator.pop(ctx);
                    _handleAcceptLoad(load);
                  },
                  child: const Text('ACCEPT LOAD', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, letterSpacing: 0.5)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _handleAcceptLoad(LoadModel load) {
    setState(() {
      _workflowState = LoadWorkflowState.accepted;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Load Accepted! Status: ACCEPTED. Tap START TRIP when ready.'),
        backgroundColor: AppColors.emeraldPrimary,
      ),
    );
  }

  void _handleDeclineLoad(LoadModel load) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Load assignment declined.'),
        backgroundColor: AppColors.statusDanger,
      ),
    );
  }

  // DELAY DETECTION NOTIFICATION
  void _showDelayDetectionAlert(LoadModel load) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: AppColors.statusWarning, size: 24),
            SizedBox(width: 8),
            Text('Potential Delay Detected', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: AppColors.textDark)),
          ],
        ),
        content: const Text(
          'Traffic congestion detected on route. Updated ETA: 07:15 PM.\n\nWould you like to notify dispatch automatically?',
          style: TextStyle(fontSize: 13.5, color: AppColors.textSecondary, height: 1.4),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Dismiss', style: TextStyle(color: AppColors.textMuted, fontWeight: FontWeight.w700)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.statusInfo,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            onPressed: () {
              Navigator.pop(ctx);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Dispatcher notified of updated ETA: 07:15 PM.'), backgroundColor: AppColors.statusInfo),
              );
            },
            child: const Text('Notify Dispatcher (YES)', style: TextStyle(fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );
  }

  // PAYMENT RECEIVED CONFIRMATION MODAL
  void _showPaymentReceivedModal(LoadModel load) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(width: 44, height: 4, decoration: BoxDecoration(color: AppColors.borderLight, borderRadius: BorderRadius.circular(2))),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: const BoxDecoration(color: AppColors.emeraldSoft, shape: BoxShape.circle),
                child: const Icon(Icons.paid_rounded, size: 36, color: AppColors.emeraldDark),
              ),
              const SizedBox(height: 12),
              const Text('PAYMENT RECEIVED', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: AppColors.emeraldDark)),
              const SizedBox(height: 4),
              Text('Load #${load.loadNumber}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.textSecondary)),
              const SizedBox(height: 14),
              Text(
                '\$${load.driverPay != null ? load.driverPay!.toInt() : 1250}',
                style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w900, color: AppColors.emeraldDark),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.emeraldPrimary,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  onPressed: () {
                    Navigator.pop(ctx);
                    setState(() {
                      _workflowState = LoadWorkflowState.paymentConfirmed;
                    });
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Payment Confirmed! Load settled successfully.'), backgroundColor: AppColors.emeraldPrimary),
                    );
                  },
                  child: const Text('CONFIRM RECEIVED', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, letterSpacing: 0.5)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // 1. START TRIP ACTION
  Future<void> _handleStartTrip(LoadModel load) async {
    final granted = await LocationService().requestLocationPermission();
    if (!granted) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Location permission required for active trip navigation.'),
            backgroundColor: AppColors.statusDanger,
          ),
        );
      }
      return;
    }

    final initialDistance = (load.miles != null && load.miles! > 0) ? load.miles! : 245;

    setState(() {
      _workflowState = LoadWorkflowState.goingToPickup;
      _milesRemaining = (initialDistance * 0.35).round();
      _isDelayed = false;
      _riskBadge = '🟢 On Time';
    });

    LocationService().startTripTracking(
      loadId: load.id,
      initialMiles: _milesRemaining,
      onPickupArrived: () {
        if (mounted && _workflowState == LoadWorkflowState.goingToPickup) {
          setState(() {
            _workflowState = LoadWorkflowState.arrivedPickup;
            _milesRemaining = 0;
          });
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('📍 Geofence Detected: Arrived at Pickup Facility! Status: AT PICKUP.'),
              backgroundColor: Color(0xFFD97706),
            ),
          );
        }
      },
      onDeliveryArrived: () {
        if (mounted && _workflowState == LoadWorkflowState.inTransit) {
          setState(() {
            _workflowState = LoadWorkflowState.arrivedDelivery;
            _milesRemaining = 0;
          });
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('📍 Geofence Detected: Arrived at Delivery Destination! Status: AT DELIVERY.'),
              backgroundColor: Color(0xFFD97706),
            ),
          );
        }
      },
    );

    _locationSub?.cancel();
    _locationSub = LocationService().locationStream.listen((update) {
      if (mounted) {
        setState(() {
          _milesRemaining = update.milesRemaining;
          _currentEtaText = update.etaText;
          _riskBadge = update.riskBadge;
          _isDelayed = update.riskLevel == EtaRiskLevel.delayed || update.riskLevel == EtaRiskLevel.runningLate;
        });

        if (update.isNearPickup && _workflowState == LoadWorkflowState.goingToPickup) {
          setState(() {
            _workflowState = LoadWorkflowState.arrivedPickup;
            _milesRemaining = 0;
          });
        } else if (update.isNearDelivery && _workflowState == LoadWorkflowState.inTransit) {
          setState(() {
            _workflowState = LoadWorkflowState.arrivedDelivery;
            _milesRemaining = 0;
          });
        }
      }
    });
  }


  // 2. BOL UPLOAD FLOW (With Quality Check & AI Verification)
  void _openBolUploadModal(LoadModel load) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.borderLight,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Upload Bill of Lading (BOL)',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.textDark),
              ),
              const SizedBox(height: 6),
              const Text(
                'Capture a clear photo of the signed BOL with all 4 corners visible.',
                style: TextStyle(fontSize: 13, color: AppColors.textMuted),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 20),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.emeraldSoft,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.camera_alt_outlined, color: AppColors.emeraldPrimary),
                ),
                title: const Text('Take BOL Photo', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark)),
                subtitle: const Text('Primary Recommended Action', style: TextStyle(color: AppColors.emeraldPrimary, fontSize: 11.5, fontWeight: FontWeight.w600)),
                onTap: () {
                  Navigator.pop(ctx);
                  _handleInitialDocUploadSuccess(load, isBol: true);
                },
              ),
              const Divider(color: AppColors.borderLight, height: 1),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.bgSecondary,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.photo_library_outlined, color: AppColors.textPrimary),
                ),
                title: const Text('Choose BOL from Gallery / PDF', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark)),
                onTap: () {
                  Navigator.pop(ctx);
                  _handleInitialDocUploadSuccess(load, isBol: true);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  // STEP 2: SUPPORTING PICTURES PROMPT (BOL or POD)
  void _handleInitialDocUploadSuccess(LoadModel load, {required bool isBol}) {
    final docName = isBol ? 'BOL' : 'POD';
    final targetLabel = isBol ? 'BOL/load' : 'delivery/POD';

    showModalBottomSheet(
      context: context,
      isDismissible: false,
      enableDrag: false,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: const BoxDecoration(
                  color: AppColors.emeraldSoft,
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.check_circle_rounded, color: AppColors.emeraldDark, size: 28),
              ),
              const SizedBox(height: 14),
              Text(
                '$docName Uploaded ✓',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppColors.textDark),
              ),
              const SizedBox(height: 8),
              Text(
                'Do you have pictures of the $targetLabel that you want to attach?',
                style: const TextStyle(fontSize: 13.5, color: AppColors.textSecondary, height: 1.4),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        side: const BorderSide(color: AppColors.borderLight, width: 1.5),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      onPressed: () {
                        Navigator.pop(ctx);
                        if (isBol) {
                          _runBolAiVerification(load, supportingPicsCount: 0);
                        } else {
                          _runPodAiVerification(load, supportingPicsCount: 0);
                        }
                      },
                      child: const Text(
                        'Skip',
                        style: TextStyle(color: AppColors.textMuted, fontWeight: FontWeight.w800, fontSize: 14),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 2,
                    child: ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.emeraldPrimary,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      icon: const Icon(Icons.add_photo_alternate_outlined, size: 18),
                      label: const Text(
                        'Upload Pictures',
                        style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14),
                      ),
                      onPressed: () {
                        Navigator.pop(ctx);
                        _openMultiPicturePicker(load, isBol: isBol);
                      },
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  // STEP 2B: MULTI-PICTURE ATTACHMENT PICKER & REVIEW
  void _openMultiPicturePicker(LoadModel load, {required bool isBol}) {
    final docName = isBol ? 'BOL' : 'POD';
    List<String> pictures = ['cargo_photo_1.jpg', 'seal_number_2.jpg'];

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Attach $docName Pictures',
                      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: AppColors.textDark),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close_rounded, color: AppColors.textMuted),
                      onPressed: () => Navigator.pop(ctx),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  'Select or take multiple photos of cargo, freight labels, or seals.',
                  style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary),
                ),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    ...pictures.map((pic) => Stack(
                      children: [
                        Container(
                          width: 80,
                          height: 80,
                          decoration: BoxDecoration(
                            color: AppColors.bgSecondary,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: AppColors.borderLight),
                          ),
                          child: const Center(
                            child: Icon(Icons.image_outlined, color: AppColors.emeraldDark, size: 28),
                          ),
                        ),
                        Positioned(
                          top: 2,
                          right: 2,
                          child: GestureDetector(
                            onTap: () {
                              setModalState(() {
                                pictures.remove(pic);
                              });
                            },
                            child: Container(
                              padding: const EdgeInsets.all(2),
                              decoration: const BoxDecoration(color: Colors.red, shape: BoxShape.circle),
                              child: const Icon(Icons.close, size: 12, color: Colors.white),
                            ),
                          ),
                        ),
                      ],
                    )),
                    InkWell(
                      onTap: () {
                        setModalState(() {
                          pictures.add('photo_${pictures.length + 1}.jpg');
                        });
                      },
                      child: Container(
                        width: 80,
                        height: 80,
                        decoration: BoxDecoration(
                          color: AppColors.emeraldSoft,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: AppColors.emeraldPrimary, style: BorderStyle.solid),
                        ),
                        child: const Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.add_a_photo_outlined, color: AppColors.emeraldDark, size: 22),
                            SizedBox(height: 4),
                            Text('Add', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.emeraldDark)),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.emeraldPrimary,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(double.infinity, 48),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: () {
                    Navigator.pop(ctx);
                    if (isBol) {
                      _runBolAiVerification(load, supportingPicsCount: pictures.length);
                    } else {
                      _runPodAiVerification(load, supportingPicsCount: pictures.length);
                    }
                  },
                  child: Text(
                    'Submit $docName Pictures (${pictures.length})',
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // STEP 3: BOL AI VERIFICATION (Starts ONLY after supporting pictures workflow)
  Future<void> _runBolAiVerification(LoadModel load, {required int supportingPicsCount}) async {
    setState(() {
      _isProcessing = true;
      _statusMessage = 'AI is checking your BOL image quality & specs...';
    });

    final quality = await DocumentVerificationService.checkPhotoQuality();
    if (!quality.isPass) {
      setState(() {
        _isProcessing = false;
      });
      _showQualityErrorDialog(
        title: 'RETAKE REQUIRED',
        issue: quality.issueDescription ?? 'BOL photo is not clear enough. Please retake the photo with all 4 corners visible.',
        onRetake: () => _openBolUploadModal(load),
      );
      return;
    }

    setState(() {
      _statusMessage = 'Verifying BOL against Rate Confirmation...';
    });

    final result = await DocumentVerificationService.verifyBol(load: load);

    setState(() {
      _isProcessing = false;
    });

    if (result.isAccepted) {
      setState(() {
        _workflowState = LoadWorkflowState.goingToDelivery;
        _milesRemaining = 118;
      });

      // Track to Delivery
      LocationService().startTripTracking(
        loadId: load.id,
        initialMiles: 118,
        onGeofenceReached: () {
          if (mounted) {
            setState(() {
              _workflowState = LoadWorkflowState.arrivedDelivery;
              _milesRemaining = 0;
            });
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Arrived at Delivery Facility! Upload signed POD to finalize.'),
                backgroundColor: AppColors.emeraldPrimary,
              ),
            );
          }
        },
      );

      _locationSub?.cancel();
      _locationSub = LocationService().locationStream.listen((update) {
        if (mounted && _workflowState == LoadWorkflowState.goingToDelivery) {
          setState(() {
            _milesRemaining = update.milesRemaining;
          });
        }
      });

      _showVerificationSuccessModal(
        title: '✓ BOL APPROVED',
        checks: [
          {'title': 'Pickup Address Matches RC', 'pass': true},
          {'title': 'Weight Verified (42,500 lbs)', 'pass': true},
          {'title': 'Shipper Signature Present', 'pass': true},
          {'title': supportingPicsCount > 0 ? 'Supporting Pictures ($supportingPicsCount Photos)' : 'Supporting Pictures (Skipped)', 'pass': true},
        ],
      );
    } else {
      _showVerificationErrorModal(
        title: 'DISPATCHER REVIEW',
        reason: result.rejectionReason ?? 'Your BOL was sent to the dispatcher for review.',
        onRetake: () => _openBolUploadModal(load),
      );
    }
  }

  // 3. POD UPLOAD FLOW
  void _openPodUploadModal(LoadModel load) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.borderLight,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Upload Proof of Delivery (POD)',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.textDark),
              ),
              const SizedBox(height: 6),
              const Text(
                'Capture a clear photo of the signed delivery receipt with receiver signature visible.',
                style: TextStyle(fontSize: 13, color: AppColors.textMuted),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 20),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.emeraldSoft,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.camera_alt_outlined, color: AppColors.emeraldPrimary),
                ),
                title: const Text('Take POD Photo', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark)),
                subtitle: const Text('Primary Recommended Action', style: TextStyle(color: AppColors.emeraldPrimary, fontSize: 11.5, fontWeight: FontWeight.w600)),
                onTap: () {
                  Navigator.pop(ctx);
                  _handleInitialDocUploadSuccess(load, isBol: false);
                },
              ),
              const Divider(color: AppColors.borderLight, height: 1),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.bgSecondary,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.photo_library_outlined, color: AppColors.textPrimary),
                ),
                title: const Text('Choose POD from Gallery / PDF', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark)),
                onTap: () {
                  Navigator.pop(ctx);
                  _handleInitialDocUploadSuccess(load, isBol: false);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  // STEP 3: POD AI VERIFICATION (Starts ONLY after supporting pictures workflow)
  Future<void> _runPodAiVerification(LoadModel load, {required int supportingPicsCount}) async {
    setState(() {
      _isProcessing = true;
      _statusMessage = 'AI is checking your POD image quality...';
    });

    final quality = await DocumentVerificationService.checkPhotoQuality();
    if (!quality.isPass) {
      setState(() {
        _isProcessing = false;
      });
      _showQualityErrorDialog(
        title: 'RETAKE REQUIRED',
        issue: quality.issueDescription ?? 'POD photo is not clear enough. Please retake the photo with receiver signature clearly visible.',
        onRetake: () => _openPodUploadModal(load),
      );
      return;
    }

    setState(() {
      _statusMessage = 'Verifying POD with Consignee Receiver...';
    });

    final result = await DocumentVerificationService.verifyPod(load: load);

    setState(() {
      _isProcessing = false;
    });

    if (result.isAccepted) {
      setState(() {
        _workflowState = LoadWorkflowState.podAccepted;
      });

      _showVerificationSuccessModal(
        title: '✓ POD APPROVED',
        checks: [
          {'title': 'Drop-Off Address Matches RC', 'pass': true},
          {'title': 'Receiver Signature Present', 'pass': true},
          {'title': 'Delivery Timestamp Verified', 'pass': true},
          {'title': supportingPicsCount > 0 ? 'Supporting Pictures ($supportingPicsCount Photos)' : 'Supporting Pictures (Skipped)', 'pass': true},
        ],
      );
    } else {
      _showVerificationErrorModal(
        title: 'DISPATCHER REVIEW',
        reason: result.rejectionReason ?? 'Your POD was sent to the dispatcher for review.',
        onRetake: () => _openPodUploadModal(load),
      );
    }
  }

  // 4. COMPLETE LOAD CONFIRMATION POPUP
  void _showCompleteConfirmation(LoadModel load) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.xlBorder),
        title: const Text('Complete Load?', style: TextStyle(color: AppColors.textDark, fontWeight: FontWeight.w900, fontSize: 19)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildCheckItem('BOL', 'Verified & Stored'),
            _buildCheckItem('POD', 'Verified & Accepted'),
            _buildCheckItem('Pickup', 'Completed'),
            _buildCheckItem('Delivery', 'Completed'),
            const SizedBox(height: 12),
            const Text(
              'Completing this run will finalize the settlement and move this load to your Completed History.',
              style: TextStyle(color: AppColors.textMuted, fontSize: 12.5),
            ),
          ],
        ),
        actions: [
          TextButton(
            child: const Text('CANCEL', style: TextStyle(color: AppColors.textMuted, fontWeight: FontWeight.w700)),
            onPressed: () => Navigator.pop(ctx),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.emeraldPrimary),
            child: const Text('COMPLETE', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
            onPressed: () {
              Navigator.pop(ctx);
              _finalizeLoadCompletion(load);
            },
          ),
        ],
      ),
    );
  }

  // 5. FINAL CELEBRATION & SAVE TO COMPLETED HISTORY
  void _finalizeLoadCompletion(LoadModel load) {
    LocationService().stopTripTracking();
    Provider.of<AuthProvider>(context, listen: false).completeCurrentLoad(load.id);

    setState(() {
      _workflowState = LoadWorkflowState.completed;
      _showCelebration = true;
    });

    _celebrationController.forward();

    Timer(const Duration(milliseconds: 2500), () {
      if (mounted) {
        setState(() {
          _showCelebration = false;
        });
      }
    });
  }

  Widget _buildCheckItem(String label, String status) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          const Icon(Icons.check_circle_rounded, color: AppColors.emeraldPrimary, size: 18),
          const SizedBox(width: 8),
          Text('$label: ', style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark, fontSize: 13.5)),
          Text(status, style: const TextStyle(color: AppColors.emeraldPrimary, fontSize: 13.5, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }

  void _showQualityErrorDialog({required String title, required String issue, required VoidCallback onRetake}) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.lgBorder),
        title: Row(
          children: [
            const Icon(Icons.warning_amber_rounded, color: AppColors.statusWarning, size: 24),
            const SizedBox(width: 8),
            Text(title, style: const TextStyle(color: AppColors.textDark, fontWeight: FontWeight.w800, fontSize: 17)),
          ],
        ),
        content: Text(issue, style: const TextStyle(color: AppColors.textMuted, fontSize: 13.5)),
        actions: [
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.emeraldPrimary),
            onPressed: () {
              Navigator.pop(ctx);
              onRetake();
            },
            child: const Text('RETAKE PHOTO', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );
  }

  void _showVerificationSuccessModal({required String title, required List<Map<String, dynamic>> checks}) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.xlBorder),
        title: Row(
          children: [
            const Icon(Icons.verified_rounded, color: AppColors.emeraldPrimary, size: 24),
            const SizedBox(width: 8),
            Text(title, style: const TextStyle(color: AppColors.textDark, fontWeight: FontWeight.w900, fontSize: 18)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: checks.map((c) => Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(c['title'] as String, style: const TextStyle(color: AppColors.textDark, fontSize: 13.5, fontWeight: FontWeight.w600)),
                const Icon(Icons.check_rounded, color: AppColors.emeraldPrimary, size: 18),
              ],
            ),
          )).toList(),
        ),
        actions: [
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.emeraldPrimary),
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Continue Trip', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );
  }

  void _showVerificationErrorModal({required String title, required String reason, required VoidCallback onRetake}) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.lgBorder),
        title: Row(
          children: [
            const Icon(Icons.error_outline_rounded, color: AppColors.statusDanger, size: 24),
            const SizedBox(width: 8),
            Text(title, style: const TextStyle(color: AppColors.statusDanger, fontWeight: FontWeight.w900, fontSize: 18)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Reason:', style: TextStyle(color: AppColors.textSubtle, fontSize: 11, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(reason, style: const TextStyle(color: AppColors.textDark, fontSize: 13.5, fontWeight: FontWeight.w600)),
            const SizedBox(height: 10),
            const Text('Please correct the document and submit again.', style: TextStyle(color: AppColors.textMuted, fontSize: 12.5)),
          ],
        ),
        actions: [
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.statusDanger),
            onPressed: () {
              Navigator.pop(ctx);
              onRetake();
            },
            child: const Text('RETAKE BOL', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);
    final driver = authProvider.driver;
    final load = authProvider.currentLoad;

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      body: Stack(
        children: [
          Column(
            children: [
              // 1. TOP APP BAR (HaulBoX Logo, Online/Offline Toggle, Notification Bell, Driver Avatar)
              _buildTopAppBar(driver),

              // 2. SCROLLABLE DASHBOARD BODY
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () => authProvider.refreshLoads(),
                  backgroundColor: Colors.white,
                  color: AppColors.emeraldPrimary,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 32),
                    children: [
                      // HERO SECTION: CURRENT ACTIVE LOAD
                      if (load == null)
                        _buildEmptyHeroState()
                      else ...[
                        _buildMainCurrentLoadCard(load),
                      ],
                      const SizedBox(height: 18),

                      // QUICK ACTIONS (5 LARGE TOUCH-FRIENDLY BUTTONS)
                      _buildQuickActions(load),
                      const SizedBox(height: 20),

                      // TODAY'S SUMMARY (4 METRICS USING REAL DATA)
                      _buildTodaysSummary(authProvider),
                      const SizedBox(height: 20),

                      // RECENT NOTIFICATIONS (COMPACT REAL-TIME LIST)
                      _buildNotificationsSection(load),
                    ],
                  ),
                ),
              ),
            ],
          ),

          // CELEBRATION OVERLAY ANIMATION
          if (_showCelebration)
            _buildCelebrationOverlay(),

          // LOADING OVERLAY (During AI Verification)
          if (_isProcessing)
            Container(
              color: Colors.black.withValues(alpha: 0.5),
              child: Center(
                child: Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: AppRadius.xlBorder,
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.15),
                        blurRadius: 20,
                        offset: const Offset(0, 8),
                      ),
                    ],
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const CircularProgressIndicator(color: AppColors.emeraldPrimary),
                      const SizedBox(height: 16),
                      Text(
                        _statusMessage ?? 'Please wait...',
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: AppColors.textDark),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  // 1. TOP APP BAR (Navy #0F172A Header, Online/Offline Toggle, Bell with Badge)
  Widget _buildTopAppBar(dynamic driver) {
    return Container(
      padding: EdgeInsets.only(
        top: MediaQuery.of(context).padding.top + 8,
        left: 16,
        right: 12,
        bottom: 12,
      ),
      decoration: const BoxDecoration(
        color: AppColors.navyDark,
        border: Border(
          bottom: BorderSide(color: Color(0xFF1E293B), width: 1),
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // LEFT SIDE: HaulBoX Logo + Online/Offline Toggle Pill
          Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [AppColors.emeraldPrimary, Color(0xFF15803D)],
                  ),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Center(
                  child: Icon(Icons.local_shipping_rounded, color: Colors.white, size: 20),
                ),
              ),
              const SizedBox(width: 8),
              const Text(
                'HaulBoX',
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w900,
                  color: Colors.white,
                  letterSpacing: -0.4,
                ),
              ),
              const SizedBox(width: 10),
              // ONLINE / OFFLINE TOGGLE PILL
              GestureDetector(
                onTap: () {
                  setState(() => _isOnline = !_isOnline);
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(_isOnline ? 'You are now ONLINE and available for loads.' : 'You are now OFFLINE.'),
                      duration: const Duration(seconds: 2),
                      backgroundColor: _isOnline ? AppColors.emeraldPrimary : const Color(0xFF475569),
                    ),
                  );
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: _isOnline ? const Color(0xFF064E3B) : const Color(0xFF334155),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                      color: _isOnline ? AppColors.emeraldPrimary.withValues(alpha: 0.6) : Colors.white24,
                      width: 1,
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 7,
                        height: 7,
                        decoration: BoxDecoration(
                          color: _isOnline ? const Color(0xFF34D399) : Colors.white54,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 5),
                      Text(
                        _isOnline ? 'ONLINE' : 'OFFLINE',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w900,
                          color: _isOnline ? const Color(0xFF6EE7B7) : Colors.white70,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),

          // RIGHT SIDE: Notification Bell + Driver Photo/Avatar + Name
          Row(
            children: [
              // NOTIFICATION BELL WITH UNREAD BADGE
              IconButton(
                padding: const EdgeInsets.all(6),
                constraints: const BoxConstraints(),
                icon: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    const Icon(Icons.notifications_none_rounded, color: Colors.white, size: 22),
                    if (_unreadNotifications > 0)
                      Positioned(
                        right: -3,
                        top: -3,
                        child: Container(
                          padding: const EdgeInsets.all(3),
                          decoration: const BoxDecoration(
                            color: Color(0xFFEF4444),
                            shape: BoxShape.circle,
                          ),
                          constraints: const BoxConstraints(minWidth: 15, minHeight: 15),
                          child: Text(
                            '$_unreadNotifications',
                            style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w900),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ),
                  ],
                ),
                onPressed: _showNotificationsBottomSheet,
              ),
              const SizedBox(width: 8),

              // DRIVER AVATAR WITH ONLINE DOT
              Stack(
                children: [
                  Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [AppColors.emeraldPrimary, Color(0xFF15803D)],
                      ),
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white.withValues(alpha: 0.8), width: 1.5),
                    ),
                    child: Center(
                      child: driver?.profilePhotoUrl != null
                          ? const Icon(Icons.person_rounded, color: Colors.white, size: 20)
                          : Text(
                              driver?.name?.isNotEmpty == true ? (driver.name as String)[0].toUpperCase() : 'J',
                              style: const TextStyle(fontWeight: FontWeight.w900, color: Colors.white, fontSize: 14),
                            ),
                    ),
                  ),
                  if (_isOnline)
                    Positioned(
                      right: 0,
                      bottom: 0,
                      child: Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                          color: const Color(0xFF22C55E),
                          shape: BoxShape.circle,
                          border: Border.all(color: AppColors.navyDark, width: 2),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(width: 8),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 85),
                child: Text(
                  driver?.name ?? 'John D.',
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // 2. QUICK ACTIONS (5 LARGE TOUCH-FRIENDLY BUTTONS)
  Widget _buildQuickActions(LoadModel? load) {
    final actions = [
      {'label': 'Loads', 'icon': Icons.local_shipping_rounded, 'color': AppColors.statusInfo, 'type': 'tab', 'val': 0},
      {'label': 'Documents', 'icon': Icons.description_rounded, 'color': const Color(0xFFF59E0B), 'type': 'doc', 'val': load},
      {'label': 'Payments', 'icon': Icons.account_balance_wallet_rounded, 'color': AppColors.emeraldPrimary, 'type': 'tab', 'val': 1},
      {'label': 'Chat', 'icon': Icons.chat_bubble_rounded, 'color': const Color(0xFF8B5CF6), 'type': 'tab', 'val': 3},
      {'label': 'Profile', 'icon': Icons.person_rounded, 'color': const Color(0xFF64748B), 'type': 'tab', 'val': 4},
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(left: 4, bottom: 10),
          child: Text(
            'QUICK ACTIONS',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w900,
              color: AppColors.textSubtle,
              letterSpacing: 0.8,
            ),
          ),
        ),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: actions.map((act) {
            return Expanded(
              child: GestureDetector(
                onTap: () {
                  if (act['type'] == 'tab') {
                    widget.onNavigateTab?.call(act['val'] as int);
                  } else if (act['type'] == 'doc') {
                    if (load != null) {
                      _openBolUploadModal(load);
                    } else {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('No active load to attach documents.')),
                      );
                    }
                  }
                },
                child: Container(
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: AppRadius.lgBorder,
                    border: Border.all(color: AppColors.borderLight),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.03),
                        blurRadius: 8,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(9),
                        decoration: BoxDecoration(
                          color: (act['color'] as Color).withValues(alpha: 0.12),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(act['icon'] as IconData, size: 20, color: act['color'] as Color),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        act['label'] as String,
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textDark,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
              ),
            );
          }).toList(),
        ),
      ],
    );
  }

  // 3. TODAY'S SUMMARY (4 METRICS USING REAL PROVIDER DATA)
  Widget _buildTodaysSummary(AuthProvider auth) {
    final allLoads = auth.loads;
    final activeLoadsCount = allLoads.where((l) => !['COMPLETED', 'DELIVERED', 'CANCELLED'].contains(l.status.toUpperCase())).length;
    final completedLoadsCount = allLoads.where((l) => ['COMPLETED', 'DELIVERED'].contains(l.status.toUpperCase())).length;
    final totalMiles = allLoads.fold<int>(0, (sum, l) {
      final m = l.miles;
      final intVal = m is num ? m.toInt() : (int.tryParse(m?.toString() ?? '') ?? 245);
      return sum + intVal;
    });
    final grossEarnings = allLoads.fold<double>(0.0, (sum, l) {
      final p = l.driverPay;
      final doubleVal = p is num ? p.toDouble() : (double.tryParse(p?.toString() ?? '') ?? 1250.0);
      return sum + doubleVal;
    });

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(left: 4, bottom: 10),
          child: Text(
            "TODAY'S SUMMARY",
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w900,
              color: AppColors.textSubtle,
              letterSpacing: 0.8,
            ),
          ),
        ),
        Row(
          children: [
            Expanded(
              child: _buildSummaryMetricCard(
                label: 'Active Loads',
                value: '$activeLoadsCount',
                icon: Icons.local_shipping_rounded,
                color: AppColors.statusInfo,
                subtext: 'In progress',
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _buildSummaryMetricCard(
                label: 'Total Miles',
                value: '$totalMiles mi',
                icon: Icons.alt_route_rounded,
                color: const Color(0xFF0284C7),
                subtext: 'Route logged',
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _buildSummaryMetricCard(
                label: 'Gross Earnings',
                value: '\$${grossEarnings.toInt()}',
                icon: Icons.attach_money_rounded,
                color: AppColors.emeraldPrimary,
                subtext: 'Settled & pending',
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _buildSummaryMetricCard(
                label: 'Completed',
                value: '$completedLoadsCount',
                icon: Icons.check_circle_rounded,
                color: const Color(0xFF10B981),
                subtext: 'Delivered',
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildSummaryMetricCard({
    required String label,
    required String value,
    required IconData icon,
    required Color color,
    required String subtext,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadius.lgBorder,
        border: Border.all(color: AppColors.borderLight),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                label,
                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.textSubtle),
              ),
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, size: 14, color: color),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppColors.textDark, letterSpacing: -0.4),
          ),
          const SizedBox(height: 2),
          Text(
            subtext,
            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: AppColors.textSubtle),
          ),
        ],
      ),
    );
  }

  // 4. NOTIFICATIONS COMPACT LIST
  Widget _buildNotificationsSection(LoadModel? load) {
    final notifications = [
      {
        'title': 'New Load Assigned',
        'desc': load != null ? 'Load #${load.loadNumber} assigned by dispatch' : 'Load #HB-10425 assigned by dispatch',
        'time': '10m ago',
        'icon': Icons.assignment_turned_in_rounded,
        'color': AppColors.statusInfo,
      },
      {
        'title': 'Dispatcher Message',
        'desc': 'Please confirm seal number before departing pickup facility.',
        'time': '35m ago',
        'icon': Icons.chat_bubble_outline_rounded,
        'color': const Color(0xFF8B5CF6),
      },
      {
        'title': 'BOL Verification Passed',
        'desc': 'AI document analysis verified 4 corners and shipper signature.',
        'time': '1h ago',
        'icon': Icons.verified_rounded,
        'color': AppColors.emeraldPrimary,
      },
      {
        'title': 'Payment Settled',
        'desc': '\$1,250 settlement approved and queued for direct deposit.',
        'time': '3h ago',
        'icon': Icons.payments_outlined,
        'color': const Color(0xFF10B981),
      },
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Padding(
              padding: EdgeInsets.only(left: 4),
              child: Text(
                'RECENT NOTIFICATIONS',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                  color: AppColors.textSubtle,
                  letterSpacing: 0.8,
                ),
              ),
            ),
            TextButton(
              onPressed: _showNotificationsBottomSheet,
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text('View All', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: AppColors.emeraldDark)),
            ),
          ],
        ),
        const SizedBox(height: 8),
        ...notifications.map((n) {
          return Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: AppRadius.lgBorder,
              border: Border.all(color: AppColors.borderLight),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: (n['color'] as Color).withValues(alpha: 0.12),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(n['icon'] as IconData, size: 16, color: n['color'] as Color),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            n['title'] as String,
                            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: AppColors.textDark),
                          ),
                          Text(
                            n['time'] as String,
                            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: AppColors.textSubtle),
                          ),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        n['desc'] as String,
                        style: const TextStyle(fontSize: 11.5, color: AppColors.textSecondary, height: 1.3),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          );
        }),
      ],
    );
  }

  // 5. NOTIFICATIONS MODAL BOTTOM SHEET
  void _showNotificationsBottomSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(color: AppColors.borderLight, borderRadius: BorderRadius.circular(2)),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Notifications', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppColors.textDark)),
                  TextButton(
                    onPressed: () {
                      setState(() => _unreadNotifications = 0);
                      Navigator.pop(ctx);
                    },
                    child: const Text('Mark all read', style: TextStyle(fontWeight: FontWeight.w800, color: AppColors.emeraldDark)),
                  ),
                ],
              ),
              const Divider(color: AppColors.borderLight),
              const SizedBox(height: 8),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const CircleAvatar(backgroundColor: AppColors.statusInfoSoft, child: Icon(Icons.assignment_turned_in_rounded, color: AppColors.statusInfo, size: 20)),
                title: const Text('New Load Assigned: #HB-10425', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                subtitle: const Text('Chicago, IL ➔ Dallas, TX (\$1,250)', style: TextStyle(fontSize: 12)),
                trailing: const Text('10m', style: TextStyle(fontSize: 11, color: AppColors.textSubtle)),
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const CircleAvatar(backgroundColor: Color(0xFFF3E8FF), child: Icon(Icons.chat_bubble_outline_rounded, color: Color(0xFF8B5CF6), size: 20)),
                title: const Text('Dispatcher Message', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                subtitle: const Text('Please confirm seal number before departure.', style: TextStyle(fontSize: 12)),
                trailing: const Text('35m', style: TextStyle(fontSize: 11, color: AppColors.textSubtle)),
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const CircleAvatar(backgroundColor: AppColors.emeraldSoft, child: Icon(Icons.verified_rounded, color: AppColors.emeraldDark, size: 20)),
                title: const Text('BOL Verification Approved', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                subtitle: const Text('Shipper signature verified by AI.', style: TextStyle(fontSize: 12)),
                trailing: const Text('1h', style: TextStyle(fontSize: 11, color: AppColors.textSubtle)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // 6. EMPTY HERO CARD STATE (Ready For Next Load)
  Widget _buildEmptyHeroState() {
    return Container(
      padding: const EdgeInsets.all(24),
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
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.emeraldSoft.withValues(alpha: 0.6),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.local_shipping_rounded, size: 36, color: AppColors.emeraldDark),
          ),
          const SizedBox(height: 14),
          const Text(
            'Ready For Next Load',
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: AppColors.textDark),
          ),
          const SizedBox(height: 4),
          const Text(
            'You are online. When dispatch assigns your next run, it will appear here instantly.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12.5, color: AppColors.textSecondary, height: 1.4),
          ),
        ],
      ),
    );
  }

  // 2. MAIN CURRENT LOAD HERO CARD (HaulBoX Theme, Clear Next Action)
  Widget _buildMainCurrentLoadCard(LoadModel load) {
    final rateString = load.driverPay != null ? '\$${load.driverPay!.toInt()}' : '\$1,850';

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadius.xlBorder,
        border: Border.all(color: AppColors.borderLight, width: 1),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 18,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 0. HERO TOP HEADER: CURRENT LOAD BADGE & LIVE STATUS & VIEW LOAD BUTTON
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.navyDark,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.local_shipping_rounded, size: 13, color: AppColors.emeraldPrimary),
                        SizedBox(width: 5),
                        Text(
                          'CURRENT LOAD',
                          style: TextStyle(
                            fontSize: 10.5,
                            fontWeight: FontWeight.w900,
                            color: Colors.white,
                            letterSpacing: 0.8,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.emeraldSoft,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: AppColors.emeraldPrimary.withValues(alpha: 0.3)),
                    ),
                    child: Text(
                      _workflowState.displayTitle,
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w900,
                        color: AppColors.emeraldDark,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                ],
              ),
              // VIEW LOAD BUTTON
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.navyDark,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  elevation: 0,
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                icon: const Icon(Icons.info_outline_rounded, size: 13, color: Colors.white),
                label: const Text('VIEW LOAD', style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w900, letterSpacing: 0.4)),
                onPressed: () => _openLoadDetailsScreen(load),
              ),
            ],
          ),

          const SizedBox(height: 14),

          // TOP ROW: Load # (LEFT) & Rate (RIGHT)
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // LEFT: Load Number & Broker
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Load #${load.loadNumber}',
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w900,
                      color: AppColors.textDark,
                      letterSpacing: -0.4,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      const Text(
                        'Broker: ',
                        style: TextStyle(fontSize: 12, color: AppColors.textSubtle, fontWeight: FontWeight.w600),
                      ),
                      Text(
                        load.brokerName,
                        style: const TextStyle(fontSize: 12.5, color: AppColors.textPrimary, fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                ],
              ),

              // RIGHT: Rate (from RC)
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    rateString,
                    style: const TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w900,
                      color: AppColors.emeraldDark,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const Text(
                    'RATE',
                    style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: AppColors.textSubtle, letterSpacing: 0.5),
                  ),
                ],
              ),
            ],
          ),

          const SizedBox(height: 14),

          // NEXT REQUIRED ACTION BANNER (The driver will never wonder what to do next)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: AppColors.bgSecondary.withValues(alpha: 0.7),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.borderLight),
            ),
            child: Row(
              children: [
                const Icon(Icons.arrow_forward_rounded, size: 16, color: AppColors.emeraldDark),
                const SizedBox(width: 8),
                const Text(
                  'NEXT ACTION: ',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: AppColors.textSubtle, letterSpacing: 0.5),
                ),
                Expanded(
                  child: Text(
                    _workflowState.nextActionText,
                    style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w900, color: AppColors.textDark),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 12),

          // DELAY ALERT BANNER (If traffic or tight appointment detected)
          if (_isDelayed)
            Container(
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF2F2),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0xFFFCA5A5)),
              ),
              child: const Row(
                children: [
                  Icon(Icons.warning_amber_rounded, size: 16, color: Color(0xFFDC2626)),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Potential ETA delay detected. Dispatch has been notified.',
                      style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: Color(0xFFB91C1C)),
                    ),
                  ),
                ],
              ),
            ),

          // ETA & REMAINING MILES METRICS ROW

          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: AppColors.bgSecondary,
              borderRadius: AppRadius.mdBorder,
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Icon(Icons.timer_outlined, size: 16, color: AppColors.emeraldDark),
                    const SizedBox(width: 6),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Text('ETA', style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: AppColors.textSubtle, letterSpacing: 0.5)),
                            const SizedBox(width: 4),
                            Text(_riskBadge, style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w800)),
                          ],
                        ),
                        Text(_currentEtaText.isNotEmpty ? _currentEtaText : load.eta, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: AppColors.textDark)),
                      ],
                    ),
                  ],
                ),
                Container(width: 1, height: 24, color: AppColors.borderLight),
                Row(
                  children: [
                    const Icon(Icons.speed_rounded, size: 16, color: AppColors.statusInfo),
                    const SizedBox(width: 6),
                    const Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('SPEED', style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: AppColors.textSubtle, letterSpacing: 0.5)),
                        Text('62 mph', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: AppColors.textDark)),
                      ],
                    ),
                  ],
                ),
                Container(width: 1, height: 24, color: AppColors.borderLight),
                Row(
                  children: [
                    const Icon(Icons.route_outlined, size: 16, color: AppColors.textPrimary),
                    const SizedBox(width: 6),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('REMAINING', style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: AppColors.textSubtle, letterSpacing: 0.5)),
                        Text('$_milesRemaining mi', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: AppColors.textDark)),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),


          const Padding(
            padding: EdgeInsets.symmetric(vertical: 14),
            child: Divider(color: AppColors.borderLight, height: 1),
          ),

          // 1. COMPLETE LOAD ROUTE BAR (Full Route)
          _buildLargeFullRouteBar(load),
          const SizedBox(height: 14),

          // 2. STATUS BAR CONTROL & WORKFLOW (e.g. START TRIP)
          _buildTripProgressWorkflow(load),
          const SizedBox(height: 16),

          const Divider(color: AppColors.borderLight, height: 1),
          const SizedBox(height: 14),

          // 3. PICKUP (PU) SECTION (Driver current location -> PU)
          _buildPuSection(load),

          const Padding(
            padding: EdgeInsets.symmetric(vertical: 6, horizontal: 16),
            child: Row(
              children: [
                Icon(Icons.arrow_downward_rounded, size: 14, color: AppColors.textSubtle),
                SizedBox(width: 6),
                Text('DIRECT ROUTE', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: AppColors.textSubtle, letterSpacing: 0.5)),
              ],
            ),
          ),

          // 4. DROP-OFF (DO) SECTION (Driver current location -> DO)
          _buildDoSection(load),

          const Padding(
            padding: EdgeInsets.symmetric(vertical: 14),
            child: Divider(color: AppColors.borderLight, height: 1),
          ),

          // 5. LOAD DOCUMENTS & COMPLIANCE
          _buildCurrentLoadDocumentsSection(load),
        ],
      ),
    );
  }

  // 1. PU SECTION (Driver current location -> PU)
  Widget _buildPuSection(LoadModel load) {
    final puAddress = load.pickupAddress ?? '123 Logistics Blvd, Dallas, TX 75201';

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.bgSecondary.withValues(alpha: 0.5),
        borderRadius: AppRadius.mdBorder,
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: const BoxDecoration(
              color: AppColors.emeraldSoft,
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.arrow_upward_rounded, size: 16, color: AppColors.emeraldDark),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Text('PU (PICKUP)', style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: AppColors.emeraldDark, letterSpacing: 0.5)),
                    SizedBox(width: 6),
                    Icon(Icons.location_on_rounded, size: 12, color: AppColors.emeraldDark),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  puAddress,
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.textDark),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 3),
                const Text(
                  '42.5 mi • 52 min to Pickup',
                  style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: AppColors.emeraldDark,
              elevation: 0,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              side: const BorderSide(color: AppColors.emeraldPrimary, width: 1.5),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            icon: const Icon(Icons.navigation_rounded, size: 16, color: AppColors.emeraldDark),
            label: const Text('Navigate to Pickup', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w900)),
            onPressed: () {
              ExternalMapService.openNavigateToPickup(puAddress);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Opening Google Maps navigation to: $puAddress'),
                  backgroundColor: AppColors.emeraldPrimary,
                  duration: const Duration(seconds: 2),
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  // 2. DO SECTION (Driver current location -> DO)
  Widget _buildDoSection(LoadModel load) {
    final doAddress = load.dropoffAddress ?? '700 Warehouse St, Houston, TX 77001';

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.bgSecondary.withValues(alpha: 0.5),
        borderRadius: AppRadius.mdBorder,
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: const BoxDecoration(
              color: AppColors.statusDangerSoft,
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.arrow_downward_rounded, size: 16, color: AppColors.statusDanger),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Text('DO (DELIVERY)', style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: AppColors.statusDanger, letterSpacing: 0.5)),
                    SizedBox(width: 6),
                    Icon(Icons.location_on_rounded, size: 12, color: AppColors.statusDanger),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  doAddress,
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.textDark),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 3),
                Text(
                  '${load.miles} mi • $_currentEtaText',
                  style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: AppColors.statusDanger,
              elevation: 0,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              side: const BorderSide(color: AppColors.statusDanger, width: 1.5),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            icon: const Icon(Icons.navigation_rounded, size: 16, color: AppColors.statusDanger),
            label: const Text('Navigate to Delivery', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w900)),
            onPressed: () {
              ExternalMapService.openNavigateToDelivery(doAddress);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Opening Google Maps navigation to: $doAddress'),
                  backgroundColor: AppColors.statusDanger,
                  duration: const Duration(seconds: 2),
                ),
              );
            },
          ),
        ],
      ),
    );
  }


  // 3. LARGE PU -> DO ROUTE BAR (Complete Load Route: PU -> DO)
  Widget _buildLargeFullRouteBar(LoadModel load) {
    final puCity = load.pickup.isNotEmpty ? load.pickup : 'Dallas, TX';
    final doCity = load.dropoff.isNotEmpty ? load.dropoff : 'Houston, TX';
    final puAddress = load.pickupAddress ?? puCity;
    final doAddress = load.dropoffAddress ?? doCity;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () {
          ExternalMapService.openRouteNavigation(puAddress, doAddress);
        },
        borderRadius: AppRadius.lgBorder,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            color: AppColors.emeraldSoft,
            borderRadius: AppRadius.lgBorder,
            border: Border.all(color: AppColors.emeraldPrimary.withValues(alpha: 0.4), width: 1.5),
            boxShadow: [
              BoxShadow(
                color: AppColors.emeraldPrimary.withValues(alpha: 0.08),
                blurRadius: 10,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header Tag
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.alt_route_rounded, size: 14, color: AppColors.emeraldDark),
                      SizedBox(width: 6),
                      Text(
                        'COMPLETE LOAD ROUTE',
                        style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w900,
                          color: AppColors.emeraldDark,
                          letterSpacing: 0.7,
                        ),
                      ),
                    ],
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppColors.emeraldPrimary,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.explore_rounded, size: 12, color: Colors.white),
                        SizedBox(width: 4),
                        Text(
                          'View Full Route',
                          style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: Colors.white),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),

              // Visual Route Line: Dallas, TX ─────────→ Houston, TX
              Row(
                children: [
                  Expanded(
                    child: Text(
                      puCity,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                        color: AppColors.textDark,
                        letterSpacing: -0.2,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 8),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.arrow_forward_rounded, color: AppColors.emeraldDark, size: 18),
                      ],
                    ),
                  ),
                  Expanded(
                    child: Text(
                      doCity,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                        color: AppColors.textDark,
                        letterSpacing: -0.2,
                      ),
                      textAlign: TextAlign.right,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),

              // Total Route Info: 238 mi • 3 hr 32 min
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '${load.miles} mi • ${load.eta}',
                    style: const TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.navyDark,
                    ),
                  ),
                  const Text(
                    'PU → DO in Google Maps',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textMuted,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  // 3. TRIP PROGRESS BAR & LOAD STATE MACHINE CONTROL (All 13 Load Lifecycle States)
  Widget _buildTripProgressWorkflow(LoadModel load) {
    switch (_workflowState) {
      // 1. ASSIGNED
      case LoadWorkflowState.assigned:
        return Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.statusInfoSoft,
                borderRadius: AppRadius.lgBorder,
                border: Border.all(color: AppColors.statusInfo.withValues(alpha: 0.3)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.assignment_turned_in_rounded, color: AppColors.statusInfo, size: 22),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('NEW LOAD DISPATCHED', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: AppColors.statusInfo, letterSpacing: 0.5)),
                        Text('Review rate & instructions for #${load.loadNumber}', style: const TextStyle(fontSize: 11.5, color: AppColors.textSecondary, fontWeight: FontWeight.w600)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      side: const BorderSide(color: AppColors.borderLight, width: 1.5),
                      shape: RoundedRectangleBorder(borderRadius: AppRadius.lgBorder),
                    ),
                    onPressed: () => _showNewLoadAssignmentModal(load),
                    child: const Text('VIEW DETAILS', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: AppColors.textDark)),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  flex: 2,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.emeraldPrimary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: AppRadius.lgBorder),
                      elevation: 0,
                    ),
                    onPressed: () => _handleAcceptLoad(load),
                    child: const Text('ACCEPT LOAD', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, letterSpacing: 0.5)),
                  ),
                ),
              ],
            ),
          ],
        );

      // 2. ACCEPTED / READY TO START TRIP
      case LoadWorkflowState.accepted:
      case LoadWorkflowState.startTrip:
        return Column(
          children: [
            Container(
              width: double.infinity,
              height: 54,
              decoration: BoxDecoration(
                color: AppColors.buttonStartTrip,
                borderRadius: AppRadius.lgBorder,
                boxShadow: [
                  BoxShadow(
                    color: AppColors.buttonStartTrip.withValues(alpha: 0.3),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  borderRadius: AppRadius.lgBorder,
                  onTap: () => _handleStartTrip(load),
                  child: const Center(
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.navigation_rounded, color: Colors.white, size: 20),
                        SizedBox(width: 8),
                        Text(
                          'START TRIP',
                          style: TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w900,
                            color: Colors.white,
                            letterSpacing: 1.0,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        );

      // 3. GOING TOWARD PICKUP (EN ROUTE)
      case LoadWorkflowState.goingToPickup:
        final progress = (145 - _milesRemaining) / 145;
        return Column(
          children: [
            _buildActiveProgressBar(
              title: 'EN ROUTE TO PICKUP',
              remainingText: '$_milesRemaining mi remaining',
              progress: progress.clamp(0.05, 1.0),
              color: AppColors.emeraldPrimary,
              onDevAdvance: () {
                setState(() {
                  _workflowState = LoadWorkflowState.arrivedPickup;
                  _milesRemaining = 0;
                });
              },
            ),
            const SizedBox(height: 10),
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFD97706),
                foregroundColor: Colors.white,
                minimumSize: const Size(double.infinity, 48),
                shape: RoundedRectangleBorder(borderRadius: AppRadius.mdBorder),
                elevation: 0,
              ),
              icon: const Icon(Icons.pin_drop_rounded, size: 18),
              label: const Text('ARRIVED AT PICKUP? (CONFIRM)', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
              onPressed: () {
                setState(() {
                  _workflowState = LoadWorkflowState.arrivedPickup;
                  _milesRemaining = 0;
                });
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Status updated: AT PICKUP. Please upload BOL.'), backgroundColor: Color(0xFFD97706)),
                );
              },
            ),
          ],
        );

      // 4. AT PICKUP (BOL REQUIRED)
      case LoadWorkflowState.arrivedPickup:
        return Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF3C7),
                borderRadius: AppRadius.lgBorder,
                border: Border.all(color: const Color(0xFFD97706).withValues(alpha: 0.3)),
              ),
              child: const Row(
                children: [
                  Icon(Icons.camera_alt_rounded, color: Color(0xFFD97706), size: 20),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'AT PICKUP — BOL UPLOAD REQUIRED',
                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: Color(0xFFB45309), letterSpacing: 0.4),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            HaulBoxButton(
              text: 'UPLOAD BOL (REQUIRED)',
              icon: Icons.camera_alt_outlined,
              onPressed: () => _openBolUploadModal(load),
            ),
          ],
        );

      // 5. BOL UPLOADED / VERIFYING
      case LoadWorkflowState.bolUploaded:
      case LoadWorkflowState.bolQualityChecking:
      case LoadWorkflowState.bolVerifying:
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 16),
          decoration: BoxDecoration(
            color: AppColors.statusInfoSoft,
            borderRadius: AppRadius.lgBorder,
            border: Border.all(color: AppColors.statusInfo.withValues(alpha: 0.3)),
          ),
          child: const Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.statusInfo)),
              SizedBox(width: 10),
              Text(
                'AI SCANNING & VALIDATING BOL...',
                style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w900, color: AppColors.statusInfo, letterSpacing: 0.5),
              ),
            ],
          ),
        );

      // 6. BOL APPROVED / MARK AS LOADED
      case LoadWorkflowState.bolAccepted:
      case LoadWorkflowState.loaded:
        return Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.emeraldSoft,
                borderRadius: AppRadius.lgBorder,
                border: Border.all(color: AppColors.emeraldPrimary.withValues(alpha: 0.3)),
              ),
              child: const Row(
                children: [
                  Icon(Icons.check_circle_rounded, color: AppColors.emeraldDark, size: 18),
                  SizedBox(width: 8),
                  Text('BOL Approved ✓ Ready for Departure', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: AppColors.emeraldDark)),
                ],
              ),
            ),
            const SizedBox(height: 10),
            HaulBoxButton(
              text: 'MARK AS LOADED (START TRANSIT)',
              icon: Icons.local_shipping_rounded,
              onPressed: () {
                setState(() {
                  _workflowState = LoadWorkflowState.inTransit;
                  _milesRemaining = 118;
                });
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Status updated: IN TRANSIT TO DELIVERY.'), backgroundColor: AppColors.emeraldPrimary),
                );
              },
            ),
          ],
        );

      // 7. IN TRANSIT / GOING TOWARD DELIVERY
      case LoadWorkflowState.inTransit:
      case LoadWorkflowState.goingToDelivery:
        final progress = (118 - _milesRemaining) / 118;
        return Column(
          children: [
            _buildActiveProgressBar(
              title: 'IN TRANSIT TO DELIVERY',
              remainingText: '$_milesRemaining mi remaining',
              progress: progress.clamp(0.05, 1.0),
              color: AppColors.emeraldPrimary,
              onDevAdvance: () {
                setState(() {
                  _workflowState = LoadWorkflowState.arrivedDelivery;
                  _milesRemaining = 0;
                });
              },
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: AppRadius.mdBorder),
                      side: const BorderSide(color: AppColors.statusWarning, width: 1.2),
                    ),
                    icon: const Icon(Icons.access_time_rounded, size: 16, color: AppColors.statusWarning),
                    label: const Text('Delay Alert', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5, color: AppColors.statusWarning)),
                    onPressed: () => _showDelayDetectionAlert(load),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 2,
                  child: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF0284C7),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: AppRadius.mdBorder),
                      elevation: 0,
                    ),
                    icon: const Icon(Icons.pin_drop_rounded, size: 16),
                    label: const Text('ARRIVED AT DELIVERY?', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13)),
                    onPressed: () {
                      setState(() {
                        _workflowState = LoadWorkflowState.arrivedDelivery;
                        _milesRemaining = 0;
                      });
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Status updated: AT DELIVERY. Please upload POD.'), backgroundColor: Color(0xFF0284C7)),
                      );
                    },
                  ),
                ),
              ],
            ),
          ],
        );

      // 8. AT DELIVERY / POD REQUIRED
      case LoadWorkflowState.arrivedDelivery:
        return Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
              decoration: BoxDecoration(
                color: const Color(0xFFE0F2FE),
                borderRadius: AppRadius.lgBorder,
                border: Border.all(color: const Color(0xFF0284C7).withValues(alpha: 0.3)),
              ),
              child: const Row(
                children: [
                  Icon(Icons.assignment_turned_in_rounded, color: Color(0xFF0284C7), size: 20),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'AT DELIVERY — POD UPLOAD REQUIRED',
                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: Color(0xFF0369A1), letterSpacing: 0.4),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            HaulBoxButton(
              text: 'UPLOAD POD (REQUIRED)',
              icon: Icons.camera_alt_outlined,
              onPressed: () => _openPodUploadModal(load),
            ),
          ],
        );

      // 9. POD UPLOADED / VERIFYING
      case LoadWorkflowState.podUploaded:
      case LoadWorkflowState.podQualityChecking:
      case LoadWorkflowState.podVerifying:
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 16),
          decoration: BoxDecoration(
            color: AppColors.statusInfoSoft,
            borderRadius: AppRadius.lgBorder,
            border: Border.all(color: AppColors.statusInfo.withValues(alpha: 0.3)),
          ),
          child: const Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.statusInfo)),
              SizedBox(width: 10),
              Text(
                'AI SCANNING & VALIDATING POD...',
                style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w900, color: AppColors.statusInfo, letterSpacing: 0.5),
              ),
            ],
          ),
        );

      // 10. POD APPROVED -> COMPLETE DELIVERY
      case LoadWorkflowState.podAccepted:
        return Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.emeraldSoft,
                borderRadius: AppRadius.lgBorder,
                border: Border.all(color: AppColors.emeraldPrimary.withValues(alpha: 0.3)),
              ),
              child: const Row(
                children: [
                  Icon(Icons.verified_rounded, color: AppColors.emeraldDark, size: 18),
                  SizedBox(width: 8),
                  Text('POD Verified & Approved ✓', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: AppColors.emeraldDark)),
                ],
              ),
            ),
            const SizedBox(height: 10),
            HaulBoxButton(
              text: 'MARK DELIVERED',
              icon: Icons.check_circle_outline_rounded,
              onPressed: () => _showCompleteConfirmation(load),
            ),
          ],
        );

      // 11. DELIVERED (WAITING FOR PAYMENT)
      case LoadWorkflowState.delivered:
        return Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.emeraldSoft,
                borderRadius: AppRadius.lgBorder,
                border: Border.all(color: AppColors.emeraldPrimary),
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.task_alt_rounded, color: AppColors.emeraldDark, size: 22),
                  SizedBox(width: 8),
                  Text(
                    'DELIVERED (AWAITING PAYMENT)',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: AppColors.emeraldDark, letterSpacing: 0.5),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(double.infinity, 44),
                side: const BorderSide(color: AppColors.emeraldPrimary, width: 1.2),
                shape: RoundedRectangleBorder(borderRadius: AppRadius.mdBorder),
              ),
              icon: const Icon(Icons.paid_outlined, size: 18, color: AppColors.emeraldDark),
              label: const Text('Simulate Dispatch Payment Received', style: TextStyle(fontWeight: FontWeight.w800, color: AppColors.emeraldDark, fontSize: 13)),
              onPressed: () {
                setState(() {
                  _workflowState = LoadWorkflowState.paid;
                });
                _showPaymentReceivedModal(load);
              },
            ),
          ],
        );

      // 12. PAYMENT RECEIVED
      case LoadWorkflowState.paid:
        return Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.emeraldSoft,
                borderRadius: AppRadius.lgBorder,
                border: Border.all(color: AppColors.emeraldPrimary),
              ),
              child: Column(
                children: [
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.paid_rounded, color: AppColors.emeraldDark, size: 22),
                      SizedBox(width: 8),
                      Text('PAYMENT RECEIVED ✓', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: AppColors.emeraldDark, letterSpacing: 0.5)),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text('Amount: \$${load.driverPay != null ? load.driverPay!.toInt() : 1250}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppColors.emeraldDark)),
                ],
              ),
            ),
            const SizedBox(height: 10),
            HaulBoxButton(
              text: 'CONFIRM RECEIVED',
              icon: Icons.check_rounded,
              onPressed: () {
                setState(() {
                  _workflowState = LoadWorkflowState.paymentConfirmed;
                });
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Payment Confirmed! Load settled successfully.'), backgroundColor: AppColors.emeraldPrimary),
                );
              },
            ),
          ],
        );

      // 13. PAYMENT CONFIRMED / SETTLED
      case LoadWorkflowState.paymentConfirmed:
      case LoadWorkflowState.completed:
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 16),
          decoration: BoxDecoration(
            color: AppColors.emeraldSoft,
            borderRadius: AppRadius.lgBorder,
            border: Border.all(color: AppColors.emeraldPrimary),
          ),
          child: const Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.verified_rounded, color: AppColors.emeraldDark, size: 22),
              SizedBox(width: 8),
              Text(
                'LOAD SETTLED & CONFIRMED',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: AppColors.emeraldDark, letterSpacing: 0.5),
              ),
            ],
          ),
        );

      default:
        return const SizedBox.shrink();
    }
  }

  Widget _buildActiveProgressBar({
    required String title,
    required String remainingText,
    required double progress,
    required Color color,
    required VoidCallback onDevAdvance,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadius.lgBorder,
        border: Border.all(color: AppColors.borderLight),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 0.8,
                  color: AppColors.textDark,
                ),
              ),
              InkWell(
                onTap: onDevAdvance,
                child: Text(
                  remainingText,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: AppColors.emeraldDark,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 12,
              backgroundColor: AppColors.bgSecondary,
              valueColor: AlwaysStoppedAnimation<Color>(color),
            ),
          ),
        ],
      ),
    );
  }

  // 4. CELEBRATION OVERLAY
  Widget _buildCelebrationOverlay() {
    return Container(
      color: Colors.black.withValues(alpha: 0.6),
      child: Center(
        child: ScaleTransition(
          scale: _scaleAnimation,
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 32),
            padding: const EdgeInsets.all(28),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: AppRadius.xlBorder,
              border: Border.all(color: AppColors.emeraldPrimary, width: 2),
              boxShadow: [
                BoxShadow(
                  color: AppColors.emeraldPrimary.withValues(alpha: 0.3),
                  blurRadius: 30,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: const Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.check_circle_rounded, size: 72, color: AppColors.emeraldPrimary),
                SizedBox(height: 16),
                Text(
                  'LOAD COMPLETE',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: AppColors.textDark, letterSpacing: 0.5),
                ),
                SizedBox(height: 6),
                Text(
                  'Nice work! The run has been saved to your Completed History.',
                  style: TextStyle(color: AppColors.textMuted, fontSize: 13),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // 5. CURRENT LOAD DOCUMENTS SECTION (With Lifecycle Document Locking & Permissions)
  Widget _buildCurrentLoadDocumentsSection(LoadModel load) {
    final bool isTripStarted = _workflowState.index >= LoadWorkflowState.goingToPickup.index;
    final bool isBolDone = _workflowState.index >= LoadWorkflowState.goingToDelivery.index;
    final bool isPodDone = _workflowState == LoadWorkflowState.podAccepted || _workflowState == LoadWorkflowState.completed;
    final bool isCompleted = _workflowState == LoadWorkflowState.completed;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Row(
          children: [
            Icon(Icons.folder_outlined, size: 16, color: AppColors.emeraldDark),
            SizedBox(width: 8),
            Text(
              'DOCUMENTS & COMPLIANCE',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                color: AppColors.textDark,
                letterSpacing: 0.6,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),

        // RC (Rate Confirmation) — Locked once trip starts
        _buildDocumentRow(
          title: 'RC (Rate Confirmation)',
          statusText: isTripStarted ? '✓ Uploaded (v1)' : '✓ Active (v1)',
          statusColor: AppColors.emeraldDark,
          isLocked: isTripStarted,
          icon: Icons.description_outlined,
          onView: () => _showDocumentDetail(
            title: 'Rate Confirmation (RC)',
            docNumber: 'RC-HB1042-TQL',
            status: isTripStarted ? '✓ VERIFIED • 🔒 LOCKED' : '✓ VERIFIED',
            details: 'Rate Confirmation verified for Load #${load.loadNumber}. Total Rate: \$1,850.\n\nVersion 1 uploaded by Dispatcher.\n${isTripStarted ? "🔒 Locked: Cannot be modified while trip is in progress." : "Editable before trip starts."}',
          ),
          onReplace: !isTripStarted
              ? () => _openReplaceDocumentModal(load, 'RC (Rate Confirmation)', 'RC')
              : null,
        ),

        // BOL (Bill of Lading) — Locked after load completion
        _buildDocumentRow(
          title: 'BOL (Bill of Lading)',
          statusText: isBolDone ? '✓ Approved (v1)' : 'Pending Upload',
          statusColor: isBolDone ? AppColors.emeraldPrimary : AppColors.textMuted,
          isLocked: isCompleted,
          icon: Icons.assignment_outlined,
          onView: isBolDone
              ? () => _showDocumentDetail(
                    title: 'Bill of Lading (BOL)',
                    docNumber: 'BOL-98421-DFW',
                    status: isCompleted ? '✓ APPROVED • 🔒 LOCKED' : '✓ APPROVED',
                    details: 'AI Verification: Passed\n• Shipper Signature: Verified\n• Weight: 42,500 lbs (Matches RC)\n• Pickup: Dallas, TX (Verified)\n\nVersion 1 uploaded by Driver.',
                  )
              : null,
          onReplace: isBolDone && !isCompleted
              ? () => _openReplaceDocumentModal(load, 'Bill of Lading (BOL)', 'BOL')
              : (isBolDone ? null : () => _openBolUploadModal(load)),
        ),

        // BOL Supporting Pictures
        _buildDocumentRow(
          title: 'BOL Pictures',
          statusText: isBolDone ? '3 Photos Attached' : 'Pending',
          statusColor: isBolDone ? const Color(0xFF0284C7) : AppColors.textMuted,
          isLocked: isCompleted,
          icon: Icons.photo_library_outlined,
          onView: isBolDone
              ? () => _showDocumentDetail(
                    title: 'BOL Supporting Pictures',
                    docNumber: '3 Photos Attached',
                    status: isCompleted ? 'ATTACHED • 🔒 LOCKED' : 'ATTACHED',
                    details: '• cargo_photo_1.jpg\n• seal_number_2.jpg\n• freight_labels_3.jpg',
                  )
              : null,
          onReplace: isBolDone && !isCompleted
              ? () => _openMultiPicturePicker(load, isBol: true)
              : null,
        ),

        // POD (Proof of Delivery) — Locked after load completion
        _buildDocumentRow(
          title: 'POD (Proof of Delivery)',
          statusText: isPodDone ? '✓ Approved (v1)' : 'Pending Delivery',
          statusColor: isPodDone ? AppColors.emeraldPrimary : AppColors.textMuted,
          isLocked: isCompleted,
          icon: Icons.assignment_turned_in_outlined,
          onView: isPodDone
              ? () => _showDocumentDetail(
                    title: 'Proof of Delivery (POD)',
                    docNumber: 'POD-1042-DEL',
                    status: isCompleted ? '✓ APPROVED • 🔒 LOCKED' : '✓ APPROVED',
                    details: 'AI Verification: Passed\n• Receiver Signature: Verified (Robert M. Jackson)\n• Delivery Address: 700 Warehouse St, Houston, TX\n• Delivered: Aug 14, 2026',
                  )
              : null,
          onReplace: isPodDone && !isCompleted
              ? () => _openReplaceDocumentModal(load, 'Proof of Delivery (POD)', 'POD')
              : (isPodDone ? null : () => _openPodUploadModal(load)),
        ),

        // POD Supporting Pictures
        _buildDocumentRow(
          title: 'POD Pictures',
          statusText: isPodDone ? '4 Photos Attached' : 'Pending',
          statusColor: isPodDone ? const Color(0xFF0284C7) : AppColors.textMuted,
          isLocked: isCompleted,
          icon: Icons.photo_library_outlined,
          onView: isPodDone
              ? () => _showDocumentDetail(
                    title: 'POD Supporting Pictures',
                    docNumber: '4 Photos Attached',
                    status: isCompleted ? 'ATTACHED • 🔒 LOCKED' : 'ATTACHED',
                    details: '• dock_delivery_1.jpg\n• signed_manifest_2.jpg\n• pallet_count_3.jpg\n• receiver_stamp_4.jpg',
                  )
              : null,
          onReplace: isPodDone && !isCompleted
              ? () => _openMultiPicturePicker(load, isBol: false)
              : null,
        ),
      ],
    );
  }

  Widget _buildDocumentRow({
    required String title,
    required String statusText,
    required Color statusColor,
    required IconData icon,
    required bool isLocked,
    VoidCallback? onView,
    VoidCallback? onReplace,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.bgSecondary.withValues(alpha: 0.5),
        borderRadius: AppRadius.mdBorder,
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: statusColor),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.textDark),
                ),
              ),
              if (isLocked)
                Container(
                  margin: const EdgeInsets.only(right: 6),
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: const Color(0xFFCBD5E1)),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.lock_rounded, size: 11, color: Color(0xFF64748B)),
                      SizedBox(width: 4),
                      Text('Locked', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: Color(0xFF64748B))),
                    ],
                  ),
                ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  statusText,
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: statusColor),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              if (onView != null)
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    minimumSize: const Size(60, 28),
                    side: const BorderSide(color: AppColors.emeraldPrimary, width: 1),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  icon: const Icon(Icons.visibility_outlined, size: 13, color: AppColors.emeraldDark),
                  label: const Text('View', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: AppColors.emeraldDark)),
                  onPressed: onView,
                ),
              if (onReplace != null) ...[
                const SizedBox(width: 8),
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.emeraldPrimary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    minimumSize: const Size(70, 28),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  icon: const Icon(Icons.sync_rounded, size: 13),
                  label: const Text('Replace', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800)),
                  onPressed: onReplace,
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  void _openReplaceDocumentModal(LoadModel load, String title, String docType) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(width: 40, height: 4, decoration: BoxDecoration(color: AppColors.borderLight, borderRadius: BorderRadius.circular(2))),
              const SizedBox(height: 16),
              Text('Replace $title', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: AppColors.textDark)),
              const SizedBox(height: 6),
              const Text(
                'Uploading a replacement will preserve the previous file in audit history.',
                style: TextStyle(fontSize: 12.5, color: AppColors.textMuted),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: AppColors.emeraldSoft, borderRadius: BorderRadius.circular(12)),
                  child: const Icon(Icons.camera_alt_outlined, color: AppColors.emeraldPrimary),
                ),
                title: const Text('Take New Photo', style: TextStyle(fontWeight: FontWeight.w700)),
                onTap: () {
                  Navigator.pop(ctx);
                  if (docType == 'BOL') {
                    _openBolUploadModal(load);
                  } else if (docType == 'POD') {
                    _openPodUploadModal(load);
                  } else {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Rate Confirmation replacement uploaded. Version 2 created.'), backgroundColor: AppColors.emeraldPrimary),
                    );
                  }
                },
              ),
              const Divider(color: AppColors.borderLight, height: 1),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: AppColors.bgSecondary, borderRadius: BorderRadius.circular(12)),
                  child: const Icon(Icons.photo_library_outlined, color: AppColors.textPrimary),
                ),
                title: const Text('Choose File / PDF', style: TextStyle(fontWeight: FontWeight.w700)),
                onTap: () {
                  Navigator.pop(ctx);
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('$title replacement uploaded. Version 2 saved.'), backgroundColor: AppColors.emeraldPrimary),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showDocumentDetail({
    required String title,
    required String docNumber,
    required String status,
    required String details,
  }) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.xlBorder),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: const BoxDecoration(color: AppColors.emeraldSoft, shape: BoxShape.circle),
              child: const Icon(Icons.description_outlined, color: AppColors.emeraldDark, size: 20),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                title,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.textDark),
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.bgSecondary,
                borderRadius: AppRadius.mdBorder,
                border: Border.all(color: AppColors.borderLight),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('REFERENCE: $docNumber', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.textSubtle)),
                  const SizedBox(height: 4),
                  Text('STATUS: $status', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: AppColors.emeraldDark)),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Text(details, style: const TextStyle(fontSize: 13, color: AppColors.textDark, height: 1.45)),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Close', style: TextStyle(color: AppColors.textMuted, fontWeight: FontWeight.w700)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.emeraldPrimary,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            onPressed: () {
              Navigator.pop(ctx);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('$title opened from secure storage.'),
                  backgroundColor: AppColors.emeraldPrimary,
                ),
              );
            },
            child: const Text('Open File', style: TextStyle(fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );
  }
}
