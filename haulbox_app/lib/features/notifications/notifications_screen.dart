import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../auth/auth_provider.dart';
import 'notifications_provider.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      Provider.of<NotificationsProvider>(context, listen: false)
          .loadNotifications(auth.token, silent: false);
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  String _formatTimestamp(dynamic rawDate) {
    if (rawDate == null) return 'Recent';
    try {
      final date = DateTime.parse(rawDate.toString()).toLocal();
      final now = DateTime.now();
      final diff = now.difference(date);

      if (diff.inSeconds < 60) return 'Just now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      if (diff.inDays == 1) return 'Yesterday';
      if (diff.inDays < 7) return '${diff.inDays}d ago';
      return DateFormat('MMM d, h:mm a').format(date);
    } catch (_) {
      return 'Recent';
    }
  }

  Color _getCategoryColor(String type) {
    final t = type.toLowerCase();
    if (t.contains('load')) return const Color(0xFF0284C7); // Sky Blue
    if (t.contains('pay')) return const Color(0xFF16A34A); // Emerald Green
    if (t.contains('doc') || t.contains('bol') || t.contains('pod')) {
      return const Color(0xFFD97706); // Amber
    }
    if (t.contains('chat')) return const Color(0xFF0D9488); // Teal
    return const Color(0xFF6366F1); // Indigo / Purple
  }

  IconData _getCategoryIcon(String type) {
    final t = type.toLowerCase();
    if (t.contains('load')) return Icons.local_shipping_rounded;
    if (t.contains('pay')) return Icons.payments_rounded;
    if (t.contains('doc') || t.contains('bol') || t.contains('pod')) {
      return Icons.description_rounded;
    }
    if (t.contains('chat')) return Icons.chat_bubble_rounded;
    return Icons.notifications_active_rounded;
  }

  void _onNotificationTap(Map<String, dynamic> notif) {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final notifs = Provider.of<NotificationsProvider>(context, listen: false);

    // Mark as read
    notifs.markAsRead(auth.token, notif['id']);

    final type = (notif['type'] ?? '').toString().toLowerCase();
    final data = notif['data'] is Map ? notif['data'] as Map : {};
    final screen = (data['screen'] ?? '').toString().toLowerCase();

    // Give visual feedback and close notifications view to navigate
    Navigator.pop(context);

    // Contextual routing handled by main navigation
    if (type.contains('chat') || screen == 'chat') {
      // Chat
    } else if (type.contains('pay') || screen == 'payments') {
      // Payments
    } else {
      // Load
    }
  }

  @override
  Widget build(BuildContext context) {
    final notifsProvider = Provider.of<NotificationsProvider>(context);
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final allList = notifsProvider.notifications;
    final unreadList = notifsProvider.unreadNotifications;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: Row(
          children: [
            const Text(
              'Notifications',
              style: TextStyle(
                fontSize: 19,
                fontWeight: FontWeight.w900,
                letterSpacing: -0.3,
                color: Colors.white,
              ),
            ),
            if (notifsProvider.unreadCount > 0) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.emeraldPrimary,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  '${notifsProvider.unreadCount} NEW',
                  style: const TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                    color: Colors.white,
                  ),
                ),
              ),
            ],
          ],
        ),
        actions: [
          if (allList.isNotEmpty)
            PopupMenuButton<String>(
              icon: const Icon(Icons.more_vert_rounded, color: Colors.white),
              onSelected: (val) {
                if (val == 'mark_all_read') {
                  notifsProvider.markAllAsRead(auth.token);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('All notifications marked as read'),
                      duration: Duration(seconds: 2),
                    ),
                  );
                } else if (val == 'clear_all') {
                  notifsProvider.clearAll(auth.token);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Notification history cleared'),
                      duration: Duration(seconds: 2),
                    ),
                  );
                }
              },
              itemBuilder: (ctx) => [
                const PopupMenuItem(
                  value: 'mark_all_read',
                  child: Row(
                    children: [
                      Icon(Icons.done_all_rounded, size: 18, color: Color(0xFF16A34A)),
                      SizedBox(width: 10),
                      Text('Mark all as read'),
                    ],
                  ),
                ),
                const PopupMenuItem(
                  value: 'clear_all',
                  child: Row(
                    children: [
                      Icon(Icons.delete_sweep_rounded, size: 18, color: Colors.red),
                      SizedBox(width: 10),
                      Text('Clear history'),
                    ],
                  ),
                ),
              ],
            ),
        ],
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppColors.emeraldPrimary,
          indicatorWeight: 3,
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white60,
          labelStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
          tabs: [
            Tab(text: 'ALL (${allList.length})'),
            Tab(text: 'UNREAD (${unreadList.length})'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildNotificationList(allList, isUnreadTab: false),
          _buildNotificationList(unreadList, isUnreadTab: true),
        ],
      ),
    );
  }

  Widget _buildNotificationList(List<Map<String, dynamic>> list, {required bool isUnreadTab}) {
    final notifsProvider = Provider.of<NotificationsProvider>(context);
    final auth = Provider.of<AuthProvider>(context, listen: false);

    if (notifsProvider.isLoading && list.isEmpty) {
      return const Center(
        child: CircularProgressIndicator(color: AppColors.emeraldPrimary),
      );
    }

    if (list.isEmpty) {
      return RefreshIndicator(
        onRefresh: () => notifsProvider.loadNotifications(auth.token),
        color: AppColors.emeraldPrimary,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(height: MediaQuery.of(context).size.height * 0.22),
            Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: 76,
                    height: 76,
                    decoration: BoxDecoration(
                      color: isUnreadTab
                          ? const Color(0xFF16A34A).withValues(alpha: 0.1)
                          : const Color(0xFFE2E8F0),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      isUnreadTab
                          ? Icons.check_circle_outline_rounded
                          : Icons.notifications_off_outlined,
                      size: 38,
                      color: isUnreadTab
                          ? const Color(0xFF16A34A)
                          : const Color(0xFF64748B),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    isUnreadTab ? 'All Caught Up!' : 'No Notifications Yet',
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFF0F172A),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    isUnreadTab
                        ? 'You have read all received alerts.'
                        : 'New load assignments, chat messages, and doc approvals will appear here.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 13,
                      color: Color(0xFF64748B),
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 20),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFF0F172A),
                      side: const BorderSide(color: Color(0xFFCBD5E1)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    onPressed: () => notifsProvider.loadNotifications(auth.token),
                    icon: const Icon(Icons.refresh_rounded, size: 18),
                    label: const Text('Refresh'),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => notifsProvider.loadNotifications(auth.token),
      color: AppColors.emeraldPrimary,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        itemCount: list.length,
        separatorBuilder: (_, __) => const SizedBox(height: 10),
        itemBuilder: (ctx, idx) {
          final item = list[idx];
          final isRead = item['read'] == true;
          final type = (item['type'] ?? 'general').toString();
          final categoryColor = _getCategoryColor(type);
          final categoryIcon = _getCategoryIcon(type);
          final timeStr = _formatTimestamp(item['createdAt'] ?? item['created_at']);

          return InkWell(
            onTap: () => _onNotificationTap(item),
            borderRadius: BorderRadius.circular(16),
            child: Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: isRead ? Colors.white : Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: isRead
                      ? const Color(0xFFE2E8F0)
                      : categoryColor.withValues(alpha: 0.4),
                  width: isRead ? 1 : 1.5,
                ),
                boxShadow: [
                  BoxShadow(
                    color: isRead
                        ? Colors.black.withValues(alpha: 0.02)
                        : categoryColor.withValues(alpha: 0.06),
                    blurRadius: 8,
                    offset: const Offset(0, 3),
                  ),
                ],
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Type Icon Avatar
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: categoryColor.withValues(alpha: 0.12),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(categoryIcon, color: categoryColor, size: 22),
                  ),
                  const SizedBox(width: 12),

                  // Notification Content
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                item['title'] ?? 'Notification',
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: isRead ? FontWeight.w700 : FontWeight.w900,
                                  color: const Color(0xFF0F172A),
                                  letterSpacing: -0.2,
                                ),
                              ),
                            ),
                            const SizedBox(width: 6),
                            Text(
                              timeStr,
                              style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: Color(0xFF94A3B8),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          item['body'] ?? '',
                          style: TextStyle(
                            fontSize: 12.5,
                            color: isRead ? const Color(0xFF64748B) : const Color(0xFF334155),
                            height: 1.35,
                          ),
                        ),
                      ],
                    ),
                  ),

                  // Unread Indicator Pill
                  if (!isRead) ...[
                    const SizedBox(width: 8),
                    Container(
                      margin: const EdgeInsets.only(top: 4),
                      width: 8,
                      height: 8,
                      decoration: const BoxDecoration(
                        color: Color(0xFF16A34A),
                        shape: BoxShape.circle,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
