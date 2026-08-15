class LoadModel {
  final String id;
  final String loadNumber;
  final String brokerName;
  final dynamic driverPay;
  final String status;
  final String driverProgress;
  final String pickup;
  final String dropoff;
  final String pickupDate;
  final String pickupTime;
  final String deliveryDate;
  final String deliveryTime;
  final dynamic miles;
  final dynamic milesRemaining;
  final String eta;
  final String? pickupAddress;
  final String? pickupContact;
  final String? pickupPhone;
  final String? dropoffAddress;
  final String? dropoffContact;
  final String? dropoffPhone;
  final String? notes;
  final dynamic weight;
  final String? commodity;
  final String? trailerType;
  final String? bolStatus; // 'VERIFIED', 'PENDING', 'REJECTED'
  final String? podStatus; // 'VERIFIED', 'PENDING', 'REJECTED'
  final String? bolRejectionReason;
  final String? podRejectionReason;
  final String? paymentStatus; // 'PAID', 'PENDING', 'PROCESSING'
  final String? paymentDate;
  final List<String> loadingPhotos;
  final List<String> unloadingPhotos;
  final Map<String, dynamic>? documents;

  LoadModel({
    required this.id,
    required this.loadNumber,
    required this.brokerName,
    this.driverPay,
    required this.status,
    required this.driverProgress,
    required this.pickup,
    required this.dropoff,
    required this.pickupDate,
    required this.pickupTime,
    required this.deliveryDate,
    required this.deliveryTime,
    this.miles,
    this.milesRemaining,
    this.eta = '04h 32m',
    this.pickupAddress,
    this.pickupContact,
    this.pickupPhone,
    this.dropoffAddress,
    this.dropoffContact,
    this.dropoffPhone,
    this.notes,
    this.weight,
    this.commodity,
    this.trailerType,
    this.bolStatus = 'VERIFIED',
    this.podStatus = 'PENDING',
    this.bolRejectionReason,
    this.podRejectionReason,
    this.paymentStatus = 'PENDING',
    this.paymentDate,
    this.loadingPhotos = const [],
    this.unloadingPhotos = const [],
    this.documents,
  });

  LoadModel copyWith({
    String? id,
    String? loadNumber,
    String? brokerName,
    dynamic driverPay,
    String? status,
    String? driverProgress,
    String? pickup,
    String? dropoff,
    String? pickupDate,
    String? pickupTime,
    String? deliveryDate,
    String? deliveryTime,
    dynamic miles,
    dynamic milesRemaining,
    String? eta,
    String? pickupAddress,
    String? pickupContact,
    String? pickupPhone,
    String? dropoffAddress,
    String? dropoffContact,
    String? dropoffPhone,
    String? notes,
    dynamic weight,
    String? commodity,
    String? trailerType,
    String? bolStatus,
    String? podStatus,
    String? bolRejectionReason,
    String? podRejectionReason,
    String? paymentStatus,
    String? paymentDate,
    List<String>? loadingPhotos,
    List<String>? unloadingPhotos,
    Map<String, dynamic>? documents,
  }) {
    return LoadModel(
      id: id ?? this.id,
      loadNumber: loadNumber ?? this.loadNumber,
      brokerName: brokerName ?? this.brokerName,
      driverPay: driverPay ?? this.driverPay,
      status: status ?? this.status,
      driverProgress: driverProgress ?? this.driverProgress,
      pickup: pickup ?? this.pickup,
      dropoff: dropoff ?? this.dropoff,
      pickupDate: pickupDate ?? this.pickupDate,
      pickupTime: pickupTime ?? this.pickupTime,
      deliveryDate: deliveryDate ?? this.deliveryDate,
      deliveryTime: deliveryTime ?? this.deliveryTime,
      miles: miles ?? this.miles,
      milesRemaining: milesRemaining ?? this.milesRemaining,
      eta: eta ?? this.eta,
      pickupAddress: pickupAddress ?? this.pickupAddress,
      pickupContact: pickupContact ?? this.pickupContact,
      pickupPhone: pickupPhone ?? this.pickupPhone,
      dropoffAddress: dropoffAddress ?? this.dropoffAddress,
      dropoffContact: dropoffContact ?? this.dropoffContact,
      dropoffPhone: dropoffPhone ?? this.dropoffPhone,
      notes: notes ?? this.notes,
      weight: weight ?? this.weight,
      commodity: commodity ?? this.commodity,
      trailerType: trailerType ?? this.trailerType,
      bolStatus: bolStatus ?? this.bolStatus,
      podStatus: podStatus ?? this.podStatus,
      bolRejectionReason: bolRejectionReason ?? this.bolRejectionReason,
      podRejectionReason: podRejectionReason ?? this.podRejectionReason,
      paymentStatus: paymentStatus ?? this.paymentStatus,
      paymentDate: paymentDate ?? this.paymentDate,
      loadingPhotos: loadingPhotos ?? this.loadingPhotos,
      unloadingPhotos: unloadingPhotos ?? this.unloadingPhotos,
      documents: documents ?? this.documents,
    );
  }

  factory LoadModel.fromJson(Map<String, dynamic> json) {
    return LoadModel(
      id: json['id']?.toString() ?? '',
      loadNumber: json['loadNumber']?.toString() ?? json['load_number']?.toString() ?? 'HBX-2024-1042',
      brokerName: json['brokerName']?.toString() ?? json['broker_name']?.toString() ?? 'Rapid Freight Inc.',
      driverPay: json['driverPay'] ?? json['driver_pay'] ?? json['rate'] ?? 1850.0,
      status: (json['status']?.toString() ?? 'ASSIGNED').toUpperCase(),
      driverProgress: (json['driverProgress']?.toString() ?? json['driver_progress']?.toString() ?? 'ASSIGNED').toUpperCase(),
      pickup: json['pickup']?.toString() ?? 'Dallas, TX',
      dropoff: json['dropoff']?.toString() ?? 'Houston, TX',
      pickupDate: json['pickupDate']?.toString() ?? json['pickup_date']?.toString() ?? 'May 15, 2026',
      pickupTime: json['pickupTime']?.toString() ?? json['pickup_time']?.toString() ?? '08:00 AM',
      deliveryDate: json['deliveryDate']?.toString() ?? json['delivery_date']?.toString() ?? 'May 16, 2026',
      deliveryTime: json['deliveryTime']?.toString() ?? json['delivery_time']?.toString() ?? '02:00 PM',
      miles: json['miles'] ?? 245,
      milesRemaining: json['milesRemaining'] ?? json['miles_remaining'] ?? 245,
      eta: json['eta']?.toString() ?? '04h 32m',
      pickupAddress: json['pickupAddress']?.toString() ?? json['pickup_address']?.toString() ?? '123 Logistics Blvd, Dallas, TX 75201',
      pickupContact: json['pickupContact']?.toString() ?? json['pickup_contact']?.toString(),
      pickupPhone: json['pickupPhone']?.toString() ?? json['pickup_phone']?.toString(),
      dropoffAddress: json['dropoffAddress']?.toString() ?? json['dropoff_address']?.toString() ?? '700 Warehouse St, Houston, TX 77001',
      dropoffContact: json['dropoffContact']?.toString() ?? json['dropoff_contact']?.toString(),
      dropoffPhone: json['dropoffPhone']?.toString() ?? json['dropoff_phone']?.toString(),
      notes: json['notes']?.toString() ?? 'Receiver requested delivery at dock 4.',
      weight: json['weight'] ?? '42,500 lbs',
      commodity: json['commodity']?.toString() ?? 'General Merchandise',
      trailerType: json['trailerType']?.toString() ?? json['trailer_type']?.toString() ?? '53ft Dry Van',
      bolStatus: json['bolStatus']?.toString() ?? 'VERIFIED',
      podStatus: json['podStatus']?.toString() ?? 'PENDING',
      bolRejectionReason: json['bolRejectionReason']?.toString(),
      podRejectionReason: json['podRejectionReason']?.toString(),
      paymentStatus: json['paymentStatus']?.toString() ?? 'PENDING',
      paymentDate: json['paymentDate']?.toString(),
      loadingPhotos: (json['loadingPhotos'] as List?)?.map((e) => e.toString()).toList() ?? [],
      unloadingPhotos: (json['unloadingPhotos'] as List?)?.map((e) => e.toString()).toList() ?? [],
      documents: json['documents'] as Map<String, dynamic>?,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'loadNumber': loadNumber,
    'brokerName': brokerName,
    'driverPay': driverPay,
    'status': status,
    'driverProgress': driverProgress,
    'pickup': pickup,
    'dropoff': dropoff,
    'pickupDate': pickupDate,
    'pickupTime': pickupTime,
    'deliveryDate': deliveryDate,
    'deliveryTime': deliveryTime,
    'miles': miles,
    'milesRemaining': milesRemaining,
    'eta': eta,
    'pickupAddress': pickupAddress,
    'dropoffAddress': dropoffAddress,
    'notes': notes,
    'weight': weight,
    'commodity': commodity,
    'trailerType': trailerType,
    'bolStatus': bolStatus,
    'podStatus': podStatus,
    'paymentStatus': paymentStatus,
    'paymentDate': paymentDate,
  };
}
