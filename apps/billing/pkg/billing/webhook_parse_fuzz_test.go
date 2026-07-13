package billing

import (
	"testing"
)

// Webhook payloads arrive from Stripe but are parsed before any signature
// trust decision matters for memory safety: the parsers must never panic
// and must uphold the "nil result only with non-empty werr" contract that
// every handler relies on (handlers deref the result after werr == "").

func FuzzParseSubscription(f *testing.F) {
	f.Add([]byte(`{"id":"sub_123","status":"active","customer":{"id":"cus_1"},"cancel_at_period_end":true}`))
	f.Add([]byte(`{"id":"sub_123","items":{"data":[{"price":{"id":"price_1"},"current_period_start":1,"current_period_end":2}]}}`))
	f.Add([]byte(`null`))
	f.Add([]byte(`{}`))
	f.Add([]byte(`{"customer":null,"items":{"data":[null]}}`))
	f.Fuzz(func(t *testing.T, data []byte) {
		sub, werr := parseSubscription(data)
		if werr == "" && sub == nil {
			t.Fatal("parseSubscription returned nil result with empty werr")
		}
		if sub == nil {
			return
		}
		// Mirror handler field access (handleSubscriptionUpdate/Deleted).
		_, _ = sub.ID, sub.Status
		if sub.CustomerID != nil {
			_ = *sub.CustomerID
		}
		if sub.PriceID != nil {
			_ = *sub.PriceID
		}
		if sub.CurrentPeriodStart != nil {
			_ = *sub.CurrentPeriodStart
		}
		if sub.CurrentPeriodEnd != nil {
			_ = *sub.CurrentPeriodEnd
		}
	})
}

func FuzzParseInvoice(f *testing.F) {
	f.Add([]byte(`{"id":"in_1","customer":{"id":"cus_1"},"amount_paid":100,"currency":"usd"}`))
	f.Add([]byte(`{"id":"in_1","lines":{"data":[{"pricing":{"price_details":{"price":"price_1"}}}]}}`))
	f.Add([]byte(`null`))
	f.Add([]byte(`{"lines":{"data":[null]}}`))
	f.Add([]byte(`{"customer":null,"amount_paid":-1}`))
	f.Fuzz(func(t *testing.T, data []byte) {
		inv, werr := parseInvoice(data)
		if werr == "" && inv == nil {
			t.Fatal("parseInvoice returned nil result with empty werr")
		}
		if inv == nil {
			return
		}
		// Mirror handler field access (handlePaymentSucceeded).
		for _, p := range []*string{inv.ID, inv.CustomerID, inv.Currency, inv.PriceID} {
			if p != nil {
				_ = *p
			}
		}
		if inv.AmountPaid != nil {
			_ = *inv.AmountPaid
		}
	})
}
