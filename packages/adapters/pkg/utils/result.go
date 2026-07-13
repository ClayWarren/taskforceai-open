package utils

import "github.com/TaskForceAI/core/pkg/shared"

type Result[T any] = shared.Result[T]

func Ok[T any](v T) Result[T] { return shared.Ok(v) }

func Err[T any](err error) Result[T] { return shared.Err[T](err) }

func IsOk[T any](r Result[T]) bool { return r.Ok }

func IsErr[T any](r Result[T]) bool { return !r.Ok }
