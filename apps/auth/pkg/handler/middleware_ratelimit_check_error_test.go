package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
)

type incrErrorRedis struct {
	infraredis.Cmdable
}

func (f *incrErrorRedis) Incr(ctx context.Context, key string) (int, error) {
	return 0, errors.New("redis incr failed")
}

func TestWithRateLimit_CheckErrorFailOpen(t *testing.T) {
	SetRedisClient(&incrErrorRedis{Cmdable: infraredis.NewMockClient()})
	t.Cleanup(func() { SetRedisClient(nil) })

	middleware := WithRateLimit(10, time.Minute)
	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.Header.Set("X-Real-IP", "198.51.100.5")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
}
