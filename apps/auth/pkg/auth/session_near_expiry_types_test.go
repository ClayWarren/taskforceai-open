package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
)

func TestIsTokenNearExpiry_Int64Claims(t *testing.T) {
	now := time.Now().Unix()
	token := &jwt.Token{
		Claims: jwt.MapClaims{
			"iat": now - 90,
			"exp": now + 10,
		},
	}
	assert.True(t, IsTokenNearExpiry(token, 0.8))
}

func TestIsTokenNearExpiry_InvalidClaimTypes(t *testing.T) {
	token := &jwt.Token{Claims: jwt.MapClaims{"iat": "bad", "exp": "bad"}}
	assert.False(t, IsTokenNearExpiry(token, 0.5))
}
