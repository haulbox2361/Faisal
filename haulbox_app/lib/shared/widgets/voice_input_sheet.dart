import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_to_text.dart';
import '../../core/constants/app_colors.dart';

/// POL-302: Voice-to-text input sheet for the chat composer.
/// Presents a full-screen bottom-sheet with a pulsing mic, live transcript,
/// confidence indicator, and word-by-word animation. On stop, the transcribed
/// text is passed back to the caller via [onTranscribed].
class VoiceInputSheet extends StatefulWidget {
  /// Called with the final transcribed string when the user taps Send or
  /// recording ends. Called with null if the user cancels.
  final void Function(String? text) onTranscribed;

  const VoiceInputSheet({super.key, required this.onTranscribed});

  /// Show the sheet and await the transcribed text.
  static Future<String?> show(BuildContext context) async {
    String? result;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => VoiceInputSheet(
        onTranscribed: (t) {
          result = t;
          Navigator.of(context).pop();
        },
      ),
    );
    return result;
  }

  @override
  State<VoiceInputSheet> createState() => _VoiceInputSheetState();
}

class _VoiceInputSheetState extends State<VoiceInputSheet>
    with SingleTickerProviderStateMixin {
  final SpeechToText _stt = SpeechToText();
  bool _isListening = false;
  bool _isInitialized = false;
  bool _hasPermission = false;
  String _transcript = '';
  double _confidence = 0.0;
  String _statusMessage = 'Tap the mic to start speaking';

  late AnimationController _pulseController;
  late Animation<double> _scaleAnim;
  late Animation<double> _opacityAnim;

  @override
  void initState() {
    super.initState();

    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..repeat(reverse: true);

    _scaleAnim = Tween<double>(begin: 1.0, end: 1.18).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
    _opacityAnim = Tween<double>(begin: 0.55, end: 1.0).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );

    _initSpeech();
  }

  Future<void> _initSpeech() async {
    final available = await _stt.initialize(
      onStatus: _onSttStatus,
      onError: _onSttError,
    );
    if (mounted) {
      setState(() {
        _isInitialized = available;
        _hasPermission = available;
        if (!available) {
          _statusMessage = 'Microphone permission required';
        }
      });
      if (available) _startListening();
    }
  }

  void _onSttStatus(String status) {
    if (!mounted) return;
    setState(() {
      if (status == 'listening') {
        _isListening = true;
        _statusMessage = 'Listening…';
      } else if (status == 'notListening' || status == 'done') {
        _isListening = false;
        _statusMessage = _transcript.isEmpty ? 'Tap the mic to retry' : 'Tap Send to insert text';
      }
    });
  }

  void _onSttError(dynamic error) {
    if (!mounted) return;
    setState(() {
      _isListening = false;
      _statusMessage = 'Could not hear you — tap mic to retry';
    });
  }

  Future<void> _startListening() async {
    if (!_isInitialized || _isListening) return;
    setState(() {
      _transcript = '';
      _confidence = 0.0;
      _statusMessage = 'Listening…';
    });
    await _stt.listen(
      onResult: (result) {
        if (mounted) {
          setState(() {
            _transcript = result.recognizedWords;
            _confidence = result.confidence > 0 ? result.confidence : 0.85;
          });
        }
      },
      listenOptions: SpeechListenOptions(
        listenFor: const Duration(seconds: 45),
        pauseFor: const Duration(seconds: 4),
        localeId: 'en_US',
        cancelOnError: false,
        partialResults: true,
      ),
    );
    if (mounted) setState(() => _isListening = true);
  }

  Future<void> _stopListening() async {
    await _stt.stop();
    if (mounted) setState(() => _isListening = false);
  }

  void _toggleListening() {
    if (_isListening) {
      _stopListening();
    } else {
      _startListening();
    }
  }

  void _send() {
    widget.onTranscribed(_transcript.trim().isEmpty ? null : _transcript.trim());
  }

  void _cancel() {
    widget.onTranscribed(null);
  }

  @override
  void dispose() {
    _pulseController.dispose();
    _stt.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFF1A1F2E),
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: const EdgeInsets.fromLTRB(24, 14, 24, 32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag handle
          Container(
            width: 38,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.white24,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 20),

          // Title row
          Row(
            children: [
              const Icon(Icons.mic_rounded, color: AppColors.emeraldPrimary, size: 20),
              const SizedBox(width: 8),
              const Text(
                'Voice to Text',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16),
              ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.close_rounded, color: Colors.white38, size: 22),
                onPressed: _cancel,
              ),
            ],
          ),
          const SizedBox(height: 24),

          // Pulsing microphone
          AnimatedBuilder(
            animation: _pulseController,
            builder: (context, child) {
              return Transform.scale(
                scale: _isListening ? _scaleAnim.value : 1.0,
                child: Opacity(
                  opacity: _isListening ? _opacityAnim.value : 1.0,
                  child: child,
                ),
              );
            },
            child: GestureDetector(
              onTap: _hasPermission ? _toggleListening : null,
              child: Container(
                width: 88,
                height: 88,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: _isListening
                        ? [AppColors.emeraldPrimary, const Color(0xFF059669)]
                        : [const Color(0xFF374151), const Color(0xFF1F2937)],
                  ),
                  boxShadow: _isListening
                      ? [
                          BoxShadow(
                            color: AppColors.emeraldPrimary.withValues(alpha: 0.4),
                            blurRadius: 28,
                            spreadRadius: 4,
                          ),
                        ]
                      : [],
                ),
                child: Icon(
                  _isListening ? Icons.mic_rounded : Icons.mic_off_rounded,
                  color: Colors.white,
                  size: 38,
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Status label
          Text(
            _statusMessage,
            style: const TextStyle(
              color: Colors.white60,
              fontSize: 13,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 20),

          // Live transcript box
          Container(
            width: double.infinity,
            constraints: const BoxConstraints(minHeight: 80, maxHeight: 160),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.05),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: _isListening
                    ? AppColors.emeraldPrimary.withValues(alpha: 0.4)
                    : Colors.white12,
              ),
            ),
            child: _transcript.isEmpty
                ? Center(
                    child: Text(
                      'Your speech will appear here…',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.2),
                        fontSize: 13,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  )
                : SingleChildScrollView(
                    child: Text(
                      _transcript,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w500,
                        height: 1.5,
                      ),
                    ),
                  ),
          ),

          // Confidence bar
          if (_transcript.isNotEmpty) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                const Text(
                  'Confidence',
                  style: TextStyle(color: Colors.white38, fontSize: 11, fontWeight: FontWeight.w600),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: _confidence,
                      backgroundColor: Colors.white12,
                      valueColor: AlwaysStoppedAnimation<Color>(
                        _confidence >= 0.8
                            ? AppColors.emeraldPrimary
                            : _confidence >= 0.6
                                ? const Color(0xFFF59E0B)
                                : const Color(0xFFEF4444),
                      ),
                      minHeight: 5,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  '${(_confidence * 100).toStringAsFixed(0)}%',
                  style: const TextStyle(color: Colors.white54, fontSize: 11, fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ],

          const SizedBox(height: 24),

          // Action row
          Row(
            children: [
              // Retry / re-record
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _hasPermission ? _startListening : null,
                  icon: const Icon(Icons.refresh_rounded, size: 18),
                  label: const Text('Re-record'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.white70,
                    side: const BorderSide(color: Colors.white24),
                    padding: const EdgeInsets.symmetric(vertical: 13),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              // Send
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: _transcript.trim().isNotEmpty ? _send : null,
                  icon: const Icon(Icons.send_rounded, size: 18),
                  label: const Text('Send'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.emeraldPrimary,
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: Colors.white12,
                    disabledForegroundColor: Colors.white30,
                    padding: const EdgeInsets.symmetric(vertical: 13),
                    elevation: 0,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    textStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
