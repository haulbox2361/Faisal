import 'package:intl/intl.dart';

class PaymentModel {
  final String id;
  final String loadNumber;
  final String loadId;
  final String date;
  final double amount;
  final String paymentMethod;
  final String status;
  final String broker;
  final double? rate;
  final double? adjustments;
  final double? deductions;
  final String? settlementDocUrl;
  final String? receiptDocUrl;
  final DateTime? paymentDateTime;

  PaymentModel({
    required this.id,
    required this.loadNumber,
    this.loadId = '',
    required this.date,
    required this.amount,
    required this.paymentMethod,
    required this.status,
    required this.broker,
    this.rate,
    this.adjustments,
    this.deductions,
    this.settlementDocUrl,
    this.receiptDocUrl,
    this.paymentDateTime,
  });

  DateTime get parsedDate {
    if (paymentDateTime != null) return paymentDateTime!;
    try {
      return DateFormat('MMMM d, yyyy').parse(date);
    } catch (_) {
      try {
        return DateFormat('MMM d, yyyy').parse(date);
      } catch (_) {
        try {
          return DateTime.parse(date);
        } catch (_) {
          return DateTime.now();
        }
      }
    }
  }

  factory PaymentModel.fromJson(Map<String, dynamic> json) {
    DateTime? dt;
    if (json['paymentDateTime'] != null) {
      dt = DateTime.tryParse(json['paymentDateTime'].toString());
    } else if (json['paidDate'] != null) {
      dt = DateTime.tryParse(json['paidDate'].toString());
    } else if (json['date'] != null) {
      dt = DateTime.tryParse(json['date'].toString());
    }

    final amt = (json['amount'] is num)
        ? (json['amount'] as num).toDouble()
        : ((json['driverPay'] is num)
            ? (json['driverPay'] as num).toDouble()
            : (double.tryParse(json['amount']?.toString() ?? json['driverPay']?.toString() ?? '0') ?? 0.0));

    final st = (json['status']?.toString() ?? (json['driverPaid'] == true ? 'PAID' : 'PENDING')).toUpperCase();

    return PaymentModel(
      id: json['id']?.toString() ?? json['loadId']?.toString() ?? '',
      loadNumber: json['loadNumber']?.toString() ?? json['load_number']?.toString() ?? 'Load',
      loadId: json['loadId']?.toString() ?? json['id']?.toString() ?? '',
      date: json['date']?.toString() ?? json['paidDate']?.toString() ?? json['deliveryDate']?.toString() ?? 'Recent',
      amount: amt,
      paymentMethod: json['paymentMethod']?.toString() ?? 'Direct Deposit (ACH)',
      status: st,
      broker: json['broker']?.toString() ?? json['brokerName']?.toString() ?? 'Broker Settlement',
      rate: (json['rate'] is num) ? (json['rate'] as num).toDouble() : amt,
      adjustments: (json['adjustments'] is num) ? (json['adjustments'] as num).toDouble() : 0.0,
      deductions: (json['deductions'] is num) ? (json['deductions'] as num).toDouble() : 0.0,
      settlementDocUrl: json['settlementDocUrl']?.toString(),
      receiptDocUrl: json['receiptDocUrl']?.toString(),
      paymentDateTime: dt,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'loadNumber': loadNumber,
    'loadId': loadId,
    'date': date,
    'amount': amount,
    'paymentMethod': paymentMethod,
    'status': status,
    'broker': broker,
    'rate': rate,
    'adjustments': adjustments,
    'deductions': deductions,
    'settlementDocUrl': settlementDocUrl,
    'receiptDocUrl': receiptDocUrl,
    'paymentDateTime': paymentDateTime?.toIso8601String(),
  };
}
