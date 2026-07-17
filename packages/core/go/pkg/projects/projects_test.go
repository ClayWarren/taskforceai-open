package projects

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubProjectStore struct {
	getProjectsByUserFunc       func(ctx context.Context, userID int32) ([]ProjectRecord, error)
	getProjectsByUserAndOrgFunc func(ctx context.Context, input GetProjectsByUserAndOrgInput) ([]ProjectRecord, error)
	createProjectFunc           func(ctx context.Context, input CreateProjectStoreInput) (ProjectRecord, error)
	updateProjectNameFunc       func(ctx context.Context, input UpdateProjectInput) (ProjectRecord, error)
	deleteProjectFunc           func(ctx context.Context, input DeleteProjectInput) error
	deleteProjectWithOrgFunc    func(ctx context.Context, input DeleteProjectWithOrgInput) error
}

func (s stubProjectStore) GetProjectsByUser(ctx context.Context, userID int32) ([]ProjectRecord, error) {
	return s.getProjectsByUserFunc(ctx, userID)
}

func (s stubProjectStore) GetProjectsByUserAndOrg(ctx context.Context, input GetProjectsByUserAndOrgInput) ([]ProjectRecord, error) {
	return s.getProjectsByUserAndOrgFunc(ctx, input)
}

func (s stubProjectStore) CreateProject(ctx context.Context, input CreateProjectStoreInput) (ProjectRecord, error) {
	return s.createProjectFunc(ctx, input)
}

func (s stubProjectStore) UpdateProjectName(ctx context.Context, input UpdateProjectInput) (ProjectRecord, error) {
	return s.updateProjectNameFunc(ctx, input)
}

func (s stubProjectStore) DeleteProject(ctx context.Context, input DeleteProjectInput) error {
	return s.deleteProjectFunc(ctx, input)
}

func (s stubProjectStore) DeleteProjectWithOrg(ctx context.Context, input DeleteProjectWithOrgInput) error {
	return s.deleteProjectWithOrgFunc(ctx, input)
}

type auditLoggerFunc func(AuditEntry)

func (log auditLoggerFunc) CreateAuditLog(entry AuditEntry) { log(entry) }

func TestProjectService_GetUserProjects(t *testing.T) {
	now := time.Now()
	desc := "Test description"

	svc := NewService(stubProjectStore{
		getProjectsByUserFunc: func(_ context.Context, userID int32) ([]ProjectRecord, error) {
			assert.Equal(t, int32(1), userID)
			return []ProjectRecord{{
				ID:             1,
				UserID:         1,
				OrganizationID: nil,
				Name:           "Project 1",
				Description:    &desc,
				CreatedAt:      now,
			}}, nil
		},
	}, nil)

	projects, err := svc.GetUserProjects(context.Background(), 1, nil)

	require.NoError(t, err)
	assert.Len(t, projects, 1)
	assert.Equal(t, "Project 1", projects[0].Name)
}

func TestProjectService_GetUserProjects_WithOrg(t *testing.T) {
	now := time.Now()
	desc := "org desc"
	orgID := int32(10)

	svc := NewService(stubProjectStore{
		getProjectsByUserAndOrgFunc: func(_ context.Context, input GetProjectsByUserAndOrgInput) ([]ProjectRecord, error) {
			assert.Equal(t, int32(1), input.UserID)
			assert.Equal(t, &orgID, input.OrganizationID)
			return []ProjectRecord{{
				ID:             2,
				UserID:         1,
				OrganizationID: &orgID,
				Name:           "Org Project",
				Description:    &desc,
				CreatedAt:      now,
			}}, nil
		},
	}, nil)

	projects, err := svc.GetUserProjects(context.Background(), 1, &orgID)

	require.NoError(t, err)
	assert.Len(t, projects, 1)
	assert.Equal(t, "Org Project", projects[0].Name)
}

func TestProjectService_GetUserProjects_Error(t *testing.T) {
	svc := NewService(stubProjectStore{
		getProjectsByUserFunc: func(_ context.Context, _ int32) ([]ProjectRecord, error) {
			return nil, errors.New("db error")
		},
	}, nil)

	projects, err := svc.GetUserProjects(context.Background(), 1, nil)

	require.Error(t, err)
	assert.Nil(t, projects)
}

func TestProjectService_ListProjects(t *testing.T) {
	svc := NewService(stubProjectStore{
		getProjectsByUserFunc: func(_ context.Context, userID int32) ([]ProjectRecord, error) {
			assert.Equal(t, int32(2), userID)
			return []ProjectRecord{}, nil
		},
	}, nil)

	projects, err := svc.ListProjects(context.Background(), 2)

	require.NoError(t, err)
	assert.Empty(t, projects)
}

func TestProjectService_CreateProject(t *testing.T) {
	now := time.Now()
	desc := "New project"

	svc := NewService(stubProjectStore{
		createProjectFunc: func(_ context.Context, input CreateProjectStoreInput) (ProjectRecord, error) {
			assert.Equal(t, int32(1), input.UserID)
			assert.Equal(t, "New Project", input.Name)
			assert.Equal(t, &desc, input.Description)
			return ProjectRecord{
				ID:          5,
				UserID:      1,
				Name:        "New Project",
				Description: &desc,
				CreatedAt:   now,
			}, nil
		},
	}, nil)

	project, err := svc.CreateProject(context.Background(), CreateProjectInput{
		UserID:      1,
		Name:        "New Project",
		Description: &desc,
	})

	require.NoError(t, err)
	assert.Equal(t, int32(5), project.ID)
}

func TestProjectService_CreateProject_Error(t *testing.T) {
	svc := NewService(stubProjectStore{
		createProjectFunc: func(_ context.Context, _ CreateProjectStoreInput) (ProjectRecord, error) {
			return ProjectRecord{}, errors.New("db error")
		},
	}, nil)

	project, err := svc.CreateProject(context.Background(), CreateProjectInput{
		UserID: 1,
		Name:   "Fail",
	})

	require.Error(t, err)
	assert.Nil(t, project)
}

func TestProjectService_UpdateProject(t *testing.T) {
	now := time.Now()
	orgID := int32(10)
	var auditEntry AuditEntry
	svc := NewService(stubProjectStore{
		updateProjectNameFunc: func(_ context.Context, input UpdateProjectInput) (ProjectRecord, error) {
			assert.Equal(t, int32(5), input.ID)
			assert.Equal(t, int32(1), input.UserID)
			assert.Equal(t, &orgID, input.OrganizationID)
			assert.Equal(t, "Renamed Project", input.Name)
			return ProjectRecord{
				ID:             input.ID,
				UserID:         input.UserID,
				OrganizationID: input.OrganizationID,
				Name:           input.Name,
				CreatedAt:      now,
			}, nil
		},
	}, auditLoggerFunc(func(entry AuditEntry) { auditEntry = entry }))

	project, err := svc.UpdateProject(context.Background(), UpdateProjectInput{
		ID:             5,
		UserID:         1,
		OrganizationID: &orgID,
		Name:           "Renamed Project",
	})

	require.NoError(t, err)
	require.NotNil(t, project)
	assert.Equal(t, "Renamed Project", project.Name)
	assert.Equal(t, AuditActionUpdate, auditEntry.Action)
	assert.Equal(t, "5", *auditEntry.ResourceID)
	assert.True(t, auditEntry.Success)
}

func TestProjectService_UpdateProject_Error(t *testing.T) {
	var auditEntry AuditEntry
	svc := NewService(stubProjectStore{
		updateProjectNameFunc: func(_ context.Context, _ UpdateProjectInput) (ProjectRecord, error) {
			return ProjectRecord{}, errors.New("update failed")
		},
	}, auditLoggerFunc(func(entry AuditEntry) { auditEntry = entry }))

	project, err := svc.UpdateProject(context.Background(), UpdateProjectInput{
		ID:     6,
		UserID: 1,
		Name:   "Fail",
	})

	require.Error(t, err)
	assert.Nil(t, project)
	assert.Equal(t, AuditActionUpdate, auditEntry.Action)
	assert.Equal(t, "update failed", *auditEntry.ErrorMessage)
	assert.False(t, auditEntry.Success)
}

func TestProjectService_DeleteProject(t *testing.T) {
	svc := NewService(stubProjectStore{
		deleteProjectFunc: func(_ context.Context, input DeleteProjectInput) error {
			assert.Equal(t, int32(5), input.ID)
			assert.Equal(t, int32(1), input.UserID)
			return nil
		},
	}, nil)

	err := svc.DeleteProject(context.Background(), 5, 1, nil)

	assert.NoError(t, err)
}

func TestProjectService_DeleteProject_WithOrgFilter(t *testing.T) {
	orgID := int32(10)
	svc := NewService(stubProjectStore{
		deleteProjectWithOrgFunc: func(_ context.Context, input DeleteProjectWithOrgInput) error {
			assert.Equal(t, int32(5), input.ID)
			assert.Equal(t, int32(1), input.UserID)
			assert.Equal(t, &orgID, input.OrganizationID)
			return nil
		},
	}, nil)

	err := svc.DeleteProject(context.Background(), 5, 1, &orgID)

	assert.NoError(t, err)
}

func TestCreateProject_AuditLogOnSuccess(t *testing.T) {
	now := time.Now()
	var auditEntry AuditEntry
	svc := NewService(stubProjectStore{
		createProjectFunc: func(_ context.Context, input CreateProjectStoreInput) (ProjectRecord, error) {
			return ProjectRecord{
				ID:          7,
				UserID:      input.UserID,
				Name:        input.Name,
				Description: input.Description,
				CreatedAt:   now,
			}, nil
		},
	}, auditLoggerFunc(func(entry AuditEntry) { auditEntry = entry }))
	desc := "desc"

	project, err := svc.CreateProject(context.Background(), CreateProjectInput{
		UserID:      1,
		Name:        "Project",
		Description: &desc,
	})

	require.NoError(t, err)
	require.NotNil(t, project)
	assert.Equal(t, AuditActionCreate, auditEntry.Action)
	assert.Equal(t, "1", *auditEntry.UserID)
	assert.Equal(t, "7", *auditEntry.ResourceID)
	assert.Equal(t, "project", auditEntry.Resource)
	assert.Nil(t, auditEntry.OrganizationID)
	assert.Nil(t, auditEntry.ErrorMessage)
	assert.True(t, auditEntry.Success)
}

func TestDeleteProject_AuditLogOnFailure(t *testing.T) {
	var auditEntry AuditEntry
	svc := NewService(stubProjectStore{
		deleteProjectFunc: func(_ context.Context, _ DeleteProjectInput) error {
			return errors.New("delete failed")
		},
	}, auditLoggerFunc(func(entry AuditEntry) { auditEntry = entry }))

	err := svc.DeleteProject(context.Background(), 6, 1, nil)

	require.Error(t, err)
	assert.Equal(t, AuditActionDelete, auditEntry.Action)
	assert.Equal(t, "1", *auditEntry.UserID)
	assert.Equal(t, "6", *auditEntry.ResourceID)
	assert.Equal(t, "project", auditEntry.Resource)
	assert.Nil(t, auditEntry.OrganizationID)
	assert.False(t, auditEntry.Success)
	assert.Equal(t, "delete failed", *auditEntry.ErrorMessage)
}
