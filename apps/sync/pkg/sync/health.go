package sync

import (
	"context"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"os"
	"runtime"
	"strings"
	"time"
)

// HealthReport provides a comprehensive view of service health.
type HealthReport struct {
	Status    string         `json:"status"`
	Uptime    string         `json:"uptime"`
	GoVersion string         `json:"go_version"`
	Memory    MemoryStats    `json:"memory"`
	Database  DatabaseStats  `json:"database"`
	Redis     RedisStats     `json:"redis"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}

type MemoryStats struct {
	Alloc      uint64 `json:"alloc_bytes"`
	TotalAlloc uint64 `json:"total_alloc_bytes"`
	Sys        uint64 `json:"sys_bytes"`
	NumGC      uint32 `json:"num_gc"`
}

type DatabaseStats struct {
	Status      string `json:"status"`
	Connections int32  `json:"active_connections"`
}

type RedisStats struct {
	Status string `json:"status"`
}

var startTime = time.Now()

var (
	getHealthDBPool          = postgres.GetPool
	getHealthDBStat          = (*pgxpool.Pool).Stat
	getHealthDBConnectionCnt = (*pgxpool.Stat).TotalConns
	getHealthRedisClient     = redis.GetClient
)

// GetShallowHealthReport returns lightweight health information without network probes.
func GetShallowHealthReport() *HealthReport {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)

	report := &HealthReport{
		Status:    "operational",
		Uptime:    time.Since(startTime).String(),
		GoVersion: runtime.Version(),
		Memory: MemoryStats{
			Alloc:      ms.Alloc,
			TotalAlloc: ms.TotalAlloc,
			Sys:        ms.Sys,
			NumGC:      ms.NumGC,
		},
		Database: DatabaseStats{
			Status: "connected",
		},
		Redis: RedisStats{
			Status: "connected",
		},
	}

	if strings.TrimSpace(os.Getenv("DATABASE_URL")) == "" {
		report.Database.Status = "error"
		report.Status = "degraded"
	}

	redisURL := strings.TrimSpace(os.Getenv("REDIS_URL"))
	if redisURL == "" {
		redisURL = strings.TrimSpace(os.Getenv("REDIS_KV_URL"))
	}
	if redisURL == "" {
		report.Redis.Status = "error"
		report.Status = "degraded"
	}

	return report
}

// GetHealthReport calculates the current health status of the service.
func GetHealthReport(ctx context.Context) (*HealthReport, error) {
	report := GetShallowHealthReport()

	// DB Check
	dbStatus := "connected"
	pool, err := getHealthDBPool(ctx)
	if err != nil {
		slog.Error("Health check: failed to get database pool", "error", err)
		dbStatus = "error"
		report.Status = "degraded"
	}

	conns := int32(0)
	if pool != nil {
		conns = getHealthDBConnectionCnt(getHealthDBStat(pool))
	}

	report.Database = DatabaseStats{
		Status:      dbStatus,
		Connections: conns,
	}

	// Redis Check
	redisStatus := "connected"
	rClient, err := getHealthRedisClient()
	if err != nil {
		slog.Error("Health check: failed to get Redis client", "error", err)
		redisStatus = "error"
		report.Status = "degraded"
	} else {
		// Ping to verify
		_, err = rClient.Get(ctx, "health_ping")
		if err != nil && err.Error() != "key not found" && !strings.Contains(err.Error(), "404") {
			slog.Error("Health check: Redis ping failed", "error", err)
			redisStatus = "disconnected"
			report.Status = "degraded"
		}
	}

	report.Redis = RedisStats{
		Status: redisStatus,
	}

	return report, nil
}
