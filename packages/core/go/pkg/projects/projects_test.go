package projects

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type stubProjectStore struct {
	getProjectsByUserFunc       func(ctx context.Context, userID int32) ([]ProjectRecord, error)
	getProjectsByUserAndOrgFunc func(ctx context.Context, input GetProjectsByUserAndOrgInput) ([]ProjectRecord, error)
	createProjectFunc           func(ctx context.Context, input CreateProjectStoreInput) (ProjectRecord, error)
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

func (s stubProjectStore) DeleteProject(ctx context.Context, input DeleteProjectInput) error {
	return s.deleteProjectFunc(ctx, input)
}

func (s stubProjectStore) DeleteProjectWithOrg(ctx context.Context, input DeleteProjectWithOrgInput) error {
	return s.deleteProjectWithOrgFunc(ctx, input)
}

type MockAuditRepo struct {
	mock.Mock
}

func (m *MockAuditRepo) CreateAuditLog(entry AuditEntry) {
	m.Called(entry)
}

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

func TestProjectService_DeleteProject_Error(t *testing.T) {
	svc := NewService(stubProjectStore{
		deleteProjectFunc: func(_ context.Context, _ DeleteProjectInput) error {
			return errors.New("db error")
		},
	}, nil)

	err := svc.DeleteProject(context.Background(), 5, 1, nil)

	require.Error(t, err)
}

func TestCreateProject_AuditLogOnSuccess(t *testing.T) {
	now := time.Now()
	mockRepo := new(MockAuditRepo)
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
	}, mockRepo)
	desc := "desc"

	uid := "1"
	resourceID := "7"
	mockRepo.On("CreateAuditLog", AuditEntry{
		UserID:         &uid,
		OrganizationID: nil,
		Action:         AuditActionCreate,
		Resource:       "project",
		ResourceID:     &resourceID,
		Success:        true,
	}).Once()

	project, err := svc.CreateProject(context.Background(), CreateProjectInput{
		UserID:      1,
		Name:        "Project",
		Description: &desc,
	})

	require.NoError(t, err)
	require.NotNil(t, project)
	mockRepo.AssertExpectations(t)
}

func TestDeleteProject_AuditLogOnFailure(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	svc := NewService(stubProjectStore{
		deleteProjectFunc: func(_ context.Context, _ DeleteProjectInput) error {
			return errors.New("delete failed")
		},
	}, mockRepo)

	uid := "1"
	resourceID := "6"
	errMsg := "delete failed"
	mockRepo.On("CreateAuditLog", AuditEntry{
		UserID:         &uid,
		OrganizationID: nil,
		Action:         AuditActionDelete,
		Resource:       "project",
		ResourceID:     &resourceID,
		Success:        false,
		ErrorMessage:   &errMsg,
	}).Once()

	err := svc.DeleteProject(context.Background(), 6, 1, nil)

	require.Error(t, err)
	mockRepo.AssertExpectations(t)
}
