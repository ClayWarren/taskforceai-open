package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
)

func TestHandleNotFound(t *testing.T) {
	rr := httptest.NewRecorder()
	handled := HandleNotFound(rr, pgx.ErrNoRows, "missing")
	assert.True(t, handled)
	assert.Equal(t, http.StatusNotFound, rr.Code)

	rr = httptest.NewRecorder()
	handled = HandleNotFound(rr, assert.AnError, "missing")
	assert.False(t, handled)
	assert.Equal(t, http.StatusOK, rr.Code)
}
