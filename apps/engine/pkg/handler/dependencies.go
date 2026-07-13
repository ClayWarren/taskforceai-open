package handler

import (
	"github.com/TaskForceAI/adapters/pkg/dbauth"
	appdatabase "github.com/TaskForceAI/go-engine/pkg/database"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

// GetQueries retrieves the database queries.
var GetQueries = appdatabase.GetQueries

// WithFlexibleAuth wraps handlers with optional DB-backed auth.
var WithFlexibleAuth = dbauth.WithFlexibleAuth

// RedisClientGetter retrieves the Redis client.
var RedisClientGetter = redis.GetClient
