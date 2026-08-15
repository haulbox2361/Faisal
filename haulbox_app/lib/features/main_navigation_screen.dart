import 'package:flutter/material.dart';
import '../shared/widgets/haulbox_bottom_navigation.dart';
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

class _MainNavigationScreenState extends State<MainNavigationScreen> {
  // Index 2 is the Center 'Current Load' primary action
  int _currentIndex = 2;

  late final List<Widget> _screens;

  @override
  void initState() {
    super.initState();
    _screens = [
      const LoadsScreen(),
      const PaymentsScreen(),
      CurrentLoadScreen(onNavigateTab: (idx) => setState(() => _currentIndex = idx)),
      const ChatScreen(),
      const ProfileScreen(),
    ];
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
        onTap: (index) {
          setState(() {
            _currentIndex = index;
          });
        },
      ),
    );
  }
}
