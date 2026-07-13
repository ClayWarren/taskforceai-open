package sync

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestMapDevice(t *testing.T) {
	now := time.Now()
	name := "Device"
	agent := "agent"
	d := SyncDeviceRecord{
		DeviceID:   "dev1",
		DeviceName: &name,
		UserAgent:  &agent,
		LastSeenAt: Timestamp{Time: now, Valid: true},
		CreatedAt:  Timestamp{Time: now, Valid: true},
		IsRevoked:  true,
	}

	record := MapDevice(d)
	assert.Equal(t, "dev1", record.DeviceID)
	assert.Equal(t, &name, record.DeviceName)
	assert.Equal(t, &agent, record.UserAgent)
	assert.True(t, record.IsRevoked)
}
