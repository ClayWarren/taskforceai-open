package platform

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type statusPublisherStub struct {
	status StatusResponse
	err    error
}

type statusSourceStub struct {
	records []StatusIncidentRecord
	err     error
}

func (s statusSourceStub) ListStatusIncidents(context.Context, int) ([]StatusIncidentRecord, error) {
	return s.records, s.err
}

func (s *statusPublisherStub) PublishStatus(_ context.Context, status StatusResponse) error {
	s.status = status
	return s.err
}

func TestStatusService_GetServiceStatus(t *testing.T) {
	svc := NewStatusService()
	resp, err := svc.GetServiceStatus(context.Background())
	require.NoError(t, err)

	assert.Equal(t, ServiceStatusOperational, resp.OverallStatus)
	assert.Len(t, resp.Services, len(ServiceOrder))

	for _, s := range resp.Services {
		assert.Equal(t, ServiceStatusOperational, s.Status)
		assert.Equal(t, 100.0, s.UptimePercent)
		assert.Len(t, s.UptimeHistory, 90)
	}

	resp.Services[0].Name = "mutated"
	resp.Services[0].UptimeHistory[0].Status = ServiceStatusOutage
	cached, err := svc.GetServiceStatus(context.Background())
	require.NoError(t, err)
	assert.NotEqual(t, "mutated", cached.Services[0].Name)
	assert.Equal(t, ServiceStatusOperational, cached.Services[0].UptimeHistory[0].Status)
}

func TestStatusServiceBuildsSnapshotFromPersistedIncidents(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	previousNow := statusNow
	statusNow = func() time.Time { return now }
	t.Cleanup(func() { statusNow = previousNow })

	svc := NewStatusServiceWithSource(statusSourceStub{records: []StatusIncidentRecord{
		{ID: "1", ServiceID: "api", Status: ServiceStatusOutage, Message: "API down", StartedAt: now.Add(-time.Hour)},
		{ID: "2", ServiceID: "web", Status: ServiceStatusDegraded, Message: "Slow", StartedAt: now.Add(-30 * time.Minute)},
	}})

	status, err := svc.GetServiceStatus(context.Background())

	require.NoError(t, err)
	assert.Equal(t, ServiceStatusOutage, status.OverallStatus)
	require.Len(t, status.Incidents, 2)
	apiIndex := slices.IndexFunc(status.Services, func(service ServiceInfo) bool { return service.ID == "api" })
	require.GreaterOrEqual(t, apiIndex, 0)
	assert.Equal(t, ServiceStatusOutage, status.Services[apiIndex].Status)
	assert.Less(t, status.Services[apiIndex].UptimePercent, 100.0)
}

func TestStatusServiceSourceFailureIsNotReportedAsOperational(t *testing.T) {
	expected := errors.New("status source failed")
	svc := NewStatusServiceWithSource(statusSourceStub{err: expected})

	_, err := svc.GetServiceStatus(context.Background())

	require.ErrorIs(t, err, expected)
}

func TestCloneStatusResponseDeepCopiesIncidentData(t *testing.T) {
	resolvedAt := "2026-07-10T12:00:00Z"
	original := StatusResponse{Incidents: []Incident{{
		AffectedServices: []string{"api"},
		Updates:          []IncidentUpdate{{Message: "investigating"}},
		ResolvedAt:       &resolvedAt,
	}}}

	cloned := cloneStatusResponse(original)
	cloned.Incidents[0].AffectedServices[0] = "web"
	cloned.Incidents[0].Updates[0].Message = "resolved"
	*cloned.Incidents[0].ResolvedAt = "changed"

	assert.Equal(t, "api", original.Incidents[0].AffectedServices[0])
	assert.Equal(t, "investigating", original.Incidents[0].Updates[0].Message)
	assert.Equal(t, "2026-07-10T12:00:00Z", *original.Incidents[0].ResolvedAt)
}

func TestStatusService_Publish(t *testing.T) {
	svc := NewStatusService()

	err := svc.Publish(context.Background())
	require.Error(t, err)
	require.ErrorIs(t, err, ErrStatusPublisherUnavailable)

	publisher := &statusPublisherStub{}
	svc = NewStatusService(publisher)
	require.NoError(t, svc.Publish(context.Background()))
	assert.Equal(t, ServiceStatusOperational, publisher.status.OverallStatus)

	expected := errors.New("publish failed")
	svc = NewStatusService(&statusPublisherStub{err: expected})
	err = svc.Publish(context.Background())
	require.ErrorIs(t, err, expected)
}

func TestStatusServicePublishBypassesCachedSnapshot(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	previousNow := statusNow
	statusNow = func() time.Time { return now }
	t.Cleanup(func() { statusNow = previousNow })

	source := &statusSourceStub{}
	publisher := &statusPublisherStub{}
	svc := NewStatusServiceWithSource(source, publisher)
	status, err := svc.GetServiceStatus(context.Background())
	require.NoError(t, err)
	assert.Equal(t, ServiceStatusOperational, status.OverallStatus)

	source.records = []StatusIncidentRecord{{
		ID: "1", ServiceID: "api", Status: ServiceStatusOutage, Message: "down", StartedAt: now,
	}}

	require.NoError(t, svc.Publish(context.Background()))
	assert.Equal(t, ServiceStatusOutage, publisher.status.OverallStatus)
}

func TestStatusServiceBoundaryRecordsAndPublishSourceFailure(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	previousNow := statusNow
	statusNow = func() time.Time { return now }
	t.Cleanup(func() { statusNow = previousNow })
	resolvedAt := now.Add(-time.Minute)
	svc := NewStatusServiceWithSource(statusSourceStub{records: []StatusIncidentRecord{
		{ID: "unknown", ServiceID: "missing", Status: ServiceStatusOutage, StartedAt: now},
		{ID: "invalid", ServiceID: "api", Status: StatusServiceStatus("invalid"), StartedAt: now},
		{ID: "zero", ServiceID: "api", Status: ServiceStatusOutage},
		{ID: "maintenance", ServiceID: "api", Status: ServiceStatusMaintenance, StartedAt: now, ResolvedAt: &resolvedAt},
	}})
	status, err := svc.GetServiceStatus(context.Background())
	require.NoError(t, err)
	assert.Equal(t, ServiceStatusMaintenance, status.OverallStatus)
	require.Len(t, status.Incidents, 1)
	require.NotNil(t, status.Incidents[0].ResolvedAt)

	expected := errors.New("source failed")
	svc = NewStatusServiceWithSource(statusSourceStub{err: expected}, &statusPublisherStub{})
	require.ErrorIs(t, svc.Publish(context.Background()), expected)
}
