enum MessageType { text, image, document }
enum MessageDeliveryStatus { sending, sent, delivered, read }

class ChatMessageModel {
  final String id;
  final String conversationId;
  final String sender;
  final String text;
  final String time;
  final String dateGroup; // 'TODAY', 'YESTERDAY', or 'AUG 12, 2026'
  final bool isMe;
  final MessageType type;
  final MessageDeliveryStatus status;
  final String? attachmentName;
  final String? attachmentSize;
  final String? attachmentUrl;

  ChatMessageModel({
    required this.id,
    this.conversationId = '',
    required this.sender,
    required this.text,
    required this.time,
    this.dateGroup = 'TODAY',
    required this.isMe,
    this.type = MessageType.text,
    this.status = MessageDeliveryStatus.read,
    this.attachmentName,
    this.attachmentSize,
    this.attachmentUrl,
  });

  ChatMessageModel copyWith({
    String? id,
    String? conversationId,
    String? sender,
    String? text,
    String? time,
    String? dateGroup,
    bool? isMe,
    MessageType? type,
    MessageDeliveryStatus? status,
    String? attachmentName,
    String? attachmentSize,
    String? attachmentUrl,
  }) {
    return ChatMessageModel(
      id: id ?? this.id,
      conversationId: conversationId ?? this.conversationId,
      sender: sender ?? this.sender,
      text: text ?? this.text,
      time: time ?? this.time,
      dateGroup: dateGroup ?? this.dateGroup,
      isMe: isMe ?? this.isMe,
      type: type ?? this.type,
      status: status ?? this.status,
      attachmentName: attachmentName ?? this.attachmentName,
      attachmentSize: attachmentSize ?? this.attachmentSize,
      attachmentUrl: attachmentUrl ?? this.attachmentUrl,
    );
  }

  factory ChatMessageModel.fromJson(Map<String, dynamic> json) {
    MessageType mType = MessageType.text;
    if (json['type'] == 'IMAGE') mType = MessageType.image;
    if (json['type'] == 'DOCUMENT') mType = MessageType.document;

    MessageDeliveryStatus dStatus = MessageDeliveryStatus.read;
    if (json['status'] == 'SENDING') dStatus = MessageDeliveryStatus.sending;
    if (json['status'] == 'SENT') dStatus = MessageDeliveryStatus.sent;
    if (json['status'] == 'DELIVERED') dStatus = MessageDeliveryStatus.delivered;
    if (json['status'] == 'READ') dStatus = MessageDeliveryStatus.read;

    return ChatMessageModel(
      id: json['id']?.toString() ?? '1',
      conversationId: json['conversationId']?.toString() ?? '',
      sender: json['sender']?.toString() ?? 'User',
      text: json['text']?.toString() ?? '',
      time: json['time']?.toString() ?? '12:00 PM',
      dateGroup: json['dateGroup']?.toString() ?? 'TODAY',
      isMe: json['isMe'] == true,
      type: mType,
      status: dStatus,
      attachmentName: json['attachmentName']?.toString(),
      attachmentSize: json['attachmentSize']?.toString(),
      attachmentUrl: json['attachmentUrl']?.toString(),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'conversationId': conversationId,
    'sender': sender,
    'text': text,
    'time': time,
    'dateGroup': dateGroup,
    'isMe': isMe,
    'type': type.name.toUpperCase(),
    'status': status.name.toUpperCase(),
    'attachmentName': attachmentName,
    'attachmentSize': attachmentSize,
    'attachmentUrl': attachmentUrl,
  };
}
