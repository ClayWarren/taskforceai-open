package collections

func Map[T, U any](items []T, mapItem func(T) U) []U {
	records := make([]U, len(items))
	for i, item := range items {
		records[i] = mapItem(item)
	}
	return records
}
