package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"sort"
	"testing"
	"time"

	"github.com/stripe/stripe-go/v82"
)

func BenchmarkStripeWebhookLatencyProfile(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	repo := &latencyWebhookRepository{
		processed: make(map[string]bool, b.N),
		user:      &WebhookUser{ID: 42, Email: "billing-benchmark@example.com"},
	}
	svc := NewWebhookService(WebhookDependencies{
		Repo:             repo,
		GetPlanByPriceID: proPlanByPriceID,
	})
	raw := latencySubscriptionRawPayload(b)
	samples := make([]time.Duration, 0, b.N)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		event := &stripe.Event{
			ID:      fmt.Sprintf("evt_latency_%d", i),
			Type:    "customer.subscription.updated",
			Created: 1_700_000_000,
			Data:    &stripe.EventData{Raw: raw},
		}
		startedAt := time.Now()
		result, err := svc.HandleEvent(context.Background(), event)
		samples = append(samples, time.Since(startedAt))
		if err != "" {
			b.Fatalf("HandleEvent failed: %s", err)
		}
		if result == nil || !result.Processed {
			b.Fatal("expected processed webhook result")
		}
	}
	b.StopTimer()
	reportBillingLatencyProfile(b, samples)
}

func latencySubscriptionRawPayload(b *testing.B) json.RawMessage {
	b.Helper()
	payload := stripe.Subscription{
		ID:       "sub_latency",
		Status:   stripe.SubscriptionStatusActive,
		Customer: &stripe.Customer{ID: "cus_latency"},
		Items: &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{
			{
				CurrentPeriodStart: 1_700_000_000,
				CurrentPeriodEnd:   1_702_592_000,
				Price:              &stripe.Price{ID: "price_pro"},
			},
		}},
		Metadata: map[string]string{"userId": "42"},
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		b.Fatalf("marshal subscription payload: %v", err)
	}
	return raw
}

type latencyWebhookRepository struct {
	processed map[string]bool
	user      *WebhookUser
}

func (r *latencyWebhookRepository) HasProcessedEvent(_ context.Context, stripeEventID string) (bool, error) {
	return r.processed[stripeEventID], nil
}

func (r *latencyWebhookRepository) RecordEvent(_ context.Context, stripeEventID, _ string) (WebhookClaim, error) {
	if r.processed[stripeEventID] {
		return "", nil
	}
	r.processed[stripeEventID] = true
	return "latency-claim", nil
}

func (r *latencyWebhookRepository) CompleteEvent(_ context.Context, stripeEventID string, _ WebhookClaim) error {
	r.processed[stripeEventID] = true
	return nil
}

func (r *latencyWebhookRepository) DeleteEvent(_ context.Context, stripeEventID string, _ WebhookClaim) error {
	delete(r.processed, stripeEventID)
	return nil
}

func (r *latencyWebhookRepository) FindUserByID(context.Context, int) (*WebhookUser, error) {
	return r.user, nil
}

func (r *latencyWebhookRepository) FindUserByCustomerID(context.Context, string) (*WebhookUser, error) {
	return r.user, nil
}

func (r *latencyWebhookRepository) UpdateUser(context.Context, int, WebhookUserUpdate) error {
	return nil
}

func reportBillingLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(billingDurationMicroseconds(billingPercentileDuration(ordered, 0.50)), "p50_us")
	b.ReportMetric(billingDurationMicroseconds(billingPercentileDuration(ordered, 0.95)), "p95_us")
	b.ReportMetric(billingDurationMicroseconds(billingPercentileDuration(ordered, 0.99)), "p99_us")
}

func billingPercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
	if len(ordered) == 0 {
		return 0
	}
	index := int(float64(len(ordered))*percentile + 0.999999)
	if index < 1 {
		index = 1
	}
	if index > len(ordered) {
		index = len(ordered)
	}
	return ordered[index-1]
}

func billingDurationMicroseconds(duration time.Duration) float64 {
	return float64(duration.Nanoseconds()) / 1000
}
