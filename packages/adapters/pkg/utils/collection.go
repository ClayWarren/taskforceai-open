package utils

// Unique returns a new slice with only unique elements from the input slice.
func Unique[T comparable](array []T) []T {
	seen := make(map[T]struct{})
	var result []T
	for _, v := range array {
		if _, ok := seen[v]; !ok {
			seen[v] = struct{}{}
			result = append(result, v)
		}
	}
	return result
}

// Chunk splits a slice into multiple slices of the given size.
func Chunk[T any](array []T, size int) [][]T {
	if size <= 0 {
		return nil
	}
	var chunks [][]T
	for i := 0; i < len(array); i += size {
		end := min(i+size, len(array))
		chunks = append(chunks, array[i:end])
	}
	return chunks
}

// IsEmpty checks if a map is empty.
func IsEmpty[K comparable, V any](m map[K]V) bool {
	return len(m) == 0
}

// GroupBy groups elements of a slice by a key returned by the selector function.
func GroupBy[T any](array []T, selector func(T) string) map[string][]T {
	res := make(map[string][]T)
	for _, item := range array {
		key := selector(item)
		res[key] = append(res[key], item)
	}
	return res
}
