import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/theme_provider.dart';
import 'features/auth/auth_provider.dart';
import 'features/auth/login_screen.dart';
import 'features/chat/chat_provider.dart';
import 'features/main_navigation_screen.dart';
import 'features/notifications/notifications_provider.dart';
import 'features/notifications/widgets/in_app_notification_banner.dart';
import 'features/owner/owner_navigation_screen.dart';
import 'features/owner/owner_provider.dart';

// Background message handler — must be top-level function
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  debugPrint('[FCM] Background message received: ${message.messageId}');
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize Firebase
  try {
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);
    debugPrint('[FCM] Firebase initialized successfully');
  } catch (e) {
    debugPrint('[FCM] Firebase init failed (non-fatal): $e');
  }

  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      systemNavigationBarColor: Colors.white,
      systemNavigationBarIconBrightness: Brightness.dark,
    ),
  );
  runApp(const HaulBoxApp());
}

class HaulBoxApp extends StatelessWidget {
  const HaulBoxApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => ThemeProvider()),
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => ChatProvider()),
        ChangeNotifierProvider(create: (_) => OwnerProvider()),
        ChangeNotifierProvider(create: (_) => NotificationsProvider()),
      ],
      child: Consumer<ThemeProvider>(
        builder: (context, themeProvider, child) {
          return MaterialApp(
            title: 'HaulBoX Driver App',
            debugShowCheckedModeBanner: false,
            theme: AppTheme.lightTheme,
            darkTheme: AppTheme.darkTheme,
            themeMode: themeProvider.themeMode,
            home: const InAppNotificationBannerHost(child: RootGate()),
          );
        },
      ),
    );
  }
}

class RootGate extends StatefulWidget {
  const RootGate({super.key});

  @override
  State<RootGate> createState() => _RootGateState();
}

class _RootGateState extends State<RootGate> {
  bool _fcmSetupDone = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _setupFcmIfLoggedIn();
  }

  Future<void> _setupFcmIfLoggedIn() async {
    if (_fcmSetupDone) return;
    final auth = Provider.of<AuthProvider>(context, listen: false);
    if (!auth.isAuthenticated || auth.token == null) return;

    _fcmSetupDone = true;

    try {
      // Request notification permission (Android 13+)
      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      debugPrint('[FCM] Permission: ${settings.authorizationStatus}');

      // Get device FCM token and register with backend
      final fcmToken = await messaging.getToken();
      if (fcmToken != null && mounted) {
        debugPrint('[FCM] Token obtained, registering with backend...');
        final notifProvider =
            Provider.of<NotificationsProvider>(context, listen: false);
        await notifProvider.registerDeviceToken(auth.token, fcmToken);
      }

      // Handle foreground messages
      FirebaseMessaging.onMessage.listen((RemoteMessage message) {
        debugPrint('[FCM] Foreground message: ${message.notification?.title}');
        // In-app banner is already handled by Socket.IO — no duplicate needed
      });

      // Token refresh
      messaging.onTokenRefresh.listen((newToken) async {
        debugPrint('[FCM] Token refreshed, re-registering...');
        if (mounted) {
          final notifProvider =
              Provider.of<NotificationsProvider>(context, listen: false);
          await notifProvider.registerDeviceToken(auth.token, newToken);
        }
      });
    } catch (e) {
      debugPrint('[FCM] Setup error (non-fatal): $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);

    // Trigger FCM setup whenever auth state changes
    if (authProvider.isAuthenticated && !_fcmSetupDone) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _setupFcmIfLoggedIn();
      });
    }

    if (authProvider.isAuthenticated) {
      if (authProvider.isOwner) {
        return const OwnerNavigationScreen();
      }
      return const MainNavigationScreen();
    } else {
      return const LoginScreen();
    }
  }
}
