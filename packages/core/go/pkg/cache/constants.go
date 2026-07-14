package cache

import "time"

const DefaultTTL = 5 * 60 * 1000 * time.Millisecond
const DefaultMax = 100
const RedisFallbackEventCode = "TF_REDIS_FALLBACK"
