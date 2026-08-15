import 'dart:async';
import 'package:flutter/material.dart';
import '../../shared/models/chat_message_model.dart';
import '../../shared/models/conversation_model.dart';

class ChatProvider extends ChangeNotifier {
  // Exactly THREE conversations per driver:
  // 1. Private Admin Chat
  // 2. Private Dispatcher Chat
  // 3. Private 3-Person Group Chat (Admin + Driver + Dispatcher)
  late ConversationModel _adminConversation;
  late ConversationModel _dispatcherConversation;
  late ConversationModel _groupConversation;

  final Map<String, List<ChatMessageModel>> _messages = {};
  final Map<String, bool> _typingStates = {};

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

  bool isTyping(String conversationId) => _typingStates[conversationId] ?? false;

  ChatProvider() {
    _initializeConversations();
  }

  void _initializeConversations() {
    // 1. Private Admin Chat
    _adminConversation = ConversationModel(
      id: 'conv-admin',
      type: ConversationType.adminDriver,
      title: 'HaulBoX Admin',
      subtitle: 'Private 1-to-1 • Operations & Compliance',
      participantRole: 'Operations Admin',
      lastMessage: 'Rate confirmation for HBX-2024-1042 verified and approved.',
      lastMessageTime: '2:35 PM',
      unreadCount: 0,
      isOnline: true,
      memberNames: ['HaulBoX Admin', 'John D. Smith'],
    );

    // 2. Private Dispatcher Chat
    _dispatcherConversation = ConversationModel(
      id: 'conv-dispatcher',
      type: ConversationType.driverDispatcher,
      title: 'Sarah — Dispatcher',
      subtitle: 'Private 1-to-1 • Regional Fleet 4',
      participantRole: 'Assigned Dispatcher',
      lastMessage: 'Good morning! Guard shack is at Gate 3. Let me know once you check in.',
      lastMessageTime: '2:41 PM',
      unreadCount: 2,
      isOnline: true,
      memberNames: ['Sarah — Dispatcher', 'John D. Smith'],
    );

    // 3. Private 3-Person Group Chat (Admin + Driver + Dispatcher)
    _groupConversation = ConversationModel(
      id: 'conv-group',
      type: ConversationType.driverAdminDispatcherGroup,
      title: 'Load HBX-2024-1042',
      subtitle: 'Admin + You + Sarah',
      participantRole: '3 participants',
      lastMessage: 'Sarah: Receiver dock 4 has been confirmed for 04:30 PM delivery.',
      lastMessageTime: '2:45 PM',
      unreadCount: 1,
      isOnline: true,
      memberNames: ['HaulBoX Admin', 'John D. Smith (You)', 'Sarah — Dispatcher'],
    );

    // Seed Messages for Admin Chat
    _messages['conv-admin'] = [
      ChatMessageModel(
        id: 'adm-1',
        conversationId: 'conv-admin',
        sender: 'HaulBoX Admin',
        text: 'Welcome John! Your compliance documents (CDL & Medical Card) are up to date.',
        time: 'Yesterday',
        dateGroup: 'YESTERDAY',
        isMe: false,
        status: MessageDeliveryStatus.read,
      ),
      ChatMessageModel(
        id: 'adm-2',
        conversationId: 'conv-admin',
        sender: 'Me',
        text: 'Thank you! Rate confirmation received for the Dallas to Houston run.',
        time: '2:30 PM',
        dateGroup: 'TODAY',
        isMe: true,
        status: MessageDeliveryStatus.read,
      ),
      ChatMessageModel(
        id: 'adm-3',
        conversationId: 'conv-admin',
        sender: 'HaulBoX Admin',
        text: 'Rate confirmation for HBX-2024-1042 verified and approved.',
        time: '2:35 PM',
        dateGroup: 'TODAY',
        isMe: false,
        status: MessageDeliveryStatus.read,
      ),
    ];

    // Seed Messages for Dispatcher Chat
    _messages['conv-dispatcher'] = [
      ChatMessageModel(
        id: 'dsp-1',
        conversationId: 'conv-dispatcher',
        sender: 'Sarah — Dispatcher',
        text: 'Load HBX-2024-1042 booked. Pickup window opens at 08:00 AM in Dallas, TX.',
        time: '1:15 PM',
        dateGroup: 'TODAY',
        isMe: false,
        status: MessageDeliveryStatus.read,
      ),
      ChatMessageModel(
        id: 'dsp-2',
        conversationId: 'conv-dispatcher',
        sender: 'Me',
        text: 'Rolling now on I-45 South. ETA around 04:30 PM.',
        time: '2:20 PM',
        dateGroup: 'TODAY',
        isMe: true,
        status: MessageDeliveryStatus.read,
      ),
      ChatMessageModel(
        id: 'dsp-3',
        conversationId: 'conv-dispatcher',
        sender: 'Sarah — Dispatcher',
        text: 'Good morning! Guard shack is at Gate 3. Let me know once you check in.',
        time: '2:41 PM',
        dateGroup: 'TODAY',
        isMe: false,
        status: MessageDeliveryStatus.read,
      ),
    ];

    // Seed Messages for 3-Person Group Chat
    _messages['conv-group'] = [
      ChatMessageModel(
        id: 'grp-1',
        conversationId: 'conv-group',
        sender: 'HaulBoX Admin',
        text: 'Dispatched Load HBX-2024-1042 to John Smith. Rate: \$1,850. Dallas, TX → Houston, TX.',
        time: '12:00 PM',
        dateGroup: 'TODAY',
        isMe: false,
        status: MessageDeliveryStatus.read,
      ),
      ChatMessageModel(
        id: 'grp-2',
        conversationId: 'conv-group',
        sender: 'Me',
        text: 'Trip started. BOL document has been scanned and verified.',
        time: '2:15 PM',
        dateGroup: 'TODAY',
        isMe: true,
        status: MessageDeliveryStatus.read,
      ),
      ChatMessageModel(
        id: 'grp-3',
        conversationId: 'conv-group',
        sender: 'Sarah — Dispatcher',
        text: 'Receiver dock 4 has been confirmed for 04:30 PM delivery.',
        time: '2:45 PM',
        dateGroup: 'TODAY',
        isMe: false,
        status: MessageDeliveryStatus.read,
      ),
    ];
  }

  List<ChatMessageModel> getMessages(String conversationId) {
    return _messages[conversationId] ?? [];
  }

  void markAsRead(String conversationId) {
    if (conversationId == _adminConversation.id && _adminConversation.unreadCount > 0) {
      _adminConversation.unreadCount = 0;
      notifyListeners();
    } else if (conversationId == _dispatcherConversation.id && _dispatcherConversation.unreadCount > 0) {
      _dispatcherConversation.unreadCount = 0;
      notifyListeners();
    } else if (conversationId == _groupConversation.id && _groupConversation.unreadCount > 0) {
      _groupConversation.unreadCount = 0;
      notifyListeners();
    }
  }

  // Send Text Message
  Future<void> sendTextMessage(String conversationId, String text) async {
    final msgId = 'msg-${DateTime.now().millisecondsSinceEpoch}';
    final now = DateTime.now();
    final timeStr = '${now.hour > 12 ? now.hour - 12 : (now.hour == 0 ? 12 : now.hour)}:${now.minute.toString().padLeft(2, '0')} ${now.hour >= 12 ? 'PM' : 'AM'}';

    final newMsg = ChatMessageModel(
      id: msgId,
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
    _messages[conversationId]!.add(newMsg);

    _updateConversationLastMessage(conversationId, text, timeStr);
    notifyListeners();

    // 1. Simulate server sent
    await Future.delayed(const Duration(milliseconds: 300));
    _updateMessageStatus(conversationId, msgId, MessageDeliveryStatus.sent);
    notifyListeners();

    // 2. Simulate recipient delivered
    await Future.delayed(const Duration(milliseconds: 400));
    _updateMessageStatus(conversationId, msgId, MessageDeliveryStatus.delivered);
    notifyListeners();

    // 3. Simulate recipient read & response
    await Future.delayed(const Duration(milliseconds: 500));
    _updateMessageStatus(conversationId, msgId, MessageDeliveryStatus.read);
    notifyListeners();

    _triggerSimulatedResponse(conversationId, text);
  }

  // Send Image Attachment
  Future<void> sendImageMessage(String conversationId, String imagePath) async {
    final msgId = 'img-${DateTime.now().millisecondsSinceEpoch}';
    final now = DateTime.now();
    final timeStr = '${now.hour > 12 ? now.hour - 12 : (now.hour == 0 ? 12 : now.hour)}:${now.minute.toString().padLeft(2, '0')} ${now.hour >= 12 ? 'PM' : 'AM'}';

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
      status: MessageDeliveryStatus.sending,
    );

    _messages[conversationId]?.add(newMsg);
    _updateConversationLastMessage(conversationId, '📷 Photo', timeStr);
    notifyListeners();

    await Future.delayed(const Duration(milliseconds: 400));
    _updateMessageStatus(conversationId, msgId, MessageDeliveryStatus.delivered);
    notifyListeners();

    await Future.delayed(const Duration(milliseconds: 400));
    _updateMessageStatus(conversationId, msgId, MessageDeliveryStatus.read);
    notifyListeners();

    _triggerSimulatedResponse(conversationId, 'Photo received');
  }

  // Send Document Attachment
  Future<void> sendDocumentMessage(String conversationId, String docName, String docSize) async {
    final msgId = 'doc-${DateTime.now().millisecondsSinceEpoch}';
    final now = DateTime.now();
    final timeStr = '${now.hour > 12 ? now.hour - 12 : (now.hour == 0 ? 12 : now.hour)}:${now.minute.toString().padLeft(2, '0')} ${now.hour >= 12 ? 'PM' : 'AM'}';

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
      status: MessageDeliveryStatus.sending,
    );

    _messages[conversationId]?.add(newMsg);
    _updateConversationLastMessage(conversationId, '📄 $docName', timeStr);
    notifyListeners();

    await Future.delayed(const Duration(milliseconds: 400));
    _updateMessageStatus(conversationId, msgId, MessageDeliveryStatus.delivered);
    notifyListeners();

    await Future.delayed(const Duration(milliseconds: 400));
    _updateMessageStatus(conversationId, msgId, MessageDeliveryStatus.read);
    notifyListeners();

    _triggerSimulatedResponse(conversationId, 'Document received');
  }

  void _updateMessageStatus(String conversationId, String messageId, MessageDeliveryStatus status) {
    final list = _messages[conversationId];
    if (list != null) {
      final idx = list.indexWhere((m) => m.id == messageId);
      if (idx != -1) {
        list[idx] = list[idx].copyWith(status: status);
      }
    }
  }

  void _updateConversationLastMessage(String conversationId, String text, String time) {
    if (conversationId == _adminConversation.id) {
      _adminConversation.lastMessage = text;
      _adminConversation.lastMessageTime = time;
    } else if (conversationId == _dispatcherConversation.id) {
      _dispatcherConversation.lastMessage = text;
      _dispatcherConversation.lastMessageTime = time;
    } else if (conversationId == _groupConversation.id) {
      _groupConversation.lastMessage = text;
      _groupConversation.lastMessageTime = time;
    }
  }

  void _triggerSimulatedResponse(String conversationId, String userMessage) {
    _typingStates[conversationId] = true;
    notifyListeners();

    Timer(const Duration(milliseconds: 1600), () {
      _typingStates[conversationId] = false;

      final now = DateTime.now();
      final timeStr = '${now.hour > 12 ? now.hour - 12 : (now.hour == 0 ? 12 : now.hour)}:${now.minute.toString().padLeft(2, '0')} ${now.hour >= 12 ? 'PM' : 'AM'}';

      String replyText;
      String senderName;

      if (conversationId == _adminConversation.id) {
        senderName = 'HaulBoX Admin';
        if (userMessage.toLowerCase().contains('rate') || userMessage.toLowerCase().contains('pay')) {
          replyText = 'Settlement for this run is processed via Direct Deposit ACH within 24h of POD delivery.';
        } else if (userMessage.toLowerCase().contains('bol') || userMessage.toLowerCase().contains('pod')) {
          replyText = 'Received document. Our AI verification system has confirmed the upload.';
        } else {
          replyText = 'Acknowledged. HaulBoX Admin support is standing by if you require anything on this load.';
        }
      } else if (conversationId == _dispatcherConversation.id) {
        senderName = _dispatcherConversation.title;
        if (userMessage.toLowerCase().contains('eta') || userMessage.toLowerCase().contains('rolling')) {
          replyText = 'Thanks for the update John. Receiver dock 4 is notified of your incoming ETA.';
        } else if (userMessage.toLowerCase().contains('bay') || userMessage.toLowerCase().contains('gate')) {
          replyText = 'Guard shack is confirmed. Contact the dock master upon backing in.';
        } else {
          replyText = 'Copy that. Keep us posted once you reach the next checkpoint.';
        }
      } else {
        // Group response (from Dispatcher or Admin)
        senderName = _dispatcherConversation.title;
        replyText = 'All 3 parties in the group have received your update. Safe driving on the run!';
      }

      final replyMsg = ChatMessageModel(
        id: 'reply-${DateTime.now().millisecondsSinceEpoch}',
        conversationId: conversationId,
        sender: senderName,
        text: replyText,
        time: timeStr,
        dateGroup: 'TODAY',
        isMe: false,
        status: MessageDeliveryStatus.read,
      );

      _messages[conversationId]?.add(replyMsg);
      _updateConversationLastMessage(conversationId, '$senderName: $replyText', timeStr);
      notifyListeners();
    });
  }

  // Support for Dispatcher Reassignment (e.g. Sarah -> Mike)
  void reassignDispatcher(String newDispatcherName, String newSubtitle) {
    _dispatcherConversation.title = newDispatcherName;
    _dispatcherConversation.subtitle = newSubtitle;
    _dispatcherConversation.lastMessage = 'Assigned to your fleet. Let me know if you need anything!';
    _dispatcherConversation.lastMessageTime = 'Just now';
    _dispatcherConversation.unreadCount = 1;
    _dispatcherConversation.memberNames = [newDispatcherName, 'John D. Smith'];

    // Update 3-Person Group Chat members automatically
    _groupConversation.subtitle = 'Admin + You + ${newDispatcherName.split(' ').first}';
    _groupConversation.memberNames = ['HaulBoX Admin', 'John D. Smith (You)', newDispatcherName];
    _groupConversation.lastMessage = '$newDispatcherName joined the group as assigned dispatcher.';
    _groupConversation.lastMessageTime = 'Just now';

    notifyListeners();
  }
}
