enum ConversationType { adminDriver, driverDispatcher, driverAdminDispatcherGroup }

class ConversationModel {
  final String id;
  final ConversationType type;
  String title;
  String subtitle;
  String participantRole;
  final String? participantPhoto;
  String lastMessage;
  String lastMessageTime;
  int unreadCount;
  bool isOnline;
  List<String> memberNames;

  bool get isGroup => type == ConversationType.driverAdminDispatcherGroup;

  ConversationModel({
    required this.id,
    required this.type,
    required this.title,
    required this.subtitle,
    required this.participantRole,
    this.participantPhoto,
    required this.lastMessage,
    required this.lastMessageTime,
    this.unreadCount = 0,
    this.isOnline = true,
    this.memberNames = const [],
  });

  factory ConversationModel.fromJson(Map<String, dynamic> json) {
    ConversationType cType = ConversationType.adminDriver;
    if (json['type'] == 'DRIVER_DISPATCHER') {
      cType = ConversationType.driverDispatcher;
    } else if (json['type'] == 'DRIVER_ADMIN_DISPATCHER_GROUP' || json['type'] == 'GROUP') {
      cType = ConversationType.driverAdminDispatcherGroup;
    }

    return ConversationModel(
      id: json['id']?.toString() ?? '',
      type: cType,
      title: json['title']?.toString() ?? 'HaulBoX Conversation',
      subtitle: json['subtitle']?.toString() ?? '',
      participantRole: json['participantRole']?.toString() ?? 'Group',
      participantPhoto: json['participantPhoto']?.toString(),
      lastMessage: json['lastMessage']?.toString() ?? '',
      lastMessageTime: json['lastMessageTime']?.toString() ?? 'Just now',
      unreadCount: json['unreadCount'] is int ? json['unreadCount'] : 0,
      isOnline: json['isOnline'] != false,
      memberNames: (json['memberNames'] as List?)?.map((e) => e.toString()).toList() ?? [],
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'type': type == ConversationType.adminDriver
        ? 'ADMIN_DRIVER'
        : (type == ConversationType.driverDispatcher ? 'DRIVER_DISPATCHER' : 'DRIVER_ADMIN_DISPATCHER_GROUP'),
    'title': title,
    'subtitle': subtitle,
    'participantRole': participantRole,
    'participantPhoto': participantPhoto,
    'lastMessage': lastMessage,
    'lastMessageTime': lastMessageTime,
    'unreadCount': unreadCount,
    'isOnline': isOnline,
    'memberNames': memberNames,
  };
}
