package projects

import (
	"context"
	"log/slog"
	"strconv"
	"time"
)

// Project represents a project domain model
type Project struct {
	ID                 int32     `json:"id"`
	UserID             int32     `json:"userId"`
	OrganizationID     *int32    `json:"organizationId"`
	Name               string    `json:"name"`
	Description        *string   `json:"description"`
	CustomInstructions *string   `json:"customInstructions"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type CreateProjectInput struct {
	UserID             int32
	OrganizationID     *int32
	Name               string
	Description        *string
	CustomInstructions *string
}

type UpdateProjectInput struct {
	ID             int32
	UserID         int32
	OrganizationID *int32
	Name           string
}

type Service interface {
	GetUserProjects(ctx context.Context, userID int32, orgID *int32) ([]Project, error)
	ListProjects(ctx context.Context, userID int32) ([]Project, error)
	CreateProject(ctx context.Context, input CreateProjectInput) (*Project, error)
	UpdateProject(ctx context.Context, input UpdateProjectInput) (*Project, error)
	DeleteProject(ctx context.Context, id int32, userID int32, orgID *int32) error
}

type AuditAction string

const (
	AuditActionCreate AuditAction = "CREATE"
	AuditActionUpdate AuditAction = "UPDATE"
	AuditActionDelete AuditAction = "DELETE"
)

type AuditEntry struct {
	UserID         *string
	OrganizationID *int32
	Action         AuditAction
	Resource       string
	ResourceID     *string
	Success        bool
	ErrorMessage   *string
}

type AuditLogger interface {
	CreateAuditLog(entry AuditEntry)
}

type ProjectStore interface {
	GetProjectsByUser(ctx context.Context, userID int32) ([]ProjectRecord, error)
	GetProjectsByUserAndOrg(ctx context.Context, input GetProjectsByUserAndOrgInput) ([]ProjectRecord, error)
	CreateProject(ctx context.Context, input CreateProjectStoreInput) (ProjectRecord, error)
	UpdateProjectName(ctx context.Context, input UpdateProjectInput) (ProjectRecord, error)
	DeleteProject(ctx context.Context, input DeleteProjectInput) error
	DeleteProjectWithOrg(ctx context.Context, input DeleteProjectWithOrgInput) error
}

type ProjectRecord struct {
	ID                 int32
	UserID             int32
	OrganizationID     *int32
	Name               string
	Description        *string
	CustomInstructions *string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type GetProjectsByUserAndOrgInput struct {
	UserID         int32
	OrganizationID *int32
}

type CreateProjectStoreInput struct {
	UserID             int32
	OrganizationID     *int32
	Name               string
	Description        *string
	CustomInstructions *string
}

type DeleteProjectInput struct {
	ID     int32
	UserID int32
}

type DeleteProjectWithOrgInput struct {
	ID             int32
	UserID         int32
	OrganizationID *int32
}

type ProjectService struct {
	store ProjectStore
	audit AuditLogger
}

func NewService(store ProjectStore, auditLogger AuditLogger) *ProjectService {
	return &ProjectService{
		store: store,
		audit: auditLogger,
	}
}

func (s *ProjectService) GetUserProjects(ctx context.Context, userID int32, orgID *int32) ([]Project, error) {
	var rows []ProjectRecord
	var err error

	// Use org-filtered query for enterprise isolation when orgID is provided
	if orgID != nil {
		rows, err = s.store.GetProjectsByUserAndOrg(ctx, GetProjectsByUserAndOrgInput{
			UserID:         userID,
			OrganizationID: orgID,
		})
	} else {
		rows, err = s.store.GetProjectsByUser(ctx, userID)
	}
	if err != nil {
		slog.Error("Failed to fetch user projects", "userID", userID, "orgID", orgID, "error", err)
		return nil, err
	}

	projs := make([]Project, 0, len(rows))
	for _, p := range rows {
		projs = append(projs, Project(p))
	}
	return projs, nil
}

func (s *ProjectService) ListProjects(ctx context.Context, userID int32) ([]Project, error) {
	return s.GetUserProjects(ctx, userID, nil)
}

func (s *ProjectService) CreateProject(ctx context.Context, input CreateProjectInput) (*Project, error) {
	p, err := s.store.CreateProject(ctx, CreateProjectStoreInput(input))
	if err != nil {
		slog.Error("Failed to create project", "userID", input.UserID, "error", err)
		return nil, err
	}

	proj := (*Project)(&p)
	s.auditProject(input.UserID, input.OrganizationID, AuditActionCreate, proj.ID, nil)
	return proj, nil
}

func (s *ProjectService) UpdateProject(ctx context.Context, input UpdateProjectInput) (*Project, error) {
	p, err := s.store.UpdateProjectName(ctx, input)
	if err != nil {
		slog.Error("Failed to update project", "projectID", input.ID, "userID", input.UserID, "error", err)
		s.auditProject(input.UserID, input.OrganizationID, AuditActionUpdate, input.ID, err)
		return nil, err
	}

	proj := (*Project)(&p)
	s.auditProject(input.UserID, input.OrganizationID, AuditActionUpdate, proj.ID, nil)
	return proj, nil
}

func (s *ProjectService) DeleteProject(ctx context.Context, id int32, userID int32, orgID *int32) error {
	var err error

	// Use org-filtered query for enterprise isolation when orgID is provided
	if orgID != nil {
		err = s.store.DeleteProjectWithOrg(ctx, DeleteProjectWithOrgInput{
			ID:             id,
			UserID:         userID,
			OrganizationID: orgID,
		})
	} else {
		err = s.store.DeleteProject(ctx, DeleteProjectInput{
			ID:     id,
			UserID: userID,
		})
	}

	if err != nil {
		slog.Error("Failed to delete project", "projectID", id, "userID", userID, "error", err)
	}

	s.auditProject(userID, orgID, AuditActionDelete, id, err)
	return err
}

func (s *ProjectService) auditProject(userID int32, orgID *int32, action AuditAction, id int32, err error) {
	if s.audit == nil {
		return
	}
	uid, resourceID := strconv.Itoa(int(userID)), strconv.Itoa(int(id))
	entry := AuditEntry{
		UserID:         &uid,
		OrganizationID: orgID,
		Action:         action,
		Resource:       "project",
		ResourceID:     &resourceID,
		Success:        err == nil,
	}
	if err != nil {
		msg := err.Error()
		entry.ErrorMessage = &msg
	}
	s.audit.CreateAuditLog(entry)
}
