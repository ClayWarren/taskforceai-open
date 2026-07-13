package main

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"time"

	handler "github.com/TaskForceAI/billing-service/api"
)

var (
	billingListenAndServe = (*http.Server).ListenAndServe
	billingExit           = os.Exit
)

func main() {
	run(billingListenAndServe, billingExit)
}

func run(serve func(server *http.Server) error, exit func(code int)) {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3003" // Default port for billing
	}

	server := &http.Server{
		Addr:        ":" + port,
		Handler:     http.HandlerFunc(handler.Handler),
		ReadTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second,
		IdleTimeout: 120 * time.Second,
	}

	slog.Info("Billing service starting", "port", port)
	if err := serve(server); err != nil {
		if errors.Is(err, http.ErrServerClosed) {
			slog.Info("Billing service stopped")
			return
		}
		slog.Error("Billing service failed", "error", err)
		exit(1)
	}
}
