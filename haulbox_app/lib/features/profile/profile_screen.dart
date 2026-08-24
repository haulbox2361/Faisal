import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../core/theme/theme_provider.dart';
import '../../shared/models/driver_document_model.dart';
import '../../shared/models/driver_model.dart';
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
  bool _isTruckGalleryExpanded = false;
  bool _isUploadingPhoto = false;

  final ImagePicker _picker = ImagePicker();

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

  // 3. Truck Gallery 8 Photo Slots
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

  // Pick and Upload Profile Photo (Camera or Gallery)
  Future<void> _pickProfilePhoto(AuthProvider auth, ImageSource source) async {
    try {
      final xFile = await _picker.pickImage(
        source: source,
        imageQuality: 85,
        maxWidth: 800,
      );
      if (xFile == null) return;

      setState(() => _isUploadingPhoto = true);
      final bytes = await xFile.readAsBytes();
      final base64String = 'data:image/jpeg;base64,${base64Encode(bytes)}';

      await auth.updateProfilePhoto(base64String);

      if (mounted) {
        setState(() => _isUploadingPhoto = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('✓ Profile picture updated successfully!'),
            backgroundColor: AppColors.emeraldPrimary,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isUploadingPhoto = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error updating photo: $e'),
            backgroundColor: AppColors.statusDanger,
          ),
        );
      }
    }
  }

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
                'Select a headshot photo for your verified driver identity.',
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
                  child: const Icon(Icons.camera_alt_rounded, color: AppColors.emeraldPrimary),
                ),
                title: const Text('TAKE PHOTO WITH CAMERA', style: TextStyle(fontWeight: FontWeight.w800, color: AppColors.textDark, fontSize: 13.5)),
                subtitle: const Text('Capture headshot using device camera', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickProfilePhoto(auth, ImageSource.camera);
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
                  child: const Icon(Icons.photo_library_rounded, color: Color(0xFF0284C7)),
                ),
                title: const Text('CHOOSE FROM PHONE GALLERY', style: TextStyle(fontWeight: FontWeight.w800, color: AppColors.textDark, fontSize: 13.5)),
                subtitle: const Text('Select existing photo from library', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickProfilePhoto(auth, ImageSource.gallery);
                },
              ),
              if (auth.driver?.profilePhotoUrl != null && auth.driver!.profilePhotoUrl!.isNotEmpty) ...[
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
                  title: const Text('REMOVE PROFILE PHOTO', style: TextStyle(fontWeight: FontWeight.w800, color: AppColors.statusDanger, fontSize: 13.5)),
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

  // Edit Driver Details Dialog
  void _openEditDriverDetailsModal(BuildContext context, AuthProvider auth) {
    final driver = auth.driver;
    final nameCtrl = TextEditingController(text: driver?.name ?? '');
    final phoneCtrl = TextEditingController(text: driver?.phone ?? '');
    final emailCtrl = TextEditingController(text: driver?.email ?? '');
    final addressCtrl = TextEditingController(text: driver?.address ?? '');
    final truckCtrl = TextEditingController(text: driver?.truck ?? '');

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.xlBorder),
        title: const Row(
          children: [
            Icon(Icons.edit_note_rounded, color: AppColors.emeraldPrimary, size: 26),
            SizedBox(width: 8),
            Text('Edit Driver Details', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17, color: AppColors.textDark)),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _buildEditTextField(nameCtrl, 'Full Legal Name', Icons.person_outline),
              const SizedBox(height: 10),
              _buildEditTextField(phoneCtrl, 'Phone Number', Icons.phone_outlined, keyboardType: TextInputType.phone),
              const SizedBox(height: 10),
              _buildEditTextField(emailCtrl, 'Email Address', Icons.mail_outline, keyboardType: TextInputType.emailAddress),
              const SizedBox(height: 10),
              _buildEditTextField(addressCtrl, 'Physical Address', Icons.home_outlined),
              const SizedBox(height: 10),
              _buildEditTextField(truckCtrl, 'Assigned Truck #', Icons.local_shipping_outlined),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('CANCEL', style: TextStyle(color: AppColors.textMuted, fontWeight: FontWeight.w700)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.emeraldPrimary,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            onPressed: () async {
              Navigator.pop(ctx);
              final ok = await auth.updateDriverProfile(
                name: nameCtrl.text.trim(),
                phone: phoneCtrl.text.trim(),
                email: emailCtrl.text.trim(),
                address: addressCtrl.text.trim(),
                truck: truckCtrl.text.trim(),
              );
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(ok ? '✓ Driver details updated successfully!' : 'Failed to update details. Check connection.'),
                    backgroundColor: ok ? AppColors.emeraldPrimary : AppColors.statusDanger,
                  ),
                );
              }
            },
            child: const Text('SAVE CHANGES', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );
  }

  Widget _buildEditTextField(TextEditingController ctrl, String label, IconData icon, {TextInputType keyboardType = TextInputType.text}) {
    return TextField(
      controller: ctrl,
      keyboardType: keyboardType,
      style: const TextStyle(fontSize: 13.5, color: AppColors.textDark, fontWeight: FontWeight.w600),
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon, size: 18, color: AppColors.emeraldDark),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.borderLight)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.borderLight)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.emeraldPrimary, width: 1.5)),
      ),
    );
  }

  // Equipment photo action sheet with Camera & Gallery
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
              Container(width: 40, height: 4, decoration: BoxDecoration(color: AppColors.borderLight, borderRadius: BorderRadius.circular(2))),
              const SizedBox(height: 16),
              Text('Add ${photo.label} Photo', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: AppColors.textDark)),
              const SizedBox(height: 16),
              ListTile(
                leading: Container(padding: const EdgeInsets.all(8), decoration: BoxDecoration(color: AppColors.emeraldSoft, borderRadius: BorderRadius.circular(10)), child: const Icon(Icons.camera_alt_outlined, color: AppColors.emeraldPrimary)),
                title: const Text('TAKE PHOTO WITH CAMERA', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark)),
                onTap: () async {
                  Navigator.pop(ctx);
                  final file = await _picker.pickImage(source: ImageSource.camera, imageQuality: 85);
                  if (file != null) {
                    setState(() => photo.isUploaded = true);
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('${photo.label} photo captured!'), backgroundColor: AppColors.emeraldPrimary),
                    );
                  }
                },
              ),
              const Divider(color: AppColors.borderLight, height: 1),
              ListTile(
                leading: Container(padding: const EdgeInsets.all(8), decoration: BoxDecoration(color: const Color(0xFFE0F2FE), borderRadius: BorderRadius.circular(10)), child: const Icon(Icons.photo_library_outlined, color: Color(0xFF0284C7))),
                title: const Text('CHOOSE FROM PHONE GALLERY', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark)),
                onTap: () async {
                  Navigator.pop(ctx);
                  final file = await _picker.pickImage(source: ImageSource.gallery, imageQuality: 85);
                  if (file != null) {
                    setState(() => photo.isUploaded = true);
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('${photo.label} photo selected from gallery!'), backgroundColor: AppColors.emeraldPrimary),
                    );
                  }
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
        content: Container(
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
                Text('${photo.label} Inspection Record', style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark, fontSize: 13)),
                const SizedBox(height: 2),
                const Text('Verified in Fleet Cloud', style: TextStyle(color: AppColors.textMuted, fontSize: 11.5)),
              ],
            ),
          ),
        ),
        actions: [
          TextButton.icon(
            icon: const Icon(Icons.delete_outline_rounded, color: AppColors.statusDanger, size: 18),
            label: const Text('DELETE', style: TextStyle(color: AppColors.statusDanger, fontWeight: FontWeight.w700)),
            onPressed: () {
              Navigator.pop(ctx);
              setState(() => photo.isUploaded = false);
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
    final themeProvider = Provider.of<ThemeProvider>(context);
    final driver = authProvider.driver;
    final isDark = themeProvider.isDarkMode;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: const Text(
          'Driver Profile',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: -0.4),
        ),
        actions: [
          IconButton(
            icon: Icon(
              isDark ? Icons.light_mode_rounded : Icons.dark_mode_rounded,
              color: isDark ? const Color(0xFFFACC15) : Colors.white,
            ),
            tooltip: isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode',
            onPressed: () => themeProvider.toggleTheme(),
          ),
          IconButton(
            icon: const Icon(Icons.logout_rounded, color: AppColors.statusDanger),
            tooltip: 'Sign Out',
            onPressed: () => _confirmLogout(context, authProvider),
          ),
        ],
      ),
      body: Stack(
        children: [
          RefreshIndicator(
            onRefresh: () => authProvider.syncAllData(),
            color: AppColors.emeraldPrimary,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
              children: [
                // 1. PROFILE HEADER (Photo Avatar with Camera Tap)
                _buildProfileHeader(driver, authProvider),
                const SizedBox(height: 14),

                // 2. COMBINED DRIVER & TRUCK DETAILS CARD (With Real Edit Action)
                _buildCombinedDriverAndTruckCard(driver, authProvider),
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

                // 5. TRUCK GALLERY ACCORDION
                _buildAccordionSection(
                  icon: Icons.photo_camera_outlined,
                  title: 'Truck Gallery',
                  count: _galleryPhotos.where((p) => p.isUploaded).length,
                  totalCount: _galleryPhotos.length,
                  isExpanded: _isTruckGalleryExpanded,
                  onToggle: () => setState(() => _isTruckGalleryExpanded = !_isTruckGalleryExpanded),
                  child: _buildTruckGalleryGrid(),
                ),
              ],
            ),
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
                        'Updating profile photo...',
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
  Widget _buildProfileHeader(DriverModel? driver, AuthProvider auth) {
    final photoUrl = driver?.profilePhotoUrl;
    final initials = (driver?.name.isNotEmpty == true)
        ? driver!.name.trim().split(' ').map((e) => e.isNotEmpty ? e[0] : '').take(2).join('').toUpperCase()
        : 'DR';

    Uint8List? decodedBytes;
    if (photoUrl != null && photoUrl.startsWith('data:image')) {
      try {
        decodedBytes = base64Decode(photoUrl.replaceFirst(RegExp(r'data:image\/[a-zA-Z+]+;base64,'), ''));
      } catch (_) {}
    }

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
          // Driver Photo Avatar with Camera Button
          GestureDetector(
            onTap: () => _openChangeProfilePhotoSheet(auth),
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 68,
                  height: 68,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [AppColors.emeraldPrimary, Color(0xFF059669)],
                    ),
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.emeraldPrimary.withValues(alpha: 0.5), width: 2.5),
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.emeraldPrimary.withValues(alpha: 0.25),
                        blurRadius: 10,
                        offset: const Offset(0, 3),
                      ),
                    ],
                  ),
                  child: ClipOval(
                    child: decodedBytes != null
                        ? Image.memory(decodedBytes, width: 68, height: 68, fit: BoxFit.cover)
                        : (photoUrl != null && photoUrl.startsWith('http')
                            ? Image.network(photoUrl, width: 68, height: 68, fit: BoxFit.cover, errorBuilder: (_, __, ___) => _buildInitialsAvatar(initials))
                            : _buildInitialsAvatar(initials)),
                  ),
                ),
                Positioned(
                  bottom: -2,
                  right: -2,
                  child: Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: AppColors.emeraldPrimary,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 2),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.2),
                          blurRadius: 4,
                          offset: const Offset(0, 1),
                        ),
                      ],
                    ),
                    child: const Icon(Icons.camera_alt_rounded, color: Colors.white, size: 14),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 16),

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
                        driver?.name ?? 'Assigned Driver',
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
                      child: Text(
                        driver?.status ?? 'Active',
                        style: const TextStyle(color: AppColors.emeraldDark, fontSize: 10, fontWeight: FontWeight.w800),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
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
                        driver?.email ?? 'driver@haulbox.com',
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

  Widget _buildInitialsAvatar(String initials) {
    return Center(
      child: Text(
        initials,
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w900,
          fontSize: 22,
          letterSpacing: -0.5,
        ),
      ),
    );
  }

  // 2. COMBINED DRIVER & TRUCK DETAILS CARD (With Edit Modal Trigger)
  Widget _buildCombinedDriverAndTruckCard(DriverModel? driver, AuthProvider auth) {
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
          // Main Card Header with Edit Button
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.badge_outlined, color: AppColors.emeraldDark, size: 18),
                  SizedBox(width: 8),
                  Text(
                    'DRIVER & TRUCK DETAILS',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w900,
                      color: AppColors.emeraldDark,
                      letterSpacing: 0.6,
                    ),
                  ),
                ],
              ),
              InkWell(
                onTap: () => _openEditDriverDetailsModal(context, auth),
                borderRadius: BorderRadius.circular(8),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.emeraldSoft,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.emeraldPrimary.withValues(alpha: 0.2)),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.edit_outlined, size: 13, color: AppColors.emeraldDark),
                      SizedBox(width: 4),
                      Text('EDIT', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: AppColors.emeraldDark)),
                    ],
                  ),
                ),
              ),
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
          _buildInfoRow('Name', driver?.name ?? 'Assigned Driver'),
          _buildInfoRow('Phone', driver?.phone ?? '(214) 555-0123'),
          _buildInfoRow('Email', driver?.email ?? 'driver@haulbox.com'),
          _buildInfoRow('CDL Number', driver?.cdlNumber ?? 'CDL12345678'),
          _buildInfoRow('CDL Expires', driver?.cdlExpiration ?? 'Dec 15, 2026'),
          _buildInfoRow('Address', driver?.address ?? '123 Logistics Way, Dallas, TX'),

          const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Divider(color: AppColors.borderLight, height: 1),
          ),

          // TRUCK DETAILS SECTION
          const Text(
            'TRUCK DETAILS',
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
              color: AppColors.textSubtle,
              letterSpacing: 0.6,
            ),
          ),
          const SizedBox(height: 8),
          _buildInfoRow('Assigned Truck', driver?.truck ?? 'Unit #104'),
          _buildInfoRow('Company / Carrier', driver?.company ?? 'HaulBoX Logistics'),
          _buildInfoRow('Status', driver?.status ?? 'Active'),
        ],
      ),
    );
  }

  // Accordion Header Section
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
        borderRadius: AppRadius.xlBorder,
        border: Border.all(color: AppColors.borderLight),
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
            borderRadius: isExpanded ? const BorderRadius.vertical(top: Radius.circular(16)) : AppRadius.xlBorder,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 15),
              child: Row(
                children: [
                  Icon(icon, size: 20, color: AppColors.emeraldDark),
                  const SizedBox(width: 10),
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textDark,
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
                      totalCount != null ? '$count/$totalCount' : '$count Docs',
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ),
                  const Spacer(),
                  Icon(
                    isExpanded ? Icons.keyboard_arrow_up_rounded : Icons.keyboard_arrow_down_rounded,
                    color: AppColors.textMuted,
                    size: 24,
                  ),
                ],
              ),
            ),
          ),
          if (isExpanded) ...[
            const Divider(color: AppColors.borderLight, height: 1),
            Padding(
              padding: const EdgeInsets.all(16),
              child: child,
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildDriverDocTile(DriverDocument doc) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(12),
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
                color: AppColors.emeraldSoft,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.description_outlined, color: AppColors.emeraldDark, size: 18),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    doc.title,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: AppColors.textDark),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Exp: ${doc.expirationDate}',
                    style: const TextStyle(fontSize: 11.5, color: AppColors.textMuted),
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
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(12),
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
                color: const Color(0xFFE0F2FE),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.local_shipping_outlined, color: Color(0xFF0284C7), size: 18),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    doc.title,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: AppColors.textDark),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Exp: ${doc.expirationDate}',
                    style: const TextStyle(fontSize: 11.5, color: AppColors.textMuted),
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

  Widget _buildTruckGalleryGrid() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 4),
          child: Text(
            '8 Equipment & Trailer Inspection Photo Slots',
            style: TextStyle(color: AppColors.textMuted, fontSize: 12, fontWeight: FontWeight.w600),
          ),
        ),
        const SizedBox(height: 8),
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
          const SizedBox(width: 8),
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
