-- Create incidents table for real-time status tracking
CREATE TABLE service_incidents (
    id SERIAL PRIMARY KEY,
    service_id TEXT NOT NULL, -- 'api', 'web', 'ios', etc.
    status TEXT NOT NULL,     -- 'degraded', 'outage', 'maintenance'
    message TEXT NOT NULL,
    started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP(3),
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add index for status page queries (fetching history)
CREATE INDEX service_incidents_started_at_idx ON service_incidents (started_at);
CREATE INDEX service_incidents_service_id_idx ON service_incidents (service_id);

-- Add comment
COMMENT ON TABLE service_incidents IS 'Real-world service outages and incidents displayed on the status page';
