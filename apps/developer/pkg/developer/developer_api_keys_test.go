package developer

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestKeysService_RevokeKey_ErrorPaths(t *testing.T) {
	tests := []struct {
		name      string
		keyID     int
		record    *DeveloperApiKeyRecord
		findErr   error
		revokeErr error
		wantKey   string
		wantErr   bool
	}{
		{
			name:    "empty display key",
			keyID:   10,
			record:  &DeveloperApiKeyRecord{ID: 10, DisplayKey: "", RevokedAt: nil},
			wantKey: "Key #10",
		},
		{
			name:    "not found",
			keyID:   999,
			findErr: errors.New("not found"),
			wantErr: true,
		},
		{
			name:      "revoke error",
			keyID:     10,
			record:    &DeveloperApiKeyRecord{ID: 10, DisplayKey: "tfai_...1234", RevokedAt: nil},
			revokeErr: errors.New("db error"),
			wantErr:   true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			mockRepo := new(MockDeveloperRepository)
			s := NewDeveloperKeysService(mockRepo)
			ctx := context.Background()

			mockRepo.On("FindKeyForUser", mock.Anything, tc.keyID, 1).Return(tc.record, tc.findErr).Once()
			if tc.record != nil && tc.findErr == nil {
				mockRepo.On("RevokeKey", mock.Anything, tc.keyID).Return(tc.revokeErr).Once()
			}

			out, err := s.RevokeKey(ctx, 1, tc.keyID)
			if tc.wantErr {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.wantKey, out.DisplayKey)
		})
	}
}
