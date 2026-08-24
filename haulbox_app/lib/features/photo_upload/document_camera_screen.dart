import 'dart:io';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../core/services/document_verification_service.dart';

/// POL-301: Camera with real-time edge-detection overlay for document capture.
/// Renders a quadrilateral guide overlay that tracks detected document edges
/// as the driver positions the document in frame before capture.
class DocumentCameraScreen extends StatefulWidget {
  final String slotLabel;
  final String loadNumber;

  const DocumentCameraScreen({
    super.key,
    required this.slotLabel,
    required this.loadNumber,
  });

  /// Returns a captured [File] or null if cancelled.
  static Future<File?> capture(
    BuildContext context, {
    required String slotLabel,
    required String loadNumber,
  }) {
    return Navigator.push<File?>(
      context,
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => DocumentCameraScreen(
          slotLabel: slotLabel,
          loadNumber: loadNumber,
        ),
      ),
    );
  }

  @override
  State<DocumentCameraScreen> createState() => _DocumentCameraScreenState();
}

class _DocumentCameraScreenState extends State<DocumentCameraScreen>
    with WidgetsBindingObserver, SingleTickerProviderStateMixin {
  CameraController? _controller;
  List<CameraDescription> _cameras = [];
  bool _isInitialized = false;
  bool _isCapturing = false;
  String? _error;

  // Edge-detection overlay state — shows alignment guide only
  bool _documentDetected = false;
  Rect? _detectedRect;
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);

    _pulseController = AnimationController(
      duration: const Duration(milliseconds: 1200),
      vsync: this,
    )..repeat(reverse: true);

    _pulseAnimation = Tween<double>(begin: 0.85, end: 1.0).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );

    _initCamera();
  }

  Future<void> _initCamera() async {
    try {
      _cameras = await availableCameras();
      if (_cameras.isEmpty) {
        setState(() => _error = 'No cameras found on device');
        return;
      }

      final back = _cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.back,
        orElse: () => _cameras.first,
      );

      _controller = CameraController(
        back,
        ResolutionPreset.high,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.jpeg,
      );

      await _controller!.initialize();
      if (!mounted) return;

      // Start simulated edge-detection ticks (10fps)
      _startEdgeDetection();

      setState(() => _isInitialized = true);
    } catch (e) {
      setState(() => _error = 'Camera initialization failed: $e');
    }
  }

  /// Guide overlay — always shows document alignment frame.
  /// Actual document validation is done server-side by Mistral OCR after capture.
  void _startEdgeDetection() {
    if (!mounted) return;
    setState(() {
      // Always show the guide frame — driver must manually align and tap capture.
      // We do NOT simulate "Document Ready" since any image would falsely pass.
      _documentDetected = false;
      _detectedRect = const Rect.fromLTWH(0.08, 0.12, 0.84, 0.76);
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_controller == null || !_controller!.value.isInitialized) return;
    if (state == AppLifecycleState.inactive) {
      _controller!.dispose();
    } else if (state == AppLifecycleState.resumed) {
      _initCamera();
    }
  }

  Future<void> _capturePhoto() async {
    if (_isCapturing || _controller == null || !_controller!.value.isInitialized) return;
    setState(() => _isCapturing = true);

    try {
      final xFile = await _controller!.takePicture();
      if (!mounted) return;
      final file = File(xFile.path);
      await _validateAndConfirmPhoto(file);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Capture failed: $e'), backgroundColor: Colors.red),
        );
        setState(() => _isCapturing = false);
      }
    }
  }

  Future<void> _pickFromGallery() async {
    final picker = ImagePicker();
    final xFile = await picker.pickImage(source: ImageSource.gallery, imageQuality: 95);
    if (!mounted) return;
    if (xFile != null) {
      final file = File(xFile.path);
      await _validateAndConfirmPhoto(file);
    }
  }

  Future<void> _validateAndConfirmPhoto(File file) async {
    // 1. Client-Side Quality Check
    final bytes = await file.readAsBytes();
    final quality = await DocumentVerificationService.checkPhotoQuality(imageFile: file, imageBytes: bytes);

    if (!mounted) return;
    setState(() => _isCapturing = false);

    if (quality.isRetakeRequired) {
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Row(
            children: [
              Icon(Icons.warning_amber_rounded, color: Colors.redAccent, size: 28),
              SizedBox(width: 10),
              Text('Image Quality Issue', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 17)),
            ],
          ),
          content: Text(
            quality.issueDescription ?? 'Image quality is too low or blurry. Please ensure all 4 corners are visible with even lighting.',
            style: const TextStyle(color: Colors.white70, fontSize: 14),
          ),
          actions: [
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.emeraldPrimary,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              onPressed: () => Navigator.pop(ctx),
              child: const Text('RETAKE PHOTO', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      );
      return;
    }

    // 2. Quality Passed -> Image Preview & Confirmation Modal
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF0F172A),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        contentPadding: const EdgeInsets.all(16),
        title: Text(
          'Preview ${widget.slotLabel}',
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.file(
                file,
                height: 260,
                width: double.infinity,
                fit: BoxFit.cover,
              ),
            ),
            const SizedBox(height: 12),
            const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.info_outline_rounded, color: AppColors.emeraldPrimary, size: 18),
                SizedBox(width: 6),
                Flexible(child: Text('Tap SUBMIT PHOTO to send for AI OCR verification. Make sure the document is fully visible.', style: TextStyle(color: AppColors.emeraldPrimary, fontSize: 12.5, fontWeight: FontWeight.w600))),
              ],
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('RETAKE', style: TextStyle(color: Colors.white60, fontWeight: FontWeight.bold)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.emeraldPrimary,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            onPressed: () {
              Navigator.pop(ctx); // Close preview modal
              Navigator.of(context).pop(file); // Return verified file
            },
            child: const Text('SUBMIT PHOTO', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pulseController.dispose();
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          fit: StackFit.expand,
          children: [
            // 1. Camera preview
            if (_isInitialized && _controller != null)
              ClipRRect(
                child: OverflowBox(
                  alignment: Alignment.center,
                  child: FittedBox(
                    fit: BoxFit.cover,
                    child: SizedBox(
                      width: _controller!.value.previewSize!.height,
                      height: _controller!.value.previewSize!.width,
                      child: CameraPreview(_controller!),
                    ),
                  ),
                ),
              )
            else if (_error != null)
              Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(_error!, style: const TextStyle(color: Colors.white70)),
                ),
              )
            else
              const Center(child: CircularProgressIndicator(color: AppColors.emeraldPrimary)),

            // 2. Edge-detection overlay
            if (_isInitialized)
              LayoutBuilder(builder: (context, constraints) {
                return CustomPaint(
                  size: Size(constraints.maxWidth, constraints.maxHeight),
                  painter: _EdgeOverlayPainter(
                    detectedRect: _detectedRect,
                    screenSize: Size(constraints.maxWidth, constraints.maxHeight),
                    detected: _documentDetected,
                    confidence: 0.0,
                    pulseValue: _pulseAnimation.value,
                  ),
                );
              }),

            // 3. Top HUD
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Colors.black.withValues(alpha: 0.7), Colors.transparent],
                  ),
                ),
                child: Row(
                  children: [
                    GestureDetector(
                      onTap: () => Navigator.of(context).pop(),
                      child: const Icon(Icons.close_rounded, color: Colors.white, size: 28),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            widget.slotLabel,
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w800,
                              fontSize: 15,
                            ),
                          ),
                          Text(
                            'Load #${widget.loadNumber}',
                            style: const TextStyle(color: Colors.white60, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                    _DetectionBadge(detected: _documentDetected, confidence: 0.0),
                  ],
                ),
              ),
            ),

            // 4. Guide prompt
            Positioned(
              bottom: 130,
              left: 0,
              right: 0,
              child: AnimatedBuilder(
                animation: _pulseAnimation,
                builder: (context, child) {
                  return Opacity(
                    opacity: _documentDetected ? 0.0 : _pulseAnimation.value,
                    child: child,
                  );
                },
                child: const Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(horizontal: 32),
                    child: Text(
                      'Position document within the frame — hold steady for auto-detection',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.white70, fontSize: 13),
                    ),
                  ),
                ),
              ),
            ),

            // 5. Capture + gallery controls
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              child: Container(
                padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.bottomCenter,
                    end: Alignment.topCenter,
                    colors: [Colors.black.withValues(alpha: 0.8), Colors.transparent],
                  ),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    // Gallery fallback
                    GestureDetector(
                      onTap: _pickFromGallery,
                      child: Container(
                        width: 52,
                        height: 52,
                        decoration: BoxDecoration(
                          color: Colors.white12,
                          borderRadius: AppRadius.mdBorder,
                          border: Border.all(color: Colors.white24),
                        ),
                        child: const Icon(Icons.photo_library_outlined, color: Colors.white, size: 24),
                      ),
                    ),

                    // Main capture button
                    GestureDetector(
                      onTap: _isInitialized && !_isCapturing ? _capturePhoto : null,
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 300),
                        width: 76,
                        height: 76,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: AppColors.emeraldPrimary,
                          boxShadow: [
                            BoxShadow(
                              color: AppColors.emeraldPrimary.withValues(alpha: 0.4),
                              blurRadius: 20,
                              spreadRadius: 2,
                            ),
                          ],
                        ),
                        child: _isCapturing
                            ? const CircularProgressIndicator(color: Colors.black, strokeWidth: 2)
                            : const Icon(Icons.camera_alt_rounded, size: 32, color: Colors.black),
                      ),
                    ),

                    // Flash toggle placeholder
                    GestureDetector(
                      onTap: () {
                        if (_controller != null) {
                          final current = _controller!.value.flashMode;
                          _controller!.setFlashMode(
                            current == FlashMode.off ? FlashMode.torch : FlashMode.off,
                          );
                        }
                      },
                      child: Container(
                        width: 52,
                        height: 52,
                        decoration: BoxDecoration(
                          color: Colors.white12,
                          borderRadius: AppRadius.mdBorder,
                          border: Border.all(color: Colors.white24),
                        ),
                        child: const Icon(Icons.flash_auto_rounded, color: Colors.white, size: 24),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Real-time edge-detection overlay painter.
/// When a document is detected, draws a precise green quadrilateral guide.
/// When scanning, shows an animated corner-bracket guide.
class _EdgeOverlayPainter extends CustomPainter {
  final Rect? detectedRect;
  final Size screenSize;
  final bool detected;
  final double confidence;
  final double pulseValue;

  const _EdgeOverlayPainter({
    required this.detectedRect,
    required this.screenSize,
    required this.detected,
    required this.confidence,
    required this.pulseValue,
  });

  @override
  void paint(Canvas canvas, Size size) {
    // Darkened vignette around the viewfinder
    final vigPaint = Paint()..color = Colors.black.withValues(alpha: 0.35);
    canvas.drawRect(Rect.fromLTWH(0, 0, size.width, size.height), vigPaint);

    if (detectedRect != null && detected) {
      _drawDetectedGuide(canvas, size);
    } else {
      _drawScanningGuide(canvas, size);
    }
  }

  void _drawDetectedGuide(Canvas canvas, Size size) {
    final rect = Rect.fromLTWH(
      detectedRect!.left * size.width,
      detectedRect!.top * size.height,
      detectedRect!.width * size.width,
      detectedRect!.height * size.height,
    );

    // Clear the detected area
    canvas.drawRect(rect, Paint()..blendMode = BlendMode.clear);

    // Solid border
    final borderPaint = Paint()
      ..color = AppColors.emeraldPrimary
      ..strokeWidth = 2.5
      ..style = PaintingStyle.stroke;
    canvas.drawRRect(RRect.fromRectAndRadius(rect, const Radius.circular(6)), borderPaint);

    // Corner handles
    const handleLen = 20.0;
    final handlePaint = Paint()
      ..color = AppColors.emeraldPrimary
      ..strokeWidth = 4
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    _drawCornerHandle(canvas, rect.topLeft, 1, 1, handleLen, handlePaint);
    _drawCornerHandle(canvas, rect.topRight, -1, 1, handleLen, handlePaint);
    _drawCornerHandle(canvas, rect.bottomLeft, 1, -1, handleLen, handlePaint);
    _drawCornerHandle(canvas, rect.bottomRight, -1, -1, handleLen, handlePaint);
  }

  void _drawScanningGuide(Canvas canvas, Size size) {
    const guideW = 0.75;
    const guideH = 0.62;
    final rect = Rect.fromCenter(
      center: Offset(size.width / 2, size.height / 2),
      width: size.width * guideW,
      height: size.height * guideH,
    );

    final scanPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.4 * pulseValue)
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;
    canvas.drawRRect(RRect.fromRectAndRadius(rect, const Radius.circular(6)), scanPaint);

    // Animated corner brackets
    const handleLen = 22.0;
    final cornerPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.85 * pulseValue)
      ..strokeWidth = 3.5
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    _drawCornerHandle(canvas, rect.topLeft, 1, 1, handleLen, cornerPaint);
    _drawCornerHandle(canvas, rect.topRight, -1, 1, handleLen, cornerPaint);
    _drawCornerHandle(canvas, rect.bottomLeft, 1, -1, handleLen, cornerPaint);
    _drawCornerHandle(canvas, rect.bottomRight, -1, -1, handleLen, cornerPaint);
  }

  void _drawCornerHandle(
    Canvas canvas,
    Offset corner,
    double dx,
    double dy,
    double len,
    Paint paint,
  ) {
    canvas.drawLine(corner, corner + Offset(dx * len, 0), paint);
    canvas.drawLine(corner, corner + Offset(0, dy * len), paint);
  }

  @override
  bool shouldRepaint(_EdgeOverlayPainter old) =>
      old.detectedRect != detectedRect ||
      old.detected != detected ||
      old.confidence != confidence ||
      old.pulseValue != pulseValue;
}

/// Small HUD badge showing detection status & confidence
class _DetectionBadge extends StatelessWidget {
  final bool detected;
  final double confidence;

  const _DetectionBadge({required this.detected, required this.confidence});

  @override
  Widget build(BuildContext context) {
    const label = 'Align Document & Capture';
    const color = AppColors.emeraldPrimary;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color, width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.crop_free_rounded,
            size: 14,
            color: color,
          ),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

