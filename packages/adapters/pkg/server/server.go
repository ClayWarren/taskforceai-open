package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/danielgtaylor/huma/v2"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

type StartupCheck struct {
	Name  string
	Check func(context.Context) error
}

type managedHTTPServer interface {
	ListenAndServe() error
	Shutdown(context.Context) error
}

var (
	serverSignalNotify = signal.Notify
	serverSignalStop   = signal.Stop
	serverExit         = os.Exit
	newManagedServer   = func(addr string, router http.Handler, serviceName string, readTimeout, writeTimeout, idleTimeout time.Duration) managedHTTPServer {
		return &http.Server{
			Addr:         addr,
			Handler:      otelhttp.NewHandler(router, serviceName),
			ReadTimeout:  readTimeout,
			WriteTimeout: writeTimeout,
			IdleTimeout:  idleTimeout,
		}
	}
)

// Config holds the settings needed to start a service.
type Config struct {
	ServiceName        string
	DefaultPort        string
	Router             http.Handler
	HumaAPI            interface{ OpenAPI() *huma.OpenAPI }
	StartupChecks      []StartupCheck
	StartupWaitTimeout time.Duration
	StartupRetryDelay  time.Duration
	ReadTimeout        time.Duration
	WriteTimeout       time.Duration
	IdleTimeout        time.Duration
	ShutdownTimeout    time.Duration
	ShutdownGroup      *sync.WaitGroup
	ShutdownSignal     context.Context // Optional: cancelled when SIGTERM/SIGINT received
	InitTracer         func(string) (func(), error)
	InitMeter          func(string) (func(), error)
}

// Run handles the --openapi flag, resolves the port, initializes telemetry,
// starts the HTTP server, handles graceful shutdown, and logs the result.
func Run(cfg Config) {
	if printOpenAPIIfRequested(cfg) {
		return
	}

	// Channel to listen for interrupt/terminate signals
	stop := make(chan os.Signal, 1)
	serverSignalNotify(stop, os.Interrupt, syscall.SIGTERM)
	defer serverSignalStop(stop)

	// Base context that is cancelled when SIGTERM/SIGINT is received.
	// This can be used for background tasks to start cleaning up before
	// the hard shutdown timeout.
	rootCtx, rootCancel := context.WithCancel(context.Background())

	port := configuredPort(cfg.DefaultPort)
	if err := runStartupChecks(rootCtx, cfg); err != nil {
		rootCancel()
		serverExit(1)
		return
	}
	defer rootCancel()

	tracerShutdown := initializeTelemetryProvider(cfg.ServiceName, "tracer", cfg.InitTracer)
	if tracerShutdown != nil {
		defer tracerShutdown()
	}
	meterShutdown := initializeTelemetryProvider(cfg.ServiceName, "meter", cfg.InitMeter)
	if meterShutdown != nil {
		defer meterShutdown()
	}

	readTimeout := durationOrDefault(cfg.ReadTimeout, 5*time.Second)
	writeTimeout := durationOrDefault(cfg.WriteTimeout, 10*time.Second)
	idleTimeout := durationOrDefault(cfg.IdleTimeout, 120*time.Second)

	srv := newManagedServer(":"+port, cfg.Router, cfg.ServiceName, readTimeout, writeTimeout, idleTimeout)
	shutdownTimeout := durationOrDefault(cfg.ShutdownTimeout, 30*time.Second)

	// Channel to signal that server has stopped
	stopped := make(chan struct{})

	handler.Go(cfg.ServiceName+"_httpServer", func() {
		defer close(stopped)
		slog.Info(cfg.ServiceName+" starting", "port", port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error(cfg.ServiceName+" server error", "error", err)
			rootCancel()
			serverExit(1)
			return
		}
	})
	waitForShutdown(cfg, srv, rootCtx, rootCancel, stop, stopped, shutdownTimeout)
}

func waitForShutdown(cfg Config, srv managedHTTPServer, rootCtx context.Context, rootCancel context.CancelFunc, stop <-chan os.Signal, stopped <-chan struct{}, shutdownTimeout time.Duration) {
	sig := <-stop
	slog.Info(cfg.ServiceName+" received shutdown signal", "signal", sig.String())
	rootCancel() // Signal all listeners that we are shutting down

	slog.Info(cfg.ServiceName+" shutting down", "timeout", shutdownTimeout.String())

	// Give outstanding requests time to complete
	shutCtx, shutCancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer shutCancel()

	var wg sync.WaitGroup
	wg.Add(1)
	handler.Go(cfg.ServiceName+"_gracefulShutdown", func() {
		defer wg.Done()
		if err := srv.Shutdown(shutCtx); err != nil {
			slog.Error(cfg.ServiceName+" graceful server shutdown failed", "error", err)
		}
	})

	if cfg.ShutdownGroup != nil {
		wg.Add(1)
		handler.Go(cfg.ServiceName+"_shutdownGroupDrain", func() {
			defer wg.Done()
			// Wait for the group, but respect the shutdown context
			done := make(chan struct{})
			handler.Go(cfg.ServiceName+"_shutdownGroupWait", func() {
				cfg.ShutdownGroup.Wait()
				close(done)
			})

			select {
			case <-done:
				slog.Info(cfg.ServiceName + " shutdown group drained successfully")
			case <-shutCtx.Done():
				slog.Warn(cfg.ServiceName + " shutdown group did not drain in time")
			}
		})
	}

	wg.Wait()
	_ = rootCtx // Avoid lint error if still not used directly here
	<-stopped
	slog.Info(cfg.ServiceName + " stopped")
}

func printOpenAPIIfRequested(cfg Config) bool {
	if len(os.Args) <= 1 || os.Args[1] != "--openapi" {
		return false
	}
	b, err := json.MarshalIndent(cfg.HumaAPI.OpenAPI(), "", "  ")
	if err != nil {
		slog.Error("Failed to marshal OpenAPI", "error", err)
		serverExit(1)
		return true
	}
	fmt.Println(string(b))
	return true
}

func configuredPort(defaultPort string) string {
	if port := os.Getenv("PORT"); port != "" {
		return port
	}
	return defaultPort
}

func runStartupChecks(ctx context.Context, cfg Config) error {
	if shouldSkipStartupChecks() {
		slog.Warn(cfg.ServiceName + " startup dependency checks skipped by TASKFORCEAI_SKIP_STARTUP_CHECKS")
		return nil
	}
	if err := waitForStartupChecks(ctx, cfg); err != nil {
		slog.Error(cfg.ServiceName+" startup dependency check failed", "error", err)
		return err
	}
	return nil
}

func initializeTelemetryProvider(serviceName, providerName string, initialize func(string) (func(), error)) func() {
	if initialize == nil {
		return nil
	}
	shutdown, err := initialize(serviceName)
	if err != nil {
		slog.Error(serviceName+" failed to initialize "+providerName, "error", err)
		return nil
	}
	return shutdown
}

func durationOrDefault(value, fallback time.Duration) time.Duration {
	if value <= 0 {
		return fallback
	}
	return value
}

func shouldSkipStartupChecks() bool {
	value := os.Getenv("TASKFORCEAI_SKIP_STARTUP_CHECKS")
	return value == "1" || value == "true" || value == "TRUE"
}

func waitForStartupChecks(ctx context.Context, cfg Config) error {
	if len(cfg.StartupChecks) == 0 {
		return nil
	}
	timeout := cfg.StartupWaitTimeout
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	retryDelay := cfg.StartupRetryDelay
	if retryDelay <= 0 {
		retryDelay = 1 * time.Second
	}

	deadline := time.Now().Add(timeout)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		failedChecks := runChecksParallel(cfg.StartupChecks)
		if len(failedChecks) == 0 {
			return nil
		}
		for _, fc := range failedChecks {
			slog.Warn(cfg.ServiceName+" startup check failed", "check", fc.name, "error", fc.err)
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("startup checks did not pass within %s", timeout)
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(retryDelay):
		}
	}
}

type failedCheck struct {
	name string
	err  error
}

func runChecksParallel(checks []StartupCheck) []failedCheck {
	type result struct {
		name string
		err  error
	}
	results := make([]result, len(checks))
	var wg sync.WaitGroup
	for i, check := range checks {
		if check.Check == nil {
			continue
		}
		idx := i
		c := check
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() {
				if recovered := recover(); recovered != nil {
					results[idx] = result{name: c.Name, err: fmt.Errorf("startup check panicked: %v", recovered)}
				}
			}()
			checkCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			results[idx] = result{name: c.Name, err: c.Check(checkCtx)}
		}()
	}
	wg.Wait()

	var failed []failedCheck
	for _, r := range results {
		if r.err != nil {
			failed = append(failed, failedCheck(r))
		}
	}
	return failed
}
