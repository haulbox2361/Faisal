class StopModel {
  final int stopNumber;
  final String facilityName;
  final String address;
  final String city;
  final String state;
  final String? zip;
  final String? scheduledDate;
  final String status; // 'PENDING', 'ARRIVED', 'BOL_APPROVED', 'BOL_REJECTED', 'POD_APPROVED', 'POD_REJECTED'
  final bool hasDoc;
  final String docStatus;

  StopModel({
    required this.stopNumber,
    required this.facilityName,
    required this.address,
    required this.city,
    required this.state,
    this.zip,
    this.scheduledDate,
    this.status = 'PENDING',
    this.hasDoc = false,
    this.docStatus = 'PENDING',
  });

  factory StopModel.fromJson(Map<String, dynamic> json) {
    return StopModel(
      stopNumber: json['stopNumber'] ?? json['stop_number'] ?? 1,
      facilityName: json['facilityName']?.toString() ?? json['facility_name']?.toString() ?? '',
      address: json['address']?.toString() ?? '',
      city: json['city']?.toString() ?? '',
      state: json['state']?.toString() ?? '',
      zip: json['zip']?.toString(),
      scheduledDate: json['scheduledDate']?.toString() ?? json['scheduled_date']?.toString(),
      status: (json['status']?.toString() ?? 'PENDING').toUpperCase(),
      hasDoc: json['hasDoc'] == true,
      docStatus: json['docStatus']?.toString() ?? 'PENDING',
    );
  }

  Map<String, dynamic> toJson() => {
    'stopNumber': stopNumber,
    'facilityName': facilityName,
    'address': address,
    'city': city,
    'state': state,
    'zip': zip,
    'scheduledDate': scheduledDate,
    'status': status,
    'hasDoc': hasDoc,
    'docStatus': docStatus,
  };
}

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
  final List<StopModel> pickupStops;
  final List<StopModel> deliveryStops;

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
    this.pickupStops = const [],
    this.deliveryStops = const [],
  });

  bool get isMultiStop => pickupStops.length > 1 || deliveryStops.length > 1;

  LoadModel copyWith({
    String? id,
    String? loadNumber,
    String? brokerName,
    dynamic driverPay,
    dynamic grossAmount,
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
    List<StopModel>? pickupStops,
    List<StopModel>? deliveryStops,
  }) {
    return LoadModel(
      id: id ?? this.id,
      loadNumber: loadNumber ?? this.loadNumber,
      brokerName: brokerName ?? this.brokerName,
      driverPay: driverPay ?? this.driverPay,
      grossAmount: grossAmount ?? this.grossAmount,
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
      pickupStops: pickupStops ?? this.pickupStops,
      deliveryStops: deliveryStops ?? this.deliveryStops,
    );
  }

  factory LoadModel.fromJson(Map<String, dynamic> json) {
    final docs = json['documents'] as Map<String, dynamic>? ?? json['docs'] as Map<String, dynamic>?;
    
    // Determine BOL and POD status from documents map if present
    String bolSt = 'NOT_UPLOADED';
    String podSt = 'NOT_UPLOADED';
    if (docs != null) {
      if (docs['BOL'] != null && docs['BOL'] is Map) {
        final b = docs['BOL'] as Map;
        final hasFile = b['hasFile'] == true || b['name'] != null || b['data'] != null || b['url'] != null;
        if (hasFile) {
          final st = (b['status']?.toString() ?? 'Pending Verification').toUpperCase();
          if (st.contains('APPROV')) {
            bolSt = 'APPROVED';
          } else if (st.contains('REJECT')) {
            bolSt = 'REJECTED';
          } else {
            bolSt = 'PENDING_REVIEW';
          }
        }
      }
      if (docs['POD'] != null && docs['POD'] is Map) {
        final p = docs['POD'] as Map;
        final hasFile = p['hasFile'] == true || p['name'] != null || p['data'] != null || p['url'] != null;
        if (hasFile) {
          final st = (p['status']?.toString() ?? 'Pending Verification').toUpperCase();
          if (st.contains('APPROV')) {
            podSt = 'APPROVED';
          } else if (st.contains('REJECT')) {
            podSt = 'REJECTED';
          } else {
            podSt = 'PENDING_REVIEW';
          }
        }
      }
    }

    final pStopsRaw = json['pickupStops'] as List? ?? json['pickup_stops'] as List?;
    final dStopsRaw = json['deliveryStops'] as List? ?? json['delivery_stops'] as List?;

    final pStops = pStopsRaw?.map((e) => StopModel.fromJson(e as Map<String, dynamic>)).toList() ?? [];
    final dStops = dStopsRaw?.map((e) => StopModel.fromJson(e as Map<String, dynamic>)).toList() ?? [];

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
      pickupStops: pStops,
      deliveryStops: dStops,
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
    'pickupStops': pickupStops.map((e) => e.toJson()).toList(),
    'deliveryStops': deliveryStops.map((e) => e.toJson()).toList(),
  };

  Map<String, dynamic>? get docs => documents;
  String get pickupCityState => pickup.isNotEmpty ? pickup : (pickupAddress ?? 'Origin');
  String get dropoffCityState => dropoff.isNotEmpty ? dropoff : (dropoffAddress ?? 'Destination');
  
  /// Full Rate Confirmation (RC) load price shown clearly to driver
  double get fullGrossRate => double.tryParse((grossAmount ?? driverPay ?? 0).toString()) ?? 0.0;
  double get rcRateAmount {
    final val = grossAmount ?? driverPay;
    if (val is num) return val.toDouble();
    return double.tryParse(val?.toString() ?? '0') ?? 0.0;
  }

  String get displayRcPrice {
    final amt = rcRateAmount;
    if (amt <= 0) return '\$1,850';
    // Format with commas (e.g. $2,450)
    final rounded = amt.round();
    final str = rounded.toString();
    final reg = RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))');
    final formatted = str.replaceAllMapped(reg, (Match m) => '${m[1]},');
    return '\$$formatted';
  }

  String get displayWeightFormatted {
    if (weight == null) return '42,000 lbs';
    final numVal = int.tryParse(weight.toString().replaceAll(RegExp(r'[^0-9]'), ''));
    if (numVal != null && numVal > 0) {
      final str = numVal.toString();
      final reg = RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))');
      final formatted = str.replaceAllMapped(reg, (Match m) => '${m[1]},');
      return '$formatted lbs';
    }
    return '$weight lbs';
  }
}
