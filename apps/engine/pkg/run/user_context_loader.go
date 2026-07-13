package run

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/TaskForceAI/core/pkg/memories"
	"github.com/TaskForceAI/go-engine/pkg/integrations"
	infracrypto "github.com/TaskForceAI/infrastructure/crypto/pkg"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

func loadRunUserContext(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
	store, err := loadUserContextStore(ctx)
	if err != nil {
		return RunUserContext{}, err
	}

	userContext := defaultRunUserContext()
	applyUserSettings(&userContext, loadCachedUserSettings(ctx, store, input.UserID))
	userContext.Memories = loadRunUserMemories(ctx, store, input, userContext.MemoryEnabled)
	loadAccountIntegrations(ctx, store, input.UserID, &userContext)

	projectInstructions, err := loadProjectInstructions(ctx, store, input)
	if err != nil {
		return RunUserContext{}, err
	}
	if projectInstructions != "" {
		userContext.ProjectInstructions = projectInstructions
	}

	return userContext, nil
}

func defaultRunUserContext() RunUserContext {
	return RunUserContext{
		UserPlan:             "free",
		MemoryEnabled:        true,
		WebSearchEnabled:     true,
		CodeExecutionEnabled: true,
	}
}

func loadCachedUserSettings(ctx context.Context, store userContextStore, userID int32) userContextUserRow {
	userCacheKey := fmt.Sprintf("user_settings:%d", userID)
	cachedUser := userContextUserRow{}
	r, err := RedisClientGetter()
	if err != nil {
		slog.Warn("[OrchestrateTask] Failed to get Redis client for user settings cache", "userId", userID, "error", err)
	} else if r != nil {
		val, cacheErr := r.Get(ctx, userCacheKey)
		switch {
		case cacheErr == nil && val != "":
			if decodeErr := json.Unmarshal([]byte(val), &cachedUser); decodeErr != nil {
				slog.Warn("[OrchestrateTask] Failed to decode cached user settings", "userId", userID, "error", decodeErr)
			}
		case cacheErr != nil && !isRedisKeyNotFoundError(cacheErr):
			slog.Warn("[OrchestrateTask] Failed to read cached user settings", "userId", userID, "error", cacheErr)
		}
	}
	if cachedUser.ID != 0 {
		return cachedUser
	}

	cachedUser, userErr := store.GetUserSettings(ctx, userID)
	if userErr == nil {
		cacheUserSettings(ctx, userCacheKey, cachedUser)
	}
	return cachedUser
}

var marshalUserSettings = json.Marshal

func cacheUserSettings(ctx context.Context, key string, user userContextUserRow) {
	r, err := RedisClientGetter()
	if err != nil {
		slog.Warn("[OrchestrateTask] Failed to get Redis client for user settings cache write", "userId", user.ID, "error", err)
		return
	}
	if r == nil {
		return
	}
	userBytes, marshalErr := marshalUserSettings(user)
	if marshalErr != nil {
		slog.Warn("[OrchestrateTask] Failed to encode user settings cache", "userId", user.ID, "error", marshalErr)
		return
	}
	if err := r.Set(ctx, key, userBytes, 10*time.Minute); err != nil {
		slog.Warn("[OrchestrateTask] Failed to write user settings cache", "userId", user.ID, "error", err)
	}
}

func applyUserSettings(userContext *RunUserContext, user userContextUserRow) {
	if user.ID == 0 {
		return
	}
	if plan := strings.TrimSpace(user.Plan); plan != "" {
		userContext.UserPlan = plan
	}
	userContext.MemoryEnabled = user.MemoryEnabled
	userContext.TrustLayerEnabled = user.TrustLayerEnabled
	userContext.WebSearchEnabled = user.WebSearchEnabled
	userContext.CodeExecutionEnabled = user.CodeExecutionEnabled
}

func loadRunUserMemories(ctx context.Context, store userContextStore, input UserContextLoadInput, enabled bool) []string {
	if !enabled {
		return nil
	}
	mems, err := loadMemoryRows(ctx, store, input)
	if err != nil {
		return nil
	}
	contents := make([]string, 0, len(mems))
	for _, m := range mems {
		contents = append(contents, m.Content)
	}
	return contents
}

func loadMemoryRows(ctx context.Context, store userContextStore, input UserContextLoadInput) ([]userContextMemoryRow, error) {
	if input.OrgID != nil {
		return store.ListUserMemoriesWithOrg(ctx, memories.GetUserMemoriesWithOrgInput{
			UserID:         input.UserID,
			OrganizationID: input.OrgID,
		})
	}
	return store.ListUserMemories(ctx, input.UserID)
}

func loadAccountIntegrations(ctx context.Context, store userContextStore, userID int32, userContext *RunUserContext) {
	accs, err := store.ListUserAccounts(ctx, userID)
	if err != nil {
		slog.Warn("[OrchestrateTask] Failed to get user accounts", "error", err, "userId", userID)
		return
	}
	for _, acc := range accs {
		applyAccountIntegration(ctx, acc, userContext)
		if userContext.DriveClient != nil && userContext.GithubToken != "" {
			break
		}
	}
}

func applyAccountIntegration(ctx context.Context, acc userContextAccountRow, userContext *RunUserContext) {
	switch acc.Provider {
	case "google-drive":
		if userContext.DriveClient == nil {
			userContext.DriveClient = googleDriveClientFromAccount(ctx, acc)
		}
	case "github":
		if userContext.GithubToken == "" {
			userContext.GithubToken = githubTokenFromAccount(acc)
		}
	}
}

func googleDriveClientFromAccount(ctx context.Context, acc userContextAccountRow) *integrations.GoogleDriveClient {
	accessToken, accessErr := infracrypto.DecryptOAuthTokenField(acc.AccessToken)
	if accessErr != nil {
		slog.Warn("[OrchestrateTask] Failed to decrypt access token", "error", accessErr, "provider", acc.Provider)
		return nil
	}
	refreshToken, refreshErr := infracrypto.DecryptOAuthTokenField(acc.RefreshToken)
	if refreshErr != nil {
		slog.Warn("[OrchestrateTask] Failed to decrypt refresh token", "error", refreshErr, "provider", acc.Provider)
		return nil
	}
	if accessToken == nil || refreshToken == nil {
		return nil
	}

	tokenType := "Bearer"
	if acc.TokenType != nil && *acc.TokenType != "" {
		tokenType = *acc.TokenType
	}

	conf := &oauth2.Config{
		ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		Endpoint:     google.Endpoint,
	}
	token := &oauth2.Token{
		AccessToken:  *accessToken,
		RefreshToken: *refreshToken,
		TokenType:    tokenType,
	}
	return integrations.NewGoogleDriveClient(conf.TokenSource(ctx, token))
}

func githubTokenFromAccount(acc userContextAccountRow) string {
	accessToken, accessErr := infracrypto.DecryptOAuthTokenField(acc.AccessToken)
	if accessErr != nil {
		slog.Warn("[OrchestrateTask] Failed to decrypt access token", "error", accessErr, "provider", acc.Provider)
		return ""
	}
	if accessToken == nil {
		return ""
	}
	return *accessToken
}

func loadProjectInstructions(ctx context.Context, store userContextStore, input UserContextLoadInput) (string, error) {
	if input.ProjectID == nil {
		return "", nil
	}

	projectCacheKey := projectInstructionsCacheKey(input)
	if r, err := RedisClientGetter(); err == nil && r != nil {
		if val, err := r.Get(ctx, projectCacheKey); err == nil && val != "" {
			return val, nil
		} else if err != nil && !isRedisKeyNotFoundError(err) {
			slog.Warn("[OrchestrateTask] Failed to read cached project instructions", "userId", input.UserID, "projectId", *input.ProjectID, "error", err)
		}
	} else if err != nil {
		slog.Warn("[OrchestrateTask] Failed to get Redis client for project instructions cache", "userId", input.UserID, "projectId", *input.ProjectID, "error", err)
	}

	proj, err := store.GetProjectInstructions(ctx, projectInstructionsLookupInput{
		ID:     *input.ProjectID,
		UserID: input.UserID,
		OrgID:  input.OrgID,
	})
	if err != nil {
		slog.Warn("[OrchestrateTask] Failed to get project by ID", "error", err, "userId", input.UserID, "projectId", *input.ProjectID)
		return "", fmt.Errorf("project %d is not accessible in the current scope: %w", *input.ProjectID, err)
	}
	if proj.CustomInstructions == nil {
		return "", nil
	}
	if r, err := RedisClientGetter(); err == nil && r != nil {
		if err := r.Set(ctx, projectCacheKey, []byte(*proj.CustomInstructions), 10*time.Minute); err != nil {
			slog.Warn("[OrchestrateTask] Failed to write project instructions cache", "userId", input.UserID, "projectId", *input.ProjectID, "error", err)
		}
	} else if err != nil {
		slog.Warn("[OrchestrateTask] Failed to get Redis client for project instructions cache write", "userId", input.UserID, "projectId", *input.ProjectID, "error", err)
	}
	return *proj.CustomInstructions, nil
}

func projectInstructionsCacheKey(input UserContextLoadInput) string {
	projectScope := "personal"
	if input.OrgID != nil {
		projectScope = fmt.Sprintf("org:%d", *input.OrgID)
	}
	return fmt.Sprintf("project_instructions:%s:%d:%d", projectScope, input.UserID, *input.ProjectID)
}
