CREATE TABLE financial_connections (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    organization_id INTEGER REFERENCES organizations (id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_item_id TEXT NOT NULL,
    encrypted_access_token TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    products TEXT [] NOT NULL DEFAULT ARRAY[]::TEXT [],
    transactions_cursor TEXT,
    institution_id TEXT,
    institution_name TEXT,
    last_synced_at TIMESTAMP(3),
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (provider, provider_item_id)
);

CREATE INDEX financial_connections_user_id_idx ON financial_connections (user_id);
CREATE INDEX financial_connections_org_id_idx ON financial_connections (organization_id);

CREATE TABLE financial_accounts (
    id SERIAL PRIMARY KEY,
    connection_id INTEGER NOT NULL REFERENCES financial_connections (id) ON DELETE CASCADE,
    provider_account_id TEXT NOT NULL,
    name TEXT NOT NULL,
    mask TEXT,
    type TEXT,
    subtype TEXT,
    current_balance NUMERIC,
    available_balance NUMERIC,
    iso_currency_code TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (connection_id, provider_account_id)
);

CREATE INDEX financial_accounts_connection_id_idx ON financial_accounts (connection_id);

CREATE TABLE financial_transactions (
    id SERIAL PRIMARY KEY,
    connection_id INTEGER NOT NULL REFERENCES financial_connections (id) ON DELETE CASCADE,
    provider_transaction_id TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    iso_currency_code TEXT,
    date DATE NOT NULL,
    authorized_date DATE,
    name TEXT NOT NULL,
    merchant_name TEXT,
    primary_category TEXT,
    detailed_category TEXT,
    pending BOOLEAN NOT NULL DEFAULT false,
    removed BOOLEAN NOT NULL DEFAULT false,
    raw JSONB,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (connection_id, provider_transaction_id)
);

CREATE INDEX financial_transactions_connection_id_idx ON financial_transactions (connection_id);
CREATE INDEX financial_transactions_date_idx ON financial_transactions (date DESC);

CREATE TABLE financial_recurring_streams (
    id SERIAL PRIMARY KEY,
    connection_id INTEGER NOT NULL REFERENCES financial_connections (id) ON DELETE CASCADE,
    provider_stream_id TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    stream_type TEXT NOT NULL,
    merchant_name TEXT,
    description TEXT,
    frequency TEXT,
    last_amount NUMERIC,
    iso_currency_code TEXT,
    last_date DATE,
    status TEXT,
    raw JSONB,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (connection_id, provider_stream_id)
);

CREATE INDEX financial_recurring_streams_connection_id_idx ON financial_recurring_streams (connection_id);
