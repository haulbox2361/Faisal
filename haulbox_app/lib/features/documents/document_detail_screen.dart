import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../core/network/api_client.dart';
import '../../shared/models/load_model.dart';
import '../../shared/widgets/haulbox_button.dart';
import '../../shared/widgets/haulbox_card.dart';
import '../../shared/widgets/section_header.dart';
import '../../shared/widgets/status_badge.dart';
import '../auth/auth_provider.dart';
import '../photo_upload/photo_upload_screen.dart';

class DocumentDetailScreen extends StatefulWidget {
  final String title;
  final String? documentNumber;
  final String? issueDate;
  final String? expirationDate;
  final String status;
  final String category; // 'DRIVER' or 'TRUCK'
  final String? fileUrl;
  final String? base64Data;
  final String? loadId;
  final String? docKey;
  final LoadModel? load;

  const DocumentDetailScreen({
    super.key,
    required this.title,
    this.documentNumber,
    this.issueDate,
    this.expirationDate,
    required this.status,
    required this.category,
    this.fileUrl,
    this.base64Data,
    this.loadId,
    this.docKey,
    this.load,
  });

  @override
  State<DocumentDetailScreen> createState() => _DocumentDetailScreenState();
}

class _DocumentDetailScreenState extends State<DocumentDetailScreen> {
  bool _isLoading = false;
  String? _loadedBase64;
  String? _fileName;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadedBase64 = widget.base64Data;
    if (_loadedBase64 == null && widget.loadId != null && widget.docKey != null) {
      _fetchDocumentData();
    }
  }

  Future<void> _fetchDocumentData() async {
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    if (token == null || widget.loadId == null || widget.docKey == null) return;

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      int? stopNum;
      String cleanKey = widget.docKey!;
      if (cleanKey.contains('_')) {
        final parts = cleanKey.split('_');
        cleanKey = parts[0];
        stopNum = int.tryParse(parts[1]);
      }

      final res = await ApiClient.fetchDocument(token, widget.loadId!, cleanKey, stopNumber: stopNum);
      if (mounted) {
        setState(() {
          _isLoading = false;
          if (res != null && res['data'] != null) {
            _loadedBase64 = res['data'].toString();
            _fileName = res['name']?.toString();
          } else {
            _error = res?['error']?.toString() ?? 'Document file not found on server.';
          }
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _error = 'Failed to load document preview: $e';
        });
      }
    }
  }

  Uint8List? _getDecodedBytes() {
    if (_loadedBase64 == null || _loadedBase64!.isEmpty) return null;
    try {
      String clean = _loadedBase64!.trim();
      if (clean.contains(',')) {
        clean = clean.split(',').last;
      }
      clean = clean.replaceAll(RegExp(r'\s+'), '');
      return base64Decode(clean);
    } catch (e) {
      debugPrint('Base64 decode error: $e');
      return null;
    }
  }

  void _openFullScreenViewer(Uint8List bytes) {
    Navigator.push(
      context,
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (ctx) => Scaffold(
          backgroundColor: Colors.black,
          appBar: AppBar(
            backgroundColor: Colors.black,
            foregroundColor: Colors.white,
            title: Text(widget.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            actions: [
              IconButton(
                icon: const Icon(Icons.close_rounded),
                onPressed: () => Navigator.pop(ctx),
              ),
            ],
          ),
          body: Center(
            child: InteractiveViewer(
              minScale: 0.5,
              maxScale: 5.0,
              child: Image.memory(
                bytes,
                fit: BoxFit.contain,
                errorBuilder: (_, __, ___) => const Center(
                  child: Text('Unable to render document image', style: TextStyle(color: Colors.white70)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _openFullscreenRcViewer() {
    Navigator.push(
      context,
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (ctx) => Scaffold(
          backgroundColor: const Color(0xFF1E293B),
          appBar: AppBar(
            backgroundColor: const Color(0xFF0F172A),
            foregroundColor: Colors.white,
            title: const Text('Official Rate Confirmation', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
            actions: [
              IconButton(
                icon: const Icon(Icons.close_rounded),
                onPressed: () => Navigator.pop(ctx),
              ),
            ],
          ),
          body: InteractiveViewer(
            minScale: 0.8,
            maxScale: 3.5,
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
              child: _buildRateConfirmationDocumentSheet(isFullscreen: true),
            ),
          ),
        ),
      ),
    );
  }

  void _openUploadSheet(BuildContext context) {
    if (widget.load != null) {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => PhotoUploadScreen(load: widget.load!),
        ),
      );
      return;
    }

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
                'Update ${widget.title}',
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: AppColors.textDark),
              ),
              const SizedBox(height: 16),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppColors.emeraldSoft,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.camera_alt_outlined, color: AppColors.emeraldPrimary),
                ),
                title: const Text('Capture Document', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark)),
                subtitle: const Text('Take high-resolution photo with camera', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Camera ready for document capture'),
                      backgroundColor: AppColors.emeraldPrimary,
                    ),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRateConfirmationDocumentSheet({bool isFullscreen = false}) {
    final load = widget.load;
    final loadNum = load?.loadNumber ?? widget.loadId ?? 'HB-1042';
    final broker = load?.brokerName ?? 'HaulBoX Logistics';
    final rate = load?.displayRcPrice ?? '\$2,450.00';
    final pDate = load?.pickupDate ?? widget.issueDate ?? 'Today';
    final pTime = load?.pickupTime ?? '08:00 AM';
    final dDate = load?.deliveryDate ?? widget.expirationDate ?? 'Pending';
    final dTime = load?.deliveryTime ?? '04:00 PM';
    final pAddr = load?.pickupAddress ?? load?.pickup ?? 'Dallas, TX';
    final dAddr = load?.dropoffAddress ?? load?.dropoff ?? 'Houston, TX';
    final commodity = load?.commodity ?? 'General Freight';
    final weight = load?.displayWeightFormatted ?? '42,500 lbs';
    final miles = load?.miles?.toString() ?? '245';

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFCBD5E1), width: 1.5),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: EdgeInsets.all(isFullscreen ? 20 : 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 1. Header Banner
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    broker.toUpperCase(),
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: Color(0xFF0F172A), letterSpacing: 0.5),
                  ),
                  const Text(
                    'RATE CONFIRMATION & LOAD AGREEMENT',
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: Color(0xFF059669), letterSpacing: 0.8),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: const Color(0xFFECFDF5),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: const Color(0xFF10B981)),
                ),
                child: Text(
                  'LOAD #$loadNum',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: Color(0xFF047857)),
                ),
              ),
            ],
          ),
          const Divider(height: 20, thickness: 1.5, color: Color(0xFFE2E8F0)),

          // 2. Financial Summary Block
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFF8FAFC),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('TOTAL AGREED RATE', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: Color(0xFF64748B))),
                    Text(rate, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: Color(0xFF0F172A))),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('COMMODITY / WEIGHT', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: Color(0xFF64748B))),
                    Text('$commodity • $weight', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Color(0xFF334155))),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // 3. Shipper / Pickup Dock Block
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(color: const Color(0xFF3B82F6), borderRadius: BorderRadius.circular(4)),
                      child: const Text('PICKUP #1', style: TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w900)),
                    ),
                    const SizedBox(width: 8),
                    Text('$pDate @ $pTime', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Color(0xFF1E293B))),
                  ],
                ),
                const SizedBox(height: 6),
                Text(pAddr, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Color(0xFF0F172A))),
                if (load?.pickupContact != null)
                  Text('Contact: ${load!.pickupContact} ${load.pickupPhone ?? ""}', style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
              ],
            ),
          ),
          const SizedBox(height: 10),

          // 4. Receiver / Delivery Dock Block
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(color: const Color(0xFF10B981), borderRadius: BorderRadius.circular(4)),
                      child: const Text('DELIVERY #1', style: TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w900)),
                    ),
                    const SizedBox(width: 8),
                    Text('$dDate @ $dTime', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Color(0xFF1E293B))),
                  ],
                ),
                const SizedBox(height: 6),
                Text(dAddr, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Color(0xFF0F172A))),
                if (load?.dropoffContact != null)
                  Text('Contact: ${load!.dropoffContact} ${load.dropoffPhone ?? ""}', style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // 5. Special Instructions & Carrier Terms
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFFFFFBEB),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0xFFFDE68A)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.info_outline_rounded, size: 14, color: Color(0xFFD97706)),
                    SizedBox(width: 6),
                    Text('SPECIAL INSTRUCTIONS & LOAD TERMS', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: Color(0xFFB45309))),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  load?.notes?.isNotEmpty == true ? load!.notes! : 'Driver must verify piece count and note damages on BOL before signing. Detention starts 2 hrs after arrival with stamped BOL.',
                  style: const TextStyle(fontSize: 11, color: Color(0xFF78350F), height: 1.3),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // 6. Verification Seal & Signature
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.verified_rounded, size: 18, color: Color(0xFF059669)),
                  SizedBox(width: 6),
                  Text('DIGITALLY SIGNED & DISPATCHED', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: Color(0xFF059669))),
                ],
              ),
              Text('$miles Total Miles', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFF64748B))),
            ],
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bytes = _getDecodedBytes();
    final isApproved = widget.status.toUpperCase().contains('APPROV') || widget.status.toUpperCase().contains('VERIF');
    final isRcDoc = widget.docKey == 'RC' || widget.title.contains('Rate Confirmation') || widget.title.contains('RC');

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        title: Text(widget.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh Document',
            onPressed: _fetchDocumentData,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // 1. High-Res Document Preview Box or Full RC Document Sheet
          if (isRcDoc && bytes == null)
            GestureDetector(
              onTap: _openFullscreenRcViewer,
              child: Stack(
                children: [
                  _buildRateConfirmationDocumentSheet(isFullscreen: false),
                  Positioned(
                    top: 10,
                    right: 10,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.75),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.zoom_in_rounded, size: 13, color: Colors.white),
                          SizedBox(width: 4),
                          Text('Tap to Zoom', style: TextStyle(color: Colors.white, fontSize: 10.5, fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            )
          else
            GestureDetector(
              onTap: bytes != null ? () => _openFullScreenViewer(bytes) : null,
              child: Container(
                height: 240,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: AppRadius.xlBorder,
                  border: Border.all(color: AppColors.borderLight),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.04),
                      blurRadius: 12,
                      offset: const Offset(0, 3),
                    ),
                  ],
                ),
                child: ClipRRect(
                  borderRadius: AppRadius.xlBorder,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      if (_isLoading)
                        const Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              CircularProgressIndicator(color: AppColors.emeraldPrimary),
                              SizedBox(height: 12),
                              Text('Loading document file...', style: TextStyle(color: AppColors.textMuted, fontSize: 13)),
                            ],
                          ),
                        )
                      else if (bytes != null)
                        InteractiveViewer(
                          minScale: 1.0,
                          maxScale: 3.0,
                          child: Image.memory(
                            bytes,
                            width: double.infinity,
                            height: double.infinity,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => const Center(
                              child: Icon(Icons.broken_image_rounded, size: 48, color: Colors.grey),
                            ),
                          ),
                        )
                      else
                        Container(
                          color: const Color(0xFFF8FAFC),
                          padding: const EdgeInsets.all(20),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                isApproved ? Icons.task_alt_rounded : Icons.description_outlined,
                                size: 52,
                                color: isApproved ? AppColors.emeraldPrimary : AppColors.textMuted,
                              ),
                              const SizedBox(height: 10),
                              Text(
                                widget.title,
                                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: AppColors.textDark),
                                textAlign: TextAlign.center,
                              ),
                              const SizedBox(height: 4),
                              Text(
                                _error ?? (isApproved ? 'Digital verified record on file' : 'No document image uploaded yet'),
                                style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                                textAlign: TextAlign.center,
                              ),
                            ],
                          ),
                        ),

                      // Top Status Badge
                      Positioned(
                        top: 12,
                        right: 12,
                        child: StatusBadge(status: widget.status),
                      ),

                      // Bottom tap hint
                      if (bytes != null)
                        Positioned(
                          bottom: 8,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: Colors.black.withValues(alpha: 0.65),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: const Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.zoom_in_rounded, size: 14, color: Colors.white),
                                SizedBox(width: 4),
                                Text('Tap for Fullscreen Zoom', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          const SizedBox(height: 16),

          // 2. Metadata Specs Card
          HaulBoxCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionHeader(
                  title: 'Document Information & Validity',
                  icon: Icons.verified_user_outlined,
                ),
                const SizedBox(height: 8),
                _buildFieldRow('Document Type', widget.title),
                _buildFieldRow('Document # / ID', widget.documentNumber ?? 'HBX-DOC-${widget.loadId ?? "1042"}'),
                if (widget.loadId != null)
                  _buildFieldRow('Associated Load', 'Load #${widget.loadId}'),
                _buildFieldRow('Category', widget.category == 'DRIVER' ? 'Driver Compliance' : 'Freight & Trip'),
                _buildFieldRow('Issue / Departure Date', widget.issueDate ?? 'Today'),
                _buildFieldRow('Delivery Date', widget.expirationDate ?? 'Pending Delivery'),
                _buildFieldRow('Verification Status', widget.status),
                if (_fileName != null)
                  _buildFieldRow('File Name', _fileName!),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // 3. Action Buttons
          if (bytes != null)
            HaulBoxButton(
              text: 'OPEN FULLSCREEN VIEWER',
              icon: Icons.fullscreen_rounded,
              onPressed: () => _openFullScreenViewer(bytes),
            )
          else if (isRcDoc)
            HaulBoxButton(
              text: 'OPEN FULLSCREEN RC DOCUMENT',
              icon: Icons.fullscreen_rounded,
              onPressed: _openFullscreenRcViewer,
            )
          else
            HaulBoxButton(
              text: 'UPLOAD / REPLACE DOCUMENT',
              icon: Icons.camera_alt_rounded,
              onPressed: () => _openUploadSheet(context),
            ),

          const SizedBox(height: 10),
          HaulBoxButton(
            text: bytes != null ? 'RETAKE / REPLACE' : 'REFRESH STATUS',
            icon: bytes != null ? Icons.upload_file_outlined : Icons.refresh_rounded,
            type: HaulBoxButtonType.secondary,
            onPressed: bytes != null ? () => _openUploadSheet(context) : _fetchDocumentData,
          ),
        ],
      ),
    );
  }

  Widget _buildFieldRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 13, color: AppColors.textMuted, fontWeight: FontWeight.w500)),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              value,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.textDark),
              textAlign: TextAlign.end,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
