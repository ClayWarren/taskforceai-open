package webhooks

import "github.com/stretchr/testify/mock"

type webhookValidatorMock struct {
	mock.Mock
}

func (m *webhookValidatorMock) ValidatePayload(signature string, body string) (string, error) {
	ret := m.Called(signature, body)
	return ret.String(0), ret.Error(1)
}
