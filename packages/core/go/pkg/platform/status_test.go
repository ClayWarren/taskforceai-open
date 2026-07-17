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
		{ID: "future", ServiceID: "api", Status: ServiceStatusOutage, StartedAt: now.Add(time.Minute)},
		{ID: "maintenance", ServiceID: "api", Status: ServiceStatusMaintenance, StartedAt: now, ResolvedAt: &resolvedAt},
	}})
	status, err := svc.GetServiceStatus(context.Background())
	require.NoError(t, err)
	assert.Equal(t, ServiceStatusOperational, status.OverallStatus)
	assert.Empty(t, status.Incidents)

	expected := errors.New("source failed")
	svc = NewStatusServiceWithSource(statusSourceStub{err: expected}, &statusPublisherStub{})
	require.ErrorIs(t, svc.Publish(context.Background()), expected)
}

func TestStatusServiceTracksIncidentLifetimeAndResolution(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	resolvedAt := time.Date(2026, 7, 9, 10, 0, 0, 0, time.UTC)
	status := buildStatusResponse(now, []StatusIncidentRecord{{
		ID:         "outage-1",
		ServiceID:  "api",
		Status:     ServiceStatusOutage,
		Message:    "API unavailable",
		StartedAt:  time.Date(2026, 7, 7, 10, 0, 0, 0, time.UTC),
		ResolvedAt: &resolvedAt,
	}})

	assert.Equal(t, ServiceStatusOperational, status.OverallStatus)
	require.Len(t, status.Incidents, 1)
	assert.Equal(t, "outage-1", status.Incidents[0].ID)
	require.NotNil(t, status.Incidents[0].ResolvedAt)
	assert.Equal(t, resolvedAt.Format(time.RFC3339), *status.Incidents[0].ResolvedAt)
	apiIndex := slices.IndexFunc(status.Services, func(service ServiceInfo) bool { return service.ID == "api" })
	require.GreaterOrEqual(t, apiIndex, 0)
	api := status.Services[apiIndex]
	assert.Equal(t, ServiceStatusOperational, api.Status)
	assert.InDelta(t, float64(87)/90*100, api.UptimePercent, 0.0001)
	for _, date := range []string{"2026-07-07", "2026-07-08", "2026-07-09"} {
		dayIndex := slices.IndexFunc(api.UptimeHistory, func(day DayStatus) bool { return day.Date == date })
		require.GreaterOrEqual(t, dayIndex, 0)
		assert.Equal(t, ServiceStatusOutage, api.UptimeHistory[dayIndex].Status)
	}
}

func TestStatusServiceOperationalRecordEndsPriorIncident(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	status := buildStatusResponse(now, []StatusIncidentRecord{
		{ID: "outage", ServiceID: "api", Status: ServiceStatusOutage, StartedAt: now.Add(-2 * time.Hour)},
		{ID: "restored", ServiceID: "api", Status: ServiceStatusOperational, StartedAt: now.Add(-time.Hour)},
	})

	assert.Equal(t, ServiceStatusOperational, status.OverallStatus)
	require.Len(t, status.Incidents, 1)
	assert.Equal(t, "outage", status.Incidents[0].ID)
	require.NotNil(t, status.Incidents[0].ResolvedAt)
	assert.Equal(t, now.Add(-time.Hour).Format(time.RFC3339), *status.Incidents[0].ResolvedAt)
	apiIndex := slices.IndexFunc(status.Services, func(service ServiceInfo) bool { return service.ID == "api" })
	require.GreaterOrEqual(t, apiIndex, 0)
	api := status.Services[apiIndex]
	assert.Equal(t, ServiceStatusOperational, api.Status)
	assert.Equal(t, ServiceStatusOutage, api.UptimeHistory[len(api.UptimeHistory)-1].Status)
}

func TestStatusServiceOverlappingSeverityAndWindowEdges(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	futureResolution := now.Add(time.Hour)
	status := buildStatusResponse(now, []StatusIncidentRecord{
		{
			ID:        "old",
			ServiceID: "api",
			Status:    ServiceStatusDegraded,
			StartedAt: now.AddDate(0, 0, -100),
		},
		{
			ID:        "maintenance",
			ServiceID: "api",
			Status:    ServiceStatusMaintenance,
			StartedAt: now.Add(-4 * time.Hour),
		},
		{
			ID:         "outage",
			ServiceID:  "api",
			Status:     ServiceStatusOutage,
			StartedAt:  now.Add(-3 * time.Hour),
			ResolvedAt: &futureResolution,
		},
	})

	assert.Equal(t, ServiceStatusOutage, status.OverallStatus)
	require.Len(t, status.Incidents, 3)
	assert.Equal(t, []string{"outage", "maintenance", "old"}, []string{
		status.Incidents[0].ID,
		status.Incidents[1].ID,
		status.Incidents[2].ID,
	})
	require.NotNil(t, status.Incidents[0].ResolvedAt)
	assert.Equal(t, futureResolution.Format(time.RFC3339), *status.Incidents[0].ResolvedAt)
	require.NotNil(t, status.Incidents[1].ResolvedAt)
	assert.Equal(t, now.Add(-3*time.Hour).Format(time.RFC3339), *status.Incidents[1].ResolvedAt)
	require.NotNil(t, status.Incidents[2].ResolvedAt)
	assert.Equal(t, now.Add(-4*time.Hour).Format(time.RFC3339), *status.Incidents[2].ResolvedAt)
	apiIndex := slices.IndexFunc(status.Services, func(service ServiceInfo) bool { return service.ID == "api" })
	require.GreaterOrEqual(t, apiIndex, 0)
	assert.Equal(t, ServiceStatusOutage, status.Services[apiIndex].UptimeHistory[len(status.Services[apiIndex].UptimeHistory)-1].Status)
}

func TestStatusServiceExcludesIncidentsOutsideHistoryWindow(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	resolvedAt := now.AddDate(0, 0, -15)
	status := buildStatusResponse(now, []StatusIncidentRecord{{
		ID:         "old-outage",
		ServiceID:  "api",
		Status:     ServiceStatusOutage,
		StartedAt:  now.AddDate(0, 0, -16),
		ResolvedAt: &resolvedAt,
	}})

	assert.Empty(t, status.Incidents)
}
