import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../core/network/api_client.dart';
import '../../core/services/document_verification_service.dart';
import '../../core/services/location_permission_service.dart';
import '../../core/services/location_service.dart';
import '../../shared/models/load_model.dart';
import '../../shared/models/load_state.dart';
import '../auth/auth_provider.dart';
import '../photo_upload/document_camera_screen.dart';
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
  Timer? _pendingReviewTimer;

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
          setState(() {
            _workflowState = _deriveWorkflowState(load);
          });
        }
      }
    });
  }

  @override
  void dispose() {
    _locationSub?.cancel();
    _pendingReviewTimer?.cancel();
    super.dispose();
  }

  LoadWorkflowState _deriveWorkflowState(LoadModel? load) {
    if (load == null) return LoadWorkflowState.startTrip;
    final status = load.status.toUpperCase();
    final driverProg = load.driverProgress.toUpperCase();
    final bolStatus = (load.bolStatus ?? '').toUpperCase();
    final podStatus = (load.podStatus ?? '').toUpperCase();
    final docs = load.documents ?? {};
    final bolDocStatus = (docs['BOL'] is Map ? docs['BOL']['status']?.toString() : '')?.toUpperCase() ?? '';
    final podDocStatus = (docs['POD'] is Map ? docs['POD']['status']?.toString() : '')?.toUpperCase() ?? '';

    // If fully delivered or drop-off
    if (status == 'DROP-OFF' ||
        status == 'DELIVERED' ||
        driverProg == 'DELIVERED' ||
        podStatus == 'APPROVED' ||
        podStatus == 'VERIFIED' ||
        podDocStatus == 'APPROVED') {
      return LoadWorkflowState.delivered;
    }

    // If POD rejected
    if (podStatus == 'REJECTED' || podDocStatus == 'REJECTED') {
      return LoadWorkflowState.podRejected;
    }

    // If POD uploaded / pending review
    if (podStatus == 'PENDING' ||
        podStatus == 'PENDING_REVIEW' ||
        podDocStatus.contains('PENDING') ||
        docs['POD'] != null) {
      if (status == 'AT DELIVERY' || driverProg == 'AT_DELIVERY' || status == 'IN TRANSIT' || driverProg == 'IN_TRANSIT') {
        return LoadWorkflowState.podUploaded;
      }
    }

    // If in transit / at delivery
    if (status == 'IN TRANSIT' || driverProg == 'IN_TRANSIT') {
      return LoadWorkflowState.inTransit;
    }

    if (status == 'AT DELIVERY' || driverProg == 'AT_DELIVERY') {
      return LoadWorkflowState.arrivedDelivery;
    }

    // If loaded / BOL approved
    if (status == 'LOADED' ||
        driverProg == 'LOADED' ||
        bolStatus == 'APPROVED' ||
        bolStatus == 'VERIFIED' ||
        bolDocStatus == 'APPROVED') {
      return LoadWorkflowState.loaded;
    }

    // If BOL rejected
    if (bolStatus == 'REJECTED' || bolDocStatus == 'REJECTED') {
      return LoadWorkflowState.bolRejected;
    }

    // If BOL uploaded / pending review
    if (bolStatus == 'PENDING' ||
        bolStatus == 'PENDING_REVIEW' ||
        bolDocStatus.contains('PENDING') ||
        docs['BOL'] != null) {
      return LoadWorkflowState.bolUploaded;
    }

    // Pre-pickup states
    if (status == 'AT PICKUP' || driverProg == 'AT_PICKUP') {
      return LoadWorkflowState.arrivedPickup;
    }
    if (status == 'ASSIGNED' || driverProg == 'ASSIGNED') {
      return LoadWorkflowState.assigned;
    }
    if (status == 'ACCEPTED' || driverProg == 'ACCEPTED') {
      return LoadWorkflowState.startTrip;
    }

    return _workflowState;
  }

  void _startPendingReviewTimerIfNeeded(AuthProvider auth) {
    if (_workflowState == LoadWorkflowState.bolUploaded ||
        _workflowState == LoadWorkflowState.podUploaded) {
      if (_pendingReviewTimer == null || !_pendingReviewTimer!.isActive) {
        _pendingReviewTimer = Timer.periodic(const Duration(seconds: 4), (_) {
          if (mounted &&
              (_workflowState == LoadWorkflowState.bolUploaded ||
                  _workflowState == LoadWorkflowState.podUploaded)) {
            auth.syncAllData(silent: true);
          } else {
            _pendingReviewTimer?.cancel();
          }
        });
      }
    } else {
      _pendingReviewTimer?.cancel();
    }
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
        final authPickup = Provider.of<AuthProvider>(context, listen: false);
        if (authPickup.token != null) {
          ApiClient.updateLoadProgress(authPickup.token!, load.id, 'AT_PICKUP');
        }
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
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('BOL is awaiting Dispatcher approval. You will receive an instant notification once approved.'),
            backgroundColor: Color(0xFFD97706),
          ),
        );
        break;

      case LoadWorkflowState.bolAccepted:
      case LoadWorkflowState.loaded:
        final authTransit = Provider.of<AuthProvider>(context, listen: false);
        if (authTransit.token != null) {
          ApiClient.updateLoadProgress(authTransit.token!, load.id, 'IN_TRANSIT');
        }
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
        final authDelivery = Provider.of<AuthProvider>(context, listen: false);
        if (authDelivery.token != null) {
          ApiClient.updateLoadProgress(authDelivery.token!, load.id, 'AT_DELIVERY');
        }
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
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('POD is awaiting Dispatcher approval. You will receive an instant notification once approved.'),
            backgroundColor: Color(0xFFD97706),
          ),
        );
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

  // 2. DOCUMENT UPLOAD ACTIONS (Camera vs Gallery Pickers)
  void _openDocumentUploadSheet(LoadModel load, {required bool isBol, int stopNumber = 1}) {
    final stopLabel = load.isMultiStop ? ' (Stop $stopNumber)' : '';
    final docTypeTitle = isBol ? 'Bill of Lading (BOL)$stopLabel' : 'Proof of Delivery (POD)$stopLabel';

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(width: 40, height: 4, decoration: BoxDecoration(color: AppColors.borderLight, borderRadius: BorderRadius.circular(2))),
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
                  _runDocumentAiVerification(load, isBol: isBol, stopNumber: stopNumber);
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
                  _runDocumentAiVerification(load, isBol: isBol, stopNumber: stopNumber);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  // 3. AI DOCUMENT VERIFICATION (BOL & POD)
  Future<void> _runDocumentAiVerification(LoadModel load, {required bool isBol, int stopNumber = 1}) async {
    final docType = isBol ? 'BOL' : 'POD';
    final stopLabel = load.isMultiStop ? ' (Stop $stopNumber)' : '';

    // 1. Launch Camera Capture with Real-Time Quality Check
    final file = await DocumentCameraScreen.capture(
      context,
      slotLabel: isBol ? 'Bill of Lading (BOL)$stopLabel' : 'Proof of Delivery (POD)$stopLabel',
      loadNumber: load.loadNumber,
    );

    if (file == null || !mounted) return;

    setState(() {
      _isProcessing = true;
      _statusMessage = 'Uploading $docType$stopLabel to Dispatch...';
    });

    try {
      final bytes = await file.readAsBytes();
      final base64Image = base64Encode(bytes);
      final auth = Provider.of<AuthProvider>(context, listen: false);
      final token = auth.token;

      final result = isBol
          ? await DocumentVerificationService.verifyBol(load: load, base64Image: base64Image, authToken: token, stopNumber: stopNumber)
          : await DocumentVerificationService.verifyPod(load: load, base64Image: base64Image, authToken: token, stopNumber: stopNumber);

      if (!mounted) return;

      setState(() {
        _isProcessing = false;
        _statusMessage = null;
      });

      if (result.isApproved) {
        // Outcome: APPROVED -> Sync data & advance
        await auth.syncAllData();

        setState(() {
          if (isBol) {
            final allDone = load.pickupStops.isNotEmpty
                ? load.pickupStops.every((s) => s.stopNumber == stopNumber || s.status == 'BOL_APPROVED')
                : true;
            if (allDone) _workflowState = LoadWorkflowState.loaded;
          } else {
            final allDone = load.deliveryStops.isNotEmpty
                ? load.deliveryStops.every((s) => s.stopNumber == stopNumber || s.status == 'POD_APPROVED')
                : true;
            if (allDone) _workflowState = LoadWorkflowState.delivered;
          }
        });

        if (mounted) {
          showDialog(
            context: context,
            builder: (ctx) => AlertDialog(
              backgroundColor: const Color(0xFF0F172A),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
              title: Row(
                children: [
                  const Icon(Icons.check_circle_rounded, color: AppColors.emeraldPrimary, size: 28),
                  const SizedBox(width: 10),
                  Text('✓ $docType$stopLabel Approved', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 17)),
                ],
              ),
              content: Text(
                'Document verified for Stop $stopNumber successfully.',
                style: const TextStyle(color: Colors.white70, fontSize: 14),
              ),
              actions: [
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.emeraldPrimary,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('CONTINUE', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                ),
              ],
            ),
          );
        }
      } else {
        // Outcome: PENDING_REVIEW -> Show confirmation modal, sent to Dispatcher review
        await auth.syncAllData();
        setState(() {
          if (isBol) {
            _workflowState = LoadWorkflowState.bolUploaded;
          } else {
            _workflowState = LoadWorkflowState.podUploaded;
          }
        });
        if (mounted) {
          showDialog(
            context: context,
            builder: (ctx) => AlertDialog(
              backgroundColor: const Color(0xFF0F172A),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
              title: Row(
                children: [
                  const Icon(Icons.check_circle_rounded, color: Color(0xFF38BDF8), size: 28),
                  const SizedBox(width: 10),
                  Text('✓ $docType$stopLabel Uploaded', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 17)),
                ],
              ),
              content: Text(
                'Your $docType has been received and sent to Dispatch for review. You may continue working; you will be notified once approved.',
                style: const TextStyle(color: Colors.white70, fontSize: 14),
              ),
              actions: [
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0284C7),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('GOT IT', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                ),
              ],
            ),
          );
        }
      }
    } catch (e) {
      setState(() {
        _isProcessing = false;
        _statusMessage = null;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Verification error: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  // 4. SETTLEMENT CONFIRMATION MODAL
  void _showSettlementConfirmationModal(LoadModel load) {
    final payAmount = load.displayRcPrice;

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

    if (load != null && !_isProcessing) {
      final derived = _deriveWorkflowState(load);
      if (derived != _workflowState) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && !_isProcessing) {
            setState(() {
              _workflowState = derived;
            });
          }
        });
      }
      _startPendingReviewTimerIfNeeded(auth);
    }

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
              onUploadStopBol: (sNum) => _openDocumentUploadSheet(load, isBol: true, stopNumber: sNum),
              onUploadStopPod: (sNum) => _openDocumentUploadSheet(load, isBol: false, stopNumber: sNum),
            ),
          ],
        ),
      ),
    );
  }
}
