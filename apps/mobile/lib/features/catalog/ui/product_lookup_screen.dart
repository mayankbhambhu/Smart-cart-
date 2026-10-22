import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/money.dart';
import '../data/product_repository.dart';
import '../domain/product.dart';

/// Manual barcode entry. Milestone 2 replaces the text field with the camera scanner.
class ProductLookupScreen extends ConsumerStatefulWidget {
  const ProductLookupScreen({super.key});

  @override
  ConsumerState<ProductLookupScreen> createState() => _ProductLookupScreenState();
}

class _ProductLookupScreenState extends ConsumerState<ProductLookupScreen> {
  final _controller = TextEditingController();
  ProductPreview? _product;
  String? _message;
  bool _loading = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _lookup() async {
    final code = _controller.text.trim();
    if (code.isEmpty) return;
    setState(() {
      _loading = true;
      _message = null;
      _product = null;
    });
    try {
      final product = await ref.read(productRepositoryProvider).byBarcode(code);
      setState(() {
        _product = product;
        _message = product == null ? 'No product with barcode $code in this store.' : null;
      });
    } catch (_) {
      setState(() => _message = 'Could not reach the store server.');
    } finally {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _product;
    return Scaffold(
      appBar: AppBar(title: const Text('Look up product')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _controller,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Barcode (EAN-13)',
              hintText: '2000000000015',
              border: OutlineInputBorder(),
            ),
            onSubmitted: (_) => _lookup(),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _loading ? null : _lookup,
            child: _loading
                ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Look up'),
          ),
          const SizedBox(height: 24),
          if (_message != null) Text(_message!),
          if (p != null)
            Card(
              child: ListTile(
                title: Text(p.name),
                subtitle: Text([
                  if (p.aisle != null) 'Aisle ${p.aisle}',
                  if (p.inStock == false) 'Out of stock',
                  'GST ${p.gstRateBp / 100}%',
                ].join(' · ')),
                trailing: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(formatInr(p.pricePaise), style: Theme.of(context).textTheme.titleMedium),
                    if (p.mrpPaise > p.pricePaise)
                      Text(
                        'MRP ${formatInr(p.mrpPaise)}',
                        style: const TextStyle(decoration: TextDecoration.lineThrough),
                      ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
