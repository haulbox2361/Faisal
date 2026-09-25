import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../notifications_provider.dart';
import '../notifications_screen.dart';

class InAppNotificationBannerHost extends StatefulWidget {
  final Widget child;

  const InAppNotificationBannerHost({super.key, required this.child});

  @override
  State<InAppNotificationBannerHost> createState() =>
      _InAppNotificationBannerHostState();
}

class _InAppNotificationBannerHostState
    extends State<InAppNotificationBannerHost>
    with SingleTickerProviderStateMixin {
  late AnimationController _animController;
  late Animation<Offset> _offsetAnimation;
  Timer? _autoDismissTimer;
  Map<String, dynamic>? _displayedNotification;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 380),
    );
    _offsetAnimation = Tween<Offset>(
      begin: const Offset(0.0, -1.2),
      end: Offset.zero,
    ).animate(CurvedAnimation(
      parent: _animController,
      curve: Curves.easeOutCubic,
      reverseCurve: Curves.easeInCubic,
    ));
  }

  @override
  void dispose() {
    _autoDismissTimer?.cancel();
    _animController.dispose();
    super.dispose();
  }

  void _showBanner(Map<String, dynamic> notification) {
    _autoDismissTimer?.cancel();
    setState(() {
      _displayedNotification = notification;
    });
    _animController.forward();

    // Auto dismiss after 5.5 seconds
    _autoDismissTimer = Timer(const Duration(milliseconds: 5500), () {
      _hideBanner();
    });
  }

  void _hideBanner() {
    if (!mounted) return;
    _animController.reverse().then((_) {
      if (mounted) {
        setState(() {
          _displayedNotification = null;
        });
        Provider.of<NotificationsProvider>(context, listen: false)
            .dismissBanner();
      }
    });
  }

  void _handleBannerTap(Map<String, dynamic> notification) {
    _hideBanner();
    final data = notification['data'] is Map ? notification['data'] as Map : {};
    final type = (notification['type'] ?? '').toString().toLowerCase();
    final screen = (data['screen'] ?? '').toString().toLowerCase();

    // Direct routing based on payload
    if (type.contains('chat') || screen == 'chat') {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => const NotificationsScreen(),
        ),
      );
    } else {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => const NotificationsScreen(),
        ),
      );
    }
  }

  Color _getBannerColor(String type) {
    final t = type.toLowerCase();
    if (t.contains('load')) return const Color(0xFF0284C7);
    if (t.contains('pay')) return const Color(0xFF16A34A);
    if (t.contains('doc') || t.contains('bol') || t.contains('pod')) {
      return const Color(0xFFD97706);
    }
    if (t.contains('chat')) return const Color(0xFF0D9488);
    return const Color(0xFF4F46E5);
  }

  IconData _getBannerIcon(String type) {
    final t = type.toLowerCase();
    if (t.contains('load')) return Icons.local_shipping_rounded;
    if (t.contains('pay')) return Icons.payments_rounded;
    if (t.contains('doc') || t.contains('bol') || t.contains('pod')) {
      return Icons.description_rounded;
    }
    if (t.contains('chat')) return Icons.chat_bubble_rounded;
    return Icons.notifications_active_rounded;
  }

  @override
  Widget build(BuildContext context) {
    final activeNotif =
        Provider.of<NotificationsProvider>(context).activeBannerNotification;

    if (activeNotif != null && activeNotif != _displayedNotification) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _showBanner(activeNotif);
      });
    }

    return Stack(
      children: [
        widget.child,
        if (_displayedNotification != null)
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              child: SlideTransition(
                position: _offsetAnimation,
                child: GestureDetector(
                  onTap: () => _handleBannerTap(_displayedNotification!),
                  onVerticalDragUpdate: (details) {
                    if (details.primaryDelta != null &&
                        details.primaryDelta! < -4) {
                      _hideBanner();
                    }
                  },
                  child: Container(
                    margin: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 8),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 16, vertical: 12),
                    decoration: BoxDecoration(
                      color: const Color(0xFF0F172A),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: _getBannerColor(
                            _displayedNotification!['type'] ?? ''),
                        width: 1.5,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.35),
                          blurRadius: 18,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 40,
                          height: 40,
                          decoration: BoxDecoration(
                            color: _getBannerColor(
                                    _displayedNotification!['type'] ?? '')
                                .withValues(alpha: 0.2),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            _getBannerIcon(
                                _displayedNotification!['type'] ?? ''),
                            color: _getBannerColor(
                                _displayedNotification!['type'] ?? ''),
                            size: 22,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      _displayedNotification!['title'] ??
                                          'HaulBoX Alert',
                                      style: const TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.w800,
                                        color: Colors.white,
                                        letterSpacing: -0.2,
                                      ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  const SizedBox(width: 6),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: Colors.white
                                          .withValues(alpha: 0.12),
                                      borderRadius:
                                          BorderRadius.circular(6),
                                    ),
                                    child: const Text(
                                      'NOW',
                                      style: TextStyle(
                                        fontSize: 9,
                                        fontWeight: FontWeight.w900,
                                        color: Colors.white70,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 3),
                              Text(
                                _displayedNotification!['body'] ?? '',
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Color(0xFF94A3B8),
                                  height: 1.3,
                                ),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        GestureDetector(
                          onTap: _hideBanner,
                          child: Container(
                            padding: const EdgeInsets.all(4),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.08),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.close_rounded,
                              size: 16,
                              color: Colors.white70,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
