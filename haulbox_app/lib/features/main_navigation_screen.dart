import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../shared/widgets/haulbox_bottom_navigation.dart';
import 'auth/auth_provider.dart';
import 'chat/chat_provider.dart';
import 'chat/chat_screen.dart';
import 'current_load/current_load_screen.dart';
import 'loads/loads_screen.dart';
import 'payments/payments_screen.dart';
import 'profile/profile_screen.dart';

class MainNavigationScreen extends StatefulWidget {
  const MainNavigationScreen({super.key});

  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen>
    with WidgetsBindingObserver {
  // Index 2 is the Center 'Current Load' primary action (default)
  int _currentIndex = 2;

  late final List<Widget> _screens;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _restoreLastTab();
    _screens = [
      const LoadsScreen(),
      const PaymentsScreen(),
      CurrentLoadScreen(onNavigateTab: (idx) => _switchTab(idx)),
      const ChatScreen(),
      const ProfileScreen(),
    ];
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      // Trigger background sync on app resume
      if (mounted) {
        Provider.of<AuthProvider>(context, listen: false).syncAllData(silent: true);
        Provider.of<ChatProvider>(context, listen: false).syncLiveChats();
      }
    }
  }

  Future<void> _restoreLastTab() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedIdx = prefs.getInt('last_selected_tab_idx');
      if (savedIdx != null && savedIdx >= 0 && savedIdx < 5) {
        if (mounted) {
          setState(() {
            _currentIndex = savedIdx;
          });
        }
      }
    } catch (_) {}
  }

  Future<void> _switchTab(int index) async {
    setState(() {
      _currentIndex = index;
    });
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setInt('last_selected_tab_idx', index);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: _screens,
      ),
      bottomNavigationBar: HaulBoxBottomNavigation(
        currentIndex: _currentIndex,
        onTap: _switchTab,
      ),
    );
  }
}

