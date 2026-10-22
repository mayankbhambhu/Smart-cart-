import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/stores_repository.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stores = ref.watch(storesProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Smart Cart')),
      body: stores.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _ErrorView(
          message: 'Could not reach the store server.',
          onRetry: () => ref.invalidate(storesProvider),
        ),
        data: (list) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Choose your store', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final s in list)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.storefront),
                  title: Text(s.name),
                  subtitle: Text(s.city),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.push('/pair'),
                ),
              ),
            const SizedBox(height: 24),
            OutlinedButton.icon(
              icon: const Icon(Icons.qr_code_2),
              label: const Text('Look up a product by barcode'),
              onPressed: () => context.push('/lookup'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message),
          const SizedBox(height: 12),
          FilledButton(onPressed: onRetry, child: const Text('Try again')),
        ],
      ),
    );
  }
}
