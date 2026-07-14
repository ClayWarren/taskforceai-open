module github.com/TaskForceAI/go-engine

go 1.26.4

replace github.com/TaskForceAI/config => ../../packages/infrastructure/config

replace github.com/TaskForceAI/contracts => ../../packages/contracts/go

replace github.com/TaskForceAI/core => ../../packages/core/go

replace github.com/TaskForceAI/infrastructure/cache => ../../packages/infrastructure/cache

replace github.com/TaskForceAI/infrastructure/redis => ../../packages/infrastructure/redis

replace github.com/TaskForceAI/infrastructure/ratelimit => ../../packages/infrastructure/ratelimit

replace github.com/TaskForceAI/infrastructure/llm => ../../packages/infrastructure/llm

replace github.com/TaskForceAI/infrastructure/resilience => ../../packages/infrastructure/resilience

replace github.com/TaskForceAI/infrastructure/search => ../../packages/infrastructure/search

replace github.com/TaskForceAI/logger => ../../packages/infrastructure/logger

replace github.com/TaskForceAI/adapters => ../../packages/adapters

require (
	github.com/TaskForceAI/adapters v0.0.0
	github.com/TaskForceAI/config v0.0.0
	github.com/TaskForceAI/contracts v0.0.0
	github.com/TaskForceAI/core v0.0.0
	github.com/TaskForceAI/feature-flags v0.0.0-00010101000000-000000000000
	github.com/TaskForceAI/infrastructure/cache v0.0.0-00010101000000-000000000000
	github.com/TaskForceAI/infrastructure/llm v0.0.0-00010101000000-000000000000
	github.com/TaskForceAI/infrastructure/ratelimit v0.0.0-00010101000000-000000000000
	github.com/TaskForceAI/infrastructure/redis v0.0.0
	github.com/TaskForceAI/infrastructure/resilience v0.0.0
	github.com/TaskForceAI/infrastructure/search v0.0.0-00010101000000-000000000000
	github.com/alicebob/miniredis/v2 v2.38.0
	github.com/claywarren/vercel_blob v0.11.2
	github.com/danielgtaylor/huma/v2 v2.38.0
	github.com/daytonaio/daytona/libs/sdk-go v0.190.0
	github.com/go-chi/chi/v5 v5.3.1
	github.com/google/uuid v1.6.0
	github.com/inngest/inngestgo v0.15.3
	github.com/jackc/pgx/v5 v5.10.0
	github.com/jung-kurt/gofpdf v1.16.2
	github.com/pashagolub/pgxmock/v4 v4.9.0
	github.com/redis/go-redis/v9 v9.21.0
	github.com/riandyrn/otelchi v0.12.3
	github.com/stretchr/testify v1.11.1
	github.com/unidoc/unioffice v1.39.0
	github.com/xuri/excelize/v2 v2.11.0
	go.opentelemetry.io/otel v1.44.0
	go.opentelemetry.io/otel/metric v1.44.0
	go.opentelemetry.io/otel/sdk v1.44.0
	go.opentelemetry.io/otel/trace v1.44.0
	go.uber.org/goleak v1.3.0
	golang.org/x/oauth2 v0.36.0
	google.golang.org/api v0.288.0
)

require (
	github.com/anishathalye/porcupine v1.3.0 // indirect
	github.com/getsentry/sentry-go v0.48.0 // indirect
)

require (
	cloud.google.com/go v0.123.0 // indirect
	cloud.google.com/go/auth v0.20.0 // indirect
	cloud.google.com/go/auth/oauth2adapt v0.2.8 // indirect
	cloud.google.com/go/compute/metadata v0.9.0 // indirect
	github.com/TaskForceAI/infrastructure/crypto v0.0.0
	github.com/TaskForceAI/infrastructure/postgres v0.0.0
	github.com/TaskForceAI/logger v0.0.0-00010101000000-000000000000
	github.com/anthropics/anthropic-sdk-go v1.57.0 // indirect
	github.com/aws/aws-sdk-go-v2 v1.41.6 // indirect
	github.com/aws/aws-sdk-go-v2/aws/protocol/eventstream v1.7.8 // indirect
	github.com/aws/aws-sdk-go-v2/credentials v1.19.15 // indirect
	github.com/aws/aws-sdk-go-v2/internal/configsources v1.4.22 // indirect
	github.com/aws/aws-sdk-go-v2/internal/endpoints/v2 v2.7.22 // indirect
	github.com/aws/aws-sdk-go-v2/internal/v4a v1.4.23 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/accept-encoding v1.13.8 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/checksum v1.9.13 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/presigned-url v1.13.22 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/s3shared v1.19.21 // indirect
	github.com/aws/aws-sdk-go-v2/service/s3 v1.97.3 // indirect
	github.com/aws/smithy-go v1.25.0 // indirect
	github.com/bahlo/generic-list-go v0.2.0 // indirect
	github.com/buger/jsonparser v1.2.0 // indirect
	github.com/cenkalti/backoff/v5 v5.0.3 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/claywarren/go-brave-search v0.3.2 // indirect
	github.com/coder/websocket v1.8.14 // indirect
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/daytonaio/daytona/libs/api-client-go v0.190.0 // indirect
	github.com/daytonaio/daytona/libs/toolbox-api-client-go v0.190.0 // indirect
	github.com/fatih/structs v1.1.0 // indirect
	github.com/felixge/httpsnoop v1.0.4 // indirect
	github.com/gabriel-vasile/mimetype v1.4.13 // indirect
	github.com/go-logr/logr v1.4.3 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/go-playground/locales v0.14.1 // indirect
	github.com/go-playground/universal-translator v0.18.1 // indirect
	github.com/go-playground/validator/v10 v10.30.3 // indirect
	github.com/golang-jwt/jwt/v5 v5.3.1 // indirect
	github.com/golang-migrate/migrate/v4 v4.19.1 // indirect
	github.com/google/go-cmp v0.7.0 // indirect
	github.com/google/s2a-go v0.1.9 // indirect
	github.com/googleapis/enterprise-certificate-proxy v0.3.17 // indirect
	github.com/googleapis/gax-go/v2 v2.22.0 // indirect
	github.com/gorilla/websocket v1.5.4-0.20250319132907-e064f32e3674 // indirect
	github.com/gosimple/slug v1.15.0 // indirect
	github.com/gosimple/unidecode v1.0.1 // indirect
	github.com/gowebpki/jcs v1.0.1 // indirect
	github.com/grpc-ecosystem/grpc-gateway/v2 v2.29.0 // indirect
	github.com/hashicorp/errwrap v1.1.0 // indirect
	github.com/hashicorp/go-multierror v1.1.1 // indirect
	github.com/hashicorp/golang-lru v1.0.2 // indirect
	github.com/inngest/inngest v1.25.0 // indirect
	github.com/invopop/jsonschema v0.14.0 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/joho/godotenv v1.5.1 // indirect
	github.com/leodido/go-urn v1.4.0 // indirect
	github.com/lib/pq v1.12.3 // indirect
	github.com/lmittmann/tint v1.1.3 // indirect
	github.com/oklog/ulid/v2 v2.1.1 // indirect
	github.com/openai/openai-go/v3 v3.42.0 // indirect
	github.com/pb33f/ordered-map/v2 v2.3.1 // indirect
	github.com/pbnjay/memory v0.0.0-20210728143218-7b4eea64cf58 // indirect
	github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2 // indirect
	github.com/redis/go-redis/extra/rediscmd/v9 v9.21.0 // indirect
	github.com/redis/go-redis/extra/redisotel/v9 v9.21.0 // indirect
	github.com/richardlehane/mscfb v1.0.7 // indirect
	github.com/richardlehane/msoleps v1.0.6 // indirect
	github.com/standard-webhooks/standard-webhooks/libraries v0.0.1 // indirect
	github.com/statsig-io/go-sdk v1.40.1 // indirect
	github.com/statsig-io/ip3country-go v0.3.0 // indirect
	github.com/stretchr/objx v0.5.3 // indirect
	github.com/tidwall/gjson v1.19.0 // indirect
	github.com/tidwall/match v1.2.0 // indirect
	github.com/tidwall/pretty v1.2.1 // indirect
	github.com/tidwall/sjson v1.2.5 // indirect
	github.com/tiendc/go-deepcopy v1.7.2 // indirect
	github.com/ua-parser/uap-go v0.0.0-20260529044130-17c35e68e58c // indirect
	github.com/xhit/go-str2duration/v2 v2.1.0 // indirect
	github.com/xuri/efp v0.0.1 // indirect
	github.com/xuri/nfp v0.0.2-0.20250530014748-2ddeb826f9a9 // indirect
	github.com/yuin/gopher-lua v1.1.2 // indirect
	go.opentelemetry.io/auto/sdk v1.2.1 // indirect
	go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.69.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp v1.44.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace v1.44.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.44.0 // indirect
	go.opentelemetry.io/otel/sdk/metric v1.44.0 // indirect
	go.opentelemetry.io/proto/otlp v1.10.0 // indirect
	go.uber.org/atomic v1.11.0 // indirect
	go.yaml.in/yaml/v4 v4.0.0-rc.6 // indirect
	golang.org/x/crypto v0.53.0 // indirect
	golang.org/x/net v0.56.0 // indirect
	golang.org/x/sync v0.21.0 // indirect
	golang.org/x/sys v0.46.0 // indirect
	golang.org/x/text v0.38.0 // indirect
	google.golang.org/genai v1.63.0 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20260526163538-3dc84a4a5aaa // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260630182238-925bb5da69e7 // indirect
	google.golang.org/grpc v1.82.0 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

replace github.com/TaskForceAI/feature-flags => ../../packages/infrastructure/feature-flags

replace github.com/TaskForceAI/infrastructure/crypto => ../../packages/infrastructure/crypto

replace github.com/TaskForceAI/infrastructure/postgres => ../../packages/infrastructure/postgres
