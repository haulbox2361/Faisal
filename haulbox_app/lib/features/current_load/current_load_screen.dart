import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../core/services/document_verification_service.dart';
import '../../core/services/location_permission_service.dart';
import '../../core/services/location_service.dart';
import '../../shared/models/load_model.dart';
import '../../shared/models/load_state.dart';
import '../auth/auth_provider.dart';
import 'widgets/active_trip_hero_card.dart';
import 'widgets/load_specs_card.dart';
import 'widgets/route_navigation_card.dart';
import 'widgets/trip_doc_status_strip.dart';

class CurrentLoadScreen extends StatefulWidget {
  final Function(int)? onNavigateTab;

  const CurrentLoadScreen({super.key, this.onNavigateTab});

  @override
  State<CurrentLoadScreen> createState() => _CurrentLoadScreenState();
}

class _CurrentLoadScreenState extends State<CurrentLoadScreen> {
  // Load State Machine
  LoadWorkflowState _workflowState = LoadWorkflowState.startTrip;

  // Trip Progress & Tracking
  int _milesRemaining = 245;
  String _currentEtaText = '04:30 PM';
  String _riskBadge = '🟢 On Time';
  StreamSubscription<DriverLocationUpdate>? _locationSub;

  // Verification & Processing States
  bool _isProcessing = false;
  String? _statusMessage;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        LocationPermissionService.checkInitialLocationPermission(context);
        final load = Provider.of<AuthProvider>(context, listen: false).currentLoad;
        if (load != null) {
          if (load.status.toUpperCase() == 'ASSIGNED') {
            _workflowState = LoadWorkflowState.assigned;
          } else if (load.status.toUpperCase() == 'IN_TRANSIT') {
            _workflowState = LoadWorkflowState.inTransit;
          } else if (load.status.toUpperCase() == 'COMPLETED') {
            _workflowState = LoadWorkflowState.completed;
          }
        }
      }
    });
  }

  @override
  void dispose() {
    _locationSub?.cancel();
    super.dispose();
  }

  // PRIMARY WORKFLOW DISPATCHER ACTION
  Future<void> _handlePrimaryWorkflowAction(LoadModel load) async {
    switch (_workflowState) {
      case LoadWorkflowState.assigned:
        setState(() {
          _workflowState = LoadWorkflowState.startTrip;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Load Accepted! Ready to begin trip.'),
            backgroundColor: AppColors.emeraldPrimary,
          ),
        );
        break;

      case LoadWorkflowState.accepted:
      case LoadWorkflowState.startTrip:
        await _startTripNavigation(load);
        break;

      case LoadWorkflowState.goingToPickup:
        setState(() {
          _workflowState = LoadWorkflowState.arrivedPickup;
          _milesRemaining = 0;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Arrived at Shipper Pickup Dock. Please obtain BOL.'),
            backgroundColor: AppColors.emeraldPrimary,
          ),
        );
        break;

      case LoadWorkflowState.arrivedPickup:
      case LoadWorkflowState.bolRequired:
      case LoadWorkflowState.bolRejected:
      case LoadWorkflowState.bolQualityFailed:
        _openDocumentUploadSheet(load, isBol: true);
        break;

      case LoadWorkflowState.bolUploaded:
      case LoadWorkflowState.bolQualityChecking:
      case LoadWorkflowState.bolVerifying:
        break;

      case LoadWorkflowState.bolAccepted:
      case LoadWorkflowState.loaded:
        setState(() {
          _workflowState = LoadWorkflowState.inTransit;
          _milesRemaining = load.miles != null ? (load.miles! * 0.85).round() : 190;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Transit started to delivery destination!'),
            backgroundColor: AppColors.emeraldPrimary,
          ),
        );
        break;

      case LoadWorkflowState.inTransit:
      case LoadWorkflowState.goingToDelivery:
        setState(() {
          _workflowState = LoadWorkflowState.arrivedDelivery;
          _milesRemaining = 0;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Arrived at Receiver Dock. Please obtain signed POD.'),
            backgroundColor: AppColors.emeraldPrimary,
          ),
        );
        break;

      case LoadWorkflowState.arrivedDelivery:
      case LoadWorkflowState.podRequired:
      case LoadWorkflowState.podRejected:
      case LoadWorkflowState.podQualityFailed:
        _openDocumentUploadSheet(load, isBol: false);
        break;

      case LoadWorkflowState.podUploaded:
      case LoadWorkflowState.podQualityChecking:
      case LoadWorkflowState.podVerifying:
        break;

      case LoadWorkflowState.podAccepted:
      case LoadWorkflowState.delivered:
        _showSettlementConfirmationModal(load);
        break;

      case LoadWorkflowState.paid:
      case LoadWorkflowState.paymentConfirmed:
      case LoadWorkflowState.completed:
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('This load is complete and settled.'),
            backgroundColor: AppColors.emeraldPrimary,
          ),
        );
        break;
    }
  }

  // 1. START TRIP TRACKING
  Future<void> _startTripNavigation(LoadModel load) async {
    final granted = await LocationService().requestLocationPermission();
    if (!granted) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Location permission required for GPS navigation tracking.'),
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
      _riskBadge = '🟢 On Time';
    });

    if (!mounted) return;
    final token = Provider.of<AuthProvider>(context, listen: false).token ?? '';
    LocationService().startTripTracking(loadId: load.id, token: token);

    _locationSub?.cancel();
    _locationSub = LocationService().locationStream.listen((update) {
      if (mounted) {
        setState(() {
          _milesRemaining = update.milesRemaining;
          _currentEtaText = update.etaText;
          _riskBadge = update.riskBadge;
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

  // 2. CONSOLIDATED DOCUMENT UPLOAD SHEET (BOL & POD)
  void _openDocumentUploadSheet(LoadModel load, {required bool isBol}) {
    final docTypeTitle = isBol ? 'Bill of Lading (BOL)' : 'Proof of Delivery (POD)';

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
                'Upload $docTypeTitle',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppColors.textDark),
              ),
              const SizedBox(height: 6),
              Text(
                isBol
                    ? 'Take a clear, well-lit photo of the signed Shipper BOL.'
                    : 'Ensure consignee signature and delivery timestamp are legible.',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12.5, color: AppColors.textMuted),
              ),
              const SizedBox(height: 20),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.emeraldSoft,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.camera_alt_rounded, color: AppColors.emeraldDark),
                ),
                title: Text('Take $docTypeTitle Photo', style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark)),
                subtitle: const Text('Primary Recommended Camera Action', style: TextStyle(color: AppColors.emeraldPrimary, fontSize: 11.5, fontWeight: FontWeight.w600)),
                onTap: () {
                  Navigator.pop(ctx);
                  _runDocumentAiVerification(load, isBol: isBol);
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
                title: Text('Choose $docTypeTitle from Gallery / PDF', style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark)),
                onTap: () {
                  Navigator.pop(ctx);
                  _runDocumentAiVerification(load, isBol: isBol);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  // 3. AI DOCUMENT VERIFICATION
  Future<void> _runDocumentAiVerification(LoadModel load, {required bool isBol}) async {
    final docType = isBol ? 'BOL' : 'POD';

    setState(() {
      _isProcessing = true;
      _statusMessage = 'AI is checking $docType image clarity and signatures...';
    });

    final quality = await DocumentVerificationService.checkPhotoQuality();
    if (!quality.isPass) {
      setState(() {
        _isProcessing = false;
        _statusMessage = null;
      });
      if (mounted) {
        showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: Colors.white,
            shape: RoundedRectangleBorder(borderRadius: AppRadius.lgBorder),
            title: Text('Retake $docType Required', style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.statusDanger)),
            content: Text(quality.issueDescription ?? 'Image quality is too blurry. Please retake with flat lighting.'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('CANCEL', style: TextStyle(color: AppColors.textMuted, fontWeight: FontWeight.w700)),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: AppColors.emeraldPrimary),
                onPressed: () {
                  Navigator.pop(ctx);
                  _openDocumentUploadSheet(load, isBol: isBol);
                },
                child: const Text('RETAKE PHOTO', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
              ),
            ],
          ),
        );
      }
      return;
    }

    final result = isBol
        ? await DocumentVerificationService.verifyBol(load: load)
        : await DocumentVerificationService.verifyPod(load: load);

    setState(() {
      _isProcessing = false;
      _statusMessage = null;
      if (isBol) {
        _workflowState = result.isAccepted ? LoadWorkflowState.bolAccepted : LoadWorkflowState.bolRejected;
      } else {
        _workflowState = result.isAccepted ? LoadWorkflowState.podAccepted : LoadWorkflowState.podRejected;
      }
    });

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(result.isAccepted ? '✓ $docType Approved & Verified!' : '⚠️ $docType Sent for Dispatcher Review'),
          backgroundColor: result.isAccepted ? AppColors.emeraldPrimary : AppColors.statusWarning,
        ),
      );
    }
  }

  // 4. SETTLEMENT CONFIRMATION MODAL
  void _showSettlementConfirmationModal(LoadModel load) {
    final payAmount = load.driverPay != null ? '\$${load.driverPay!.toInt()}' : '\$1,850';

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(color: AppColors.borderLight, borderRadius: BorderRadius.circular(2)),
              ),
              const SizedBox(height: 18),
              const Icon(Icons.check_circle_outline_rounded, color: AppColors.emeraldPrimary, size: 48),
              const SizedBox(height: 10),
              const Text('Confirm Settlement & Complete', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppColors.textDark)),
              const SizedBox(height: 6),
              Text(
                'Load #${load.loadNumber} delivered successfully.\nSettlement payout amount: $payAmount',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 13, color: AppColors.textMuted),
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
                      _workflowState = LoadWorkflowState.completed;
                    });
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Load marked as completed and queued for settlement!'),
                        backgroundColor: AppColors.emeraldPrimary,
                      ),
                    );
                  },
                  child: const Text('CONFIRM & CLOSE LOAD', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // 5. ADD DOCK NOTE DIALOG
  void _openAddNoteDialog(LoadModel load, AuthProvider auth) {
    final controller = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.lgBorder),
        title: const Text('Add Dock Note', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: AppColors.textDark)),
        content: TextField(
          controller: controller,
          maxLines: 3,
          decoration: const InputDecoration(
            hintText: 'Enter dock instructions, gate code, delay updates...',
            hintStyle: TextStyle(fontSize: 13, color: AppColors.textSubtle),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('CANCEL', style: TextStyle(color: AppColors.textMuted, fontWeight: FontWeight.w700)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.emeraldPrimary),
            onPressed: () {
              if (controller.text.trim().isNotEmpty) {
                auth.addNoteToLoad(load.id, controller.text.trim());
              }
              Navigator.pop(ctx);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Note added to load!'), backgroundColor: AppColors.emeraldPrimary),
              );
            },
            child: const Text('SAVE NOTE', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final load = auth.currentLoad;

    if (load == null) {
      return Scaffold(
        backgroundColor: AppColors.bgLight,
        appBar: AppBar(
          title: const Text(
            'Current Load',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: -0.4),
          ),
        ),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.local_shipping_outlined, size: 64, color: AppColors.textSubtle.withValues(alpha: 0.5)),
              const SizedBox(height: 16),
              const Text('No Active Load Assigned', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.textDark)),
              const SizedBox(height: 6),
              const Text('Contact your dispatcher for new dispatch assignments.', style: TextStyle(fontSize: 13, color: AppColors.textMuted)),
              const SizedBox(height: 20),
              OutlinedButton.icon(
                onPressed: () => auth.syncAllData(),
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Refresh Dispatch'),
              ),
            ],
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        title: Text(
          'Load #${load.loadNumber}',
          style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: -0.4),
        ),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 14),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              _workflowState.displayTitle,
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: Colors.white),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => auth.syncAllData(),
        color: AppColors.emeraldPrimary,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
          children: [
            // 1. HERO ACTION & ETA CARD (Glanceable Primary Card)
            ActiveTripHeroCard(
              load: load,
              workflowState: _workflowState,
              milesRemaining: _milesRemaining,
              etaText: _currentEtaText,
              riskBadge: _riskBadge,
              isProcessing: _isProcessing,
              statusMessage: _statusMessage,
              onPrimaryAction: () => _handlePrimaryWorkflowAction(load),
            ),
            const SizedBox(height: 14),

            // 2. ROUTE & NAVIGATION CARD (Origin to Destination)
            RouteNavigationCard(load: load),
            const SizedBox(height: 14),

            // 3. LOAD SPECS & CONTACTS CARD (Commodity, Weight, Pay & Calling)
            LoadSpecsCard(
              load: load,
              onAddNote: () => _openAddNoteDialog(load, auth),
              onMessageDispatcher: widget.onNavigateTab != null ? () => widget.onNavigateTab!(2) : null,
            ),
            const SizedBox(height: 14),

            // 4. TRIP DOCUMENT STRIP (Rate Con, BOL, POD)
            TripDocStatusStrip(
              load: load,
              onUploadBol: () => _openDocumentUploadSheet(load, isBol: true),
              onUploadPod: () => _openDocumentUploadSheet(load, isBol: false),
            ),
          ],
        ),
      ),
    );
  }
}
