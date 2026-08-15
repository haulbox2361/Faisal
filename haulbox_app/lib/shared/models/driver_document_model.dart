class DriverDocument {
  final String id;
  final String type;
  final String title;
  final String? documentNumber;
  final String? issueDate;
  final String? expirationDate;
  final String status; // 'VALID', 'EXPIRING', 'EXPIRED', 'NOT_UPLOADED'
  final String? fileUrl;
  final String? notes;

  DriverDocument({
    required this.id,
    required this.type,
    required this.title,
    this.documentNumber,
    this.issueDate,
    this.expirationDate,
    required this.status,
    this.fileUrl,
    this.notes,
  });

  factory DriverDocument.fromJson(Map<String, dynamic> json) {
    return DriverDocument(
      id: json['id']?.toString() ?? '',
      type: json['type']?.toString() ?? 'OTHER',
      title: json['title']?.toString() ?? 'Driver Document',
      documentNumber: json['documentNumber']?.toString(),
      issueDate: json['issueDate']?.toString(),
      expirationDate: json['expirationDate']?.toString(),
      status: json['status']?.toString() ?? 'VALID',
      fileUrl: json['fileUrl']?.toString(),
      notes: json['notes']?.toString(),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'type': type,
    'title': title,
    'documentNumber': documentNumber,
    'issueDate': issueDate,
    'expirationDate': expirationDate,
    'status': status,
    'fileUrl': fileUrl,
    'notes': notes,
  };
}

class TruckDocument {
  final String id;
  final String type;
  final String title;
  final String? documentNumber;
  final String? issueDate;
  final String? expirationDate;
  final String status; // 'VALID', 'EXPIRING', 'EXPIRED', 'NOT_UPLOADED'
  final String? fileUrl;
  final String? notes;

  TruckDocument({
    required this.id,
    required this.type,
    required this.title,
    this.documentNumber,
    this.issueDate,
    this.expirationDate,
    required this.status,
    this.fileUrl,
    this.notes,
  });

  factory TruckDocument.fromJson(Map<String, dynamic> json) {
    return TruckDocument(
      id: json['id']?.toString() ?? '',
      type: json['type']?.toString() ?? 'OTHER',
      title: json['title']?.toString() ?? 'Truck Document',
      documentNumber: json['documentNumber']?.toString(),
      issueDate: json['issueDate']?.toString(),
      expirationDate: json['expirationDate']?.toString(),
      status: json['status']?.toString() ?? 'VALID',
      fileUrl: json['fileUrl']?.toString(),
      notes: json['notes']?.toString(),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'type': type,
    'title': title,
    'documentNumber': documentNumber,
    'issueDate': issueDate,
    'expirationDate': expirationDate,
    'status': status,
    'fileUrl': fileUrl,
    'notes': notes,
  };
}

class TruckGalleryPhoto {
  final String id;
  final String slotKey;
  final String label;
  String? fileUrl;
  bool isUploaded;
  String? uploadedDate;

  TruckGalleryPhoto({
    required this.id,
    required this.slotKey,
    required this.label,
    this.fileUrl,
    this.isUploaded = false,
    this.uploadedDate,
  });

  factory TruckGalleryPhoto.fromJson(Map<String, dynamic> json) {
    return TruckGalleryPhoto(
      id: json['id']?.toString() ?? '',
      slotKey: json['slotKey']?.toString() ?? '',
      label: json['label']?.toString() ?? 'Photo',
      fileUrl: json['fileUrl']?.toString(),
      isUploaded: json['isUploaded'] == true,
      uploadedDate: json['uploadedDate']?.toString(),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'slotKey': slotKey,
    'label': label,
    'fileUrl': fileUrl,
    'isUploaded': isUploaded,
    'uploadedDate': uploadedDate,
  };
}
