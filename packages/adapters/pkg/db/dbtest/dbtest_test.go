package dbtest_test

import (
	"math/big"
	"reflect"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5/pgtype"
)

// TestUserColumnsMatchesModel guards against drift between UserColumns and the
// sqlc-generated db.User struct. If a column is added to or removed from the
// users table (regenerating models.go), this test fails until UserColumns is
// updated to match, keeping every mock-based test in sync from one place.
func TestUserColumnsMatchesModel(t *testing.T) {
	if got, want := len(dbtest.UserColumns()), reflect.TypeFor[db.User]().NumField(); got != want {
		t.Fatalf("UserColumns has %d entries but db.User has %d fields; update UserColumns to match the schema", got, want)
	}
}

// TestUserColumnsReturnsFreshSlice ensures callers can mutate the result
// without affecting other callers.
func TestUserColumnsReturnsFreshSlice(t *testing.T) {
	a := dbtest.UserColumns()
	a[0] = "mutated"
	if dbtest.UserColumns()[0] != "id" {
		t.Fatal("UserColumns must return a fresh slice on each call")
	}
}

func TestUserValuesDefaultBaseline(t *testing.T) {
	memory := false
	trustLayer := true
	quickMode := true
	customerID := "cus_123"
	source := db.SubscriptionSourceSTRIPE
	credit := pgtype.Numeric{Int: big.NewInt(2500), Exp: -2, Valid: true}

	values := valuesByColumn(t, dbtest.UserColumns(), dbtest.UserValues(dbtest.User{
		ID:         7,
		Email:      "user@example.com",
		Memory:     &memory,
		TrustLayer: &trustLayer,
		QuickMode:  &quickMode,
		APITier:    db.DeveloperApiTierPRO,
		Billing: &dbtest.UserBilling{
			SubscriptionSource:  source,
			CustomerID:          &customerID,
			CreditBalance:       credit,
			AutoRechargeEnabled: true,
		},
	}))

	assertEqual(t, values["id"], int32(7))
	assertEqual(t, values["email"], "user@example.com")
	assertEqual(t, values["theme_preference"], "dark")
	assertEqual(t, values["plan"], "free")
	assertEqual(t, values["memory_enabled"], false)
	assertEqual(t, values["web_search_enabled"], true)
	assertEqual(t, values["trust_layer_enabled"], true)
	assertEqual(t, values["quick_mode_enabled"], true)
	assertEqual(t, values["subscription_source"], source)
	assertEqual(t, values["customer_id"], &customerID)
	assertEqual(t, values["api_tier"], db.DeveloperApiTierPRO)
	assertEqual(t, values["credit_balance"], credit)
	assertEqual(t, values["auto_recharge_enabled"], true)
	assertTimestampValid(t, values["last_message_timestamp"], true)
}

func TestUserValuesBillingBaseline(t *testing.T) {
	defaultValues := valuesByColumn(t, dbtest.UserColumns(), dbtest.UserValues(dbtest.User{
		ID:       1,
		Email:    "billing@example.com",
		Baseline: dbtest.BaselineBilling,
	}))

	assertEqual(t, defaultValues["theme_preference"], "")
	assertEqual(t, defaultValues["plan"], "free")
	assertEqual(t, defaultValues["memory_enabled"], false)
	assertEqual(t, defaultValues["api_tier"], db.DeveloperApiTierSTARTER)
	assertTimestampValid(t, defaultValues["last_message_timestamp"], false)
	assertTimestampValid(t, defaultValues["reset_date"], false)

	paymentValues := valuesByColumn(t, dbtest.UserColumns(), dbtest.UserValues(dbtest.User{
		ID:            2,
		Email:         "payments@example.com",
		Baseline:      dbtest.BaselineBilling,
		PaymentsStyle: true,
	}))

	assertEqual(t, paymentValues["plan"], "")
	assertTimestampValid(t, paymentValues["last_message_timestamp"], true)
	assertTimestampValid(t, paymentValues["reset_date"], true)
	credit, ok := paymentValues["credit_balance"].(pgtype.Numeric)
	if !ok || !credit.Valid || credit.Int.Cmp(big.NewInt(0)) != 0 {
		t.Fatalf("expected payment-style zero credit balance, got %#v", paymentValues["credit_balance"])
	}

	apiTier := db.DeveloperApiTierPRO
	apiTierValues := valuesByColumn(t, dbtest.UserColumns(), dbtest.UserValues(dbtest.User{
		ID:       3,
		Email:    "tier@example.com",
		Baseline: dbtest.BaselineBilling,
		APITier:  &apiTier,
	}))
	assertEqual(t, apiTierValues["api_tier"], &apiTier)
}

func TestDeveloperBillingUserFixture(t *testing.T) {
	user := dbtest.DeveloperBillingUser(11, "dev@example.com", 500)
	values := valuesByColumn(t, dbtest.UserColumns(), dbtest.UserValues(user))

	assertEqual(t, values["id"], int32(11))
	assertEqual(t, values["email"], "dev@example.com")
	assertEqual(t, values["api_requests_limit"], int32(500))
	assertTimestampValid(t, values["api_current_period_start"], true)
	assertTimestampValid(t, values["api_current_period_end"], true)
}

func TestAPIKeyColumnsMatchesModel(t *testing.T) {
	if got, want := len(dbtest.APIKeyColumns()), reflect.TypeFor[db.DeveloperApiKey]().NumField(); got != want {
		t.Fatalf("APIKeyColumns has %d entries but db.DeveloperApiKey has %d fields", got, want)
	}
}

func TestAPIKeyValuesDefaults(t *testing.T) {
	values := valuesByColumn(t, dbtest.APIKeyColumns(), dbtest.APIKeyValues(dbtest.APIKey{
		ID:         3,
		UserID:     4,
		KeyHash:    "hash",
		DisplayKey: "tfai_123",
	}))

	assertEqual(t, values["id"], int32(3))
	assertEqual(t, values["user_id"], int32(4))
	assertEqual(t, values["tier"], db.DeveloperApiTierSTARTER)
	assertEqual(t, values["rate_limit"], int32(100))
	assertEqual(t, values["monthly_quota"], int32(1000))
	assertTimestampValid(t, values["created_at"], true)
	assertTimestampValid(t, values["updated_at"], false)
	assertTimestampValid(t, values["revoked_at"], false)
	assertTimestampValid(t, values["last_used_at"], false)

	handlerValues := valuesByColumn(t, dbtest.APIKeyColumns(), dbtest.APIKeyValues(dbtest.APIKey{
		ID:           5,
		UserID:       6,
		KeyHash:      "hash-2",
		DisplayKey:   "tfai_456",
		HandlerStyle: true,
	}))

	assertEqual(t, handlerValues["rate_limit"], int32(1000))
	assertEqual(t, handlerValues["monthly_quota"], int32(1_000_000))
	if _, ok := handlerValues["created_at"].(pgtype.Timestamp); ok {
		t.Fatal("handler-style API key created_at should use time.Time")
	}

	tier := db.DeveloperApiTierPRO
	tierValues := valuesByColumn(t, dbtest.APIKeyColumns(), dbtest.APIKeyValues(dbtest.APIKey{
		ID:      7,
		UserID:  8,
		KeyHash: "hash-3",
		Tier:    &tier,
	}))
	assertEqual(t, tierValues["tier"], &tier)
}

func TestConversationColumnsMatchesModel(t *testing.T) {
	if got, want := len(dbtest.ConversationColumns()), reflect.TypeFor[db.Conversation]().NumField(); got != want {
		t.Fatalf("ConversationColumns has %d entries but db.Conversation has %d fields", got, want)
	}
}

func TestConversationValuesDefaultsAndEngineFixture(t *testing.T) {
	values := valuesByColumn(t, dbtest.ConversationColumns(), dbtest.ConversationValues(dbtest.Conversation{ID: 9}))

	assertEqual(t, values["id"], int32(9))
	assertEqual(t, values["user_input"], "input")
	assertEqual(t, values["agent_count"], int32(1))
	assertEqual(t, values["vector_clock"], []byte("{}"))
	assertTimestampValid(t, values["timestamp"], true)
	assertTimestampValid(t, values["public_shared_at"], false)
	assertEqual(t, values["last_synced_at"], values["timestamp"])
	assertEqual(t, values["updated_at"], values["timestamp"])

	engineValues := valuesByColumn(t, dbtest.ConversationColumns(), dbtest.ConversationValues(dbtest.EngineConversation()))
	assertEqual(t, engineValues["user_input"], "prompt")
	assertEqual(t, engineValues["agent_count"], int32(3))
	assertEqual(t, engineValues["sync_version"], int32(1))
}

func TestMessageColumnsMatchesModel(t *testing.T) {
	if got, want := len(dbtest.MessageColumns()), reflect.TypeFor[db.Message]().NumField(); got != want {
		t.Fatalf("MessageColumns has %d entries but db.Message has %d fields", got, want)
	}
}

func TestMessageValuesDefaults(t *testing.T) {
	values := valuesByColumn(t, dbtest.MessageColumns(), dbtest.MessageValues(dbtest.Message{
		ID:             12,
		ConversationID: 34,
	}))

	assertEqual(t, values["id"], int32(12))
	assertEqual(t, values["message_id"], "msg-1")
	assertEqual(t, values["conversation_id"], int32(34))
	assertEqual(t, values["role"], "user")
	assertEqual(t, values["content"], "hello")
	assertEqual(t, values["sources"], []byte("[]"))
	assertEqual(t, values["tool_events"], []byte("[]"))
	assertEqual(t, values["agent_statuses"], []byte("[]"))
	assertEqual(t, values["vector_clock"], []byte("{}"))
	assertTimestampValid(t, values["created_at"], true)
	assertEqual(t, values["last_synced_at"], values["created_at"])
	assertEqual(t, values["updated_at"], values["created_at"])
}

func TestAuditLogColumnsMatchesModel(t *testing.T) {
	if got, want := len(dbtest.AuditLogColumns()), reflect.TypeFor[db.AuditLog]().NumField(); got != want {
		t.Fatalf("AuditLogColumns has %d entries but db.AuditLog has %d fields", got, want)
	}
}

func TestAuditLogValuesDefaults(t *testing.T) {
	values := valuesByColumn(t, dbtest.AuditLogColumns(), dbtest.AuditLogValues(dbtest.AuditLog{}))

	assertEqual(t, values["id"], int32(1))
	assertEqual(t, values["action"], "login")
	assertEqual(t, values["resource"], "user")
	assertEqual(t, values["details"], []byte("{}"))
	assertTimestampValid(t, values["timestamp"], true)
}

func TestRowsHelpersBuildRows(t *testing.T) {
	if dbtest.UserRow(dbtest.User{ID: 1, Email: "one@example.com"}) == nil {
		t.Fatal("expected user row")
	}
	if dbtest.UserRows(
		dbtest.User{ID: 1, Email: "one@example.com"},
		dbtest.User{ID: 2, Email: "two@example.com"},
	) == nil {
		t.Fatal("expected user rows")
	}
	if dbtest.APIKeyRow(dbtest.APIKey{ID: 1, UserID: 2}) == nil {
		t.Fatal("expected api key row")
	}
	if dbtest.APIKeyRows(dbtest.APIKey{ID: 1, UserID: 2}) == nil {
		t.Fatal("expected api key rows")
	}
	if dbtest.ConversationRow(dbtest.Conversation{ID: 1}) == nil {
		t.Fatal("expected conversation row")
	}
	if dbtest.ConversationRows(dbtest.Conversation{ID: 1}) == nil {
		t.Fatal("expected conversation rows")
	}
	if dbtest.MessageRow(dbtest.Message{ID: 1}) == nil {
		t.Fatal("expected message row")
	}
	if dbtest.MessageRows(dbtest.Message{ID: 1}) == nil {
		t.Fatal("expected message rows")
	}
	if dbtest.AuditLogRow(dbtest.AuditLog{ID: 1}) == nil {
		t.Fatal("expected audit log row")
	}
	if dbtest.AuditLogRows(dbtest.AuditLog{ID: 1}) == nil {
		t.Fatal("expected audit log rows")
	}
}

func TestMockPoolHelpers(t *testing.T) {
	if pool := dbtest.NewMockPool(t); pool == nil {
		t.Fatal("expected mock pool")
	}
	if pool := dbtest.NewMockPoolRegexp(t); pool == nil {
		t.Fatal("expected regexp mock pool")
	}
}

func valuesByColumn(t *testing.T, columns []string, values []any) map[string]any {
	t.Helper()
	if len(columns) != len(values) {
		t.Fatalf("columns length %d does not match values length %d", len(columns), len(values))
	}

	out := make(map[string]any, len(columns))
	for i, column := range columns {
		out[column] = values[i]
	}
	return out
}

func assertTimestampValid(t *testing.T, value any, valid bool) {
	t.Helper()
	ts, ok := value.(pgtype.Timestamp)
	if !ok {
		t.Fatalf("expected pgtype.Timestamp, got %T", value)
	}
	if ts.Valid != valid {
		t.Fatalf("expected timestamp valid=%v, got %v", valid, ts.Valid)
	}
}

func assertEqual(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}
