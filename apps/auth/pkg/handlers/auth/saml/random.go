package saml

import (
	crand "crypto/rand"
	"io"

	stateutil "github.com/TaskForceAI/auth-service/pkg/handlers/auth/state"
)

var (
	stateRandomReader = crand.Reader
	buildStatePayload = stateutil.BuildStatePayload
)

func readStateRandom(b []byte) (int, error) {
	return io.ReadFull(stateRandomReader, b)
}
