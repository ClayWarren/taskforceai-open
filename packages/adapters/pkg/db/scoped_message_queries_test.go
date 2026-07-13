package db

import (
	"strings"
	"testing"
)

func TestScopedMessageQueriesUseUserScopeOnlyForPersonalRows(t *testing.T) {
	for name, query := range map[string]string{
		"GetMessageByMessageIDScoped": getMessageByMessageIDScoped,
		"GetMessageVersionScoped":     getMessageVersionScoped,
		"UpdateMessageSync":           updateMessageSync,
	} {
		normalized := normalizeSQLForScopeTest(query)
		personalBranch := "$2::int is null and c.organization_id is null and c.user_id = $3::text"
		if name == "UpdateMessageSync" {
			personalBranch = "$15::int is null and organization_id is null and user_id = $16::text"
		}
		if !strings.Contains(normalized, personalBranch) {
			t.Fatalf("%s must keep personal rows scoped by user_id; query=%s", name, normalized)
		}

		orgBranch := "$2::int is not null and c.organization_id = $2"
		if name == "UpdateMessageSync" {
			orgBranch = "$15::int is not null and organization_id = $15"
		}
		if !strings.Contains(normalized, orgBranch) {
			t.Fatalf("%s must allow org rows by organization_id without owner user_id; query=%s", name, normalized)
		}
	}
}

func normalizeSQLForScopeTest(query string) string {
	return strings.Join(strings.Fields(strings.ToLower(query)), " ")
}
