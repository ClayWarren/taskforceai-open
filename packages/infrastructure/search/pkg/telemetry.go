package pkg

import "go.opentelemetry.io/otel"

var tracer = otel.Tracer("infrastructure-search")
