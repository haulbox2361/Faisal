import 'package:flutter_test/flutter_test.dart';
import 'package:haulbox_app/main.dart';

void main() {
  testWidgets('HaulBoxApp builds and displays dashboard', (WidgetTester tester) async {
    await tester.pumpWidget(const HaulBoxApp());
    await tester.pump();

    // Verify HaulBoX brand text exists
    expect(find.text('HaulBoX'), findsWidgets);
  });
}
