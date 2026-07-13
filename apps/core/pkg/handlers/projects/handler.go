package projects

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/core/pkg/projects"
)

func projectResponse(project projects.Project) ProjectResponse {
	return ProjectResponse{
		ID: project.ID, Name: project.Name, Description: project.Description,
		CustomInstructions: project.CustomInstructions, CreatedAt: project.CreatedAt,
	}
}

func projectResponses(projects []projects.Project) []ProjectResponse {
	responses := make([]ProjectResponse, len(projects))
	for i, project := range projects {
		responses[i] = projectResponse(project)
	}
	return responses
}

// RegisterHandlers registers the projects handlers with the provided Huma API.
func RegisterHandlers(api huma.API, service projects.Service) {
	huma.Register(api, huma.Operation{
		OperationID: "list-projects",
		Method:      http.MethodGet,
		Path:        "/api/v1/projects",
		Summary:     "List projects",
		Tags:        []string{"Projects"},
	}, func(ctx context.Context, input *struct {
		handler.AuthContext
	}) (*struct{ Body []ProjectResponse }, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		ps, err := service.GetUserProjects(ctx, ids.UserID32, ids.OrgID32)
		if err != nil {
			slog.Error("Failed to fetch projects", "userId", ids.UserID32, "orgId", ids.OrgID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch projects")
		}

		return &struct{ Body []ProjectResponse }{Body: projectResponses(ps)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "create-project",
		Method:      http.MethodPost,
		Path:        "/api/v1/projects",
		Summary:     "Create project",
		Tags:        []string{"Projects"},
	}, func(ctx context.Context, input *struct {
		Body CreateProjectRequest
		handler.AuthContext
	}) (*struct{ Body ProjectResponse }, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		proj, err := service.CreateProject(ctx, projects.CreateProjectInput{
			UserID:             ids.UserID32,
			OrganizationID:     ids.OrgID32,
			Name:               input.Body.Name,
			Description:        input.Body.Description,
			CustomInstructions: input.Body.CustomInstructions,
		})
		if err != nil {
			slog.Error("Failed to create project", "userId", ids.UserID32, "orgId", ids.OrgID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to create project")
		}

		return &struct{ Body ProjectResponse }{Body: projectResponse(*proj)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "delete-project",
		Method:      http.MethodDelete,
		Path:        "/api/v1/projects/{id}",
		Summary:     "Delete project",
		Tags:        []string{"Projects"},
	}, func(ctx context.Context, input *struct {
		ID string `path:"id"`
		handler.AuthContext
	}) (*struct{}, error) {
		projectID, convErr := strconv.ParseInt(input.ID, 10, 32)
		if convErr != nil || projectID <= 0 {
			return nil, huma.Error422UnprocessableEntity("Invalid project ID")
		}

		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		if err := service.DeleteProject(ctx, int32(projectID), ids.UserID32, ids.OrgID32); err != nil {
			slog.Error("Failed to delete project", "projectId", input.ID, "userId", ids.UserID32, "orgId", ids.OrgID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to delete project")
		}
		return &struct{}{}, nil
	})
}
