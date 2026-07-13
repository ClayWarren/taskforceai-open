package topology

import "fmt"

type Service string

const (
	Auth      Service = "auth"
	Billing   Service = "billing"
	Core      Service = "core"
	Developer Service = "developer"
	Engine    Service = "engine"
	Sync      Service = "sync"
)

type Definition struct {
	ID            Service
	ServiceName   string
	ServiceURLVar string
	ProductionURL string
	LocalURL      string
	DefaultPort   string
}

var definitions = map[Service]Definition{
	Auth: {
		ID:            Auth,
		ServiceName:   "Auth API",
		ServiceURLVar: "AUTH_SERVICE_URL",
		ProductionURL: "https://auth.taskforceai.chat",
		LocalURL:      "http://localhost:3002",
		DefaultPort:   "3002",
	},
	Billing: {
		ID:            Billing,
		ServiceName:   "Billing API",
		ServiceURLVar: "BILLING_SERVICE_URL",
		ProductionURL: "https://billing.taskforceai.chat",
		LocalURL:      "http://localhost:3003",
		DefaultPort:   "3003",
	},
	Core: {
		ID:            Core,
		ServiceName:   "Core API",
		ServiceURLVar: "CORE_SERVICE_URL",
		ProductionURL: "https://core.taskforceai.chat",
		LocalURL:      "http://localhost:3001",
		DefaultPort:   "3001",
	},
	Developer: {
		ID:            Developer,
		ServiceName:   "Developer API",
		ServiceURLVar: "DEVELOPER_SERVICE_URL",
		ProductionURL: "https://developer.taskforceai.chat",
		LocalURL:      "http://localhost:3004",
		DefaultPort:   "3004",
	},
	Engine: {
		ID:            Engine,
		ServiceName:   "Engine API",
		ServiceURLVar: "ENGINE_SERVICE_URL",
		ProductionURL: "https://engine.taskforceai.chat",
		LocalURL:      "http://localhost:3006",
		DefaultPort:   "3006",
	},
	Sync: {
		ID:            Sync,
		ServiceName:   "Sync API",
		ServiceURLVar: "SYNC_SERVICE_URL",
		ProductionURL: "https://sync.taskforceai.chat",
		LocalURL:      "http://localhost:3005",
		DefaultPort:   "3005",
	},
}

func Get(service Service) Definition {
	definition, ok := definitions[service]
	if !ok {
		panic(fmt.Sprintf("unknown service topology: %q", service))
	}
	return definition
}
