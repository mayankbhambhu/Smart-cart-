import 'package:flutter/material.dart';

/// Placeholder. Milestone 2 adds the camera QR scanner (mobile_scanner) and POST /v1/carts/pair.
class PairCartScreen extends StatelessWidget {
  const PairCartScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Pair a cart')),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Scan the QR code on your cart to start shopping.\n\nCart pairing arrives in milestone 2.',
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
