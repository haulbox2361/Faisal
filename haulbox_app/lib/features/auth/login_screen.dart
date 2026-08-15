import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../core/network/api_client.dart';
import '../../shared/widgets/haulbox_button.dart';
import 'auth_provider.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _driverIdController = TextEditingController(text: 'D101');
  final _pinController = TextEditingController(text: '1234');
  final _serverUrlController = TextEditingController(text: ApiClient.baseUrl);
  bool _showServerConfig = false;
  bool _obscurePin = true;

  @override
  void dispose() {
    _driverIdController.dispose();
    _pinController.dispose();
    _serverUrlController.dispose();
    super.dispose();
  }

  void _handleLogin() async {
    if (_showServerConfig && _serverUrlController.text.trim().isNotEmpty) {
      ApiClient.setBaseUrl(_serverUrlController.text.trim());
    }

    final driverId = _driverIdController.text.trim();
    final pin = _pinController.text.trim();

    if (driverId.isEmpty || pin.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter your Driver ID and Security PIN'),
          backgroundColor: AppColors.statusDanger,
        ),
      );
      return;
    }

    final authProvider = Provider.of<AuthProvider>(context, listen: false);
    final success = await authProvider.login(driverId, pin);

    if (!mounted) return;

    if (!success && authProvider.errorMessage != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(authProvider.errorMessage!),
          backgroundColor: AppColors.statusDanger,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              Color(0xFF0B0F17),
              Color(0xFF121824),
              Color(0xFF0F172A),
            ],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // HaulBoX Brand Icon
                  Center(
                    child: Container(
                      width: 72,
                      height: 72,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [AppColors.emeraldPrimary, Color(0xFF059669)],
                        ),
                        borderRadius: BorderRadius.circular(22),
                        boxShadow: [
                          BoxShadow(
                            color: AppColors.emeraldPrimary.withValues(alpha: 0.35),
                            blurRadius: 20,
                            offset: const Offset(0, 8),
                          ),
                        ],
                      ),
                      child: const Center(
                        child: Icon(
                          Icons.local_shipping_rounded,
                          size: 38,
                          color: Color(0xFF06251A),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Brand Title
                  const Text(
                    'HAULBOX',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 1.5,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Professional Driver Dispatch & Logistics Portal',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 13,
                      color: AppColors.textMuted,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 36),

                  // Login Card
                  Container(
                    decoration: BoxDecoration(
                      color: AppColors.cardDark,
                      borderRadius: AppRadius.xlBorder,
                      border: Border.all(color: AppColors.borderDark),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.3),
                          blurRadius: 24,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text(
                          'Driver Sign In',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Enter your Driver Code and PIN to access your runs',
                          style: TextStyle(fontSize: 12.5, color: AppColors.textMuted),
                        ),
                        const SizedBox(height: 20),

                        // Driver ID Field
                        TextField(
                          controller: _driverIdController,
                          decoration: const InputDecoration(
                            labelText: 'Driver ID or Code',
                            hintText: 'e.g. D101',
                            prefixIcon: Icon(Icons.badge_outlined, color: AppColors.textMuted, size: 20),
                          ),
                        ),
                        const SizedBox(height: 16),

                        // PIN Field
                        TextField(
                          controller: _pinController,
                          obscureText: _obscurePin,
                          keyboardType: TextInputType.number,
                          decoration: InputDecoration(
                            labelText: 'Security PIN',
                            hintText: '4-digit PIN',
                            prefixIcon: const Icon(Icons.lock_outline_rounded, color: AppColors.textMuted, size: 20),
                            suffixIcon: IconButton(
                              icon: Icon(
                                _obscurePin ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                                color: AppColors.textMuted,
                                size: 20,
                              ),
                              onPressed: () {
                                setState(() {
                                  _obscurePin = !_obscurePin;
                                });
                              },
                            ),
                          ),
                        ),
                        const SizedBox(height: 24),

                        // Sign In Button
                        HaulBoxButton(
                          text: 'Connect & Sign In',
                          isLoading: authProvider.isLoading,
                          icon: Icons.arrow_forward_rounded,
                          onPressed: _handleLogin,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Backend Server Settings Link
                  Center(
                    child: TextButton.icon(
                      onPressed: () {
                        setState(() {
                          _showServerConfig = !_showServerConfig;
                        });
                      },
                      icon: Icon(
                        _showServerConfig ? Icons.expand_less : Icons.settings_outlined,
                        size: 15,
                        color: AppColors.textSubtle,
                      ),
                      label: Text(
                        _showServerConfig ? 'Hide Server Configuration' : 'Server Connection Settings',
                        style: const TextStyle(fontSize: 12, color: AppColors.textSubtle),
                      ),
                    ),
                  ),

                  if (_showServerConfig) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceDark,
                        borderRadius: AppRadius.mdBorder,
                        border: Border.all(color: AppColors.borderDark),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Backend Server URL:',
                            style: TextStyle(fontSize: 11, color: AppColors.textMuted),
                          ),
                          const SizedBox(height: 6),
                          TextField(
                            controller: _serverUrlController,
                            style: const TextStyle(fontSize: 13),
                            decoration: const InputDecoration(
                              isDense: true,
                              contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
