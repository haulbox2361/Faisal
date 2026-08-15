import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../shared/models/load_model.dart';
import '../../shared/widgets/haulbox_button.dart';
import '../../shared/widgets/section_header.dart';

class PhotoUploadScreen extends StatefulWidget {
  final LoadModel load;

  const PhotoUploadScreen({super.key, required this.load});

  @override
  State<PhotoUploadScreen> createState() => _PhotoUploadScreenState();
}

class _PhotoUploadScreenState extends State<PhotoUploadScreen> {
  int _selectedTab = 0; // 0 = Loading / Pickup, 1 = Unloading / Delivery
  bool _isUploading = false;

  final Map<String, bool> _slots = {
    'Pickup BOL Scan': true,
    'Cargo Condition (Pallets)': false,
    'Trailer Door Seal': false,
    'Odometer at Pickup': false,
    'Signed POD Receipt': true,
    'Unloaded Cargo Condition': false,
    'Receiving Dock Stamp': false,
    'Odometer at Delivery': false,
  };

  void _toggleSlot(String title) {
    setState(() {
      _slots[title] = !(_slots[title] ?? false);
    });
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
                    final isUploaded = _slots[title] == true;

                    return GestureDetector(
                      onTap: () => _toggleSlot(title),
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
                            Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: isUploaded ? AppColors.emeraldPrimary : AppColors.surfaceDark,
                                shape: BoxShape.circle,
                              ),
                              child: Icon(
                                isUploaded ? Icons.check_rounded : Icons.add_a_photo_outlined,
                                size: 24,
                                color: isUploaded ? const Color(0xFF06251A) : AppColors.emeraldPrimary,
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
                              isUploaded ? 'Photo Attached' : 'Tap to Capture',
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
