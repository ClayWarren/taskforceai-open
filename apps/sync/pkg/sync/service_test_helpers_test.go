package sync

import "context"

// newSyncTest returns a Service backed by a fresh mock repository (no other
// dependencies) plus a background context — the setup most service tests share.
func newSyncTest() (*Service, *MockSyncRepository, context.Context) {
	mockRepo := new(MockSyncRepository)
	svc := NewService(mockRepo, nil, nil, nil, nil, nil)
	svc.runAsync = func(fn func()) { fn() }
	return svc, mockRepo, context.Background()
}
