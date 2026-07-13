package identity

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubMembershipStore struct {
	getMembershipFunc            func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error)
	getOrganizationMembersFunc   func(ctx context.Context, orgID int32) ([]OrganizationMemberRecord, error)
	getOrganizationSettingsFunc  func(ctx context.Context, orgID int32) ([]byte, error)
	updateOrganizationSettingsFn func(ctx context.Context, input UpdateOrganizationSettingsInput) error
	updateMembershipRoleFunc     func(ctx context.Context, input UpdateMembershipRoleInput) error
	deleteMembershipFunc         func(ctx context.Context, input DeleteMembershipInput) error
}

func TestIsAdminRoleClassifiesKnownAndUnknownRoles(t *testing.T) {
	tests := []struct {
		role string
		want bool
	}{
		{role: string(RoleOwner), want: true},
		{role: string(RoleAdmin), want: true},
		{role: string(RoleMember), want: false},
		{role: string(RoleViewer), want: false},
		{role: "unknown", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.role, func(t *testing.T) {
			if got := isAdminRole(tt.role); got != tt.want {
				t.Fatalf("isAdminRole(%q) = %v; want %v", tt.role, got, tt.want)
			}
		})
	}
}

func (s stubMembershipStore) GetMembership(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
	return s.getMembershipFunc(ctx, input)
}

func (s stubMembershipStore) GetOrganizationMembers(ctx context.Context, orgID int32) ([]OrganizationMemberRecord, error) {
	return s.getOrganizationMembersFunc(ctx, orgID)
}

func (s stubMembershipStore) GetOrganizationSettings(ctx context.Context, orgID int32) ([]byte, error) {
	return s.getOrganizationSettingsFunc(ctx, orgID)
}

func (s stubMembershipStore) UpdateOrganizationSettings(ctx context.Context, input UpdateOrganizationSettingsInput) error {
	return s.updateOrganizationSettingsFn(ctx, input)
}

func (s stubMembershipStore) UpdateMembershipRole(ctx context.Context, input UpdateMembershipRoleInput) error {
	return s.updateMembershipRoleFunc(ctx, input)
}

func (s stubMembershipStore) DeleteMembership(ctx context.Context, input DeleteMembershipInput) error {
	return s.deleteMembershipFunc(ctx, input)
}

func newMembershipServiceTest() (*MembershipService, *stubMembershipStore) {
	store := &stubMembershipStore{
		getMembershipFunc: func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
			return MembershipRecord{}, nil
		},
		getOrganizationMembersFunc: func(ctx context.Context, orgID int32) ([]OrganizationMemberRecord, error) {
			return nil, nil
		},
		getOrganizationSettingsFunc: func(ctx context.Context, orgID int32) ([]byte, error) {
			return nil, nil
		},
		updateOrganizationSettingsFn: func(ctx context.Context, input UpdateOrganizationSettingsInput) error {
			return nil
		},
		updateMembershipRoleFunc: func(ctx context.Context, input UpdateMembershipRoleInput) error {
			return nil
		},
		deleteMembershipFunc: func(ctx context.Context, input DeleteMembershipInput) error {
			return nil
		},
	}
	return NewService(store), store
}

func TestMembershipService_ListMembers(t *testing.T) {
	svc, store := newMembershipServiceTest()
	joinedAt := time.Date(2025, 12, 10, 9, 30, 0, 0, time.UTC)
	fullName := "Test User"

	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		assert.Equal(t, int32(77), input.OrganizationID)
		assert.Equal(t, int32(5), input.UserID)
		return MembershipRecord{OrganizationID: 77, UserID: 5, Role: "ADMIN"}, nil
	}
	store.getOrganizationMembersFunc = func(ctx context.Context, orgID int32) ([]OrganizationMemberRecord, error) {
		assert.Equal(t, int32(77), orgID)
		return []OrganizationMemberRecord{{
			UserID:         5,
			Email:          "user@example.com",
			FullName:       &fullName,
			Role:           "ADMIN",
			JoinedAt:       joinedAt,
			OrganizationID: 77,
		}}, nil
	}

	members, err := svc.ListMembers(context.Background(), 77, 5)
	require.NoError(t, err)
	require.Len(t, members, 1)
	assert.Equal(t, int32(5), members[0].UserID)
	assert.Equal(t, RoleAdmin, members[0].Role)
	assert.Equal(t, "user@example.com", members[0].Email)
	assert.Equal(t, fullName, *members[0].FullName)
	assert.Equal(t, joinedAt, members[0].JoinedAt)
}

func TestMembershipService_ListMembersUnauthorized(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{}, errors.New("missing membership")
	}

	members, err := svc.ListMembers(context.Background(), 77, 8)
	require.ErrorIs(t, err, ErrUnauthorized)
	assert.Nil(t, members)
}

func TestMembershipService_ListMembersPropagatesMemberListError(t *testing.T) {
	svc, store := newMembershipServiceTest()
	expected := errors.New("members unavailable")
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 77, UserID: 5, Role: "MEMBER"}, nil
	}
	store.getOrganizationMembersFunc = func(ctx context.Context, orgID int32) ([]OrganizationMemberRecord, error) {
		return nil, expected
	}

	members, err := svc.ListMembers(context.Background(), 77, 5)

	require.ErrorIs(t, err, expected)
	assert.Nil(t, members)
}

func TestMembershipService_GetSettingsUnauthorized(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{}, errors.New("missing membership")
	}

	settings, err := svc.GetSettings(context.Background(), 22, 8)
	require.ErrorIs(t, err, ErrUnauthorized)
	assert.Nil(t, settings)
}

func TestMembershipService_GetSettingsSuccess(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 55, UserID: 7, Role: "ADMIN"}, nil
	}
	store.getOrganizationSettingsFunc = func(ctx context.Context, orgID int32) ([]byte, error) {
		assert.Equal(t, int32(55), orgID)
		return []byte(`{"allowPublicProjects":true,"defaultRole":"member"}`), nil
	}

	settings, err := svc.GetSettings(context.Background(), 55, 7)
	require.NoError(t, err)
	require.NotNil(t, settings)
	assert.True(t, settings.AllowPublicProjects)
	assert.Equal(t, "member", settings.DefaultRole)
}

func TestMembershipService_GetSettingsReturnsEmptyDefaults(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 55, UserID: 7, Role: "ADMIN"}, nil
	}
	store.getOrganizationSettingsFunc = func(ctx context.Context, orgID int32) ([]byte, error) {
		return nil, nil
	}

	settings, err := svc.GetSettings(context.Background(), 55, 7)

	require.NoError(t, err)
	assert.Equal(t, &OrganizationSettings{}, settings)
}

func TestMembershipService_GetSettingsRejectsMalformedJSON(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 55, UserID: 7, Role: "OWNER"}, nil
	}
	store.getOrganizationSettingsFunc = func(ctx context.Context, orgID int32) ([]byte, error) {
		return []byte(`{"allowPublicProjects":`), nil
	}

	settings, err := svc.GetSettings(context.Background(), 55, 7)

	require.Error(t, err)
	assert.Nil(t, settings)
}

func TestMembershipService_GetSettingsRejectsInvalidStoredSettings(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 55, UserID: 7, Role: "OWNER"}, nil
	}
	store.getOrganizationSettingsFunc = func(ctx context.Context, orgID int32) ([]byte, error) {
		return []byte(`{"defaultRole":"invalid"}`), nil
	}

	settings, err := svc.GetSettings(context.Background(), 55, 7)
	require.Error(t, err)
	assert.Nil(t, settings)
	assert.Contains(t, err.Error(), "validate organization settings")
}

func TestMembershipService_GetSettingsPropagatesStoreError(t *testing.T) {
	svc, store := newMembershipServiceTest()
	wantErr := errors.New("settings unavailable")
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 55, UserID: 7, Role: "ADMIN"}, nil
	}
	store.getOrganizationSettingsFunc = func(ctx context.Context, orgID int32) ([]byte, error) {
		return nil, wantErr
	}

	settings, err := svc.GetSettings(context.Background(), 55, 7)
	require.ErrorIs(t, err, wantErr)
	assert.Nil(t, settings)
}

func TestMembershipService_UpdateSettingsValidationFailure(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 42, UserID: 7, Role: "OWNER"}, nil
	}

	err := svc.UpdateSettings(context.Background(), 42, 7, OrganizationSettings{DefaultRole: "invalid"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "validate organization settings")
}

func TestMembershipService_UpdateSettingsRejectsUnauthorizedActor(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 42, UserID: 7, Role: "MEMBER"}, nil
	}

	err := svc.UpdateSettings(context.Background(), 42, 7, OrganizationSettings{DefaultRole: "member"})

	require.ErrorIs(t, err, ErrUnauthorized)
}

func TestMembershipService_UpdateSettingsPersistsValidatedJSON(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		assert.Equal(t, int32(42), input.OrganizationID)
		assert.Equal(t, int32(7), input.UserID)
		return MembershipRecord{OrganizationID: 42, UserID: 7, Role: "OWNER"}, nil
	}
	store.updateOrganizationSettingsFn = func(ctx context.Context, input UpdateOrganizationSettingsInput) error {
		assert.Equal(t, int32(42), input.ID)
		var got OrganizationSettings
		require.NoError(t, json.Unmarshal(input.Settings, &got))
		assert.Equal(t, OrganizationSettings{
			AllowPublicProjects: true,
			DefaultRole:         "viewer",
		}, got)
		return nil
	}

	err := svc.UpdateSettings(context.Background(), 42, 7, OrganizationSettings{
		AllowPublicProjects: true,
		DefaultRole:         "viewer",
	})
	require.NoError(t, err)
}

func TestMembershipService_UpdateSettingsPropagatesStoreError(t *testing.T) {
	svc, store := newMembershipServiceTest()
	wantErr := errors.New("write failed")
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 42, UserID: 7, Role: "ADMIN"}, nil
	}
	store.updateOrganizationSettingsFn = func(ctx context.Context, input UpdateOrganizationSettingsInput) error {
		return wantErr
	}

	err := svc.UpdateSettings(context.Background(), 42, 7, OrganizationSettings{DefaultRole: "member"})
	require.ErrorIs(t, err, wantErr)
}

func TestMembershipService_UpdateSettingsPropagatesMarshalError(t *testing.T) {
	svc, store := newMembershipServiceTest()
	expected := errors.New("marshal failed")
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 42, UserID: 7, Role: "ADMIN"}, nil
	}
	origMarshal := marshalOrganizationSettings
	marshalOrganizationSettings = func(any) ([]byte, error) {
		return nil, expected
	}
	t.Cleanup(func() { marshalOrganizationSettings = origMarshal })

	err := svc.UpdateSettings(context.Background(), 42, 7, OrganizationSettings{DefaultRole: "member"})
	require.ErrorIs(t, err, expected)
}

func TestMembershipService_UpdateMemberRoleAndRemoveMember(t *testing.T) {
	svc, store := newMembershipServiceTest()
	lookupCalls := 0
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		lookupCalls++
		return MembershipRecord{OrganizationID: 42, UserID: 100, Role: "ADMIN"}, nil
	}
	store.updateMembershipRoleFunc = func(ctx context.Context, input UpdateMembershipRoleInput) error {
		assert.Equal(t, int32(42), input.OrganizationID)
		assert.Equal(t, int32(200), input.UserID)
		assert.Equal(t, "VIEWER", input.Role)
		return nil
	}
	store.deleteMembershipFunc = func(ctx context.Context, input DeleteMembershipInput) error {
		assert.Equal(t, int32(42), input.OrganizationID)
		assert.Equal(t, int32(200), input.UserID)
		return nil
	}

	err := svc.UpdateMemberRole(context.Background(), 42, 200, 100, RoleViewer)
	require.NoError(t, err)

	err = svc.RemoveMember(context.Background(), 42, 200, 100)
	require.NoError(t, err)
	assert.Equal(t, 4, lookupCalls)
}

func TestMembershipService_UpdateMemberRoleUnauthorizedAndRemoveSelfBlocked(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 42, UserID: 100, Role: "MEMBER"}, nil
	}

	err := svc.UpdateMemberRole(context.Background(), 42, 200, 100, RoleViewer)
	require.ErrorIs(t, err, ErrUnauthorized)

	err = svc.RemoveMember(context.Background(), 42, 100, 100)
	require.ErrorIs(t, err, ErrCannotRemoveSelf)
}

func TestMembershipService_UpdateMemberRoleRejectsInvalidRole(t *testing.T) {
	svc, store := newMembershipServiceTest()
	called := false
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 42, UserID: 100, Role: "ADMIN"}, nil
	}
	store.updateMembershipRoleFunc = func(ctx context.Context, input UpdateMembershipRoleInput) error {
		called = true
		return nil
	}

	err := svc.UpdateMemberRole(context.Background(), 42, 200, 100, OrganizationRole("superadmin"))
	require.ErrorIs(t, err, ErrInvalidRole)
	assert.False(t, called)
}

func TestMembershipService_UpdateMemberRoleOwnerRequiresOwnerActor(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 42, UserID: 100, Role: "ADMIN"}, nil
	}
	store.updateMembershipRoleFunc = func(ctx context.Context, input UpdateMembershipRoleInput) error {
		t.Fatalf("owner role update should not reach store for admin actor")
		return nil
	}

	err := svc.UpdateMemberRole(context.Background(), 42, 200, 100, RoleOwner)
	require.ErrorIs(t, err, ErrOwnerRoleRequiresOwner)
}

func TestMembershipService_UpdateMemberRolePropagatesLookupAndWriteErrors(t *testing.T) {
	expected := errors.New("membership unavailable")

	t.Run("actor missing", func(t *testing.T) {
		svc, store := newMembershipServiceTest()
		store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
			return MembershipRecord{}, expected
		}

		err := svc.UpdateMemberRole(context.Background(), 42, 200, 100, RoleViewer)

		require.ErrorIs(t, err, ErrUnauthorized)
	})

	t.Run("target missing", func(t *testing.T) {
		svc, store := newMembershipServiceTest()
		store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
			if input.UserID == 100 {
				return MembershipRecord{OrganizationID: 42, UserID: 100, Role: "ADMIN"}, nil
			}
			return MembershipRecord{}, expected
		}

		err := svc.UpdateMemberRole(context.Background(), 42, 200, 100, RoleViewer)

		require.ErrorIs(t, err, expected)
	})

	t.Run("last owner check", func(t *testing.T) {
		svc, store := newMembershipServiceTest()
		store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
			return MembershipRecord{OrganizationID: 42, UserID: input.UserID, Role: "OWNER"}, nil
		}
		store.getOrganizationMembersFunc = func(ctx context.Context, orgID int32) ([]OrganizationMemberRecord, error) {
			return nil, expected
		}

		err := svc.UpdateMemberRole(context.Background(), 42, 200, 100, RoleAdmin)

		require.ErrorIs(t, err, expected)
	})

	t.Run("role update", func(t *testing.T) {
		svc, store := newMembershipServiceTest()
		store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
			return MembershipRecord{OrganizationID: 42, UserID: input.UserID, Role: "ADMIN"}, nil
		}
		store.updateMembershipRoleFunc = func(ctx context.Context, input UpdateMembershipRoleInput) error {
			return expected
		}

		err := svc.UpdateMemberRole(context.Background(), 42, 200, 100, RoleViewer)

		require.ErrorIs(t, err, expected)
	})
}

func TestMembershipService_UpdateMemberRoleOwnerAllowedForOwnerActor(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 42, UserID: input.UserID, Role: "OWNER"}, nil
	}
	store.updateMembershipRoleFunc = func(ctx context.Context, input UpdateMembershipRoleInput) error {
		assert.Equal(t, int32(42), input.OrganizationID)
		assert.Equal(t, int32(200), input.UserID)
		assert.Equal(t, "OWNER", input.Role)
		return nil
	}

	err := svc.UpdateMemberRole(context.Background(), 42, 200, 100, RoleOwner)
	require.NoError(t, err)
}

func TestMembershipService_AdminCannotDemoteOrRemoveOwner(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		switch input.UserID {
		case 100:
			return MembershipRecord{OrganizationID: 42, UserID: 100, Role: "ADMIN"}, nil
		case 200:
			return MembershipRecord{OrganizationID: 42, UserID: 200, Role: "OWNER"}, nil
		default:
			return MembershipRecord{}, errors.New("missing membership")
		}
	}
	store.updateMembershipRoleFunc = func(ctx context.Context, input UpdateMembershipRoleInput) error {
		t.Fatalf("admin should not be able to demote owner")
		return nil
	}
	store.deleteMembershipFunc = func(ctx context.Context, input DeleteMembershipInput) error {
		t.Fatalf("admin should not be able to remove owner")
		return nil
	}

	err := svc.UpdateMemberRole(context.Background(), 42, 200, 100, RoleViewer)
	require.ErrorIs(t, err, ErrOwnerRoleProtected)

	err = svc.RemoveMember(context.Background(), 42, 200, 100)
	require.ErrorIs(t, err, ErrOwnerRoleProtected)
}

func TestMembershipService_CannotDemoteOrRemoveLastOwner(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 42, UserID: input.UserID, Role: "OWNER"}, nil
	}
	store.getOrganizationMembersFunc = func(ctx context.Context, orgID int32) ([]OrganizationMemberRecord, error) {
		return []OrganizationMemberRecord{{
			UserID: 200,
			Role:   "OWNER",
		}}, nil
	}
	store.updateMembershipRoleFunc = func(ctx context.Context, input UpdateMembershipRoleInput) error {
		t.Fatalf("last owner should not be demoted")
		return nil
	}
	store.deleteMembershipFunc = func(ctx context.Context, input DeleteMembershipInput) error {
		t.Fatalf("last owner should not be removed")
		return nil
	}

	err := svc.UpdateMemberRole(context.Background(), 42, 200, 100, RoleAdmin)
	require.ErrorIs(t, err, ErrCannotRemoveLastOwner)

	err = svc.RemoveMember(context.Background(), 42, 200, 100)
	require.ErrorIs(t, err, ErrCannotRemoveLastOwner)
}

func TestMembershipService_OwnerCanDemoteOwnerWhenAnotherOwnerRemains(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 42, UserID: input.UserID, Role: "OWNER"}, nil
	}
	store.getOrganizationMembersFunc = func(ctx context.Context, orgID int32) ([]OrganizationMemberRecord, error) {
		return []OrganizationMemberRecord{
			{UserID: 100, Role: "OWNER"},
			{UserID: 200, Role: "OWNER"},
		}, nil
	}
	store.updateMembershipRoleFunc = func(ctx context.Context, input UpdateMembershipRoleInput) error {
		assert.Equal(t, int32(200), input.UserID)
		assert.Equal(t, "ADMIN", input.Role)
		return nil
	}

	err := svc.UpdateMemberRole(context.Background(), 42, 200, 100, RoleAdmin)
	require.NoError(t, err)
}

func TestMembershipService_IsLastOwnerSkipsNonOwnerMembers(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getOrganizationMembersFunc = func(ctx context.Context, orgID int32) ([]OrganizationMemberRecord, error) {
		return []OrganizationMemberRecord{
			{UserID: 300, Role: "MEMBER"},
			{UserID: 200, Role: "OWNER"},
			{UserID: 100, Role: "OWNER"},
		}, nil
	}

	lastOwner, err := svc.isLastOwner(context.Background(), 42, 200)
	require.NoError(t, err)
	assert.False(t, lastOwner)
}

func TestMembershipService_RemoveMemberPropagatesPermissionAndDeleteErrors(t *testing.T) {
	expected := errors.New("membership operation failed")

	t.Run("actor missing", func(t *testing.T) {
		svc, store := newMembershipServiceTest()
		store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
			return MembershipRecord{}, expected
		}

		err := svc.RemoveMember(context.Background(), 42, 200, 100)

		require.ErrorIs(t, err, ErrUnauthorized)
	})

	t.Run("actor not admin", func(t *testing.T) {
		svc, store := newMembershipServiceTest()
		store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
			return MembershipRecord{OrganizationID: 42, UserID: 100, Role: "MEMBER"}, nil
		}

		err := svc.RemoveMember(context.Background(), 42, 200, 100)

		require.ErrorIs(t, err, ErrUnauthorized)
	})

	t.Run("target missing", func(t *testing.T) {
		svc, store := newMembershipServiceTest()
		store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
			if input.UserID == 100 {
				return MembershipRecord{OrganizationID: 42, UserID: 100, Role: "ADMIN"}, nil
			}
			return MembershipRecord{}, expected
		}

		err := svc.RemoveMember(context.Background(), 42, 200, 100)

		require.ErrorIs(t, err, expected)
	})

	t.Run("last owner lookup", func(t *testing.T) {
		svc, store := newMembershipServiceTest()
		store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
			return MembershipRecord{OrganizationID: 42, UserID: input.UserID, Role: "OWNER"}, nil
		}
		store.getOrganizationMembersFunc = func(ctx context.Context, orgID int32) ([]OrganizationMemberRecord, error) {
			return nil, expected
		}

		err := svc.RemoveMember(context.Background(), 42, 200, 100)

		require.ErrorIs(t, err, expected)
	})

	t.Run("delete", func(t *testing.T) {
		svc, store := newMembershipServiceTest()
		store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
			return MembershipRecord{OrganizationID: 42, UserID: input.UserID, Role: "ADMIN"}, nil
		}
		store.deleteMembershipFunc = func(ctx context.Context, input DeleteMembershipInput) error {
			return expected
		}

		err := svc.RemoveMember(context.Background(), 42, 200, 100)

		require.ErrorIs(t, err, expected)
	})
}

func TestMembershipService_OwnerCanRemoveOwnerWhenAnotherOwnerRemains(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 42, UserID: input.UserID, Role: "OWNER"}, nil
	}
	store.getOrganizationMembersFunc = func(ctx context.Context, orgID int32) ([]OrganizationMemberRecord, error) {
		return []OrganizationMemberRecord{
			{UserID: 100, Role: "OWNER"},
			{UserID: 200, Role: "OWNER"},
		}, nil
	}
	store.deleteMembershipFunc = func(ctx context.Context, input DeleteMembershipInput) error {
		assert.Equal(t, int32(200), input.UserID)
		return nil
	}

	err := svc.RemoveMember(context.Background(), 42, 200, 100)

	require.NoError(t, err)
}

func TestMembershipService_ExportOrganizationDataRequiresAdmin(t *testing.T) {
	svc, store := newMembershipServiceTest()
	joinedAt := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		assert.Equal(t, int32(42), input.OrganizationID)
		assert.Equal(t, int32(7), input.UserID)
		return MembershipRecord{OrganizationID: 42, UserID: 7, Role: "ADMIN"}, nil
	}
	store.getOrganizationMembersFunc = func(ctx context.Context, orgID int32) ([]OrganizationMemberRecord, error) {
		return []OrganizationMemberRecord{{
			UserID:         7,
			Email:          "admin@example.com",
			Role:           "ADMIN",
			JoinedAt:       joinedAt,
			OrganizationID: orgID,
		}}, nil
	}
	store.getOrganizationSettingsFunc = func(ctx context.Context, orgID int32) ([]byte, error) {
		return []byte(`{"allowPublicProjects":true,"defaultRole":"viewer"}`), nil
	}

	exported, err := svc.ExportOrganizationData(context.Background(), 42, 7)
	require.NoError(t, err)
	require.IsType(t, map[string]any{}, exported)
	exportMap := exported.(map[string]any)
	assert.Equal(t, int32(42), exportMap["orgId"])
	assert.Contains(t, exportMap, "exportedAt")
	require.Len(t, exportMap["members"], 1)
	assert.Equal(t, &OrganizationSettings{AllowPublicProjects: true, DefaultRole: "viewer"}, exportMap["settings"])
}

func TestMembershipService_ExportOrganizationDataRejectsNonAdmin(t *testing.T) {
	svc, store := newMembershipServiceTest()
	store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
		return MembershipRecord{OrganizationID: 42, UserID: 7, Role: "MEMBER"}, nil
	}

	exported, err := svc.ExportOrganizationData(context.Background(), 42, 7)
	require.ErrorIs(t, err, ErrUnauthorized)
	assert.Nil(t, exported)
}

func TestMembershipService_ExportOrganizationDataPropagatesListAndSettingsErrors(t *testing.T) {
	expected := errors.New("export dependency failed")

	t.Run("member list", func(t *testing.T) {
		svc, store := newMembershipServiceTest()
		store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
			return MembershipRecord{OrganizationID: 42, UserID: 7, Role: "ADMIN"}, nil
		}
		store.getOrganizationMembersFunc = func(ctx context.Context, orgID int32) ([]OrganizationMemberRecord, error) {
			return nil, expected
		}

		exported, err := svc.ExportOrganizationData(context.Background(), 42, 7)

		require.ErrorIs(t, err, expected)
		assert.Nil(t, exported)
	})

	t.Run("settings", func(t *testing.T) {
		svc, store := newMembershipServiceTest()
		store.getMembershipFunc = func(ctx context.Context, input GetMembershipInput) (MembershipRecord, error) {
			return MembershipRecord{OrganizationID: 42, UserID: 7, Role: "ADMIN"}, nil
		}
		store.getOrganizationMembersFunc = func(ctx context.Context, orgID int32) ([]OrganizationMemberRecord, error) {
			return []OrganizationMemberRecord{}, nil
		}
		store.getOrganizationSettingsFunc = func(ctx context.Context, orgID int32) ([]byte, error) {
			return nil, expected
		}

		exported, err := svc.ExportOrganizationData(context.Background(), 42, 7)

		require.ErrorIs(t, err, expected)
		assert.Nil(t, exported)
	})
}
