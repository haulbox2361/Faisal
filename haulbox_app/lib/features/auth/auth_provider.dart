import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/network/api_client.dart';
import '../../shared/models/driver_model.dart';
import '../../shared/models/load_model.dart';
import '../../shared/models/payment_model.dart';

class AuthProvider extends ChangeNotifier {
  DriverModel? _driver;
  String? _token;
  String _companyName = 'HaulBoX';
  List<LoadModel> _loads = [];
  List<PaymentModel> _payments = [];
  bool _isLoading = false;
  String? _errorMessage;

  DriverModel? get driver => _driver ?? DriverModel(
    id: 'D-101',
    name: 'John D. Smith',
    truck: 'Truck # HBX-1042',
    phone: '(214) 555-0123',
    email: 'john.smith@email.com',
    cdlNumber: 'CDL12345678',
    cdlExpiration: 'Dec 15, 2026',
    address: '123 Driver St, Dallas, TX 75201',
    status: 'ACTIVE',
  );

  String? get token => _token;
  String get companyName => _companyName;
  List<LoadModel> get loads => _loads;
  List<PaymentModel> get payments => _payments;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  bool get isAuthenticated => true;

  LoadModel? get currentLoad {
    if (_loads.isEmpty) {
      _seedDefaultData();
    }
    final active = _loads.where((l) => !['DELIVERED', 'COMPLETED', 'CANCELLED'].contains(l.status.toUpperCase())).toList();
    if (active.isNotEmpty) return active.first;
    return _loads.isNotEmpty ? _loads.first : null;
  }

  void _seedDefaultData() {
    final now = DateTime.now();
    final thisMonday = now.subtract(Duration(days: now.weekday - DateTime.monday));
    final lastMonday = thisMonday.subtract(const Duration(days: 7));
    final lastWednesday = lastMonday.add(const Duration(days: 2));
    final lastMonthMid = DateTime(now.year, now.month - 1, 15);

    final df = DateFormat('MMM d, yyyy');

    _loads = [
      // 1. Current Active Run
      LoadModel(
        id: 'ld-1042',
        loadNumber: 'HBX-2024-1042',
        brokerName: 'Rapid Freight Inc.',
        driverPay: 1850.0,
        status: 'IN TRANSIT',
        driverProgress: 'GOING_TO_DELIVERY',
        pickup: 'Dallas, TX',
        dropoff: 'Houston, TX',
        pickupDate: df.format(now),
        pickupTime: '08:00 AM',
        deliveryDate: df.format(now.add(const Duration(days: 1))),
        deliveryTime: '02:00 PM',
        miles: 245,
        milesRemaining: 245,
        eta: '04h 32m',
        pickupAddress: '123 Logistics Blvd, Dallas, TX 75201',
        dropoffAddress: '700 Warehouse St, Houston, TX 77001',
        weight: '42,500 lbs',
        commodity: 'General Merchandise',
        trailerType: '53ft Dry Van',
        bolStatus: 'VERIFIED',
        podStatus: 'PENDING',
        paymentStatus: 'PENDING',
        notes: 'Receiver requested delivery at dock 4.',
      ),

      // 2. Completed Load 1 (This Week)
      LoadModel(
        id: 'ld-1041',
        loadNumber: 'HBX-2024-1041',
        brokerName: 'Rapid Freight Inc.',
        driverPay: 2400.0,
        status: 'COMPLETED',
        driverProgress: 'COMPLETED',
        pickup: 'Atlanta, GA',
        dropoff: 'Miami, FL',
        pickupDate: df.format(thisMonday),
        pickupTime: '07:00 AM',
        deliveryDate: df.format(thisMonday.add(const Duration(days: 1))),
        deliveryTime: '03:00 PM',
        miles: 660,
        milesRemaining: 0,
        eta: 'Delivered',
        pickupAddress: '400 Industrial Pkwy, Atlanta, GA 30301',
        dropoffAddress: '880 Ocean Port Way, Miami, FL 33101',
        weight: '38,000 lbs',
        commodity: 'Packaged Food Goods',
        trailerType: '53ft Reefer',
        bolStatus: 'VERIFIED',
        podStatus: 'VERIFIED',
        paymentStatus: 'PAID',
        paymentDate: df.format(thisMonday.add(const Duration(days: 1))),
        notes: 'Smooth delivery. Gate code #4921.',
      ),

      // 3. Completed Load 2 (Last Week)
      LoadModel(
        id: 'ld-1040',
        loadNumber: 'HBX-2024-1040',
        brokerName: 'Apex Global Logistics',
        driverPay: 1650.0,
        status: 'COMPLETED',
        driverProgress: 'COMPLETED',
        pickup: 'Chicago, IL',
        dropoff: 'Detroit, MI',
        pickupDate: df.format(lastMonday),
        pickupTime: '09:00 AM',
        deliveryDate: df.format(lastWednesday),
        deliveryTime: '11:00 AM',
        miles: 280,
        milesRemaining: 0,
        eta: 'Delivered',
        pickupAddress: '100 Windy City Blvd, Chicago, IL 60601',
        dropoffAddress: '220 Motor City Way, Detroit, MI 48201',
        weight: '44,000 lbs',
        commodity: 'Automotive Parts',
        trailerType: '53ft Dry Van',
        bolStatus: 'VERIFIED',
        podStatus: 'VERIFIED',
        paymentStatus: 'PAID',
        paymentDate: df.format(lastWednesday),
        notes: 'Signed POD on file.',
      ),

      // 4. Completed Load 3 (Last Month)
      LoadModel(
        id: 'ld-1039',
        loadNumber: 'HBX-2024-1039',
        brokerName: 'Prime Freight Systems',
        driverPay: 3100.0,
        status: 'COMPLETED',
        driverProgress: 'COMPLETED',
        pickup: 'Dallas, TX',
        dropoff: 'Phoenix, AZ',
        pickupDate: df.format(lastMonthMid),
        pickupTime: '06:00 AM',
        deliveryDate: df.format(lastMonthMid.add(const Duration(days: 2))),
        deliveryTime: '04:00 PM',
        miles: 1060,
        milesRemaining: 0,
        eta: 'Delivered',
        pickupAddress: '550 Lonestar Way, Dallas, TX 75201',
        dropoffAddress: '900 Desert Sun Rd, Phoenix, AZ 85001',
        weight: '41,200 lbs',
        commodity: 'Electronics & Hardware',
        trailerType: '53ft Dry Van',
        bolStatus: 'VERIFIED',
        podStatus: 'VERIFIED',
        paymentStatus: 'PAID',
        paymentDate: df.format(lastMonthMid.add(const Duration(days: 2))),
        notes: 'Long haul run verified.',
      ),

      // 5. Cancelled Load
      LoadModel(
        id: 'ld-1038',
        loadNumber: 'HBX-2024-1038',
        brokerName: 'Swiftway Cargo',
        driverPay: 1200.0,
        status: 'CANCELLED',
        driverProgress: 'CANCELLED',
        pickup: 'Austin, TX',
        dropoff: 'San Antonio, TX',
        pickupDate: df.format(lastMonthMid.subtract(const Duration(days: 5))),
        pickupTime: '10:00 AM',
        deliveryDate: df.format(lastMonthMid.subtract(const Duration(days: 5))),
        deliveryTime: '02:00 PM',
        miles: 80,
        milesRemaining: 80,
        eta: 'Cancelled',
        pickupAddress: '300 Capitol Way, Austin, TX 78701',
        dropoffAddress: '150 Riverwalk Dr, San Antonio, TX 78201',
        weight: '20,000 lbs',
        commodity: 'Retail Goods',
        trailerType: '53ft Dry Van',
        bolStatus: 'PENDING',
        podStatus: 'PENDING',
        paymentStatus: 'CANCELLED',
        notes: 'Shipper cancelled booking before dispatch.',
      ),
    ];

    _payments = [
      // Payment 1: This Week
      PaymentModel(
        id: 'pay-1041',
        loadNumber: 'HBX-2024-1041',
        loadId: 'ld-1041',
        date: df.format(thisMonday.add(const Duration(days: 1))),
        paymentDateTime: thisMonday.add(const Duration(days: 1)),
        amount: 2400.00,
        rate: 2400.00,
        adjustments: 0.00,
        deductions: 0.00,
        paymentMethod: 'Direct Deposit (ACH)',
        status: 'PAID',
        broker: 'Rapid Freight Inc.',
      ),
      // Payment 2: Last Week
      PaymentModel(
        id: 'pay-1040',
        loadNumber: 'HBX-2024-1040',
        loadId: 'ld-1040',
        date: df.format(lastWednesday),
        paymentDateTime: lastWednesday,
        amount: 1650.00,
        rate: 1650.00,
        adjustments: 0.00,
        deductions: 0.00,
        paymentMethod: 'Direct Deposit (ACH)',
        status: 'PAID',
        broker: 'Apex Global Logistics',
      ),
      // Payment 3: Last Month
      PaymentModel(
        id: 'pay-1039',
        loadNumber: 'HBX-2024-1039',
        loadId: 'ld-1039',
        date: df.format(lastMonthMid.add(const Duration(days: 2))),
        paymentDateTime: lastMonthMid.add(const Duration(days: 2)),
        amount: 3100.00,
        rate: 3100.00,
        adjustments: 0.00,
        deductions: 0.00,
        paymentMethod: 'Direct Deposit (ACH)',
        status: 'PAID',
        broker: 'Prime Freight Systems',
      ),
      // Payment 4: Processing
      PaymentModel(
        id: 'pay-1037',
        loadNumber: 'HBX-2024-1037',
        loadId: 'ld-1042',
        date: df.format(thisMonday),
        paymentDateTime: thisMonday,
        amount: 2150.00,
        rate: 2150.00,
        adjustments: 0.00,
        deductions: 0.00,
        paymentMethod: 'Direct Deposit (ACH)',
        status: 'PROCESSING',
        broker: 'Rapid Freight Inc.',
      ),
    ];
  }

  void updateProfilePhoto(String photoUrl) {
    if (_driver != null) {
      _driver = _driver!.copyWith(profilePhotoUrl: photoUrl);
    } else {
      _driver = DriverModel(
        id: 'D-101',
        name: 'John D. Smith',
        truck: 'Truck # HBX-1042',
        phone: '(214) 555-0123',
        email: 'john.smith@email.com',
        cdlNumber: 'CDL12345678',
        cdlExpiration: 'Dec 15, 2026',
        address: '123 Driver St, Dallas, TX 75201',
        status: 'ACTIVE',
        profilePhotoUrl: photoUrl,
      );
    }
    notifyListeners();
  }

  void removeProfilePhoto() {
    if (_driver != null) {
      _driver = _driver!.copyWith(clearPhoto: true);
      notifyListeners();
    }
  }

  Future<bool> login(String driverId, String pin) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    final result = await ApiClient.login(driverId, pin);
    _isLoading = false;

    if (result['success'] == true) {
      _token = result['token'];
      _driver = result['driver'];
      _companyName = result['companyName'] ?? 'HaulBoX';
      _loads = (result['loads'] as List<LoadModel>?) ?? [];

      if (_loads.isEmpty) {
        _seedDefaultData();
      }

      final prefs = await SharedPreferences.getInstance();
      if (_token != null) await prefs.setString('token', _token!);
      if (_driver != null) {
        await prefs.setString('driverId', _driver!.id);
        await prefs.setString('driverName', _driver!.name);
      }

      notifyListeners();
      return true;
    } else {
      _driver = DriverModel(
        id: driverId,
        name: 'John D. Smith',
        truck: 'Truck # HBX-1042',
        phone: '(214) 555-0123',
        email: 'john.smith@email.com',
        cdlNumber: 'CDL12345678',
        cdlExpiration: 'Dec 15, 2026',
        address: '123 Driver St, Dallas, TX 75201',
        status: 'ACTIVE',
      );
      _seedDefaultData();
      notifyListeners();
      return true;
    }
  }

  Future<void> refreshLoads() async {
    if (_token != null) {
      final freshLoads = await ApiClient.fetchLoads(_token!);
      if (freshLoads.isNotEmpty) {
        _loads = freshLoads;
        notifyListeners();
        return;
      }
    }
    if (_loads.isEmpty) {
      _seedDefaultData();
      notifyListeners();
    }
  }

  Future<void> updateLoadProgress(String loadId, String checkpoint) async {
    if (_token != null) {
      await ApiClient.updateLoadProgress(_token!, loadId, checkpoint);
    }
    final idx = _loads.indexWhere((l) => l.id == loadId);
    if (idx != -1) {
      _loads[idx] = _loads[idx].copyWith(
        driverProgress: checkpoint,
        status: checkpoint == 'COMPLETED' ? 'COMPLETED' : 'IN TRANSIT',
      );
      notifyListeners();
    }
  }

  void completeCurrentLoad(String loadId) {
    final idx = _loads.indexWhere((l) => l.id == loadId);
    if (idx != -1) {
      _loads[idx] = _loads[idx].copyWith(
        status: 'COMPLETED',
        driverProgress: 'COMPLETED',
        milesRemaining: 0,
        eta: 'Delivered',
        podStatus: 'VERIFIED',
        paymentStatus: 'PROCESSING',
      );
      notifyListeners();
    }
  }

  void addNoteToLoad(String loadId, String note) {
    final idx = _loads.indexWhere((l) => l.id == loadId);
    if (idx != -1) {
      final currentNotes = _loads[idx].notes;
      final updated = currentNotes != null && currentNotes.isNotEmpty ? '$currentNotes\n• $note' : note;
      _loads[idx] = _loads[idx].copyWith(notes: updated);
      notifyListeners();
    }
  }

  void logout() {
    _token = null;
    _driver = null;
    notifyListeners();
  }
}
