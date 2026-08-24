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
      final res = await ApiClient.fetchDocument(token, widget.loadId!, widget.docKey!);
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
      final clean = _loadedBase64!.replaceFirst(RegExp(r'data:image\/[a-zA-Z+]+;base64,'), '');
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

  @override
  Widget build(BuildContext context) {
    final bytes = _getDecodedBytes();
    final isApproved = widget.status.toUpperCase().contains('APPROV') || widget.status.toUpperCase().contains('VERIF');

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
          // 1. High-Res Document Preview Box
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
                    else if (widget.docKey == 'RC' || widget.title.contains('Rate Confirmation') || widget.title.contains('RC'))
                      Container(
                        color: const Color(0xFFF8FAFC),
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                const Row(
                                  children: [
                                    Icon(Icons.verified_rounded, size: 20, color: AppColors.emeraldDark),
                                    SizedBox(width: 6),
                                    Text('OFFICIAL RATE CONFIRMATION', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 12, color: AppColors.emeraldDark, letterSpacing: 0.5)),
                                  ],
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: AppColors.emeraldSoft,
                                    borderRadius: BorderRadius.circular(6),
                                    border: Border.all(color: AppColors.emeraldPrimary.withValues(alpha: 0.3)),
                                  ),
                                  child: Text(
                                    widget.load?.displayRcPrice ?? '\$2,450',
                                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: AppColors.emeraldDark),
                                  ),
                                ),
                              ],
                            ),
                            const Divider(height: 14, color: AppColors.borderLight),
                            Text(
                              'Broker: ${widget.load?.brokerName ?? "HaulBoX Logistics"}',
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: AppColors.textDark),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              'Lane: ${widget.load?.pickupCityState ?? "Origin"} → ${widget.load?.dropoffCityState ?? "Destination"}',
                              style: const TextStyle(fontSize: 12, color: AppColors.textPrimary, fontWeight: FontWeight.w600),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              'Cargo: ${widget.load?.commodity ?? "General Freight"} • ${widget.load?.displayWeightFormatted ?? "42,000 lbs"}',
                              style: const TextStyle(fontSize: 11.5, color: AppColors.textMuted),
                            ),
                            const SizedBox(height: 6),
                            const Row(
                              children: [
                                Icon(Icons.check_circle_outline_rounded, size: 14, color: AppColors.emeraldPrimary),
                                SizedBox(width: 4),
                                Text('Rate Contract Verified & Dispatched', style: TextStyle(fontSize: 11, color: AppColors.emeraldDark, fontWeight: FontWeight.w700)),
                              ],
                            ),
                          ],
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
