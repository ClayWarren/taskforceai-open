package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeHumaAPI struct {
	doc *huma.OpenAPI
}

func (f fakeHumaAPI) OpenAPI() *huma.OpenAPI {
	return f.doc
}

type fakeManagedServer struct {
	listenAndServe func() error
	shutdown       func(context.Context) error
}

func (s fakeManagedServer) ListenAndServe() error {
	return s.listenAndServe()
}

func (s fakeManagedServer) Shutdown(ctx context.Context) error {
	return s.shutdown(ctx)
}

func resetServerHooks(t *testing.T) {
	t.Helper()

	oldNotify := serverSignalNotify
	oldStop := serverSignalStop
	oldExit := serverExit
	oldNewServer := newManagedServer

	t.Cleanup(func() {
		serverSignalNotify = oldNotify
		serverSignalStop = oldStop
		serverExit = oldExit
		newManagedServer = oldNewServer
	})
}

func setOpenAPIArgs(t *testing.T) {
	t.Helper()

	oldArgs := os.Args
	os.Args = []string{"test-service", "--openapi"}
	t.Cleanup(func() {
		os.Args = oldArgs
	})
}

func validOpenAPIDoc() *huma.OpenAPI {
	return &huma.OpenAPI{
		OpenAPI: "3.1.0",
		Info: &huma.Info{
			Title:   "Test API",
			Version: "1.0.0",
		},
	}
}

func TestNewManagedServerBuildsHTTPServer(t *testing.T) {
	router := http.NewServeMux()
	srv := newManagedServer(":8080", router, "test-service", time.Millisecond, 2*time.Millisecond, 3*time.Millisecond)

	httpSrv, ok := srv.(*http.Server)
	require.True(t, ok)
	assert.Equal(t, ":8080", httpSrv.Addr)
	assert.NotNil(t, httpSrv.Handler)
	assert.Equal(t, time.Millisecond, httpSrv.ReadTimeout)
	assert.Equal(t, 2*time.Millisecond, httpSrv.WriteTimeout)
	assert.Equal(t, 3*time.Millisecond, httpSrv.IdleTimeout)
}

func TestRunPrintsOpenAPI(t *testing.T) {
	setOpenAPIArgs(t)

	Run(Config{
		ServiceName: "test-service",
		HumaAPI:     fakeHumaAPI{doc: validOpenAPIDoc()},
	})
}

func TestRunOpenAPIExitsOnMarshalError(t *testing.T) {
	resetServerHooks(t)
	setOpenAPIArgs(t)

	exitCode := 0
	serverExit = func(code int) {
		exitCode = code
	}

	Run(Config{
		ServiceName: "test-service",
		HumaAPI: fakeHumaAPI{doc: &huma.OpenAPI{
			OpenAPI: "3.1.0",
			Info: &huma.Info{
				Title:      "Test API",
				Version:    "1.0.0",
				Extensions: map[string]any{"bad": func() {}},
			},
		}},
	})

	assert.Equal(t, 1, exitCode)
}

func TestRunExitsWhenStartupChecksFail(t *testing.T) {
	resetServerHooks(t)

	var signalStopped atomic.Bool
	serverSignalNotify = func(chan<- os.Signal, ...os.Signal) {}
	serverSignalStop = func(chan<- os.Signal) {
		signalStopped.Store(true)
	}

	exitCode := 0
	serverExit = func(code int) {
		exitCode = code
	}

	Run(Config{
		ServiceName:        "test-service",
		DefaultPort:        "8080",
		Router:             http.NewServeMux(),
		StartupWaitTimeout: time.Nanosecond,
		StartupRetryDelay:  time.Nanosecond,
		StartupChecks: []StartupCheck{
			{
				Name: "dependency",
				Check: func(context.Context) error {
					return errors.New("not ready")
				},
			},
		},
	})

	assert.Equal(t, 1, exitCode)
	assert.True(t, signalStopped.Load())
}

func TestRunHandlesGracefulShutdown(t *testing.T) {
	resetServerHooks(t)
	t.Setenv("TASKFORCEAI_SKIP_STARTUP_CHECKS", "true")
	t.Setenv("PORT", "")

	started := make(chan struct{})
	shutdownCalled := make(chan struct{})
	var tracerShutdowns atomic.Int32
	var meterShutdowns atomic.Int32
	var signalStopped atomic.Bool
	var builtAddr string

	serverSignalNotify = func(ch chan<- os.Signal, _ ...os.Signal) {
		go func() {
			<-started
			ch <- os.Interrupt
		}()
	}
	serverSignalStop = func(chan<- os.Signal) {
		signalStopped.Store(true)
	}
	newManagedServer = func(addr string, router http.Handler, serviceName string, readTimeout, writeTimeout, idleTimeout time.Duration) managedHTTPServer {
		builtAddr = addr
		require.NotNil(t, router)
		assert.Equal(t, "test-service", serviceName)
		assert.Equal(t, 5*time.Second, readTimeout)
		assert.Equal(t, 10*time.Second, writeTimeout)
		assert.Equal(t, 120*time.Second, idleTimeout)

		return fakeManagedServer{
			listenAndServe: func() error {
				close(started)
				<-shutdownCalled
				return http.ErrServerClosed
			},
			shutdown: func(context.Context) error {
				close(shutdownCalled)
				return nil
			},
		}
	}

	Run(Config{
		ServiceName: "test-service",
		DefaultPort: "8080",
		Router:      http.NewServeMux(),
		InitTracer: func(serviceName string) (func(), error) {
			assert.Equal(t, "test-service", serviceName)
			return func() {
				tracerShutdowns.Add(1)
			}, nil
		},
		InitMeter: func(serviceName string) (func(), error) {
			assert.Equal(t, "test-service", serviceName)
			return func() {
				meterShutdowns.Add(1)
			}, nil
		},
		ShutdownGroup: &sync.WaitGroup{},
	})

	assert.Equal(t, ":8080", builtAddr)
	assert.Equal(t, int32(1), tracerShutdowns.Load())
	assert.Equal(t, int32(1), meterShutdowns.Load())
	assert.True(t, signalStopped.Load())
}

func TestRunLogsTelemetryAndShutdownErrors(t *testing.T) {
	resetServerHooks(t)
	t.Setenv("PORT", "9090")

	started := make(chan struct{})
	shutdownCalled := make(chan struct{})

	serverSignalNotify = func(ch chan<- os.Signal, _ ...os.Signal) {
		go func() {
			<-started
			ch <- os.Interrupt
		}()
	}
	serverSignalStop = func(chan<- os.Signal) {}
	newManagedServer = func(addr string, _ http.Handler, _ string, readTimeout, writeTimeout, idleTimeout time.Duration) managedHTTPServer {
		assert.Equal(t, ":9090", addr)
		assert.Equal(t, time.Millisecond, readTimeout)
		assert.Equal(t, 2*time.Millisecond, writeTimeout)
		assert.Equal(t, 3*time.Millisecond, idleTimeout)

		return fakeManagedServer{
			listenAndServe: func() error {
				close(started)
				<-shutdownCalled
				return http.ErrServerClosed
			},
			shutdown: func(context.Context) error {
				close(shutdownCalled)
				return errors.New("shutdown failed")
			},
		}
	}

	Run(Config{
		ServiceName:     "test-service",
		DefaultPort:     "8080",
		Router:          http.NewServeMux(),
		ReadTimeout:     time.Millisecond,
		WriteTimeout:    2 * time.Millisecond,
		IdleTimeout:     3 * time.Millisecond,
		ShutdownTimeout: time.Millisecond,
		InitTracer: func(string) (func(), error) {
			return nil, errors.New("tracer failed")
		},
		InitMeter: func(string) (func(), error) {
			return nil, errors.New("meter failed")
		},
	})
}

func TestRunShutdownGroupRespectsTimeout(t *testing.T) {
	resetServerHooks(t)

	var drainGroup sync.WaitGroup
	drainGroup.Add(1)
	t.Cleanup(drainGroup.Done)

	started := make(chan struct{})
	serverStopped := make(chan struct{})

	serverSignalNotify = func(ch chan<- os.Signal, _ ...os.Signal) {
		go func() {
			<-started
			ch <- os.Interrupt
		}()
	}
	serverSignalStop = func(chan<- os.Signal) {}
	newManagedServer = func(string, http.Handler, string, time.Duration, time.Duration, time.Duration) managedHTTPServer {
		return fakeManagedServer{
			listenAndServe: func() error {
				close(started)
				<-serverStopped
				return http.ErrServerClosed
			},
			shutdown: func(ctx context.Context) error {
				<-ctx.Done()
				close(serverStopped)
				return nil
			},
		}
	}

	Run(Config{
		ServiceName:     "test-service",
		DefaultPort:     "8080",
		Router:          http.NewServeMux(),
		ShutdownTimeout: time.Millisecond,
		ShutdownGroup:   &drainGroup,
	})
}

func TestRunServerErrorCallsExit(t *testing.T) {
	resetServerHooks(t)

	exitCodes := make(chan int, 1)
	serverExit = func(code int) {
		exitCodes <- code
	}
	serverSignalNotify = func(ch chan<- os.Signal, _ ...os.Signal) {
		ch <- os.Interrupt
	}
	serverSignalStop = func(chan<- os.Signal) {}
	newManagedServer = func(string, http.Handler, string, time.Duration, time.Duration, time.Duration) managedHTTPServer {
		return fakeManagedServer{
			listenAndServe: func() error {
				return errors.New("listen failed")
			},
			shutdown: func(context.Context) error {
				return nil
			},
		}
	}

	Run(Config{
		ServiceName: "test-service",
		DefaultPort: "8080",
		Router:      http.NewServeMux(),
	})

	require.Equal(t, 1, <-exitCodes)
}

func TestWaitForStartupChecksRetriesUntilSuccess(t *testing.T) {
	var attempts atomic.Int32

	cfg := Config{
		ServiceName:        "test-service",
		StartupWaitTimeout: 250 * time.Millisecond,
		StartupRetryDelay:  10 * time.Millisecond,
		StartupChecks: []StartupCheck{
			{
				Name: "dependency",
				Check: func(context.Context) error {
					call := attempts.Add(1)
					if call < 3 {
						return errors.New("not ready")
					}
					return nil
				},
			},
		},
	}

	err := waitForStartupChecks(context.Background(), cfg)
	require.NoError(t, err)
	assert.Equal(t, int32(3), attempts.Load())
}

func TestWaitForStartupChecksDefaultsAndPreCancelledContext(t *testing.T) {
	err := waitForStartupChecks(context.Background(), Config{
		ServiceName: "test-service",
		StartupChecks: []StartupCheck{
			{
				Name: "healthy",
				Check: func(context.Context) error {
					return nil
				},
			},
		},
	})
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err = waitForStartupChecks(ctx, Config{
		ServiceName: "test-service",
		StartupChecks: []StartupCheck{
			{
				Name: "healthy",
				Check: func(context.Context) error {
					t.Fatal("startup check should not run after context cancellation")
					return nil
				},
			},
		},
	})
	require.ErrorIs(t, err, context.Canceled)
}

func TestShouldSkipStartupChecks(t *testing.T) {
	t.Setenv("TASKFORCEAI_SKIP_STARTUP_CHECKS", "")
	if shouldSkipStartupChecks() {
		t.Fatal("expected startup checks to run by default")
	}

	t.Setenv("TASKFORCEAI_SKIP_STARTUP_CHECKS", "1")
	if !shouldSkipStartupChecks() {
		t.Fatal("expected startup checks to be skipped when enabled")
	}
}

func TestWaitForStartupChecksTimeout(t *testing.T) {
	var attempts atomic.Int32

	cfg := Config{
		ServiceName:        "test-service",
		StartupWaitTimeout: 40 * time.Millisecond,
		StartupRetryDelay:  10 * time.Millisecond,
		StartupChecks: []StartupCheck{
			{
				Name: "dependency",
				Check: func(context.Context) error {
					attempts.Add(1)
					return errors.New("still failing")
				},
			},
		},
	}

	start := time.Now()
	err := waitForStartupChecks(context.Background(), cfg)
	require.Error(t, err)
	require.ErrorContains(t, err, "startup checks did not pass within")
	assert.GreaterOrEqual(t, attempts.Load(), int32(2))
	assert.Less(t, time.Since(start), 500*time.Millisecond)
}

func TestWaitForStartupChecksCancelledContext(t *testing.T) {
	var attempts atomic.Int32
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	cfg := Config{
		ServiceName:        "test-service",
		StartupWaitTimeout: time.Second,
		StartupRetryDelay:  100 * time.Millisecond,
		StartupChecks: []StartupCheck{
			{
				Name: "dependency",
				Check: func(context.Context) error {
					if attempts.Add(1) == 1 {
						cancel()
					}
					return errors.New("not ready")
				},
			},
		},
	}

	err := waitForStartupChecks(ctx, cfg)
	require.Error(t, err)
	require.ErrorIs(t, err, context.Canceled)
	assert.Equal(t, int32(1), attempts.Load())
}

func TestRunChecksParallelUsesPerCheckTimeoutContext(t *testing.T) {
	failed := runChecksParallel([]StartupCheck{
		{
			Name: "deadline-check",
			Check: func(ctx context.Context) error {
				deadline, ok := ctx.Deadline()
				if !ok {
					return errors.New("startup check context missing deadline")
				}

				remaining := time.Until(deadline)
				if remaining < 1500*time.Millisecond || remaining > 2500*time.Millisecond {
					return fmt.Errorf("unexpected deadline window: %s", remaining)
				}
				return nil
			},
		},
	})

	assert.Empty(t, failed)
}

func TestRunChecksParallelRunsChecksConcurrently(t *testing.T) {
	ready := make(chan struct{}, 2)
	release := make(chan struct{})
	check := func(ctx context.Context) error {
		ready <- struct{}{}
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	done := make(chan []failedCheck, 1)
	go func() {
		done <- runChecksParallel([]StartupCheck{
			{Name: "first", Check: check},
			{Name: "second", Check: check},
		})
	}()

	for range 2 {
		select {
		case <-ready:
		case <-time.After(500 * time.Millisecond):
			t.Fatal("startup checks did not run concurrently")
		}
	}
	close(release)

	select {
	case failed := <-done:
		assert.Empty(t, failed)
	case <-time.After(500 * time.Millisecond):
		t.Fatal("startup checks did not finish")
	}
}

func TestRunChecksParallelReportsPanicsAsFailures(t *testing.T) {
	failed := runChecksParallel([]StartupCheck{
		{
			Name: "panic-check",
			Check: func(context.Context) error {
				panic("boom")
			},
		},
	})

	require.Len(t, failed, 1)
	assert.Equal(t, "panic-check", failed[0].name)
	assert.EqualError(t, failed[0].err, "startup check panicked: boom")
}

func TestRunChecksParallelSkipsNilAndCollectsFailures(t *testing.T) {
	failed := runChecksParallel([]StartupCheck{
		{
			Name:  "nil-check",
			Check: nil,
		},
		{
			Name: "healthy",
			Check: func(context.Context) error {
				return nil
			},
		},
		{
			Name: "failing",
			Check: func(context.Context) error {
				return errors.New("boom")
			},
		},
	})

	require.Len(t, failed, 1)
	assert.Equal(t, "failing", failed[0].name)
	assert.EqualError(t, failed[0].err, "boom")
}
