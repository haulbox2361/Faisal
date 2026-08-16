import 'dart:async';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/network/api_client.dart';
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
  Timer? _chatSyncTimer;
  String? _token;

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
    _startChatSync();
  }

  @override
  void dispose() {
    _chatSyncTimer?.cancel();
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

  void _startChatSync() {
    _chatSyncTimer?.cancel();
    _chatSyncTimer = Timer.periodic(const Duration(seconds: 8), (_) {
      syncLiveChats();
    });
  }

  Future<String?> _getToken() async {
    if (_token != null && _token!.isNotEmpty) return _token;
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('token');
    return _token;
  }

  // Sync Live Messages from Backend Database
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
              final isMe = m['senderType'] == 'driver';
              final createdAt = m['createdAt'] != null
                  ? DateTime.tryParse(m['createdAt'].toString())
                  : null;
              final timeStr = createdAt != null
                  ? '${createdAt.hour > 12 ? createdAt.hour - 12 : (createdAt.hour == 0 ? 12 : createdAt.hour)}:${createdAt.minute.toString().padLeft(2, '0')} ${createdAt.hour >= 12 ? 'PM' : 'AM'}'
                  : 'Recent';

              return ChatMessageModel(
                id: m['id']?.toString() ?? '',
                conversationId: convoId,
                sender: isMe ? 'Me' : (m['senderName'] ?? 'Dispatch'),
                text: m['body']?.toString() ?? '',
                time: timeStr,
                dateGroup: 'TODAY',
                isMe: isMe,
                type: MessageType.text,
                status: MessageDeliveryStatus.read,
              );
            }).toList();

            // Match conversation slot
            String slotId = 'conv-admin';
            if (chatJson['type'] == 'dispatcher' ||
                chatJson['title']?.toString().toLowerCase().contains('disp') ==
                    true) {
              slotId = 'conv-dispatcher';
            } else if (chatJson['type'] == 'group' ||
                chatJson['type'] == 'ops') {
              slotId = 'conv-group';
            }

            _messages[slotId] = mapped;
            if (mapped.isNotEmpty) {
              _updateConversationLastMessage(
                  slotId, mapped.last.text, mapped.last.time);
            }
          }
        }
      }
      notifyListeners();
    } catch (_) {}
  }

  List<ChatMessageModel> getMessages(String conversationId) =>
      _messages[conversationId] ?? [];

  // Send Live Text Message
  Future<void> sendTextMessage(String conversationId, String text) async {
    final now = DateTime.now();
    final timeStr =
        '${now.hour > 12 ? now.hour - 12 : (now.hour == 0 ? 12 : now.hour)}:${now.minute.toString().padLeft(2, '0')} ${now.hour >= 12 ? 'PM' : 'AM'}';
    final msgId = 'msg-${now.millisecondsSinceEpoch}';

    final localMsg = ChatMessageModel(
      id: msgId,
      conversationId: conversationId,
      sender: 'Me',
      text: text,
      time: timeStr,
      dateGroup: 'TODAY',
      isMe: true,
      type: MessageType.text,
      status: MessageDeliveryStatus.sent,
    );

    if (!_messages.containsKey(conversationId)) {
      _messages[conversationId] = [];
    }
    _messages[conversationId]!.add(localMsg);
    _updateConversationLastMessage(conversationId, text, timeStr);
    notifyListeners();

    final token = await _getToken();
    if (token != null) {
      // Send to server backend
      await ApiClient.sendChatMessage(token, conversationId, text);
      syncLiveChats();
    }
  }

  // Send Image Attachment
  Future<void> sendImageMessage(
      String conversationId, String imagePath) async {
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
  Future<void> sendDocumentMessage(
      String conversationId, String docName, String docSize) async {
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

  void _updateConversationLastMessage(
      String conversationId, String lastMsg, String time) {
    if (conversationId == 'conv-admin') {
      _adminConversation = _adminConversation.copyWith(
        lastMessage: lastMsg,
        lastMessageTime: time,
      );
    } else if (conversationId == 'conv-dispatcher') {
      _dispatcherConversation = _dispatcherConversation.copyWith(
        lastMessage: lastMsg,
        lastMessageTime: time,
      );
    } else if (conversationId == 'conv-group') {
      _groupConversation = _groupConversation.copyWith(
        lastMessage: lastMsg,
        lastMessageTime: time,
      );
    }
  }

  void markAsRead(String conversationId) {
    if (conversationId == 'conv-admin') {
      _adminConversation = _adminConversation.copyWith(unreadCount: 0);
    } else if (conversationId == 'conv-dispatcher') {
      _dispatcherConversation =
          _dispatcherConversation.copyWith(unreadCount: 0);
    } else if (conversationId == 'conv-group') {
      _groupConversation = _groupConversation.copyWith(unreadCount: 0);
    }
    notifyListeners();
  }

  void setTyping(String conversationId, bool typing) {
    _typingStates[conversationId] = typing;
    notifyListeners();
  }
}
