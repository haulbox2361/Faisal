import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../shared/models/load_model.dart';
import '../auth/auth_provider.dart';
import '../photo_upload/photo_upload_screen.dart';
import 'document_detail_screen.dart';

class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key});

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);
    final currentLoad = authProvider.currentLoad;
    final allLoads = authProvider.loads;
    final pastLoads = allLoads.where((l) => l.status.toUpperCase() == 'DELIVERED' || l.status.toUpperCase() == 'COMPLETED').toList();

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        title: const Text(
          'Documents Center',
          style: TextStyle(
            fontWeight: FontWeight.w800,
            fontSize: 18,
            letterSpacing: -0.3,
          ),
        ),
        centerTitle: true,
        elevation: 0,
        backgroundColor: Colors.white,
        foregroundColor: AppColors.textPrimary,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: () {
              authProvider.syncAllData();
            },
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => authProvider.syncAllData(),
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (currentLoad != null) ...[
                _buildActiveLoadHeader(currentLoad),
                const SizedBox(height: 18),
                const Text(
                  'REQUIRED LOAD DOCUMENTS',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textMuted,
                    letterSpacing: 0.8,
                  ),
                ),
                const SizedBox(height: 10),
                _buildRequiredDocCard(
                  title: 'Rate Confirmation (RC)',
                  type: 'RC',
                  docData: currentLoad.docs?['RC'],
                  load: currentLoad,
                  icon: Icons.description_outlined,
                  isMandatory: true,
                ),
                const SizedBox(height: 10),
                _buildRequiredDocCard(
                  title: 'Bill of Lading (BOL)',
                  type: 'BOL',
                  docData: currentLoad.docs?['BOL'],
                  load: currentLoad,
                  icon: Icons.receipt_long_outlined,
                  isMandatory: true,
                ),
                const SizedBox(height: 10),
                _buildRequiredDocCard(
                  title: 'Proof of Delivery (POD)',
                  type: 'POD',
                  docData: currentLoad.docs?['POD'],
                  load: currentLoad,
                  icon: Icons.assignment_turned_in_outlined,
                  isMandatory: true,
                ),
                const SizedBox(height: 24),
                const Text(
                  'OPTIONAL LOAD PHOTOS',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textMuted,
                    letterSpacing: 0.8,
                  ),
                ),
                const SizedBox(height: 10),
                _buildPhotoCategoryCard(
                  title: 'Pickup & Loading Photos',
                  type: 'PU',
                  load: currentLoad,
                  icon: Icons.camera_alt_outlined,
                ),
                const SizedBox(height: 10),
                _buildPhotoCategoryCard(
                  title: 'Delivery & Unloading Photos',
                  type: 'DO',
                  load: currentLoad,
                  icon: Icons.camera_enhance_outlined,
                ),
              ] else ...[
                _buildNoActiveLoadState(),
              ],
              const SizedBox(height: 30),
              const Text(
                'PAST LOADS DOCUMENT HISTORY',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textMuted,
                  letterSpacing: 0.8,
                ),
              ),
              const SizedBox(height: 10),
              _buildPastLoadsList(pastLoads),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildActiveLoadHeader(LoadModel load) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.borderLight),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.emeraldPrimary.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.local_shipping_rounded,
              color: AppColors.emeraldPrimary,
              size: 24,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Active Load #${load.loadNumber}',
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 15,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${load.pickupCityState} → ${load.dropoffCityState}',
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.textMuted,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRequiredDocCard({
    required String title,
    required String type,
    required dynamic docData,
    required LoadModel load,
    required IconData icon,
    required bool isMandatory,
  }) {
    final hasFile = docData != null && (docData['hasFile'] == true || docData['url'] != null || docData['data'] != null);
    final status = (docData?['status'] ?? (hasFile ? 'APPROVED' : 'MISSING')).toString().toUpperCase();

    Color statusColor;
    String statusLabel;
    String statusDot;

    if (status == 'APPROVED') {
      statusColor = AppColors.statusSuccess;
      statusLabel = 'Approved';
      statusDot = '🟢';
    } else if (status == 'REJECTED' || status == 'RETAKE_REQUIRED') {
      statusColor = AppColors.statusDanger;
      statusLabel = 'Fix Required';
      statusDot = '🔴';
    } else if (status == 'CHECKING' || status == 'PENDING') {
      statusColor = AppColors.statusWarning;
      statusLabel = 'Under Review';
      statusDot = '🟡';
    } else {
      statusColor = AppColors.textMuted;
      statusLabel = 'Upload Required';
      statusDot = '⚪';
    }

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: statusColor.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, color: statusColor, size: 22),
        ),
        title: Text(
          title,
          style: const TextStyle(
            fontWeight: FontWeight.w700,
            fontSize: 14,
            color: AppColors.textPrimary,
          ),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Row(
            children: [
              Text(
                '$statusDot $statusLabel',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: statusColor,
                ),
              ),
            ],
          ),
        ),
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => DocumentDetailScreen(
                title: title,
                documentNumber: '${type}-${load.loadNumber}',
                issueDate: load.pickupDate,
                expirationDate: load.deliveryDate,
                status: statusLabel,
                category: 'TRUCK',
                loadId: load.id,
                docKey: type,
                load: load,
              ),
            ),
          );
        },
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (hasFile)
              IconButton(
                icon: const Icon(Icons.visibility_outlined, color: AppColors.emeraldPrimary, size: 20),
                tooltip: 'View Document',
                onPressed: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => DocumentDetailScreen(
                        title: title,
                        documentNumber: '${type}-${load.loadNumber}',
                        issueDate: load.pickupDate,
                        expirationDate: load.deliveryDate,
                        status: statusLabel,
                        category: 'TRUCK',
                        loadId: load.id,
                        docKey: type,
                        load: load,
                      ),
                    ),
                  );
                },
              ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: hasFile ? Colors.grey.shade200 : AppColors.emeraldPrimary,
                foregroundColor: hasFile ? AppColors.textPrimary : Colors.white,
                elevation: 0,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => PhotoUploadScreen(load: load),
                  ),
                );
              },
              child: Text(
                hasFile ? 'Replace' : 'Upload',
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPhotoCategoryCard({
    required String title,
    required String type,
    required LoadModel load,
    required IconData icon,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: AppColors.statusInfo.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, color: AppColors.statusInfo, size: 22),
        ),
        title: Text(
          title,
          style: const TextStyle(
            fontWeight: FontWeight.w700,
            fontSize: 14,
            color: AppColors.textPrimary,
          ),
        ),
        subtitle: const Text(
          'Optional verification shots',
          style: TextStyle(fontSize: 12, color: AppColors.textMuted),
        ),
        trailing: IconButton(
          icon: const Icon(Icons.add_a_photo_outlined, color: AppColors.statusInfo),
          onPressed: () {
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => PhotoUploadScreen(load: load),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildNoActiveLoadState() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: const Column(
        children: [
          Icon(Icons.inventory_2_outlined, size: 40, color: AppColors.textMuted),
          SizedBox(height: 10),
          Text(
            'No Active Load Assigned',
            style: TextStyle(
              fontWeight: FontWeight.w700,
              fontSize: 15,
              color: AppColors.textPrimary,
            ),
          ),
          SizedBox(height: 4),
          Text(
            'When your dispatcher assigns a load, document requirements will appear here automatically.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }

  Widget _buildPastLoadsList(List<LoadModel> pastLoads) {
    if (pastLoads.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.borderLight),
        ),
        child: const Center(
          child: Text(
            'No past loads recorded yet.',
            style: TextStyle(fontSize: 12, color: AppColors.textMuted),
          ),
        ),
      );
    }

    return Column(
      children: pastLoads.map((load) {
        return Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.borderLight),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Load #${load.loadNumber}',
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${load.pickupCityState} → ${load.dropoffCityState}',
                      style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
                    ),
                  ],
                ),
              ),
              const Text(
                '🟢 Complete',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: AppColors.statusSuccess,
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}
