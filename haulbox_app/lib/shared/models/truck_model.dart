class TruckModel {
  final String truckNumber;
  final String vin;
  final String make;
  final String model;
  final String year;
  final String? mileage;
  final String? licensePlate;
  final String? state;
  final String? registrationExpiry;
  final String? annualInspectionExpiry;
  final String? iftaExpiry;
  final String? insuranceExpiry;
  final String? eldHardwareId;
  final String? transponderId;
  final String? fuelType;

  TruckModel({
    required this.truckNumber,
    required this.vin,
    required this.make,
    required this.model,
    required this.year,
    this.mileage,
    this.licensePlate,
    this.state,
    this.registrationExpiry,
    this.annualInspectionExpiry,
    this.iftaExpiry,
    this.insuranceExpiry,
    this.eldHardwareId,
    this.transponderId,
    this.fuelType,
  });

  factory TruckModel.fromDriver(dynamic driver) {
    if (driver == null) {
      return TruckModel.empty();
    }
    final truckNum = driver.truck?.toString().trim();
    return TruckModel(
      truckNumber: (truckNum != null && truckNum.isNotEmpty) ? truckNum : 'Not Assigned',
      vin: 'Not Configured',
      make: 'Not Specified',
      model: 'Not Specified',
      year: '—',
      mileage: null,
      licensePlate: null,
      state: null,
      registrationExpiry: null,
      annualInspectionExpiry: null,
      iftaExpiry: null,
      insuranceExpiry: null,
      eldHardwareId: null,
      transponderId: null,
      fuelType: null,
    );
  }

  factory TruckModel.fromJson(Map<String, dynamic> json) {
    final t = json['truck'] is Map ? json['truck'] as Map<String, dynamic> : json;
    final num = (t['number'] ?? t['truckNumber'] ?? t['truck'])?.toString().trim();
    return TruckModel(
      truckNumber: (num != null && num.isNotEmpty) ? num : 'Not Assigned',
      vin: t['vin']?.toString() ?? 'Not Configured',
      make: t['make']?.toString() ?? 'Not Specified',
      model: t['model']?.toString() ?? 'Not Specified',
      year: t['year']?.toString() ?? '—',
      mileage: t['mileage']?.toString(),
      licensePlate: t['licensePlate']?.toString(),
      state: t['state']?.toString(),
      registrationExpiry: t['registrationExpiry']?.toString(),
      annualInspectionExpiry: t['annualInspectionExpiry']?.toString(),
      iftaExpiry: t['iftaExpiry']?.toString(),
      insuranceExpiry: t['insuranceExpiry']?.toString(),
      eldHardwareId: t['eldHardwareId']?.toString(),
      transponderId: t['transponderId']?.toString(),
      fuelType: t['fuelType']?.toString(),
    );
  }

  factory TruckModel.empty() {
    return TruckModel(
      truckNumber: 'Not Assigned',
      vin: 'Not Configured',
      make: 'Not Specified',
      model: 'Not Specified',
      year: '—',
      mileage: null,
      licensePlate: null,
      state: null,
      registrationExpiry: null,
      annualInspectionExpiry: null,
      iftaExpiry: null,
      insuranceExpiry: null,
      eldHardwareId: null,
      transponderId: null,
      fuelType: null,
    );
  }
}
