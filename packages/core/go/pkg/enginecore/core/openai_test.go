package core

import "testing"

func TestOpenAIStreamNext(t *testing.T) {
	event, ok, err := (&OpenAIStream{}).Next()
	if err != nil || ok || event.Type != "" {
		t.Fatalf("unexpected placeholder stream result: event=%#v ok=%v err=%v", event, ok, err)
	}
}
