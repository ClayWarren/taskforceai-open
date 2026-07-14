package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"net/http"
	"strings"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/go-playground/validator/v10"
)

const defaultDecodeBodyMaxBytes int64 = 1 << 20

// Global validator instance
var validate = validator.New()

// --- Handler Context ---

// Ctx provides typed access to common request context values.
type Ctx struct {
	Context context.Context
	Request *http.Request
	User    *auth.AuthenticatedUser
	OrgID   int
}

// UserID returns the authenticated user's ID, or 0 if not authenticated.
func (c *Ctx) UserID() int {
	if c.User == nil {
		return 0
	}
	return c.User.ID
}

// UserID32 returns the authenticated user's ID as int32 for database operations.
func (c *Ctx) UserID32() int32 {
	userID := c.UserID()
	if userID <= 0 || userID > math.MaxInt32 {
		return 0
	}
	return int32(userID) // #nosec G115 -- userID range checked above.
}

// OrgID32 returns the organization ID as *int32, nil if 0.
func (c *Ctx) OrgID32() *int32 {
	if c.OrgID == 0 {
		return nil
	}
	if c.OrgID < 0 || c.OrgID > math.MaxInt32 {
		return nil
	}
	v := int32(c.OrgID) // #nosec G115 -- c.OrgID range checked above.
	return &v
}

// --- Generic Handler Helpers ---

// DecodeBody parses JSON request body into the given type.
// Returns an HTTPError with 415 status if Content-Type is not application/json.
func DecodeBody[T any](r *http.Request) (T, error) {
	var v T
	ct := r.Header.Get("Content-Type")
	if ct == "" {
		return v, NewHTTPError(http.StatusUnsupportedMediaType, "Content-Type must be application/json")
	}

	mediaType, _, err := mime.ParseMediaType(ct)
	if err != nil || !strings.EqualFold(mediaType, "application/json") {
		return v, NewHTTPError(http.StatusUnsupportedMediaType, "Content-Type must be application/json")
	}

	body := http.MaxBytesReader(nil, r.Body, defaultDecodeBodyMaxBytes)
	decoder := json.NewDecoder(body)
	if err := decoder.Decode(&v); err != nil {
		return v, NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return v, NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	return v, nil
}

// ReadJSON decodes a single strict JSON object from a size-limited request body.
func ReadJSON(w http.ResponseWriter, r *http.Request, dst any, maxBodySize int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodySize)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(dst); err != nil {
		return err
	}

	var trailing struct{}
	if err := decoder.Decode(&trailing); err != io.EOF {
		return fmt.Errorf("body must only contain a single JSON object")
	}
	return nil
}

// MakeCtx creates a Ctx from a request. Call this inside your auth middleware.
func MakeCtx(r *http.Request) *Ctx {
	return &Ctx{
		Context: r.Context(),
		Request: r,
		User:    GetAuthenticatedUser(r),
		OrgID:   GetOrgID(r),
	}
}

// Handle wraps a typed handler, handling JSON response and errors.
// Usage: handler.Handle(w, r, func(ctx *Ctx, req MyReq) (*MyRes, error) { ... })
func Handle[Req, Res any](w http.ResponseWriter, r *http.Request, fn func(ctx *Ctx, req Req) (Res, error)) {
	handleWithStatus(w, r, http.StatusOK, fn)
}

func handleWithStatus[Req, Res any](
	w http.ResponseWriter,
	r *http.Request,
	status int,
	fn func(ctx *Ctx, req Req) (Res, error),
) {
	if GetAuthenticatedUser(r) == nil {
		JSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	ctx := MakeCtx(r)

	req, err := DecodeBody[Req](r)
	if err != nil {
		handleError(w, err)
		return
	}

	// Validate struct
	if err := validate.Struct(req); err != nil {
		JSONError(w, http.StatusBadRequest, FormatValidationErrors(err))
		return
	}

	res, err := fn(ctx, req)
	if err != nil {
		handleError(w, err)
		return
	}

	JSON(w, status, res)
}

// HandleNoBody wraps a typed handler that doesn't need request body parsing.
func HandleNoBody[Res any](w http.ResponseWriter, r *http.Request, fn func(ctx *Ctx) (Res, error)) {
	if GetAuthenticatedUser(r) == nil {
		JSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	ctx := MakeCtx(r)

	res, err := fn(ctx)
	if err != nil {
		handleError(w, err)
		return
	}

	JSON(w, http.StatusOK, res)
}

// HandleCreate is like Handle but returns 201 Created status.
func HandleCreate[Req, Res any](w http.ResponseWriter, r *http.Request, fn func(ctx *Ctx, req Req) (Res, error)) {
	handleWithStatus(w, r, http.StatusCreated, fn)
}

// HandleDelete handles delete operations, returning 204 No Content on success.
func HandleDelete(w http.ResponseWriter, r *http.Request, fn func(ctx *Ctx) error) {
	if GetAuthenticatedUser(r) == nil {
		JSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	ctx := MakeCtx(r)

	if err := fn(ctx); err != nil {
		handleError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// --- Error Handling ---

// HTTPError is an error that includes an HTTP status code.
type HTTPError struct {
	Status  int
	Message string
}

func (e HTTPError) Error() string {
	return e.Message
}

// NewHTTPError creates a new HTTPError.
func NewHTTPError(status int, message string) HTTPError {
	return HTTPError{Status: status, Message: message}
}

// Common errors
var (
	ErrNotFound     = NewHTTPError(http.StatusNotFound, "Not found")
	ErrUnauthorized = NewHTTPError(http.StatusUnauthorized, "Unauthorized")
	ErrForbidden    = NewHTTPError(http.StatusForbidden, "Forbidden")
	ErrBadRequest   = NewHTTPError(http.StatusBadRequest, "Bad request")
)

func handleError(w http.ResponseWriter, err error) {
	if httpErr, ok := errors.AsType[HTTPError](err); ok {
		JSONError(w, httpErr.Status, httpErr.Message)
		return
	}
	JSONError(w, http.StatusInternalServerError, "Internal server error")
}

// ValidateStruct validates req with go-playground/validator. Use after decoding JSON request bodies.
// Returns nil if valid; otherwise returns an error that can be passed to FormatValidationErrors for a 400 response.
func ValidateStruct(req any) error {
	return validate.Struct(req)
}

// FormatValidationErrors turns validator.ValidationErrors into a single string suitable for JSONError responses.
func FormatValidationErrors(err error) string {
	if errs, ok := errors.AsType[validator.ValidationErrors](err); ok {
		msgs := make([]string, 0, len(errs))
		for _, e := range errs {
			msgs = append(msgs, fmt.Sprintf("field '%s' failed validation: %s", e.Field(), e.Tag()))
		}
		return strings.Join(msgs, ", ")
	}
	return err.Error()
}
