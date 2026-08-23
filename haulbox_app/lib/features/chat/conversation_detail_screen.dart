import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../shared/models/chat_message_model.dart';
import '../../shared/models/conversation_model.dart';
import '../../shared/widgets/voice_input_sheet.dart';
import 'chat_provider.dart';

class ConversationDetailScreen extends StatefulWidget {
  final ConversationModel conversation;

  const ConversationDetailScreen({super.key, required this.conversation});

  @override
  State<ConversationDetailScreen> createState() => _ConversationDetailScreenState();
}

class _ConversationDetailScreenState extends State<ConversationDetailScreen> {
  final _textController = TextEditingController();
  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        final provider = Provider.of<ChatProvider>(context, listen: false);
        provider.joinConversationRoom(widget.conversation.id);
        provider.markConversationRead(widget.conversation.id);
      }
    });

    _textController.addListener(() {
      if (mounted) {
        final provider = Provider.of<ChatProvider>(context, listen: false);
        provider.setTyping(widget.conversation.id, _textController.text.trim().isNotEmpty);
      }
    });
  }

  @override
  void dispose() {
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _handleSend(ChatProvider provider) {
    final text = _textController.text.trim();
    if (text.isEmpty) return;

    _textController.clear();
    provider.sendTextMessage(widget.conversation.id, text);
    _scrollToBottom();
  }

  void _openGroupInfoDialog() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.xlBorder),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: const BoxDecoration(
                color: Color(0xFFEDE9FE),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.groups_rounded, color: Color(0xFF7C3AED), size: 22),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.conversation.title,
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: AppColors.textDark),
                  ),
                  const Text(
                    'Private 3-Person Group',
                    style: TextStyle(fontSize: 11, color: AppColors.textMuted, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'AUTHORIZED PARTICIPANTS (3)',
              style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: AppColors.textSubtle, letterSpacing: 0.6),
            ),
            const SizedBox(height: 10),
            _buildMemberRow('HaulBoX Admin', 'Operations & Compliance Admin', Icons.admin_panel_settings_rounded, AppColors.emeraldDark),
            _buildMemberRow('John D. Smith (You)', 'Assigned Driver', Icons.local_shipping_rounded, const Color(0xFF0284C7)),
            _buildMemberRow(
              widget.conversation.memberNames.length >= 3 ? widget.conversation.memberNames[2] : 'Sarah — Dispatcher',
              'Assigned Fleet Dispatcher',
              Icons.headset_mic_rounded,
              const Color(0xFF7C3AED),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.bgSecondary,
                borderRadius: AppRadius.mdBorder,
              ),
              child: const Row(
                children: [
                  Icon(Icons.lock_outline_rounded, size: 16, color: AppColors.textMuted),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Membership is managed automatically by HaulBoX Dispatch.',
                      style: TextStyle(fontSize: 11, color: AppColors.textMuted),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.emeraldPrimary),
            child: const Text('CLOSE', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
            onPressed: () => Navigator.pop(ctx),
          ),
        ],
      ),
    );
  }

  Widget _buildMemberRow(String name, String role, IconData icon, Color color) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 16, color: color),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: AppColors.textDark)),
                Text(role, style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _openAttachmentSheet(ChatProvider provider) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.borderLight,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Share Attachment',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: AppColors.textDark),
              ),
              const SizedBox(height: 16),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE0F2FE),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.photo_library_outlined, color: Color(0xFF0284C7)),
                ),
                title: const Text('Photo from Gallery', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark)),
                subtitle: const Text('Send cargo, truck, or facility picture', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  provider.sendImageMessage(widget.conversation.id, 'sample_photo.jpg');
                  _scrollToBottom();
                },
              ),
              const Divider(color: AppColors.borderLight, height: 1),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.emeraldSoft,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.description_outlined, color: AppColors.emeraldDark),
                ),
                title: const Text('BOL Document (PDF)', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark)),
                subtitle: const Text('BOL_HBX20241042.pdf • 2.4 MB', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  provider.sendDocumentMessage(widget.conversation.id, 'BOL_HBX20241042.pdf', '2.4 MB');
                  _scrollToBottom();
                },
              ),
              const Divider(color: AppColors.borderLight, height: 1),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.statusWarningSoft,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.receipt_long_outlined, color: Color(0xFFD97706)),
                ),
                title: const Text('Signed POD Receipt (PDF)', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.textDark)),
                subtitle: const Text('POD_Signed_Delivery.pdf • 1.8 MB', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  provider.sendDocumentMessage(widget.conversation.id, 'POD_Signed_Delivery.pdf', '1.8 MB');
                  _scrollToBottom();
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final chatProvider = Provider.of<ChatProvider>(context);
    final messages = chatProvider.getMessages(widget.conversation.id);
    final isTyping = chatProvider.isTyping(widget.conversation.id);
    final isAdmin = widget.conversation.type == ConversationType.adminDriver;
    final isGroup = widget.conversation.type == ConversationType.driverAdminDispatcherGroup;

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        titleSpacing: 0,
        backgroundColor: AppColors.navyDark,
        foregroundColor: Colors.white,
        elevation: 0,
        title: InkWell(
          onTap: isGroup ? _openGroupInfoDialog : null,
          child: Row(
            children: [
              Stack(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: isGroup
                            ? [const Color(0xFF8B5CF6), const Color(0xFF6D28D9)]
                            : (isAdmin
                                ? [AppColors.emeraldPrimary, const Color(0xFF047857)]
                                : [const Color(0xFF0284C7), const Color(0xFF0369A1)]),
                      ),
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: Icon(
                        isGroup
                            ? Icons.groups_rounded
                            : (isAdmin ? Icons.admin_panel_settings_rounded : Icons.headset_mic_rounded),
                        color: Colors.white,
                        size: 20,
                      ),
                    ),
                  ),
                  if (widget.conversation.isOnline)
                    Positioned(
                      bottom: 0,
                      right: 0,
                      child: Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                          color: AppColors.emeraldPrimary,
                          shape: BoxShape.circle,
                          border: Border.all(color: AppColors.navyDark, width: 1.5),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.conversation.title,
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Colors.white),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      isTyping
                          ? 'typing...'
                          : (isGroup ? '3 participants • Tap for info' : (widget.conversation.isOnline ? 'Online' : 'Offline')),
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: isTyping ? FontWeight.w800 : FontWeight.w500,
                        color: isTyping
                            ? const Color(0xFF4ADE80)
                            : (isGroup ? const Color(0xFFC4B5FD) : (widget.conversation.isOnline ? const Color(0xFF4ADE80) : const Color(0xFF94A3B8))),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          if (isGroup)
            IconButton(
              icon: const Icon(Icons.info_outline_rounded, color: Color(0xFFC4B5FD)),
              tooltip: 'Group Info',
              onPressed: _openGroupInfoDialog,
            )
          else
            IconButton(
              icon: const Icon(Icons.phone_outlined, color: Colors.white),
              tooltip: 'Direct line',
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('Calling direct line for ${widget.conversation.title}...'),
                    backgroundColor: AppColors.navyDark,
                  ),
                );
              },
            ),
        ],
      ),
      body: Column(
        children: [
          // Messages Thread
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              itemCount: messages.length + (isTyping ? 1 : 0),
              itemBuilder: (context, index) {
                if (index == messages.length && isTyping) {
                  return _buildTypingBubble();
                }

                final msg = messages[index];
                final showDateHeader = index == 0 || messages[index - 1].dateGroup != msg.dateGroup;

                return Column(
                  children: [
                    if (showDateHeader) _buildDateSeparator(msg.dateGroup),
                    _buildMessageBubble(msg),
                  ],
                );
              },
            ),
          ),

          // Message Composer (Keyboard-safe, WhatsApp style)
          _buildComposer(chatProvider),
        ],
      ),
    );
  }

  Widget _buildDateSeparator(String date) {
    return Center(
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 10),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.borderLight),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.02),
              blurRadius: 4,
              offset: const Offset(0, 1),
            ),
          ],
        ),
        child: Text(
          date,
          style: const TextStyle(
            fontSize: 10.5,
            fontWeight: FontWeight.w700,
            color: AppColors.textSubtle,
            letterSpacing: 0.4,
          ),
        ),
      ),
    );
  }

  Widget _buildMessageBubble(ChatMessageModel msg) {
    final isMe = msg.isMe;
    final isAdmin = msg.sender.toLowerCase().contains('admin');

    Color bubbleBgColor;
    Color bubbleBorderColor;

    if (isMe) {
      bubbleBgColor = AppColors.emeraldLight;
      bubbleBorderColor = AppColors.emeraldPrimary.withValues(alpha: 0.25);
    } else if (isAdmin) {
      // Professional soft/light pink for Admin messages
      bubbleBgColor = const Color(0xFFFDF2F8);
      bubbleBorderColor = const Color(0xFFFBCFE8);
    } else {
      bubbleBgColor = Colors.white;
      bubbleBorderColor = AppColors.borderLight;
    }

    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 6),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: bubbleBgColor,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(14),
            topRight: const Radius.circular(14),
            bottomLeft: Radius.circular(isMe ? 14 : 2),
            bottomRight: Radius.circular(isMe ? 2 : 14),
          ),
          border: Border.all(color: bubbleBorderColor, width: 1),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.03),
              blurRadius: 4,
              offset: const Offset(0, 1),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Sender name on incoming message
            if (!isMe)
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Text(
                  msg.sender,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: isAdmin ? const Color(0xFFBE185D) : const Color(0xFF0284C7),
                  ),
                ),
              ),

            // Message Body
            if (msg.type == MessageType.image) ...[
              Container(
                height: 140,
                width: double.infinity,
                decoration: BoxDecoration(
                  color: AppColors.bgSecondary,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.image_outlined, size: 36, color: AppColors.emeraldDark.withValues(alpha: 0.8)),
                      const SizedBox(height: 4),
                      const Text('Photo Attachment', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textDark)),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 4),
            ] else if (msg.type == MessageType.document) ...[
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: isMe ? Colors.white.withValues(alpha: 0.8) : AppColors.bgSecondary,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.borderLight),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: AppColors.emeraldSoft,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Icon(Icons.description_outlined, color: AppColors.emeraldDark, size: 20),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            msg.attachmentName ?? 'Document.pdf',
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12, color: AppColors.textDark),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            msg.attachmentSize ?? 'PDF Document',
                            style: const TextStyle(fontSize: 10.5, color: AppColors.textMuted),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 4),
            ] else ...[
              Text(
                msg.text,
                style: const TextStyle(
                  fontSize: 14,
                  color: AppColors.textDark,
                  fontWeight: FontWeight.w500,
                  height: 1.3,
                ),
              ),
            ],

            // Timestamp & Delivery Status
            Row(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                Text(
                  msg.time,
                  style: const TextStyle(
                    fontSize: 10,
                    color: AppColors.textSubtle,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (isMe) ...[
                  const SizedBox(width: 4),
                  _buildDeliveryStatusTick(msg.status),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDeliveryStatusTick(MessageDeliveryStatus status) {
    switch (status) {
      case MessageDeliveryStatus.sending:
        return const SizedBox(
          width: 10,
          height: 10,
          child: CircularProgressIndicator(strokeWidth: 1.5, color: AppColors.textSubtle),
        );
      case MessageDeliveryStatus.sent:
        return const Icon(Icons.check_rounded, size: 14, color: AppColors.textSubtle);
      case MessageDeliveryStatus.delivered:
        return const Icon(Icons.done_all_rounded, size: 14, color: AppColors.textSubtle);
      case MessageDeliveryStatus.read:
        return const Icon(Icons.done_all_rounded, size: 14, color: AppColors.emeraldDark);
    }
  }

  Widget _buildTypingBubble() {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.borderLight),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '${widget.conversation.title.split(' ').first} is typing',
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textMuted),
            ),
            const SizedBox(width: 6),
            const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.emeraldPrimary),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildComposer(ChatProvider provider) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(
          top: BorderSide(color: AppColors.borderLight, width: 1),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            // Attachment Button
            IconButton(
              icon: const Icon(Icons.attach_file_rounded, color: AppColors.textMuted, size: 22),
              onPressed: () => _openAttachmentSheet(provider),
            ),

            // Text Input Field
            Expanded(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  color: AppColors.bgSecondary,
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: AppColors.borderLight),
                ),
                child: TextField(
                  controller: _textController,
                  onSubmitted: (_) => _handleSend(provider),
                  decoration: const InputDecoration(
                    hintText: 'Type a message...',
                    hintStyle: TextStyle(color: AppColors.textSubtle, fontSize: 14),
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    filled: false,
                    contentPadding: EdgeInsets.symmetric(vertical: 10),
                    isDense: true,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 6),

            // POL-302: Voice-to-text mic button
            IconButton(
              icon: const Icon(Icons.mic_rounded, color: AppColors.textMuted, size: 24),
              tooltip: 'Voice to text',
              onPressed: () async {
                final transcribed = await VoiceInputSheet.show(context);
                if (transcribed != null && transcribed.isNotEmpty) {
                  _textController.text = transcribed;
                  _textController.selection = TextSelection.fromPosition(
                    TextPosition(offset: transcribed.length),
                  );
                }
              },
            ),

            // Send Button (Emerald)
            GestureDetector(
              onTap: () => _handleSend(provider),
              child: Container(
                width: 42,
                height: 42,
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    colors: [AppColors.emeraldPrimary, Color(0xFF059669)],
                  ),
                  shape: BoxShape.circle,
                ),
                child: const Center(
                  child: Icon(Icons.send_rounded, color: Colors.white, size: 18),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
