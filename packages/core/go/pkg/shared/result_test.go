package shared

import (
	"errors"
	"testing"
)

func TestResult(t *testing.T) {
	t.Run("Ok", func(t *testing.T) {
		val := "success"
		res := Ok(val)

		if res.Value != val {
			t.Errorf("expected %v, got %v", val, res.Value)
		}
		if res.Error != nil {
			t.Errorf("expected nil error, got %v", res.Error)
		}
	})

	t.Run("Err", func(t *testing.T) {
		err := errors.New("failed")
		res := Err[string](err)

		if !errors.Is(res.Error, err) {
			t.Errorf("expected %v, got %v", err, res.Error)
		}
	})
}
