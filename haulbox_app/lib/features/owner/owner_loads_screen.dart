import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../shared/widgets/haulbox_card.dart';
import '../../shared/widgets/status_badge.dart';
import 'owner_provider.dart';

class OwnerLoadsScreen extends StatefulWidget {
  const OwnerLoadsScreen({super.key});

  @override
  State<OwnerLoadsScreen> createState() => _OwnerLoadsScreenState();
}

class _OwnerLoadsScreenState extends State<OwnerLoadsScreen> {
  final _currencyFormat = NumberFormat.currency(symbol: '\$', decimalDigits: 0);
  final _searchController = TextEditingController();

  final List<Map<String, String>> _statusFilters = [
    {'label': 'All Loads', 'val': 'ALL'},
    {'label': 'Booked', 'val': 'BOOKED'},
    {'label': 'Loaded / Transit', 'val': 'LOADED'},
    {'label': 'Delivered', 'val': 'DELIVERED'},
    {'label': 'Cancelled', 'val': 'CANCELLED'},
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Provider.of<OwnerProvider>(context, listen: false).refreshLoads();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showLoadDetailSheet(Map<String, dynamic> load) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _buildLoadDetailSheet(load),
    );
  }

  Widget _buildLoadDetailSheet(Map<String, dynamic> load) {
    final loadNum = load['loadNumber'] ?? 'Load';
    final broker = load['brokerName'] ?? 'Broker';
    final driver = load['driverName'] ?? 'Unassigned';
    final pickup = load['pickup'] ?? 'Pickup';
    final dropoff = load['dropoff'] ?? 'Dropoff';
    final rate = (load['rate'] as num?)?.toDouble() ?? 0.0;
    final driverPay = (load['driverPay'] as num?)?.toDouble() ?? 0.0;
    final profit = rate - driverPay;
    final status = load['status'] ?? 'Active';
    final payStatus = load['paymentStatus'] ?? 'UNPAID';

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.bgLight,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 30),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Load #$loadNum',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppColors.textDark),
                  ),
                  Text('Broker: $broker', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                ],
              ),
              IconButton(
                icon: const Icon(Icons.close),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              StatusBadge(status: status),
              const SizedBox(width: 8),
              StatusBadge(status: payStatus),
            ],
          ),
          const SizedBox(height: 16),
          HaulBoxCard(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('ROUTE & LANE', style: TextStyle(color: AppColors.textSecondary, fontSize: 10.5, fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                Row(
                  children: [
                    const Icon(Icons.circle, size: 10, color: AppColors.emeraldPrimary),
                    const SizedBox(width: 8),
                    Expanded(child: Text('Pickup: $pickup', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
                  ],
                ),
                const Padding(
                  padding: EdgeInsets.only(left: 4),
                  child: SizedBox(height: 14, child: VerticalDivider(width: 2, color: AppColors.borderLight)),
                ),
                Row(
                  children: [
                    const Icon(Icons.location_on, size: 12, color: Color(0xFFDC2626)),
                    const SizedBox(width: 8),
                    Expanded(child: Text('Delivery: $dropoff', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          HaulBoxCard(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('FINANCIAL BREAKDOWN', style: TextStyle(color: AppColors.textSecondary, fontSize: 10.5, fontWeight: FontWeight.w800)),
                const SizedBox(height: 10),
                _buildRowItem('Gross Rate', _currencyFormat.format(rate), AppColors.textDark, true),
                const SizedBox(height: 6),
                _buildRowItem('Driver Pay ($driver)', _currencyFormat.format(driverPay), const Color(0xFFEA580C), false),
                const Divider(height: 16, color: AppColors.divider),
                _buildRowItem('Estimated Margin / Profit', _currencyFormat.format(profit), AppColors.emeraldDark, true),
              ],
            ),
          ),
          const SizedBox(height: 12),
          const Center(
            child: Text(
              'Read-only view • Dispatches managed via Dispatcher Portal',
              style: TextStyle(color: AppColors.textSubtle, fontSize: 11),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRowItem(String label, String value, Color color, bool isBold) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary)),
        Text(
          value,
          style: TextStyle(fontSize: 13.5, color: color, fontWeight: isBold ? FontWeight.w800 : FontWeight.w600),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final ownerProvider = Provider.of<OwnerProvider>(context);
    final loads = ownerProvider.loads;
    final isLoading = ownerProvider.isLoadingLoads;

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        title: const Text(
          'Fleet Loads',
          style: TextStyle(
            color: AppColors.textDark,
            fontWeight: FontWeight.w800,
            fontSize: 17,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: AppColors.navyLight),
            onPressed: () => ownerProvider.refreshLoads(),
          ),
        ],
      ),
      body: Column(
        children: [
          // Filter & Search Header
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: Column(
              children: [
                TextField(
                  controller: _searchController,
                  onChanged: (val) {
                    ownerProvider.refreshLoads(search: val.trim());
                  },
                  decoration: InputDecoration(
                    hintText: 'Search by load #, driver, lane, broker...',
                    hintStyle: const TextStyle(fontSize: 13, color: AppColors.textSubtle),
                    prefixIcon: const Icon(Icons.search, size: 20, color: AppColors.textSubtle),
                    suffixIcon: _searchController.text.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear, size: 18),
                            onPressed: () {
                              _searchController.clear();
                              ownerProvider.refreshLoads(search: '');
                            },
                          )
                        : null,
                    filled: true,
                    fillColor: AppColors.bgLight,
                    contentPadding: const EdgeInsets.symmetric(vertical: 0, horizontal: 12),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  height: 34,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: _statusFilters.length,
                    separatorBuilder: (context, index) => const SizedBox(width: 8),
                    itemBuilder: (context, idx) {
                      final f = _statusFilters[idx];
                      final isSelected = ownerProvider.selectedLoadStatus == f['val'];

                      return ChoiceChip(
                        label: Text(f['label']!),
                        selected: isSelected,
                        onSelected: (sel) {
                          if (sel) ownerProvider.refreshLoads(status: f['val']);
                        },
                        selectedColor: AppColors.navyDark,
                        backgroundColor: Colors.white,
                        labelStyle: TextStyle(
                          color: isSelected ? Colors.white : AppColors.navyLight,
                          fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                          fontSize: 11.5,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                          side: BorderSide(
                            color: isSelected ? AppColors.navyDark : AppColors.borderLight,
                            width: 1,
                          ),
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      );
                    },
                  ),
                ),
              ],
            ),
          ),

          // Loads List
          Expanded(
            child: RefreshIndicator(
              color: AppColors.emeraldPrimary,
              onRefresh: () => ownerProvider.refreshLoads(),
              child: isLoading && loads.isEmpty
                  ? const Center(child: CircularProgressIndicator(color: AppColors.emeraldPrimary))
                  : loads.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.inventory_2_outlined, size: 48, color: Colors.grey.shade400),
                              const SizedBox(height: 12),
                              Text('No loads found', style: TextStyle(color: Colors.grey.shade600, fontSize: 14)),
                            ],
                          ),
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: loads.length,
                          separatorBuilder: (context, index) => const SizedBox(height: 12),
                          itemBuilder: (context, idx) {
                            final load = loads[idx] as Map<String, dynamic>;
                            final loadNum = load['loadNumber'] ?? 'Load';
                            final broker = load['brokerName'] ?? 'Direct Broker';
                            final driver = load['driverName'] ?? 'Unassigned';
                            final pickup = load['pickup'] ?? '';
                            final dropoff = load['dropoff'] ?? '';
                            final rate = (load['rate'] as num?)?.toDouble() ?? 0.0;
                            final driverPay = (load['driverPay'] as num?)?.toDouble() ?? 0.0;
                            final status = load['status'] ?? 'Active';
                            final payStatus = load['paymentStatus'] ?? 'UNPAID';

                            return HaulBoxCard(
                              onTap: () => _showLoadDetailSheet(load),
                              padding: const EdgeInsets.all(14),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Text(
                                        '#$loadNum',
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w800,
                                          fontSize: 14.5,
                                          color: AppColors.textDark,
                                        ),
                                      ),
                                      Row(
                                        children: [
                                          StatusBadge(status: status, isSmall: true),
                                          const SizedBox(width: 6),
                                          StatusBadge(status: payStatus, isSmall: true),
                                        ],
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    '$pickup → $dropoff',
                                    style: const TextStyle(
                                      color: AppColors.textDark,
                                      fontWeight: FontWeight.w700,
                                      fontSize: 13,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    'Broker: $broker • Driver: $driver',
                                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 11.5),
                                  ),
                                  const Padding(
                                    padding: EdgeInsets.symmetric(vertical: 8),
                                    child: Divider(height: 1, color: AppColors.divider),
                                  ),
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          const Text('Gross Rate', style: TextStyle(color: AppColors.textSubtle, fontSize: 10)),
                                          Text(
                                            _currencyFormat.format(rate),
                                            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: AppColors.textDark),
                                          ),
                                        ],
                                      ),
                                      Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          const Text('Driver Pay', style: TextStyle(color: AppColors.textSubtle, fontSize: 10)),
                                          Text(
                                            _currencyFormat.format(driverPay),
                                            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: Color(0xFFEA580C)),
                                          ),
                                        ],
                                      ),
                                      Column(
                                        crossAxisAlignment: CrossAxisAlignment.end,
                                        children: [
                                          const Text('Estimated Margin', style: TextStyle(color: AppColors.textSubtle, fontSize: 10)),
                                          Text(
                                            _currencyFormat.format(rate - driverPay),
                                            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: AppColors.emeraldDark),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
            ),
          ),
        ],
      ),
    );
  }
}
