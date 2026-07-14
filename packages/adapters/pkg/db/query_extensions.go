package db

// GetDB returns the underlying database handle for gateway extensions that
// cannot be expressed by generated sqlc methods.
func (q *Queries) GetDB() DBTX {
	return q.db
}
