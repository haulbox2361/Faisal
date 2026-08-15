class TruckModel {
  final String truckNumber;
  final String vin;
  final String make;
  final String model;
  final String year;
  final String mileage;
  final String licensePlate;
  final String state;
  final String registrationExpiry;
  final String annualInspectionExpiry;
  final String iftaExpiry;
  final String insuranceExpiry;

  TruckModel({
    required this.truckNumber,
    required this.vin,
    required this.make,
    required this.model,
    required this.year,
    required this.mileage,
    required this.licensePlate,
    required this.state,
    required this.registrationExpiry,
    required this.annualInspectionExpiry,
    required this.iftaExpiry,
    required this.insuranceExpiry,
  });

  factory TruckModel.defaultTruck() {
    return TruckModel(
      truckNumber: 'Truck #101',
      vin: '1FUJGLDR9ELHP8821',
      make: 'Freightliner',
      model: 'Cascadia 126',
      year: '2023',
      mileage: '142,850 mi',
      licensePlate: 'TX-TRK-984',
      state: 'Texas',
      registrationExpiry: 'Mar 2027',
      annualInspectionExpiry: 'Nov 2026',
      iftaExpiry: 'Dec 2026',
      insuranceExpiry: 'Aug 2027',
    );
  }
}
