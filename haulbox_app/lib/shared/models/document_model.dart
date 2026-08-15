class DocumentModel {
  final String id;
  final String name;
  final String documentNumber;
  final String issueDate;
  final String expirationDate;
  final String status;
  final String category; // 'DRIVER' or 'TRUCK' or 'LOAD'
  final bool hasFile;

  DocumentModel({
    required this.id,
    required this.name,
    required this.documentNumber,
    required this.issueDate,
    required this.expirationDate,
    required this.status,
    required this.category,
    this.hasFile = true,
  });

  bool get isExpiringSoon {
    return status.toUpperCase() == 'EXPIRING';
  }
}
