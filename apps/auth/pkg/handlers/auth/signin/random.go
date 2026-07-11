package signin

import (
	crand "crypto/rand"
	"io"
)

var stateRandomReader io.Reader = crand.Reader

func readStateRandom(b []byte) (int, error) {
	return io.ReadFull(stateRandomReader, b)
}
