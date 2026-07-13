package pkg

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func resetCachedWebEnvForTest() {
	globalWebEnvMu.Lock()
	globalWebEnv = WebEnv{}
	globalWebEnvCached = false
	globalWebEnvSnapshot = [maxWebEnvSnapshotEntries]webEnvSnapshotEntry{}
	globalWebEnvSnapshotLen = 0
	globalWebEnvMu.Unlock()
}

func unsetEnvForTest(t *testing.T, key string) {
	t.Helper()

	prev, ok := os.LookupEnv(key)
	_ = os.Unsetenv(key)
	t.Cleanup(func() {
		if ok {
			_ = os.Setenv(key, prev)
			return
		}
		_ = os.Unsetenv(key)
	})
}

func clearWebEnvForTest(t *testing.T) {
	t.Helper()

	for _, key := range webEnvVariableKeys() {
		unsetEnvForTest(t, key)
	}
	resetCachedWebEnvForTest()
}

func TestLoadWebEnv(t *testing.T) {
	t.Cleanup(resetCachedWebEnvForTest)

	t.Run("Load with defaults", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "http://localhost:5432")
		t.Setenv("AI_GATEWAY_API_KEY", "test-key")
		t.Setenv("AUTH_SECRET", "this-is-a-very-long-secret-key-32-chars!")

		cfg, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
		require.NoError(t, err)
		assert.Equal(t, "development", cfg.NodeEnv)
		assert.Equal(t, "http://localhost:5432", cfg.DatabaseURL)
		assert.Equal(t, "test-key", cfg.AIGatewayAPIKey)
	})

	t.Run("Validation - Missing DATABASE_URL is Allowed", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "")
		t.Setenv("AUTH_SECRET", "abcdefghijklmnopqrstuvwxyz123456")
		t.Setenv("AI_GATEWAY_API_KEY", "")

		cfg, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
		require.NoError(t, err)
		assert.Empty(t, cfg.DatabaseURL)
		assert.Empty(t, cfg.AIGatewayAPIKey)
	})

	t.Run("Validation Error - Short AUTH_SECRET", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "http://localhost:5432")
		t.Setenv("AI_GATEWAY_API_KEY", "test-key")
		t.Setenv("AUTH_SECRET", "short")

		_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "AUTH_SECRET must be at least 32 characters")
	})

	t.Run("Validation Error - Whitespace AUTH_SECRET", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "http://localhost")
		t.Setenv("AI_GATEWAY_API_KEY", "test-key")
		t.Setenv("AUTH_SECRET", "                                ")

		_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "AUTH_SECRET must be at least 32 characters")
	})

	t.Run("Validation - Missing AUTH_SECRET Uses Development Default", func(t *testing.T) {
		unsetEnvForTest(t, "AUTH_SECRET")
		t.Setenv("DATABASE_URL", "http://localhost")

		cfg, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
		require.NoError(t, err)
		assert.Equal(t, defaultAuthSecret, cfg.AuthSecret)
	})

	t.Run("Validation Error - Production Rejects Default AUTH_SECRET", func(t *testing.T) {
		t.Setenv("NODE_ENV", "production")
		t.Setenv("DATABASE_URL", "http://localhost")
		t.Setenv("AUTH_SECRET", defaultAuthSecret)

		_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), authSecretProductionError)
	})

	t.Run("Validation Error - Short INTERNAL_API_SECRET", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "http://localhost")
		t.Setenv("AI_GATEWAY_API_KEY", "test-key")
		t.Setenv("AUTH_SECRET", "this-is-a-very-long-secret-key-32-chars!")
		t.Setenv("INTERNAL_API_SECRET", "short")

		_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "INTERNAL_API_SECRET must be at least 32 characters")
	})

	t.Run("Skip Validation", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "")
		cfg, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: true, IsTestEnv: true})
		require.NoError(t, err)
		assert.Empty(t, cfg.DatabaseURL)
	})

	t.Run("Production Requires AUTH_SECRET Even When Validation Is Skipped", func(t *testing.T) {
		t.Setenv("NODE_ENV", "production")
		unsetEnvForTest(t, "AUTH_SECRET")

		_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: true, IsTestEnv: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), authSecretProductionError)
	})

	t.Run("Validation Error - Invalid URL", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "not-a-url")
		_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "must be a valid URL")
	})

	t.Run("Validation Error - Invalid URL Missing Host", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "http://")
		t.Setenv("AI_GATEWAY_API_KEY", "test-key")
		t.Setenv("AUTH_SECRET", "abcdefghijklmnopqrstuvwxyz123456")
		_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "DATABASE_URL must be a valid URL")
	})

	t.Run("Validation Error - Relative URL Rejected", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "localhost:5432")
		t.Setenv("AI_GATEWAY_API_KEY", "test-key")
		t.Setenv("AUTH_SECRET", "abcdefghijklmnopqrstuvwxyz123456")
		_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "DATABASE_URL must be a valid URL")
	})

	t.Run("Validation Error - Malformed URL Rejected", func(t *testing.T) {
		for _, value := range []string{
			"http://example.com%%zz",
			"http://[::1",
			"http://example.com/%zz",
		} {
			t.Run(value, func(t *testing.T) {
				t.Setenv("DATABASE_URL", value)
				t.Setenv("AI_GATEWAY_API_KEY", "test-key")
				t.Setenv("AUTH_SECRET", "abcdefghijklmnopqrstuvwxyz123456")
				_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
				require.Error(t, err)
				assert.Contains(t, err.Error(), "DATABASE_URL must be a valid URL")
			})
		}
	})

	t.Run("Validation Error - Algorithm", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "http://localhost")
		t.Setenv("AI_GATEWAY_API_KEY", "key")
		t.Setenv("CACHE_HASH_ALGORITHM", "md5")
		_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "CACHE_HASH_ALGORITHM must be 'sha1' or 'sha256'")
	})

	t.Run("Validation - Missing AI Gateway Key is Allowed", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "http://localhost")
		t.Setenv("AI_GATEWAY_API_KEY", "")
		t.Setenv("AUTH_SECRET", "this-is-a-very-long-secret-key-32-chars!")

		cfg, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
		require.NoError(t, err)
		assert.Empty(t, cfg.AIGatewayAPIKey)
	})

	t.Run("Boolean Parsing - Accepts yes", func(t *testing.T) {
		t.Setenv("OLLAMA_ENABLED", "yes")
		cfg, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: true, IsTestEnv: true})
		require.NoError(t, err)
		assert.True(t, cfg.OllamaEnabled)
	})

	t.Run("Boolean Parsing - Accepts false-like values", func(t *testing.T) {
		t.Setenv("OLLAMA_ENABLED", "no")
		cfg, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: true, IsTestEnv: true})
		require.NoError(t, err)
		assert.False(t, cfg.OllamaEnabled)
	})

	t.Run("Boolean Parsing - Invalid String Returns Parse Error", func(t *testing.T) {
		t.Setenv("OLLAMA_ENABLED", "not-a-bool")
		_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: true, IsTestEnv: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "invalid boolean-like value")
	})

	t.Run("Validation Error - Invalid NODE_ENV", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "http://localhost")
		t.Setenv("NODE_ENV", "invalid")
		_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "NODE_ENV must be one of")
	})

	t.Run("Validation Error - Invalid Optional URL", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "http://localhost")
		t.Setenv("REDIS_URL", "not-a-url")
		_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "REDIS_URL must be a valid URL")
	})

	t.Run("Validation Error - Invalid Optional Service URLs", func(t *testing.T) {
		cases := []struct {
			key string
		}{
			{key: "VERCEL_AI_GATEWAY_URL"},
			{key: "AUTH_URL"},
			{key: "REDIS_KV_URL"},
			{key: "TASKFORCEAI_DASHBOARD_URL"},
			{key: "TASKFORCEAI_BILLING_URL"},
		}

		for _, tc := range cases {
			t.Run(tc.key, func(t *testing.T) {
				t.Setenv("DATABASE_URL", "http://localhost")
				t.Setenv("AUTH_SECRET", "a-secret-that-is-at-least-32-chars!!")
				t.Setenv(tc.key, "http://")

				_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.key+" must be a valid URL")
			})
		}
	})

	t.Run("Validation Error - Invalid Microservice URL", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "http://localhost")
		t.Setenv("AI_GATEWAY_API_KEY", "key")
		t.Setenv("AUTH_SECRET", "a-secret-that-is-at-least-32-chars!!")
		t.Setenv("AUTH_SERVICE_URL", "http://")
		_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "AUTH_SERVICE_URL must be a valid URL")
	})

	t.Run("Validation - Valid SHA256", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "http://localhost")
		t.Setenv("AI_GATEWAY_API_KEY", "key")
		t.Setenv("CACHE_HASH_ALGORITHM", "sha256")
		t.Setenv("AUTH_SECRET", "a-secret-that-is-at-least-32-chars!!")
		cfg, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
		require.NoError(t, err)
		assert.Equal(t, "sha256", cfg.CacheHashAlgorithm)
	})

	t.Run("Env File Loading Error - Missing Explicit File", func(t *testing.T) {
		_, err := LoadWebEnv(LoadWebEnvOptions{EnvFile: "non-existent-.env", SkipValidation: true, IsTestEnv: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to load env file")
	})

	t.Run("Parse Error - Invalid Int", func(t *testing.T) {
		t.Setenv("DAYTONA_SANDBOX_POOL_SIZE", "not-an-int")
		_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: true, IsTestEnv: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "parse error on field")
	})

	t.Run("Parse Error - Negative Sandbox Pool Size", func(t *testing.T) {
		t.Setenv("DAYTONA_SANDBOX_POOL_SIZE", "-8")
		_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: true, IsTestEnv: true})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "DaytonaSandboxPoolSize")
		assert.Contains(t, err.Error(), "greater than or equal to 0")
	})

	t.Run("Parse Error - Invalid Boolean Flags", func(t *testing.T) {
		cases := []struct {
			key   string
			field string
		}{
			{key: "ENABLE_PAYMENTS", field: "EnablePayments"},
			{key: "TASKFORCEAI_API_IN_MEMORY", field: "TaskForceAIAPIInMemory"},
			{key: "DISABLE_RATE_LIMITER_MEMORY_FALLBACK", field: "DisableRateLimiterMemoryFallback"},
			{key: "TASKFORCEAI_MOCK_ORCHESTRATION", field: "TaskForceAIMockOrchestration"},
			{key: "TASKFORCEAI_ENABLE_PERF_BUFFER", field: "TaskForceAIEnablePerfBuffer"},
		}

		for _, tc := range cases {
			t.Run(tc.key, func(t *testing.T) {
				t.Setenv(tc.key, "maybe")

				_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: true, IsTestEnv: true})
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.field)
				assert.Contains(t, err.Error(), "invalid boolean-like value")
			})
		}
	})

	t.Run("Validation - Other Optional URLs", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "http://localhost")
		t.Setenv("AI_GATEWAY_API_KEY", "key")
		t.Setenv("REDIS_KV_URL", "redis://localhost")
		t.Setenv("AUTH_SECRET", "a-secret-that-is-at-least-32-chars!!")
		cfg, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: true})
		require.NoError(t, err)
		assert.Equal(t, "redis://localhost", cfg.RedisKVURL)
	})
}

func TestParseWebEnvMatchesEnvTags(t *testing.T) {
	clearWebEnvForTest(t)

	cfgType := reflect.TypeFor[WebEnv]()
	expectedByField := make(map[string]any, cfgType.NumField())
	for field := range cfgType.Fields() {
		key := field.Tag.Get("env")
		if key == "" {
			continue
		}

		raw, expected := roundTripValueForEnvField(t, field)
		t.Setenv(key, raw)
		expectedByField[field.Name] = expected
	}

	var cfg WebEnv
	require.NoError(t, parseWebEnv(&cfg))

	cfgValue := reflect.ValueOf(cfg)
	for field := range cfgType.Fields() {
		expected, ok := expectedByField[field.Name]
		if !ok {
			continue
		}

		actual := cfgValue.FieldByIndex(field.Index).Interface()
		assert.Equalf(t, expected, actual, "%s (%s)", field.Name, field.Tag.Get("env"))
	}
}

func TestParseWebEnvDefaultsMatchEnvDefaultTags(t *testing.T) {
	clearWebEnvForTest(t)

	var cfg WebEnv
	require.NoError(t, parseWebEnv(&cfg))

	cfgType := reflect.TypeFor[WebEnv]()
	cfgValue := reflect.ValueOf(cfg)
	for field := range cfgType.Fields() {
		rawDefault, ok := field.Tag.Lookup("envDefault")
		if !ok {
			continue
		}

		expected := defaultValueForEnvField(t, field, rawDefault)
		actual := cfgValue.FieldByIndex(field.Index).Interface()
		assert.Equalf(t, expected, actual, "%s envDefault tag", field.Name)
	}
}

func roundTripValueForEnvField(t *testing.T, field reflect.StructField) (string, any) {
	t.Helper()

	switch field.Type.Kind() {
	case reflect.String:
		raw := "value-for-" + field.Tag.Get("env")
		return raw, raw
	case reflect.Int:
		return "7", 7
	case reflect.Bool:
		return "true", true
	default:
		t.Fatalf("unsupported env field type for %s: %s", field.Name, field.Type)
		return "", nil
	}
}

func defaultValueForEnvField(t *testing.T, field reflect.StructField, rawDefault string) any {
	t.Helper()

	switch field.Type.Kind() {
	case reflect.String:
		return rawDefault
	case reflect.Int:
		value, err := strconv.Atoi(rawDefault)
		require.NoError(t, err, "%s envDefault must parse as int", field.Name)
		return value
	case reflect.Bool:
		value, err := parseFlexibleBool(rawDefault)
		require.NoError(t, err, "%s envDefault must parse as bool", field.Name)
		return value
	default:
		t.Fatalf("unsupported envDefault field type for %s: %s", field.Name, field.Type)
		return nil
	}
}

func TestLoadWebEnvOutsideTestsIgnoresMissingDefaultEnvFile(t *testing.T) {
	clearWebEnvForTest(t)
	t.Cleanup(resetCachedWebEnvForTest)
	unsetEnvForTest(t, "VERCEL")

	prevDir, err := os.Getwd()
	require.NoError(t, err)
	tempDir := t.TempDir()
	require.NoError(t, os.Chdir(tempDir))
	t.Cleanup(func() {
		require.NoError(t, os.Chdir(prevDir))
	})

	cfg, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: true, IsTestEnv: false})
	require.NoError(t, err)
	assert.Equal(t, "development", cfg.NodeEnv)
	assert.Equal(t, defaultAuthSecret, cfg.AuthSecret)
}

func TestLoadWebEnvConcurrentCacheAccess(t *testing.T) {
	resetCachedWebEnvForTest()
	t.Cleanup(resetCachedWebEnvForTest)

	t.Setenv("VERCEL", "1")
	t.Setenv("DAYTONA_SANDBOX_POOL_SIZE", "0")

	const workers = 32
	const iterationsPerWorker = 200

	errCh := make(chan error, workers*iterationsPerWorker)
	var wg sync.WaitGroup

	for i := range workers {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			for j := range iterationsPerWorker {
				cfg, err := LoadWebEnv(LoadWebEnvOptions{
					SkipValidation: true,
					IsTestEnv:      false,
				})
				if err != nil {
					errCh <- fmt.Errorf("worker %d iteration %d: %w", worker, j, err)
					return
				}
				if cfg == nil {
					errCh <- fmt.Errorf("worker %d iteration %d: nil config", worker, j)
					return
				}
			}
		}(i)
	}

	wg.Wait()
	close(errCh)

	for err := range errCh {
		assert.NoError(t, err)
	}
}

func TestLoadWebEnvCacheInvalidatesOnEnvChange(t *testing.T) {
	resetCachedWebEnvForTest()
	t.Cleanup(resetCachedWebEnvForTest)

	t.Setenv("VERCEL", "1")
	t.Setenv("DATABASE_URL", "http://first.example")
	t.Setenv("AI_GATEWAY_API_KEY", "first-key")
	t.Setenv("AUTH_SECRET", "abcdefghijklmnopqrstuvwxyz123456")

	first, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: false})
	require.NoError(t, err)
	assert.Equal(t, "http://first.example", first.DatabaseURL)

	t.Setenv("DATABASE_URL", "http://second.example")
	t.Setenv("AI_GATEWAY_API_KEY", "second-key")

	second, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: true, IsTestEnv: false})
	require.NoError(t, err)
	assert.Equal(t, "http://second.example", second.DatabaseURL)
	assert.Equal(t, "second-key", second.AIGatewayAPIKey)
}

func TestLoadWebEnvCacheReturnsIsolatedCopies(t *testing.T) {
	resetCachedWebEnvForTest()
	t.Cleanup(resetCachedWebEnvForTest)

	t.Setenv("VERCEL", "1")
	t.Setenv("DATABASE_URL", "http://cached.example")
	t.Setenv("AI_GATEWAY_API_KEY", "cached-key")
	t.Setenv("AUTH_SECRET", "abcdefghijklmnopqrstuvwxyz123456")

	first, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: false})
	require.NoError(t, err)
	first.DatabaseURL = "http://mutated-first.example"
	first.AIGatewayAPIKey = "mutated-first-key"

	second, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: true, IsTestEnv: false})
	require.NoError(t, err)
	assert.Equal(t, "http://cached.example", second.DatabaseURL)
	assert.Equal(t, "cached-key", second.AIGatewayAPIKey)

	second.DatabaseURL = "http://mutated-second.example"
	second.AIGatewayAPIKey = "mutated-second-key"

	third, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: true, IsTestEnv: false})
	require.NoError(t, err)
	assert.Equal(t, "http://cached.example", third.DatabaseURL)
	assert.Equal(t, "cached-key", third.AIGatewayAPIKey)
}

func TestLoadWebEnvLoadsExplicitEnvFile(t *testing.T) {
	t.Cleanup(resetCachedWebEnvForTest)

	envFile := filepath.Join(t.TempDir(), ".env")
	err := os.WriteFile(
		envFile,
		[]byte("DATABASE_URL=http://file.example\nAUTH_SECRET=abcdefghijklmnopqrstuvwxyz123456\nAI_GATEWAY_API_KEY=file-key\n"),
		0o600,
	)
	require.NoError(t, err)

	cfg, err := LoadWebEnv(LoadWebEnvOptions{EnvFile: envFile, SkipValidation: false, IsTestEnv: true})
	require.NoError(t, err)
	assert.Equal(t, "http://file.example", cfg.DatabaseURL)
	assert.Equal(t, "file-key", cfg.AIGatewayAPIKey)
}

func TestLoadWebEnvWrapsParseErrorsOutsideTests(t *testing.T) {
	resetCachedWebEnvForTest()
	t.Cleanup(resetCachedWebEnvForTest)

	t.Setenv("VERCEL", "1")
	t.Setenv("OLLAMA_ENABLED", "not-a-bool")

	_, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: true, IsTestEnv: false})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to parse environment variables")
	assert.Contains(t, err.Error(), "invalid boolean-like value")
}

func TestStoreCachedWebEnvIgnoresNilConfig(t *testing.T) {
	resetCachedWebEnvForTest()
	t.Cleanup(resetCachedWebEnvForTest)

	snapshot, snapshotLen := captureWebEnvSnapshot()
	storeCachedWebEnv(nil, snapshot, snapshotLen)

	assert.Nil(t, loadCachedWebEnvForCurrentEnv())
}

func TestEnvVariableKeysForTypeSkipsUntaggedFields(t *testing.T) {
	type sampleEnv struct {
		Kept     string `env:"KEPT"`
		Skipped  string
		AlsoKept string `env:"ALSO_KEPT"`
	}

	assert.Equal(t, []string{"KEPT", "ALSO_KEPT"}, envVariableKeysForType(reflect.TypeFor[sampleEnv]()))
}

func TestCaptureWebEnvSnapshotForKeysPanicsWhenTooManyKeys(t *testing.T) {
	keys := make([]string, maxWebEnvSnapshotEntries+1)
	for i := range keys {
		keys[i] = fmt.Sprintf("SNAPSHOT_KEY_%d", i)
	}

	assert.PanicsWithValue(
		t,
		"WebEnv has more fields than the env snapshot cache supports",
		func() { _, _ = captureWebEnvSnapshotForKeys(keys) },
	)
}

func TestWebEnvSnapshotMatchesCurrentEnvRejectsLengthMismatch(t *testing.T) {
	snapshot, snapshotLen := captureWebEnvSnapshot()

	assert.False(t, webEnvSnapshotMatchesCurrentEnv(&snapshot, snapshotLen+1))
}

func TestValidateWebEnvRejectsEmptyRequiredURL(t *testing.T) {
	cfg := WebEnv{
		NodeEnv:             "development",
		CacheHashAlgorithm:  "sha1",
		AuthServiceURL:      "",
		BillingServiceURL:   "http://billing.example",
		DeveloperServiceURL: "http://developer.example",
		CoreServiceURL:      "http://core.example",
		EngineServiceURL:    "http://engine.example",
		SyncServiceURL:      "http://sync.example",
	}

	err := validateWebEnv(&cfg)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "AUTH_SERVICE_URL must be a valid URL (got empty)")
}

func TestValidateWebEnvRejectsNegativeDaytonaSandboxPoolSize(t *testing.T) {
	cfg := WebEnv{
		NodeEnv:                "development",
		CacheHashAlgorithm:     "sha1",
		DaytonaSandboxPoolSize: -1,
		AuthServiceURL:         "http://auth.example",
		BillingServiceURL:      "http://billing.example",
		DeveloperServiceURL:    "http://developer.example",
		CoreServiceURL:         "http://core.example",
		EngineServiceURL:       "http://engine.example",
		SyncServiceURL:         "http://sync.example",
	}

	err := validateWebEnv(&cfg)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "DAYTONA_SANDBOX_POOL_SIZE must be greater than or equal to 0")
}

func TestURLPredicatesCoverSchemeAndHostEdges(t *testing.T) {
	assert.True(t, isURLScheme("HTTPS+v1.2"))
	assert.False(t, isURLScheme("1https"))
	assert.False(t, isURLScheme("http_ssh"))
	assert.True(t, hostHasWhitespace("example.com\t"))
	assert.True(t, hostHasWhitespace("example.com\r\n"))
	assert.False(t, hostHasWhitespace("example.com"))
	assert.False(t, parsedURLHasSchemeAndHost(&url.URL{Scheme: "https", Host: "example.com "}))
	assert.False(t, hasURLSchemeAndHost("https://"))
	assert.False(t, hasURLSchemeAndHost("http://:443"))
	assert.Contains(t, invalidBooleanValueTemplate, "expected true/false")
}

func TestGetServiceURLs(t *testing.T) {
	cfg := WebEnv{
		AuthServiceURL:      "http://auth.example",
		BillingServiceURL:   "http://billing.example",
		DeveloperServiceURL: "http://developer.example",
		CoreServiceURL:      "http://core.example",
		EngineServiceURL:    "http://engine.example",
		SyncServiceURL:      "http://sync.example",
	}

	assert.Equal(t, ServiceURLs{
		Auth:      "http://auth.example",
		Billing:   "http://billing.example",
		Developer: "http://developer.example",
		Core:      "http://core.example",
		Engine:    "http://engine.example",
		Sync:      "http://sync.example",
	}, cfg.GetServiceURLs())
}

func setBenchmarkWebEnv(b *testing.B) {
	b.Helper()

	b.Setenv("VERCEL", "1")
	b.Setenv("NODE_ENV", "production")
	b.Setenv("DATABASE_URL", "https://db.example")
	b.Setenv("AI_GATEWAY_API_KEY", "gateway-key")
	b.Setenv("VERCEL_AI_GATEWAY_URL", "https://gateway.example")
	b.Setenv("AUTH_SECRET", "a-secret-that-is-at-least-32-chars!!")
	b.Setenv("AUTH_URL", "https://auth.example")
	b.Setenv("GOOGLE_CLIENT_ID", "google-client-id")
	b.Setenv("GOOGLE_CLIENT_SECRET", "google-client-secret")
	b.Setenv("DAYTONA_API_KEY", "daytona-api-key")
	b.Setenv("DAYTONA_JWT_TOKEN", "daytona-jwt-token")
	b.Setenv("DAYTONA_ORGANIZATION_ID", "daytona-org")
	b.Setenv("BRAVE_SEARCH_API_KEY", "brave-key")
	b.Setenv("REDIS_URL", "redis://localhost:6379")
	b.Setenv("REDIS_KV_URL", "redis://localhost:6380")
	b.Setenv("DAYTONA_SANDBOX_POOL_SIZE", "8")
	b.Setenv("INNGEST_EVENT_KEY", "inngest-event")
	b.Setenv("INNGEST_SIGNING_KEY", "inngest-signing")
	b.Setenv("INTERNAL_API_SECRET", "internal-secret-that-is-at-least-32-chars")
	b.Setenv("STRIPE_SECRET_KEY", "stripe-secret")
	b.Setenv("STRIPE_WEBHOOK_SECRET", "stripe-webhook")
	b.Setenv("STRIPE_PRO_PRICE_ID", "stripe-pro")
	b.Setenv("STRIPE_SUPER_PRICE_ID", "stripe-super")
	b.Setenv("REVENUECAT_SECRET_KEY", "revenuecat-secret")
	b.Setenv("REVENUECAT_WEBHOOK_SECRET", "revenuecat-webhook")
	b.Setenv("REVENUECAT_ENTITLEMENT_PRO", "pro")
	b.Setenv("REVENUECAT_ENTITLEMENT_SUPER", "super")
	b.Setenv("APP_STORE_PRO_PRODUCT_ID", "app-pro")
	b.Setenv("PLAY_STORE_PRO_PRODUCT_ID", "play-pro")
	b.Setenv("APP_STORE_SUPER_PRODUCT_ID", "app-super")
	b.Setenv("PLAY_STORE_SUPER_PRODUCT_ID", "play-super")
	b.Setenv("ENABLE_PAYMENTS", "true")
	b.Setenv("TASKFORCEAI_API_IN_MEMORY", "false")
	b.Setenv("DISABLE_RATE_LIMITER_MEMORY_FALLBACK", "false")
	b.Setenv("TASKFORCEAI_MOCK_ORCHESTRATION", "false")
	b.Setenv("CACHE_HASH_ALGORITHM", "sha256")
	b.Setenv("TASKFORCEAI_ENABLE_PERF_BUFFER", "true")
	b.Setenv("BUN_TEST", "0")
	b.Setenv("VITEST", "0")
	b.Setenv("RESEND_API_KEY", "resend-key")
	b.Setenv("RESEND_FROM_EMAIL", "noreply@example.com")
	b.Setenv("RESEND_SUPPORT_EMAIL", "support@example.com")
	b.Setenv("TASKFORCEAI_DASHBOARD_URL", "https://dashboard.example")
	b.Setenv("TASKFORCEAI_BILLING_URL", "https://billing.example")
	b.Setenv("ENCRYPTION_KEY", "encryption-key")
	b.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")
	b.Setenv("ALLOWED_ORIGINS", "https://app.example")
	b.Setenv("JWT_SECRET", "jwt-secret")
	b.Setenv("LOG_LEVEL", "info")
	b.Setenv("OLLAMA_ENABLED", "false")
	b.Setenv("OLLAMA_MODEL", "llama3")
	b.Setenv("AUTH_SERVICE_URL", "https://auth-service.example")
	b.Setenv("BILLING_SERVICE_URL", "https://billing-service.example")
	b.Setenv("DEVELOPER_SERVICE_URL", "https://developer-service.example")
	b.Setenv("CORE_SERVICE_URL", "https://core-service.example")
	b.Setenv("ENGINE_SERVICE_URL", "https://engine-service.example")
	b.Setenv("SYNC_SERVICE_URL", "https://sync-service.example")
}

func BenchmarkLoadWebEnvColdValidated(b *testing.B) {
	setBenchmarkWebEnv(b)
	b.ReportAllocs()

	for b.Loop() {
		resetCachedWebEnvForTest()
		cfg, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: false})
		if err != nil {
			b.Fatal(err)
		}
		if cfg.DatabaseURL == "" {
			b.Fatal("missing database URL")
		}
	}
}

func BenchmarkLoadWebEnvCachedSkipValidation(b *testing.B) {
	setBenchmarkWebEnv(b)
	resetCachedWebEnvForTest()
	b.Cleanup(resetCachedWebEnvForTest)

	cfg, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: false, IsTestEnv: false})
	require.NoError(b, err)
	require.NotNil(b, cfg)
	b.ReportAllocs()
	b.ResetTimer()

	for b.Loop() {
		cfg, err := LoadWebEnv(LoadWebEnvOptions{SkipValidation: true, IsTestEnv: false})
		if err != nil {
			b.Fatal(err)
		}
		if cfg.DatabaseURL == "" {
			b.Fatal("missing database URL")
		}
	}
}
