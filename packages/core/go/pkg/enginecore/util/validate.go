package util

import "github.com/go-playground/validator/v10"

var validate = validator.New()

func ValidateStruct(value any) error {
	if value == nil {
		return nil
	}
	return validate.Struct(value)
}
