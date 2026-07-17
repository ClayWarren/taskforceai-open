package server

import (
	"context"
	"errors"
	"reflect"
)

type RedisHealthClient interface {
	Get(ctx context.Context, key string) (string, error)
}

// RedisCheck returns a startup check that verifies the configured Redis client
// can execute a read. Missing probe keys are considered healthy.
func RedisCheck[T RedisHealthClient](getClient func() (T, error), probeKey string) func(context.Context) error {
	return func(ctx context.Context) error {
		client, err := getClient()
		if err != nil {
			return err
		}
		if isNilRedisHealthClient(client) {
			return errors.New("redis client unavailable")
		}
		_, pingErr := client.Get(ctx, probeKey)
		if pingErr != nil && pingErr.Error() != "key not found" {
			return pingErr
		}
		return nil
	}
}

func isNilRedisHealthClient(client any) bool {
	if client == nil {
		return true
	}
	value := reflect.ValueOf(client)
	switch value.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return value.IsNil()
	default:
		return false
	}
}
