package sync

import "errors"

// ErrDeviceRevoked indicates the syncing device has been revoked for the user.
var ErrDeviceRevoked = errors.New("sync device revoked")

// ErrNotFound is returned by persistence ports when a sync-owned record does
// not exist. Database adapters translate driver-specific no-row errors to it.
var ErrNotFound = errors.New("sync record not found")
