package sync

import "errors"

// ErrDeviceRevoked indicates the syncing device has been revoked for the user.
var ErrDeviceRevoked = errors.New("sync device revoked")

// ErrProjectAccessDenied indicates that a conversation references a project
// outside the authenticated user's personal or organization scope.
var ErrProjectAccessDenied = errors.New("sync project access denied")

// ErrNotFound is returned by persistence ports when a sync-owned record does
// not exist. Database adapters translate driver-specific no-row errors to it.
var ErrNotFound = errors.New("sync record not found")
