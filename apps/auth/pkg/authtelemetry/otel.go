package authtelemetry

import (
	"context"
	"sync"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

// Adapter implements the auth telemetry port with OpenTelemetry.
type Adapter struct {
	tracer        trace.Tracer
	loginTotal    metric.Int64Counter
	registerTotal metric.Int64Counter
}

var (
	once     sync.Once
	instance *Adapter
)

func New() *Adapter {
	once.Do(func() {
		meter := otel.Meter("auth-service")
		loginTotal, _ := meter.Int64Counter("auth.login.total", metric.WithDescription("Total number of login attempts"))
		registerTotal, _ := meter.Int64Counter("auth.register.total", metric.WithDescription("Total number of user registrations"))
		instance = &Adapter{
			tracer:        otel.Tracer("auth-service.logic"),
			loginTotal:    loginTotal,
			registerTotal: registerTotal,
		}
	})
	return instance
}

func (a *Adapter) StartOperation(ctx context.Context, name string, fields map[string]string) (context.Context, func(error)) {
	attrs := make([]attribute.KeyValue, 0, len(fields))
	for key, value := range fields {
		attrs = append(attrs, attribute.String(key, value))
	}
	ctx, span := a.tracer.Start(ctx, name, trace.WithAttributes(attrs...))
	return ctx, func(err error) {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
		} else {
			span.SetStatus(codes.Ok, "")
		}
		span.End()
	}
}

func (a *Adapter) RecordLogin(ctx context.Context, provider string, success bool) {
	a.loginTotal.Add(ctx, 1, metric.WithAttributes(
		attribute.Bool("success", success),
		attribute.String("method", provider),
	))
}

func (a *Adapter) RecordRegistration(ctx context.Context, success bool) {
	a.registerTotal.Add(ctx, 1, metric.WithAttributes(attribute.Bool("success", success)))
}
