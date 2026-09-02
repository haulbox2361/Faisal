import 'package:flutter/material.dart';
import '../../core/network/api_client.dart';

class OwnerProvider extends ChangeNotifier {
  String? _token;

  // Summary State
  Map<String, dynamic>? _summary;
  bool _isLoadingSummary = false;
  String _selectedPeriod = 'all';

  // Payments State
  List<dynamic> _paymentDrivers = [];
  bool _isLoadingPayments = false;
  String _selectedPaymentFilter = 'all';
  String _paymentsSearchQuery = '';

  // Loads State
  List<dynamic> _loads = [];
  bool _isLoadingLoads = false;
  String _selectedLoadStatus = 'ALL';
  String _loadsSearchQuery = '';

  // Reports State
  Map<String, dynamic>? _reports;
  bool _isLoadingReports = false;
  String _selectedReportPeriod = 'this_month';

  // Analytics State
  Map<String, dynamic>? _analytics;
  bool _isLoadingAnalytics = false;
  String _selectedAnalyticsRange = '30d';

  // Getters
  Map<String, dynamic>? get summary => _summary;
  bool get isLoadingSummary => _isLoadingSummary;
  String get selectedPeriod => _selectedPeriod;

  List<dynamic> get paymentDrivers => _paymentDrivers;
  bool get isLoadingPayments => _isLoadingPayments;
  String get selectedPaymentFilter => _selectedPaymentFilter;
  String get paymentsSearchQuery => _paymentsSearchQuery;

  List<dynamic> get loads => _loads;
  bool get isLoadingLoads => _isLoadingLoads;
  String get selectedLoadStatus => _selectedLoadStatus;
  String get loadsSearchQuery => _loadsSearchQuery;

  Map<String, dynamic>? get reports => _reports;
  bool get isLoadingReports => _isLoadingReports;
  String get selectedReportPeriod => _selectedReportPeriod;

  Map<String, dynamic>? get analytics => _analytics;
  bool get isLoadingAnalytics => _isLoadingAnalytics;
  String get selectedAnalyticsRange => _selectedAnalyticsRange;

  void setToken(String token) {
    _token = token;
  }

  // 1. Refresh Home Summary
  Future<void> refreshSummary({String? period}) async {
    if (_token == null) return;
    if (period != null) _selectedPeriod = period;
    _isLoadingSummary = true;
    notifyListeners();

    try {
      final res = await ApiClient.fetchOwnerSummary(_token!, period: _selectedPeriod);
      if (res != null && res['ok'] == true) {
        _summary = res;
      }
    } catch (e) {
      debugPrint('Error fetching owner summary: $e');
    } finally {
      _isLoadingSummary = false;
      notifyListeners();
    }
  }

  // 2. Refresh Payments
  Future<void> refreshPayments({String? filter, String? search}) async {
    if (_token == null) return;
    if (filter != null) _selectedPaymentFilter = filter;
    if (search != null) _paymentsSearchQuery = search;
    _isLoadingPayments = true;
    notifyListeners();

    try {
      final res = await ApiClient.fetchOwnerPayments(
        _token!,
        filter: _selectedPaymentFilter,
        search: _paymentsSearchQuery,
      );
      if (res != null && res['ok'] == true) {
        _paymentDrivers = res['drivers'] as List<dynamic>? ?? [];
      }
    } catch (e) {
      debugPrint('Error fetching owner payments: $e');
    } finally {
      _isLoadingPayments = false;
      notifyListeners();
    }
  }

  // 3. Mark Payment as Paid
  Future<Map<String, dynamic>> markPaymentAsPaid(String loadId) async {
    if (_token == null) return {'success': false, 'error': 'Not authenticated'};
    final result = await ApiClient.markPaymentPaid(_token!, loadId);
    if (result['success'] == true) {
      // Refresh payments and summary data
      refreshPayments();
      refreshSummary();
    }
    return result;
  }

  // 4. Refresh Loads List
  Future<void> refreshLoads({String? status, String? search}) async {
    if (_token == null) return;
    if (status != null) _selectedLoadStatus = status;
    if (search != null) _loadsSearchQuery = search;
    _isLoadingLoads = true;
    notifyListeners();

    try {
      final res = await ApiClient.fetchOwnerLoads(
        _token!,
        status: _selectedLoadStatus,
        search: _loadsSearchQuery,
      );
      if (res != null && res['ok'] == true) {
        _loads = res['loads'] as List<dynamic>? ?? [];
      }
    } catch (e) {
      debugPrint('Error fetching owner loads: $e');
    } finally {
      _isLoadingLoads = false;
      notifyListeners();
    }
  }

  // 5. Refresh Reports
  Future<void> refreshReports({String? period}) async {
    if (_token == null) return;
    if (period != null) _selectedReportPeriod = period;
    _isLoadingReports = true;
    notifyListeners();

    try {
      final res = await ApiClient.fetchOwnerReports(_token!, period: _selectedReportPeriod);
      if (res != null && res['ok'] == true) {
        _reports = res;
      }
    } catch (e) {
      debugPrint('Error fetching owner reports: $e');
    } finally {
      _isLoadingReports = false;
      notifyListeners();
    }
  }

  // 6. Refresh Analytics
  Future<void> refreshAnalytics({String? range}) async {
    if (_token == null) return;
    if (range != null) _selectedAnalyticsRange = range;
    _isLoadingAnalytics = true;
    notifyListeners();

    try {
      final res = await ApiClient.fetchOwnerAnalytics(_token!, range: _selectedAnalyticsRange);
      if (res != null && res['ok'] == true) {
        _analytics = res;
      }
    } catch (e) {
      debugPrint('Error fetching owner analytics: $e');
    } finally {
      _isLoadingAnalytics = false;
      notifyListeners();
    }
  }

  // Full Refresh All Owner Views
  Future<void> syncAllOwnerData() async {
    await Future.wait([
      refreshSummary(),
      refreshPayments(),
      refreshLoads(),
      refreshReports(),
      refreshAnalytics(),
    ]);
  }
}
