import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../../shared/models/driver_model.dart';
import '../../shared/models/load_model.dart';

class ApiClient {
  static String baseUrl = kIsWeb ? 'http://localhost:3000' : 'http://10.0.2.2:3000';

  static void setBaseUrl(String url) {
    if (url.endsWith('/')) {
      baseUrl = url.substring(0, url.length - 1);
    } else {
      baseUrl = url;
    }
  }

  // Driver Sign-In
  static Future<Map<String, dynamic>> login(String driverId, String pin) async {
    final uri = Uri.parse('$baseUrl/api/driver/login');
    try {
      final response = await http.post(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'driverId': driverId, 'pin': pin}),
      ).timeout(const Duration(seconds: 10));

      final data = jsonDecode(response.body);
      if (response.statusCode == 200 && data['ok'] == true) {
        final driver = DriverModel.fromJson(data['driver']);
        final loadsList = (data['loads'] as List<dynamic>?)
                ?.map((l) => LoadModel.fromJson(l))
                .toList() ??
            [];
        return {
          'success': true,
          'token': data['token'],
          'driver': driver,
          'companyName': data['companyName'] ?? 'HaulBoX',
          'loads': loadsList,
          'settings': data['settings'] ?? {},
        };
      } else {
        return {
          'success': false,
          'error': data['error'] ?? 'Invalid credentials. Please verify your Driver ID and PIN.',
        };
      }
    } catch (e) {
      return {'success': false, 'error': 'Network connection issue ($baseUrl): $e'};
    }
  }

  // Fetch Loads
  static Future<List<LoadModel>> fetchLoads(String token) async {
    final uri = Uri.parse('$baseUrl/api/driver/loads');
    try {
      final response = await http.get(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        final list = data['loads'] as List<dynamic>? ?? [];
        return list.map((item) => LoadModel.fromJson(item)).toList();
      }
    } catch (e) {
      // Return empty list on network error
    }
    return [];
  }

  // Update Load Checkpoint
  static Future<bool> updateLoadProgress(
      String token, String loadId, String progress, {String? manualEta}) async {
    final uri = Uri.parse('$baseUrl/api/driver/loads/$loadId/progress');
    try {
      final payload = <String, dynamic>{'progress': progress};
      if (manualEta != null) {
        payload['manualEta'] = manualEta;
      }

      final response = await http.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode(payload),
      );
      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }

  // Send Chat Message
  static Future<bool> sendChatMessage(String token, String message, {String? loadId}) async {
    final uri = Uri.parse('$baseUrl/api/driver/chat');
    try {
      final payload = <String, dynamic>{'text': message};
      if (loadId != null) {
        payload['loadId'] = loadId;
      }

      final response = await http.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode(payload),
      );
      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }
}
