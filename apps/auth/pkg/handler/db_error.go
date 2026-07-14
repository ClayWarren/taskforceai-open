package handler

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
)

// HandleNotFound maps pgx.ErrNoRows to 404 responses and returns true if handled.
func HandleNotFound(w http.ResponseWriter, err error, notFoundMessage string) bool {
	if errors.Is(err, pgx.ErrNoRows) {
		JSONError(w, http.StatusNotFound, notFoundMessage)
		return true
	}
	return false
}
