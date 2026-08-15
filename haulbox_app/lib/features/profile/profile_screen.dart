import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../shared/models/driver_document_model.dart';
import '../../shared/widgets/haulbox_button.dart';
import '../../shared/widgets/status_badge.dart';
import '../auth/auth_provider.dart';
import '../documents/document_detail_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  // Accordion expansion states
  bool _isDriverDocsExpanded = false;
  bool _isTruckDocsExpanded = false;
  bool _isLoadDocsExpanded = false;
  bool _isTruckGalleryExpanded = false;
  bool _isUploadingPhoto = false;

  // 1. Driver Documents List
  final List<DriverDocument> _driverDocs = [
    DriverDocument(
      id: 'dd-1',
      type: 'DRIVER_LICENSE',
      title: 'Driver License',
      documentNumber: 'TX-48921098',
      issueDate: 'Aug 20, 2021',
      expirationDate: 'Dec 15, 2027',
      status: 'VALID',
    ),
    DriverDocument(
      id: 'dd-2',
      type: 'CDL',
      title: 'Commercial Driver License (CDL)',
      documentNumber: 'CDL12345678',
      issueDate: 'Dec 15, 2022',
      expirationDate: 'Dec 15, 2026',
      status: 'VALID',
    ),
    DriverDocument(
      id: 'dd-3',
      type: 'MEDICAL_CARD',
      title: 'DOT Medical Examiner Card',
      documentNumber: 'MED-774921',
      issueDate: 'Aug 10, 2023',
      expirationDate: 'Aug 10, 2025',
      status: 'VALID',
    ),
    DriverDocument(
      id: 'dd-4',
      type: 'W9',
      title: 'Form W-9 (Taxpayer ID)',
      documentNumber: 'W9-VERIFIED',
      issueDate: 'Jan 05, 2024',
      expirationDate: 'Dec 31, 2025',
      status: 'VALID',
    ),
    DriverDocument(
      id: 'dd-5',
      type: 'MVR',
      title: 'Motor Vehicle Record (MVR)',
      documentNumber: 'MVR-CLEAN',
      issueDate: 'Feb 20, 2024',
      expirationDate: 'Feb 20, 2025',
      status: 'EXPIRING',
    ),
  ];

  // 2. Truck Documents List
  final List<TruckDocument> _truckDocs = [
    TruckDocument(
      id: 'td-1',
      type: 'REGISTRATION',
      title: 'Truck Cab Card Registration',
      documentNumber: 'CAB-98421-TX',
      issueDate: 'Mar 15, 2023',
      expirationDate: 'Mar 15, 2027',
      status: 'VALID',
    ),
    TruckDocument(
      id: 'td-2',
      type: 'INSURANCE',
      title: 'Commercial Truck Insurance',
      documentNumber: 'POL-884210-COI',
      issueDate: 'Dec 10, 2023',
      expirationDate: 'Dec 10, 2026',
      status: 'VALID',
    ),
    TruckDocument(
      id: 'td-3',
      type: 'INSPECTION',
      title: 'Annual DOT Safety Inspection',
      documentNumber: 'INSP-2023-99',
      issueDate: 'Nov 01, 2023',
      expirationDate: 'Nov 01, 2026',
      status: 'VALID',
    ),
    TruckDocument(
      id: 'td-4',
      type: 'IFTA',
      title: 'IFTA License & Decals',
      documentNumber: 'IFTA-TX-2024',
      issueDate: 'Jan 01, 2024',
      expirationDate: 'Dec 31, 2026',
      status: 'VALID',
    ),
    TruckDocument(
      id: 'td-5',
      type: 'PERMIT',
      title: 'State Highway & Oversize Permits',
      documentNumber: 'PERM-7721',
      issueDate: 'Sep 30, 2023',
      expirationDate: 'Sep 30, 2025',
      status: 'VALID',
    ),
  ];

  // 3. Load Documents List
  final List<Map<String, String>> _loadDocs = [
    {'title': 'Bill of Lading (BOL)', 'status': 'VERIFIED', 'doc': 'BOL_HBX20241042.pdf'},
    {'title': 'Proof of Delivery (POD)', 'status': 'PENDING', 'doc': 'POD_Signed_Delivery.pdf'},
    {'title': 'Rate Confirmation (RC)', 'status': 'VERIFIED', 'doc': 'Rate_Confirmation_RC.pdf'},
    {'title': 'Freight Settlement Invoice', 'status': 'AVAILABLE', 'doc': 'Invoice_Settlement.pdf'},
  ];

  // 4. Truck Gallery 8 Photo Slots
  final List<TruckGalleryPhoto> _galleryPhotos = [
    TruckGalleryPhoto(id: 'g-1', slotKey: 'truck_front', label: 'Truck Front', isUploaded: true),
    TruckGalleryPhoto(id: 'g-2', slotKey: 'truck_driver_side', label: 'Truck Driver Side', isUploaded: true),
    TruckGalleryPhoto(id: 'g-3', slotKey: 'truck_passenger_side', label: 'Truck Passenger Side', isUploaded: false),
    TruckGalleryPhoto(id: 'g-4', slotKey: 'truck_rear', label: 'Truck Rear', isUploaded: false),
    TruckGalleryPhoto(id: 'g-5', slotKey: 'trailer_front', label: 'Trailer Front', isUploaded: false),
    TruckGalleryPhoto(id: 'g-6', slotKey: 'trailer_side', label: 'Trailer Side', isUploaded: true),
    TruckGalleryPhoto(id: 'g-7', slotKey: 'trailer_rear', label: 'Trailer Rear', isUploaded: false),
    TruckGalleryPhoto(id: 'g-8', slotKey: 'equipment_additional', label: 'Additional Photo', isUploaded: false),
  ];

  void _openChangeProfilePhotoSheet(AuthProvider auth) {
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
                'Change Profile Photo',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppColors.textDark),
              ),
              const SizedBox(height: 6),
              const Text(
                'Select a clear headshot photo for your driver identity.',
                style: TextStyle(fontSize: 12.5, color: AppColors.textMuted),
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
                title: const Text('TAKE PHOTO', style: TextStyle(fontWeight: FontWeight.w800, color: AppColors.textDark)),
                subtitle: const Text('Use camera for a quick headshot', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  _processProfilePhotoUpload(auth, 'camera_avatar.jpg');
                },
              ),
              const Divider(color: AppColors.borderLight, height: 1),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE0F2FE),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.photo_library_outlined, color: Color(0xFF0284C7)),
                ),
                title: const Text('CHOOSE FROM GALLERY', style: TextStyle(fontWeight: FontWeight.w800, color: AppColors.textDark)),
                subtitle: const Text('Pick picture from device photos', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  _processProfilePhotoUpload(auth, 'gallery_avatar.jpg');
                },
              ),
              if (auth.driver?.profilePhotoUrl != null) ...[
                const Divider(color: AppColors.borderLight, height: 1),
                ListTile(
                  leading: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: AppColors.statusDangerSoft,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(Icons.delete_outline_rounded, color: AppColors.statusDanger),
                  ),
                  title: const Text('REMOVE PROFILE PHOTO', style: TextStyle(fontWeight: FontWeight.w800, color: AppColors.statusDanger)),
                  onTap: () {
                    Navigator.pop(ctx);
                    auth.removeProfilePhoto();
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Profile photo removed. Restored default avatar.'),
                        backgroundColor: AppColors.textDark,
                      ),
                    );
                  },
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _processProfilePhotoUpload(AuthProvider auth, String photoSource) async {
    setState(() => _isUploadingPhoto = true);
    await Future.delayed(const Duration(milliseconds: 800));

    if (mounted) {
      auth.updateProfilePhoto(photoSource);
      setState(() => _isUploadingPhoto = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Profile photo updated successfully across all screens!'),
          backgroundColor: AppColors.emeraldPrimary,
        ),
      );
    }
  }

  void _openPhotoActionSheet(TruckGalleryPhoto photo) {
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
                photo.label,
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
                title: const Text('TAKE PHOTO', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark)),
                subtitle: const Text('Capture using device camera', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  setState(() => photo.isUploaded = true);
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('${photo.label} photo captured!'),
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
                  child: const Icon(Icons.photo_library_outlined, color: AppColors.textPrimary),
                ),
                title: const Text('CHOOSE FROM GALLERY', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark)),
                subtitle: const Text('Pick from device photos', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  setState(() => photo.isUploaded = true);
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('${photo.label} photo selected from gallery!'),
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

  void _openPhotoPreviewModal(TruckGalleryPhoto photo) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.xlBorder),
        title: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(photo.label, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: AppColors.textDark)),
            const StatusBadge(status: 'VALID', isSmall: true),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              height: 180,
              width: double.infinity,
              decoration: BoxDecoration(
                color: AppColors.bgSecondary,
                borderRadius: AppRadius.lgBorder,
                border: Border.all(color: AppColors.borderLight),
              ),
              child: Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.local_shipping_rounded, size: 54, color: AppColors.emeraldDark.withValues(alpha: 0.8)),
                    const SizedBox(height: 8),
                    Text(
                      '${photo.label} HD Preview',
                      style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark, fontSize: 13),
                    ),
                    const SizedBox(height: 2),
                    const Text('Synced with Fleet Cloud', style: TextStyle(color: AppColors.textMuted, fontSize: 11.5)),
                  ],
                ),
              ),
            ),
          ],
        ),
        actions: [
          TextButton.icon(
            icon: const Icon(Icons.delete_outline_rounded, color: AppColors.statusDanger, size: 18),
            label: const Text('DELETE', style: TextStyle(color: AppColors.statusDanger, fontWeight: FontWeight.w700)),
            onPressed: () {
              Navigator.pop(ctx);
              setState(() => photo.isUploaded = false);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('${photo.label} photo removed'),
                  backgroundColor: AppColors.statusDanger,
                ),
              );
            },
          ),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.emeraldPrimary),
            icon: const Icon(Icons.refresh_rounded, color: Colors.white, size: 18),
            label: const Text('REPLACE', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
            onPressed: () {
              Navigator.pop(ctx);
              _openPhotoActionSheet(photo);
            },
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);
    final driver = authProvider.driver;

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        title: const Text(
          'Driver Profile',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: -0.4),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout_rounded, color: AppColors.statusDanger),
            tooltip: 'Sign Out',
            onPressed: () => _confirmLogout(context, authProvider),
          ),
        ],
      ),
      body: Stack(
        children: [
          ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
            children: [
              // 1. PROFILE HEADER (Photo + Camera/Edit Button)
              _buildProfileHeader(driver, authProvider),
              const SizedBox(height: 14),

              // 2. COMBINED DRIVER & TRUCK DETAILS CARD (ONE SINGLE CARD)
              _buildCombinedDriverAndTruckCard(driver),
              const SizedBox(height: 14),

              // 3. DRIVER DOCUMENTS ACCORDION
              _buildAccordionSection(
                icon: Icons.description_outlined,
                title: 'Driver Documents',
                count: _driverDocs.length,
                isExpanded: _isDriverDocsExpanded,
                onToggle: () => setState(() => _isDriverDocsExpanded = !_isDriverDocsExpanded),
                child: Column(
                  children: _driverDocs.map((doc) => _buildDriverDocTile(doc)).toList(),
                ),
              ),
              const SizedBox(height: 14),

              // 4. TRUCK DOCUMENTS ACCORDION
              _buildAccordionSection(
                icon: Icons.local_shipping_outlined,
                title: 'Truck Documents',
                count: _truckDocs.length,
                isExpanded: _isTruckDocsExpanded,
                onToggle: () => setState(() => _isTruckDocsExpanded = !_isTruckDocsExpanded),
                child: Column(
                  children: _truckDocs.map((doc) => _buildTruckDocTile(doc)).toList(),
                ),
              ),
              const SizedBox(height: 14),

              // 5. LOAD DOCUMENTS ACCORDION
              _buildAccordionSection(
                icon: Icons.folder_outlined,
                title: 'Load Documents',
                count: _loadDocs.length,
                isExpanded: _isLoadDocsExpanded,
                onToggle: () => setState(() => _isLoadDocsExpanded = !_isLoadDocsExpanded),
                child: Column(
                  children: _loadDocs.map((doc) => _buildLoadDocTile(doc)).toList(),
                ),
              ),
              const SizedBox(height: 14),

              // 6. TRUCK GALLERY ACCORDION
              _buildAccordionSection(
                icon: Icons.photo_camera_outlined,
                title: 'Truck Gallery',
                count: _galleryPhotos.where((p) => p.isUploaded).length,
                totalCount: _galleryPhotos.length,
                isExpanded: _isTruckGalleryExpanded,
                onToggle: () => setState(() => _isTruckGalleryExpanded = !_isTruckGalleryExpanded),
                child: _buildTruckGalleryGrid(),
              ),
              const SizedBox(height: 24),

              // 7. SIGN OUT BUTTON
              HaulBoxButton(
                text: 'Sign Out of HaulBoX',
                icon: Icons.logout_rounded,
                type: HaulBoxButtonType.danger,
                onPressed: () => _confirmLogout(context, authProvider),
              ),
            ],
          ),

          // Uploading Profile Photo Overlay
          if (_isUploadingPhoto)
            Container(
              color: Colors.black.withValues(alpha: 0.4),
              child: Center(
                child: Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: AppRadius.lgBorder,
                    boxShadow: [
                      BoxShadow(color: Colors.black.withValues(alpha: 0.1), blurRadius: 16),
                    ],
                  ),
                  child: const Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      CircularProgressIndicator(color: AppColors.emeraldPrimary),
                      SizedBox(height: 14),
                      Text(
                        'Uploading profile photo...',
                        style: TextStyle(fontWeight: FontWeight.w800, color: AppColors.textDark, fontSize: 13.5),
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

  // 1. PROFILE HEADER
  Widget _buildProfileHeader(dynamic driver, AuthProvider auth) {
    final hasCustomPhoto = driver?.profilePhotoUrl != null;

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadius.xlBorder,
        border: Border.all(color: AppColors.borderLight),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 12,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Row(
        children: [
          // Driver Photo Avatar with Edit/Camera Button
          GestureDetector(
            onTap: () => _openChangeProfilePhotoSheet(auth),
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [AppColors.emeraldPrimary, Color(0xFF059669)],
                    ),
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.emeraldPrimary.withValues(alpha: 0.4), width: 2),
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.emeraldPrimary.withValues(alpha: 0.2),
                        blurRadius: 8,
                        offset: const Offset(0, 3),
                      ),
                    ],
                  ),
                  child: Center(
                    child: hasCustomPhoto
                        ? const Icon(Icons.person_rounded, color: Colors.white, size: 36)
                        : const Text(
                            'JS',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w900,
                              fontSize: 24,
                              letterSpacing: -0.5,
                            ),
                          ),
                  ),
                ),
                Positioned(
                  bottom: -2,
                  right: -2,
                  child: Container(
                    padding: const EdgeInsets.all(5),
                    decoration: BoxDecoration(
                      color: AppColors.emeraldPrimary,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 2),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.15),
                          blurRadius: 4,
                          offset: const Offset(0, 1),
                        ),
                      ],
                    ),
                    child: const Icon(Icons.camera_alt_rounded, color: Colors.white, size: 13),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 14),

          // Driver Name, Phone, Email
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        driver?.name ?? 'John D. Smith',
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textDark,
                          letterSpacing: -0.3,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.emeraldSoft,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: const Text(
                        'Active',
                        style: TextStyle(color: AppColors.emeraldDark, fontSize: 10, fontWeight: FontWeight.w800),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 3),
                Row(
                  children: [
                    const Icon(Icons.phone_outlined, size: 13, color: AppColors.emeraldDark),
                    const SizedBox(width: 5),
                    Text(
                      driver?.phone ?? '(214) 555-0123',
                      style: const TextStyle(fontSize: 12.5, color: AppColors.textPrimary, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Row(
                  children: [
                    const Icon(Icons.mail_outline_rounded, size: 13, color: AppColors.textSubtle),
                    const SizedBox(width: 5),
                    Flexible(
                      child: Text(
                        driver?.email ?? 'john.smith@email.com',
                        style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // 2. COMBINED DRIVER & TRUCK DETAILS CARD (ONE SINGLE CARD)
  Widget _buildCombinedDriverAndTruckCard(dynamic driver) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadius.xlBorder,
        border: Border.all(color: AppColors.borderLight),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Main Card Header
          const Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'DRIVER & TRUCK',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w900,
                  color: AppColors.emeraldDark,
                  letterSpacing: 0.8,
                ),
              ),
              Icon(Icons.badge_outlined, color: AppColors.emeraldDark, size: 18),
            ],
          ),
          const SizedBox(height: 14),

          // DRIVER DETAILS SECTION
          const Text(
            'DRIVER DETAILS',
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
              color: AppColors.textSubtle,
              letterSpacing: 0.6,
            ),
          ),
          const SizedBox(height: 8),
          _buildInfoRow('Name', driver?.name ?? 'John D. Smith'),
          _buildInfoRow('Phone', driver?.phone ?? '(214) 555-0123'),
          _buildInfoRow('Email', driver?.email ?? 'john.smith@email.com'),
          _buildInfoRow('CDL', driver?.cdlNumber ?? 'CDL12345678'),
          _buildInfoRow('CDL Expires', driver?.cdlExpiration ?? 'Dec 15, 2026'),
          _buildInfoRow('Address', driver?.address ?? '123 Driver St, Dallas, TX 75201'),

          const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Divider(color: AppColors.borderLight, height: 1),
          ),

          // TRUCK DETAILS SECTION
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'TRUCK DETAILS',
                style: TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textSubtle,
                  letterSpacing: 0.6,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.emeraldSoft,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Text('Assigned', style: TextStyle(color: AppColors.emeraldDark, fontSize: 9.5, fontWeight: FontWeight.w800)),
              ),
            ],
          ),
          const SizedBox(height: 8),
          _buildInfoRow('Truck Number', driver?.truck ?? 'Truck # HBX-1042'),
          _buildInfoRow('VIN', '1HGCM82633A123456'),
          _buildInfoRow('Make / Model', 'Freightliner Cascadia'),
          _buildInfoRow('Year', '2022'),
          _buildInfoRow('Trailer', '53ft Dry Van (#TR-9942)'),
        ],
      ),
    );
  }

  Widget _buildAccordionSection({
    required IconData icon,
    required String title,
    required int count,
    int? totalCount,
    required bool isExpanded,
    required VoidCallback onToggle,
    required Widget child,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadius.lgBorder,
        border: Border.all(
          color: isExpanded ? AppColors.emeraldPrimary.withValues(alpha: 0.5) : AppColors.borderLight,
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        children: [
          InkWell(
            onTap: onToggle,
            borderRadius: AppRadius.lgBorder,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: isExpanded ? AppColors.emeraldPrimary : AppColors.bgSecondary,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(
                      icon,
                      size: 18,
                      color: isExpanded ? Colors.white : AppColors.emeraldDark,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textDark,
                      letterSpacing: -0.2,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.bgSecondary,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      totalCount != null ? '$count/$totalCount' : '$count',
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ),
                  const Spacer(),
                  AnimatedRotation(
                    turns: isExpanded ? 0.25 : 0.0,
                    duration: const Duration(milliseconds: 200),
                    child: const Icon(
                      Icons.chevron_right_rounded,
                      color: AppColors.textSubtle,
                      size: 22,
                    ),
                  ),
                ],
              ),
            ),
          ),
          AnimatedCrossFade(
            firstChild: const SizedBox.shrink(),
            secondChild: Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
              child: child,
            ),
            crossFadeState: isExpanded ? CrossFadeState.showSecond : CrossFadeState.showFirst,
            duration: const Duration(milliseconds: 250),
          ),
        ],
      ),
    );
  }

  Widget _buildDriverDocTile(DriverDocument doc) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.bgLight,
        borderRadius: AppRadius.mdBorder,
        border: Border.all(color: AppColors.borderLight),
      ),
      child: InkWell(
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => DocumentDetailScreen(
                title: doc.title,
                documentNumber: doc.documentNumber,
                issueDate: doc.issueDate,
                expirationDate: doc.expirationDate,
                status: doc.status,
                category: 'DRIVER',
              ),
            ),
          );
        },
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: doc.status == 'EXPIRING' ? AppColors.statusWarningSoft : AppColors.emeraldSoft,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(
                Icons.badge_outlined,
                size: 18,
                color: doc.status == 'EXPIRING' ? AppColors.statusWarning : AppColors.emeraldDark,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    doc.title,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, color: AppColors.textDark),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Expires: ${doc.expirationDate ?? "Permanent"}',
                    style: const TextStyle(color: AppColors.textMuted, fontSize: 11.5),
                  ),
                ],
              ),
            ),
            StatusBadge(status: doc.status, isSmall: true),
            const SizedBox(width: 6),
            const Icon(Icons.chevron_right_rounded, color: AppColors.textSubtle, size: 18),
          ],
        ),
      ),
    );
  }

  Widget _buildTruckDocTile(TruckDocument doc) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.bgLight,
        borderRadius: AppRadius.mdBorder,
        border: Border.all(color: AppColors.borderLight),
      ),
      child: InkWell(
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => DocumentDetailScreen(
                title: doc.title,
                documentNumber: doc.documentNumber,
                issueDate: doc.issueDate,
                expirationDate: doc.expirationDate,
                status: doc.status,
                category: 'TRUCK',
              ),
            ),
          );
        },
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppColors.emeraldSoft,
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(
                Icons.verified_outlined,
                size: 18,
                color: AppColors.emeraldDark,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    doc.title,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, color: AppColors.textDark),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Expires: ${doc.expirationDate ?? "Permanent"}',
                    style: const TextStyle(color: AppColors.textMuted, fontSize: 11.5),
                  ),
                ],
              ),
            ),
            StatusBadge(status: doc.status, isSmall: true),
            const SizedBox(width: 6),
            const Icon(Icons.chevron_right_rounded, color: AppColors.textSubtle, size: 18),
          ],
        ),
      ),
    );
  }

  Widget _buildLoadDocTile(Map<String, String> doc) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.bgLight,
        borderRadius: AppRadius.mdBorder,
        border: Border.all(color: AppColors.borderLight),
      ),
      child: InkWell(
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => DocumentDetailScreen(
                title: doc['title']!,
                documentNumber: doc['doc'],
                issueDate: 'May 15, 2026',
                status: doc['status']!,
                category: 'TRUCK',
              ),
            ),
          );
        },
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: const BoxDecoration(
                color: AppColors.emeraldSoft,
                borderRadius: BorderRadius.all(Radius.circular(10)),
              ),
              child: const Icon(
                Icons.folder_open_outlined,
                size: 18,
                color: AppColors.emeraldDark,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    doc['title']!,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, color: AppColors.textDark),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    doc['doc']!,
                    style: const TextStyle(color: AppColors.textMuted, fontSize: 11.5),
                  ),
                ],
              ),
            ),
            StatusBadge(status: doc['status']!, isSmall: true),
            const SizedBox(width: 6),
            const Icon(Icons.chevron_right_rounded, color: AppColors.textSubtle, size: 18),
          ],
        ),
      ),
    );
  }

  Widget _buildTruckGalleryGrid() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 6),
          child: Text(
            '8 Equipment & Trailer Inspection Photo Slots',
            style: TextStyle(color: AppColors.textMuted, fontSize: 12, fontWeight: FontWeight.w600),
          ),
        ),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            crossAxisSpacing: 10,
            mainAxisSpacing: 10,
            childAspectRatio: 0.95,
          ),
          itemCount: _galleryPhotos.length,
          itemBuilder: (context, idx) {
            final photo = _galleryPhotos[idx];
            final isUploaded = photo.isUploaded;

            return GestureDetector(
              onTap: () {
                if (isUploaded) {
                  _openPhotoPreviewModal(photo);
                } else {
                  _openPhotoActionSheet(photo);
                }
              },
              child: Container(
                decoration: BoxDecoration(
                  color: isUploaded ? AppColors.emeraldSoft : AppColors.bgLight,
                  borderRadius: AppRadius.lgBorder,
                  border: Border.all(
                    color: isUploaded ? AppColors.emeraldPrimary : AppColors.borderLight,
                    width: isUploaded ? 1.5 : 1,
                  ),
                ),
                padding: const EdgeInsets.all(12),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: isUploaded ? AppColors.emeraldPrimary : Colors.white,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        isUploaded ? Icons.check_rounded : Icons.add_a_photo_outlined,
                        size: 24,
                        color: isUploaded ? Colors.white : AppColors.emeraldDark,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      photo.label,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: isUploaded ? AppColors.textDark : AppColors.textPrimary,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      isUploaded ? '✓ Attached' : '+ Add Photo',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: isUploaded ? FontWeight.w800 : FontWeight.w600,
                        color: isUploaded ? AppColors.emeraldDark : AppColors.textSubtle,
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ],
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 13, color: AppColors.textMuted, fontWeight: FontWeight.w500)),
          Flexible(
            child: Text(
              value,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.textDark),
              textAlign: TextAlign.right,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  void _confirmLogout(BuildContext context, AuthProvider authProvider) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.lgBorder),
        title: const Text('Sign Out', style: TextStyle(color: AppColors.textDark, fontWeight: FontWeight.w800)),
        content: const Text('Are you sure you want to sign out of the HaulBoX Driver App?'),
        actions: [
          TextButton(
            child: const Text('CANCEL', style: TextStyle(color: AppColors.textMuted, fontWeight: FontWeight.w700)),
            onPressed: () => Navigator.pop(ctx),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.statusDanger),
            child: const Text('SIGN OUT', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
            onPressed: () {
              Navigator.pop(ctx);
              authProvider.logout();
            },
          ),
        ],
      ),
    );
  }
}
