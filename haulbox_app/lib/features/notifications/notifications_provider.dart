import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/network/api_client.dart';
import '../../core/services/socket_service.dart';

class NotificationsProvider extends ChangeNotifier {
  List<Map<String, dynamic>> _notifications = [];
  bool _isLoading = false;
  String? _errorMessage;
  StreamSubscription? _socketSub;

  // Real-time Heads-up Banner triggering
  Map<String, dynamic>? _activeBannerNotification;

  NotificationsProvider() {
    _initSocketListener();
  }

  @override
  void dispose() {
    _socketSub?.cancel();
    super.dispose();
  }

  // Getters
  List<Map<String, dynamic>> get notifications => _notifications;
  List<Map<String, dynamic>> get unreadNotifications =>
      _notifications.where((n) => n['read'] != true).toList();
  int get unreadCount =>
      _notifications.where((n) => n['read'] != true).length;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  Map<String, dynamic>? get activeBannerNotification => _activeBannerNotification;

  void dismissBanner() {
    _activeBannerNotification = null;
    notifyListeners();
  }

  // 1. Socket Listener for Real-Time Push In-App Delivery
  void _initSocketListener() {
    _socketSub?.cancel();
    _socketSub = SocketService().notificationStream.listen((data) {
      debugPrint('[NotificationsProvider] Received real-time push: $data');
      _handleIncomingPush(data);
    });
  }

  void _handleIncomingPush(Map<String, dynamic> raw) {
    final notif = Map<String, dynamic>.from(raw);

    // Format fields if needed
    notif['id'] = notif['id'] ?? 'notif_${DateTime.now().millisecondsSinceEpoch}';
    notif['title'] = notif['title'] ?? 'HaulBoX Notification';
    notif['body'] = notif['body'] ?? '';
    notif['type'] = notif['type'] ?? 'general';
    notif['read'] = false;
    notif['createdAt'] = notif['createdAt'] ?? DateTime.now().toIso8601String();

    // Prevent duplicate entries
    _notifications.removeWhere((item) => item['id'] == notif['id']);
    _notifications.insert(0, notif);

    // Trigger in-app heads-up banner & light haptic pulse
    try {
      HapticFeedback.lightImpact();
    } catch (_) {}

    _activeBannerNotification = notif;
    notifyListeners();
  }

  // 2. Fetch Notifications from Server
  Future<void> loadNotifications(String? token, {bool silent = false}) async {
    if (token == null || token.isEmpty) return;

    if (!silent) {
      _isLoading = true;
      _errorMessage = null;
      notifyListeners();
    }

    try {
      final list = await ApiClient.fetchNotifications(token);
      _notifications = list;
      _errorMessage = null;
    } catch (e) {
      _errorMessage = 'Failed to load notifications: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // 3. Mark Single Notification as Read
  Future<void> markAsRead(String? token, dynamic id) async {
    if (id == null) return;

    // Optimistic local update
    final index = _notifications.indexWhere((n) => n['id'] == id);
    if (index != -1) {
      _notifications[index]['read'] = true;
      notifyListeners();
    }

    if (token != null && token.isNotEmpty) {
      ApiClient.markNotificationRead(token, id);
    }
  }

  // 4. Mark All Notifications as Read
  Future<void> markAllAsRead(String? token) async {
    for (var n in _notifications) {
      n['read'] = true;
    }
    notifyListeners();

    if (token != null && token.isNotEmpty) {
      ApiClient.markAllNotificationsRead(token);
    }
  }

  // 5. Clear All Notifications
  Future<void> clearAll(String? token) async {
    _notifications.clear();
    notifyListeners();

    if (token != null && token.isNotEmpty) {
      ApiClient.clearAllNotifications(token);
    }
  }

  // 6. Device Push Token Registration
  Future<void> registerDeviceToken(String? token, String pushToken, {String platform = 'android'}) async {
    if (token == null || token.isEmpty || pushToken.isEmpty) return;
    try {
      await ApiClient.registerPushToken(token, pushToken, platform: platform);
      debugPrint('[NotificationsProvider] Device push token registered successfully.');
    } catch (e) {
      debugPrint('[NotificationsProvider] Failed to register push token: $e');
    }
  }
}
