/* =========================================================================
   HaulBoX Constants & Status Definitions
   ========================================================================= */

const STATUS_META = {
  'Pending RC': { color: 'gray', label: 'Pending RC' },
  'Booked': { color: 'yellow', label: '🟡 Booked' },
  'ACCEPTED': { color: 'green', label: '🟢 Accepted' },
  'Accepted': { color: 'green', label: '🟢 Accepted' },
  'AT_PICKUP': { color: 'yellow', label: '🟡 At Pickup' },
  'At Pickup': { color: 'yellow', label: '🟡 At Pickup' },
  'Loaded': { color: 'yellow', label: '🟡 Loaded' },
  'IN_TRANSIT': { color: 'green', label: '🟢 In Transit' },
  'In Transit': { color: 'green', label: '🟢 In Transit' },
  'AT_DELIVERY': { color: 'yellow', label: '🟡 At Delivery' },
  'At Delivery': { color: 'yellow', label: '🟡 At Delivery' },
  'Drop-off': { color: 'yellow', label: '🟡 Drop-off' },
  'DELIVERED': { color: 'green', label: '🟢 Delivered' },
  'Delivered': { color: 'green', label: '🟢 Delivered' },
  'POD Uploaded': { color: 'green', label: '🟢 POD Uploaded' },
  'Issue': { color: 'red', label: '🔴 Issue' },
  'Needs Review': { color: 'red', label: '🔴 Needs Review' },
  'Cancelled': { color: 'red', label: '🔴 Cancelled' },
  'Payment Not Requested': { color: 'gray', label: 'Payment Not Requested' },
  'Payment Requested': { color: 'yellow', label: 'Payment Requested' },
  'Payment Received': { color: 'green', label: 'Payment Received' },
};

const PAYMENT_STAGES = ['Payment Not Requested', 'Payment Requested', 'Payment Received'];
const SUPER_ADMIN_EMAIL_REQUIRED = 'faisal.alrasheedi@haulline.co';
const SESSION_KEY = 'haulbox_current_user_email';
const VIEW_TITLES = { dashboard: 'Dashboard', addload: 'Add Load', loadboard: 'Load Board', drivers: 'Drivers', driverpay: 'Driver Pay', brokers: 'Brokers', dispatchers: 'Dispatchers', statistics: 'Statistics', documents: 'Documents', emaillogs: 'Email Logs', myaccount: 'My Account', settings: 'Settings', chat: '💬 Chat' };
