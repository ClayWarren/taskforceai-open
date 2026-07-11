package handler

import (
	"github.com/TaskForceAI/adapters/pkg/dbauth"
	appdatabase "github.com/TaskForceAI/developer-service/pkg/database"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
)

var WithAPIKeyIdentity = dbauth.WithAPIKeyIdentity

var GetQueries = appdatabase.GetQueries

var GetPool = postgres.GetPool
