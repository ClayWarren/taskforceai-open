package main

import (
	"errors"
	"net/http"
	"testing"
)

func TestRun_ListenErrorExits(t *testing.T) {
	called := false
	exitCode := 0

	run(func(server *http.Server) error {
		return errors.New("listen failed")
	}, func(code int) {
		called = true
		exitCode = code
	})

	if !called {
		t.Fatalf("expected exit to be called")
	}
	if exitCode != 1 {
		t.Fatalf("expected exit code 1, got %d", exitCode)
	}
}

func TestRun_ServerClosedDoesNotExit(t *testing.T) {
	called := false

	run(func(server *http.Server) error {
		return http.ErrServerClosed
	}, func(code int) {
		called = true
	})

	if called {
		t.Fatalf("expected graceful shutdown not to call exit")
	}
}

func TestMainEntrypointUsesRunDependencies(t *testing.T) {
	originalServe := billingListenAndServe
	originalExit := billingExit
	t.Cleanup(func() {
		billingListenAndServe = originalServe
		billingExit = originalExit
	})

	called := false
	billingListenAndServe = func(server *http.Server) error {
		called = true
		return http.ErrServerClosed
	}
	billingExit = func(code int) {
		t.Fatalf("exit should not be called, got code %d", code)
	}

	main()

	if !called {
		t.Fatalf("expected listen dependency to be called")
	}
}
