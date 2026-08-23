import 'dart:async';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/network/api_client.dart';
import '../../core/services/socket_service.dart';
import '../../shared/models/chat_message_model.dart';
import '../../shared/models/conversation_model.dart';

class ChatProvider extends ChangeNotifier {
  // THREE primary conversation channels per driver:
  // 1. Private Admin Chat
  // 2. Private Dispatcher Chat
  // 3. Private 3-Person Group Chat (Admin + Driver + Dispatcher)
  late ConversationModel _adminConversation;
  late ConversationModel _dispatcherConversation;
  late ConversationModel _groupConversation;

  final Map<String, List<ChatMessageModel>> _messages = {};
  final Map<String, bool> _typingStates = {};
  String? _token;
  String? _driverId;

  StreamSubscription<Map<String, dynamic>>? _msgSub;
  StreamSubscription<Map<String, dynamic>>? _typingSub;
  StreamSubscription<Map<String, dynamic>>? _readSub;
  StreamSubscription<bool>? _connSub;

  ConversationModel get adminConversation => _adminConversation;
  ConversationModel get dispatcherConversation => _dispatcherConversation;
  ConversationModel get groupConversation => _groupConversation;

  List<ConversationModel> get conversations => [
        _adminConversation,
        _dispatcherConversation,
        _groupConversation,
      ];

  int get totalUnreadCount =>
      _adminConversation.unreadCount +
      _dispatcherConversation.unreadCount +
      _groupConversation.unreadCount;

  bool isTyping(String conversationId) =>
      _typingStates[conversationId] ?? false;

  ChatProvider() {
    _initializeConversations();
    _initSocketAndSync();
  }

  @override
  void dispose() {
    _connSub?.cancel();
    _msgSub?.cancel();
    _typingSub?.cancel();
    _readSub?.cancel();
    super.dispose();
  }

  void _initializeConversations() {
    _adminConversation = ConversationModel(
      id: 'conv-admin',
      type: ConversationType.adminDriver,
      title: 'HaulBoX Admin',
      subtitle: 'Private 1-to-1 • Operations & Compliance',
      participantRole: 'Operations Admin',
      lastMessage: 'Operations channel active.',
      lastMessageTime: 'Now',
      unreadCount: 0,
      isOnline: true,
      memberNames: ['HaulBoX Admin', 'Driver'],
    );

    _dispatcherConversation = ConversationModel(
      id: 'conv-dispatcher',
      type: ConversationType.driverDispatcher,
      title: 'Dispatcher Support',
      subtitle: 'Private 1-to-1 • Dispatch Desk',
      participantRole: 'Assigned Dispatcher',
      lastMessage: 'Dispatch channel active.',
      lastMessageTime: 'Now',
      unreadCount: 0,
      isOnline: true,
      memberNames: ['Dispatcher', 'Driver'],
    );

    _groupConversation = ConversationModel(
      id: 'conv-group',
      type: ConversationType.driverAdminDispatcherGroup,
      title: 'Operations Group',
      subtitle: 'Admin + Dispatcher + You',
      participantRole: '3 participants',
      lastMessage: 'Load communications group.',
      lastMessageTime: 'Now',
      unreadCount: 0,
      isOnline: true,
      memberNames: ['HaulBoX Admin', 'Dispatcher', 'Driver'],
    );

    _messages['conv-admin'] = [];
    _messages['conv-dispatcher'] = [];
    _messages['conv-group'] = [];
  }

  Future<void> _initSocketAndSync() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('token');
    _driverId = prefs.getString('driverId') ?? 'driver-101';
    final driverName = prefs.getString('driverName') ?? 'Driver';

    // 1. Establish live Socket.IO connection & authenticate
    SocketService().connect(driverId: _driverId!, driverName: driverName);

    // 2. Subscribe to connection updates: trigger backfill sync on reconnect
    _connSub?.cancel();
    _connSub = SocketService().connectionStream.listen((isConnected) {
      if (isConnected) {
        debugPrint('[ChatProvider] Socket reconnected — triggering historical backfill sync');
        syncLiveChats();
      }
    });

    // 3. Subscribe to real-time incoming messages
    _msgSub?.cancel();
    _msgSub = SocketService().messageStream.listen((data) {
      _handleIncomingSocketMessage(data);
    });

    // 4. Subscribe to live typing indicators
    _typingSub?.cancel();
    _typingSub = SocketService().typingStream.listen((data) {
      final convoId = data['conversationId']?.toString();
      final isTyping = data['isTyping'] == true;
      if (convoId != null) {
        _typingStates[convoId] = isTyping;
        notifyListeners();
      }
    });

    // 5. Subscribe to live read receipts
    _readSub?.cancel();
    _readSub = SocketService().readStream.listen((data) {
      final convoId = data['conversationId']?.toString();
      if (convoId != null && _messages.containsKey(convoId)) {
        for (int i = 0; i < _messages[convoId]!.length; i++) {
          if (_messages[convoId]![i].isMe) {
            _messages[convoId]![i] = _messages[convoId]![i].copyWith(
              status: MessageDeliveryStatus.read,
            );
          }
        }
        notifyListeners();
      }
    });

    // 6. Initial historical sync on startup
    await syncLiveChats();
  }

  void _handleIncomingSocketMessage(Map<String, dynamic> m) {
    final convoId = m['conversationId']?.toString() ?? '';
    final isMe = m['senderType'] == 'driver' || m['senderId']?.toString() == _driverId;
    final createdAt = m['createdAt'] != null
        ? DateTime.tryParse(m['createdAt'].toString())
        : DateTime.now();
    final timeStr =
        '${createdAt!.hour > 12 ? createdAt.hour - 12 : (createdAt.hour == 0 ? 12 : createdAt.hour)}:${createdAt.minute.toString().padLeft(2, '0')} ${createdAt.hour >= 12 ? 'PM' : 'AM'}';

    final newMsg = ChatMessageModel(
      id: m['id']?.toString() ?? 'msg-${DateTime.now().millisecondsSinceEpoch}',
      conversationId: convoId,
      sender: isMe ? 'Me' : (m['senderName'] ?? 'Dispatch'),
      text: m['body']?.toString() ?? '',
      time: timeStr,
      dateGroup: 'TODAY',
      isMe: isMe,
      type: MessageType.text,
      status: isMe ? MessageDeliveryStatus.sent : MessageDeliveryStatus.read,
    );

    // Find target slot
    String slotId = 'conv-admin';
    if (_messages.containsKey(convoId)) {
      slotId = convoId;
    } else if (convoId.isNotEmpty) {
      slotId = convoId;
    }

    if (!_messages.containsKey(slotId)) {
      _messages[slotId] = [];
    }

    // Deduplication check by ID and tempId
    final existingIdx = _messages[slotId]!.indexWhere((msg) =>
        msg.id == newMsg.id ||
        (m['tempId'] != null && msg.id == m['tempId']));

    if (existingIdx != -1) {
      _messages[slotId]![existingIdx] = newMsg;
    } else {
      _messages[slotId]!.add(newMsg);
      _updateConversationLastMessage(slotId, newMsg.text, newMsg.time);
    }
    notifyListeners();
  }

  void joinConversationRoom(dynamic conversationId) {
    SocketService().joinConversation(conversationId);
  }

  void leaveConversationRoom(dynamic conversationId) {
    SocketService().leaveConversation(conversationId);
  }

  void setTyping(dynamic conversationId, bool isTyping) {
    SocketService().sendTyping(conversationId, isTyping);
  }

  void markConversationRead(dynamic conversationId) {
    SocketService().markRead(conversationId);
  }

  Future<String?> _getToken() async {
    if (_token != null && _token!.isNotEmpty) return _token;
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('token');
    return _token;
  }

  // Sync Live Messages from Backend Database with Deduplication
  Future<void> syncLiveChats() async {
    final token = await _getToken();
    if (token == null) return;

    try {
      final chatsList = await ApiClient.fetchChats(token);
      for (final chatJson in chatsList) {
        final convoId = chatJson['id']?.toString();
        if (convoId != null) {
          final serverMsgs = await ApiClient.fetchChatMessages(token, convoId);
          if (serverMsgs.isNotEmpty) {
            final mapped = serverMsgs.map((m) {
              final isMe = m['senderType'] == 'driver' || m['senderId']?.toString() == _driverId;
              final createdAt = m['createdAt'] != null
                  ? DateTime.tryParse(m['createdAt'].toString())
                  : null;
              final timeStr = createdAt != null
                  ? '${createdAt.hour > 12 ? createdAt.hour - 12 : (createdAt.hour == 0 ? 12 : createdAt.hour)}:${createdAt.minute.toString().padLeft(2, '0')} ${createdAt.hour >= 12 ? 'PM' : 'AM'}'
                  : 'Recent';

              final isRead = m['read'] == true;

              return ChatMessageModel(
                id: m['id']?.toString() ?? '',
                conversationId: convoId,
                sender: isMe ? 'Me' : (m['senderName'] ?? 'Dispatch'),
                text: m['body']?.toString() ?? '',
                time: timeStr,
                dateGroup: 'TODAY',
                isMe: isMe,
                type: MessageType.text,
                status: isRead ? MessageDeliveryStatus.read : MessageDeliveryStatus.sent,
              );
            }).toList();

            // Match conversation slot
            String slotId = 'conv-admin';
            if (chatJson['type'] == 'dispatcher' ||
                chatJson['title']?.toString().toLowerCase().contains('disp') == true) {
              slotId = 'conv-dispatcher';
            } else if (chatJson['type'] == 'group' || chatJson['type'] == 'ops') {
              slotId = 'conv-group';
            }

            // Deduplicate: merge server messages with any currently sending local messages
            final existingList = _messages[slotId] ?? [];
            final pendingLocal = existingList.where((msg) => msg.status == MessageDeliveryStatus.sending).toList();

            final seenIds = <String>{};
            final merged = <ChatMessageModel>[];

            for (final sm in mapped) {
              if (sm.id.isNotEmpty && !seenIds.contains(sm.id)) {
                seenIds.add(sm.id);
                merged.add(sm);
              }
            }

            // Append pending messages that are not yet acknowledged
            for (final pm in pendingLocal) {
              if (!seenIds.contains(pm.id)) {
                merged.add(pm);
              }
            }

            _messages[slotId] = merged;
            if (merged.isNotEmpty) {
              _updateConversationLastMessage(slotId, merged.last.text, merged.last.time);
            }
          }
        }
      }
      notifyListeners();
    } catch (_) {}
  }

  List<ChatMessageModel> getMessages(String conversationId) =>
      _messages[conversationId] ?? [];

  // Send Live Text Message with Optimistic UI & Socket.IO Primary Dispatch
  Future<void> sendTextMessage(String conversationId, String text) async {
    final now = DateTime.now();
    final timeStr =
        '${now.hour > 12 ? now.hour - 12 : (now.hour == 0 ? 12 : now.hour)}:${now.minute.toString().padLeft(2, '0')} ${now.hour >= 12 ? 'PM' : 'AM'}';
    final tempMsgId = 'temp-${now.millisecondsSinceEpoch}';

    // 1. Optimistic Local Bubble (🕒 sending)
    final localMsg = ChatMessageModel(
      id: tempMsgId,
      conversationId: conversationId,
      sender: 'Me',
      text: text,
      time: timeStr,
      dateGroup: 'TODAY',
      isMe: true,
      type: MessageType.text,
      status: MessageDeliveryStatus.sending,
    );

    if (!_messages.containsKey(conversationId)) {
      _messages[conversationId] = [];
    }
    _messages[conversationId]!.add(localMsg);
    _updateConversationLastMessage(conversationId, text, timeStr);
    notifyListeners();

    // 2. Primary Dispatch via Socket.IO if connected
    if (SocketService().isConnected) {
      SocketService().sendMessage(
        conversationId: conversationId,
        body: text,
        tempId: tempMsgId,
        onAck: (ack) {
          if (ack['ok'] == true) {
            final idx = _messages[conversationId]?.indexWhere((m) => m.id == tempMsgId) ?? -1;
            if (idx != -1) {
              _messages[conversationId]![idx] = localMsg.copyWith(
                id: ack['message']?['id']?.toString() ?? tempMsgId,
                status: MessageDeliveryStatus.sent,
              );
              notifyListeners();
            }
          }
        },
      );
      return;
    }

    // 3. Fallback Dispatch via REST API
    final token = await _getToken();
    if (token != null) {
      try {
        final res = await ApiClient.sendChatMessage(token, conversationId, text);
        if (res != null) {
          final idx = _messages[conversationId]?.indexWhere((m) => m.id == tempMsgId) ?? -1;
          if (idx != -1) {
            _messages[conversationId]![idx] = localMsg.copyWith(
              id: res['id']?.toString() ?? tempMsgId,
              status: MessageDeliveryStatus.sent,
            );
            notifyListeners();
          }
        }
        syncLiveChats();
      } catch (e) {
        // Retain sending status for offline retry on next syncLiveChats()
      }
    }
  }

  // Send Image Attachment
  Future<void> sendImageMessage(String conversationId, String imagePath) async {
    final now = DateTime.now();
    final timeStr =
        '${now.hour > 12 ? now.hour - 12 : (now.hour == 0 ? 12 : now.hour)}:${now.minute.toString().padLeft(2, '0')} ${now.hour >= 12 ? 'PM' : 'AM'}';
    final msgId = 'img-${now.millisecondsSinceEpoch}';

    final newMsg = ChatMessageModel(
      id: msgId,
      conversationId: conversationId,
      sender: 'Me',
      text: '📷 Photo Attachment',
      time: timeStr,
      dateGroup: 'TODAY',
      isMe: true,
      type: MessageType.image,
      attachmentUrl: imagePath,
      status: MessageDeliveryStatus.sent,
    );

    _messages[conversationId]?.add(newMsg);
    _updateConversationLastMessage(conversationId, '📷 Photo', timeStr);
    notifyListeners();
  }

  // Send Document Attachment
  Future<void> sendDocumentMessage(String conversationId, String docName, String docSize) async {
    final now = DateTime.now();
    final timeStr =
        '${now.hour > 12 ? now.hour - 12 : (now.hour == 0 ? 12 : now.hour)}:${now.minute.toString().padLeft(2, '0')} ${now.hour >= 12 ? 'PM' : 'AM'}';
    final msgId = 'doc-${now.millisecondsSinceEpoch}';

    final newMsg = ChatMessageModel(
      id: msgId,
      conversationId: conversationId,
      sender: 'Me',
      text: docName,
      time: timeStr,
      dateGroup: 'TODAY',
      isMe: true,
      type: MessageType.document,
      attachmentName: docName,
      attachmentSize: docSize,
      status: MessageDeliveryStatus.sent,
    );

    _messages[conversationId]?.add(newMsg);
    _updateConversationLastMessage(conversationId, '📄 $docName', timeStr);
    notifyListeners();
  }

  void markAsRead(dynamic conversationId) {
    markConversationRead(conversationId);
  }

  void _updateConversationLastMessage(
      String conversationId, String message, String time) {
    switch (conversationId) {
      case 'conv-admin':
        _adminConversation = _adminConversation.copyWith(
          lastMessage: message,
          lastMessageTime: time,
        );
        break;
      case 'conv-dispatcher':
        _dispatcherConversation = _dispatcherConversation.copyWith(
          lastMessage: message,
          lastMessageTime: time,
        );
        break;
      case 'conv-group':
        _groupConversation = _groupConversation.copyWith(
          lastMessage: message,
          lastMessageTime: time,
        );
        break;
      default:
        break;
    }
  }
}
