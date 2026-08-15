import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../shared/widgets/haulbox_button.dart';
import '../../shared/widgets/haulbox_card.dart';
import '../../shared/widgets/section_header.dart';
import '../../shared/widgets/status_badge.dart';

class DocumentDetailScreen extends StatelessWidget {
  final String title;
  final String? documentNumber;
  final String? issueDate;
  final String? expirationDate;
  final String status;
  final String category; // 'DRIVER' or 'TRUCK'
  final String? fileUrl;

  const DocumentDetailScreen({
    super.key,
    required this.title,
    this.documentNumber,
    this.issueDate,
    this.expirationDate,
    required this.status,
    required this.category,
    this.fileUrl,
  });

  void _confirmDelete(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.lgBorder),
        title: const Text('Delete Document?', style: TextStyle(color: AppColors.textDark, fontWeight: FontWeight.w800)),
        content: Text('Are you sure you want to remove "$title" from your Document Vault?'),
        actions: [
          TextButton(
            child: const Text('Cancel', style: TextStyle(color: AppColors.textMuted, fontWeight: FontWeight.w600)),
            onPressed: () => Navigator.pop(ctx),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.statusDanger),
            child: const Text('Delete', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
            onPressed: () {
              Navigator.pop(ctx);
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('"$title" deleted successfully'),
                  backgroundColor: AppColors.statusDanger,
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  void _openUploadSheet(BuildContext context) {
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
                'Update $title',
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
                title: const Text('Take Photo / Scan Document', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark)),
                subtitle: const Text('Use camera to scan paper document', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Document scanned and uploaded!'),
                      backgroundColor: AppColors.emeraldPrimary,
                    ),
                  );
                },
              ),
              const Divider(color: AppColors.borderLight, height: 1),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppColors.bgSecondary,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.folder_open_outlined, color: AppColors.textPrimary),
                ),
                title: const Text('Choose PDF / Image from Files', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark)),
                subtitle: const Text('Upload PDF or gallery file', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('PDF document uploaded successfully!'),
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
    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        title: Text(title),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline_rounded, color: AppColors.statusDanger),
            tooltip: 'Delete Document',
            onPressed: () => _confirmDelete(context),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // 1. Visual Preview Box (Clean Bright White)
          Container(
            height: 180,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: AppRadius.xlBorder,
              border: Border.all(color: AppColors.borderLight),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.03),
                  blurRadius: 10,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: Stack(
              alignment: Alignment.center,
              children: [
                Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.description_outlined,
                      size: 56,
                      color: AppColors.emeraldDark.withValues(alpha: 0.8),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      title,
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: AppColors.textDark),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 3),
                    const Text('Verified Digital Compliance Record', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                  ],
                ),
                Positioned(
                  top: 12,
                  right: 12,
                  child: StatusBadge(status: status),
                ),
              ],
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
                const SizedBox(height: 6),
                _buildFieldRow('Document Title', title),
                _buildFieldRow('Document # / ID', documentNumber ?? 'HBX-VERIFIED'),
                _buildFieldRow('Document Category', category == 'DRIVER' ? 'Driver Compliance' : 'Truck / Equipment'),
                _buildFieldRow('Issue Date', issueDate ?? 'Jan 15, 2024'),
                _buildFieldRow('Expiration Date', expirationDate ?? 'No Expiration'),
                _buildFieldRow('Verification Status', status),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // 3. Action Buttons
          HaulBoxButton(
            text: 'VIEW DOCUMENT',
            icon: Icons.visibility_outlined,
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Opening secure document preview...'),
                  backgroundColor: AppColors.emeraldPrimary,
                ),
              );
            },
          ),
          const SizedBox(height: 10),
          HaulBoxButton(
            text: 'UPDATE DOCUMENT',
            icon: Icons.upload_file_outlined,
            type: HaulBoxButtonType.secondary,
            onPressed: () => _openUploadSheet(context),
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
          Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.textDark)),
        ],
      ),
    );
  }
}
