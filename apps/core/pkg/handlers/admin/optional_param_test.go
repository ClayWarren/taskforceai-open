package admin

import (
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/stretchr/testify/assert"
)

func TestOptionalParam_OnParamSet(t *testing.T) {
	var p OptionalParam[string]
	p.OnParamSet(true, nil)
	assert.True(t, p.IsSet)
}

func TestOptionalParam_Schema(t *testing.T) {
	var p OptionalParam[int]
	schema := p.Schema(huma.NewMapRegistry("#/components/schemas/", huma.DefaultSchemaNamer))
	assert.NotNil(t, schema)
}

func TestOptionalParam_Receiver(t *testing.T) {
	p := OptionalParam[int]{Value: 5}
	recv := p.Receiver()
	assert.Equal(t, 5, int(recv.Int()))
}

func TestOptionalParamHelpers(t *testing.T) {
	p1 := OptionalParam[string]{Value: "ok", IsSet: true}
	p2 := OptionalParam[string]{Value: "no", IsSet: false}

	v1 := optionalStringParam(p1)
	v2 := optionalStringParam(p2)
	assert.NotNil(t, v1)
	assert.Equal(t, "ok", *v1)
	assert.Nil(t, v2)

	p3 := OptionalParam[int32]{Value: 7, IsSet: true}
	p4 := OptionalParam[int32]{Value: 9, IsSet: false}

	i1 := optionalInt32Param(p3)
	i2 := optionalInt32Param(p4)
	assert.NotNil(t, i1)
	assert.Equal(t, int32(7), *i1)
	assert.Nil(t, i2)
}
