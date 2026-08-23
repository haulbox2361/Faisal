import 'dart:io';
import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../shared/models/load_model.dart';
import '../../shared/widgets/haulbox_button.dart';
import '../../shared/widgets/section_header.dart';
import 'document_camera_screen.dart';

class PhotoUploadScreen extends StatefulWidget {
  final LoadModel load;

  const PhotoUploadScreen({super.key, required this.load});

  @override
  State<PhotoUploadScreen> createState() => _PhotoUploadScreenState();
}

class _PhotoUploadScreenState extends State<PhotoUploadScreen> {
  int _selectedTab = 0;
  bool _isUploading = false;

  final Map<String, File?> _capturedFiles = {
    'Pickup BOL Scan': null,
    'Cargo Condition (Pallets)': null,
    'Trailer Door Seal': null,
    'Odometer at Pickup': null,
    'Signed POD Receipt': null,
    'Unloaded Cargo Condition': null,
    'Receiving Dock Stamp': null,
    'Odometer at Delivery': null,
  };

  Future<void> _captureSlot(String title) async {
    final file = await DocumentCameraScreen.capture(
      context,
      slotLabel: title,
      loadNumber: widget.load.loadNumber,
    );
    if (file != null && mounted) {
      setState(() => _capturedFiles[title] = file);
    }
  }

  void _submitUpload() async {
    setState(() {
      _isUploading = true;
    });

    await Future.delayed(const Duration(milliseconds: 1200));

    if (!mounted) return;

    setState(() {
      _isUploading = false;
    });

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Photos and documents uploaded successfully to Dispatch!'),
        backgroundColor: AppColors.emeraldPrimary,
      ),
    );

    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final pickupSlots = [
      'Pickup BOL Scan',
      'Cargo Condition (Pallets)',
      'Trailer Door Seal',
      'Odometer at Pickup',
    ];

    final deliverySlots = [
      'Signed POD Receipt',
      'Unloaded Cargo Condition',
      'Receiving Dock Stamp',
      'Odometer at Delivery',
    ];

    final activeList = _selectedTab == 0 ? pickupSlots : deliverySlots;

    return Scaffold(
      appBar: AppBar(
        title: Text('${widget.load.loadNumber} Photos & POD'),
      ),
      body: Column(
        children: [
          // Segmented Tab Selector
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            color: AppColors.surfaceDark,
            child: Row(
              children: [
                Expanded(
                  child: _buildTabButton(0, '1. Loading / Pickup Photos'),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _buildTabButton(1, '2. Unloading / POD Photos'),
                ),
              ],
            ),
          ),

          // Photo Slots Grid
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                SectionHeader(
                  title: _selectedTab == 0 ? 'Pickup Documentation Slots' : 'Delivery & Proof of Delivery (POD)',
                  icon: Icons.camera_alt_outlined,
                ),
                const SizedBox(height: 8),
                GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    crossAxisSpacing: 12,
                    mainAxisSpacing: 12,
                    childAspectRatio: 0.95,
                  ),
                  itemCount: activeList.length,
                  itemBuilder: (context, idx) {
                    final title = activeList[idx];
                    final capturedFile = _capturedFiles[title];
                    final isUploaded = capturedFile != null;

                    return GestureDetector(
                      onTap: () => _captureSlot(title),
                      child: Container(
                        decoration: BoxDecoration(
                          color: isUploaded ? AppColors.emeraldSoft : AppColors.cardDark,
                          borderRadius: AppRadius.lgBorder,
                          border: Border.all(
                            color: isUploaded ? AppColors.emeraldPrimary : AppColors.borderDark,
                            width: isUploaded ? 1.5 : 1,
                          ),
                        ),
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            if (isUploaded)
                              ClipRRect(
                                borderRadius: BorderRadius.circular(8),
                                child: Image.file(
                                  capturedFile,
                                  width: 60,
                                  height: 60,
                                  fit: BoxFit.cover,
                                ),
                              )
                            else
                              Container(
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: AppColors.surfaceDark,
                                  shape: BoxShape.circle,
                                ),
                                child: const Icon(
                                  Icons.add_a_photo_outlined,
                                  size: 24,
                                  color: AppColors.emeraldPrimary,
                                ),
                              ),
                            const SizedBox(height: 12),
                            Text(
                              title,
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w700,
                                color: isUploaded ? Colors.white : AppColors.textLight,
                              ),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 4),
                            Text(
                              isUploaded ? 'Tap to Retake' : 'Tap to Capture',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: isUploaded ? FontWeight.w700 : FontWeight.w500,
                                color: isUploaded ? AppColors.emeraldPrimary : AppColors.textSubtle,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ],
            ),
          ),

          // Bottom Action Bar
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              color: AppColors.surfaceDark,
              border: Border(top: BorderSide(color: AppColors.borderDark, width: 1)),
            ),
            child: SafeArea(
              top: false,
              child: HaulBoxButton(
                text: 'Upload Photos & Confirm',
                icon: Icons.cloud_upload_outlined,
                isLoading: _isUploading,
                onPressed: _submitUpload,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTabButton(int index, String title) {
    final isSelected = _selectedTab == index;
    return GestureDetector(
      onTap: () => setState(() => _selectedTab = index),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.cardDark : Colors.transparent,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isSelected ? AppColors.borderDark : Colors.transparent,
          ),
        ),
        child: Center(
          child: Text(
            title,
            style: TextStyle(
              fontSize: 12,
              fontWeight: isSelected ? FontWeight.w800 : FontWeight.w500,
              color: isSelected ? AppColors.emeraldPrimary : AppColors.textMuted,
            ),
          ),
        ),
      ),
    );
  }
}
