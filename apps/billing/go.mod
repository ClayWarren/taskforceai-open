module github.com/TaskForceAI/billing-service

go 1.26.4

replace github.com/TaskForceAI/adapters => ../../packages/adapters

replace github.com/TaskForceAI/config => ../../packages/infrastructure/config

replace github.com/TaskForceAI/contracts => ../../packages/contracts/go

replace github.com/TaskForceAI/core => ../../packages/core/go

replace github.com/TaskForceAI/infrastructure/cache => ../../packages/infrastructure/cache

replace github.com/TaskForceAI/infrastructure/llm => ../../packages/infrastructure/llm

replace github.com/TaskForceAI/infrastructure/redis => ../../packages/infrastructure/redis

replace github.com/TaskForceAI/infrastructure/search => ../../packages/infrastructure/search

replace github.com/TaskForceAI/logger => ../../packages/infrastructure/logger

replace github.com/TaskForceAI/infrastructure/resilience => ../../packages/infrastructure/resilience

require (
	github.com/TaskForceAI/adapters v0.0.0
	github.com/TaskForceAI/core v0.0.0
	github.com/TaskForceAI/infrastructure/redis v0.0.0
	github.com/TaskForceAI/infrastructure/resilience v0.0.0-00010101000000-000000000000
	github.com/claywarren/revenuecat v0.12.1
	github.com/danielgtaylor/huma/v2 v2.38.0
	github.com/go-chi/chi/v5 v5.3.1
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/jackc/pgx/v5 v5.10.0
	github.com/pashagolub/pgxmock/v4 v4.9.0
	github.com/redis/go-redis/v9 v9.21.0
	github.com/stretchr/testify v1.11.1
	github.com/stripe/stripe-go/v82 v82.5.1
	go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.69.0
	go.opentelemetry.io/otel v1.44.0
	go.opentelemetry.io/otel/metric v1.44.0
	go.opentelemetry.io/otel/trace v1.44.0
	go.uber.org/goleak v1.3.0
)

require (
	github.com/gabriel-vasile/mimetype v1.4.13 // indirect
	github.com/go-playground/locales v0.14.1 // indirect
	github.com/go-playground/universal-translator v0.18.1 // indirect
	github.com/go-playground/validator/v10 v10.30.3 // indirect
	github.com/leodido/go-urn v1.4.0 // indirect
	golang.org/x/crypto v0.53.0 // indirect
)

require (
	github.com/TaskForceAI/infrastructure/email v0.0.0
	github.com/TaskForceAI/infrastructure/postgres v0.0.0
	github.com/TaskForceAI/logger v0.0.0-00010101000000-000000000000
	github.com/cenkalti/backoff/v5 v5.0.3 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/felixge/httpsnoop v1.0.4 // indirect
	github.com/getsentry/sentry-go v0.47.0 // indirect
	github.com/go-logr/logr v1.4.3 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/golang-migrate/migrate/v4 v4.19.1 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/grpc-ecosystem/grpc-gateway/v2 v2.29.0 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/lib/pq v1.12.3 // indirect
	github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2 // indirect
	github.com/redis/go-redis/extra/rediscmd/v9 v9.21.0 // indirect
	github.com/redis/go-redis/extra/redisotel/v9 v9.21.0 // indirect
	github.com/resend/resend-go/v3 v3.10.1 // indirect
	github.com/stretchr/objx v0.5.3 // indirect
	go.opentelemetry.io/auto/sdk v1.2.1 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp v1.44.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace v1.44.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.44.0 // indirect
	go.opentelemetry.io/otel/sdk v1.44.0 // indirect
	go.opentelemetry.io/otel/sdk/metric v1.44.0 // indirect
	go.opentelemetry.io/proto/otlp v1.10.0 // indirect
	go.uber.org/atomic v1.11.0 // indirect
	go.yaml.in/yaml/v4 v4.0.0-rc.6 // indirect
	golang.org/x/net v0.56.0 // indirect
	golang.org/x/sync v0.21.0 // indirect
	golang.org/x/sys v0.46.0 // indirect
	golang.org/x/text v0.38.0 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20260526163538-3dc84a4a5aaa // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260526163538-3dc84a4a5aaa // indirect
	google.golang.org/grpc v1.81.1 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

replace github.com/TaskForceAI/infrastructure/email => ../../packages/infrastructure/email

replace github.com/TaskForceAI/infrastructure/postgres => ../../packages/infrastructure/postgres
