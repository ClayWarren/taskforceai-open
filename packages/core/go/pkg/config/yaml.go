package config

import "go.yaml.in/yaml/v4"

func basicYAMLParse(content string) (any, error) {
	var result any
	if err := yaml.Unmarshal([]byte(content), &result); err != nil {
		return nil, err
	}
	return result, nil
}
