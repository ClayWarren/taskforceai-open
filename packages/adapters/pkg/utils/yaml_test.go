package utils

import (
	"testing"
)

func TestYamlParse(t *testing.T) {
	yamlInput := `
foo: bar
list:
  - 1
  - 2
`
	t.Run("BasicYamlParse", func(t *testing.T) {
		res, err := BasicYamlParse(yamlInput)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		m, ok := res.(map[string]any)
		if !ok {
			t.Fatalf("expected map[string]interface{}, got %T", res)
		}
		if m["foo"] != "bar" {
			t.Errorf("expected bar, got %v", m["foo"])
		}
	})

	t.Run("YamlParser", func(t *testing.T) {
		parser := &YamlParser{}
		res, err := parser.Parse(yamlInput)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res == nil {
			t.Error("expected non-nil result")
		}
	})

	t.Run("Invalid YAML", func(t *testing.T) {
		_, err := BasicYamlParse("invalid: yaml: :")
		if err == nil {
			t.Error("expected error for invalid YAML")
		}
	})
}
