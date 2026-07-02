package pkg

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var benchmarkConversationSummaries []ConversationSummary

func TestApiClient(t *testing.T) {
	t.Run("CurrentUser", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/auth/me", r.URL.Path)
			_, _ = w.Write([]byte(`{
				"email":"alice@example.com",
				"plan":"pro",
				"memory_enabled":true,
				"web_search_enabled":true,
				"code_execution_enabled":true,
				"notifications_enabled":true,
				"quick_mode_enabled":true,
				"trust_layer_enabled":true,
				"impersonator_id":"imp-1"
			}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		user, err := client.CurrentUser(context.Background())

		require.NoError(t, err)
		assert.Equal(t, "alice@example.com", user.Email)
		assert.Equal(t, PlanPro, user.Plan)
		assert.True(t, user.MemoryEnabled)
		assert.True(t, user.WebSearchEnabled)
		assert.True(t, user.CodeExecutionEnabled)
		assert.True(t, user.NotificationsEnabled)
		assert.True(t, user.QuickModeEnabled)
		assert.True(t, user.TrustLayerEnabled)
		if assert.NotNil(t, user.ImpersonatorID) {
			assert.Equal(t, "imp-1", *user.ImpersonatorID)
		}
	})

	t.Run("Logout", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/auth/logout", r.URL.Path)
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		err := client.Logout(context.Background())
		assert.NoError(t, err)
	})

	t.Run("Logout - Ignores Not Found", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/auth/logout", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		err := client.Logout(context.Background())
		assert.NoError(t, err)
	})

	t.Run("Login - Endpoint Removed (Fail Fast)", func(t *testing.T) {
		serverCalls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			serverCalls++
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		token, err := client.Login(context.Background(), "alice@example.com")
		require.Error(t, err)
		require.ErrorIs(t, err, ErrTestLoginUnavailable)
		assert.Nil(t, token)
		assert.Equal(t, 0, serverCalls)
	})

	t.Run("RunTask", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/run", r.URL.Path)
			assert.Equal(t, "POST", r.Method)
			assert.Equal(t, "application/json", r.Header.Get("Content-Type"))

			var payload map[string]any
			if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&payload)) {
				return
			}
			assert.Equal(t, "hi", payload["prompt"])
			assert.Equal(t, float64(42), payload["projectId"])
			assert.Equal(t, "gpt-4.1", payload["modelId"])
			assert.Equal(t, []any{"u:1:att-1"}, payload["attachment_ids"])
			assert.Equal(t, map[string]any{"research": "gpt-4.1-mini"}, payload["role_models"])
			assert.Equal(t, map[string]any{"quickModeEnabled": true}, payload["options"])

			_, _ = w.Write([]byte(`{"task_id":"123","status":"queued","result":"done"}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		resp, err := client.RunTask(context.Background(), RunRequest{
			Prompt:        "hi",
			ProjectID:     42,
			ModelID:       "gpt-4.1",
			AttachmentIDs: []string{"u:1:att-1"},
			RoleModels:    map[string]string{"research": "gpt-4.1-mini"},
			Options:       map[string]any{"quickModeEnabled": true},
		})
		require.NoError(t, err)
		assert.Equal(t, "123", resp.TaskID)
		if assert.NotNil(t, resp.Status) {
			assert.Equal(t, "queued", *resp.Status)
		}
	})

	t.Run("GetModelOptions", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/models", r.URL.Path)
			assert.Equal(t, "GET", r.Method)
			_, _ = w.Write([]byte(`{"options":[{"id":"m1","label":"M1"}]}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		resp, err := client.GetModelOptions(context.Background())
		require.NoError(t, err)
		assert.Len(t, resp.Options, 1)
	})

	t.Run("UpdateTheme", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/auth/settings", r.URL.Path)
			assert.Equal(t, "PUT", r.Method)

			var payload map[string]string
			decodeErr := json.NewDecoder(r.Body).Decode(&payload)
			assert.NoError(t, decodeErr)
			assert.Equal(t, "dark", payload["theme_preference"])

			_, _ = w.Write([]byte(`{"success":true}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		resp, err := client.UpdateTheme(context.Background(), ThemeDark)
		require.NoError(t, err)
		assert.Equal(t, "updated", resp.Message)
	})

	t.Run("UpdateTheme - Returns Error When Success Is False", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/auth/settings", r.URL.Path)
			assert.Equal(t, "PUT", r.Method)
			_, _ = w.Write([]byte(`{"success":false,"message":"theme update rejected"}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		resp, err := client.UpdateTheme(context.Background(), ThemeDark)
		require.Error(t, err)
		assert.Nil(t, resp)
		assert.Equal(t, "theme update rejected", err.Error())
	})

	t.Run("UpdateTheme - Returns Default Error When Success Is False Without Message", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/auth/settings", r.URL.Path)
			_, _ = w.Write([]byte(`{"success":false}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		resp, err := client.UpdateTheme(context.Background(), ThemeDark)
		require.Error(t, err)
		assert.Nil(t, resp)
		assert.Equal(t, "failed to update theme", err.Error())
	})

	t.Run("UpdateTheme - Returns Message From Settings Response", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/auth/settings", r.URL.Path)
			_, _ = w.Write([]byte(`{"message":"theme saved"}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		resp, err := client.UpdateTheme(context.Background(), ThemeDark)
		require.NoError(t, err)
		assert.Equal(t, "theme saved", resp.Message)
	})

	t.Run("UpdateTheme - Falls Back to Legacy Endpoint", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/v1/auth/settings" {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			assert.Equal(t, "/api/v1/auth/theme", r.URL.Path)
			assert.Equal(t, "dark", r.URL.Query().Get("theme"))
			_, _ = w.Write([]byte(`{"message":"updated"}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		resp, err := client.UpdateTheme(context.Background(), ThemeDark)
		require.NoError(t, err)
		assert.Equal(t, "updated", resp.Message)
	})

	t.Run("UpdateTheme - Returns Legacy Endpoint Error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/v1/auth/settings" {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			assert.Equal(t, "/api/v1/auth/theme", r.URL.Path)
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"detail":"legacy rejected"}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		resp, err := client.UpdateTheme(context.Background(), ThemeDark)
		require.Error(t, err)
		assert.Nil(t, resp)
		assert.Contains(t, err.Error(), "legacy rejected")
	})

	t.Run("UpdateTheme - No Content Is Treated as Success", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/auth/settings", r.URL.Path)
			assert.Equal(t, "PUT", r.Method)
			w.WriteHeader(http.StatusNoContent)
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		resp, err := client.UpdateTheme(context.Background(), ThemeDark)
		require.NoError(t, err)
		assert.Equal(t, "updated", resp.Message)
	})

	t.Run("UpgradePlan - Endpoint Removed (Fail Fast)", func(t *testing.T) {
		serverCalls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			serverCalls++
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		resp, err := client.UpgradePlan(context.Background(), PlanPro)
		require.Error(t, err)
		require.ErrorIs(t, err, ErrPlanUpgradeUnavailable)
		assert.Nil(t, resp)
		assert.Equal(t, 0, serverCalls)
	})

	t.Run("GetConversations", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/conversations", r.URL.Path)
			assert.Equal(t, "GET", r.Method)
			assert.Equal(t, "5", r.URL.Query().Get("limit"))
			_, _ = w.Write([]byte(`{"conversations":[{"id":1}]}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		res, err := client.GetConversations(context.Background(), 5, 0)
		require.NoError(t, err)
		assert.Len(t, res, 1)
	})

	t.Run("GetConversations - Includes Offset", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "5", r.URL.Query().Get("limit"))
			assert.Equal(t, "10", r.URL.Query().Get("offset"))
			_, _ = w.Write([]byte(`{"conversations":[]}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		res, err := client.GetConversations(context.Background(), 5, 10)
		require.NoError(t, err)
		assert.Empty(t, res)
	})

	t.Run("GetConversations - Offset Only", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Empty(t, r.URL.Query().Get("limit"))
			assert.Equal(t, "10", r.URL.Query().Get("offset"))
			_, _ = w.Write([]byte(`{"conversations":[]}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		res, err := client.GetConversations(context.Background(), 0, 10)
		require.NoError(t, err)
		assert.Empty(t, res)
	})

	t.Run("GetConversations - Rejects Invalid Pagination", func(t *testing.T) {
		serverCalls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			serverCalls++
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		res, err := client.GetConversations(context.Background(), -1, 0)
		require.ErrorIs(t, err, ErrInvalidPagination)
		assert.Nil(t, res)
		assert.Equal(t, 0, serverCalls)
	})

	t.Run("DeleteConversation", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/conversations/123", r.URL.Path)
			assert.Equal(t, "DELETE", r.Method)
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		err := client.DeleteConversation(context.Background(), 123)
		assert.NoError(t, err)
	})

	t.Run("GetSubscription", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/payments", r.URL.Path)
			assert.Equal(t, "GET", r.Method)
			_, _ = w.Write([]byte(`{"subscription":{"subscription_id":"sub1"}}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		res, err := client.GetSubscription(context.Background())
		require.NoError(t, err)
		assert.Equal(t, "sub1", res.Subscription.SubscriptionID)
	})

	t.Run("DeleteAccount", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/gdpr/delete-account", r.URL.Path)
			assert.Equal(t, "POST", r.Method)

			var payload map[string]string
			if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&payload)) {
				return
			}
			assert.Equal(t, "alice@example.com", payload["confirmEmail"])

			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		err := client.DeleteAccount(context.Background(), "alice@example.com")
		assert.NoError(t, err)
	})

	t.Run("GetProducts", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/payments/products", r.URL.Path)
			assert.Equal(t, "GET", r.Method)
			_, _ = w.Write([]byte(`{"products":[{"id":"p1","name":"P1"}]}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		res, err := client.GetProducts(context.Background())
		require.NoError(t, err)
		assert.Len(t, res.Products, 1)
	})

	t.Run("CreateSubscription", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/payments/create-subscription", r.URL.Path)
			assert.Equal(t, "POST", r.Method)

			var payload map[string]string
			if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&payload)) {
				return
			}
			assert.Equal(t, "price1", payload["price_id"])

			_, _ = w.Write([]byte(`{"checkout_url":"http://stripe.com"}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		res, err := client.CreateSubscription(context.Background(), "price1")
		require.NoError(t, err)
		assert.Equal(t, "http://stripe.com", res.CheckoutURL)
	})

	t.Run("CancelSubscription", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/payments/cancel-subscription", r.URL.Path)
			assert.Equal(t, "POST", r.Method)
			_, _ = w.Write([]byte(`{"message":"cancelled"}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		res, err := client.CancelSubscription(context.Background())
		require.NoError(t, err)
		assert.Equal(t, "cancelled", res.Message)
	})

	t.Run("RegisterPushToken", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/notifications/push-tokens", r.URL.Path)
			assert.Equal(t, "POST", r.Method)

			var payload map[string]string
			if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&payload)) {
				return
			}
			assert.Equal(t, "t1", payload["token"])
			assert.Equal(t, "ios", payload["platform"])
			assert.Equal(t, "device-1", payload["deviceId"])
			assert.Equal(t, "1.2.3", payload["appVersion"])

			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		err := client.RegisterPushToken(context.Background(), PushTokenRegistration{
			Token:      "t1",
			Platform:   PlatformIOS,
			DeviceID:   stringPtr("device-1"),
			AppVersion: stringPtr("1.2.3"),
		})
		assert.NoError(t, err)
	})

	t.Run("RegisterPushToken - Invalid Platform", func(t *testing.T) {
		serverCalls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			serverCalls++
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		err := client.RegisterPushToken(context.Background(), PushTokenRegistration{Token: "t1", Platform: PushPlatform("windows")})
		require.Error(t, err)
		require.ErrorIs(t, err, ErrInvalidPushPlatform)
		assert.Equal(t, 0, serverCalls)
	})

	t.Run("ReactivateSubscription", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/payments/reactivate-subscription", r.URL.Path)
			assert.Equal(t, "POST", r.Method)
			_, _ = w.Write([]byte(`{"message":"reactivated"}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		res, err := client.ReactivateSubscription(context.Background())
		require.NoError(t, err)
		assert.Equal(t, "reactivated", res.Message)
	})

	t.Run("SyncMobileSubscription", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/payments/mobile/sync", r.URL.Path)
			assert.Equal(t, "POST", r.Method)

			var payload map[string]any
			if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&payload)) {
				return
			}
			assert.Empty(t, payload)

			_, _ = w.Write([]byte(`{"plan":"pro"}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		res, err := client.SyncMobileSubscription(context.Background())
		require.NoError(t, err)
		assert.Equal(t, PlanPro, res.Plan)
	})

	t.Run("UnregisterPushToken", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/notifications/push-tokens", r.URL.Path)
			assert.Equal(t, "DELETE", r.Method)

			var payload map[string]string
			if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&payload)) {
				return
			}
			assert.Equal(t, "token123", payload["token"])

			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		err := client.UnregisterPushToken(context.Background(), "token123")
		assert.NoError(t, err)
	})

	t.Run("ExportGDPRData", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/gdpr/export", r.URL.Path)
			assert.Equal(t, "GET", r.Method)
			_, _ = w.Write([]byte(`"exported-data-json"`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		data, err := client.ExportGDPRData(context.Background())
		require.NoError(t, err)
		assert.Equal(t, "exported-data-json", data)
	})

	t.Run("ExportGDPRData - Returns JSON Object", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/gdpr/export", r.URL.Path)
			assert.Equal(t, "GET", r.Method)
			_, _ = io.WriteString(w, `{"user":{"id":1},"conversations":[]}`)
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		data, err := client.ExportGDPRData(context.Background())
		require.NoError(t, err)
		assert.Contains(t, data, `"user":{"id":1}`)
		assert.Contains(t, data, `"conversations":[]`)
	})

	t.Run("GetConversations - No Limit", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Empty(t, r.URL.Query().Get("limit"))
			_, _ = w.Write([]byte(`{"conversations":[]}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		res, err := client.GetConversations(context.Background(), 0, 0)
		require.NoError(t, err)
		assert.Empty(t, res)
	})

	t.Run("GetConversations - No Content", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		res, err := client.GetConversations(context.Background(), 10, 0)
		require.NoError(t, err)
		assert.Empty(t, res)
	})

	t.Run("GetConversations - Rejects Negative Pagination", func(t *testing.T) {
		serverCalls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			serverCalls++
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		res, err := client.GetConversations(context.Background(), -1, 0)
		require.Error(t, err)
		require.ErrorIs(t, err, ErrInvalidPagination)
		assert.Nil(t, res)
		assert.Equal(t, 0, serverCalls)
	})

	t.Run("Logout - Propagates Non Not Found Error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/auth/logout", r.URL.Path)
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"detail":"logout failed"}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		err := client.Logout(context.Background())
		require.Error(t, err)
		assert.Contains(t, err.Error(), "logout failed")
	})

	t.Run("Pointer Responses Are Nil On Error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"detail":"boom"}`))
		}))
		defer server.Close()

		client := NewApiClient(server.URL, nil)
		ctx := context.Background()
		cases := []struct {
			name string
			call func() (any, error)
		}{
			{
				name: "RunTask",
				call: func() (any, error) {
					return client.RunTask(ctx, RunRequest{Prompt: "hi"})
				},
			},
			{
				name: "GetModelOptions",
				call: func() (any, error) {
					return client.GetModelOptions(ctx)
				},
			},
			{
				name: "CurrentUser",
				call: func() (any, error) {
					return client.CurrentUser(ctx)
				},
			},
			{
				name: "UpdateTheme",
				call: func() (any, error) {
					return client.UpdateTheme(ctx, ThemeDark)
				},
			},
			{
				name: "GetSubscription",
				call: func() (any, error) {
					return client.GetSubscription(ctx)
				},
			},
			{
				name: "GetProducts",
				call: func() (any, error) {
					return client.GetProducts(ctx)
				},
			},
			{
				name: "CreateSubscription",
				call: func() (any, error) {
					return client.CreateSubscription(ctx, "price_123")
				},
			},
			{
				name: "CancelSubscription",
				call: func() (any, error) {
					return client.CancelSubscription(ctx)
				},
			},
			{
				name: "ReactivateSubscription",
				call: func() (any, error) {
					return client.ReactivateSubscription(ctx)
				},
			},
			{
				name: "SyncMobileSubscription",
				call: func() (any, error) {
					return client.SyncMobileSubscription(ctx)
				},
			},
		}

		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				resp, err := tc.call()
				require.Error(t, err)
				assert.Nil(t, resp)
			})
		}
	})
}

func BenchmarkAPIClientGetConversationsPagination(b *testing.B) {
	client := &httpApiClient{
		ctx: &RequestContext{
			BaseURL: "https://api.taskforce.ai",
			HTTPClient: &http.Client{
				Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
					return &http.Response{
						StatusCode: http.StatusOK,
						Status:     "200 OK",
						Body:       io.NopCloser(strings.NewReader(`{"conversations":[{"id":1}],"total":1}`)),
					}, nil
				}),
			},
		},
	}

	b.ReportAllocs()
	for b.Loop() {
		conversations, err := client.GetConversations(context.Background(), 50, 100)
		if err != nil {
			b.Fatal(err)
		}
		benchmarkConversationSummaries = conversations
	}
}

func stringPtr(value string) *string {
	return &value
}
