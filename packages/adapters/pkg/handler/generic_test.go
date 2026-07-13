package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCtx_Methods(t *testing.T) {
	// 1. User present
	user := &auth.AuthenticatedUser{ID: 123}
	c := &Ctx{User: user, OrgID: 456}

	assert.Equal(t, 123, c.UserID())
	assert.Equal(t, int32(123), c.UserID32())
	assert.Equal(t, int32(456), *c.OrgID32())

	// 2. User nil
	c2 := &Ctx{}
	assert.Equal(t, 0, c2.UserID())
	assert.Nil(t, c2.OrgID32())

	// 3. Values outside int32 DB bounds are rejected.
	c3 := &Ctx{User: &auth.AuthenticatedUser{ID: int(math.MaxInt32) + 1}, OrgID: int(math.MaxInt32) + 1}
	assert.Zero(t, c3.UserID32())
	assert.Nil(t, c3.OrgID32())

	c4 := &Ctx{User: &auth.AuthenticatedUser{ID: -1}, OrgID: -1}
	assert.Zero(t, c4.UserID32())
	assert.Nil(t, c4.OrgID32())
}

func TestDecodeBody(t *testing.T) {
	type testReq struct {
		Name string `json:"name"`
	}

	// 1. Success
	body := `{"name":"test"}`
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")

	v, err := DecodeBody[testReq](req)
	require.NoError(t, err)
	assert.Equal(t, "test", v.Name)

	// 2. Wrong Content-Type
	req2 := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(body))
	_, err = DecodeBody[testReq](req2)
	require.Error(t, err)
	var httpErr HTTPError
	if assert.ErrorAs(t, err, &httpErr) {
		assert.Equal(t, http.StatusUnsupportedMediaType, httpErr.Status)
	}

	// 3. Invalid JSON
	req3 := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{invalid`))
	req3.Header.Set("Content-Type", "application/json")
	_, err = DecodeBody[testReq](req3)
	require.Error(t, err)

	// 4. Spoofed Content-Type should fail
	req4 := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(body))
	req4.Header.Set("Content-Type", "text/plain; application/json")
	_, err = DecodeBody[testReq](req4)
	require.Error(t, err)
	if assert.ErrorAs(t, err, &httpErr) {
		assert.Equal(t, http.StatusUnsupportedMediaType, httpErr.Status)
	}

	// 5. Trailing JSON should fail
	req5 := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{"name":"first"}{"name":"second"}`))
	req5.Header.Set("Content-Type", "application/json")
	_, err = DecodeBody[testReq](req5)
	require.Error(t, err)
	if assert.ErrorAs(t, err, &httpErr) {
		assert.Equal(t, http.StatusBadRequest, httpErr.Status)
	}

	// 6. Oversized JSON should fail
	oversized := `{"name":"` + string(bytes.Repeat([]byte("a"), int(defaultDecodeBodyMaxBytes))) + `"}`
	req6 := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(oversized))
	req6.Header.Set("Content-Type", "application/json")
	_, err = DecodeBody[testReq](req6)
	require.Error(t, err)
	if assert.ErrorAs(t, err, &httpErr) {
		assert.Equal(t, http.StatusBadRequest, httpErr.Status)
	}
}

func TestHTTPErrorError(t *testing.T) {
	err := NewHTTPError(http.StatusTeapot, "short and stout")

	assert.Equal(t, "short and stout", err.Error())
	assert.Equal(t, http.StatusTeapot, err.Status)
}

func TestReadJSON(t *testing.T) {
	type testReq struct {
		Name string `json:"name"`
	}

	t.Run("success", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{"name":"test"}`))
		rr := httptest.NewRecorder()
		var out testReq

		err := ReadJSON(rr, req, &out, 1024)

		require.NoError(t, err)
		assert.Equal(t, "test", out.Name)
	})

	t.Run("unknown field", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{"name":"test","extra":true}`))
		rr := httptest.NewRecorder()
		var out testReq

		err := ReadJSON(rr, req, &out, 1024)

		assert.Error(t, err)
	})

	t.Run("trailing object", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{"name":"test"}{"name":"again"}`))
		rr := httptest.NewRecorder()
		var out testReq

		err := ReadJSON(rr, req, &out, 1024)

		assert.Error(t, err)
	})

	t.Run("too large", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{"name":"toolong"}`))
		rr := httptest.NewRecorder()
		var out testReq

		err := ReadJSON(rr, req, &out, 4)

		assert.Error(t, err)
	})
}

func TestHandle(t *testing.T) {
	type myReq struct {
		Age int `json:"age" validate:"required,gt=0"`
	}
	type myRes struct {
		Double int `json:"double"`
	}

	handlerFn := func(ctx *Ctx, req myReq) (myRes, error) {
		return myRes{Double: req.Age * 2}, nil
	}

	// 1. Success
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	body, _ := json.Marshal(myReq{Age: 10})
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(req.Context(), UserContextKey, user))

	rr := httptest.NewRecorder()
	Handle(rr, req, handlerFn)

	assert.Equal(t, http.StatusOK, rr.Code)
	var res myRes
	err := json.NewDecoder(rr.Body).Decode(&res)
	require.NoError(t, err)
	assert.Equal(t, 20, res.Double)

	// 2. Unauthorized
	reqNoAuth := httptest.NewRequest(http.MethodPost, "/", nil)
	rr2 := httptest.NewRecorder()
	Handle(rr2, reqNoAuth, handlerFn)
	assert.Equal(t, http.StatusUnauthorized, rr2.Code)

	// 3. Validation Failure
	bodyBad, _ := json.Marshal(myReq{Age: -1})
	reqBad := httptest.NewRequest(http.MethodPost, "/", bytes.NewBuffer(bodyBad))
	reqBad.Header.Set("Content-Type", "application/json")
	reqBad = reqBad.WithContext(context.WithValue(reqBad.Context(), UserContextKey, user))
	rr3 := httptest.NewRecorder()
	Handle(rr3, reqBad, handlerFn)
	assert.Equal(t, http.StatusBadRequest, rr3.Code)

	// 4. Content-Type Failure
	reqInvalidType := httptest.NewRequest(http.MethodPost, "/", bytes.NewBuffer(body))
	reqInvalidType = reqInvalidType.WithContext(context.WithValue(reqInvalidType.Context(), UserContextKey, user))
	rr4 := httptest.NewRecorder()
	Handle(rr4, reqInvalidType, handlerFn)
	assert.Equal(t, http.StatusUnsupportedMediaType, rr4.Code)

	// 5. Handler error
	reqErr := httptest.NewRequest(http.MethodPost, "/", bytes.NewBuffer(body))
	reqErr.Header.Set("Content-Type", "application/json")
	reqErr = reqErr.WithContext(context.WithValue(reqErr.Context(), UserContextKey, user))
	rr5 := httptest.NewRecorder()
	Handle(rr5, reqErr, func(ctx *Ctx, req myReq) (myRes, error) {
		return myRes{}, NewHTTPError(http.StatusConflict, "conflict")
	})
	assert.Equal(t, http.StatusConflict, rr5.Code)
}

func TestHandleCreate(t *testing.T) {
	type createReq struct {
		Name string `json:"name" validate:"required"`
	}
	handlerFn := func(ctx *Ctx, req createReq) (map[string]string, error) {
		return map[string]string{"status": "created"}, nil
	}

	user := &auth.AuthenticatedUser{ID: 1}
	body, _ := json.Marshal(createReq{Name: "test"})
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(req.Context(), UserContextKey, user))

	rr := httptest.NewRecorder()
	HandleCreate(rr, req, handlerFn)
	if rr.Code != http.StatusCreated {
		t.Errorf("HandleCreate failed: %d, body: %s", rr.Code, rr.Body.String())
	}
	assert.Equal(t, http.StatusCreated, rr.Code)

	rrUnauthorized := httptest.NewRecorder()
	HandleCreate(rrUnauthorized, httptest.NewRequest(http.MethodPost, "/", nil), handlerFn)
	assert.Equal(t, http.StatusUnauthorized, rrUnauthorized.Code)

	// Failure (Validation)
	bodyBad, _ := json.Marshal(createReq{})
	reqBad := httptest.NewRequest(http.MethodPost, "/", bytes.NewBuffer(bodyBad))
	reqBad.Header.Set("Content-Type", "application/json")
	reqBad = reqBad.WithContext(context.WithValue(reqBad.Context(), UserContextKey, user))
	rr2 := httptest.NewRecorder()
	HandleCreate(rr2, reqBad, handlerFn)
	assert.Equal(t, http.StatusBadRequest, rr2.Code)

	// Failure (Content-Type)
	reqInvalidType := httptest.NewRequest(http.MethodPost, "/", bytes.NewBuffer(body))
	reqInvalidType = reqInvalidType.WithContext(context.WithValue(reqInvalidType.Context(), UserContextKey, user))
	rr3 := httptest.NewRecorder()
	HandleCreate(rr3, reqInvalidType, handlerFn)
	assert.Equal(t, http.StatusUnsupportedMediaType, rr3.Code)

	reqErr := httptest.NewRequest(http.MethodPost, "/", bytes.NewBuffer(body))
	reqErr.Header.Set("Content-Type", "application/json")
	reqErr = reqErr.WithContext(context.WithValue(reqErr.Context(), UserContextKey, user))
	rr4 := httptest.NewRecorder()
	HandleCreate(rr4, reqErr, func(ctx *Ctx, req createReq) (map[string]string, error) {
		return nil, NewHTTPError(http.StatusConflict, "conflict")
	})
	assert.Equal(t, http.StatusConflict, rr4.Code)
}

func TestHandleDelete(t *testing.T) {
	handlerFn := func(ctx *Ctx) error {
		return nil
	}

	user := &auth.AuthenticatedUser{ID: 1}
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	req = req.WithContext(context.WithValue(req.Context(), UserContextKey, user))

	rr := httptest.NewRecorder()
	HandleDelete(rr, req, handlerFn)
	assert.Equal(t, http.StatusNoContent, rr.Code)

	// Failure
	errHandler := func(ctx *Ctx) error {
		return fmt.Errorf("delete failed")
	}
	rr2 := httptest.NewRecorder()
	HandleDelete(rr2, req, errHandler)
	assert.Equal(t, http.StatusInternalServerError, rr2.Code)

	rr3 := httptest.NewRecorder()
	HandleDelete(rr3, httptest.NewRequest(http.MethodDelete, "/", nil), handlerFn)
	assert.Equal(t, http.StatusUnauthorized, rr3.Code)
}

func TestHandleNoBody(t *testing.T) {
	handlerFn := func(ctx *Ctx) (map[string]string, error) {
		return map[string]string{"foo": "bar"}, nil
	}
	user := &auth.AuthenticatedUser{ID: 1}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(context.WithValue(req.Context(), UserContextKey, user))

	rr := httptest.NewRecorder()
	HandleNoBody(rr, req, handlerFn)
	assert.Equal(t, http.StatusOK, rr.Code)

	rr2 := httptest.NewRecorder()
	HandleNoBody(rr2, httptest.NewRequest(http.MethodGet, "/", nil), handlerFn)
	assert.Equal(t, http.StatusUnauthorized, rr2.Code)

	rr3 := httptest.NewRecorder()
	HandleNoBody(rr3, req, func(ctx *Ctx) (map[string]string, error) {
		return nil, NewHTTPError(http.StatusTeapot, "short and stout")
	})
	assert.Equal(t, http.StatusTeapot, rr3.Code)
}

func TestHandleError(t *testing.T) {
	// 1. HTTPError
	rr := httptest.NewRecorder()
	handleError(rr, NewHTTPError(http.StatusForbidden, "stopped"))
	assert.Equal(t, http.StatusForbidden, rr.Code)
	assert.Contains(t, rr.Body.String(), "stopped")

	// 2. Generic error
	rr2 := httptest.NewRecorder()
	handleError(rr2, fmt.Errorf("boom"))
	assert.Equal(t, http.StatusInternalServerError, rr2.Code)
}

func TestValidateStruct(t *testing.T) {
	type s struct {
		F string `validate:"required"`
	}
	require.Error(t, ValidateStruct(s{}))
	assert.NoError(t, ValidateStruct(s{F: "ok"}))
}

func TestFormatValidationErrors(t *testing.T) {
	type s struct {
		F string `validate:"required"`
	}
	err := validate.Struct(s{})
	msg := FormatValidationErrors(err)
	assert.Contains(t, msg, "failed validation")

	// Non-validator error
	assert.Equal(t, "plain error", FormatValidationErrors(fmt.Errorf("plain error")))
}
