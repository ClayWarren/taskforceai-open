package pkg

import "encoding/json"

func normalizeToolParameters(parameters any) map[string]any {
	if parameters == nil {
		return map[string]any{}
	}
	if params, ok := parameters.(map[string]any); ok {
		return sanitizeToolSchemaMap(params)
	}

	raw, err := json.Marshal(parameters)
	if err != nil {
		return map[string]any{}
	}
	var params map[string]any
	if err := json.Unmarshal(raw, &params); err != nil {
		return map[string]any{}
	}
	if params == nil {
		return map[string]any{}
	}
	return sanitizeToolSchemaMap(params)
}

func sanitizeToolSchemaMap(params map[string]any) map[string]any {
	sanitized := make(map[string]any, len(params))
	for key, value := range params {
		if key == "required" {
			if required, ok := sanitizeRequiredFields(value); ok {
				sanitized[key] = required
			}
			continue
		}
		if isNamedSchemaContainer(key) {
			if namedSchemas, ok := sanitizeNamedSchemaMap(value); ok {
				sanitized[key] = namedSchemas
			}
			continue
		}
		if sanitizedValue, ok := sanitizeToolSchemaValue(value); ok {
			sanitized[key] = sanitizedValue
		}
	}
	return sanitized
}

func isNamedSchemaContainer(key string) bool {
	switch key {
	case "$defs", "definitions", "dependentSchemas", "patternProperties", "properties":
		return true
	default:
		return false
	}
}

func sanitizeNamedSchemaMap(value any) (map[string]any, bool) {
	namedSchemas, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}

	sanitized := make(map[string]any, len(namedSchemas))
	for name, schema := range namedSchemas {
		if sanitizedSchema, ok := sanitizeToolSchemaValue(schema); ok {
			sanitized[name] = sanitizedSchema
		}
	}
	return sanitized, true
}

func sanitizeToolSchemaValue(value any) (any, bool) {
	switch v := value.(type) {
	case nil:
		return nil, false
	case map[string]any:
		return sanitizeToolSchemaMap(v), true
	case []any:
		items := make([]any, 0, len(v))
		for _, item := range v {
			if sanitized, ok := sanitizeToolSchemaValue(item); ok {
				items = append(items, sanitized)
			}
		}
		return items, true
	default:
		return value, true
	}
}

func sanitizeRequiredFields(value any) ([]any, bool) {
	switch required := value.(type) {
	case []string:
		items := make([]any, 0, len(required))
		for _, field := range required {
			if field != "" {
				items = append(items, field)
			}
		}
		return items, len(items) > 0
	case []any:
		items := make([]any, 0, len(required))
		for _, field := range required {
			if s, ok := field.(string); ok && s != "" {
				items = append(items, s)
			}
		}
		return items, len(items) > 0
	default:
		return nil, false
	}
}
