import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../../shared/models/driver_model.dart';
import '../../shared/models/load_model.dart';
import '../../shared/models/payment_model.dart';

class ApiClient {
  static const String prodUrl = 'https://haulbox-x5jz.onrender.com';
  static String baseUrl = kIsWeb ? 'http://localhost:3000' : (kDebugMode ? 'http://10.0.2.2:3000' : prodUrl);

  static void setBaseUrl(String url) {
    if (url.endsWith('/')) {
      baseUrl = url.substring(0, url.length - 1);
    } else {
      baseUrl = url;
    }
  }

  static Map<String, String> authHeaders(String? token) {
    return {
      'Content-Type': 'application/json',
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
    };
  }

  // 1. Driver Sign-In
  static Future<Map<String, dynamic>> login(String driverId, String pin) async {
    final uri = Uri.parse('$baseUrl/api/driver/login');
    try {
      final response = await http.post(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'driverId': driverId.trim(), 'pin': pin.trim()}),
      ).timeout(const Duration(seconds: 12));

      Map<String, dynamic> data;
      try {
        data = jsonDecode(response.body);
      } catch (e) {
        return {'success': false, 'error': 'Server returned an invalid response. Please check your Server URL.'};
      }
      
      if (response.statusCode == 200 && data['ok'] == true) {
        final driver = DriverModel.fromJson(data['driver'] ?? {});
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
      return {'success': false, 'error': 'Connection error ($baseUrl). Please check the Server URL.'};
    }
  }

  // 2. High-Performance Full Sync
  static Future<Map<String, dynamic>?> fetchSync(String token) async {
    final uri = Uri.parse('$baseUrl/api/driver/sync');
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
        if (data['ok'] == true) {
          final driver = DriverModel.fromJson(data['driver'] ?? {});
          final loads = (data['loads'] as List<dynamic>?)
                  ?.map((item) => LoadModel.fromJson(item))
                  .toList() ??
              [];
          final payments = (data['payments'] as List<dynamic>?)
                  ?.map((item) => PaymentModel.fromJson(item))
                  .toList() ??
              [];

          return {
            'driver': driver,
            'loads': loads,
            'payments': payments,
            'unreadChats': data['unreadChats'] ?? 0,
            'unreadNotifications': data['unreadNotifications'] ?? 0,
            'settings': data['settings'] ?? {},
            'companyName': data['companyName'] ?? 'HaulBoX',
          };
        }
      }
    } catch (e) {
      debugPrint('Sync API error: $e');
    }
    return null;
  }

  // 3. Fetch Driver Profile
  static Future<DriverModel?> fetchDriverProfile(String token) async {
    final uri = Uri.parse('$baseUrl/api/driver/me');
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
        if (data['driver'] != null) {
          return DriverModel.fromJson(data['driver']);
        }
      }
    } catch (_) {}
    return null;
  }

  // 4. Fetch Loads
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
    } catch (_) {}
    return [];
  }

  // 5. Fetch Payments / Transactions
  static Future<List<PaymentModel>> fetchPayments(String token) async {
    final uri = Uri.parse('$baseUrl/api/driver/transactions');
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
        final list = data['transactions'] as List<dynamic>? ?? [];
        return list.map((item) => PaymentModel.fromJson(item)).toList();
      }
    } catch (_) {}
    return [];
  }

  // 6. Update Load Progress Checkpoint
  static Future<bool> updateLoadProgress(
      String token, String loadId, String progress,
      {String? manualEta, String? note}) async {
    final uri = Uri.parse('$baseUrl/api/driver/loads/$loadId/status');
    try {
      final payload = <String, dynamic>{
        'status': progress,
        'checkpoint': progress,
      };
      if (manualEta != null) payload['eta'] = manualEta;
      if (note != null) payload['note'] = note;

      final response = await http.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode(payload),
      ).timeout(const Duration(seconds: 10));

      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }

  // 7. Upload Load Document (BOL, POD, Photos)
  static Future<bool> uploadLoadDocument(String token, String loadId,
      String key, String fileName, String base64Data) async {
    final uri = Uri.parse('$baseUrl/api/driver/upload-doc');
    try {
      final response = await http.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode({
          'loadId': loadId,
          'key': key,
          'fileName': fileName,
          'data': base64Data,
        }),
      ).timeout(const Duration(seconds: 25));

      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }

  // 8. Accept Payment
  static Future<bool> acceptPayment(String token, String loadId) async {
    final uri = Uri.parse('$baseUrl/api/driver/transactions/$loadId/accept');
    try {
      final response = await http.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 10));

      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }

  // 9. Fetch Chat Conversations
  static Future<List<dynamic>> fetchChats(String token) async {
    final uri = Uri.parse('$baseUrl/api/driver/chats');
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
        return data['chats'] as List<dynamic>? ?? [];
      }
    } catch (_) {}
    return [];
  }

  // 10. Fetch Chat Messages for a Conversation
  static Future<List<dynamic>> fetchChatMessages(
      String token, dynamic conversationId) async {
    final uri = Uri.parse('$baseUrl/api/driver/chats/$conversationId/messages');
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
        return data['messages'] as List<dynamic>? ?? [];
      }
    } catch (_) {}
    return [];
  }

  // 11. Send Chat Message
  static Future<Map<String, dynamic>?> sendChatMessage(
      String token, dynamic conversationId, String message) async {
    final uri = Uri.parse('$baseUrl/api/driver/chats/$conversationId/messages');
    try {
      final response = await http.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode({'body': message}),
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return data['message'] as Map<String, dynamic>?;
      }
    } catch (_) {}
    return null;
  }

  // 12. Send GPS Location (Single Update)
  static Future<Map<String, dynamic>?> updateLocation(String token, Map<String, dynamic> locationData) async {
    final uri = Uri.parse('$baseUrl/api/driver/location');
    try {
      final response = await http.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode(locationData),
      ).timeout(const Duration(seconds: 8));

      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  // 13. Sync Offline Locations (Batch Update)
  static Future<bool> syncOfflineLocations(String token, List<Map<String, dynamic>> locations) async {
    final uri = Uri.parse('$baseUrl/api/driver/location/sync');
    try {
      final response = await http.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode({'locations': locations}),
      ).timeout(const Duration(seconds: 15));

      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }
}
