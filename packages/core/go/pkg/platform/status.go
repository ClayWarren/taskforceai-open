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

const (
	statusSnapshotCacheTTL = 15 * time.Second
	incidentHistoryDays    = 14
)

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
	services, dayIndex, serviceIndex := initializeStatusServices(today, daysToShow)
	validRecords, latestByService := prepareStatusRecords(today, records, serviceIndex)
	recentIncidents := applyStatusRecords(today, services, dayIndex, serviceIndex, validRecords)
	overallStatus := summarizeStatusServices(today, services, latestByService, daysToShow)

	return StatusResponse{
		OverallStatus: overallStatus,
		Services:      services,
		Incidents:     recentIncidents,
		LastUpdated:   today.Format(time.RFC3339),
	}
}

func initializeStatusServices(today time.Time, daysToShow int) ([]ServiceInfo, map[string]int, map[string]int) {
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
	return services, dayIndex, serviceIndex
}

func prepareStatusRecords(today time.Time, records []StatusIncidentRecord, serviceIndex map[string]int) ([]StatusIncidentRecord, map[string]StatusIncidentRecord) {
	sortedRecords := slices.Clone(records)
	slices.SortStableFunc(sortedRecords, func(left, right StatusIncidentRecord) int {
		return left.StartedAt.Compare(right.StartedAt)
	})
	latestByService := make(map[string]StatusIncidentRecord, len(serviceIndex))
	validRecords := make([]StatusIncidentRecord, 0, len(sortedRecords))
	for _, record := range sortedRecords {
		_, knownService := serviceIndex[record.ServiceID]
		if !knownService || !isStatusValue(record.Status) || record.StartedAt.IsZero() || record.StartedAt.After(today) {
			continue
		}
		latestByService[record.ServiceID] = record
		validRecords = append(validRecords, record)
	}
	return validRecords, latestByService
}

func applyStatusRecords(today time.Time, services []ServiceInfo, dayIndex, serviceIndex map[string]int, records []StatusIncidentRecord) []Incident {
	incidentCutoff := today.AddDate(0, 0, -incidentHistoryDays)
	recentIncidents := make([]Incident, 0)
	nextStartByService := make(map[string]time.Time, len(services))
	for recordIndex := len(records) - 1; recordIndex >= 0; recordIndex-- {
		record := records[recordIndex]
		if record.Status == ServiceStatusOperational {
			nextStartByService[record.ServiceID] = record.StartedAt
			continue
		}
		end := today
		incidentRecord := record
		if nextStart, ok := nextStartByService[record.ServiceID]; ok && nextStart.Before(end) {
			end = nextStart
			if incidentRecord.ResolvedAt == nil || nextStart.Before(*incidentRecord.ResolvedAt) {
				resolvedAt := nextStart
				incidentRecord.ResolvedAt = &resolvedAt
			}
		}
		if record.ResolvedAt != nil && record.ResolvedAt.Before(end) {
			end = *record.ResolvedAt
		}
		service := &services[serviceIndex[record.ServiceID]]
		applyStatusInterval(service, dayIndex, record, end)
		if end.After(record.StartedAt) && !end.Before(incidentCutoff) {
			recentIncidents = append(recentIncidents, incidentFromStatusRecord(incidentRecord, service.Name))
		}
		nextStartByService[record.ServiceID] = record.StartedAt
	}
	return recentIncidents
}

func summarizeStatusServices(today time.Time, services []ServiceInfo, latestByService map[string]StatusIncidentRecord, daysToShow int) StatusServiceStatus {
	overallStatus := ServiceStatusOperational
	for index := range services {
		service := &services[index]
		if latest, ok := latestByService[service.ID]; ok {
			active := latest.ResolvedAt == nil || latest.ResolvedAt.After(today)
			if active {
				service.Status = latest.Status
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
	return overallStatus
}

func applyStatusInterval(service *ServiceInfo, dayIndex map[string]int, record StatusIncidentRecord, end time.Time) {
	startUTC := record.StartedAt.UTC()
	startDay := time.Date(startUTC.Year(), startUTC.Month(), startUTC.Day(), 0, 0, 0, 0, time.UTC)
	endUTC := end.UTC()
	if !endUTC.After(startUTC) {
		return
	}
	for day := startDay; day.Before(endUTC); day = day.AddDate(0, 0, 1) {
		historyIndex, inWindow := dayIndex[day.Format("2006-01-02")]
		if !inWindow {
			continue
		}
		existing := service.UptimeHistory[historyIndex]
		if statusRank(record.Status) < statusRank(existing.Status) {
			continue
		}
		service.UptimeHistory[historyIndex] = DayStatus{
			Date:    existing.Date,
			Status:  record.Status,
			Message: record.Message,
		}
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
