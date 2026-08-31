import 'dart:async';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/network/api_client.dart';
import '../../core/services/location_service.dart';
import '../../core/services/socket_service.dart';
import '../../shared/models/driver_model.dart';
import '../../shared/models/load_model.dart';
import '../../shared/models/payment_model.dart';

class AuthProvider extends ChangeNotifier {
  DriverModel? _driver;
  String? _token;
  String _companyName = 'HaulBoX';
  List<LoadModel> _loads = [];
  List<PaymentModel> _payments = [];
  bool _isLoading = false;
  String? _errorMessage;
  int _unreadNotifications = 0;
  int _unreadChats = 0;

  Timer? _autoSyncTimer;
  Timer? _socketDebounceTimer;
  StreamSubscription? _docApprovedSub;
  StreamSubscription? _docRejectedSub;
  StreamSubscription? _loadUpdatedSub;

  AuthProvider() {
    _restorePersistedSession();
  }

  @override
  void dispose() {
    _autoSyncTimer?.cancel();
    _socketDebounceTimer?.cancel();
    _docApprovedSub?.cancel();
    _docRejectedSub?.cancel();
    _loadUpdatedSub?.cancel();
    super.dispose();
  }

  /// Debounced sync — waits 1.5s before firing to avoid rapid repeated syncs
  void _debouncedSync() {
    _socketDebounceTimer?.cancel();
    _socketDebounceTimer = Timer(const Duration(milliseconds: 1500), () {
      if (isAuthenticated) syncAllData(silent: true);
    });
  }

  void _initSocketListeners() {
    _docApprovedSub?.cancel();
    _docRejectedSub?.cancel();
    _loadUpdatedSub?.cancel();

    if (_driver != null) {
      SocketService().connect(driverId: _driver!.id, driverName: _driver!.name);

      _docApprovedSub = SocketService().docApprovedStream.listen((data) {
        debugPrint('[AuthProvider] Real-time document:approved received -> debounced sync');
        _debouncedSync();
      });

      _docRejectedSub = SocketService().docRejectedStream.listen((data) {
        debugPrint('[AuthProvider] Real-time document:rejected received -> debounced sync');
        _debouncedSync();
      });

      _loadUpdatedSub = SocketService().loadUpdatedStream.listen((data) {
        debugPrint('[AuthProvider] Real-time load:updated received -> debounced sync');
        _debouncedSync();
      });
    }
  }

  // 1. Session Restoration on App Launch
  Future<void> _restorePersistedSession() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedToken = prefs.getString('token');
      final savedDriverId = prefs.getString('driverId');
      final savedDriverName = prefs.getString('driverName');
      final savedTruck = prefs.getString('driverTruck');
      final savedPhone = prefs.getString('driverPhone');
      final savedEmail = prefs.getString('driverEmail');
      final savedCdl = prefs.getString('driverCdl');
      final savedCdlExp = prefs.getString('driverCdlExp');
      final savedAddress = prefs.getString('driverAddress');
      final savedServerUrl = prefs.getString('serverUrl');

      if (savedServerUrl != null && savedServerUrl.isNotEmpty) {
        ApiClient.setBaseUrl(savedServerUrl);
      }

      if (savedToken != null && savedToken.isNotEmpty && savedDriverId != null) {
        _token = savedToken;
        _driver = DriverModel(
          id: savedDriverId,
          name: savedDriverName ?? 'Driver',
          truck: savedTruck,
          phone: savedPhone,
          email: savedEmail,
          cdlNumber: savedCdl,
          cdlExpiration: savedCdlExp,
          address: savedAddress,
          status: 'ACTIVE',
        );

        notifyListeners();
        _initSocketListeners();

        // Immediately perform full live sync from database
        await syncAllData();
        _startAutoSync();
      }
    } catch (e) {
      debugPrint('Session restore error: $e');
    }
  }

  // 2. Start Automatic Background Polling (Every 30 seconds — socket handles real-time updates)
  void _startAutoSync() {
    _autoSyncTimer?.cancel();
    _autoSyncTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (isAuthenticated) {
        syncAllData(silent: true);
      }
    });
  }

  // Getters
  DriverModel? get driver => _driver;
  String? get token => _token;
  String get companyName => _companyName;
  List<LoadModel> get loads => _loads;
  List<PaymentModel> get payments => _payments;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  bool get isAuthenticated => _token != null && _driver != null;
  int get unreadNotifications => _unreadNotifications;
  int get unreadChats => _unreadChats;

  // Active / Current Run: First load that is not delivered or completed
  LoadModel? get currentLoad {
    if (_loads.isEmpty) return null;
    final active = _loads.where((l) {
      final st = l.status.toUpperCase();
      final prog = l.driverProgress.toUpperCase();
      return st != 'DELIVERED' &&
          st != 'COMPLETED' &&
          st != 'CANCELLED' &&
          prog != 'COMPLETED' &&
          prog != 'DELIVERED';
    }).toList();

    if (active.isNotEmpty) return active.first;
    return _loads.first;
  }

  bool _isSyncing = false;

  // 3. Full Live Synchronization (Master Source of Truth)
  Future<void> syncAllData({bool silent = false}) async {
    if (_token == null || _isSyncing) return;
    _isSyncing = true;
    if (!silent) {
      _isLoading = true;
      notifyListeners();
    }

    try {
      final syncData = await ApiClient.fetchSync(_token!);
      if (syncData != null) {
        if (syncData['driver'] is DriverModel) {
          _driver = syncData['driver'] as DriverModel;
          _persistDriverLocally(_driver!);
        }
        if (syncData['loads'] is List<LoadModel>) {
          _loads = syncData['loads'] as List<LoadModel>;
        }
        if (syncData['payments'] is List<PaymentModel>) {
          _payments = syncData['payments'] as List<PaymentModel>;
        }
        _unreadChats = syncData['unreadChats'] ?? 0;
        _unreadNotifications = syncData['unreadNotifications'] ?? 0;
        if (syncData['companyName'] != null) {
          _companyName = syncData['companyName'].toString();
        }
        _errorMessage = null;

        // Auto-start GPS tracking on active load
        final curLoad = currentLoad;
        if (curLoad != null && _token != null && !LocationService().isTracking) {
          LocationService().startTripTracking(loadId: curLoad.id, token: _token!);
        }
      } else {
        // Fallback individual refreshes if sync endpoint is unavailable
        await refreshLoads(silent: true);
        await refreshPayments(silent: true);
        await refreshProfile(silent: true);
      }
    } catch (e) {
      debugPrint('Sync error: $e');
    } finally {
      _isSyncing = false;
      if (!silent) {
        _isLoading = false;
      }
      notifyListeners();
    }
  }

  // 4. Refresh Loads
  Future<void> refreshLoads({bool silent = false}) async {
    if (_token == null) return;
    if (!silent) {
      _isLoading = true;
      notifyListeners();
    }
    try {
      final freshLoads = await ApiClient.fetchLoads(_token!);
      _loads = freshLoads;
    } catch (e) {
      debugPrint('Error fetching loads: $e');
    } finally {
      if (!silent) {
        _isLoading = false;
      }
      notifyListeners();
    }
  }

  // 5. Refresh Payments
  Future<void> refreshPayments({bool silent = false}) async {
    if (_token == null) return;
    try {
      final freshPayments = await ApiClient.fetchPayments(_token!);
      _payments = freshPayments;
      notifyListeners();
    } catch (e) {
      debugPrint('Error fetching payments: $e');
    }
  }

  // 6. Refresh Driver Profile
  Future<void> refreshProfile({bool silent = false}) async {
    if (_token == null) return;
    try {
      final profile = await ApiClient.fetchDriverProfile(_token!);
      if (profile != null) {
        _driver = profile;
        _persistDriverLocally(profile);
        notifyListeners();
      }
    } catch (_) {}
  }

  // 7. Login
  Future<bool> login(String driverId, String pin) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final result = await ApiClient.login(driverId, pin);
      if (result['success'] == true) {
        _token = result['token'];
        _driver = result['driver'];
        _loads = result['loads'] ?? [];
        _companyName = result['companyName'] ?? 'HaulBoX';

        final prefs = await SharedPreferences.getInstance();
        if (_token != null) await prefs.setString('token', _token!);
        if (_driver != null) {
          await _persistDriverLocally(_driver!);
        }

        _startAutoSync();
        _initSocketListeners();
        // Trigger immediate background sync for payments and docs
        syncAllData(silent: true);

        _isLoading = false;
        notifyListeners();
        return true;
      } else {
        _errorMessage = result['error'] ?? 'Login failed. Please check Driver ID and PIN.';
        _isLoading = false;
        notifyListeners();
        return false;
      }
    } catch (e) {
      _errorMessage = 'Connection error: $e';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  Future<void> _persistDriverLocally(DriverModel d) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('driverId', d.id);
      await prefs.setString('driverName', d.name);
      if (d.truck != null) await prefs.setString('driverTruck', d.truck!);
      if (d.phone != null) await prefs.setString('driverPhone', d.phone!);
      if (d.email != null) await prefs.setString('driverEmail', d.email!);
      if (d.cdlNumber != null) await prefs.setString('driverCdl', d.cdlNumber!);
      if (d.cdlExpiration != null) await prefs.setString('driverCdlExp', d.cdlExpiration!);
      if (d.address != null) await prefs.setString('driverAddress', d.address!);
    } catch (_) {}
  }

  // 8. Update Load Workflow Checkpoint
  Future<bool> updateLoadProgress(String loadId, String checkpoint,
      {String? manualEta, String? note}) async {
    if (_token != null) {
      final ok = await ApiClient.updateLoadProgress(_token!, loadId, checkpoint,
          manualEta: manualEta, note: note);
      if (ok) {
        // Optimistically update local state & sync
        final idx = _loads.indexWhere((l) => l.id == loadId);
        if (idx != -1) {
          _loads[idx] = _loads[idx].copyWith(
            driverProgress: checkpoint,
            status: checkpoint == 'COMPLETED' ? 'COMPLETED' : 'IN TRANSIT',
          );
          notifyListeners();
        }
        syncAllData(silent: true);
        return true;
      }
    }
    return false;
  }

  // 9. Document Upload
  Future<bool> uploadDocument(String loadId, String docType, String fileName,
      String base64Data) async {
    if (_token == null) return false;
    final ok = await ApiClient.uploadLoadDocument(
        _token!, loadId, docType, fileName, base64Data);
    if (ok) {
      await syncAllData(silent: true);
      return true;
    }
    return false;
  }

  // 10. Accept / Confirm Payment
  Future<bool> acceptPayment(String loadId) async {
    if (_token == null) return false;
    final ok = await ApiClient.acceptPayment(_token!, loadId);
    if (ok) {
      await syncAllData(silent: true);
      return true;
    }
    return false;
  }

  void completeCurrentLoad(String loadId) {
    updateLoadProgress(loadId, 'COMPLETED');
  }

  void addNoteToLoad(String loadId, String note) {
    final idx = _loads.indexWhere((l) => l.id == loadId);
    if (idx != -1) {
      final currentNotes = _loads[idx].notes;
      final updated = currentNotes != null && currentNotes.isNotEmpty
          ? '$currentNotes\n• $note'
          : note;
      _loads[idx] = _loads[idx].copyWith(notes: updated);
      notifyListeners();
    }
  }

  // 11. Update Driver Profile Details & Photo
  Future<bool> updateDriverProfile({
    String? name,
    String? phone,
    String? email,
    String? address,
    String? profilePhotoUrl,
    String? truck,
  }) async {
    if (_token == null) return false;
    _isLoading = true;
    notifyListeners();

    try {
      final res = await ApiClient.updateProfile(
        _token!,
        name: name,
        phone: phone,
        email: email,
        address: address,
        profilePhotoUrl: profilePhotoUrl,
        truck: truck,
      );

      if (res != null && res['ok'] == true) {
        if (res['driver'] != null) {
          _driver = DriverModel.fromJson(res['driver']);
          _persistDriverLocally(_driver!);
        } else {
          _driver = _driver?.copyWith(
            name: name,
            phone: phone,
            email: email,
            address: address,
            profilePhotoUrl: profilePhotoUrl,
            truck: truck,
          );
        }
        _isLoading = false;
        notifyListeners();
        return true;
      }
    } catch (e) {
      debugPrint('updateDriverProfile error: $e');
    }

    _isLoading = false;
    notifyListeners();
    return false;
  }

  Future<void> updateProfilePhoto(String photoBase64OrUrl) async {
    if (_token != null) {
      await updateDriverProfile(profilePhotoUrl: photoBase64OrUrl);
    } else {
      _driver = _driver?.copyWith(profilePhotoUrl: photoBase64OrUrl);
      notifyListeners();
    }
  }

  Future<void> removeProfilePhoto() async {
    if (_token != null) {
      await updateDriverProfile(profilePhotoUrl: '');
    }
    _driver = _driver?.copyWith(clearPhoto: true);
    notifyListeners();
  }

  // 11. Logout (Only on explicit driver action)
  Future<void> logout() async {
    _autoSyncTimer?.cancel();
    _token = null;
    _driver = null;
    _loads = [];
    _payments = [];
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('token');
      await prefs.remove('driverId');
      await prefs.remove('driverName');
      await prefs.remove('driverTruck');
      await prefs.remove('driverPhone');
      await prefs.remove('driverEmail');
      await prefs.remove('driverCdl');
      await prefs.remove('driverCdlExp');
      await prefs.remove('driverAddress');
      await prefs.remove('last_selected_tab_idx');
    } catch (_) {}
    notifyListeners();
  }
}
