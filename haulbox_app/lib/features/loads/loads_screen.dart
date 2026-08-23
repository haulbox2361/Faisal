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

class _LoadsScreenState extends State<LoadsScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  DateRangeFilterType _selectedDateRange = DateRangeFilterType.thisWeek;
  DateTimeRange? _customDateRange;
  String _selectedFilter = 'ALL';
  String _searchQuery = '';
  String _sortBy = 'NEWEST';
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  List<LoadModel> _filterAndSortLoads(List<LoadModel> allLoads, {required bool isActiveTab}) {
    final range = DateRangeHelper.calculateRange(_selectedDateRange, customRange: _customDateRange);
    List<LoadModel> list = List.from(allLoads);

    // 1. Tab Segmentation (Active vs. History)
    if (isActiveTab) {
      list = list.where((l) => !['COMPLETED', 'DELIVERED', 'CANCELLED', 'PAID'].contains(l.status.toUpperCase())).toList();
    } else {
      list = list.where((l) => ['COMPLETED', 'DELIVERED', 'CANCELLED', 'PAID'].contains(l.status.toUpperCase())).toList();
    }

    // 2. Date Range Filter
    if (_selectedDateRange != DateRangeFilterType.allTime) {
      list = list.where((l) {
        final pDate = DateRangeHelper.parseFlexibleDate(l.pickupDate);
        return pDate.isAfter(range.start.subtract(const Duration(seconds: 1))) &&
            pDate.isBefore(range.end.add(const Duration(seconds: 1)));
      }).toList();
    }

    // 3. Status Sub-Filter
    if (_selectedFilter == 'CANCELLED') {
      list = list.where((l) => l.status.toUpperCase() == 'CANCELLED').toList();
    } else if (_selectedFilter == 'COMPLETED') {
      list = list.where((l) => ['COMPLETED', 'DELIVERED', 'PAID'].contains(l.status.toUpperCase())).toList();
    }

    // 4. Search Query Filter
    if (_searchQuery.trim().isNotEmpty) {
      final q = _searchQuery.toLowerCase().trim();
      list = list.where((l) {
        return l.loadNumber.toLowerCase().contains(q) ||
            l.brokerName.toLowerCase().contains(q) ||
            l.pickup.toLowerCase().contains(q) ||
            l.dropoff.toLowerCase().contains(q);
      }).toList();
    }

    // 5. Sorting
    if (_sortBy == 'OLDEST') {
      list = list.reversed.toList();
    } else if (_sortBy == 'ACTIVE_FIRST') {
      list.sort((a, b) {
        final aActive = !['COMPLETED', 'CANCELLED', 'PAID'].contains(a.status.toUpperCase()) ? 0 : 1;
        final bActive = !['COMPLETED', 'CANCELLED', 'PAID'].contains(b.status.toUpperCase()) ? 0 : 1;
        return aActive.compareTo(bActive);
      });
    }

    return list;
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);
    final allLoads = authProvider.loads;
    final activeLoads = _filterAndSortLoads(allLoads, isActiveTab: true);
    final historyLoads = _filterAndSortLoads(allLoads, isActiveTab: false);

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
              const PopupMenuItem(value: 'OLDEST', child: Text('Oldest First')),
              const PopupMenuItem(value: 'ACTIVE_FIRST', child: Text('Active First')),
            ],
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            height: 38,
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(12),
            ),
            child: TabBar(
              controller: _tabController,
              indicatorSize: TabBarIndicatorSize.tab,
              indicator: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(10),
              ),
              labelColor: AppColors.textDark,
              unselectedLabelColor: Colors.white.withValues(alpha: 0.8),
              labelStyle: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13),
              unselectedLabelStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
              tabs: [
                Tab(
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Text('ACTIVE LOADS'),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: _tabController.index == 0 ? AppColors.emeraldSoft : Colors.white.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          '${activeLoads.length}',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w900,
                            color: _tabController.index == 0 ? AppColors.emeraldDark : Colors.white,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                Tab(
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Text('HISTORY'),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: _tabController.index == 1 ? AppColors.bgSecondary : Colors.white.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          '${historyLoads.length}',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w900,
                            color: _tabController.index == 1 ? AppColors.textDark : Colors.white,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildLoadsListTab(activeLoads, isActiveTab: true, authProvider: authProvider),
          _buildLoadsListTab(historyLoads, isActiveTab: false, authProvider: authProvider),
        ],
      ),
    );
  }

  Widget _buildLoadsListTab(List<LoadModel> loads, {required bool isActiveTab, required AuthProvider authProvider}) {
    return Column(
      children: [
        // 1. Filter Bar & Search
        Container(
          color: Colors.white,
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          child: Column(
            children: [
              // Search Input
              Container(
                height: 42,
                decoration: BoxDecoration(
                  color: AppColors.bgSecondary,
                  borderRadius: AppRadius.mdBorder,
                  border: Border.all(color: AppColors.borderLight),
                ),
                child: TextField(
                  controller: _searchController,
                  onChanged: (v) => setState(() => _searchQuery = v),
                  style: const TextStyle(fontSize: 13.5, color: AppColors.textDark, fontWeight: FontWeight.w600),
                  decoration: InputDecoration(
                    hintText: 'Search by load #, city, or broker...',
                    hintStyle: const TextStyle(color: AppColors.textSubtle, fontSize: 13),
                    prefixIcon: const Icon(Icons.search_rounded, color: AppColors.textMuted, size: 20),
                    suffixIcon: _searchQuery.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear_rounded, size: 18, color: AppColors.textMuted),
                            onPressed: () {
                              _searchController.clear();
                              setState(() => _searchQuery = '');
                            },
                          )
                        : null,
                    border: InputBorder.none,
                    contentPadding: const EdgeInsets.symmetric(vertical: 10),
                  ),
                ),
              ),
              const SizedBox(height: 10),

              // Date Range Selector
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
            ],
          ),
        ),

        // 2. Load Cards List
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => authProvider.syncAllData(),
            color: AppColors.emeraldPrimary,
            child: loads.isEmpty
                ? SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    child: Padding(
                      padding: const EdgeInsets.only(top: 60),
                      child: EmptyState(
                        title: isActiveTab ? 'No Active Loads' : 'No Past Loads Found',
                        description: isActiveTab
                            ? 'You currently have no loads assigned or in transit.'
                            : 'No completed loads match your selected date or search filter.',
                        icon: Icons.local_shipping_outlined,
                      ),
                    ),
                  )
                : ListView.builder(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
                    itemCount: loads.length,
                    itemBuilder: (context, index) {
                      final load = loads[index];
                      return _buildLoadCard(context, load);
                    },
                  ),
          ),
        ),
      ],
    );
  }

  Widget _buildLoadCard(BuildContext context, LoadModel load) {
    final rateString = load.driverPay != null ? '\$${load.driverPay!.toInt()}' : '\$1,850';
    // Deadhead estimation: 25-45 miles for demonstration/badge
    final deadheadMiles = (load.miles != null && load.miles! > 100) ? ((load.miles! * 0.08).round() + 15) : 32;

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
                    const Icon(Icons.location_on_rounded, size: 14, color: AppColors.statusInfo),
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

                // Badges Row: Status + Loaded Miles + Deadhead Mileage Badge (IMP-201)
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    StatusBadge(status: load.status),
                    Row(
                      children: [
                        // Deadhead Badge
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFEF3C7),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(color: const Color(0xFFFDE68A)),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.near_me_outlined, size: 11, color: Color(0xFFD97706)),
                              const SizedBox(width: 4),
                              Text(
                                '$deadheadMiles mi deadhead',
                                style: const TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w800,
                                  color: Color(0xFFB45309),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),

                        // Loaded Miles Badge
                        if (load.miles != null)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: AppColors.bgSecondary,
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              '${load.miles} mi loaded',
                              style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textDark,
                              ),
                            ),
                          ),
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
