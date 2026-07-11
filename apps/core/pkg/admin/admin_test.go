package admin

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestAdminDashboardCounts_Struct(t *testing.T) {
	counts := AdminDashboardCounts{
		TotalUsers:         1000,
		ActiveUsers24h:     150,
		FreeUsers:          600,
		ProUsers:           350,
		SuperUsers:         50,
		TotalConversations: 50000,
	}

	assert.Equal(t, 1000, counts.TotalUsers)
	assert.Equal(t, 150, counts.ActiveUsers24h)
	assert.Equal(t, 600, counts.FreeUsers)
	assert.Equal(t, 350, counts.ProUsers)
	assert.Equal(t, 50, counts.SuperUsers)
	assert.Equal(t, 50000, counts.TotalConversations)
}

func TestAdminDashboardUser_Struct(t *testing.T) {
	user := AdminDashboardUser{
		ID:                1,
		Email:             "test@example.com",
		IsAdmin:           false,
		CancelAtPeriodEnd: true,
		Disabled:          true,
	}

	assert.Equal(t, 1, user.ID)
	assert.Equal(t, "test@example.com", user.Email)
	assert.False(t, user.IsAdmin)
	assert.True(t, user.CancelAtPeriodEnd)
	assert.True(t, user.Disabled)
}

func TestAdminUsersPage_Struct(t *testing.T) {
	page := AdminUsersPage{
		Users: []AdminDashboardUser{
			{ID: 1, Email: "user1@example.com"},
			{ID: 2, Email: "user2@example.com"},
		},
		Total: 100,
	}

	assert.Len(t, page.Users, 2)
	assert.Equal(t, 100, page.Total)
}

func TestConversationAggregate_Struct(t *testing.T) {
	avg := 2.5
	max := 10.0
	sum := 1000

	agg := ConversationAggregate{
		Count: 500,
		Avg:   &avg,
		Max:   &max,
		Sum:   &sum,
	}

	assert.Equal(t, 500, agg.Count)
	assert.Equal(t, &avg, agg.Avg)
	assert.Equal(t, &max, agg.Max)
	assert.Equal(t, &sum, agg.Sum)
}

func TestModelUsageEntry_Struct(t *testing.T) {
	entry := ModelUsageEntry{
		Model: "gpt-4",
		Count: 1000,
	}

	assert.Equal(t, "gpt-4", entry.Model)
	assert.Equal(t, 1000, entry.Count)
}

func TestSlowConversation_Struct(t *testing.T) {
	execTime := 15.5
	userID := "user-123"
	now := time.Now()

	conv := SlowConversation{
		ID:            1,
		ExecutionTime: &execTime,
		UserID:        &userID,
		Timestamp:     now,
	}

	assert.Equal(t, 1, conv.ID)
	assert.Equal(t, &execTime, conv.ExecutionTime)
	assert.Equal(t, &userID, conv.UserID)
	assert.Equal(t, now, conv.Timestamp)
}

func TestPlanCountEntry_Struct(t *testing.T) {
	entry := PlanCountEntry{
		Plan:  "pro",
		Count: 500,
	}

	assert.Equal(t, "pro", entry.Plan)
	assert.Equal(t, 500, entry.Count)
}

func TestTopUserEntry_Struct(t *testing.T) {
	entry := TopUserEntry{
		ID:           1,
		Email:        "power@example.com",
		Plan:         "pro",
		MessageCount: 10000,
	}

	assert.Equal(t, 1, entry.ID)
	assert.Equal(t, "power@example.com", entry.Email)
	assert.Equal(t, "pro", entry.Plan)
	assert.Equal(t, 10000, entry.MessageCount)
}

func TestTokenAggregate_Struct(t *testing.T) {
	prompt := 1000000
	completion := 500000
	total := 1500000
	cost := 75.50

	agg := TokenAggregate{
		PromptTokens:     &prompt,
		CompletionTokens: &completion,
		TotalTokens:      &total,
		CostMicros:       &cost,
	}

	assert.Equal(t, &prompt, agg.PromptTokens)
	assert.Equal(t, &completion, agg.CompletionTokens)
	assert.Equal(t, &total, agg.TotalTokens)
	assert.Equal(t, &cost, agg.CostMicros)
}

func TestTokensByModelEntry_Struct(t *testing.T) {
	tokens := 500000
	cost := 25.0

	entry := TokensByModelEntry{
		Model:       "gpt-4",
		TotalTokens: &tokens,
		CostMicros:  &cost,
	}

	assert.Equal(t, "gpt-4", entry.Model)
	assert.Equal(t, &tokens, entry.TotalTokens)
	assert.Equal(t, &cost, entry.CostMicros)
}

func TestToolUsageEntry_Struct(t *testing.T) {
	sumDur := 5000.0
	avgDur := 50.0

	entry := ToolUsageEntry{
		ToolName:    "code_execution",
		Count:       100,
		SumDuration: &sumDur,
		AvgDuration: &avgDur,
	}

	assert.Equal(t, "code_execution", entry.ToolName)
	assert.Equal(t, 100, entry.Count)
	assert.Equal(t, &sumDur, entry.SumDuration)
	assert.Equal(t, &avgDur, entry.AvgDuration)
}

func TestToolSuccessEntry_Struct(t *testing.T) {
	entry := ToolSuccessEntry{
		ToolName: "web_search",
		Success:  true,
		Count:    90,
	}

	assert.Equal(t, "web_search", entry.ToolName)
	assert.True(t, entry.Success)
	assert.Equal(t, 90, entry.Count)
}

func TestAdminAuditUser_Struct(t *testing.T) {
	user := AdminAuditUser{
		ID:      1,
		IsAdmin: true,
	}

	assert.Equal(t, 1, user.ID)
	assert.True(t, user.IsAdmin)
}

func TestAuditLogRecord_Struct(t *testing.T) {
	now := time.Now()
	userID := "user-1"
	resourceID := "conv-123"
	ip := "192.168.1.1"
	ua := "Mozilla/5.0"
	errMsg := "Access denied"

	record := AuditLogRecord{
		ID:           1,
		Timestamp:    now,
		UserID:       &userID,
		Action:       "DELETE",
		Resource:     "conversation",
		ResourceID:   &resourceID,
		IPAddress:    &ip,
		UserAgent:    &ua,
		Details:      map[string]string{"reason": "test"},
		Success:      false,
		ErrorMessage: &errMsg,
	}

	assert.Equal(t, 1, record.ID)
	assert.Equal(t, now, record.Timestamp)
	assert.Equal(t, &userID, record.UserID)
	assert.Equal(t, "DELETE", record.Action)
	assert.Equal(t, "conversation", record.Resource)
	assert.False(t, record.Success)
	assert.Equal(t, &errMsg, record.ErrorMessage)
}

func TestAuditLogFilters_Struct(t *testing.T) {
	userID := "user-1"
	action := "LOGIN"
	resource := "session"
	start := time.Now().Add(-24 * time.Hour)
	end := time.Now()

	filters := AuditLogFilters{
		UserID:    &userID,
		Action:    &action,
		Resource:  &resource,
		StartDate: &start,
		EndDate:   &end,
	}

	assert.Equal(t, &userID, filters.UserID)
	assert.Equal(t, &action, filters.Action)
	assert.Equal(t, &resource, filters.Resource)
	assert.Equal(t, &start, filters.StartDate)
	assert.Equal(t, &end, filters.EndDate)
}

func TestAuditLogPage_Struct(t *testing.T) {
	page := AuditLogPage{
		Logs: []AuditLogRecord{
			{ID: 1, Action: "LOGIN"},
			{ID: 2, Action: "LOGOUT"},
		},
		Total: 200,
	}

	assert.Len(t, page.Logs, 2)
	assert.Equal(t, 200, page.Total)
}

func TestAdminInsightsData_Struct(t *testing.T) {
	data := AdminInsightsData{
		ActiveUsers24h:        100,
		Messages24h:           5000,
		ConversationAggregate: ConversationAggregate{Count: 500},
		ModelUsage:            []ModelUsageEntry{},
		SlowestConversations:  []SlowConversation{},
		InProgress:            10,
		PlanCounts:            []PlanCountEntry{},
		TopUsers:              []TopUserEntry{},
		Tokens24h:             TokenAggregate{},
		TokensByModel:         []TokensByModelEntry{},
		ToolUsage:             []ToolUsageEntry{},
		ToolSuccess:           []ToolSuccessEntry{},
	}

	assert.Equal(t, 100, data.ActiveUsers24h)
	assert.Equal(t, 5000, data.Messages24h)
	assert.Equal(t, 10, data.InProgress)
}
