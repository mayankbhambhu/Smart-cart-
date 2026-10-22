/// Product preview returned by GET /v1/products/barcode/:code.
class ProductPreview {
  const ProductPreview({
    required this.productId,
    required this.barcode,
    required this.name,
    required this.brand,
    required this.pricePaise,
    required this.mrpPaise,
    required this.gstRateBp,
    required this.inStock,
    required this.aisle,
  });

  final String productId;
  final String barcode;
  final String name;
  final String? brand;
  final int pricePaise;
  final int mrpPaise;
  final int gstRateBp;

  /// Null when the store has no verified stock record for the product.
  final bool? inStock;
  final String? aisle;

  factory ProductPreview.fromJson(Map<String, dynamic> json) => ProductPreview(
        productId: json['productId'] as String,
        barcode: json['barcode'] as String,
        name: json['name'] as String,
        brand: json['brand'] as String?,
        pricePaise: json['pricePaise'] as int,
        mrpPaise: json['mrpPaise'] as int,
        gstRateBp: json['gstRateBp'] as int,
        inStock: json['inStock'] as bool?,
        aisle: json['aisle'] as String?,
      );
}
