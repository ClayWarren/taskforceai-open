package pkg

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

//

type ApiClient interface {
	RunTask(ctx context.Context, request RunRequest) (*RunResponse, error)
	GetModelOptions(ctx context.Context) (*ModelSelectorResponse, error)
	GetConversations(ctx context.Context, limit int, offset int) ([]ConversationSummary, error)
	DeleteConversation(ctx context.Context, id int) error
	Login(ctx context.Context, email string) (*AuthToken, error)
	Logout(ctx context.Context) error
	CurrentUser(ctx context.Context) (*AuthenticatedUser, error)
	UpdateTheme(ctx context.Context, theme Theme) (*MessageResponse, error)
	UpgradePlan(ctx context.Context, plan Plan) (*MessageResponse, error)
	GetSubscription(ctx context.Context) (*SubscriptionResponse, error)
	GetProducts(ctx context.Context) (*ProductsResponse, error)
	CreateSubscription(ctx context.Context, priceID string) (*CreateSubscriptionResponse, error)
	CancelSubscription(ctx context.Context) (*MessageResponse, error)
	ReactivateSubscription(ctx context.Context) (*MessageResponse, error)
	SyncMobileSubscription(ctx context.Context) (*MobileSubscriptionSyncResponse, error)
	RegisterPushToken(ctx context.Context, registration PushTokenRegistration) error
	UnregisterPushToken(ctx context.Context, token string) error
	ExportGDPRData(ctx context.Context) (string, error)
	DeleteAccount(ctx context.Context, confirmEmail string) error
}

type httpApiClient struct {
	ctx *RequestContext
}

var (
	ErrTestLoginUnavailable   = errors.New("test login endpoint is unavailable")
	ErrPlanUpgradeUnavailable = errors.New("plan upgrade endpoint is unavailable")
	ErrInvalidPushPlatform    = errors.New("invalid push platform")
	ErrInvalidPagination      = errors.New("invalid pagination parameters")
)

func NewApiClient(baseURL string, getToken func() string) ApiClient {
	return &httpApiClient{
		ctx: NewRequestContext(baseURL, getToken),
	}
}

func (c *httpApiClient) RunTask(ctx context.Context, request RunRequest) (*RunResponse, error) {
	var resp RunResponse
	err := c.ctx.Do(ctx, "POST", "/api/v1/run", request, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *httpApiClient) GetModelOptions(ctx context.Context) (*ModelSelectorResponse, error) {
	var resp ModelSelectorResponse
	err := c.ctx.Do(ctx, "GET", "/api/v1/models", nil, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *httpApiClient) GetConversations(ctx context.Context, limit int, offset int) ([]ConversationSummary, error) {
	if limit < 0 || offset < 0 {
		return nil, fmt.Errorf("%w: limit=%d offset=%d", ErrInvalidPagination, limit, offset)
	}

	path := "/api/v1/conversations"
	switch {
	case limit > 0 && offset > 0:
		path += "?limit=" + strconv.Itoa(limit) + "&offset=" + strconv.Itoa(offset)
	case limit > 0:
		path += "?limit=" + strconv.Itoa(limit)
	case offset > 0:
		path += "?offset=" + strconv.Itoa(offset)
	}
	var list ConversationList
	err := c.ctx.Do(ctx, "GET", path, nil, &list)
	return list.Conversations, err
}

func (c *httpApiClient) DeleteConversation(ctx context.Context, id int) error {
	return c.ctx.Do(ctx, "DELETE", "/api/v1/conversations/"+strconv.Itoa(id), nil, nil)
}

func (c *httpApiClient) Login(ctx context.Context, email string) (*AuthToken, error) {
	_ = c
	_ = ctx
	_ = email
	return nil, fmt.Errorf("%w: endpoint removed; use OAuth or device login flows", ErrTestLoginUnavailable)
}

func (c *httpApiClient) Logout(ctx context.Context) error {
	err := c.ctx.Do(ctx, "POST", "/api/v1/auth/logout", nil, nil)
	if err == nil {
		return nil
	}
	var apiErr *ApiClientError
	if errors.As(err, &apiErr) && apiErr.Status == http.StatusNotFound {
		return nil
	}
	return err
}

func (c *httpApiClient) CurrentUser(ctx context.Context) (*AuthenticatedUser, error) {
	var user AuthenticatedUser
	err := c.ctx.Do(ctx, "GET", "/api/v1/auth/me", nil, &user)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (c *httpApiClient) UpdateTheme(ctx context.Context, theme Theme) (*MessageResponse, error) {
	var settingsResp struct {
		Success *bool  `json:"success"`
		Message string `json:"message"`
	}
	err := c.ctx.Do(ctx, "PUT", "/api/v1/auth/settings", map[string]string{"theme_preference": string(theme)}, &settingsResp)
	if err == nil {
		return themeUpdateResponse(settingsResp.Success, settingsResp.Message)
	}
	var apiErr *ApiClientError
	if !errors.As(err, &apiErr) || apiErr.Status != http.StatusNotFound {
		return nil, err
	}

	var resp MessageResponse
	err = c.ctx.Do(ctx, "PUT", "/api/v1/auth/theme?theme="+url.QueryEscape(string(theme)), nil, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

func themeUpdateResponse(success *bool, message string) (*MessageResponse, error) {
	if success != nil && !*success {
		if message != "" {
			return nil, errors.New(message)
		}
		return nil, errors.New("failed to update theme")
	}
	if message != "" {
		return &MessageResponse{Message: message}, nil
	}
	return &MessageResponse{Message: "updated"}, nil
}

func (c *httpApiClient) UpgradePlan(ctx context.Context, plan Plan) (*MessageResponse, error) {
	_ = c
	_ = ctx
	_ = plan
	return nil, fmt.Errorf("%w: endpoint removed; use GetProducts and CreateSubscription", ErrPlanUpgradeUnavailable)
}

func (c *httpApiClient) GetSubscription(ctx context.Context) (*SubscriptionResponse, error) {
	var resp SubscriptionResponse
	err := c.ctx.Do(ctx, "GET", "/api/v1/payments", nil, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *httpApiClient) GetProducts(ctx context.Context) (*ProductsResponse, error) {
	var resp ProductsResponse
	err := c.ctx.Do(ctx, "GET", "/api/v1/payments/products", nil, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *httpApiClient) CreateSubscription(ctx context.Context, priceID string) (*CreateSubscriptionResponse, error) {
	var resp CreateSubscriptionResponse
	err := c.ctx.Do(ctx, "POST", "/api/v1/payments/create-subscription", map[string]string{"price_id": priceID}, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *httpApiClient) CancelSubscription(ctx context.Context) (*MessageResponse, error) {
	var resp MessageResponse
	err := c.ctx.Do(ctx, "POST", "/api/v1/payments/cancel-subscription", nil, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *httpApiClient) ReactivateSubscription(ctx context.Context) (*MessageResponse, error) {
	var resp MessageResponse
	err := c.ctx.Do(ctx, "POST", "/api/v1/payments/reactivate-subscription", nil, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *httpApiClient) SyncMobileSubscription(ctx context.Context) (*MobileSubscriptionSyncResponse, error) {
	var resp MobileSubscriptionSyncResponse
	err := c.ctx.Do(ctx, "POST", "/api/v1/payments/mobile/sync", map[string]any{}, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *httpApiClient) RegisterPushToken(ctx context.Context, registration PushTokenRegistration) error {
	if !isSupportedPushPlatform(registration.Platform) {
		return fmt.Errorf("%w: %q (expected ios, android, or web)", ErrInvalidPushPlatform, registration.Platform)
	}
	return c.ctx.Do(ctx, "POST", "/api/v1/notifications/push-tokens", registration, nil)
}

func (c *httpApiClient) UnregisterPushToken(ctx context.Context, token string) error {
	return c.ctx.Do(ctx, "DELETE", "/api/v1/notifications/push-tokens", PushTokenDeleteRequest{Token: token}, nil)
}

func (c *httpApiClient) ExportGDPRData(ctx context.Context) (string, error) {
	var data string
	err := c.ctx.Do(ctx, "GET", "/api/v1/gdpr/export", nil, &data)
	return data, err
}

func (c *httpApiClient) DeleteAccount(ctx context.Context, confirmEmail string) error {
	return c.ctx.Do(ctx, "POST", "/api/v1/gdpr/delete-account", map[string]string{"confirmEmail": confirmEmail}, nil)
}

func isSupportedPushPlatform(platform PushPlatform) bool {
	switch platform {
	case PlatformIOS, PlatformAndroid, PlatformWeb:
		return true
	default:
		return false
	}
}
