package platform

import (
	"context"
	"errors"
	"slices"
	"sync"
	"time"
)

type StatusServiceStatus = string

const (
	ServiceStatusOperational StatusServiceStatus = "operational"
	ServiceStatusDegraded    StatusServiceStatus = "degraded"
	ServiceStatusOutage      StatusServiceStatus = "outage"
	ServiceStatusMaintenance StatusServiceStatus = "maintenance"
)

var ServiceOrder = []string{"website", "web", "ios", "android", "api", "cli", "docs", "console"}
var ServiceNames = map[string]string{
	"website": "TaskForceAI Website", "web": "Web App", "ios": "iOS",
	"android": "Android", "api": "API", "cli": "CLI",
	"docs": "Documentation", "console": "Developer Console",
}

type DayStatus struct {
	Date    string              `json:"date"`
	Status  StatusServiceStatus `json:"status"`
	Message string              `json:"message,omitempty"`
}

type ServiceInfo struct {
	ID            string              `json:"id"`
	Name          string              `json:"name"`
	Status        StatusServiceStatus `json:"status"`
	UptimePercent float64             `json:"uptimePercent"`
	UptimeHistory []DayStatus         `json:"uptimeHistory"`
}

type StatusResponse struct {
	OverallStatus StatusServiceStatus `json:"overallStatus"`
	Services      []ServiceInfo       `json:"services"`
	Incidents     []Incident          `json:"incidents"`
	LastUpdated   string              `json:"lastUpdated"`
}

type Incident struct {
	ID               string           `json:"id"`
	Title            string           `json:"title"`
	Status           string           `json:"status"`
	AffectedServices []string         `json:"affectedServices"`
	Updates          []IncidentUpdate `json:"updates"`
	CreatedAt        string           `json:"createdAt"`
	ResolvedAt       *string          `json:"resolvedAt,omitempty"`
}

type IncidentUpdate struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	Message   string `json:"message"`
	CreatedAt string `json:"createdAt"`
}

const statusSnapshotCacheTTL = 15 * time.Second

var ErrStatusPublisherUnavailable = errors.New("status publisher unavailable")

type StatusPublisher interface {
	PublishStatus(ctx context.Context, status StatusResponse) error
}

type StatusIncidentRecord struct {
	ID         string
	ServiceID  string
	Status     StatusServiceStatus
	Message    string
	StartedAt  time.Time
	ResolvedAt *time.Time
}

type StatusSource interface {
	ListStatusIncidents(ctx context.Context, limit int) ([]StatusIncidentRecord, error)
}

type StatusService struct {
	mu          sync.RWMutex
	cached      StatusResponse
	cachedUntil time.Time
	source      StatusSource
	publisher   StatusPublisher
}

func NewStatusService(publisher ...StatusPublisher) *StatusService {
	var configured StatusPublisher
	if len(publisher) > 0 {
		configured = publisher[0]
	}
	return &StatusService{publisher: configured}
}

func NewStatusServiceWithSource(source StatusSource, publisher ...StatusPublisher) *StatusService {
	service := NewStatusService(publisher...)
	service.source = source
	return service
}

var statusNow = func() time.Time { return time.Now().UTC() }

func (s *StatusService) GetServiceStatus(ctx context.Context) (StatusResponse, error) {
	return s.loadServiceStatus(ctx, false)
}

func (s *StatusService) loadServiceStatus(ctx context.Context, forceRefresh bool) (StatusResponse, error) {
	today := statusNow()

	if !forceRefresh {
		s.mu.RLock()
		if !s.cachedUntil.IsZero() && today.Before(s.cachedUntil) {
			status := cloneStatusResponse(s.cached)
			s.mu.RUnlock()
			return status, nil
		}
		s.mu.RUnlock()

		today = statusNow()
		s.mu.RLock()
		if !s.cachedUntil.IsZero() && today.Before(s.cachedUntil) {
			status := cloneStatusResponse(s.cached)
			s.mu.RUnlock()
			return status, nil
		}
		s.mu.RUnlock()
	}

	var records []StatusIncidentRecord
	if s.source != nil {
		var err error
		records, err = s.source.ListStatusIncidents(ctx, 1000)
		if err != nil {
			return StatusResponse{}, err
		}
	}

	status := buildStatusResponse(today, records)
	s.mu.Lock()
	s.cached = status
	s.cachedUntil = today.Add(statusSnapshotCacheTTL)
	s.mu.Unlock()
	return cloneStatusResponse(status), nil
}

func buildStatusResponse(today time.Time, records []StatusIncidentRecord) StatusResponse {
	const daysToShow = 90
	dayIndex := make(map[string]int, daysToShow)

	services := make([]ServiceInfo, len(ServiceOrder))
	for i, id := range ServiceOrder {
		history := make([]DayStatus, daysToShow)
		for d := range daysToShow {
			date := today.AddDate(0, 0, -(daysToShow - 1 - d))
			dateKey := date.Format("2006-01-02")
			history[d] = DayStatus{Date: dateKey, Status: ServiceStatusOperational}
			dayIndex[dateKey] = d
		}
		services[i] = ServiceInfo{
			ID: id, Name: ServiceNames[id], Status: ServiceStatusOperational,
			UptimePercent: 100.0, UptimeHistory: history,
		}
	}

	serviceIndex := make(map[string]int, len(services))
	for index, service := range services {
		serviceIndex[service.ID] = index
	}

	sortedRecords := slices.Clone(records)
	slices.SortStableFunc(sortedRecords, func(left, right StatusIncidentRecord) int {
		return left.StartedAt.Compare(right.StartedAt)
	})
	latestByService := make(map[string]StatusIncidentRecord, len(services))
	for _, record := range sortedRecords {
		index, knownService := serviceIndex[record.ServiceID]
		if !knownService || !isStatusValue(record.Status) || record.StartedAt.IsZero() {
			continue
		}
		latestByService[record.ServiceID] = record
		if historyIndex, inWindow := dayIndex[record.StartedAt.UTC().Format("2006-01-02")]; inWindow {
			services[index].UptimeHistory[historyIndex] = DayStatus{
				Date:    services[index].UptimeHistory[historyIndex].Date,
				Status:  record.Status,
				Message: record.Message,
			}
		}
	}

	overallStatus := ServiceStatusOperational
	activeIncidents := make([]Incident, 0)
	for index := range services {
		service := &services[index]
		if latest, ok := latestByService[service.ID]; ok {
			service.Status = latest.Status
			if latest.Status != ServiceStatusOperational {
				activeIncidents = append(activeIncidents, incidentFromStatusRecord(latest, service.Name))
			}
		}
		if statusRank(service.Status) > statusRank(overallStatus) {
			overallStatus = service.Status
		}
		operationalDays := 0
		for _, day := range service.UptimeHistory {
			if day.Status == ServiceStatusOperational {
				operationalDays++
			}
		}
		service.UptimePercent = float64(operationalDays) / float64(daysToShow) * 100
	}

	return StatusResponse{
		OverallStatus: overallStatus,
		Services:      services,
		Incidents:     activeIncidents,
		LastUpdated:   today.Format(time.RFC3339),
	}
}

func isStatusValue(status StatusServiceStatus) bool {
	return status == ServiceStatusOperational || status == ServiceStatusDegraded || status == ServiceStatusOutage || status == ServiceStatusMaintenance
}

func statusRank(status StatusServiceStatus) int {
	switch status {
	case ServiceStatusOutage:
		return 3
	case ServiceStatusDegraded:
		return 2
	case ServiceStatusMaintenance:
		return 1
	default:
		return 0
	}
}

func incidentFromStatusRecord(record StatusIncidentRecord, serviceName string) Incident {
	createdAt := record.StartedAt.UTC().Format(time.RFC3339)
	update := IncidentUpdate{
		ID:        record.ID,
		Status:    record.Status,
		Message:   record.Message,
		CreatedAt: createdAt,
	}
	incident := Incident{
		ID:               record.ID,
		Title:            serviceName + " incident",
		Status:           record.Status,
		AffectedServices: []string{record.ServiceID},
		Updates:          []IncidentUpdate{update},
		CreatedAt:        createdAt,
	}
	if record.ResolvedAt != nil {
		resolvedAt := record.ResolvedAt.UTC().Format(time.RFC3339)
		incident.ResolvedAt = &resolvedAt
	}
	return incident
}

func cloneStatusResponse(status StatusResponse) StatusResponse {
	cloned := status
	cloned.Services = slices.Clone(status.Services)
	for i := range cloned.Services {
		cloned.Services[i].UptimeHistory = slices.Clone(status.Services[i].UptimeHistory)
	}
	cloned.Incidents = slices.Clone(status.Incidents)
	for i := range cloned.Incidents {
		cloned.Incidents[i].AffectedServices = slices.Clone(status.Incidents[i].AffectedServices)
		cloned.Incidents[i].Updates = slices.Clone(status.Incidents[i].Updates)
		if status.Incidents[i].ResolvedAt != nil {
			resolvedAt := *status.Incidents[i].ResolvedAt
			cloned.Incidents[i].ResolvedAt = &resolvedAt
		}
	}
	return cloned
}

func (s *StatusService) Publish(ctx context.Context) error {
	if s.publisher == nil {
		return ErrStatusPublisherUnavailable
	}
	status, err := s.loadServiceStatus(ctx, true)
	if err != nil {
		return err
	}
	return s.publisher.PublishStatus(ctx, status)
}
