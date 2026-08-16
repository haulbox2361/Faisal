class DriverModel {
  final String id;
  final String name;
  final String? email;
  final String? phone;
  final String? truck;
  final String? company;
  final String? cdlNumber;
  final String? cdlExpiration;
  final String? address;
  final String status;
  final bool isOnline;
  final String? profilePhotoUrl;

  DriverModel({
    required this.id,
    required this.name,
    this.email,
    this.phone,
    this.truck,
    this.company,
    this.cdlNumber,
    this.cdlExpiration,
    this.address,
    this.status = 'ACTIVE',
    this.isOnline = true,
    this.profilePhotoUrl,
  });

  DriverModel copyWith({
    String? id,
    String? name,
    String? email,
    String? phone,
    String? truck,
    String? company,
    String? cdlNumber,
    String? cdlExpiration,
    String? address,
    String? status,
    bool? isOnline,
    String? profilePhotoUrl,
    bool clearPhoto = false,
  }) {
    return DriverModel(
      id: id ?? this.id,
      name: name ?? this.name,
      email: email ?? this.email,
      phone: phone ?? this.phone,
      truck: truck ?? this.truck,
      company: company ?? this.company,
      cdlNumber: cdlNumber ?? this.cdlNumber,
      cdlExpiration: cdlExpiration ?? this.cdlExpiration,
      address: address ?? this.address,
      status: status ?? this.status,
      isOnline: isOnline ?? this.isOnline,
      profilePhotoUrl: clearPhoto ? null : (profilePhotoUrl ?? this.profilePhotoUrl),
    );
  }

  factory DriverModel.fromJson(Map<String, dynamic> json) {
    return DriverModel(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? 'Driver',
      email: json['email']?.toString(),
      phone: json['phone']?.toString(),
      truck: json['truck']?.toString(),
      company: json['company']?.toString() ?? 'HaulBoX',
      cdlNumber: json['cdlNumber']?.toString() ?? json['cdl']?.toString(),
      cdlExpiration: json['cdlExpiration']?.toString(),
      address: json['address']?.toString(),
      status: json['status']?.toString() ?? 'ACTIVE',
      isOnline: json['isOnline'] != false,
      profilePhotoUrl: json['profilePhotoUrl']?.toString(),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'email': email,
    'phone': phone,
    'truck': truck,
    'company': company,
    'cdlNumber': cdlNumber,
    'cdlExpiration': cdlExpiration,
    'address': address,
    'status': status,
    'isOnline': isOnline,
    'profilePhotoUrl': profilePhotoUrl,
  };
}
