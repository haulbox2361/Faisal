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
      id: json['id']?.toString() ?? 'drv-1',
      name: json['name']?.toString() ?? 'John D. Smith',
      email: json['email']?.toString() ?? 'john.smith@email.com',
      phone: json['phone']?.toString() ?? '(214) 555-0123',
      truck: json['truck']?.toString() ?? 'Truck # HBX-1042',
      company: json['company']?.toString() ?? 'HaulBoX Logistics',
      cdlNumber: json['cdlNumber']?.toString() ?? 'CDL12345678',
      cdlExpiration: json['cdlExpiration']?.toString() ?? 'Dec 15, 2026',
      address: json['address']?.toString() ?? '123 Driver St, Dallas, TX 75201',
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
