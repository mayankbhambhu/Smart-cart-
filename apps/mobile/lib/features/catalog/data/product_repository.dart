import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api_client.dart';
import '../domain/product.dart';

class ProductRepository {
  ProductRepository(this._dio);

  final Dio _dio;

  /// Returns null when the barcode is not in the store's catalogue.
  Future<ProductPreview?> byBarcode(String code, {String storeId = 'S-01'}) async {
    try {
      final res = await _dio.get<Map<String, dynamic>>(
        '/v1/products/barcode/$code',
        queryParameters: {'storeId': storeId},
      );
      return ProductPreview.fromJson(res.data!);
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) return null;
      rethrow;
    }
  }
}

final productRepositoryProvider = Provider((ref) => ProductRepository(ref.watch(dioProvider)));
