import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../shared/models/conversation_model.dart';
import 'chat_provider.dart';
import 'conversation_detail_screen.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final chatProvider = Provider.of<ChatProvider>(context);
    final allConversations = chatProvider.conversations;

    final filteredConversations = _searchQuery.isEmpty
        ? allConversations
        : allConversations.where((c) {
            final titleMatch = c.title.toLowerCase().contains(_searchQuery.toLowerCase());
            final lastMsgMatch = c.lastMessage.toLowerCase().contains(_searchQuery.toLowerCase());
            return titleMatch || lastMsgMatch;
          }).toList();

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        title: const Text(
          'Chat',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: -0.4),
        ),
      ),
      body: Column(
        children: [
          // SEARCH MESSAGES / CONVERSATIONS BAR
          Container(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            color: Colors.white,
            child: TextField(
              controller: _searchController,
              onChanged: (val) {
                setState(() {
                  _searchQuery = val.trim();
                });
              },
              decoration: InputDecoration(
                hintText: 'Search chats or messages...',
                hintStyle: const TextStyle(color: AppColors.textMuted, fontSize: 13.5),
                prefixIcon: const Icon(Icons.search_rounded, color: AppColors.textMuted, size: 20),
                suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear_rounded, size: 18, color: AppColors.textMuted),
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _searchQuery = '');
                        },
                      )
                    : null,
                filled: true,
                fillColor: AppColors.bgSecondary,
                contentPadding: const EdgeInsets.symmetric(vertical: 10),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: AppColors.borderLight),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: AppColors.borderLight),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: AppColors.emeraldPrimary, width: 1.5),
                ),
              ),
            ),
          ),
          const Divider(height: 1, color: AppColors.borderLight),

          Expanded(
            child: ListView(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              children: [
                Padding(
                  padding: const EdgeInsets.only(left: 4, bottom: 8),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'AUTHORIZED CONVERSATIONS (${filteredConversations.length})',
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textSubtle,
                          letterSpacing: 0.6,
                        ),
                      ),
                      if (chatProvider.totalUnreadCount > 0)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppColors.statusDanger,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            '${chatProvider.totalUnreadCount} unread',
                            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: Colors.white),
                          ),
                        ),
                    ],
                  ),
                ),

                if (filteredConversations.isEmpty)
                  Container(
                    padding: const EdgeInsets.all(28),
                    child: Column(
                      children: [
                        const Icon(Icons.search_off_rounded, size: 42, color: AppColors.textSubtle),
                        const SizedBox(height: 10),
                        Text(
                          'No conversations match "$_searchQuery"',
                          style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.textSecondary, fontSize: 13),
                        ),
                      ],
                    ),
                  )
                else
                  ...filteredConversations.map((conv) => _buildConversationCard(context, conv, chatProvider)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildConversationCard(BuildContext context, ConversationModel conv, ChatProvider chatProvider) {
    final isAdmin = conv.type == ConversationType.adminDriver;
    final isGroup = conv.type == ConversationType.driverAdminDispatcherGroup;

    IconData iconData = Icons.headset_mic_rounded;
    List<Color> gradientColors = [const Color(0xFF0284C7), const Color(0xFF0369A1)];

    if (isAdmin) {
      iconData = Icons.admin_panel_settings_rounded;
      gradientColors = [AppColors.emeraldPrimary, const Color(0xFF047857)];
    } else if (isGroup) {
      iconData = Icons.groups_rounded;
      gradientColors = [const Color(0xFF8B5CF6), const Color(0xFF6D28D9)];
    }

    final isTyping = chatProvider.isTyping(conv.id);

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadius.lgBorder,
        border: Border.all(color: AppColors.borderLight, width: 1),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: AppRadius.lgBorder,
        child: InkWell(
          borderRadius: AppRadius.lgBorder,
          onTap: () {
            chatProvider.markAsRead(conv.id);
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => ConversationDetailScreen(conversation: conv),
              ),
            );
          },
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                // Avatar with Online Presence Dot
                Stack(
                  children: [
                    Container(
                      width: 50,
                      height: 50,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: gradientColors,
                        ),
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: gradientColors.first.withValues(alpha: 0.25),
                            blurRadius: 8,
                            offset: const Offset(0, 3),
                          ),
                        ],
                      ),
                      child: Center(
                        child: Icon(iconData, color: Colors.white, size: 24),
                      ),
                    ),
                    if (conv.isOnline)
                      Positioned(
                        right: 0,
                        bottom: 0,
                        child: Container(
                          width: 13,
                          height: 13,
                          decoration: BoxDecoration(
                            color: const Color(0xFF22C55E),
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.white, width: 2),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(width: 14),

                // Name + Role + Last Message
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                            child: Text(
                              conv.title,
                              style: const TextStyle(
                                fontSize: 14.5,
                                fontWeight: FontWeight.w900,
                                color: AppColors.textDark,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          Text(
                            conv.lastMessageTime,
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: conv.unreadCount > 0 ? FontWeight.w800 : FontWeight.w500,
                              color: conv.unreadCount > 0 ? AppColors.emeraldDark : AppColors.textMuted,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        conv.subtitle,
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textSubtle,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 5),
                      if (isTyping)
                        const Row(
                          children: [
                            SizedBox(
                              width: 12,
                              height: 12,
                              child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.emeraldPrimary),
                            ),
                            SizedBox(width: 6),
                            Text(
                              'typing...',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: AppColors.emeraldPrimary,
                                fontStyle: FontStyle.italic,
                              ),
                            ),
                          ],
                        )
                      else
                        Text(
                          conv.lastMessage,
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: conv.unreadCount > 0 ? FontWeight.w700 : FontWeight.normal,
                            color: conv.unreadCount > 0 ? AppColors.textDark : AppColors.textSecondary,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                    ],
                  ),
                ),

                // Unread Count Badge
                if (conv.unreadCount > 0) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.emeraldPrimary,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      '${conv.unreadCount}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
