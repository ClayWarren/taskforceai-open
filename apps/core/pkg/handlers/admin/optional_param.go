package admin

import (
	"reflect"

	"github.com/danielgtaylor/huma/v2"
)

// OptionalParam wraps query parameters that may or may not be present.
type OptionalParam[T any] struct {
	Value T
	IsSet bool
}

func (o OptionalParam[T]) Schema(r huma.Registry) *huma.Schema {
	return huma.SchemaFromType(r, reflect.TypeOf(o.Value))
}

func (o *OptionalParam[T]) Receiver() reflect.Value {
	return reflect.ValueOf(o).Elem().Field(0)
}

func (o *OptionalParam[T]) OnParamSet(isSet bool, _ any) {
	o.IsSet = isSet
}

func optionalStringParam(param OptionalParam[string]) *string {
	if !param.IsSet {
		return nil
	}
	return &param.Value
}

func optionalInt32Param(param OptionalParam[int32]) *int32 {
	if !param.IsSet {
		return nil
	}
	return &param.Value
}
