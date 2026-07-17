package common

import "github.com/danielgtaylor/huma/v2"

func Operation(tag, operationID, method, path, summary string) huma.Operation {
	return huma.Operation{
		OperationID: operationID,
		Method:      method,
		Path:        path,
		Summary:     summary,
		Tags:        []string{tag},
	}
}

func APIKeyOperation(tag, operationID, method, path, summary string) huma.Operation {
	operation := Operation(tag, operationID, method, path, summary)
	operation.Security = []map[string][]string{{"api_key": {}}}
	return operation
}
