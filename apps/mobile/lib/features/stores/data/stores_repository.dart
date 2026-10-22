import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api_client.dart';

class Store {
  const Store({required this.id, required this.name, required this.city});

  final String id;
  final String name;
  final String city;

  factory Store.fromJson(Map<String, dynamic> json) => Store(
        id: json['id'] as String,
        name: json['name'] as String,
        city: json['city'] as String,
      );
}

final storesProvider = FutureProvider<List<Store>>((ref) async {
  final res = await ref.watch(dioProvider).get<Map<String, dynamic>>('/v1/stores');
  final list = res.data!['stores'] as List<dynamic>;
  return list.map((e) => Store.fromJson(e as Map<String, dynamic>)).toList();
});
