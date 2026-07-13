const PushNotificationIOSShim = {
  addEventListener() {
    return { remove() {} };
  },

  removeEventListener() {},

  requestPermissions() {
    return Promise.resolve({});
  },

  checkPermissions(callback) {
    const permissions = {};
    if (typeof callback === 'function') {
      callback(permissions);
    }
    return Promise.resolve(permissions);
  },

  abandonPermissions() {},

  presentLocalNotification() {},

  scheduleLocalNotification() {},

  cancelAllLocalNotifications() {},

  removeAllDeliveredNotifications() {},

  getDeliveredNotifications(callback) {
    if (typeof callback === 'function') {
      callback([]);
    }
  },

  setApplicationIconBadgeNumber() {},

  getApplicationIconBadgeNumber(callback) {
    if (typeof callback === 'function') {
      callback(0);
    }
  },
};

module.exports = {
  __esModule: true,
  default: PushNotificationIOSShim,
};
