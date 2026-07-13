package utils

import (
	"go.yaml.in/yaml/v4"
)

// YamlParser provides YAML parsing functionality.
type YamlParser struct{}

// Parse unmarshals YAML content into a generic interface.
func (p *YamlParser) Parse(content string) (any, error) {
	return BasicYamlParse(content)
}

// BasicYamlParse is a utility function to parse YAML content.
// It uses go.yaml.in/yaml/v4 to unmarshal the content into a generic map or interface.
func BasicYamlParse(content string) (any, error) {
	var result any
	err := yaml.Unmarshal([]byte(content), &result)
	if err != nil {
		return nil, err
	}
	return result, nil
}
