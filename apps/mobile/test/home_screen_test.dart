import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smart_cart/app.dart';
import 'package:smart_cart/features/stores/data/stores_repository.dart';

void main() {
  testWidgets('home lists stores from the API', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        storesProvider.overrideWith(
          (ref) async => const [Store(id: 'S-01', name: 'DMart Pilot Store (demo)', city: 'Mumbai')],
        ),
      ],
      child: const SmartCartApp(),
    ));
    await tester.pumpAndSettle();

    expect(find.text('DMart Pilot Store (demo)'), findsOneWidget);
    expect(find.text('Mumbai'), findsOneWidget);
    expect(find.byIcon(Icons.storefront), findsOneWidget);
  });
}
