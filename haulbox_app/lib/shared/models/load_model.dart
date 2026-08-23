class LoadModel {
  final String id;
  final String loadNumber;
  final String brokerName;
  final dynamic driverPay;
  final dynamic grossAmount;
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
    this.grossAmount,
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
    final docs = json['documents'] as Map<String, dynamic>? ?? json['docs'] as Map<String, dynamic>?;
    
    // Determine BOL and POD status from documents map if present
    String bolSt = 'PENDING';
    String podSt = 'PENDING';
    if (docs != null) {
      if (docs['BOL'] != null && (docs['BOL']['hasFile'] == true || docs['BOL']['name'] != null)) {
        bolSt = 'VERIFIED';
      }
      if (docs['POD'] != null && (docs['POD']['hasFile'] == true || docs['POD']['name'] != null)) {
        podSt = 'VERIFIED';
      }
    }

    return LoadModel(
      id: json['id']?.toString() ?? '',
      loadNumber: json['loadNumber']?.toString() ?? json['load_number']?.toString() ?? 'Load',
      brokerName: json['brokerName']?.toString() ?? json['broker_name']?.toString() ?? 'Broker',
      driverPay: json['driverPay'] ?? json['driver_pay'] ?? json['brokerRate'] ?? json['rate'] ?? 0,
      grossAmount: json['grossAmount'] ?? json['loadAmount'] ?? json['brokerRate'] ?? json['rate'] ?? json['driverPay'] ?? 0,
      status: (json['status']?.toString() ?? 'ASSIGNED').toUpperCase(),
      driverProgress: (json['driverProgress']?.toString() ?? json['driver_progress']?.toString() ?? json['status']?.toString() ?? 'ASSIGNED').toUpperCase(),
      pickup: json['pickup']?.toString() ?? '',
      dropoff: json['dropoff']?.toString() ?? '',
      pickupDate: json['pickupDate']?.toString() ?? json['pickup_date']?.toString() ?? '',
      pickupTime: json['pickupTime']?.toString() ?? json['pickup_time']?.toString() ?? '',
      deliveryDate: json['deliveryDate']?.toString() ?? json['delivery_date']?.toString() ?? '',
      deliveryTime: json['deliveryTime']?.toString() ?? json['delivery_time']?.toString() ?? '',
      miles: json['miles'] ?? 0,
      milesRemaining: json['milesRemaining'] ?? json['miles_remaining'] ?? json['miles'] ?? 0,
      eta: json['eta']?.toString() ?? '',
      pickupAddress: json['pickupAddress']?.toString() ?? json['pickup_address']?.toString(),
      pickupContact: json['pickupContact']?.toString() ?? json['pickup_contact']?.toString(),
      pickupPhone: json['pickupPhone']?.toString() ?? json['pickup_phone']?.toString(),
      dropoffAddress: json['dropoffAddress']?.toString() ?? json['dropoff_address']?.toString(),
      dropoffContact: json['dropoffContact']?.toString() ?? json['dropoff_contact']?.toString(),
      dropoffPhone: json['dropoffPhone']?.toString() ?? json['dropoff_phone']?.toString(),
      notes: json['notes']?.toString(),
      weight: json['weight'],
      commodity: json['commodity']?.toString(),
      trailerType: json['trailerType']?.toString() ?? json['trailer_type']?.toString(),
      bolStatus: json['bolStatus']?.toString() ?? bolSt,
      podStatus: json['podStatus']?.toString() ?? podSt,
      bolRejectionReason: json['bolRejectionReason']?.toString(),
      podRejectionReason: json['podRejectionReason']?.toString(),
      paymentStatus: (json['paymentStatus']?.toString() ?? (json['driverPaid'] == true ? 'PAID' : 'PENDING')).toUpperCase(),
      paymentDate: json['paymentDate']?.toString() ?? json['driverPaidDate']?.toString(),
      loadingPhotos: (json['loadingPhotos'] as List?)?.map((e) => e.toString()).toList() ?? [],
      unloadingPhotos: (json['unloadingPhotos'] as List?)?.map((e) => e.toString()).toList() ?? [],
      documents: docs,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'loadNumber': loadNumber,
    'brokerName': brokerName,
    'driverPay': driverPay,
    'grossAmount': grossAmount,
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

  Map<String, dynamic>? get docs => documents;
  String get pickupCityState => pickup.isNotEmpty ? pickup : (pickupAddress ?? 'Origin');
  String get dropoffCityState => dropoff.isNotEmpty ? dropoff : (dropoffAddress ?? 'Destination');
  double get fullGrossRate => double.tryParse((grossAmount ?? driverPay ?? 0).toString()) ?? 0.0;
}
