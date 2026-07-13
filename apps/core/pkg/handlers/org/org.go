package org

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/core/pkg/identity"
	membershandlers "github.com/TaskForceAI/go-core/pkg/handlers/org/members"
)

// RegisterHandlers registers organization related handlers.
func RegisterHandlers(api huma.API, service identity.Service) {
	registerListMembers(api, service)
	registerExportData(api, service)
	registerGetSettings(api, service)
	registerUpdateSettings(api, service)
	registerUpdateMemberRole(api, service)
	registerRemoveMember(api, service)
}

func registerListMembers(api huma.API, service identity.Service) {
	// List Members
	huma.Register(api, huma.Operation{
		OperationID: "org-list-members",
		Method:      http.MethodGet,
		Path:        "/api/v1/org/members",
		Summary:     "List organization members",
		Tags:        []string{"Organization"},
	}, func(ctx context.Context, input *struct {
		handler.AuthContext
	}) (*struct{ Body []identity.MemberRecord }, error) {
		ids, err := handler.ResolveOrgAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		mems, err := service.ListMembers(ctx, *ids.OrgID32, ids.UserID32)
		if err != nil {
			if errors.Is(err, identity.ErrUnauthorized) {
				return nil, huma.Error403Forbidden(err.Error())
			}
			slog.Error("Failed to fetch organization members", "orgId", ids.OrgID, "userId", ids.UserID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch members")
		}
		return &struct{ Body []identity.MemberRecord }{Body: mems}, nil
	})
}

func registerExportData(api huma.API, service identity.Service) {
	// Export Data
	huma.Register(api, huma.Operation{
		OperationID: "org-export-data",
		Method:      http.MethodGet,
		Path:        "/api/v1/org/export",
		Summary:     "Export organization data",
		Tags:        []string{"Organization"},
	}, func(ctx context.Context, input *struct {
		handler.AuthContext
	}) (*struct{ Body any }, error) {
		ids, err := handler.ResolveOrgAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		data, err := service.ExportOrganizationData(ctx, *ids.OrgID32, ids.UserID32)
		if err != nil {
			if errors.Is(err, identity.ErrUnauthorized) {
				return nil, huma.Error403Forbidden(err.Error())
			}
			slog.Error("Failed to export organization data", "orgId", ids.OrgID, "userId", ids.UserID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to export data")
		}

		return &struct{ Body any }{Body: data}, nil
	})
}

func registerGetSettings(api huma.API, service identity.Service) {
	// Get Settings
	huma.Register(api, huma.Operation{
		OperationID: "org-get-settings",
		Method:      http.MethodGet,
		Path:        "/api/v1/org/settings",
		Summary:     "Get organization settings",
		Tags:        []string{"Organization"},
	}, func(ctx context.Context, input *struct {
		handler.AuthContext
	}) (*struct {
		Body *identity.OrganizationSettings
	}, error) {
		ids, err := handler.ResolveOrgAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		settings, err := service.GetSettings(ctx, *ids.OrgID32, ids.UserID32)
		if err != nil {
			if errors.Is(err, identity.ErrUnauthorized) {
				return nil, huma.Error403Forbidden(err.Error())
			}
			slog.Error("Failed to fetch organization settings", "orgId", ids.OrgID, "userId", ids.UserID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch settings")
		}
		return &struct {
			Body *identity.OrganizationSettings
		}{Body: settings}, nil
	})
}

func registerUpdateSettings(api huma.API, service identity.Service) {
	// Update Settings
	huma.Register(api, huma.Operation{
		OperationID: "org-update-settings",
		Method:      http.MethodPatch,
		Path:        "/api/v1/org/settings",
		Summary:     "Update organization settings",
		Tags:        []string{"Organization"},
	}, func(ctx context.Context, input *struct {
		Body identity.OrganizationSettings
		handler.AuthContext
	}) (*struct{ Body map[string]string }, error) {
		ids, err := handler.ResolveOrgAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		if err := service.UpdateSettings(ctx, *ids.OrgID32, ids.UserID32, input.Body); err != nil {
			if errors.Is(err, identity.ErrUnauthorized) {
				return nil, huma.Error403Forbidden(err.Error())
			}
			slog.Error("Failed to update organization settings", "orgId", ids.OrgID, "userId", ids.UserID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to update settings")
		}
		return &struct{ Body map[string]string }{Body: map[string]string{"message": "Settings updated"}}, nil
	})
}

func registerUpdateMemberRole(api huma.API, service identity.Service) {
	// Update Member Role
	huma.Register(api, huma.Operation{
		OperationID: "org-update-member",
		Method:      http.MethodPatch,
		Path:        "/api/v1/org/members/{userID}",
		Summary:     "Update member role",
		Tags:        []string{"Organization"},
	}, func(ctx context.Context, input *struct {
		UserID int32 `path:"userID"`
		Body   membershandlers.UpdateRoleRequest
		handler.AuthContext
	}) (*struct{ Body map[string]string }, error) {
		ids, err := handler.ResolveOrgAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		if err := service.UpdateMemberRole(ctx, *ids.OrgID32, input.UserID, ids.UserID32, input.Body.Role); err != nil {
			if errors.Is(err, identity.ErrInvalidRole) {
				return nil, huma.Error400BadRequest(err.Error())
			}
			if errors.Is(err, identity.ErrUnauthorized) || errors.Is(err, identity.ErrOwnerRoleRequiresOwner) {
				return nil, huma.Error403Forbidden(err.Error())
			}
			slog.Error("Failed to update organization member role", "orgId", ids.OrgID, "targetUserId", input.UserID, "adminUserId", ids.UserID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to update role")
		}
		return &struct{ Body map[string]string }{Body: map[string]string{"message": "Role updated"}}, nil
	})
}

func registerRemoveMember(api huma.API, service identity.Service) {
	// Remove Member
	huma.Register(api, huma.Operation{
		OperationID: "org-remove-member",
		Method:      http.MethodDelete,
		Path:        "/api/v1/org/members/{userID}",
		Summary:     "Remove member from organization",
		Tags:        []string{"Organization"},
	}, func(ctx context.Context, input *struct {
		UserID int32 `path:"userID"`
		handler.AuthContext
	}) (*struct{}, error) {
		ids, err := handler.ResolveOrgAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		if err := service.RemoveMember(ctx, *ids.OrgID32, input.UserID, ids.UserID32); err != nil {
			if errors.Is(err, identity.ErrUnauthorized) || errors.Is(err, identity.ErrCannotRemoveSelf) {
				return nil, huma.Error403Forbidden(err.Error())
			}
			slog.Error("Failed to remove organization member", "orgId", ids.OrgID, "targetUserId", input.UserID, "adminUserId", ids.UserID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to remove member")
		}
		return &struct{}{}, nil
	})
}
