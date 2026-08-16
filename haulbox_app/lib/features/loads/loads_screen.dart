import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_radius.dart';
import '../../shared/models/date_range_filter.dart';
import '../../shared/models/load_model.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/range_selector.dart';
import '../../shared/widgets/status_badge.dart';
import '../auth/auth_provider.dart';
import 'load_detail_screen.dart';

class LoadsScreen extends StatefulWidget {
  const LoadsScreen({super.key});

  @override
  State<LoadsScreen> createState() => _LoadsScreenState();
}

class _LoadsScreenState extends State<LoadsScreen> {
  // Default range is This Week (Current Monday -> Today)
  DateRangeFilterType _selectedDateRange = DateRangeFilterType.thisWeek;
  DateTimeRange? _customDateRange;
  String _selectedFilter = 'ALL'; // ALL, ACTIVE, COMPLETED, CANCELLED
  String _searchQuery = '';
  String _sortBy = 'NEWEST'; // NEWEST, OLDEST, ACTIVE_FIRST
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<LoadModel> _filterAndSortLoads(List<LoadModel> allLoads) {
    final range = DateRangeHelper.calculateRange(_selectedDateRange, customRange: _customDateRange);
    List<LoadModel> list = List.from(allLoads);

    // 1. Date Range Filter
    if (_selectedDateRange != DateRangeFilterType.allTime) {
      list = list.where((l) {
        final pDate = DateRangeHelper.parseFlexibleDate(l.pickupDate);
        return pDate.isAfter(range.start.subtract(const Duration(seconds: 1))) &&
            pDate.isBefore(range.end.add(const Duration(seconds: 1)));
      }).toList();
    }

    // 2. Status Filter
    if (_selectedFilter == 'ACTIVE') {
      list = list.where((l) => !['COMPLETED', 'DELIVERED', 'CANCELLED'].contains(l.status.toUpperCase())).toList();
    } else if (_selectedFilter == 'COMPLETED') {
      list = list.where((l) => ['COMPLETED', 'DELIVERED'].contains(l.status.toUpperCase())).toList();
    } else if (_selectedFilter == 'CANCELLED') {
      list = list.where((l) => l.status.toUpperCase() == 'CANCELLED').toList();
    }

    // 3. Search Query Filter (Load #, Broker, Pickup, Delivery)
    if (_searchQuery.trim().isNotEmpty) {
      final q = _searchQuery.toLowerCase().trim();
      list = list.where((l) {
        return l.loadNumber.toLowerCase().contains(q) ||
            l.brokerName.toLowerCase().contains(q) ||
            l.pickup.toLowerCase().contains(q) ||
            l.dropoff.toLowerCase().contains(q);
      }).toList();
    }

    // 4. Sorting
    if (_sortBy == 'OLDEST') {
      list = list.reversed.toList();
    } else if (_sortBy == 'ACTIVE_FIRST') {
      list.sort((a, b) {
        final aActive = !['COMPLETED', 'CANCELLED'].contains(a.status.toUpperCase()) ? 0 : 1;
        final bActive = !['COMPLETED', 'CANCELLED'].contains(b.status.toUpperCase()) ? 0 : 1;
        return aActive.compareTo(bActive);
      });
    }

    return list;
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);
    final loads = authProvider.loads;
    final filteredLoads = _filterAndSortLoads(loads);

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        title: const Text(
          'Loads',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: -0.4),
        ),
        actions: [
          PopupMenuButton<String>(
            icon: const Icon(Icons.sort_rounded, color: Colors.white),
            tooltip: 'Sort loads',
            onSelected: (val) => setState(() => _sortBy = val),
            itemBuilder: (ctx) => [
              const PopupMenuItem(value: 'NEWEST', child: Text('Newest First')),
              const PopupMenuItem(value: 'ACTIVE_FIRST', child: Text('Active Runs First')),
              const PopupMenuItem(value: 'OLDEST', child: Text('Oldest First')),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          // Search & Filter Header Container
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
            child: Column(
              children: [
                // Search Input Field
                Container(
                  height: 44,
                  decoration: BoxDecoration(
                    color: AppColors.bgSecondary,
                    borderRadius: AppRadius.mdBorder,
                    border: Border.all(color: AppColors.borderLight),
                  ),
                  child: TextField(
                    controller: _searchController,
                    onChanged: (val) => setState(() => _searchQuery = val),
                    decoration: InputDecoration(
                      hintText: 'Search by load #, broker, city...',
                      hintStyle: const TextStyle(fontSize: 13.5, color: AppColors.textSubtle),
                      prefixIcon: const Icon(Icons.search_rounded, size: 20, color: AppColors.textMuted),
                      suffixIcon: _searchQuery.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.close_rounded, size: 18, color: AppColors.textMuted),
                              onPressed: () {
                                _searchController.clear();
                                setState(() => _searchQuery = '');
                              },
                            )
                          : null,
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      filled: false,
                      contentPadding: const EdgeInsets.symmetric(vertical: 11),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(height: 10),

                // UNIFIED RANGE SELECTOR DROPDOWN
                RangeSelector(
                  selectedType: _selectedDateRange,
                  customRange: _customDateRange,
                  onRangeChanged: (type, custom) {
                    setState(() {
                      _selectedDateRange = type;
                      _customDateRange = custom;
                    });
                  },
                ),
                const SizedBox(height: 10),

                // Filter Chips Row
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      _buildFilterChip('ALL', 'All'),
                      const SizedBox(width: 8),
                      _buildFilterChip('ACTIVE', 'Active'),
                      const SizedBox(width: 8),
                      _buildFilterChip('COMPLETED', 'Completed'),
                      const SizedBox(width: 8),
                      _buildFilterChip('CANCELLED', 'Cancelled'),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const Divider(color: AppColors.borderLight, height: 1),

          // Scrollable Load Cards List
          Expanded(
            child: RefreshIndicator(
              onRefresh: () => authProvider.syncAllData(),
              color: AppColors.emeraldPrimary,
              child: filteredLoads.isEmpty
                  ? ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      children: const [
                        SizedBox(height: 80),
                        EmptyState(
                          icon: Icons.inventory_2_outlined,
                          title: 'No Loads Found',
                          description: 'No loads match your current date range, filter, or search criteria.',
                        ),
                      ],
                    )
                  : ListView.builder(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
                      itemCount: filteredLoads.length,
                      itemBuilder: (context, index) {
                        final load = filteredLoads[index];
                        return _buildLoadCard(context, load);
                      },
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String key, String label) {
    final isSelected = _selectedFilter == key;

    return GestureDetector(
      onTap: () => setState(() => _selectedFilter = key),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.emeraldPrimary : AppColors.bgSecondary,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? AppColors.emeraldPrimary : AppColors.borderLight,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w800,
            color: isSelected ? Colors.white : AppColors.textPrimary,
          ),
        ),
      ),
    );
  }

  Widget _buildLoadCard(BuildContext context, LoadModel load) {
    final rateString = load.driverPay != null ? '\$${load.driverPay!.toInt()}' : '\$1,850';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: AppRadius.lgBorder,
        border: Border.all(color: AppColors.borderLight, width: 1),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF0F172A).withValues(alpha: 0.03),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: AppRadius.lgBorder,
        child: InkWell(
          borderRadius: AppRadius.lgBorder,
          onTap: () {
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => LoadDetailScreen(load: load),
              ),
            );
          },
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Top Row: Load # + Rate Badge
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      load.loadNumber,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                        color: AppColors.textDark,
                        letterSpacing: -0.3,
                      ),
                    ),
                    Row(
                      children: [
                        const Text(
                          'RATE: ',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                            color: AppColors.textMuted,
                            letterSpacing: 0.5,
                          ),
                        ),
                        Text(
                          rateString,
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w900,
                            color: AppColors.emeraldDark,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 4),

                // Broker + Pickup Date
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      load.brokerName,
                      style: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textMuted,
                      ),
                    ),
                    Text(
                      load.pickupDate,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        color: AppColors.textSubtle,
                      ),
                    ),
                  ],
                ),
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 10),
                  child: Divider(color: AppColors.borderLight, height: 1),
                ),

                // Route Row: Origin -> Arrow -> Destination
                Row(
                  children: [
                    const Icon(Icons.circle, size: 8, color: AppColors.emeraldPrimary),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        load.pickup,
                        style: const TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textDark,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 6),
                      child: Icon(Icons.arrow_forward_rounded, size: 14, color: AppColors.textSubtle),
                    ),
                    const Icon(Icons.location_on_rounded, size: 12, color: AppColors.statusDanger),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        load.dropoff,
                        style: const TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textDark,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),

                // Bottom Row: Status Badge + Mileage + Chevron
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    StatusBadge(status: load.status, isSmall: true),
                    Row(
                      children: [
                        const Icon(Icons.straighten_rounded, size: 13, color: AppColors.textSubtle),
                        const SizedBox(width: 4),
                        Text(
                          '${load.miles} mi',
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: AppColors.textMuted,
                          ),
                        ),
                        const SizedBox(width: 8),
                        const Icon(Icons.chevron_right_rounded, color: AppColors.textSubtle, size: 18),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
