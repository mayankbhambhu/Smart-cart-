import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'features/cart/ui/pair_cart_screen.dart';
import 'features/catalog/ui/product_lookup_screen.dart';
import 'features/stores/ui/home_screen.dart';

final _router = GoRouter(
  routes: [
    GoRoute(path: '/', builder: (context, state) => const HomeScreen()),
    GoRoute(path: '/pair', builder: (context, state) => const PairCartScreen()),
    GoRoute(path: '/lookup', builder: (context, state) => const ProductLookupScreen()),
  ],
);

class SmartCartApp extends StatelessWidget {
  const SmartCartApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Smart Cart',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0B7A3E)),
        useMaterial3: true,
      ),
      routerConfig: _router,
    );
  }
}
