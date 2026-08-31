import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as socket_io;
import '../network/api_client.dart';

class SocketService {
  static final SocketService _instance = SocketService._internal();
  factory SocketService() => _instance;
  SocketService._internal();

  socket_io.Socket? _socket;
  bool _isConnected = false;
  String? _driverId;
  String? _driverName;

  // Stream controllers for real-time events
  final _messageController = StreamController<Map<String, dynamic>>.broadcast();
  final _typingController = StreamController<Map<String, dynamic>>.broadcast();
  final _readController = StreamController<Map<String, dynamic>>.broadcast();
  final _connectionController = StreamController<bool>.broadcast();
  final _docApprovedController = StreamController<Map<String, dynamic>>.broadcast();
  final _docRejectedController = StreamController<Map<String, dynamic>>.broadcast();
  final _loadUpdatedController = StreamController<Map<String, dynamic>>.broadcast();

  Stream<Map<String, dynamic>> get messageStream => _messageController.stream;
  Stream<Map<String, dynamic>> get typingStream => _typingController.stream;
  Stream<Map<String, dynamic>> get readStream => _readController.stream;
  Stream<bool> get connectionStream => _connectionController.stream;
  Stream<Map<String, dynamic>> get docApprovedStream => _docApprovedController.stream;
  Stream<Map<String, dynamic>> get docRejectedStream => _docRejectedController.stream;
  Stream<Map<String, dynamic>> get loadUpdatedStream => _loadUpdatedController.stream;

  bool get isConnected => _isConnected;

  void connect({required String driverId, String? driverName}) {
    _driverId = driverId;
    _driverName = driverName ?? 'Driver $driverId';

    if (_socket != null && _socket!.connected) {
      _authenticate();
      return;
    }

    try {
      final serverUrl = ApiClient.baseUrl;
      debugPrint('[SocketService] Connecting to Socket.IO gateway at: $serverUrl');

      _socket = socket_io.io(
        serverUrl,
        socket_io.OptionBuilder()
            .setTransports(['websocket', 'polling'])
            .enableAutoConnect()
            .enableReconnection()
            .setReconnectionDelay(1000)
            .setReconnectionAttempts(10)
            .build(),
      );

      _socket!.onConnect((_) {
        debugPrint('[SocketService] Connected! Socket ID: ${_socket!.id}');
        _isConnected = true;
        _connectionController.add(true);
        _authenticate();
      });

      _socket!.onDisconnect((_) {
        debugPrint('[SocketService] Disconnected from server');
        _isConnected = false;
        _connectionController.add(false);
      });

      _socket!.onConnectError((err) {
        debugPrint('[SocketService] Connection error: $err');
        _isConnected = false;
        _connectionController.add(false);
      });

      // 1. Listen for incoming new messages
      _socket!.on('new_message', (data) {
        if (data != null && data is Map) {
          debugPrint('[SocketService] Real-time message received: ${data['body']}');
          _messageController.add(Map<String, dynamic>.from(data));
        }
      });

      // 2. Listen for typing indicators
      _socket!.on('user_typing', (data) {
        if (data != null && data is Map) {
          _typingController.add(Map<String, dynamic>.from(data));
        }
      });

      // 3. Listen for read receipts
      _socket!.on('messages_read', (data) {
        if (data != null && data is Map) {
          _readController.add(Map<String, dynamic>.from(data));
        }
      });

      // 4. Listen for document approval & rejection events
      _socket!.on('document:approved', (data) {
        debugPrint('[SocketService] Real-time document:approved received: $data');
        if (data != null && data is Map) {
          _docApprovedController.add(Map<String, dynamic>.from(data));
        }
      });

      _socket!.on('document:rejected', (data) {
        debugPrint('[SocketService] Real-time document:rejected received: $data');
        if (data != null && data is Map) {
          _docRejectedController.add(Map<String, dynamic>.from(data));
        }
      });

      _socket!.on('load:updated', (data) {
        debugPrint('[SocketService] Real-time load:updated received: $data');
        if (data != null && data is Map) {
          _loadUpdatedController.add(Map<String, dynamic>.from(data));
        }
      });

      _socket!.connect();
    } catch (e) {
      debugPrint('[SocketService] Exception initializing socket: $e');
    }
  }

  void _authenticate() {
    if (_socket == null || !_isConnected || _driverId == null) return;
    debugPrint('[SocketService] Authenticating driver: $_driverId ($_driverName)');
    _socket!.emit('authenticate', {
      'accountId': _driverId,
      'role': 'driver',
      'type': 'driver',
      'name': _driverName,
    });
  }

  void joinConversation(dynamic conversationId) {
    if (_socket == null || !_isConnected || conversationId == null) return;
    final convId = int.tryParse(conversationId.toString());
    if (convId != null) {
      debugPrint('[SocketService] Joining conversation room: conv_$convId');
      _socket!.emit('join_conversation', {
        'conversationId': convId,
        'accountId': _driverId,
        'role': 'driver',
        'name': _driverName,
      });
    }
  }

  void leaveConversation(dynamic conversationId) {
    if (_socket == null || !_isConnected || conversationId == null) return;
    final convId = int.tryParse(conversationId.toString());
    if (convId != null) {
      _socket!.emit('leave_conversation', {
        'conversationId': convId,
      });
    }
  }

  void sendMessage({
    required dynamic conversationId,
    required String body,
    String? tempId,
    String? loadId,
    String? loadNumber,
    Function(Map<String, dynamic>)? onAck,
  }) {
    if (_socket == null || !_isConnected) return;
    final convId = int.tryParse(conversationId.toString());
    if (convId == null) return;

    final payload = {
      'conversationId': convId,
      'body': body,
      'accountId': _driverId,
      'role': 'driver',
      'name': _driverName,
      'tempId': tempId,
      'loadId': loadId,
      'loadNumber': loadNumber,
    };

    if (onAck != null) {
      _socket!.emitWithAck('send_message', payload, ack: (res) {
        if (res != null && res is Map) {
          onAck(Map<String, dynamic>.from(res));
        }
      });
    } else {
      _socket!.emit('send_message', payload);
    }
  }

  void sendTyping(dynamic conversationId, bool isTyping) {
    if (_socket == null || !_isConnected) return;
    final convId = int.tryParse(conversationId.toString());
    if (convId == null) return;

    _socket!.emit('typing', {
      'conversationId': convId,
      'isTyping': isTyping,
      'accountId': _driverId,
      'role': 'driver',
      'name': _driverName,
    });
  }

  void markRead(dynamic conversationId) {
    if (_socket == null || !_isConnected) return;
    final convId = int.tryParse(conversationId.toString());
    if (convId == null) return;

    _socket!.emit('mark_read', {
      'conversationId': convId,
      'accountId': _driverId,
      'role': 'driver',
    });
  }

  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
    _isConnected = false;
  }
}
