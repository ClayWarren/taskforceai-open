package shared

type Result[T any] struct {
	Value T
	Error error
	Ok    bool
}

func Ok[T any](v T) Result[T] {
	return Result[T]{Value: v, Ok: true}
}

func Err[T any](err error) Result[T] {
	return Result[T]{Error: err, Ok: false}
}
